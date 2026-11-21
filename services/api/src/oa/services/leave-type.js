/**
 * 休假类型字典 + 月度休假取数
 * ============================================================
 * 越南《劳动法》45/2019/QH14 与《社会保险法》58/2014/QH13 口径。
 * 字典表 attendance_leave_type（迁移 106）是唯一真值来源，代码里不再硬编码类型名。
 *
 * 三个用途：
 *   1. 计薪引擎：判断哪些休假「公司发薪」（pay_wage）、哪些「计入算考勤天数」
 *      （counts_as_attendance，用于满勤奖与按天折算补贴的缺勤豁免）。
 *   2. 界面：休假申请单下拉、字典维护页、工资单休假明细。
 *   3. 合规提示：法定天数上限（statutory_days）超限时给 warn。
 */
import { many, one } from '../db/index.js';

let CACHE = null;
let CACHE_AT = 0;
const TTL_MS = 60 * 1000;

function mapRow(r) {
  return {
    code: r.code,
    name: r.name,
    nameVi: r.name_vi,
    nameEn: r.name_en,
    paidBy: r.paid_by,
    payWage: r.pay_wage === true,
    countsAsAttendance: r.counts_as_attendance === true,
    statutoryDays: r.statutory_days == null ? null : Number(r.statutory_days),
    // 额度控制（迁移 107）：年假等按月累积的假别，超额提交会被前置拦截
    accrualMode: r.accrual_mode || 'none',
    accrualPerMonth: Number(r.accrual_per_month) || 0,
    annualCap: r.annual_cap == null ? null : Number(r.annual_cap),
    allowNegative: r.allow_negative !== false,
    carryOver: r.carry_over === true,
    dayRule: r.day_rule,
    legalBasis: r.legal_basis,
    sortOrder: Number(r.sort_order) || 100,
    active: r.active !== false,
    remark: r.remark
  };
}

/** 全部休假类型（默认只取启用的），按 sort_order 排 */
export async function listLeaveTypes({ includeInactive = false } = {}) {
  const rows = await many(
    `SELECT * FROM attendance_leave_type
      ${includeInactive ? '' : 'WHERE active = TRUE'}
      ORDER BY sort_order, code`
  );
  return rows.map(mapRow);
}

/** code → 类型定义；60 秒缓存，字典改动后最迟 1 分钟生效 */
export async function loadLeaveTypeMap() {
  const now = Date.now();
  if (CACHE && now - CACHE_AT < TTL_MS) return CACHE;
  const list = await listLeaveTypes({ includeInactive: true });
  const m = new Map();
  for (const t of list) m.set(t.code, t);
  CACHE = m;
  CACHE_AT = now;
  return m;
}

/** 字典变更后可主动失效（界面保存时调用） */
export function invalidateLeaveTypeCache() {
  CACHE = null;
  CACHE_AT = 0;
}

/**
 * 取某人某月的休假记录，按类型归集。
 *
 * @param {object} p
 *   @param {number} p.userId
 *   @param {string} p.period  'YYYY-MM'
 *   @param {number} [p.stdHoursPerDay=8]
 *   @param {object|null} [p.calendarDays]  Attendance 日历 days 映射（{'01':1,...}）
 *                                          传了才按「工作日」过滤；没传则全部计入
 * @returns {Promise<{
 *   rows: Array, byType: Array, paidLeaveHours: number, paidLeaveDays: number,
 *   exemptLeaveHours: number, exemptDays: number, totalLeaveHours: number,
 *   unknownTypes: string[], overLimit: Array, calendarKnown: boolean
 * }>}
 */
export async function loadMonthLeave({
  userId, period, stdHoursPerDay = 8, calendarDays = null
}) {
  const empty = {
    rows: [], byType: [], balances: [],
    paidLeaveHours: 0, paidLeaveDays: 0,
    exemptLeaveHours: 0, exemptDays: 0,
    totalLeaveHours: 0, unknownTypes: [], overLimit: [], calendarKnown: !!calendarDays
  };
  if (!userId || !period) return empty;

  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return empty;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${period}-01`;
  const to = `${period}-${String(last).padStart(2, '0')}`;

  const rows = await many(
    `SELECT work_date, leave_type, leave_hours, absent
       FROM attendance_summary
      WHERE user_id = $1
        AND work_date BETWEEN $2::date AND $3::date
        AND leave_type IS NOT NULL
        AND COALESCE(leave_hours, 0) > 0
      ORDER BY work_date`,
    [userId, from, to]
  );
  if (!rows.length) return empty;

  const dict = await loadLeaveTypeMap();
  const sd = Number(stdHoursPerDay) > 0 ? Number(stdHoursPerDay) : 8;
  const isWorkday = (d) => {
    if (!calendarDays) return true;                       // 日历缺失：不臆断，全部计入
    const dd = String(d).slice(8, 10);
    const w = Number(calendarDays[dd]);
    return Number.isFinite(w) ? w > 0 : true;
  };

  const byTypeMap = new Map();
  const unknownTypes = new Set();
  const outRows = [];
  let paidLeaveHours = 0;
  let exemptLeaveHours = 0;
  let exemptDays = 0;
  let totalLeaveHours = 0;

  for (const r of rows) {
    const code = String(r.leave_type);
    const t = dict.get(code);
    const hours = Number(r.leave_hours) || 0;
    const workday = isWorkday(r.work_date);
    totalLeaveHours += hours;
    if (!t || t.active === false) unknownTypes.add(code);

    const isPaid = !!(t && t.payWage) && workday;
    const isExempt = !!(t && t.countsAsAttendance) && workday;
    if (isPaid) paidLeaveHours += hours;
    if (isExempt) {
      exemptLeaveHours += hours;
      // 一天可能多名目（拆分休假），按「有豁免小时即算一天」计
      exemptDays += 1;
    }

    const acc = byTypeMap.get(code) || {
      code,
      name: t ? t.name : code,
      nameVi: t ? t.nameVi : null,
      paidBy: t ? t.paidBy : 'unknown',
      payWage: !!(t && t.payWage),
      countsAsAttendance: !!(t && t.countsAsAttendance),
      known: !!t,
      days: 0, hours: 0
    };
    acc.days += 1;
    acc.hours += hours;
    byTypeMap.set(code, acc);

    outRows.push({
      workDate: String(r.work_date).slice(0, 10),
      leaveType: code,
      typeName: t ? t.name : code,
      hours: Number(hours.toFixed(2)),
      workday,
      payWage: isPaid,
      countsAsAttendance: isExempt
    });
  }

  // 法定天数超限提示（按类型汇总的「天数」，非工时）
  // 按月累积的假别（年假）不按月度上限判断——12 天是年度额度，不是每月额度，
  // 月度比对会漏报（每月休 3 天 × 12 月 = 36 天也「没超」）。这类假别的年度
  // 余额由 leave-balance.js 判断，计薪时输出额度/剩余/透支提示。
  const overLimit = [];
  for (const v of byTypeMap.values()) {
    const t = dict.get(v.code);
    if (t && t.accrualMode === 'per_month') continue;
    if (t && t.statutoryDays != null && v.days > t.statutoryDays) {
      overLimit.push({
        code: v.code, name: v.name, days: v.days, limit: t.statutoryDays,
        legalBasis: t.legalBasis
      });
    }
  }

  const byType = [...byTypeMap.values()].map(v => ({
    ...v,
    hours: Number(v.hours.toFixed(2)),
    days: Number(v.days.toFixed(1))
  })).sort((a, b) => b.hours - a.hours);

  // 按月累积的假别（年假）：算到本月末的年度额度 / 已用 / 剩余
  // 供计薪告警（超额度、临上限）与界面展示共用；查询失败不影响计薪。
  const balances = [];
  const perMonthTypes = [...dict.values()].filter(t => t.accrualMode === 'per_month');
  if (perMonthTypes.length) {
    try {
      const lb = await import('./leave-balance.js');
      const asOf = `${period}-${String(last).padStart(2, '0')}`;
      for (const t of perMonthTypes) {
        const b = await lb.getLeaveBalance({ userId, code: t.code, asOf });
        if (b.known) balances.push(b);
      }
    } catch (e) {
      console.warn('[leave-type] 休假余额计算失败（已忽略）：', e?.message || e);
    }
  }

  return {
    rows: outRows,
    byType,
    balances,
    paidLeaveHours: Number(paidLeaveHours.toFixed(2)),
    paidLeaveDays: Number((paidLeaveHours / sd).toFixed(2)),
    exemptLeaveHours: Number(exemptLeaveHours.toFixed(2)),
    exemptDays,
    totalLeaveHours: Number(totalLeaveHours.toFixed(2)),
    unknownTypes: [...unknownTypes],
    overLimit,
    calendarKnown: !!calendarDays
  };
}

/** 某人某月是否有休假（批量计薪时用来区分「没打卡」和「全月休假」） */
export async function hasMonthLeave(userId, period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const r = await one(
    `SELECT 1 AS x FROM attendance_summary
      WHERE user_id = $1
        AND work_date BETWEEN $2::date AND $3::date
        AND leave_type IS NOT NULL
        AND COALESCE(leave_hours, 0) > 0
      LIMIT 1`,
    [userId, `${period}-01`, `${period}-${String(last).padStart(2, '0')}`]
  );
  return !!r;
}
