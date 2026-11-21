/**
 * 扣款服务（DB → 纯函数）
 * ------------------------------------------------------------
 * 职责：把库里的费率表、税率表、个税登记、递延台账读出来，
 *       交给 lib/payroll-deduction.js 的纯函数算，再把结果按
 *       「本月扣 / 本月递延 / 本月结清」拆成三块。
 *
 * 与 v1（salary-service.js）的关系：
 *   v1 的保险靠工资结构明细行（insurance_personal 等）配置，个税不扣免税收入；
 *   v2 统一走 salary_insurance_rate + 免税口径，两者并存不互相干扰。
 */
import { query, many, one } from '../db/index.js';
import {
  computeInsurance, computePit, planDeferral, computeNetPay,
  resolveFirstMonth, round
} from '../lib/payroll-deduction.js';

// ============================================================
// 一、费率
// ============================================================
let _rateCache = { at: 0, key: null, rows: null };

/** 取某日生效的分险种费率（同期同 code 取最新 effective_from） */
export async function loadInsuranceRates(regionCode = 'VN', date = new Date().toISOString().slice(0, 10)) {
  const key = regionCode + '@' + date;
  const now = Date.now();
  if (_rateCache.rows && _rateCache.key === key && now - _rateCache.at < 60_000) return _rateCache.rows;

  const rows = await many(
    `SELECT DISTINCT ON (code) code, name, name_vi, employee_rate, company_rate,
            mode, employee_fixed, company_fixed,
            base_mode, cap_base, cap_note, sort_order, active, effective_from
       FROM salary_insurance_rate
      WHERE region_code = $1 AND effective_from <= $2::date
        AND (effective_to IS NULL OR effective_to >= $2::date)
      ORDER BY code, effective_from DESC`,
    [regionCode, date]
  );
  const list = rows
    .map(r => ({
      code: r.code,
      name: r.name,
      nameVi: r.name_vi,
      employee_rate: Number(r.employee_rate),
      company_rate: Number(r.company_rate),
      mode: r.mode || 'ratio',
      employee_fixed: Number(r.employee_fixed) || 0,
      company_fixed: Number(r.company_fixed) || 0,
      base_mode: r.base_mode || 'salary',
      cap_base: r.cap_base == null ? null : Number(r.cap_base),
      cap_note: r.cap_note,
      sort_order: Number(r.sort_order) || 0,
      active: r.active !== false
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  _rateCache = { at: now, key, rows: list };
  return list;
}

export function clearDeductionCache() { _rateCache = { at: 0, key: null, rows: null }; }

// ============================================================
// 二、个税上下文（开关 + 减除额 + 税率表 + 员工登记）
// ============================================================
export async function loadTaxContext(period) {
  // 月末日期必须按实际天数算：直接拼 '-31' 在 2/4/6/9/11 月会变成非法日期（22008）
  const [py, pm] = String(period).split('-').map(Number);
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const monthEnd = period + '-' + String(lastDay).padStart(2, '0');
  const cfgRows = await many(
    `SELECT key, value FROM sys_config WHERE key = ANY($1::text[])`,
    [['salary_pit_enabled', 'salary_pit_self_deduction', 'salary_pit_dependent_deduction',
      'salary_self_deduction', 'salary_dependent_deduction']]
  );
  const m = new Map(cfgRows.map(r => [r.key, r.value]));
  const pick = (a, b, dft) => {
    const v = m.get(a);
    if (v !== undefined && v !== null && String(v).trim() !== '') return Number(v);
    const w = m.get(b);
    if (w !== undefined && w !== null && String(w).trim() !== '') return Number(w);
    return dft;
  };
  const enabled = String(m.get('salary_pit_enabled') ?? 'true').toLowerCase() !== 'false';

  // 税率表：取不晚于当月末的最近一版
  const eff = await one(
    `SELECT MAX(effective_from) AS ef FROM salary_tax_bracket WHERE effective_from <= $1::date`,
    [monthEnd]
  );
  let brackets = [];
  if (eff && eff.ef) {
    const rows = await many(
      `SELECT seq, lower_bound, rate, quick_deduction FROM salary_tax_bracket
        WHERE effective_from = $1::date ORDER BY lower_bound`,
      [eff.ef]
    );
    brackets = rows.map(r => ({
      seq: Number(r.seq),
      lower: Number(r.lower_bound),
      rate: Number(r.rate),
      quick: Number(r.quick_deduction)
    }));
  }

  return {
    enabled,
    selfDeduction: pick('salary_pit_self_deduction', 'salary_self_deduction', 15500000),
    dependentDeduction: pick('salary_pit_dependent_deduction', 'salary_dependent_deduction', 6200000),
    brackets,
    bracketsEffectiveFrom: eff ? eff.ef : null
  };
}

/** 员工个税登记（生效期不晚于当月的最近一条）；无登记 = 0 抚养人、居民 */
export async function loadTaxProfile(userId, period) {
  const row = await one(
    `SELECT dependents, resident, tax_code, period_from
       FROM salary_tax_profile
      WHERE user_id = $1 AND period_from <= $2
      ORDER BY period_from DESC LIMIT 1`,
    [userId, period]
  );
  return {
    dependents: row ? Number(row.dependents) || 0 : 0,
    resident: row ? row.resident !== false : true,
    taxCode: row?.tax_code || null,
    registered: !!row,
    periodFrom: row?.period_from || null
  };
}

/** 员工入职日期（首月判定用） */
export async function loadHireDate(userId) {
  const row = await one(`SELECT hire_date FROM org_user WHERE id = $1`, [userId]);
  return row?.hire_date ? String(row.hire_date).slice(0, 10) : null;
}

/** 工会会员标志（决定工会费 27,000 是否扣）。无登记 = 非会员 */
export async function loadUnionMember(userId, period) {
  const row = await one(
    `SELECT union_member FROM salary_stat_profile
      WHERE user_id = $1 AND period_from <= $2
      ORDER BY period_from DESC LIMIT 1`,
    [userId, period]
  );
  return row ? row.union_member === true : false;
}

// ============================================================
// 三、待结清递延
// ============================================================
/** 取某员工在 beforePeriod 之前的全部 pending 递延（不含本期新增） */
export async function loadPendingDeferrals(userId, beforePeriod) {
  const rows = await many(
    `SELECT id, source_period, item_type, amount, status
       FROM payroll_deferral
      WHERE user_id = $1 AND status = 'pending' AND source_period < $2
      ORDER BY source_period, item_type`,
    [userId, beforePeriod]
  );
  return rows.map(r => ({
    id: Number(r.id),
    itemType: r.item_type,
    amount: Number(r.amount),
    sourcePeriod: r.source_period,
    status: r.status
  }));
}

// ============================================================
// 四、一次性算完「应发 → 扣款 → 实发」
// ============================================================
/**
 * @param {object} p
 *   @param {number} p.userId
 *   @param {string} p.period 'YYYY-MM'
 *   @param {number} p.G         月薪基数（社保基数就是它）
 *   @param {number} p.gross     应发
 *   @param {number} p.exemptIncome 免税加班收入
 *   @param {object} p.params    getParams() 的返回
 *   @param {object} [p.taxCtx]  可传入已加载的上下文（批量时复用，避免逐人查库）
 *   @param {object} [p.rates]
 *   @param {string|null} [p.hireDate]
 *   @param {boolean} [p.forceSettle=false] 离职月/终止月强制结清
 */
export async function computeDeductions({
  userId, period, G, gross, exemptIncome = 0, params = {},
  taxCtx = null, rates = null, hireDate = undefined, forceSettle = false
}) {
  const ctx = taxCtx || await loadTaxContext(period);
  const rateList = rates || await loadInsuranceRates(params.region_code || 'VN', period + '-01');
  const hire = hireDate === undefined ? await loadHireDate(userId) : hireDate;

  const warnings = [];
  const checks = [];

  // ---- 社保 / 工会费 ----
  // 工会费是定额（绝对值），是否扣按员工「工会会员」标志走；社保按比例。
  const minBase = Number(params.ins_min_base) || 0;
  const member = await loadUnionMember(userId, period);
  const ins = computeInsurance({ G, gross, rates: rateList, minBase, unionMember: member });
  warnings.push(...ins.warnings);

  // ---- 首月判定 ----
  const fm = resolveFirstMonth(hire, period);
  const mode = params.payroll_deferral_mode || 'defer';
  if (!hire) {
    checks.push({
      level: 'warn', code: 'HIRE_DATE_MISSING',
      message: '该员工未登记入职日期，无法判定「首月免扣」，本月按正常扣款处理。' +
        '若此人确实是新员工，请在花名册补入职日期后重算。'
    });
  }

  // ---- 个税 ----
  const prof = await loadTaxProfile(userId, period);
  const deductExempt = String(params.payroll_pit_exempt_deduct ?? 'true').toLowerCase() !== 'false';
  const pit = ctx.enabled
    ? computePit({
        gross,
        exemptIncome,
        insurance: ins.insurance.employee,
        unionFee: ins.union.employee,
        dependents: prof.dependents,
        resident: prof.resident,
        selfDeduction: ctx.selfDeduction,
        dependentDeduction: ctx.dependentDeduction,
        brackets: ctx.brackets,
        deductExempt
      })
    : { pit: 0, taxableIncome: 0, deduction: 0, bracket: null, level: null, detail: { disabled: true } };

  if (ctx.enabled && !ctx.brackets.length) {
    checks.push({ level: 'warn', code: 'NO_TAX_BRACKET', message: '税率表为空，个税按 0 计。' });
  }
  if (!prof.registered) {
    checks.push({
      level: 'info', code: 'NO_TAX_PROFILE',
      message: '未登记个税抚养人数，按 0 人计算（可能多扣税）。'
    });
  }

  // ---- 递延 ----
  const pending = await loadPendingDeferrals(userId, period);
  const plan = planDeferral({
    firstMonth: fm.firstMonth && !forceSettle,
    mode,
    insurance: ins.insurance.employee,
    unionFee: ins.union.employee,
    pit: pit.pit,
    pending
  });

  // ---- 实发 ----
  const net = computeNetPay({
    gross,
    insurance: plan.chargeInsurance,
    unionFee: plan.chargeUnion,
    pitPaid: plan.chargePit,
    deferIn: plan.deferIn,
    unit: Number(params.payroll_net_round) || 1
  });

  // 递延余额：历史 pending − 本期结清
  const pendingTotal = round(pending.reduce((a, x) => a + x.amount, 0), 2);
  const balance = round(pendingTotal - plan.settle.reduce((a, x) => a + x.amount, 0) + plan.deferOut, 2);

  const employerCost = round(
    gross + ins.insurance.company, 2
  );

  return {
    insurance: {
      base: ins.base,
      employee: ins.insurance.employee,
      company: ins.insurance.company,
      items: ins.items,
      capped: ins.items.filter(x => x.capped).map(x => x.code),
      warnings: ins.warnings
    },
    union: { employee: ins.union.employee, items: ins.union.items },
    pit: {
      amount: pit.pit,
      taxableIncome: pit.taxableIncome,
      deduction: pit.deduction,
      level: pit.level,
      rate: pit.detail?.rate ?? null,
      detail: pit.detail,
      enabled: ctx.enabled,
      deductExempt,
      dependents: prof.dependents,
      resident: prof.resident,
      registered: prof.registered,
      bracketsMissing: !ctx.brackets.length,
      bracketsEffectiveFrom: ctx.bracketsEffectiveFrom
    },
    deferral: {
      firstMonth: fm.firstMonth,
      firstMonthReason: fm.reason,
      hireDate: hire,
      mode,
      plan: {
        chargeInsurance: plan.chargeInsurance,
        chargeUnion: plan.chargeUnion,
        chargePit: plan.chargePit,
        deferIn: plan.deferIn,
        deferOut: plan.deferOut,
        totalCashDeduct: plan.totalCashDeduct
      },
      newDeferral: plan.newDeferral,
      settle: plan.settle,
      pendingTotal,
      balance,
      notes: plan.notes
    },
    net,
    employerCost,
    taxCtx: { enabled: ctx.enabled, selfDeduction: ctx.selfDeduction, dependentDeduction: ctx.dependentDeduction, brackets: ctx.brackets.length },
    checks
  };
}
