/**
 * 休假额度（年假按月累积）与提交前置拦截
 * ============================================================
 * 口径（2026-10-28 用户定）：
 *   · 年假「每上满一个自然月累积 1 天」，年度封顶 12 天（法定 days 见字典）；
 *   · 未上满整月不计；上一年未休完不结转（carry_over=false，需劳资协商才开）；
 *   · 已休满不能透支 —— 提交休假单时就拦（不再等计薪时告警）。
 *
 * 占用口径：flow_instance 里同一申请人、同一休假类型、状态为
 *   running（审批中）/ completed（已办结）的单据天数之和。
 *   draft 不占（可继续改），rejected / terminated / withdrawn 释放。
 *   审批中也占额度，是为了防「同一天连提 3 单 5 天」的并发超休。
 *
 * 日期口径：额度算到「本次休假开始日」为止，即请 11 月的假按 11 月 1 日
 *   已累积的天数额度判断，不按提交当天，避免提前请年假被误拦。
 */
import { many, one, query, transaction } from '../db/index.js';
import { loadLeaveTypeMap } from './leave-type.js';

/** 占用额度的单据状态：审批中 + 已办结 */
const OCCUPIED_STATUS = ['running', 'completed', 'approved'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** 在 UTC 上加减整月，日对齐（1/31 + 1 月 → 2/28） */
function addMonthsUTC(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(y, m + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return t;
}

/**
 * 两个日期之间「已上满的完整自然月数」。
 * from 2026-01-01、to 2026-10-01 → 9（1~9 月已满，10 月刚开始未满）。
 * 月末对齐按「日对齐 + 月末夹取」处理：from 2026-01-31、to 2026-02-28 → 1。
 */
export function fullMonthsBetween(from, to) {
  const a = dateOnly(from);
  const b = dateOnly(to);
  if (!a || !b) return 0;
  const toDate = new Date(`${b}T00:00:00Z`);
  if (toDate < new Date(`${a}T00:00:00Z`)) return 0;
  let months = 0;
  // 逐月推进：上界 600（50 年）足够覆盖在职周期
  while (months < 600) {
    const next = addMonthsUTC(a, months + 1);
    if (next.getTime() > toDate.getTime()) break;
    months += 1;
  }
  return months;
}

/**
 * 纯函数：按类型定义算某人某个日期的已累积额度。
 * @param {object} type  字典项（accrualMode / accrualPerMonth / annualCap / statutoryDays）
 * @param {{hireDate:string|null, asOf:string}} p
 * @returns {{mode:string, perMonth:number, cap:number|null, fromDate:string,
 *            months:number, accrued:number, hireDate:string|null, asOf:string, known:boolean}}
 */
export function computeAccrual(type, { hireDate, asOf }) {
  const date = dateOnly(asOf) || new Date().toISOString().slice(0, 10);
  const hire = dateOnly(hireDate);
  const mode = type?.accrualMode || 'none';
  const perMonth = num(type?.accrualPerMonth);
  const capRaw = type?.annualCap == null ? type?.statutoryDays : type.annualCap;
  const cap = capRaw == null || capRaw === '' ? null : num(capRaw);

  if (mode !== 'per_month' || !(perMonth > 0)) {
    return {
      mode, perMonth, cap, fromDate: hire || `${date.slice(0, 4)}-01-01`,
      months: 0, accrued: cap == null ? 0 : cap,
      hireDate: hire, asOf: date, known: !!hire
    };
  }

  // 年度起点：本年度 1 月 1 日；年内入职则从入职日起算（当年按月累积）
  // 入职日缺失时不臆断工龄——按 0 天处理并在界面/计薪提示补齐，避免给新人
  // 白发 9 天年假（中途切系统时入职日往往没迁移过来）。
  if (!hire) {
    return {
      mode, perMonth, cap,
      fromDate: `${date.slice(0, 4)}-01-01`, months: 0, accrued: 0,
      hireDate: null, asOf: date, known: false
    };
  }
  const yearStart = `${date.slice(0, 4)}-01-01`;
  const fromDate = hire > yearStart ? hire : yearStart;
  const months = fullMonthsBetween(fromDate, date);
  let accrued = months * perMonth;
  if (cap != null) accrued = Math.min(accrued, cap);

  return {
    mode, perMonth, cap,
    fromDate, months, accrued: Number(accrued.toFixed(2)),
    hireDate: hire, asOf: date, known: !!hire
  };
}

/**
 * 取员工入职日。
 *
 * 权威来源是 org_user.hire_date（建号时写入，迁移 110 起的双向触发器会与
 * employee_onboarding.hire_date 保持一致）；这里再 COALESCE 兜底一次，
 * 兼容「历史账号有登记但没回写」的残留数据。
 * 待入职/作废的登记不参与（status='active' 才算已入职）。
 */
export async function getHireDate(userId) {
  const r = await one(
    `SELECT COALESCE(u.hire_date, ob.hire_date) AS hire_date
       FROM org_user u
       LEFT JOIN LATERAL (
         SELECT hire_date FROM employee_onboarding
          WHERE user_id = u.id AND status = 'active'
          ORDER BY id DESC LIMIT 1
       ) ob ON TRUE
      WHERE u.id = $1`,
    [userId]
  );
  return r && r.hire_date ? String(r.hire_date).slice(0, 10) : null;
}

/**
 * 某人某类休假的余额。
 *
 * 可休额度 = 系统按月累积 accrued + 手工结转 carryIn + 调账 adjust − 切换前已休 openingUsed
 * 占用     = 电子流已批 used + 审批中 pending
 * 可休     = 可休额度 − 占用
 *
 * @param {object} p
 *   @param {number} p.userId
 *   @param {string} p.code     休假类型 code
 *   @param {string} [p.asOf]   额度算到哪天（默认今天；传休假开始日）
 *   @param {number} [p.excludeInstanceId] 排除的单据（重提同一张单时不重复计自己）
 * @returns {Promise<object>} 余额明细，amount 均为「天」
 */
export async function getLeaveBalance({ userId, code, asOf = null, excludeInstanceId = null }) {
  const uid = Number(userId);
  const dict = await loadLeaveTypeMap();
  const type = dict.get(String(code));
  const today = asOf ? dateOnly(asOf) : null;
  const date = today || new Date().toISOString().slice(0, 10);

  if (!uid || !type) {
    return {
      code: String(code || ''), name: type ? type.name : String(code || ''),
      known: false, year: Number(date.slice(0, 4)),
      mode: 'none', perMonth: 0, cap: null, allowNegative: true,
      hireDate: null, fromDate: null, monthsAccrued: 0,
      accrued: 0, carryIn: 0, openingUsed: 0, adjust: 0, available: 0,
      used: 0, pending: 0, occupied: 0, remaining: 0,
      detail: [], txn: []
    };
  }

  const year = Number(date.slice(0, 4));
  const hire = await getHireDate(uid);
  const acc = computeAccrual(type, { hireDate: hire, asOf: date });
  const ledger = await loadQuotaTxn({ userId: uid, code, year });

  const rows = await many(
    `SELECT fi.id, fi.status, fi.form_data
       FROM flow_instance fi
       JOIN flow_definition fd ON fd.id = fi.definition_id
      WHERE fd.code = 'leave'
        AND fi.applicant_id = $1
        AND fi.status = ANY($2::text[])
        AND fi.form_data->>'leave_type' = $3
        AND left(COALESCE(fi.form_data->>'start_date', ''), 4) = $4
        AND ($5::bigint IS NULL OR fi.id <> $5::bigint)
      ORDER BY fi.id`,
    [uid, OCCUPIED_STATUS, String(code), String(year), excludeInstanceId]
  );

  let used = 0;
  let pending = 0;
  const detail = [];
  for (const r of rows) {
    const fd = r.form_data || {};
    const days = num(fd.days);
    if (r.status === 'running') pending += days;
    else used += days;
    detail.push({
      instanceId: Number(r.id),
      status: r.status,
      startDate: dateOnly(fd.start_date),
      endDate: dateOnly(fd.end_date),
      days: Number(days.toFixed(2))
    });
  }

  const occupied = Number((used + pending).toFixed(2));
  // 手工记账户：切换前已休算占用，结转/调账算额度
  const available = Number((acc.accrued + ledger.carryIn + ledger.adjust - ledger.openingUsed).toFixed(2));
  const remaining = Number((available - occupied).toFixed(2));

  return {
    code: type.code,
    name: type.name,
    known: true,
    year,
    mode: acc.mode,
    perMonth: acc.perMonth,
    cap: acc.cap,
    allowNegative: type.allowNegative !== false,
    carryOver: type.carryOver === true,
    hireDate: acc.hireDate,
    fromDate: acc.fromDate,
    monthsAccrued: acc.months,
    asOf: date,
    accrued: acc.accrued,
    carryIn: ledger.carryIn,
    openingUsed: ledger.openingUsed,
    adjust: ledger.adjust,
    available,
    used: Number(used.toFixed(2)),
    pending: Number(pending.toFixed(2)),
    occupied,
    remaining,
    detail,
    txn: ledger.rows
  };
}

/**
 * 取某人某类某年的手工记账（carry_in / opening_used / adjust 汇总）
 * @returns {Promise<{carryIn:number, openingUsed:number, adjust:number, rows:Array}>}
 */
export async function loadQuotaTxn({ userId, code, year }) {
  const rows = await many(
    `SELECT id, txn_type, days, effective_date, remark, created_at
       FROM attendance_leave_quota_txn
      WHERE user_id = $1 AND leave_type_code = $2 AND quota_year = $3
      ORDER BY id`,
    [Number(userId), String(code), Number(year)]
  );
  let carryIn = 0, openingUsed = 0, adjust = 0;
  for (const r of rows) {
    const d = num(r.days);
    if (r.txn_type === 'carry_in') carryIn += d;
    else if (r.txn_type === 'opening_used') openingUsed += d;
    else adjust += d;
  }
  return {
    carryIn: Number(carryIn.toFixed(2)),
    openingUsed: Number(openingUsed.toFixed(2)),
    adjust: Number(adjust.toFixed(2)),
    rows: rows.map(r => ({
      id: Number(r.id),
      txnType: r.txn_type,
      days: num(r.days),
      effectiveDate: r.effective_date ? String(r.effective_date).slice(0, 10) : null,
      remark: r.remark,
      createdAt: r.created_at
    }))
  };
}

/**
 * 提交前校验：额度不足即抛错（不透支）。
 * 只对 allow_negative=false 的类型生效；其余类型保持「计薪时告警」。
 *
 * @param {object} p
 *   @param {number} p.userId
 *   @param {object} p.formData 表单值（leave_type / start_date / end_date / days）
 *   @param {number} [p.instanceId] 当前单据（重提时排除自身）
 * @returns {Promise<{ok:boolean, skipped?:string, balance?:object}>}
 */
export async function checkLeaveQuota({ userId, formData, instanceId = null }) {
  const fd = formData || {};
  const code = fd.leave_type ? String(fd.leave_type) : '';
  if (!code) return { ok: true, skipped: '未选择休假类型' };

  const dict = await loadLeaveTypeMap();
  const type = dict.get(code);
  if (!type) return { ok: true, skipped: '休假类型不在字典：' + code };

  const limitable = type.allowNegative === false
    && (type.accrualMode === 'per_month' || (type.annualCap != null || type.statutoryDays != null));
  if (!limitable) {
    return { ok: true, skipped: type.name + ' 允许超额，仅计薪时告警' };
  }

  const startDate = dateOnly(fd.start_date);
  if (!startDate) return { ok: true, skipped: '缺少休假开始日期' };

  const days = num(fd.days);
  if (!(days > 0)) return { ok: true, skipped: '休假天数未填，不做额度校验' };

  const bal = await getLeaveBalance({ userId, code, asOf: startDate, excludeInstanceId: instanceId });
  const total = Number((bal.occupied + days).toFixed(2));
  if (total > bal.available + 1e-9) {
    const available = Number(Math.max(0, bal.remaining).toFixed(2));
    // 额度构成：系统累积 + 手工结转/调账 − 切换前已休，让申请人看得懂差在哪
    const parts = ['已累积 ' + bal.accrued + ' 天'];
    if (bal.carryIn) parts.push('结转 ' + bal.carryIn + ' 天');
    if (bal.adjust) parts.push('调账 ' + (bal.adjust > 0 ? '+' : '') + bal.adjust + ' 天');
    if (bal.openingUsed) parts.push('切换前已休 ' + bal.openingUsed + ' 天');
    const err = new Error(
      `${bal.name}额度不足：截至 ${startDate} 可用 ${bal.available} 天` +
      `（${parts.join('，')}；${bal.fromDate} 起满 ${bal.monthsAccrued} 个自然月` +
      `${bal.cap != null ? `，年度上限 ${bal.cap} 天` : ''}），` +
      `电子流已占用 ${bal.occupied} 天（已批 ${bal.used} + 审批中 ${bal.pending}），` +
      `本次申请 ${days} 天，可休 ${available} 天。该假不结转、不可透支，请改天数或先办理其他假别。`
    );
    err.statusCode = 400;
    err.isBiz = true;
    err.bizCode = 'LEAVE_QUOTA_EXCEEDED';
    err.detail = {
      code: bal.code, name: bal.name, asOf: startDate,
      accrued: bal.accrued, carryIn: bal.carryIn, openingUsed: bal.openingUsed,
      adjust: bal.adjust, available: bal.available,
      occupied: bal.occupied, requested: days,
      availableNow: available, monthsAccrued: bal.monthsAccrued, cap: bal.cap
    };
    throw err;
  }

  return { ok: true, balance: bal };
}

/** 供流程引擎调用：非休假流程或额度充足时静默返回 */
export async function assertLeaveQuota({ userId, formData, instanceId = null }) {
  return checkLeaveQuota({ userId, formData, instanceId });
}

/** 某人某年度各类休假余额一览（界面用） */
export async function listLeaveBalances({ userId, year = null, asOf = null }) {
  const now = new Date().toISOString().slice(0, 10);
  const currentYear = Number(now.slice(0, 4));
  const y = Number(year) || currentYear;
  // 查往年时按「该年 12 月 31 日」结算，别用今天去算去年的额度
  const date = asOf ? dateOnly(asOf) : (y === currentYear ? now : `${y}-12-31`);
  const dict = await loadLeaveTypeMap();
  const out = [];
  for (const t of dict.values()) {
    const needsQuota = t.allowNegative === false
      && (t.accrualMode === 'per_month' || t.annualCap != null || t.statutoryDays != null);
    if (!needsQuota) continue;
    const b = await getLeaveBalance({ userId, code: t.code, asOf: date });
    if (!b.known) continue;
    out.push({ ...b, year: y });
  }
  return out;
}

// ============================================================
// 全员年假台账（含手工记账）
// ------------------------------------------------------------
// 一行一人：系统按月累积 + 手工结转/调账 − 切换前已休 − 电子流占用 = 可休。
// 用一条 SQL 聚合（手账 + 电子流各一个子查询），避免 121 人 × N 次查询。
// ============================================================

/**
 * @param {object} p
 *   @param {number|string} p.year   额度年度（默认当前年）
 *   @param {string} p.code          休假类型（默认 annual）
 *   @param {string} [p.keyword]     按姓名/工号搜
 *   @param {string} [p.asOf]        额度算到哪天（默认：本年=今天，往年=12-31）
 */
export async function listQuotaLedger({ year = null, code = 'annual', keyword = null, asOf = null } = {}) {
  const now = new Date().toISOString().slice(0, 10);
  const currentYear = Number(now.slice(0, 4));
  const y = Number(year) || currentYear;
  const date = asOf ? dateOnly(asOf) : (y === currentYear ? now : `${y}-12-31`);
  const dict = await loadLeaveTypeMap();
  const type = dict.get(String(code));
  if (!type) {
    const e = new Error('休假类型不在字典：' + code);
    e.statusCode = 400; e.isBiz = true;
    throw e;
  }

  const kw = keyword ? `%${String(keyword).trim()}%` : null;
  const rows = await many(
    `WITH txn AS (
       SELECT user_id,
              SUM(CASE txn_type WHEN 'carry_in' THEN days
                                WHEN 'opening_used' THEN -days
                                ELSE days END) AS net,
              SUM(CASE WHEN txn_type = 'carry_in'     THEN days ELSE 0 END) AS carry_in,
              SUM(CASE WHEN txn_type = 'opening_used' THEN days ELSE 0 END) AS opening_used,
              SUM(CASE WHEN txn_type = 'adjust'       THEN days ELSE 0 END) AS adjust
         FROM attendance_leave_quota_txn
        WHERE leave_type_code = $1 AND quota_year = $2
        GROUP BY user_id
     ), flow AS (
       SELECT fi.applicant_id AS user_id,
              SUM(CASE WHEN fi.status = 'running' THEN 0 ELSE d.days END) AS used,
              SUM(CASE WHEN fi.status = 'running' THEN d.days ELSE 0 END) AS pending
         FROM flow_instance fi
         JOIN flow_definition fd ON fd.id = fi.definition_id
         CROSS JOIN LATERAL (
           SELECT CASE WHEN COALESCE(fi.form_data->>'days', '') ~ '^[0-9]+([.][0-9]+)?$'
                       THEN (fi.form_data->>'days')::numeric ELSE 0 END AS days
         ) d
        WHERE fd.code = 'leave'
          AND fi.status = ANY($3::text[])
          AND fi.form_data->>'leave_type' = $1
          AND left(COALESCE(fi.form_data->>'start_date', ''), 4) = ($2::int)::text
        GROUP BY fi.applicant_id
     )
     SELECT u.id AS user_id, u.real_name, u.employee_no,
            COALESCE(u.hire_date, ob.hire_date) AS hire_date,
            (u.hire_date IS NOT NULL) AS hire_date_from_user,
            COALESCE(t.carry_in, 0)::float8     AS carry_in,
            COALESCE(t.opening_used, 0)::float8 AS opening_used,
            COALESCE(t.adjust, 0)::float8       AS adjust,
            COALESCE(f.used, 0)::float8         AS used,
            COALESCE(f.pending, 0)::float8      AS pending
       FROM org_user u
       -- 入职日兜底：历史账号可能只有入职登记上的日期（迁移 110 已回填并加触发器，
       -- 这里保留 COALESCE 以防再次出现单边数据）
       LEFT JOIN LATERAL (
         SELECT hire_date FROM employee_onboarding
          WHERE user_id = u.id AND status = 'active'
          ORDER BY id DESC LIMIT 1
       ) ob ON TRUE
       LEFT JOIN txn  t ON t.user_id  = u.id
       LEFT JOIN flow f ON f.user_id  = u.id
      WHERE COALESCE(u.active, TRUE) = TRUE
        AND COALESCE(u.employee_no, '') <> ''
        -- 排除系统/服务账号（admin、wms_bot 这类，见 org_user.is_system）
        AND COALESCE(u.is_system, FALSE) = FALSE
        AND ($4::text IS NULL OR COALESCE(u.real_name,'') ILIKE $4 OR COALESCE(u.employee_no,'') ILIKE $4)
      ORDER BY COALESCE(u.employee_no, ''), u.id`,
    [String(code), y, OCCUPIED_STATUS, kw]
  );

  const list = rows.map(r => {
    const hire = r.hire_date ? String(r.hire_date).slice(0, 10) : null;
    const acc = computeAccrual(type, { hireDate: hire, asOf: date });
    const used = num(r.used);
    const pending = num(r.pending);
    const occupied = Number((used + pending).toFixed(2));
    const available = Number((acc.accrued + num(r.carry_in) + num(r.adjust) - num(r.opening_used)).toFixed(2));
    return {
      userId: Number(r.user_id),
      employeeNo: r.employee_no || '',
      realName: r.real_name || '',
      hireDate: hire,
      monthsAccrued: acc.months,
      accrued: acc.accrued,
      carryIn: num(r.carry_in),
      openingUsed: num(r.opening_used),
      adjust: num(r.adjust),
      available,
      used: Number(used.toFixed(2)),
      pending: Number(pending.toFixed(2)),
      occupied,
      remaining: Number((available - occupied).toFixed(2)),
      hireDateMissing: !hire
    };
  });

  // 汇总（界面顶部一行）
  const sum = list.reduce((a, r) => ({
    employees: a.employees + 1,
    accrued: a.accrued + r.accrued,
    carryIn: a.carryIn + r.carryIn,
    openingUsed: a.openingUsed + r.openingUsed,
    adjust: a.adjust + r.adjust,
    available: a.available + r.available,
    used: a.used + r.used,
    pending: a.pending + r.pending,
    remaining: a.remaining + r.remaining,
    hireDateMissing: a.hireDateMissing + (r.hireDateMissing ? 1 : 0),
    negative: a.negative + (r.remaining < 0 ? 1 : 0)
  }), {
    employees: 0, accrued: 0, carryIn: 0, openingUsed: 0, adjust: 0,
    available: 0, used: 0, pending: 0, remaining: 0, hireDateMissing: 0, negative: 0
  });

  return {
    year: y,
    code: type.code,
    name: type.name,
    asOf: date,
    mode: type.accrualMode,
    perMonth: type.accrualPerMonth,
    cap: type.annualCap == null ? type.statutoryDays : type.annualCap,
    allowNegative: type.allowNegative !== false,
    rows: list,
    totals: sum
  };
}

/**
 * 写一条手工记账。
 *   · carry_in / opening_used：每人每类每年一格，重复写按 upsert 覆盖；
 *   · days = 0 且非 adjust → 视为清空该格（删除记录）；
 *   · adjust：允许多条，形成调账流水（可正可负）。
 */
export async function upsertQuotaTxn({
  userId, code, year = null, txnType, days, remark = null, effectiveDate = null, operatorId = null
}) {
  const type = String(txnType || '');
  if (!['carry_in', 'opening_used', 'adjust'].includes(type)) {
    const e = new Error('记账类型只能是 carry_in / opening_used / adjust');
    e.statusCode = 400; e.isBiz = true; throw e;
  }
  const uid = Number(userId);
  if (!uid) {
    const e = new Error('缺少员工');
    e.statusCode = 400; e.isBiz = true; throw e;
  }
  const d = Number(days);
  if (!Number.isFinite(d)) {
    const e = new Error('天数不合法');
    e.statusCode = 400; e.isBiz = true; throw e;
  }
  if (type !== 'adjust' && d < 0) {
    const e = new Error('结转额度/切换前已休必须是大于等于 0 的天数（减少可休请用调账）');
    e.statusCode = 400; e.isBiz = true; throw e;
  }
  const y = Number(year) || Number(new Date().toISOString().slice(0, 4));
  const eff = effectiveDate ? dateOnly(effectiveDate) : null;

  if (type !== 'adjust' && Math.abs(d) < 1e-9) {
    await query(
      `DELETE FROM attendance_leave_quota_txn
        WHERE user_id = $1 AND leave_type_code = $2 AND quota_year = $3 AND txn_type = $4`,
      [uid, String(code), y, type]
    );
    return { cleared: true, userId: uid, txnType: type, days: 0 };
  }

  const r = await one(
    `INSERT INTO attendance_leave_quota_txn
       (user_id, leave_type_code, quota_year, txn_type, days, effective_date, remark, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
     ON CONFLICT (user_id, leave_type_code, quota_year, txn_type)
       WHERE txn_type IN ('carry_in', 'opening_used')
       DO UPDATE SET days = EXCLUDED.days,
                     effective_date = COALESCE(EXCLUDED.effective_date, attendance_leave_quota_txn.effective_date),
                     remark = EXCLUDED.remark,
                     created_by = EXCLUDED.created_by,
                     updated_at = now()
     RETURNING id, txn_type, days, quota_year`,
    [uid, String(code), y, type, d, eff, remark, operatorId ? Number(operatorId) : null]
  );
  return {
    id: Number(r.id), userId: uid, leaveType: String(code), year: Number(r.quota_year),
    txnType: r.txn_type, days: num(r.days)
  };
}

/** 批量保存台账（界面「保存本期记账」）：只写有变化的格子 */
export async function saveQuotaBatch({ year, code, rows, operatorId = null }) {
  const list = Array.isArray(rows) ? rows : [];
  const y = Number(year) || Number(new Date().toISOString().slice(0, 4));
  let saved = 0, cleared = 0;
  const out = [];
  await transaction(async client => {
    for (const r of list) {
      const uid = Number(r.userId);
      if (!uid) continue;
      for (const [type, raw] of [['carry_in', r.carryIn], ['opening_used', r.openingUsed]]) {
        if (raw === undefined || raw === null || raw === '') continue;
        const d = Number(raw);
        if (!Number.isFinite(d) || d < 0) {
          const e = new Error(`员工 #${uid} 的${type === 'carry_in' ? '结转额度' : '切换前已休'}不是合法天数：${raw}`);
          e.statusCode = 400; e.isBiz = true; throw e;
        }
        if (Math.abs(d) < 1e-9) {
          const del = await client.query(
            `DELETE FROM attendance_leave_quota_txn
              WHERE user_id = $1 AND leave_type_code = $2 AND quota_year = $3 AND txn_type = $4`,
            [uid, String(code), y, type]
          );
          cleared += del.rowCount || 0;
          continue;
        }
        await client.query(
          `INSERT INTO attendance_leave_quota_txn
             (user_id, leave_type_code, quota_year, txn_type, days, remark, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, leave_type_code, quota_year, txn_type)
             WHERE txn_type IN ('carry_in', 'opening_used')
             DO UPDATE SET days = EXCLUDED.days, remark = EXCLUDED.remark,
                           created_by = EXCLUDED.created_by, updated_at = now()`,
          [uid, String(code), y, type, d, r.remark || null,
            operatorId ? Number(operatorId) : null]
        );
        saved += 1;
      }
      out.push(uid);
    }
  });
  return { year: y, code: String(code), employees: out.length, saved, cleared };
}

/** 删除一条手工记账（只删 adjust 或误录的格子） */
export async function deleteQuotaTxn(id) {
  const r = await query(`DELETE FROM attendance_leave_quota_txn WHERE id = $1 RETURNING id`, [Number(id)]);
  if (!r.rowCount) {
    const e = new Error('记账记录不存在');
    e.statusCode = 404; e.isBiz = true; throw e;
  }
  return { id: Number(id), deleted: true };
}

/** 某人的手工记账明细（界面展开用） */
export async function listQuotaTxn({ userId, code = 'annual', year = null }) {
  const y = Number(year) || Number(new Date().toISOString().slice(0, 4));
  const l = await loadQuotaTxn({ userId, code, year: y });
  return { year: y, code: String(code), ...l };
}
