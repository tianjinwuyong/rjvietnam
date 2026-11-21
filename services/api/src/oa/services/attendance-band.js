/**
 * 时段切片服务（DB 层）
 * ------------------------------------------------------------
 * 职责：
 *   1. 从库读时段集（十段）与用餐窗口，转成 payroll-core 需要的形状
 *   2. 判定某天的日型（假日 > 日历 > 周日）
 *   3. 把打卡记录 → 班次实例 → 逐段工时明细
 *   4. 汇总到月度（W / B / 偏差 / 空档）
 *
 * 时区口径（沿用 db/index.js 的约定）：
 *   全库 TIMESTAMPTZ 以 UTC 存取，打卡写入的「裸钟点」= 本地钟点。
 *   故读出的 ISO 串取 UTC 时分即为越南当地时间钟点，**不做 ±7 偏移**。
 *   这是本项目既定口径，改它会与 attendance-service 的迟到判定打架。
 */
import { query, many, one, transaction } from '../db/index.js';
import {
  sliceShift, timeToMinutes, computeQuota, DEFAULT_BANDS, DEFAULT_MEALS, round,
  latePenaltyHours, earlyPenaltyHours, applyPunctualityPenalty, SHIFT_DEFS
} from '../lib/payroll-core.js';

const MIN_PER_DAY = 1440;

// ============================================================
// 一、加载时段集
// ============================================================
let _bandCache = { at: 0, setId: null, bands: null, meals: null };

/** 取当前生效的时段集（published 且 effective_from <= 今天） */
export async function getActiveBandSet(date = new Date()) {
  return one(
    `SELECT * FROM attendance_time_band_set
      WHERE status = 'published'
        AND effective_from <= $1::date
        AND (effective_to IS NULL OR effective_to >= $1::date)
      ORDER BY effective_from DESC, version DESC
      LIMIT 1`,
    [toDateStr(date)]
  );
}

/**
 * 读时段 + 用餐，转成 payroll-core 形状。
 * 缓存 60 秒（与 getSystemConfig 同思路），避免每次切片都查库。
 */
export async function loadBandSet(setId = null) {
  const now = Date.now();
  if (!setId && _bandCache.bands && now - _bandCache.at < 60_000) {
    return _bandCache;
  }
  let id = setId;
  if (!id) {
    const set = await getActiveBandSet();
    if (!set) throw new Error('没有生效中的时段集（attendance_time_band_set 无 published 记录）');
    id = set.id;
  }

  const rows = await many(
    `SELECT seq, code, name, name_vi, day_kind, shift_type, start_time, end_time, cross_day,
            standard_hours, table_rate, legal_min_rate, adopted_rate,
            exempt_factor_a, exempt_factor_b, is_ot, counts_toward_ot_cap
       FROM attendance_time_band
      WHERE set_id = $1 AND active = TRUE
      ORDER BY seq`,
    [id]
  );
  const meals = await many(
    `SELECT seq, name, start_time, end_time, cross_day, minutes
       FROM attendance_time_band_meal WHERE set_id = $1 ORDER BY seq`,
    [id]
  );

  const bands = rows.map(r => ({
    seq: r.seq,
    code: r.code,
    name: r.name,
    nameVi: r.name_vi,
    dayKind: r.day_kind,
    shiftType: r.shift_type || 'any',
    start: hhmm(r.start_time),
    end: hhmm(r.end_time),
    crossDay: r.cross_day,
    standardHours: Number(r.standard_hours ?? 0),
    tableRate: Number(r.table_rate),
    legalMinRate: Number(r.legal_min_rate),
    exemptA: Number(r.exempt_factor_a),
    exemptB: Number(r.exempt_factor_b),
    isOt: r.is_ot,
    countsTowardOtCap: r.counts_toward_ot_cap
  }));

  const mealList = meals.map(r => ({
    seq: r.seq,
    name: r.name,
    start: hhmm(r.start_time),
    end: hhmm(r.end_time),
    crossDay: r.cross_day,
    minutes: r.minutes
  }));

  const out = { setId: id, bands: bands.length ? bands : DEFAULT_BANDS, meals: mealList.length ? mealList : DEFAULT_MEALS };
  if (!setId) _bandCache = { at: now, ...out };
  return out;
}

export function clearBandCache() { _bandCache = { at: 0, setId: null, bands: null, meals: null }; }

// ============================================================
// 一·补、班次定义（白班 08:00-20:00 / 夜班 20:00-08:00）
// ============================================================
let _shiftCache = { at: 0, rows: null };

/**
 * 读班次定义。shiftType 由 code 推导：含 night 的算夜班，其余算白班。
 * 缓存 60 秒——班次定义一天最多改一次，但切片是逐日逐人的。
 */
export async function loadShiftDefs() {
  const now = Date.now();
  if (_shiftCache.rows && now - _shiftCache.at < 60_000) return _shiftCache.rows;
  const rows = await many(
    `SELECT code, name, start_time, end_time, cross_day
       FROM attendance_shift_def WHERE active = TRUE ORDER BY sort_order, id`
  );
  const list = rows.map(r => ({
    code: r.code,
    name: r.name,
    start: hhmm(r.start_time),
    end: hhmm(r.end_time),
    crossDay: !!r.cross_day,
    shiftType: String(r.code).includes('night') ? 'night' : 'day'
  }));
  _shiftCache = { at: now, rows: list };
  return list;
}

export function clearShiftCache() { _shiftCache = { at: 0, rows: null }; }

/** 取某个班次的计划上下班分钟数 */
export async function resolvePlannedShift(shiftCode) {
  const defs = await loadShiftDefs();
  const d = defs.find(x => x.code === shiftCode);
  if (!d) return null;
  const inMin = timeToMinutes(d.start);
  let outMin = timeToMinutes(d.end);
  if (outMin <= inMin) outMin += MIN_PER_DAY;
  return { ...d, inMin, outMin };
}

/**
 * 没传班次时，按上班时刻猜是哪个班（就近归属）。
 * 只用来决定「套哪套倍率」；**不用来算迟到早退**——迟到早退必须有明确的排班，
 * 否则会把「本来只排了 8 小时」的人误判成早退。
 */
export function inferShiftType(inMin) {
  let best = SHIFT_DEFS[0], bestD = Infinity;
  for (const s of SHIFT_DEFS) {
    const m = timeToMinutes(s.start);
    let d = Math.abs(inMin - m);
    d = Math.min(d, MIN_PER_DAY - d);   // 24h 环形距离
    if (d < bestD) { bestD = d; best = s; }
  }
  return best.shiftType;
}

// ============================================================
// 二、日型判定
// ============================================================
/**
 * 判定某天的日型与「是否应出勤」。
 * 优先级：法定假日 > 日历设置 > 周日 > 休息日
 *
 * 返回 { dayKind, isWorkday, source }
 */
export async function resolveDayKind(workDate) {
  const d = toDateStr(workDate);
  const ym = d.slice(0, 7);
  const dd = d.slice(8, 10);

  const hol = await one(
    `SELECT name FROM attendance_holiday
      WHERE holiday_date = $1::date AND region_code = 'VN' LIMIT 1`, [d]
  );
  if (hol) return { dayKind: 'holiday', isWorkday: false, source: 'holiday', note: hol.name };

  const cal = await one(
    `SELECT days FROM attendance_work_calendar WHERE year_month = $1 LIMIT 1`, [ym]
  );
  if (cal && cal.days) {
    const w = Number(cal.days[dd]);
    if (Number.isFinite(w)) {
      if (w > 0) return { dayKind: 'workday', isWorkday: true, source: 'calendar', weight: w };
      // 日历说休：周日与调休放假日都在这里，统一按 sunday 口径（⑦⑧ 倍率）
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      return { dayKind: 'sunday', isWorkday: false, source: 'calendar', weight: 0, sunday: dow === 0 };
    }
  }

  // 日历缺失：不猜，交给调用方决定阻塞
  return { dayKind: null, isWorkday: null, source: 'missing' };
}

/** 取某月的日历工作日（供算 B 用） */
export async function getMonthWorkdays(period) {
  const cal = await one(
    `SELECT days FROM attendance_work_calendar WHERE year_month = $1 LIMIT 1`, [period]
  );
  if (!cal || !cal.days) return { ok: false, workdays: 0, days: null };
  let n = 0;
  for (const k of Object.keys(cal.days)) {
    if (Number(cal.days[k]) > 0) n += 1;
  }
  return { ok: true, workdays: n, days: cal.days };
}

// ============================================================
// 三、打卡 → 班次实例 → 逐段工时
// ============================================================
/**
 * 单个出勤日的切片。不落库，纯计算 —— 便于试算与单元测试。
 *
 * @param {object} p
 *   @param {string|Date} p.workDate  归属日（起班当天）
 *   @param {Date|string} p.checkIn
 *   @param {Date|string} p.checkOut
 *   @param {object} p.bandSet        loadBandSet() 的返回
 *   @param {string} [p.dayKind]      不传则按日历判定
 *   @param {string} [p.shiftType]    'day' | 'night'；不传则按班次定义推导
 *   @param {string} [p.shiftCode]    班次代码（day / night）；传了才做迟到早退惩罚
 *   @param {number} [p.lateMinutes]  显式迟到分钟；不传则按计划上班时刻推导
 *   @param {number} [p.earlyMinutes] 显式早退分钟；不传则按计划下班时刻推导
 */
export async function sliceDay({
  workDate, checkIn, checkOut, bandSet, dayKind,
  shiftType = null, shiftCode = null,
  lateMinutes = null, earlyMinutes = null, exemptMode = 'B'
}) {
  const d = toDateStr(workDate);
  let kind = dayKind;
  let dayInfo = null;
  if (!kind) {
    dayInfo = await resolveDayKind(d);
    if (!dayInfo.dayKind) {
      return {
        workDate: d, status: 'blocked', blockReason: 'calendar_missing',
        message: d + ' 的日历缺失，不计算（宁可算不出，不可算错）'
      };
    }
    kind = dayInfo.dayKind;
  }

  if (!checkIn || !checkOut) {
    return { workDate: d, dayKind: kind, status: 'blocked', blockReason: 'no_punch', message: d + ' 缺少打卡记录' };
  }

  const base = new Date(d + 'T00:00:00Z').getTime();
  const inMin = Math.round((new Date(checkIn).getTime() - base) / 60000);
  let outMin = Math.round((new Date(checkOut).getTime() - base) / 60000);
  if (outMin <= inMin) outMin += MIN_PER_DAY;

  if (inMin < 0) {
    return { workDate: d, dayKind: kind, status: 'blocked', blockReason: 'anomaly', message: '上班时间早于归属日 00:00，请检查归属日' };
  }
  if (outMin - inMin > MIN_PER_DAY * 2) {
    return { workDate: d, dayKind: kind, status: 'blocked', blockReason: 'anomaly', message: '单班跨度超过 48 小时，疑似漏打卡' };
  }

  // 计划班次：决定「属于哪个班次」「几点该下班」——迟到早退都要拿它当基准
  let plan = null;
  if (shiftCode) {
    plan = await resolvePlannedShift(shiftCode);
    if (!plan) {
      return { workDate: d, dayKind: kind, status: 'blocked', blockReason: 'shift_unknown', message: '未知班次代码：' + shiftCode };
    }
    if (!shiftType) shiftType = plan.shiftType;
  }
  // 没排班信息也要能切片（否则整月算不出来），按上班时刻就近归属班次
  if (!shiftType) shiftType = inferShiftType(inMin);

  const sliced = sliceShift({
    inMin, outMin, dayKind: kind, shiftType,
    bands: bandSet.bands, meals: bandSet.meals,
    exemptMode
  });

  // ---------------- 迟到 / 早退 ----------------
  // 惩罚工时 × 被砍位置的倍率 才等于「少算的折算工时」：
  //   迟到砍班次头部（① / ② 都是 1.0）→ 0.5h × 1.0
  //   早退砍班次尾部（④ / ⑥ 都是 1.5）→ 0.5h × 1.5
  // 同日既有迟到又有早退时取较大者，不叠加（避免一天被扣两次）。
  let punctuality = null;
  let converted = sliced.convertedHours;
  if (plan) {
    const planSlice = sliceShift({
      inMin: plan.inMin, outMin: plan.outMin, dayKind: kind, shiftType,
      bands: bandSet.bands, meals: bandSet.meals, exemptMode
    });
    const lateMin = lateMinutes != null ? Math.max(0, Number(lateMinutes) || 0)
      : Math.max(0, inMin - plan.inMin);
    const earlyMin = earlyMinutes != null ? Math.max(0, Number(earlyMinutes) || 0)
      : Math.max(0, plan.outMin - outMin);

    const latePen = lateMin > 0 ? latePenaltyHours(lateMin) : 0;
    const earlyPen = earlyMin > 0 ? earlyPenaltyHours(earlyMin) : 0;

    let penHours = latePen, cutRate = planSlice.headRate, penKind = 'late';
    if (earlyPen * planSlice.tailRate > latePen * planSlice.headRate) {
      penHours = earlyPen; cutRate = planSlice.tailRate; penKind = 'early';
    }
    if (!penHours) penKind = null;

    const adj = applyPunctualityPenalty({
      naturalConverted: sliced.convertedHours,
      expectedConverted: planSlice.convertedHours,
      penaltyHours: penHours,
      cutRate
    });
    converted = adj.converted;

    punctuality = {
      shiftCode,
      plannedInMin: plan.inMin,
      plannedOutMin: plan.outMin,
      plannedPayableHours: planSlice.payableHours,
      plannedConvertedHours: planSlice.convertedHours,
      lateMinutes: lateMin,
      earlyMinutes: earlyMin,
      penaltyKind: penKind,
      penaltyHours: penHours,
      penaltyConvertedHours: adj.penaltyConverted,
      naturalShortfallHours: adj.shortfall,
      extraDeductHours: adj.extraDeduct,
      cutRate,
      naturalConvertedHours: sliced.convertedHours,
      adjustedConvertedHours: adj.converted
    };
  }

  return {
    workDate: d,
    dayKind: kind,
    shiftType: shiftType || null,
    shiftCode: shiftCode || null,
    daySource: dayInfo ? dayInfo.source : 'param',
    status: 'computed',
    inMin,
    outMin,
    crossDay: outMin > MIN_PER_DAY,
    spanMinutes: sliced.spanMinutes,
    segments: sliced.segments,
    payableHours: sliced.payableHours,
    convertedHours: converted,
    naturalConvertedHours: sliced.convertedHours,
    exemptHours: sliced.exemptHours,
    otHours: sliced.otHours,
    headRate: sliced.headRate,
    tailRate: sliced.tailRate,
    uncoveredMinutes: sliced.uncoveredMinutes,
    uncoveredWarning: sliced.uncoveredWarning,
    punctuality,
    lateMinutes: punctuality ? punctuality.lateMinutes : (Number(lateMinutes) || 0)
  };
}

// ============================================================
// 四、月度汇总（W / B / 偏差）
// ============================================================
/**
 * 算某用户某月的完整计薪底稿。**只算不写库**。
 *
 * @param {object} p
 *   @param {number} p.userId
 *   @param {string} p.period  'YYYY-MM'
 *   @param {Array}  p.punches [{ workDate, checkIn, checkOut, dayKind? }]
 *   @param {number} [p.paidLeaveDays=0]
 *   @param {number|null} [p.quotaCapHours=null]
 */
export async function computeMonthSheet({
  userId, period, punches = [], paidLeaveDays = 0, quotaCapHours = null, bandSetId = null,
  shiftType = null, shiftCode = null, exemptMode = 'B'
}) {
  const bandSet = await loadBandSet(bandSetId);
  const cal = await getMonthWorkdays(period);

  const days = [];
  const dayMap = new Map();
  for (const p of punches) {
    const d = toDateStr(p.workDate);
    if (!d.startsWith(period)) continue;
    dayMap.set(d, p);
  }

  // 逐日切片（有打卡的才切；没打卡的日不生成工时，缺勤由 B − W 自然体现）
  const keys = [...dayMap.keys()].sort();
  for (const d of keys) {
    const p = dayMap.get(d);
    const r = await sliceDay({
      workDate: d, checkIn: p.checkIn, checkOut: p.checkOut, bandSet,
      dayKind: p.dayKind,
      shiftType: p.shiftType || shiftType,
      shiftCode: p.shiftCode || shiftCode,
      lateMinutes: p.lateMinutes != null ? p.lateMinutes : null,
      earlyMinutes: p.earlyMinutes != null ? p.earlyMinutes : null,
      exemptMode
    });
    days.push(r);
  }

  const computed = days.filter(x => x.status === 'computed');
  const blocked = days.filter(x => x.status === 'blocked');

  const W = round(computed.reduce((a, x) => a + x.convertedHours, 0));
  const naturalW = round(computed.reduce(
    (a, x) => a + (x.naturalConvertedHours != null ? x.naturalConvertedHours : x.convertedHours), 0
  ));
  const penaltyDeduct = round(naturalW - W);
  const payableSum = round(computed.reduce((a, x) => a + x.payableHours, 0));
  const exemptSum = round(computed.reduce((a, x) => a + x.exemptHours, 0));
  const otSum = round(computed.reduce((a, x) => a + x.otHours, 0));
  const uncovered = computed.reduce((a, x) => a + (x.uncoveredMinutes || 0), 0);

  const punctuality = computed
    .filter(x => x.punctuality && x.punctuality.penaltyHours > 0)
    .map(x => ({
      workDate: x.workDate,
      kind: x.punctuality.penaltyKind,
      lateMinutes: x.punctuality.lateMinutes,
      earlyMinutes: x.punctuality.earlyMinutes,
      penaltyHours: x.punctuality.penaltyHours,
      cutRate: x.punctuality.cutRate,
      extraDeductHours: x.punctuality.extraDeductHours
    }));

  const B = computeQuota({ workdayCount: cal.workdays, capHours: quotaCapHours });
  const paidLeaveHours = round((Number(paidLeaveDays) || 0) * 8);

  // 十段月度透视
  const bandAgg = {};
  for (const x of computed) {
    for (const s of x.segments) {
      const a = bandAgg[s.code] || (bandAgg[s.code] = {
        code: s.code, seq: s.seq, name: s.name, dayKind: s.dayKind,
        payableHours: 0, convertedHours: 0, exemptHours: 0, rate: s.adoptedRate
      });
      a.payableHours = round(a.payableHours + s.payableHours);
      a.convertedHours = round(a.convertedHours + s.convertedHours);
      a.exemptHours = round(a.exemptHours + s.exemptHours);
    }
  }

  return {
    userId,
    period,
    bandSetId: bandSet.setId,
    shiftType,
    shiftCode,
    calendar: cal,
    B,
    quotaCapHours,
    W,
    naturalW,
    penaltyDeduct,
    punctuality,
    paidLeaveHours,
    WWithLeave: round(W + paidLeaveHours),
    payableHours: payableSum,
    exemptHours: exemptSum,
    otHours: otSum,
    uncoveredMinutes: uncovered,
    attendDays: computed.length,
    blockedDays: blocked.length,
    blocked: blocked.map(b => ({ workDate: b.workDate, reason: b.blockReason, message: b.message })),
    bands: Object.values(bandAgg).sort((a, b) => a.seq - b.seq),
    days
  };
}

// ============================================================
// 工具
// ============================================================
function toDateStr(x) {
  if (typeof x === 'string') return x.slice(0, 10);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  throw new TypeError('日期格式不支持：' + x);
}

/** TIME 类型 → 'HH:MM' */
function hhmm(t) {
  if (typeof t === 'string') return t.slice(0, 5);
  const h = String(t.getUTCHours ? t.getUTCHours() : t.hours).padStart(2, '0');
  const m = String(t.getUTCMinutes ? t.getUTCMinutes() : t.minutes).padStart(2, '0');
  return h + ':' + m;
}

export { toDateStr, hhmm };
