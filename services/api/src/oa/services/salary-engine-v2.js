/**
 * 计薪引擎 v2（月薪制 + 十段倍率）
 * ------------------------------------------------------------
 * 核心公式（方案 v1.4 §5.3）：
 *
 *   G = 基本工资 + 岗位津贴（in_hourly_base 的项目）
 *   H = G ÷ 208
 *   B = 当月应出勤正班工时（日历 workday × 8h，按需封顶）
 *   W = Σ(各段计薪工时 × 采用倍率) + 带薪假补记
 *   应发 = G + H × (W − B) + 不计时津贴
 *
 * 与 v1 的区别：
 *   · 不再有 absent / late_early 独立扣款项 —— 缺勤让 W−B 自然为负
 *   · 时薪分母固定 208，不随月份工作日数浮动
 *   · B 取「应出勤」而非「实际出勤」，所以短月照发、长月不白送
 *
 * 本模块只计算，不落库；落库由调用方决定（预演 → 确认 → 写 salary_record）。
 */
import { query, one } from '../db/index.js';
import { computeMonthSalary, computeQuota, computeExemptIncome, round } from '../lib/payroll-core.js';
import { computeMonthSheet, loadBandSet } from './attendance-band.js';
import { computeDeductions } from './payroll-deduction.js';

// ============================================================
// 一、取参数
// ============================================================
export async function getParams(regionCode = 'VN', date = new Date().toISOString().slice(0, 10)) {
  const rows = await query(
    `SELECT DISTINCT ON (param_key) param_key, param_value, value_type, label
       FROM salary_param
      WHERE region_code = $1 AND effective_from <= $2::date
        AND (effective_to IS NULL OR effective_to >= $2::date)
      ORDER BY param_key, effective_from DESC`,
    [regionCode, date]
  ).then(r => r.rows);

  const out = {};
  for (const r of rows) {
    out[r.param_key] = r.value_type === 'number'
      ? (r.param_value === '' || r.param_value === null ? null : Number(r.param_value))
      : r.param_value;
  }
  return out;
}

// ============================================================
// 二、取工资结构
// ============================================================
/**
 * 解析某用户某期生效的工资结构。
 * 顺序：员工个人结构（status=approved）→ 职类模板（class_id）→ 报错
 */
export async function resolveStructure(userId, period) {
  const firstDay = period + '-01';

  let s = await one(
    `SELECT s.*, u.real_name AS user_name
       FROM salary_structure s
       LEFT JOIN org_user u ON u.id = s.user_id
      WHERE s.user_id = $1
        AND s.status IN ('approved','active')
        AND (s.effective_from IS NULL OR s.effective_from <= $2::date)
      ORDER BY s.effective_from DESC NULLS LAST, s.version DESC
      LIMIT 1`,
    [userId, firstDay]
  );

  if (!s) {
    const u = await one(`SELECT salary_class_id, real_name FROM org_user WHERE id = $1`, [userId]);
    if (!u) throw new Error('员工不存在：' + userId);
    if (u.salary_class_id) {
      s = await one(
        `SELECT s.*, NULL::text AS user_name
           FROM salary_structure s
          WHERE s.class_id = $1 AND s.user_id IS NULL AND s.status IN ('approved','active')
          ORDER BY s.version DESC LIMIT 1`,
        [u.salary_class_id]
      );
      if (s) s._fromClass = true;
    }
    if (!s) {
      throw new Error(u.real_name + ' 没有可用的工资结构：既没有个人结构，职类也未分配模板。' +
        '需要 HR 先填好工资结构金额并审批，再分配到职类或工号。');
    }
  }

  const lines = await query(
    `SELECT seq, code, name, name_vi, category, calc_mode, value, config
       FROM salary_structure_line WHERE structure_id = $1 ORDER BY seq`,
    [s.id]
  ).then(r => r.rows);

  // G 的构成：优先用 in_hourly_base 标记；未标则退化为「基本工资 + 岗位津贴」
  let inBase = lines.filter(l => l.config && l.config.in_hourly_base === true);
  if (!inBase.length) {
    inBase = lines.filter(l => ['base', 'post_allowance', 'position'].includes(l.category) ||
      ['base', 'post'].includes(l.code));
  }
  const G = inBase.reduce((a, l) => a + Number(l.value || 0), 0) ||
    (Number(s.base_salary || 0) + Number(s.post_allowance || 0));

  const fixedAllowance = lines
    .filter(l => ['earning', 'allowance'].includes(l.category) &&
      l.calc_mode === 'fixed' &&
      !(l.config && l.config.in_hourly_base === true) &&
      !(l.config && l.config.prorate_by_attendance === true))
    .reduce((a, l) => a + Number(l.value || 0), 0);

  return {
    structureId: s.id,
    userId: s.user_id,
    classId: s.class_id,
    schemeId: s.scheme_id ? Number(s.scheme_id) : null,
    version: s.version,
    status: s.status,
    fromClass: !!s._fromClass,
    currency: s.currency || 'VND',
    baseSalary: Number(s.base_salary || 0),
    postAllowance: Number(s.post_allowance || 0),
    G: round(G, 2),
    fixedAllowance: round(fixedAllowance, 2),
    lines
  };
}

// ============================================================
// 三、生成工资单（只算不写）
// ============================================================
/**
 * @param {object} p
 *   @param {number} p.userId
 *   @param {string} p.period   'YYYY-MM'
 *   @param {Array}  p.punches  [{ workDate, checkIn, checkOut, dayKind?, shiftCode?, lateMinutes?, earlyMinutes? }]
 *   @param {number} [p.paidLeaveDays]
 *   @param {number} [p.manualG]   手工指定 G（试算用，跳过结构解析）
 *   @param {string} [p.shiftCode] 排班班次（day 白班 08:00-20:00 / night 夜班 20:00-08:00）。
 *                                 **只有传了才做迟到早退惩罚**——没有排班就不能认定"早退"，
 *                                 否则只排 8 小时的人会被倒扣 3 小时加班。
 *   @param {boolean} [p.forceSettle] 离职月/终止月强制结清全部递延
 *   @param {boolean} [p.skipDeduction] 只算应发，不跑社保/个税/递延（试算对比用）
 */
export async function computePayslip({
  userId, period, punches = [], paidLeaveDays = 0, manualG = null, bandSetId = null,
  shiftCode = null, shiftType = null, forceSettle = false, skipDeduction = false,
  hireDate = undefined, taxCtx = null, rates = null, paramsOverride = null
}) {
  const params = { ...(await getParams()), ...(paramsOverride || {}) };
  const denom = params.hourly_denominator || 208;
  const cap = params.quota_cap_hours ?? null;
  const exemptMode = params.exempt_mode || 'B';

  let structure = null;
  let G, allowance;
  if (manualG != null) {
    G = Number(manualG);
    allowance = 0;
  } else {
    structure = await resolveStructure(userId, period);
    G = structure.G;
    allowance = structure.fixedAllowance;
  }

  const checks = [];
  const minMonthly = params.min_wage_monthly;
  if (minMonthly && G < minMonthly) {
    checks.push({
      level: 'error', code: 'MIN_WAGE',
      message: '月薪基数 G = ' + Math.round(G).toLocaleString('en-US') +
        ' 低于公司最低工资 ' + Math.round(minMonthly).toLocaleString('en-US') +
        '，不允许计薪。请先调整工资结构。'
    });
  }
  if (!G) {
    checks.push({
      level: 'error', code: 'NO_BASE',
      message: '工资结构里的基本工资 + 岗位津贴为 0，无法计薪。HR 需要先填金额并审批。'
    });
  }

  const sheet = await computeMonthSheet({
    userId, period, punches, paidLeaveDays, quotaCapHours: cap, bandSetId, exemptMode,
    shiftCode, shiftType
  });

  const pay = computeMonthSalary({
    G, B: sheet.B, W: sheet.W,
    paidLeaveHours: sheet.paidLeaveHours,
    allowance,
    hourlyDenominator: denom
  });

  const exempt = computeExemptIncome({
    H: pay.hourRate, exemptHours: sheet.exemptHours, deltaPay: pay.deltaPay
  });

  // ---------------- 扣款链（社保 / 工会费 / 个税 / 首月递延） ----------------
  // 只算不写库：递延台账的落库由 payroll-service 在「确认批次」时做，
  // 否则试算一次就会污染台账。
  let ded = null;
  if (!skipDeduction) {
    ded = await computeDeductions({
      userId, period,
      G: G,
      gross: pay.gross,
      exemptIncome: exempt.exemptIncome,
      params,
      taxCtx, rates, hireDate, forceSettle
    });
  }

  return {
    userId,
    period,
    structure,
    params: {
      hourlyDenominator: denom,
      quotaCapHours: cap,
      exemptMode,
      minWageMonthly: minMonthly,
      otCapMonth: params.ot_cap_month,
      otCapYear: params.ot_cap_year
    },
    attendance: {
      workdaysInCalendar: sheet.calendar.workdays,
      attendDays: sheet.attendDays,
      blockedDays: sheet.blockedDays,
      blocked: sheet.blocked,
      payableHours: sheet.payableHours,
      convertedHours: sheet.W,
      naturalConvertedHours: sheet.naturalW,
      penaltyDeductHours: sheet.penaltyDeduct,
      punctuality: sheet.punctuality,
      paidLeaveHours: sheet.paidLeaveHours,
      otHours: sheet.otHours,
      exemptHours: sheet.exemptHours,
      uncoveredMinutes: sheet.uncoveredMinutes,
      bands: sheet.bands
    },
    pay,
    exempt,
    deductions: ded ? {
      insurance: ded.insurance,
      union: ded.union,
      pit: ded.pit,
      deferral: ded.deferral,
      employerCost: ded.employerCost,
      taxCtx: ded.taxCtx
    } : null,
    net: ded ? ded.net : null,
    checks,
    warnings: [...ded ? ded.checks : [], ...buildWarnings({ sheet, pay, params, checks })]
  };
}

// ============================================================
// 四、告警
// ============================================================
function buildWarnings({ sheet, pay, params, checks }) {
  const out = [...checks];
  const num = n => Math.round(n).toLocaleString('en-US');

  if (sheet.blockedDays > 0) {
    out.push({
      level: 'error', code: 'BLOCKED',
      message: '有 ' + sheet.blockedDays + ' 天无法计算（日历缺失或打卡异常）。' +
        '这 ' + sheet.blockedDays + ' 天不计薪，必须先补录再算。'
    });
  }

  if (sheet.uncoveredMinutes > 0) {
    out.push({
      level: 'warn', code: 'UNCOVERED',
      message: '有 ' + (sheet.uncoveredMinutes / 60).toFixed(2) + ' 小时落在任何计薪时段之外，' +
        '不会计薪。请检查时段表是否有空档（如 04:30–05:00 之外）。'
    });
  }

  if (pay.deltaHours < 0) {
    out.push({
      level: 'info', code: 'ABSENCE',
      message: '折算工时比应出勤少 ' + Math.abs(pay.deltaHours).toFixed(2) + ' 小时，' +
        '自动扣减 ' + num(Math.abs(pay.deltaPay)) + ' 越盾。月薪制下缺勤不需要单独的扣款项。'
    });
  }

  const monthCap = params.ot_cap_month;
  if (monthCap && sheet.otHours > monthCap) {
    out.push({
      level: 'warn', code: 'OT_MONTH_CAP',
      message: '本月加班 ' + sheet.otHours.toFixed(1) + ' 小时，超过上限 ' + monthCap + ' 小时（劳动法第 107 条）。'
    });
  }

  if (sheet.paidLeaveHours > 0) {
    out.push({
      level: 'info', code: 'PAID_LEAVE',
      message: '带薪假 ' + (sheet.paidLeaveHours / 8).toFixed(1) + ' 天已按 1.0 倍补记 ' +
        sheet.paidLeaveHours.toFixed(1) + ' 小时，不扣钱。'
    });
  }

  if (pay.deltaHours === 0) {
    out.push({ level: 'ok', code: 'EXACT', message: '折算工时等于应出勤，实发等于月薪基数。' });
  }

  return out;
}

export { loadBandSet };
