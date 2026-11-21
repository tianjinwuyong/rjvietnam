/**
 * 计薪引擎 v3 —— 按 SRS V1.0（2026-10-27）十步公式链实现
 * ============================================================
 * 与 v2 的差别（v2 冻结，保留用于双轨对账）：
 *   · 计时制：应发 = 工时工资 + 带薪假工资 + 补贴 − 无薪扣减
 *     （v2 是月薪制 G + H×(W−B) + 津贴）
 *   · 三套计薪基数：normal / overtime / holiday 各自一套工资项组合，
 *     分别算时薪（SRS 4.1 / FR-PAY-02）。v2 只有一个 in_hourly_base 布尔位。
 *   · 试用期 85%：试用期与正式期小时数分列后再打折（SRS 4.3(4)），
 *     不允许合并后统一打折。
 *   · 补贴项按模式自动算：定额 / 按天折 / 按班次 / 按小时 / 全勤分档 / 工龄分档 /
 *     导入（SRS 4.5 / FR-ALL-01~04）。
 *   · 工会费 27,000/人/月 按会员标志（SRS 4.6），不再按 1% 基数。
 *   · 舍入：工资项到百位、实发到千位，同时保留未舍入值（SRS 4.5）。
 *   · 加班小时按「计薪工时 − 8 × 平日出勤天数」（SRS FR-ATT-08），
 *     不再把 ④~⑩ 的工时直接累加。
 *
 * 本模块只计算不落库；落库由 payroll-service 决定。
 */
import { query, many, one, transaction } from '../db/index.js';
import { round } from '../lib/payroll-core.js';
import { computeMonthSheet, loadBandSet } from './attendance-band.js';
import { getParams, resolveStructure } from './salary-engine-v2.js';
import {
  loadInsuranceRates, loadTaxContext, loadTaxProfile, loadHireDate, loadPendingDeferrals
} from './payroll-deduction.js';
import {
  computeInsurance, computePit, planDeferral, computeNetPay, roundMoney, resolveFirstMonth
} from '../lib/payroll-deduction.js';
import {
  roundStep, buildHourRates, accumulateByPurpose, computeTimeRatePay,
  computeExemptByPurpose, computeOtHours, checkDeductionCap
} from '../lib/payroll-time-rate.js';
import { loadMonthLeave } from './leave-type.js';

export const ENGINE_VERSION = 'v3.0.0';

// ============================================================
// 一、计薪方案
// ============================================================
export async function listSchemes({ status = null } = {}) {
  const rows = await many(
    `SELECT s.*, 
            (SELECT count(*) FROM salary_base_purpose p WHERE p.scheme_id = s.id) AS purpose_count
       FROM salary_base_scheme s
      ${status ? 'WHERE s.status = $1' : ''}
      ORDER BY s.status, s.code`,
    status ? [status] : []
  );
  return rows.map(mapScheme);
}

function mapScheme(r) {
  return {
    id: Number(r.id),
    code: r.code,
    name: r.name,
    nameVi: r.name_vi,
    regionCode: r.region_code,
    payMode: r.pay_mode,
    hourlyDenominator: Number(r.hourly_denominator),
    daysDenominator: Number(r.days_denominator),
    probationRate: Number(r.probation_rate),
    effectiveFrom: dt(r.effective_from),
    effectiveTo: r.effective_to ? dt(r.effective_to) : null,
    status: r.status,
    remark: r.remark,
    purposeCount: r.purpose_count != null ? Number(r.purpose_count) : undefined
  };
}

/** 取方案 + 用途 + 用途下的工资项 */
export async function getScheme(id) {
  const s = await one(`SELECT * FROM salary_base_scheme WHERE id = $1`, [id]);
  if (!s) throw Object.assign(new Error('计薪方案不存在：' + id), { statusCode: 404 });
  const ps = await many(
    `SELECT * FROM salary_base_purpose WHERE scheme_id = $1 ORDER BY sort_order, id`, [id]
  );
  const items = await many(
    `SELECT i.purpose_id, i.item_code, i.weight, it.name, it.name_vi, it.category, it.calc_mode
       FROM salary_base_purpose_item i
       LEFT JOIN salary_item it ON it.code = i.item_code
      WHERE i.purpose_id = ANY($1::bigint[])
      ORDER BY i.item_code`,
    [ps.length ? ps.map(p => p.id) : [0]]
  );
  const byPurpose = new Map();
  for (const it of items) {
    const k = Number(it.purpose_id);
    if (!byPurpose.has(k)) byPurpose.set(k, []);
    byPurpose.get(k).push({
      itemCode: it.item_code,
      weight: Number(it.weight),
      name: it.name,
      nameVi: it.name_vi,
      category: it.category,
      calcMode: it.calc_mode
    });
  }
  return {
    ...mapScheme(s),
    purposes: ps.map(p => ({
      id: Number(p.id),
      purpose: p.purpose,
      label: p.label,
      bandScope: p.band_scope,
      sortOrder: Number(p.sort_order),
      items: byPurpose.get(Number(p.id)) || []
    }))
  };
}

/**
 * 解析某员工当期应使用的方案。
 * 顺序：结构上绑定的 scheme_id → 员工统计属性的 default_scheme_id →
 *       人员类别（worker→VN_WORKER / staff、expat→VN_STAFF）→ 参数 pay_mode_default 不决定方案
 */
export async function resolveScheme({ structure, userId, period }) {
  let schemeId = structure?.schemeId || null;
  if (!schemeId) {
    const prof = await one(
      `SELECT default_scheme_id, employee_type FROM salary_stat_profile
        WHERE user_id = $1 AND period_from <= $2 ORDER BY period_from DESC LIMIT 1`,
      [userId, period]
    );
    schemeId = prof?.default_scheme_id || null;
    if (!schemeId) {
      const code = prof?.employee_type === 'worker' || !prof ? 'VN_WORKER' : 'VN_STAFF';
      const row = await one(
        `SELECT id FROM salary_base_scheme
          WHERE code = $1 AND status = 'published' ORDER BY effective_from DESC LIMIT 1`, [code]
      );
      schemeId = row?.id || null;
    }
  }
  if (!schemeId) {
    const row = await one(
      `SELECT id FROM salary_base_scheme WHERE status = 'published' ORDER BY id LIMIT 1`
    );
    schemeId = row?.id || null;
  }
  if (!schemeId) throw new Error('没有可用的计薪方案（salary_base_scheme 为空），无法按 SRS 口径计薪');
  return getScheme(schemeId);
}

/**
 * 保存计薪方案（含用途与用途下的工资项）。
 * 用途/工资项采用「整体替换」语义：传了 purposes 就以传入的为准，没传则原样保留。
 * 金额不在这里维护（金额永远在 salary_structure_line.value）。
 */
export async function saveScheme(data = {}, userId = null) {
  const id = data.id ? Number(data.id) : null;
  const code = String(data.code || '').trim().toUpperCase();
  if (!id && !code) throw Object.assign(new Error('缺少方案代码 code'), { statusCode: 400 });

  const payMode = data.payMode || 'time_rate';
  if (!['time_rate', 'monthly'].includes(payMode)) {
    throw Object.assign(new Error('pay_mode 只能是 time_rate / monthly'), { statusCode: 400 });
  }
  const denom = Number(data.hourlyDenominator) || 208;
  if (!(denom > 0)) throw Object.assign(new Error('计薪分母工时必须大于 0'), { statusCode: 400 });
  const prob = data.probationRate == null ? 0.85 : Number(data.probationRate);
  if (!(prob > 0 && prob <= 1.5)) {
    throw Object.assign(new Error('试用期系数应在 0~1.5 之间'), { statusCode: 400 });
  }

  const saved = await transaction(async client => {
    let row;
    if (id) {
      row = (await client.query(
        `UPDATE salary_base_scheme
            SET name = COALESCE($2, name), name_vi = COALESCE($3, name_vi),
                pay_mode = $4, hourly_denominator = $5, days_denominator = $6,
                probation_rate = $7, effective_from = COALESCE($8::date, effective_from),
                effective_to = $9::date, status = COALESCE($10, status),
                remark = $11, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, data.name || null, data.nameVi || null, payMode, denom,
          Number(data.daysDenominator) || 26, prob, data.effectiveFrom || null,
          data.effectiveTo || null, data.status || null, data.remark || null]
      )).rows[0];
      if (!row) throw Object.assign(new Error('计薪方案不存在：' + id), { statusCode: 404 });
    } else {
      row = (await client.query(
        `INSERT INTO salary_base_scheme
           (code, name, name_vi, region_code, pay_mode, hourly_denominator, days_denominator,
            probation_rate, effective_from, effective_to, status, remark)
         VALUES ($1,$2,$3,'VN',$4,$5,$6,$7,COALESCE($8::date, DATE '2026-01-01'),$9::date,COALESCE($10,'published'),$11)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, name_vi = EXCLUDED.name_vi, pay_mode = EXCLUDED.pay_mode,
           hourly_denominator = EXCLUDED.hourly_denominator, days_denominator = EXCLUDED.days_denominator,
           probation_rate = EXCLUDED.probation_rate, effective_to = EXCLUDED.effective_to,
           status = EXCLUDED.status, remark = EXCLUDED.remark, updated_at = now()
         RETURNING *`,
        [code, data.name || code, data.nameVi || null, payMode, denom,
          Number(data.daysDenominator) || 26, prob, data.effectiveFrom || null,
          data.effectiveTo || null, data.status || null, data.remark || null]
      )).rows[0];
    }

    if (Array.isArray(data.purposes)) {
      for (const p of data.purposes) {
        const purpose = String(p.purpose || '').toLowerCase();
        if (!['normal', 'overtime', 'holiday', 'severance'].includes(purpose)) {
          throw Object.assign(new Error('基数用途不合法：' + p.purpose), { statusCode: 400 });
        }
        const pr = (await client.query(
          `INSERT INTO salary_base_purpose (scheme_id, purpose, label, band_scope, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (scheme_id, purpose) DO UPDATE
             SET label = EXCLUDED.label, band_scope = EXCLUDED.band_scope, sort_order = EXCLUDED.sort_order
           RETURNING id`,
          [row.id, purpose, p.label || purpose, p.bandScope || purpose,
            Number(p.sortOrder) || (purpose === 'normal' ? 10 : purpose === 'overtime' ? 20 : 30)]
        )).rows[0];

        const items = Array.isArray(p.items) ? p.items : [];
        await client.query(`DELETE FROM salary_base_purpose_item WHERE purpose_id = $1`, [pr.id]);
        for (const it of items) {
          const code2 = String(it.itemCode || it.item_code || '').trim();
          if (!code2) continue;
          await client.query(
            `INSERT INTO salary_base_purpose_item (purpose_id, item_code, weight)
             VALUES ($1,$2,$3) ON CONFLICT (purpose_id, item_code) DO UPDATE SET weight = EXCLUDED.weight`,
            [pr.id, code2, Number(it.weight) > 0 ? Number(it.weight) : 1]
          );
        }
      }
    }
    return row;
  });

  return getScheme(saved.id);
}

/** 员工计薪统计属性（参保状态 / 未参保原因 / 工会会员 / 人员类别 / 试用期） */
export async function listStatProfiles({ period = null, keyword = null } = {}) {
  // 参数一律按实际出现顺序编号：period 缺省时不能留下未使用的 $1（PG 会报「无法确定参数类型」）
  const args = [];
  let periodCond = '';
  if (period) { args.push(period); periodCond = `AND sp.period_from <= $${args.length}`; }
  let kwCond = '';
  if (keyword) {
    args.push(keyword);
    kwCond = `AND (u.real_name ILIKE '%'||$${args.length}||'%' OR COALESCE(u.employee_no,'') ILIKE '%'||$${args.length}||'%')`;
  }
  const rows = await many(
    `SELECT u.id AS user_id, u.real_name, u.employee_no, d.name AS dept_name,
            p.id AS profile_id, p.period_from, p.employee_type, p.insured, p.uninsured_reason,
            p.union_member, p.probation_days, p.probation_end, p.default_scheme_id,
            u.hire_date
       FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN LATERAL (
         SELECT * FROM salary_stat_profile sp
          WHERE sp.user_id = u.id ${periodCond}
          ORDER BY sp.period_from DESC LIMIT 1
       ) p ON TRUE
      WHERE u.active = TRUE
        AND COALESCE(u.is_system, FALSE) = FALSE
        ${kwCond}
      ORDER BY u.employee_no NULLS LAST, u.id`,
    args
  );
  return rows.map(r => ({
    userId: Number(r.user_id),
    realName: r.real_name,
    employeeNo: r.employee_no,
    deptName: r.dept_name,
    hireDate: r.hire_date ? dt(r.hire_date) : null,
    profileId: r.profile_id ? Number(r.profile_id) : null,
    periodFrom: r.period_from,
    employeeType: r.employee_type || 'worker',
    insured: r.profile_id ? r.insured !== false : null,
    uninsuredReason: r.uninsured_reason,
    unionMember: r.union_member === true,
    probationDays: r.probation_days != null ? Number(r.probation_days) : null,
    probationEnd: r.probation_end ? dt(r.probation_end) : null,
    defaultSchemeId: r.default_scheme_id ? Number(r.default_scheme_id) : null,
    configured: !!r.profile_id
  }));
}

export async function saveStatProfile(data = {}, userId = null) {
  const uid = Number(data.userId);
  if (!uid) throw Object.assign(new Error('缺少 userId'), { statusCode: 400 });
  const periodFrom = String(data.periodFrom || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(periodFrom)) {
    throw Object.assign(new Error('periodFrom 格式应为 YYYY-MM'), { statusCode: 400 });
  }
  const type = data.employeeType || 'worker';
  if (!['worker', 'staff', 'expat'].includes(type)) {
    throw Object.assign(new Error('人员类别只能是 worker / staff / expat'), { statusCode: 400 });
  }
  const insured = data.insured !== false;
  const reason = data.uninsuredReason || null;
  if (!insured && !reason) {
    throw Object.assign(new Error('未参保必须选择原因（SRS FR-STAT-03）'), { statusCode: 400 });
  }
  const probationDays = data.probationDays == null || data.probationDays === ''
    ? null : Math.max(0, Math.trunc(Number(data.probationDays)));
  let probationEnd = data.probationEnd || null;
  if (!probationEnd && probationDays != null) {
    const hire = await one(`SELECT hire_date FROM org_user WHERE id = $1`, [uid]);
    if (hire?.hire_date) probationEnd = addDays(dt(hire.hire_date), probationDays);
  }

  await query(
    `INSERT INTO salary_stat_profile
       (user_id, period_from, employee_type, insured, uninsured_reason, union_member,
        probation_days, probation_end, default_scheme_id, remark, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id, period_from) DO UPDATE SET
       employee_type = EXCLUDED.employee_type, insured = EXCLUDED.insured,
       uninsured_reason = EXCLUDED.uninsured_reason, union_member = EXCLUDED.union_member,
       probation_days = EXCLUDED.probation_days, probation_end = EXCLUDED.probation_end,
       default_scheme_id = EXCLUDED.default_scheme_id, remark = EXCLUDED.remark`,
    [uid, periodFrom, type, insured, reason, data.unionMember === true,
      probationDays, probationEnd, data.defaultSchemeId ? Number(data.defaultSchemeId) : null,
      data.remark || null, userId]
  );
  // 同步到员工主表，供各处直接读
  await query(
    `UPDATE org_user SET probation_days = COALESCE($2, probation_days),
            probation_end = COALESCE($3::date, probation_end) WHERE id = $1`,
    [uid, probationDays, probationEnd]
  );
  const list = await listStatProfiles({ period: periodFrom });
  return list.find(x => x.userId === uid) || null;
}

/** 工龄津贴分档 */
export async function listSeniorityTiers() {
  const rows = await many(
    `SELECT * FROM salary_seniority_tier ORDER BY effective_from DESC, min_months`
  );
  return rows.map(r => ({
    id: Number(r.id),
    effectiveFrom: dt(r.effective_from),
    minMonths: Number(r.min_months),
    maxMonths: r.max_months == null ? null : Number(r.max_months),
    amount: Number(r.amount),
    remark: r.remark
  }));
}

/** 整体替换某生效日的工龄分档（分档数量少，整体替换比逐条 diff 更不容易出错） */
export async function saveSeniorityTiers({ effectiveFrom, tiers = [] }) {
  const ef = effectiveFrom || new Date().toISOString().slice(0, 10);
  await transaction(async client => {
    await client.query(`DELETE FROM salary_seniority_tier WHERE effective_from = $1::date`, [ef]);
    for (const t of tiers) {
      await client.query(
        `INSERT INTO salary_seniority_tier (effective_from, min_months, max_months, amount, remark)
         VALUES ($1::date,$2,$3,$4,$5)`,
        [ef, Math.max(0, Math.trunc(Number(t.minMonths) || 0)),
          t.maxMonths == null || t.maxMonths === '' ? null : Math.trunc(Number(t.maxMonths)),
          Number(t.amount) || 0, t.remark || null]
      );
    }
  });
  return listSeniorityTiers();
}

// ============================================================
// 二、员工计薪统计属性
// ============================================================
export async function loadStatProfile(userId, period) {
  const row = await one(
    `SELECT * FROM salary_stat_profile
      WHERE user_id = $1 AND period_from <= $2 ORDER BY period_from DESC LIMIT 1`,
    [userId, period]
  );
  const u = await one(
    `SELECT hire_date, probation_days, probation_end, salary_class_id FROM org_user WHERE id = $1`,
    [userId]
  );
  const hire = row?.probation_days != null || u?.probation_days != null
    ? (row?.probation_days ?? u?.probation_days)
    : null;
  let probationEnd = row?.probation_end ? dt(row.probation_end) : (u?.probation_end ? dt(u.probation_end) : null);
  if (!probationEnd && hire != null && u?.hire_date) {
    probationEnd = addDays(dt(u.hire_date), Number(hire) || 0);
  }
  return {
    employeeType: row?.employee_type || 'worker',
    insured: row ? row.insured !== false : true,
    uninsuredReason: row?.uninsured_reason || null,
    unionMember: row ? row.union_member === true : false,
    probationDays: hire != null ? Number(hire) : null,
    probationEnd,
    defaultSchemeId: row?.default_scheme_id ? Number(row.default_scheme_id) : null,
    registered: !!row
  };
}

/** 工龄津贴分档（月数，含首不含尾） */
export async function seniorityAmount(userId, period, tiers = null) {
  const list = tiers || await many(
    `SELECT min_months, max_months, amount FROM salary_seniority_tier
      WHERE effective_from <= $1::date ORDER BY min_months DESC`,
    [periodEnd(period)]
  );
  if (!list.length) return { amount: 0, months: null, tier: null, missing: true };
  const u = await one(`SELECT hire_date FROM org_user WHERE id = $1`, [userId]);
  if (!u?.hire_date) return { amount: 0, months: null, tier: null, missing: false, noHireDate: true };
  const months = monthsBetween(dt(u.hire_date), periodEnd(period));
  for (const t of list) {
    const min = Number(t.min_months);
    const max = t.max_months == null ? null : Number(t.max_months);
    if (months >= min && (max == null || months < max)) {
      return { amount: Number(t.amount) || 0, months, tier: { min, max } };
    }
  }
  return { amount: 0, months, tier: null };
}

// ============================================================
// 三、补贴 / 扣款项（按 calc_mode 自动算）
// ============================================================
/**
 * @param {object} p
 *   @param {Array}  p.lines        结构明细（含 code/value/config）
 *   @param {object} p.ctx          { attendDays, expectedDays, nightShifts, payableHours, convertedHours,
 *                                    absentHours, baseAmount, userId, period }
 * @returns {Array} [{ code, name, mode, amount, qty, note }]
 */
export async function computeAllowanceItems({ lines = [], ctx = {} }) {
  const out = [];
  const tiers = await many(
    `SELECT min_months, max_months, amount FROM salary_seniority_tier
      WHERE effective_from <= $1::date ORDER BY min_months DESC`,
    [periodEnd(ctx.period)]
  );
  const sen = ctx.userId ? await seniorityAmount(ctx.userId, ctx.period, tiers) : { amount: 0 };

  for (const l of lines) {
    const cat = l.category || l.item_category;
    if (!['earning', 'allowance'].includes(cat)) continue;
    const cfg = l.config || {};
    if (cfg.legacy === true) continue;
    if (cfg.in_hourly_base === true) continue;       // 已进基数，不重复发
    if (cat === 'ot') continue;
    const value = Number(l.value) || 0;
    const mode = l.calc_mode || 'fixed';
    const row = { code: l.code, name: l.name, mode, amount: 0, qty: null, note: null };

    switch (mode) {
      case 'fixed':
        row.amount = value;
        break;
      case 'per_day': {
        // 按天折算（Excel 口径）：金额 ÷ 计薪天数分母 × 算考勤天数
        //   Excel：=600000/26*Z（Z = 算考勤天数，含年假/婚丧假等豁免假）
        //   分母取计薪方案的 days_denominator（默认 26），不是当月日历工作日数
        //   —— 6 天工作制下 10 月有 27 个工作日，Excel 仍按 26 计，这里保持一致
        const denom = Number(ctx.daysDenominator) > 0 ? Number(ctx.daysDenominator) : 26;
        const rawDays = Number(
          ctx.attendDaysWithLeave != null ? ctx.attendDaysWithLeave : ctx.attendDays
        ) || 0;
        const days = Math.min(rawDays, denom);
        row.qty = round(days, 2);
        row.amount = value * days / denom;
        row.note = '按天折算 ' + fmt(value) + ' ÷ ' + denom + ' × ' + round(days, 2) + ' 天';
        break;
      }
      case 'prorate_attendance': {
        // 按应出勤比例折算：金额 ×（出勤天数 ÷ 日历应出勤天数）
        const expected = Number(ctx.expectedDays) || 0;
        const attend = Number(ctx.attendDaysWithLeave != null ? ctx.attendDaysWithLeave : ctx.attendDays) || 0;
        const ratio = expected > 0 ? Math.min(1, attend / expected) : 1;
        row.qty = round(ratio, 4);
        row.amount = value * ratio;
        row.note = '按出勤 ' + attend + '/' + expected + ' 天折算';
        break;
      }
      case 'per_shift': {
        const n = Number(ctx.nightShifts) || 0;
        row.qty = n;
        row.amount = value * n;
        row.note = '夜班 ' + n + ' 班 × ' + value;
        break;
      }
      case 'per_night': {
        // 按夜班天数（2026-10-28 口径）：一天只算一次，跨午夜归属起班日
        const n = Number(ctx.nightDays != null ? ctx.nightDays : ctx.nightShifts) || 0;
        row.qty = n;
        row.amount = value * n;
        row.note = '夜班 ' + n + ' 天 × ' + value;
        break;
      }
      case 'hour_rule': {
        // 工时比例阶梯（用户口径 2026-10-28 扩展：任意档位 + 任意比例）
        //   rule.tiers = [{ lt: 8, ratio: 1 }, { lt: 12, ratio: 0.5 }, { lt: 16, ratio: 0.1 }]
        //   → 工时 < 8h 发 100%；< 12h 发 50%；< 16h 发 10%；其余按 rule.fallback（默认 0%）
        //   metric = absent（看缺勤工时，越少越发，默认）| attendance（看出勤工时，越多越发）
        // 兼容旧配置：只有 fullBelow / noneFrom 时等价成 100% / 50% 两档 + 末尾 0%。
        const rule = (cfg.rule && typeof cfg.rule === 'object') ? cfg.rule : {};
        const metric = String(rule.metric || 'absent').toLowerCase();
        const h = metric === 'absent'
          ? (Number(ctx.absentHours) || 0)
          : (Number(ctx.payableHours) || 0);

        let tiers = Array.isArray(rule.tiers)
          ? rule.tiers
            .map(t => ({ lt: Number(t?.lt), ratio: normRatio(t?.ratio) }))
            .filter(t => Number.isFinite(t.lt) && t.lt >= 0)
            .sort((a, b) => a.lt - b.lt)
          : [];
        if (!tiers.length) {
          const fb = fin(rule.fullBelow, 8);
          const nf = fin(rule.noneFrom, fb * 2);
          tiers = [{ lt: fb, ratio: 1 }, { lt: nf, ratio: 0.5 }];
        }
        const fallback = rule.fallback != null ? normRatio(rule.fallback) : 0;

        // 命中的档位下标：-1 表示超出最后一档，走 fallback
        let hit = -1;
        let ratio = fallback;
        for (let i = 0; i < tiers.length; i++) {
          if (h < tiers[i].lt) { hit = i; ratio = tiers[i].ratio; break; }
        }
        const word = (r) => (r >= 1 ? '发全部' : (r <= 0 ? '不发' : '发 ' + Math.round(r * 10000) / 100 + '%'));
        const band = hit < 0
          ? '≥ ' + tiers[tiers.length - 1].lt + 'h'
          : (hit === 0 ? '< ' + tiers[0].lt + 'h' : tiers[hit - 1].lt + '~' + tiers[hit].lt + 'h');

        row.qty = round(h, 2);
        row.amount = value * ratio;
        row.rate = ratio;
        row.note = (metric === 'absent' ? '缺勤 ' : '出勤 ') + round(h, 2) + 'h → ' + band + ' ' + word(ratio);
        break;
      }
      case 'per_hour': {
        const h = Number(ctx.payableHours) || 0;
        row.qty = h;
        row.amount = value * h;
        break;
      }
      case 'full_attendance': {
        // 缺勤 <4h 扣 50%，≥4h 扣 100%（SRS 4.5）
        const absent = Number(ctx.absentHours) || 0;
        let ratio = 1;
        if (absent >= 4) ratio = 0;
        else if (absent > 0.0001) ratio = 0.5;
        row.qty = round(ratio, 4);
        row.amount = value * ratio;
        row.note = absent > 0.0001
          ? '缺勤 ' + round(absent, 1) + ' 小时 → 按 ' + Math.round(ratio * 100) + '% 计发'
          : '满勤';
        break;
      }
      case 'seniority_tier':
        if (sen.missing) {
          row.note = '工龄津贴分档表未配置（salary_seniority_tier），按 0 计';
        } else if (sen.noHireDate) {
          row.note = '未登记入职日期，无法判定工龄';
        } else {
          row.amount = sen.amount;
          row.qty = sen.months;
          row.note = '工龄 ' + sen.months + ' 个月';
        }
        break;
      case 'base_ratio':
        row.qty = value;
        row.amount = (Number(ctx.baseAmount) || 0) * value / 100;
        row.note = '基数 ' + value + '%';
        break;
      case 'perf_coef':
        row.qty = value;
        row.amount = (Number(ctx.baseAmount) || 0) * value / 100;
        break;
      case 'perf_abs':
        row.amount = value;
        break;
      case 'import':
        row.amount = 0;
        row.note = '需按人导入（本项在结构里不可填）';
        break;
      case 'manual':
        row.amount = value;
        row.note = '手工录入项';
        break;
      default:
        row.amount = value;
        break;
    }
    if (mode === 'full_attendance' && row.qty === 0 && !row.note) row.note = '全勤奖已全额扣除';
    out.push(row);
  }
  return out;
}

// ============================================================
// 四、主流程：单人单月工资单（只算不写库）
// ============================================================
/**
 * @param {object} p
 *   @param {number} p.userId
 *   @param {string} p.period 'YYYY-MM'
 *   @param {Array}  p.punches
 *   @param {number} [p.paidLeaveDays]
 *   @param {string} [p.engine] 'v3'（默认）| 'monthly' 用月薪制回退
 */
export async function computePayslipV3({
  userId, period, punches = [], paidLeaveDays = 0, bandSetId = null,
  shiftCode = null, shiftType = null, taxCtx = null, rates = null,
  hireDate = undefined, paramsOverride = null, skipDeduction = false,
  forceSettle = false, engine = 'v3', manualBases = null
}) {  const params = { ...(await getParams('VN', periodEnd(period))), ...(paramsOverride || {}) };

  // 系统/服务账号（admin、wms_bot 等）不是员工，禁止计薪。
  // 各处候选人清单已在 SQL 里排除，这里再挡一道：试算接口允许显式传 userId，
  // 否则管理员点一下就能给系统账号生成一张工资单（没有任何考勤，全是 0 也会出单）。
  const sysAcc = await one(
    `SELECT real_name, COALESCE(is_system, FALSE) AS is_system FROM org_user WHERE id = $1`,
    [userId]
  );
  if (sysAcc?.is_system) {
    throw Object.assign(
      new Error(`「${sysAcc.real_name || userId}」是系统账号，不参与工资核算`),
      { statusCode: 400 }
    );
  }
  const payMode = engine === 'monthly' ? 'monthly' : (params.pay_mode_default === 'monthly' ? 'monthly' : 'time_rate');

  // manualBases：试算时直接给基数（{ normal, overtime, holiday }），不读工资结构。
  // HR 在结构还没配好时也要能预演口径，否则「先配结构才能验证公式」会卡住上线。
  let structure = null;
  if (manualBases && (Number(manualBases.normal) || Number(manualBases.overtime))) {
    structure = {
      structureId: null, version: null, fromClass: false, classId: null,
      schemeId: manualBases.schemeId ? Number(manualBases.schemeId) : null,
      baseSalary: 0, postAllowance: 0, lines: [], manual: true
    };
  } else {
    structure = await resolveStructure(userId, period);
  }
  const scheme = await resolveScheme({ structure, userId, period });
  const profile = await loadStatProfile(userId, period);

  const denom = Number(scheme.hourlyDenominator) || Number(params.hourly_denominator) || 208;
  const rateDigits = intParam(params.round_rate_digits, 2);
  const hourDigits = intParam(params.round_hour_digits, 1);
  const itemDigits = intParam(params.round_item_digits, -2);
  const netDigits = intParam(params.round_net_digits, -3);
  const probationRate = Number(scheme.probationRate) || Number(params.probation_rate) || 0.85;
  const exemptMode = params.exempt_mode || 'B';

  // ---- 结构金额 → 工资项金额表（同一 code 取第一条非零） ----
  const amounts = amountsFromLines(structure);
  const bases = basesFromScheme(scheme, amounts, structure);
  if (manualBases) {
    for (const k of ['normal', 'overtime', 'holiday', 'severance']) {
      if (manualBases[k] != null && Number(manualBases[k]) > 0) bases[k] = Number(manualBases[k]);
    }
    bases.baseOnly = Number(manualBases.normal) || bases.normal;
  }
  const ratesByPurpose = buildHourRates(bases, denom, rateDigits);

  // ---- 考勤 ----
  const sheet = await computeMonthSheet({
    userId, period, punches, paidLeaveDays,
    quotaCapHours: params.quota_cap_hours ?? null,
    bandSetId, exemptMode, shiftCode, shiftType
  });

  const acc = accumulateByPurpose(sheet.days, { probationEnd: profile.probationEnd });
  if (payMode === 'monthly') {
    // 月薪制回退（等价 v2）：应发 = G + H×(W − B)，其中 G = H × 分母。
    // 于是「等效折算工时」= W + (分母 − B)，补到正常工时桶里即可用同一套公式算。
    const delta = round(denom - (Number(sheet.B) || 0), 3);
    acc.regular.normal.convertedHours = round(acc.regular.normal.convertedHours + delta, 3);
    acc.totals.convertedHours = round(acc.totals.convertedHours + delta, 3);
  }

  // ---- 夜班天数 / 班次数（夜班餐补用） ----
  // 2026-10-28 口径变更：夜班餐补由「按班次数」改成「按夜班天数」，
  // 所以这里同时算两个量，两套 calc_mode 都能跑（per_night / per_shift）。
  const nightStats = countNightStats(sheet.days);
  const nightShifts = nightStats.shifts;
  const nightDays = nightStats.days;

  // ---- 休假（越南口径字典）：带薪假 / 计入算考勤天数的豁免假 ----
  // 说明：带薪假与豁免口径都从 attendance_summary 按字典判定，调用方传的
  // paidLeaveDays 只作为「手工覆盖」——传了就以它为准（试算台造场景用）。
  const stdHoursPerDay = Number(params.std_hours_per_day) || 8;
  const leave = await loadMonthLeave({
    userId, period,
    stdHoursPerDay,
    calendarDays: sheet.calendar && sheet.calendar.ok ? sheet.calendar.days : null
  });
  const paidLeaveHours = Number(paidLeaveDays) > 0
    ? round(Number(paidLeaveDays) * stdHoursPerDay, 2)
    : leave.paidLeaveHours;

  // ---- 缺勤小时（全勤奖用）：应出勤 −（平日实际计薪工时 + 年假/婚丧假等豁免工时） ----
  const expectedDays = Number(sheet.calendar?.workdays) || 0;
  const expectedHours = expectedDays * stdHoursPerDay;
  const workdayPaid = accumulateWorkdayPaidHours(sheet.days);
  const absentHours = Math.max(0, expectedHours - workdayPaid - leave.exemptLeaveHours);

  // 「算考勤天数」= 平日实际出勤天数 + 豁免休假天数（Excel 的 Z 列口径）
  const attendDaysWithLeave = acc.totals.workdayAttendDays + leave.exemptDays;

  const allowanceRows = await computeAllowanceItems({
    lines: structure.lines,
    ctx: {
      userId, period,
      attendDays: acc.totals.workdayAttendDays,
      attendDaysWithLeave,
      expectedDays,
      daysDenominator: Number(scheme.daysDenominator) || Number(params.days_denominator) || 26,
      nightShifts,
      nightDays,
      payableHours: acc.totals.payableHours,
      convertedHours: acc.totals.convertedHours,
      absentHours,
      baseAmount: bases.normal
    }
  });

  const pay = computeTimeRatePay({
    rates: ratesByPurpose,
    acc,
    paidLeaveHours,
    allowances: allowanceRows,
    unpaidDeductions: [],
    probationRate,
    itemDigits
  });

  // 兼容字段：老界面（试算台/工资单）仍在读 G / hourRate / B / W / deltaPay / allowance，
  // 这里按 v2 的语义补齐，保证同一个 slip 既能按 SRS 解释，也不把老页面打空。
  pay.G = roundStep(bases.normal, 2);
  pay.hourRate = ratesByPurpose.normal.rate;
  pay.B = roundStep(sheet.B, 3);
  pay.W = roundStep(acc.totals.convertedHours, 3);
  pay.WActual = pay.W;
  pay.deltaHours = roundStep(acc.totals.convertedHours - sheet.B, 3);
  pay.deltaPay = roundStep(ratesByPurpose.normal.rate * pay.deltaHours, 2);
  pay.allowance = pay.allowanceTotal;
  pay.monthlyBase = pay.G;
  pay.dayRate = roundStep(ratesByPurpose.normal.rate * 8, 2);

  // ---- Step 6 免税 ----
  const exempt = computeExemptByPurpose({ rates: ratesByPurpose, acc, probationRate, cap: pay.gross });

  // ---- Step 7~10 扣款 ----
  let ded = null;
  if (!skipDeduction) {
    ded = await computeDeductionsV3({
      userId, period, pay, exemptIncome: exempt.exemptIncome, params,
      bases, profile, taxCtx, rates, hireDate, forceSettle, netDigits
    });
  }

  // ---- 补发 / 扣发（salary_adjust 电子流，税后加减）----
  // 用户口径 2026-10-28：工资核算完要留一个补发/扣发窗口，审批通过后并入当月工资。
  // 刻意不进入 gross / 社保基数 / 应税所得 —— 补发扣发是对「已经算完的工资」的修正，
  // 若参与基数重算，一条补发会连带改动上月已申报的社保与个税，财务口径会打架。
  const adjustments = await loadApprovedAdjustments(userId, period);
  const adjPay = round(adjustments.reduce((a, x) => a + (Number(x.payAmount) || 0), 0), 2);
  const adjDeduct = round(adjustments.reduce((a, x) => a + (Number(x.deductAmount) || 0), 0), 2);
  const adjNet = round(adjPay + adjDeduct, 2);
  if (ded && adjNet !== 0) {
    ded.net.net = round((Number(ded.net.net) || 0) + adjNet, 2);
    ded.net.netRaw = round((Number(ded.net.netRaw) || 0) + adjNet, 2);
    ded.net.adjustIn = adjPay;
    ded.net.adjustOut = adjDeduct;
  }

  // ---- 加班小时（SRS FR-ATT-08） ----
  const otSrs = computeOtHours({
    payableHours: acc.totals.payableHours,
    workdayAttendDays: acc.totals.workdayAttendDays,
    stdHoursPerDay: Number(params.std_hours_per_day) || 8
  });

  // ---- 校验（SRS 第 6 章） ----
  const checks = [];
  const minMonthly = Number(params.min_wage_monthly) || 0;
  const minHourly = Number(params.legal_min_wage_hourly) || 0;
  const gBase = bases.normal || 0;

  if (!gBase) {
    checks.push({ level: 'error', code: 'NO_BASE', message:
      '计薪基数（' + scheme.code + ' 的 normal 用途）为 0，无法计薪。请先填好工资结构金额并审批（SRS V-01）' });
  }
  if (minMonthly && gBase && gBase < minMonthly) {
    checks.push({ level: 'error', code: 'MIN_WAGE', message:
      '正常工时基数 ' + fmt(gBase) + ' 低于公司最低工资 ' + fmt(minMonthly) + '（SRS V-11）' });
  }
  if (minHourly && ratesByPurpose.normal.rate < minHourly) {
    checks.push({
      level: 'warn', code: 'MIN_HOURLY_WAGE_OD01',
      message: '折算时薪 ' + ratesByPurpose.normal.rate + ' 低于法定小时最低工资 ' + minHourly +
        '，差额 ' + round(minHourly - ratesByPurpose.normal.rate, 2) + '（SRS V-11 / OD-01 工厂工资分区待确认）'
    });
  }
  const monthCap = Number(params.ot_cap_month) || 40;
  if (otSrs.otHours > monthCap) {
    checks.push({ level: 'error', code: 'OT_MONTH_CAP', message:
      '本月加班 ' + otSrs.otHours.toFixed(1) + ' 小时，超过上限 ' + monthCap +
      ' 小时。需授权放行并留原因后才可封账（SRS V-09 / FR-SCH-04）' });
  }
  if (exempt.exemptIncome > pay.gross + 0.01) {
    checks.push({ level: 'error', code: 'EXEMPT_GT_GROSS', message: '免税收入大于应发工资（SRS V-15）' });
  }
  if (sheet.blockedDays > 0) {
    checks.push({ level: 'error', code: 'BLOCKED_DAYS', message:
      '有 ' + sheet.blockedDays + ' 天无法计算（日历缺失/打卡异常），这些天不计薪（SRS V-03）' });
  }
  if (!sheet.calendar?.ok) {
    checks.push({ level: 'warn', code: 'CALENDAR_MISSING', message:
      period + ' 的工作日历为空：按天折算的补贴与「应出勤」无法判定，全勤奖按满勤处理。' +
      '请在「工作日历」补齐当月设置（SRS FR-SCH-05）' });
  }
  if (sheet.uncoveredMinutes > 0) {
    checks.push({ level: 'warn', code: 'UNCOVERED', message:
      '有 ' + (sheet.uncoveredMinutes / 60).toFixed(2) + ' 小时落在计薪时段之外，未计薪' });
  }
  if (!profile.registered) {
    checks.push({ level: 'warn', code: 'NO_STAT_PROFILE', message:
      '未登记参保状态与未参保原因，月结前必须补齐（SRS V-04 / FR-STAT-03）' });
  } else if (!profile.insured && !profile.uninsuredReason) {
    checks.push({ level: 'error', code: 'NO_UNINSURED_REASON', message:
      '未参保但未填原因，阻断封账（SRS V-04）' });
  }
  if (structure.fromClass) {
    checks.push({ level: 'info', code: 'FROM_CLASS', message:
      '该员工没有个人工资结构，当前套用职类模板（' + (structure.classId || '-') + '）' });
  }
  if (leave.unknownTypes.length) {
    checks.push({ level: 'warn', code: 'LEAVE_TYPE_UNKNOWN', message:
      '休假类型 ' + leave.unknownTypes.join('、') + ' 不在字典（attendance_leave_type）中，' +
      '按「无薪、不计考勤」保守处理。请在休假类型字典补齐或改单（SRS FR-ATT-06）' });
  }
  for (const o of leave.overLimit) {
    checks.push({ level: 'warn', code: 'LEAVE_OVER_LIMIT', message:
      o.name + ' 本月 ' + o.days + ' 天，超过法定上限 ' + o.limit + ' 天（' + (o.legalBasis || '') + '）' });
  }
  // 年假等「按月累积」假别：本年度额度 / 已占用 / 剩余。
  // 超额正常不会出现（提交单据时已前置拦截，见 leave-balance.js），
  // 这里出现只可能是历史单据遗留（拦截上线前提交的）或字典额度被下调，
  // 因此按 warn 提示人工核对，不阻断计薪。
  for (const b of (leave.balances || [])) {
    if (b.accrued <= 0 && b.occupied <= 0) continue;
    const over = b.occupied > b.accrued + 1e-9;
    const accruedTxt = '已累积 ' + b.accrued + ' 天（' + b.fromDate + ' 起满 ' +
      b.monthsAccrued + ' 个自然月' + (b.cap != null ? '，年度上限 ' + b.cap + ' 天' : '') + '）';
    if (over) {
      checks.push({ level: 'warn', code: 'LEAVE_QUOTA_OVERDRAWN', message:
        b.name + '年度累计已休 ' + b.occupied + ' 天，超过' + accruedTxt +
        '，透支 ' + Number((b.occupied - b.accrued).toFixed(1)) + ' 天 —— ' +
        '该假不结转不可透支，请核对是否应改记其他假别' });
    } else if (b.occupied > 0) {
      checks.push({ level: 'info', code: 'LEAVE_QUOTA', message:
        b.name + '年度累计已休 ' + b.occupied + ' 天，' + accruedTxt + '，剩余 ' + b.remaining + ' 天' });
    }
  }
  if (leave.paidLeaveHours > 0) {
    checks.push({ level: 'info', code: 'PAID_LEAVE', message:
      '带薪假 ' + leave.paidLeaveHours.toFixed(1) + ' 小时（' +
      leave.byType.filter(x => x.payWage).map(x => x.name + x.days + '天').join('、') +
      '），按正常时薪计入应发' });
  }
  if (leave.exemptDays > 0) {
    checks.push({ level: 'info', code: 'ATTEND_EXEMPT', message:
      '豁免 ' + leave.exemptDays + ' 天（' +
      leave.byType.filter(x => x.countsAsAttendance).map(x => x.name + x.days + '天').join('、') +
      '）计入算考勤天数，不扣满勤奖' });
  }

  return {
    userId,
    period,
    engine: ENGINE_VERSION,
    payMode,
    scheme: {
      id: scheme.id, code: scheme.code, name: scheme.name,
      hourlyDenominator: denom, probationRate, payMode: scheme.payMode
    },
    structure: {
      manual: !!structure.manual,
      structureId: structure.structureId,
      version: structure.version,
      fromClass: structure.fromClass,
      classId: structure.classId,
      schemeId: structure.schemeId || null
    },
    profile,
    params: {
      hourlyDenominator: denom, probationRate, exemptMode, payMode,
      roundItemDigits: itemDigits, roundNetDigits: netDigits,
      roundHourDigits: hourDigits, roundRateDigits: rateDigits,
      minWageMonthly: minMonthly, legalMinHourly: minHourly,
      otCapMonth: monthCap, otCapYear: Number(params.ot_cap_year) || 200,
      unionFeeMode: params.union_fee_mode || 'fixed',
      unionFeeFixed: Number(params.union_fee_fixed) || 0,
      insBaseMode: params.ins_base_mode || 'base'
    },
    bases,
    hourRates: ratesByPurpose,
    attendance: {
      workdaysInCalendar: expectedDays,
      attendDays: acc.totals.workdayAttendDays,
      attendDaysWithLeave,
      totalAttendDays: acc.totals.attendDays,
      byDayKind: acc.totals.byDayKind,
      blockedDays: sheet.blockedDays,
      blocked: sheet.blocked,
      payableHours: roundStep(acc.totals.payableHours, hourDigits),
      convertedHours: roundStep(acc.totals.convertedHours, hourDigits),
      quotaHoursB: sheet.B,
      probationHours: acc.totals.probationHours,
      nightShifts,
      absentHours: round(absentHours, 1),
      paidLeaveHours: round(paidLeaveHours, 2),
      carriedHours: {
        normal: acc.regular.normal.convertedHours,
        overtime: acc.regular.overtime.convertedHours,
        holiday: acc.regular.holiday.convertedHours
      },
      probationConverted: {
        normal: acc.probation.normal.convertedHours,
        overtime: acc.probation.overtime.convertedHours,
        holiday: acc.probation.holiday.convertedHours
      },
      otHours: otSrs.otHours,
      otHoursByBand: round(sheet.otHours, 1),
      otFormula: otSrs,
      exemptHours: sheet.exemptHours,
      penaltyDeductHours: sheet.penaltyDeduct,
      punctuality: sheet.punctuality,
      uncoveredMinutes: sheet.uncoveredMinutes,
      bands: sheet.bands
    },
    leave: {
      source: 'attendance_leave_type',
      paidLeaveHours: leave.paidLeaveHours,
      paidLeaveDays: leave.paidLeaveDays,
      exemptLeaveHours: leave.exemptLeaveHours,
      exemptDays: leave.exemptDays,
      totalLeaveHours: leave.totalLeaveHours,
      byType: leave.byType,
      rows: leave.rows,
      unknownTypes: leave.unknownTypes,
      overLimit: leave.overLimit,
      balances: leave.balances || [],
      manualOverride: Number(paidLeaveDays) > 0
    },
    pay,
    exempt,
    deductions: ded ? {
      insurance: ded.insurance,
      union: ded.union,
      pit: ded.pit,
      deferral: ded.deferral,
      employerCost: ded.employerCost,
      cap: ded.cap,
      taxCtx: ded.taxCtx,
      gap: ded.gap,
      // 统一负数口径的扣款清单（供工资单 / 自助查询直接渲染）
      rows: ded.rows,
      total: ded.total
    } : null,
    // 补发 / 扣发（税后加减；不参与 gross / 社保 / 个税）
    adjustments: {
      pay: adjPay,
      deduct: adjDeduct,
      net: adjNet,
      items: adjustments
    },
    net: ded ? ded.net : null,
    checks,
    warnings: [...checks, ...(ded?.checks || [])]
  };
}

// ============================================================
// 五、v3 扣款链（社保 / 工会 / 个税 / 递延 / 限额）
// ============================================================
export async function computeDeductionsV3({
  userId, period, pay, exemptIncome, params, bases, profile,
  taxCtx = null, rates = null, hireDate = undefined, forceSettle = false, netDigits = -3,
  taxProfile = null
}) {
  const ctx = taxCtx || await loadTaxContext(period);
  const rateList = rates || await loadInsuranceRates('VN', period + '-01');
  const taxProf = taxProfile || await loadTaxProfile(userId, period);
  const hire = hireDate === undefined ? await loadHireDate(userId) : hireDate;
  const checks = [];
  const gross = pay.gross;

  // ---- 社保基数口径（SRS 4.6：现行仅取「底薪」） ----
  const baseMode = String(params.ins_base_mode || 'base').toLowerCase();
  const insBaseAmount = baseMode === 'gross'
    ? gross
    : (baseMode === 'g' ? Number(bases.normal) || 0 : Number(bases.baseOnly) || 0);
  const ins = computeInsurance({
    G: insBaseAmount, gross, rates: rateList, minBase: Number(params.ins_min_base) || 0,
    unionMember: profile.unionMember !== false
  });

  // 非居民不参加失业保险（SRS 4.6）：从费率表剔除 BHTN
  const isResident = taxProf.resident !== false;
  let insEmployee = ins.insurance.employee;
  let insCompany = ins.insurance.company;
  const insItems = ins.items.filter(x => x.kind === 'insurance').map(x => ({ ...x }));
  if (!isResident) {
    for (const it of insItems) {
      if (String(it.code).toLowerCase() === 'bhtn') {
        insCompany = round(insCompany - it.company, 2);
        insEmployee = round(insEmployee - it.employee, 2);
        it.employee = 0; it.company = 0; it.skipped = 'non_resident';
      }
    }
  }

  // ---- 工会费：绝对值（用户 2026-10-28） ----
  // 唯一真值：salary_insurance_rate 里 code='union' 的那一行（mode=fixed + employee_fixed），
  // 已按「会员标志」算好，这里不再乘任何比例。
  // 仅当费率表里没有工会费行时，才退回老参数 union_fee_fixed（保证老库不至于少扣）。
  const unionMode = String(params.union_fee_mode || 'fixed').toLowerCase();
  const hasUnionRate = rateList.some(r => String(r.code).toLowerCase() === 'union');
  let unionFee = round(ins.union.employee, 2);
  if (!hasUnionRate) {
    unionFee = (unionMode !== 'rate' && profile.unionMember)
      ? round(Number(params.union_fee_fixed) || 0, 2)
      : 0;
  }

  // ---- 个税 ----
  const pitDeductUnion = String(params.pit_deduct_union ?? 'false').toLowerCase() === 'true';
  const pit = ctx.enabled
    ? computePit({
      gross,
      exemptIncome,
      insurance: insEmployee,
      unionFee: pitDeductUnion ? unionFee : 0,
      dependents: taxProf.dependents,
      resident: isResident,
      selfDeduction: ctx.selfDeduction,
      dependentDeduction: ctx.dependentDeduction,
      brackets: ctx.brackets,
      deductExempt: true
    })
    : { pit: 0, taxableIncome: 0, deduction: 0, bracket: null, level: null, detail: { disabled: true } };

  if (ctx.enabled && !ctx.brackets.length) {
    checks.push({ level: 'warn', code: 'NO_TAX_BRACKET', message: '税率表为空，个税按 0 计（SRS 5.8）' });
  }

  // ---- 递延（首月免扣） ----
  const fm = resolveFirstMonth(hire, period);
  const pending = await loadPendingDeferrals(userId, period);
  const plan = planDeferral({
    firstMonth: fm.firstMonth && !forceSettle,
    mode: params.payroll_deferral_mode || 'defer',
    insurance: insEmployee,
    unionFee,
    pit: pit.pit,
    pending
  });
  const pendingTotal = round(pending.reduce((a, x) => a + x.amount, 0), 2);
  const settledTotal = round(plan.settle.reduce((a, x) => a + x.amount, 0), 2);
  const deferBalance = round(pendingTotal - settledTotal + plan.deferOut, 2);

  const net = computeNetPay({
    gross,
    insurance: plan.chargeInsurance,
    unionFee: plan.chargeUnion,
    pitPaid: plan.chargePit,
    deferIn: plan.deferIn,
    unit: Math.pow(10, netDigits < 0 ? -netDigits : 0)
  });

  // ---- 扣款限额（SRS FR-ALL-06 / V-13 / V-12） ----
  const totalDeduct = plan.totalCashDeduct;
  const capCheck = checkDeductionCap({
    gross,
    totalDeduction: totalDeduct,
    ratio: Number(params.deduct_cap_ratio) || 0.3,
    minWage: Number(params.min_wage_monthly) || 0
  });
  for (const m of capCheck.messages) {
    checks.push({ level: 'error', code: 'DEDUCT_CAP', message: m });
  }

  // ---- 应缴 vs 实缴基数缺口（SRS FR-STAT-01） ----
  const legalBase = Number(bases.normal) || 0;
  const gap = {
    legalBase: round(legalBase, 2),
    paidBase: round(ins.base, 2),
    gapAmount: round(Math.max(0, legalBase - ins.base), 2),
    multiple: Number(params.ins_cap_wage_multiple) || 20
  };

  return {
    insurance: {
      base: ins.base,
      baseMode,
      employee: round(insEmployee, 2),
      company: round(insCompany, 2),
      items: insItems,
      capped: insItems.filter(x => x.capped).map(x => x.code),
      warnings: ins.warnings
    },
    union: { employee: round(unionFee, 2), mode: unionMode, member: profile.unionMember },
    pit: {
      amount: pit.pit,
      taxableIncome: pit.taxableIncome,
      deduction: pit.deduction,
      level: pit.level,
      rate: pit.detail?.rate ?? null,
      detail: pit.detail,
      enabled: ctx.enabled,
      dependents: taxProf.dependents,
      resident: isResident,
      deductUnion: pitDeductUnion,
      bracketsEffectiveFrom: ctx.bracketsEffectiveFrom
    },
    deferral: {
      firstMonth: fm.firstMonth,
      firstMonthReason: fm.reason,
      hireDate: hire,
      mode: params.payroll_deferral_mode || 'defer',
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
      balance: deferBalance,
      notes: plan.notes
    },
    net,
    employerCost: round(gross + insCompany, 2),
    cap: capCheck,
    gap,
    taxCtx: { enabled: ctx.enabled, brackets: ctx.brackets.length },
    checks,
    // ------------------------------------------------------------
    // 扣款明细（统一负数口径，用户要求 2026-10-28）
    // 所有扣款项金额一律为负，前端直接展示，不需要再判断正负。
    // 等于 0 的项也保留（明确显示「本月扣 0」比整行消失更清楚）。
    // ------------------------------------------------------------
    rows: buildDeductionRows({
      insItems, insEmployee, unionFee, pit, deferIn: plan.deferIn, plan
    }),
    total: round(-(insEmployee + unionFee + plan.chargePit + plan.deferIn), 2)
  };
}

/** 扣款明细行（amount 为负数；扣 0 的项也列出） */
function buildDeductionRows({ insItems = [], insEmployee, unionFee, pit, deferIn, plan }) {
  const rows = [];
  for (const it of insItems) {
    if (it.skipped === 'non_resident') continue;   // 非居民不参失业保险，不占行
    rows.push({
      code: it.code, name: it.name || it.code,
      category: 'insurance',
      amount: round(-(Number(it.employee) || 0), 2),
      rate: it.rate == null ? null : Number(it.rate),
      note: it.capped ? '已封顶' : null
    });
  }
  // 若明细缺失（费率表为空），兜底给一行合计，避免扣款凭空消失
  if (!rows.length && Number(insEmployee) > 0) {
    rows.push({ code: 'insurance', name: '个人社保', category: 'insurance', amount: round(-Number(insEmployee), 2) });
  }
  rows.push({ code: 'union_fee', name: '工会费', category: 'union_fee', amount: round(-(Number(unionFee) || 0), 2) });
  rows.push({
    code: 'pit', name: '个人所得税', category: 'tax',
    amount: round(-(Number(pit?.pit) || 0), 2),
    note: pit?.level ? '第 ' + pit.level + ' 级' : (pit?.enabled === false ? '未启用个税' : null)
  });
  rows.push({
    code: 'defer_in', name: '结清上期递延', category: 'deferral',
    amount: round(-(Number(deferIn) || 0), 2),
    note: plan?.deferOut > 0 ? '本期向以后期间递延 ' + round(-Number(plan.deferOut), 2) : null
  });
  return rows;
}

// ============================================================
// 六、可用性自检（供 /api/payroll/srs-check 与验证脚本）
// ============================================================
export async function srsSelfCheck() {
  const out = { items: [], ok: true };
  const add = (name, actual, expected, ref, tol = 0.01) => {
    const pass = typeof expected === 'number'
      ? Math.abs(Number(actual) - expected) <= tol
      : String(actual) === String(expected);
    if (!pass) out.ok = false;
    out.items.push({ name, actual, expected, ref, pass });
  };

  // 1 工人时薪 = 5,300,000 ÷ 208
  const w = buildHourRates({ normal: 5300000 }, 208, 2);
  add('工人时薪（基本 5,300,000 ÷ 208）', w.normal.rate, 25480.77, 'SRS 4.1');

  // 2 干部 RJ001 三套基数示例
  const st = buildHourRates({ normal: 36000000, overtime: 18500000, holiday: 36000000 }, 208, 2);
  add('干部 RJ001 正常时薪（36,000,000 ÷ 208）', st.normal.rate, 173076.92, 'SRS 4.1');
  add('干部 RJ001 加班时薪（18,500,000 ÷ 208）', st.overtime.rate, 88942.31, 'SRS 4.1');

  // 3 采用倍率 = MAX(表内, 法定下限)
  const bands = await many(
    `SELECT b.code AS code, b.table_rate, b.legal_min_rate, b.adopted_rate
       FROM attendance_time_band b
       JOIN attendance_time_band_set st ON st.id = b.set_id
      WHERE st.status = 'published' ORDER BY b.seq`
  );
  const badRate = bands.filter(b => Math.abs(Number(b.adopted_rate) - Math.max(Number(b.table_rate), Number(b.legal_min_rate))) > 1e-9);
  add('采用倍率 = MAX(表内, 法定下限) 违例数', badRate.length, 0, 'SRS 4.2 / V-07');
  add('生效时段集段数', bands.length, 14, 'SRS 4.2（10 段 + 4 段补齐空档）', 0);

  // 4 舍入
  add('金额舍入到百位 ROUND(1234.56,-2)', roundStep(1234.56, -2), 1200, 'SRS 4.5');
  add('金额舍入到百位 ROUND(1250,-2)', roundStep(1250, -2), 1300, 'SRS 4.5');
  add('实发舍入到千位 ROUND(1407499666,-3)', roundStep(1407499666, -3), 1407500000, 'SRS 4.5');

  // 5 加班小时口径
  const ot = computeOtHours({ payableHours: 286, workdayAttendDays: 26, stdHoursPerDay: 8 });
  add('加班小时 = 286 − 8×26', ot.otHours, 78, 'SRS FR-ATT-08');

  // 6 个税（居民五级 / 非居民 20%）
  const brRows = await many(
    `SELECT seq, lower_bound, rate, quick_deduction FROM salary_tax_bracket
      WHERE effective_from = (SELECT MAX(effective_from) FROM salary_tax_bracket) ORDER BY lower_bound`
  );
  const brackets = brRows.map(r => ({ seq: Number(r.seq), lower: Number(r.lower_bound), rate: Number(r.rate), quick: Number(r.quick_deduction) }));
  const pitCase = computePit({
    gross: 30000000, exemptIncome: 0, insurance: 3150000, unionFee: 0,
    dependents: 1, resident: true, selfDeduction: 15500000, dependentDeduction: 6200000, brackets
  });
  // 30,000,000 − 3,150,000 − 15,500,000 − 6,200,000 = 5,150,000 × 5% = 257,500
  add('个税（应税 5,150,000 落在 5% 档）', pitCase.pit, 257500, 'SRS 4.6', 1);
  const pitNr = computePit({
    gross: 30000000, exemptIncome: 0, insurance: 2850000, dependents: 0, resident: false, brackets
  });
  add('非居民 20%（30,000,000 − 2,850,000）×20%', pitNr.pit, 5430000, 'SRS 4.6', 1);

  // 7 方案与用途
  const schemes = await many(`SELECT code FROM salary_base_scheme WHERE status = 'published' ORDER BY code`);
  add('已发布计薪方案数', schemes.length, 2, 'SRS 4.1');
  const stStaff = await one(
    `SELECT count(*)::int n FROM salary_base_purpose_item i
       JOIN salary_base_purpose p ON p.id = i.purpose_id
       JOIN salary_base_scheme s ON s.id = p.scheme_id
      WHERE s.code = 'VN_STAFF' AND p.purpose = 'overtime' AND i.item_code = 'perf'`
  );
  add('干部加班基数不含绩效（条数应为 0）', stStaff.n, 0, 'SRS 4.1');

  // 8 参数齐备
  const need = ['pay_mode_default', 'probation_rate', 'round_item_digits', 'round_net_digits',
    'union_fee_mode', 'union_fee_fixed', 'ins_base_mode', 'deduct_cap_ratio',
    'legal_min_wage_monthly', 'legal_min_wage_hourly', 'ot_cap_month'];
  const got = await many(`SELECT param_key FROM salary_param WHERE region_code = 'VN' AND param_key = ANY($1::text[])`, [need]);
  add('SRS 对齐参数齐备数', got.length, need.length, 'SRS 4.5/4.6', 0);

  // 9 试用期系数
  const pr = await one(`SELECT param_value FROM salary_param WHERE param_key = 'probation_rate' ORDER BY effective_from DESC LIMIT 1`);
  add('试用期系数', Number(pr?.param_value), 0.85, 'SRS 4.3(4)');

  return out;
}

// ============================================================
// 七、工具
// ============================================================
function amountsFromLines(structure) {
  const m = Object.create(null);
  for (const l of structure.lines || []) {
    const v = Number(l.value) || 0;
    if (m[l.code] == null) m[l.code] = v;
    else if (!m[l.code] && v) m[l.code] = v;
  }
  // v1 镜像列兜底（老结构没建明细行的情况）
  if (m.base == null) m.base = Number(structure.baseSalary) || 0;
  if (m.post_allowance == null) m.post_allowance = Number(structure.postAllowance) || 0;
  return m;
}

function basesFromScheme(scheme, amounts, structure) {
  const out = { normal: 0, overtime: 0, holiday: 0, severance: 0, baseOnly: 0 };
  out.baseOnly = Number(amounts.base) || 0;
  for (const p of scheme.purposes || []) {
    const key = p.purpose === 'severance' ? 'severance' : p.purpose;
    let sum = 0;
    for (const it of p.items || []) {
      sum += (Number(amounts[it.itemCode]) || 0) * (Number(it.weight) || 1);
    }
    if (out[key] != null) out[key] = round(sum, 2);
  }
  // 兼容：老结构把 base_salary/post_allowance 写在主表，明细里没有 code=base
  if (!out.normal) {
    out.normal = round((Number(structure.baseSalary) || 0) + (Number(structure.postAllowance) || 0), 2);
  }
  return out;
}

function countNightStats(days = []) {
  let shifts = 0;
  const daySet = new Set();
  for (const d of days) {
    if (!d || d.status !== 'computed') continue;
    const segs = d.segments || [];
    const paid = segs.filter(s => (Number(s.payableHours) || 0) > 0);
    if (!paid.length) continue;
    // 夜班判定：出现 ②③⑤⑥ 或班次类型为 night
    const isNight = d.shiftType === 'night' ||
      paid.some(s => ['②', '③', '⑤', '⑥'].includes(s.code));
    if (!isNight) continue;
    shifts += 1;
    // 跨午夜的夜班归属「起班日」（d.date 即归属日），同一天只计 1 个夜班天
    const key = String(d.date || d.workDate || d.work_date || '').slice(0, 10);
    if (key) daySet.add(key);
  }
  return { shifts, days: daySet.size };
}

function countNightShifts(days = []) {
  return countNightStats(days).shifts;
}

function accumulateWorkdayPaidHours(days = []) {
  let h = 0;
  for (const d of days) {
    if (!d || d.status !== 'computed' || d.dayKind !== 'workday') continue;
    for (const s of d.segments || []) {
      if (!s.isOt) h += Number(s.payableHours) || 0;
    }
  }
  return round(h, 2);
}

function intParam(v, dft) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dft;
}

/** 取有限数值，非法/空则回落到默认值（小时阈值这类可配参数用） */
function fin(v, dft) {
  if (v === null || v === undefined || v === '') return dft;
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
}

/** 发放比例归一：允许 0.1 与 10（百分数），越界按 0 或 1 截断 */
function normRatio(v) {
  const n = fin(v, 0);
  const r = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, Math.round(r * 10000) / 10000));
}

/** 比例转百分比文案：0.1 → 10% */
function pct(r) {
  if (!(r > 0)) return '不发';
  if (Math.abs(r - 1) < 1e-9) return '全发';
  return Math.round(r * 10000) / 100 + '%';
}

/**
 * 取某人某月待并入的补发/扣发记录。
 * 表可能还没建（老库升级过程中）——此时按「没有调整」处理，不能让计薪整体失败。
 */
async function loadApprovedAdjustments(userId, period) {
  if (!userId) return [];
  try {
    const mod = await import('./salary-adjust.js');
    return await mod.loadActiveAdjustments(userId, period);
  } catch (err) {
    console.warn('[salary-engine-v3] 读取补发/扣发失败（按 0 处理）:', err?.message || err);
    return [];
  }
}

function dt(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

function periodEnd(period) {
  const [y, m] = String(period).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return period + '-' + String(last).padStart(2, '0');
}

function monthsBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00Z');
  const b = new Date(toIso + 'T00:00:00Z');
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

function fmt(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export { loadBandSet };
