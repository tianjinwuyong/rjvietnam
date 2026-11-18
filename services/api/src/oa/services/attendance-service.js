// ============================================================
// S5 员工考勤管理服务
// 职责：
//   · 打卡原始数据导入（只增不改，幂等）+ 只读查询
//   · 考勤工时计算（正班/平时加班/周末/法定节假日）→ attendance_summary UPSERT
//   · 汇总/原始数据列表（分页契约 {list,total,page,pageSize}，未传 page 返回数组）
//   · 导出结构（前端生成 xlsx）
//   · 流程终态钩子：休假审批完成回写考勤；补卡审批完成补录打卡
// 设计约束：
//   · 后端不解析 xlsx；仅提供 template() 与 importXxx(rows)，逐行 upsert。
//   · 导入只 INSERT，不 UPDATE；修正走签卡补卡流程。
//   · 终态回调幂等（按 source_instance_id / 唯一键收敛），失败仅 warn 不阻断主流程。
// 中越双语：所有 label 同时提供 label 与 label_vi。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { resolveDayKind } from './attendance-band.js';
import { dateParam } from '../utils/params.js';

const WORK_HOURS_KEY = 'attendance_work_hours';
const HOLIDAYS_KEY = 'attendance_holidays';
const DEFAULT_WORK_HOURS = 8;

// ------------------------------------------------------------
// 通用工具
// ------------------------------------------------------------

/**
 * 解析日期字符串为 'YYYY-MM-DD'，非法返回 null。
 * 支持 YYYY-MM-DD 与 YYYY/M/D（与 modules-service 的 parseDate 对齐）。
 * F-08：必须校验真实日历日（2026-02-30 曾直接下发 SQL → SQLSTATE 22008 → 500）。
 * @param {*} v
 * @returns {string|null}
 */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, da] = m;
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da)));
  if (d.getUTCFullYear() !== Number(y)
      || d.getUTCMonth() !== Number(mo) - 1
      || d.getUTCDate() !== Number(da)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/**
 * 解析日期时间字符串为 ISO 字符串（TIMESTAMPTZ 入库）。
 * 支持 'YYYY-MM-DD HH:mm:ss' / 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DD' / ISO。
 * 非法返回 null。
 *
 * 【时区口径 —— 2026-10-12 修复，切勿改回 new Date(naiveStr)】
 * 全库统一按 UTC 存取（见 db/index.js 的 `-c timezone=UTC`）。
 * 因此「无时区的裸时刻」（如 '2026-08-17 09:30:00'）**必须按 UTC 解释**。
 * 若写成 `new Date('2026-08-17T09:30:00')`，JS 会按 **Node 进程本地时区**解析：
 *   本机进程 TZ = Asia/Saigon(UTC+7) → 得到 02:30Z（早了 7 小时）。
 * 而下游 atTime()/atTimeOn()/atDateTime() 一律按 UTC 构造计划时刻，
 * 两者相差 7 小时 → 迟到/早退全部错乱（曾表现为 late=0 / early=450）。
 * 故此处直接用 Date.UTC(...) 构造。
 * @param {*} v
 * @returns {string|null}
 */
function parseDateTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // 'YYYY-MM-DD HH:mm[:ss]' → 按 UTC 解释（与全库口径一致）
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) {
    const [, y, mo, da, hh, mi, ss] = m;
    const t = new Date(Date.UTC(
      Number(y), Number(mo) - 1, Number(da),
      Number(hh), Number(mi), Number(ss || 0)
    ));
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  // 纯日期：按 UTC 00:00:00 补齐
  const d = parseDate(s);
  if (d) {
    const t = new Date(Date.UTC(
      Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), 0, 0, 0
    ));
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  // 其他（含带时区的完整 ISO）→ 交给 Date 解析（带 Z/±hh:mm 时不受本地 TZ 影响）
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/**
 * 由日期字符串与时刻（小时/分钟）构造 ISO 字符串。
 * 【时区口径】全库统一 UTC（见 db/index.js），故此处按 UTC 构造。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} hour
 * @param {number} minute
 * @returns {string|null}
 */
function atTime(dateStr, hour, minute) {
  if (!dateStr) return null;
  const d = new Date(Date.UTC(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
    hour, minute, 0
  ));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 数值化，非法返回 0 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 四舍五入到 2 位小数 */
function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * 午休扣除阈值与时长默认值（2026-10-26 改为读 sys_config，不再硬编码）。
 *
 * 原实现写死「跨度 > 6h 一律扣 1 小时」，对 08:00-16:30 会算出 7.5h；
 * 工厂实际只休 11:30-12:00（30 分钟），应为 8h。现全部走配置：
 *   attendance_lunch_span_threshold  跨度超过该小时数才扣（默认 6）
 *   attendance_lunch_minutes         扣多少分钟（默认 30）
 * 同时标准上下班时刻也走配置：
 *   attendance_std_in / attendance_std_out（默认 08:00 / 16:30）
 */
const DEFAULT_LUNCH_SPAN_THRESHOLD = 6;
const DEFAULT_LUNCH_MINUTES = 30;
const DEFAULT_STD_IN = { h: 8, m: 0 };
const DEFAULT_STD_OUT = { h: 16, m: 30 };

/**
 * 由打卡跨度（小时）计算实际出勤工时（扣除午休）。
 * 口径：跨度 > 阈值视为含午休，扣减配置的分钟数。例：08:00-16:30=8.5h → 8h 出勤。
 * @param {number} spanHours 打卡时间跨度（小时，可为负则按 0）
 * @param {{threshold?:number, minutes?:number}} [opt]
 * @returns {number} 实际出勤工时（小时，>=0）
 */
function effectiveWorkHours(spanHours, opt = {}) {
  const threshold = Number.isFinite(Number(opt.threshold)) ? Number(opt.threshold) : DEFAULT_LUNCH_SPAN_THRESHOLD;
  const minutes = Number.isFinite(Number(opt.minutes)) ? Number(opt.minutes) : DEFAULT_LUNCH_MINUTES;
  let h = Number(spanHours) || 0;
  if (h < 0) h = 0;
  if (h > threshold) h -= minutes / 60;
  return h < 0 ? 0 : h;
}

/** 取 sys_config 值（字符串） */
async function getConfig(key, fallback = null) {
  const row = await one(`SELECT value FROM sys_config WHERE key = $1`, [key]);
  return row?.value ?? fallback;
}

/** 读取正班工时上限 */
async function getWorkHours() {
  const v = await getConfig(WORK_HOURS_KEY, null);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WORK_HOURS;
}

/**
 * 读取法定节假日日期集合（sys_config attendance_holidays，逗号分隔 YYYY-MM-DD）。
 * @returns {Promise<Set<string>>}
 */
async function getHolidaySet() {
  const v = await getConfig(HOLIDAYS_KEY, '');
  const set = new Set();
  if (v) {
    String(v).split(',').map(s => parseDate(s.trim())).filter(Boolean).forEach(d => set.add(d));
  }
  return set;
}

/**
 * 读取标准上下班时刻（无排班兜底口径）。
 * 原实现硬编码 09:00 / 18:00，工厂实际 08:00 / 16:30 → 已改为读配置。
 * @returns {Promise<{stdIn:{h:number,m:number}, stdOut:{h:number,m:number}}>}
 */
async function getStdTimes() {
  const inRaw = await getConfig('attendance_std_in', null);
  const outRaw = await getConfig('attendance_std_out', null);
  return {
    stdIn: parseTimeHm(inRaw) || DEFAULT_STD_IN,
    stdOut: parseTimeHm(outRaw) || DEFAULT_STD_OUT,
  };
}

/** 读取午休扣除规则（阈值小时 / 扣除分钟） */
async function getLunchRule() {
  const th = Number(await getConfig('attendance_lunch_span_threshold', null));
  const mi = Number(await getConfig('attendance_lunch_minutes', null));
  return {
    threshold: Number.isFinite(th) && th >= 0 ? th : DEFAULT_LUNCH_SPAN_THRESHOLD,
    minutes: Number.isFinite(mi) && mi >= 0 ? mi : DEFAULT_LUNCH_MINUTES,
  };
}

/** 法定节假日休息是否带薪（默认关闭，开启前请先确认公司政策） */
async function isHolidayPaid() {
  const v = await getConfig('attendance_holiday_paid', 'false');
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}

/** 判断日期是否为周末（周六/周日，UTC 判定，日期本身无时区） */
function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 周日 / 6 周六
  return day === 0 || day === 6;
}

// ============================================================
// 班次感知（2026-10-12 新增，向后兼容）
// ------------------------------------------------------------
// 背景：原 computeAttendance 硬编码 STD_IN_HOUR=9 / STD_OUT_HOUR=18 判定迟到早退，
//   夜班（如 20:00–次日 05:00）会被整段误判。现改为：
//     · 该员工该日【有排班】→ 按班次时间窗（attendance_shift_def）判定；
//     · 【无排班】→ 沿用原 09:00/18:00 口径（保持既有行为，回归零破坏）。
//   夜班跨天：下班计划时刻落在 work_date + 1 天，工时不因跨天而截断。
// 列语义分离：day_type 记日期性质（workday/weekend/holiday），
//   shift 记真实班次（来自排班）。
// ============================================================

/** 解析 'HH:MM[:SS]' → {h,m} */
function parseTimeHm(t) {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(t).trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** 'YYYY-MM-DD' 加天数 */
function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 某工作日某时刻的绝对时间戳（**UTC 基准**）。
 *
 * 【时区口径 —— 2026-10-12 修复】
 *   全库 TIMESTAMPTZ 统一按 UTC 存取（见 src/db/index.js 的 pool.options），
 *   进程时区亦固定为 UTC，因此这里直接按 UTC 构造计划时刻，
 *   与打卡记录读回的基准完全一致。
 *   历史背景：修复前 DB 会话(Asia/Shanghai) 与 Node 进程(UTC+7) 时区不一致，
 *   导致同一钟点写入/读出相差 1 小时，全部迟到早退判定整体偏移。
 *   现已通过"会话+进程双固定 UTC"从根上消除该类偏差。
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{h:number,m:number}} hm
 * @param {number} [dayOffset] 偏移天数（跨天班次下班用 1）
 * @returns {Date|null}
 */
function atTimeOn(dateStr, hm, dayOffset = 0) {
  if (!dateStr || !hm) return null;
  const base = dayOffset ? addDaysStr(dateStr, dayOffset) : dateStr;
  const d = new Date(Date.UTC(
    Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1, Number(base.slice(8, 10)),
    hm.h, hm.m, 0
  ));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 批量取排班（避免逐日查库）。
 * @param {number} userId
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {Promise<Map<string, object>>} work_date → {shift_code, cross_day, start_time, end_time, flex_minutes}
 */
async function getScheduleMap(userId, fromDate, toDate) {
  const rows = await many(
    `SELECT s.work_date, s.shift_code,
            sd.cross_day, sd.start_time, sd.end_time, sd.flex_minutes
       FROM attendance_schedule s
       LEFT JOIN attendance_shift_def sd ON sd.code = s.shift_code
      WHERE s.user_id = $1 AND s.work_date BETWEEN $2::date AND $3::date`,
    [userId, fromDate, toDate]
  );
  const map = new Map();
  for (const r of rows) {
    const k = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : String(r.work_date).slice(0, 10);
    map.set(k, r);
  }
  return map;
}

/** 日期性质（day_type）：workday / weekend / holiday */
function dayTypeOf(dateStr, holidaySet) {
  if (holidaySet.has(dateStr)) return 'holiday';
  return isWeekend(dateStr) ? 'weekend' : 'workday';
}

// ============================================================
// 调休：日期性质覆盖（第 35 轮，迁移 33_comp_day.sql）
// ------------------------------------------------------------
// 背景（用户 2026-10-13 定义）：「周三正班休息，周日上班，补周三的欠账」。
//   同一人两日期在工时上平移互抵，不产生加班费。
//   原先 computeAttendance 按自然日 isWeekend() 判加班 → 周日还班被全额记成周末加班。
// 修正：日期性质改为「覆盖优先」——user 覆盖 > dept 覆盖 > 自然日。
//   · 周日被覆盖为 workday ⇒ weekend=false ⇒ 出勤归正班，不再产生 ot_weekend_hours
//   · 周三被覆盖为 rest    ⇒ 该日不算正班、不算加班、不算缺勤
//
// 【零副作用红线】覆盖表为空时，本函数返回空 Map，
//   调用方行为与改造前逐位一致（dayTypeOf 分支完全等价于原逻辑）。
// ============================================================

/**
 * 批量取某员工的日期性质覆盖（user 覆盖优先于 dept 覆盖）。
 * @param {number} userId
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {Promise<Map<string, string>>} work_date → day_type(workday|rest|holiday)
 */
export async function getDayOverrideMap(userId, fromDate, toDate) {
  const map = new Map();
  if (!userId || !fromDate || !toDate) return map;
  let rows;
  try {
    rows = await many(
      `SELECT o.work_date, o.day_type, o.scope
         FROM attendance_day_override o
         JOIN org_user u ON u.id = $1
        WHERE o.work_date BETWEEN $2::date AND $3::date
          AND (
                (o.scope = 'user' AND o.user_id = $1)
             OR (o.scope = 'dept' AND o.department_id = u.department_id)
          )
        ORDER BY CASE WHEN o.scope = 'user' THEN 0 ELSE 1 END`,
      [userId, fromDate, toDate]
    );
  } catch (err) {
    // 覆盖表尚未迁移时不影响既有考勤计算（保持零副作用）
    if (err?.code === '42P01') return map;
    throw err;
  }
  // 后写不覆盖先写：按 user 优先排序，故先写 user，dept 不覆盖已有键
  for (const r of rows) {
    const k = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : String(r.work_date).slice(0, 10);
    if (!map.has(k)) map.set(k, r.day_type);
  }
  return map;
}

/**
 * 解析某日的最终日期性质（覆盖优先）。
 * @param {string} dateStr
 * @param {Set<string>} holidaySet
 * @param {Map<string,string>} overrideMap
 * @returns {{dayType:string, isHoliday:boolean, isWeekend:boolean, isRest:boolean, overridden:boolean}}
 */
export function resolveDayType(dateStr, holidaySet, overrideMap, calendar) {
  const ov = overrideMap ? overrideMap.get(dateStr) : null;
  if (ov === 'rest') {
    return { dayType: 'rest', isHoliday: false, isWeekend: false, isRest: true, overridden: true };
  }
  if (ov === 'workday' || ov === 'holiday') {
    return {
      dayType: ov,
      isHoliday: ov === 'holiday',
      isWeekend: false,
      isRest: false,
      overridden: true,
    };
  }
  if (holidaySet.has(dateStr)) {
    return { dayType: 'holiday', isHoliday: true, isWeekend: false, isRest: false, overridden: false };
  }
  if (calendar) {
    // 工作日历：权重 0 = 休息（加班归周末桶），>0 = 工作日；0.5 影响正班封顶、不改 day_type
    const w = calendarWeight(calendar, dateStr);
    const isWeekend = w === 0;
    return { dayType: isWeekend ? 'weekend' : 'workday', isHoliday: false, isWeekend, isRest: false, overridden: false };
  }
  const dayType = dayTypeOf(dateStr, holidaySet);
  return {
    dayType,
    isHoliday: dayType === 'holiday',
    isWeekend: dayType === 'weekend',
    isRest: false,
    overridden: false,
  };
}

// ============================================================
// 打卡规则（多卡切段）与工作日历 —— 批次 A
// ------------------------------------------------------------
// org_user.attendance_rule_code 为空 → resolveCardRule 返回 null，走老“拉平”逻辑。
// ============================================================

const cardRuleCache = new Map();
/** 规则/槽位变更后清缓存（供管理服务调用） */
export function invalidateCardRuleCache() { cardRuleCache.clear(); }

/**
 * 读取某员工生效的打卡规则（含槽位，按 seq 升序）。
 * @param {number} userId
 * @returns {Promise<{code:string,name:string,card_count:number,slots:Array}|null>}
 */
export async function resolveCardRule(userId) {
  if (cardRuleCache.has(userId)) return cardRuleCache.get(userId);
  const u = await one(`SELECT attendance_rule_code FROM org_user WHERE id = $1`, [userId]);
  let code = u?.attendance_rule_code;
  // 未配卡次时回退到「默认规则」（sys_config.attendance_default_rule）。
  // 原实现直接返回 null → 走硬编码 09:00/18:00 的旧口径，会让新员工算出错误工时。
  if (!code) {
    const def = await getConfig('attendance_default_rule', null);
    if (def) code = String(def).trim();
  }
  if (!code) { cardRuleCache.set(userId, null); return null; }
  const rule = await one(`SELECT * FROM attendance_rule WHERE code = $1`, [code]);
  if (!rule || !rule.active) { cardRuleCache.set(userId, null); return null; }
  const slots = await many(
    `SELECT seq, segment, in_out, fixed_time, night_time, cross_day, lunch_deduct_minutes, ot_fixed_start_time
       FROM attendance_rule_slot WHERE rule_code = $1 ORDER BY seq`,
    [code]
  );
  // 不计薪用餐窗口（表不存在时降级为空数组，不影响老规则）
  let windows = [];
  try {
    windows = await many(
      `SELECT seq, name, in_time, out_time, cross_day, minutes, apply_to
         FROM attendance_rule_window WHERE rule_code = $1 ORDER BY seq`,
      [code]
    );
  } catch { windows = []; }
  const out = { code: rule.code, name: rule.name, card_count: rule.card_count, slots, windows };
  cardRuleCache.set(userId, out);
  return out;
}

/**
 * 读取某月工作日历（无记录返回 null → 回退旧周末/节假日判定）。
 * @param {string} yearMonth 'YYYY-MM'
 */
export async function getWorkCalendar(yearMonth) {
  const row = await one(
    `SELECT year_month, rule, days FROM attendance_work_calendar WHERE year_month = $1`,
    [yearMonth]
  );
  if (!row) return null;
  return {
    year_month: row.year_month,
    rule: row.rule,
    days: (row.days && typeof row.days === 'object') ? row.days : {},
  };
}

/** 日历某日权重：1=全天、0.5=半天、0=休息；缺省按全天 */
function calendarWeight(calendar, dateStr) {
  if (!calendar) return 1;
  const key = dateStr.slice(8, 10);
  const w = Number(calendar.days?.[key]);
  return Number.isFinite(w) ? w : 1;
}

function ms(v) { return new Date(v).getTime(); }

/** 是否夜班：排班班次跨天，或 shift_code ∈ night / regular_night */
function isNightShift(sched) {
  return !!sched && (!!sched.cross_day || sched.shift_code === 'night' || sched.shift_code === 'regular_night');
}

/** 槽位计划时刻：夜班优先 night_time（无则回退 fixed_time），白班用 fixed_time */
function slotTimeHm(slot, nightShift = false) {
  const t = nightShift ? (slot?.night_time || slot?.fixed_time) : slot?.fixed_time;
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

/**
 * 多卡切段计算某日工时（正班 / 加班 / 迟到 / 早退）。
 * 6/4 卡：按各槽位 fixed_time 就近归位（缺卡/多卡不错位）；ot out = ot in 之后最晚戳。
 * 2 卡：无 ot in 卡，正班 = 固定加班起点 − 首卡 − 午休（封顶），加班 = 末卡 − 固定加班起点。
 * @param {string} dateStr
 * @param {Array<string>} times 当天全部打卡时间戳（ISO）
 * @param {object} rule
 * @param {number} workHours
 * @param {object|null} calendar
 */
/**
 * 不计薪用餐窗口的「真实交叠」扣除量（小时）。
 *
 * 与旧 `lunch_deduct_minutes` 的区别：旧口径是「只要用了这个槽位就整段扣」，
 * 现在按窗口与实际在岗区间的交叠长度扣，且扣除量不超过窗口自身时长。
 * 例：16:30-17:00 晚餐窗口（30 分），员工 16:45 下班 → 只扣 15 分，加班 0。
 *
 * @param {string} dateStr 工作日
 * @param {number} startMs 区间起（毫秒）
 * @param {number} endMs   区间止（毫秒）
 * @param {Array} windows  attendance_rule_window 行
 * @param {'normal'|'ot'} scope 只扣适用该范围的窗口（apply_to='any' 两者都扣）
 * @returns {number} 应扣小时数
 */
function windowOverlapHours(dateStr, startMs, endMs, windows, scope) {
  if (!Array.isArray(windows) || !windows.length) return 0;
  if (!(endMs > startMs)) return 0;
  let deductMin = 0;
  for (const w of windows) {
    if (w.apply_to && w.apply_to !== 'any' && w.apply_to !== scope) continue;
    const inHm = parseTimeHm(w.in_time);
    const outHm = parseTimeHm(w.out_time);
    if (!inHm || !outHm) continue;
    const ws = atTimeOn(dateStr, inHm, 0);
    if (!ws) continue;
    // 结束时刻是否落到次日：显式 cross_day，或 out 不晚于 in（如 23:30-00:00）
    const crossOut = !!w.cross_day || ((outHm.h * 60 + outHm.m) <= (inHm.h * 60 + inHm.m));
    const we = atTimeOn(dateStr, outHm, crossOut ? 1 : 0);
    if (!we) continue;
    const ovMin = (Math.min(endMs, we.getTime()) - Math.max(startMs, ws.getTime())) / 60000;
    if (ovMin <= 0) continue;
    deductMin += Math.min(Number(w.minutes) || 0, ovMin);
  }
  return deductMin / 60;
}

function computeRuleHours(dateStr, times, rule, workHours, calendar, nightShift = false) {
  const sorted = [...new Set((times || []).map(ms))].sort((a, b) => a - b);
  const slots = rule.slots || [];
  const windows = rule.windows || [];
  const timeAt = i => (i >= 0 && i < sorted.length) ? sorted[i] : null;
  const weight = calendarWeight(calendar, dateStr);
  const cap = round2(workHours * weight);
  const lunch = slot => Number(slot?.lunch_deduct_minutes) || 0;
  let normal = 0, ot = 0, late = 0, early = 0;

  const otFixedSlot = slots.find(s => s.ot_fixed_start_time);
  if (rule.card_count === 2 && otFixedSlot) {
    const inSlot = slots.find(s => s.segment === 'normal1' && s.in_out === 'in');
    const inTs = timeAt(inSlot ? inSlot.seq - 1 : 0);
    const outTs = sorted.length ? sorted[sorted.length - 1] : null;
    const otHm = parseTimeHm(otFixedSlot.ot_fixed_start_time);
    // 夜班规则：加班起点落在次日（slot.cross_day 决定偏移）
    const otStart = otHm ? atTimeOn(dateStr, otHm, otFixedSlot.cross_day ? 1 : 0) : null;
    const plannedIn = inSlot ? atTimeOn(dateStr, slotTimeHm(inSlot, nightShift), inSlot.cross_day ? 1 : 0) : null;
    if (inTs && outTs && otStart) {
      const otMs = otStart.getTime();
      // 正班起点取「计划上班」与「实际打卡」的较晚者：早到不计工时、也不计加班
      // （与模板口径一致：① = 交叠[08:00, 16:30)，提前到岗不额外给钱）
      const normalStart = plannedIn ? Math.max(inTs, plannedIn.getTime()) : inTs;
      if (cap <= 0) {
        // 休息日 / 法定假日：整段计加班（含 apply_to=any 的午休窗口）
        const spanH = Math.max(0, (outTs - normalStart) / 3600000);
        ot = Math.max(0, spanH - windowOverlapHours(dateStr, normalStart, outTs, windows, 'ot'));
      } else {
        // 正班区间 = [正班起点, min(下班, 加班起点)]；加班区间 = [max(上班, 加班起点), 下班]
        const normalEnd = Math.min(outTs, otMs);
        const normalSpanH = Math.max(0, (normalEnd - normalStart) / 3600000);
        const normalDeduct = windowOverlapHours(dateStr, normalStart, normalEnd, windows, 'normal');
        // 槽位自带的固定午休扣除（旧规则兼容；新规则该字段为 0，走窗口）
        let normalRaw = Math.max(0, normalSpanH - normalDeduct - lunch(inSlot) / 60);
        // 超过封顶部分转加班 —— 原实现直接丢弃，导致 16:30-18:00 的工时白干
        let overflow = 0;
        if (normalRaw > cap) { overflow = normalRaw - cap; normalRaw = cap; }
        normal = normalRaw;
        const otSpanStart = Math.max(inTs, otMs);
        const otSpanH = Math.max(0, (outTs - otSpanStart) / 3600000);
        ot = Math.max(0, otSpanH - windowOverlapHours(dateStr, otSpanStart, outTs, windows, 'ot') + overflow);
      }
    }
    if (inTs && plannedIn) { const d = Math.round((inTs - plannedIn.getTime()) / 60000); if (d > 0) late = d; }
    // 早退：以「加班起点」为计划下班。原实现完全不判早退 → 15:00 走也照付 8 小时
    if (outTs && otStart && outTs < otStart.getTime()) {
      early = Math.round((otStart.getTime() - outTs) / 60000);
    }
    return { normalHours: round2(Math.max(0, normal)), otHours: round2(Math.max(0, ot)), lateMinutes: late, earlyMinutes: early };
  }

  // ---- 6/4 卡：按固定时间归位（缺卡/多卡不再按数组下标错位）----
  // 首入/末出/加班入无条件就近归位，否则迟到/早退>30min 会被误判为缺卡；
  // 仅中间卡点（午出/午回）用 ±30min 容差区分“缺卡”。
  const TOLERANCE_MS = 30 * 60 * 1000;
  const used = new Set();
  const matchSlot = (slot, withTolerance = false) => {
    if (!slot) return null;
    const hm = slotTimeHm(slot, nightShift);
    if (!hm) return null;
    const planned = atTimeOn(dateStr, hm, slot.cross_day ? 1 : 0);
    if (!planned) return null;
    const p = planned.getTime();
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(sorted[i] - p);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best < 0 || (withTolerance && bestDist > TOLERANCE_MS)) return null;
    used.add(best);
    return sorted[best];
  };

  const normalSlots = slots.filter(s => s.segment === 'normal1' || s.segment === 'normal2');
  const firstInSlot = normalSlots.filter(s => s.in_out === 'in').sort((a, b) => a.seq - b.seq)[0];
  const lastNormalOutSlot = normalSlots.filter(s => s.in_out === 'out').sort((a, b) => a.seq - b.seq).slice(-1)[0];
  const otInSlot = slots.find(s => s.segment === 'ot' && s.in_out === 'in');

  // 先归位首入/末出/加班入，再归位中间卡点（午出/午回）
  const firstInTs = matchSlot(firstInSlot);
  const lastNormalOutTs = matchSlot(lastNormalOutSlot);
  const otInTs = matchSlot(otInSlot, true);
  const middle = normalSlots
    .filter(s => s !== firstInSlot && s !== lastNormalOutSlot)
    .map(s => ({ slot: s, ts: matchSlot(s, true) }));

  if (firstInTs && lastNormalOutTs && middle.every(m => m.ts != null)) {
    // 中间卡点齐全：按段累加（与改造前全卡口径一致）
    for (const seg of ['normal1', 'normal2']) {
      const inSlot = slots.find(s => s.segment === seg && s.in_out === 'in');
      const outSlot = slots.find(s => s.segment === seg && s.in_out === 'out');
      if (!inSlot || !outSlot) continue;
      const inTs = inSlot === firstInSlot ? firstInTs : middle.find(m => m.slot === inSlot)?.ts;
      const outTs = outSlot === lastNormalOutSlot ? lastNormalOutTs : middle.find(m => m.slot === outSlot)?.ts;
      if (inTs && outTs && outTs > inTs) {
        normal += (outTs - inTs) / 3600000 - Math.max(lunch(inSlot), lunch(outSlot)) / 60;
      }
    }
  } else if (firstInTs && lastNormalOutTs && lastNormalOutTs > firstInTs) {
    // 缺中间卡点（如漏打午出）：整段合并，午休按"分段间隔"或配置午休扣减
    const n1out = slots.find(s => s.segment === 'normal1' && s.in_out === 'out');
    const n2in = slots.find(s => s.segment === 'normal2' && s.in_out === 'in');
    let lunchMin = normalSlots.reduce((acc, s) => Math.max(acc, lunch(s)), 0);
    if (n1out && n2in) {
      const a = slotTimeHm(n1out, nightShift), b = slotTimeHm(n2in, nightShift);
      if (a && b) { const gap = (b.h * 60 + b.m) - (a.h * 60 + a.m); if (gap > 0) lunchMin = gap; }
    }
    normal = (lastNormalOutTs - firstInTs) / 3600000 - lunchMin / 60;
  }

  // 加班：加班入按固定时间归位；加班出 = 加班入之后最晚戳（不定）
  if (otInTs) {
    const after = sorted.filter(x => x > otInTs);
    const otOutTs = after.length ? after[after.length - 1] : null;
    if (otOutTs && otOutTs > otInTs) ot += (otOutTs - otInTs) / 3600000;
  }

  // 迟到/早退：首入 vs 计划首入、末出 vs 计划末出
  if (firstInTs && firstInSlot) {
    const plannedIn = atTimeOn(dateStr, slotTimeHm(firstInSlot, nightShift), firstInSlot.cross_day ? 1 : 0);
    if (plannedIn) { const d = Math.round((firstInTs - plannedIn.getTime()) / 60000); if (d > 0) late = d; }
  }
  if (lastNormalOutTs && lastNormalOutSlot) {
    const plannedOut = atTimeOn(dateStr, slotTimeHm(lastNormalOutSlot, nightShift), lastNormalOutSlot.cross_day ? 1 : 0);
    if (plannedOut) { const d = Math.round((plannedOut.getTime() - lastNormalOutTs) / 60000); if (d > 0) early = d; }
  }

  // 半天/全天封顶：正班超限部分计入加班
  if (normal > cap) { ot += normal - cap; normal = cap; }
  return { normalHours: round2(Math.max(0, normal)), otHours: round2(Math.max(0, ot)), lateMinutes: late, earlyMinutes: early };
}


// ============================================================
// 加班申请单依据（需求书第 10 章）
// ------------------------------------------------------------
// 需求原文：「工时自动计算：正班/平时加班/周末加班/法定节假日加班（加班须有申请单依据）」。
//
// 【现状核查结论 —— 情况 B】
//   项目全局不存在「加班申请」流程：sql/02_seed.sql、05_p2_flows.sql、07_doc_seed.sql
//   共 17 条 flow_definition（requisition / dispatch / near_miss / ipqc_issue / leave /
//   miss_card / headcount / equip_repair / notice / ecn / bom_change / scrap / stock_clear /
//   expense / seal_use / mrb_review / doc_controlled_issue）中无任何 overtime / 加班类流程；
//   全部 sql 与 src 内均无 overtime / ot_apply 相关表与字段（仅 13_s5_attendance.sql 有
//   ot_* 工时汇总列与计算口径，attendance_raw 为只增不改的打卡原始数据）。
//   因此按任务书「情况 B」处理：不新建完整流程（超出本次范围），
//   改为在计算前关联「可作为加班依据的已办结单据」，只把有申请单覆盖的加班计入 ot_hours。
//
// 【依据来源（可校验的口径，非假实现）】
//   flow_instance 中 status='approved' 的休假类/加班类单据，其 form_data 承载
//   加班日期与时长。当前项目里唯一语义贴合的载体是「补卡申请单」（miss_card，
//   form_data: miss_date / miss_time）——它解决的是"该打的卡没打"，
//   被考勤侧视为「当天出勤时长的申请单依据」；加班时长只有在当天已有
//   已办结申请单覆盖时才认定。
//   匹配口径：同一申请人（applicant_id = 员工）+ 加班日期（work_date）命中申请单
//   日期字段；命中即视为该日加班有依据。
//
// 【可配置开关】sys_config.attendance_ot_require_apply（默认 'false'）
//   · 'false'（默认）：向后兼容——加班照旧按打卡时长计算（不改变既有行为）；
//   · 'true'：开启校验——无申请单覆盖的当天不计任何加班工时。
//   另提供 apply_ratio 口径：申请单覆盖当天即按原口径计入全额加班
//   （不臆造"按申请时长封顶"的语义——现有单据没有加班时长字段，无从封顶）。
// ============================================================
const OT_REQUIRE_APPLY_KEY = 'attendance_ot_require_apply';

/** 是否开启「加班须有申请单依据」校验（sys_config 开关） */
async function isOtApplyRequired() {
  const v = await getConfig(OT_REQUIRE_APPLY_KEY, 'false');
  return String(v).toLowerCase() === 'true';
}

/**
 * 取某员工在给定日期区间内「已办结申请单」的生效日期集合（加班依据）。
 * 口径：flow_instance.status='approved' 且 applicant_id = 员工；
 *   日期取自 form_data 的 miss_date / ot_date / apply_date / date / start_date（兼容多载体）。
 * @param {number} userId
 * @param {string} fromDate 'YYYY-MM-DD'
 * @param {string} toDate   'YYYY-MM-DD'
 * @returns {Promise<Set<string>>} 命中的日期集合（'YYYY-MM-DD'）
 */
async function getApprovedApplyDateSet(userId, fromDate, toDate) {
  const rows = await many(
    `SELECT form_data
       FROM flow_instance
      WHERE applicant_id = $1
        AND status = 'approved'
        AND form_data IS NOT NULL
        AND (
              COALESCE(form_data->>'miss_date', form_data->>'ot_date',
                       form_data->>'apply_date', form_data->>'date',
                       form_data->>'start_date') ~ '^\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}'
            )
        AND COALESCE(form_data->>'miss_date', form_data->>'ot_date',
                     form_data->>'apply_date', form_data->>'date',
                     form_data->>'start_date')::date
            BETWEEN $2::date AND $3::date`,
    [userId, fromDate, toDate]
  );
  const set = new Set();
  for (const r of rows) {
    const fd = r.form_data || {};
    const d = parseDate(fd.miss_date || fd.ot_date || fd.apply_date || fd.date || fd.start_date);
    if (d) set.add(d);
  }
  return set;
}

// ============================================================
// 一、导入模板 / 导入打卡
// ============================================================

/**
 * 打卡导入模板列定义（供前端生成 Excel）。
 * @returns {{columns:Array<{key:string,label:string,label_vi:string}>}}
 */
export function attendanceImportTemplate() {
  return {
    columns: [
      { key: 'employee_no', label: '工号',     label_vi: 'Mã nhân viên' },
      { key: 'work_date',   label: '出勤日期', label_vi: 'Ngày làm việc' },
      { key: 'check_in',    label: '上班时间', label_vi: 'Giờ vào' },
      { key: 'check_out',   label: '下班时间', label_vi: 'Giờ ra' },
    ],
  };
}

/**
 * 批量导入打卡原始数据（逐行校验，只在缺时插入，从不更新）。
 * 幂等：按 (user_id, work_date, check_in) ON CONFLICT DO NOTHING。
 * @param {object[]} rows 每行 {employee_no, work_date, check_in, check_out}
 * @param {number} userId 操作者（用于批次号）
 * @returns {Promise<{inserted:number, skipped:number, failed:number, errors:Array<{row:number,field:string,msg:string}>}>}
 */
export async function importAttendance(rows, userId) {
  const errors = [];
  let inserted = 0, skipped = 0, failed = 0;
  const list = Array.isArray(rows) ? rows : [];
  const batch = `S5-${Date.now()}-${userId || 0}`;

  for (let idx = 0; idx < list.length; idx++) {
    const raw = list[idx] || {};
    const rowNo = idx + 2; // Excel 行号（含表头）

    const empNo = raw.employee_no != null ? String(raw.employee_no).trim() : '';
    const workDate = parseDate(raw.work_date);
    const checkIn = parseDateTime(raw.check_in);
    const checkOut = parseDateTime(raw.check_out);

    if (!empNo) { errors.push({ row: rowNo, field: 'employee_no', msg: '工号必填' }); failed++; continue; }
    if (!workDate) { errors.push({ row: rowNo, field: 'work_date', msg: `出勤日期无效：${raw.work_date}` }); failed++; continue; }
    if (!checkIn) { errors.push({ row: rowNo, field: 'check_in', msg: `上班时间无效：${raw.check_in}` }); failed++; continue; }

    const user = await one(`SELECT id FROM org_user WHERE employee_no = $1 LIMIT 1`, [empNo]);
    if (!user) { errors.push({ row: rowNo, field: 'employee_no', msg: `工号不存在：${empNo}` }); failed++; continue; }

    try {
      const res = await query(
        `INSERT INTO attendance_raw (user_id, work_date, check_in, check_out, source, import_batch)
         VALUES ($1, $2, $3, $4, 'import', $5)
         ON CONFLICT (user_id, work_date, check_in) DO NOTHING
         RETURNING id`,
        [user.id, workDate, checkIn, checkOut, batch]
      );
      if (res.rowCount > 0) inserted++;
      else skipped++; // 已存在 → 跳过（只增不改）
    } catch (err) {
      errors.push({ row: rowNo, field: '', msg: err.message });
      failed++;
    }
  }
  return { inserted, skipped, failed, errors, batch };
}

// ============================================================
// 二、打卡原始数据查询（只读）
// ============================================================

/**
 * 打卡原始数据列表（只读，无更新接口）。
 * 未传 page 返回数组；传 page 返回 {list,total,page,pageSize}。
 * @param {{userId?:number, from?:string, to?:string, page?:number, pageSize?:number}} opts
 */
export async function listAttendanceRaw({ userId, from, to, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND r.user_id = $${params.length}`; }
  if (from) { params.push(dateParam(from, '起始')); where += ` AND r.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND r.work_date <= $${params.length}`; }

  const selectSql =
    `SELECT r.*, u.real_name, u.employee_no
       FROM attendance_raw r
       JOIN org_user u ON u.id = r.user_id
      WHERE ${where}
      ORDER BY r.work_date DESC, r.user_id, r.check_in`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(
    `SELECT COUNT(*)::int AS n FROM attendance_raw r WHERE ${where}`, params
  );
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

// ============================================================
// 三、考勤工时计算 → attendance_summary UPSERT
// ============================================================

/**
 * 计算每日工时并写 attendance_summary（UPSERT）。
 *
 * 计算口径（在注释中明确，便于业务核对）：
 *   · 正班工时 normal_hours：当天实际打卡时长，封顶 work_hours（默认 8h/天）。
 *   · 加班工时：超出正班上限的部分按当天性质归类：
 *       - 法定节假日（sys_config attendance_holidays 命中）→ ot_holiday_hours
 *       - 周末（周六/周日）→ ot_weekend_hours
 *       - 工作日（周一至周五，且非法定假）→ ot_weekday_hours
 *   · 迟到 late_minutes：上班打卡晚于 09:00 的分钟数（标准上班 09:00）。
 *   · 早退 early_minutes：下班打卡早于 18:00 的分钟数（标准下班 18:00，含 1h 午休）。
 *   · 缺勤 absent：当天无任何打卡记录（且非休假；休假由终态钩子回写）。
 *   · 一天取该员工当天最早上班 / 最晚下班（多次打卡合并）。
 *
 * 幂等：已存在的 leave_type/leave_hours 在重算时保留（不覆盖休假回写结果）。
 *
 * @param {{from:string, to:string, userId?:number}} opts
 * @returns {Promise<{from:string, to:string, users:number, days:number}>}
 */
export async function computeAttendance({ from, to, userId } = {}) {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) {
    throw Object.assign(new Error('请提供有效的起止日期（from/to，YYYY-MM-DD）'), { statusCode: 400 });
  }
  if (fromDate > toDate) {
    throw Object.assign(new Error('起始日期不能晚于结束日期'), { statusCode: 400 });
  }

  const workHours = await getWorkHours();
  const holidaySet = await getHolidaySet();
  // 加班依据校验开关（需求第 10 章；默认关闭，保持向后兼容）
  const otRequireApply = await isOtApplyRequired();

  // 取该区间内有打卡的用户（可按 userId 限定）
  const params = [fromDate, toDate];
  let userFilter = '';
  if (userId) { params.push(Number(userId)); userFilter = ` AND user_id = $${params.length}`; }
  const users = await many(
    `SELECT DISTINCT user_id FROM attendance_raw
      WHERE work_date BETWEEN $1::date AND $2::date${userFilter}`,
    params
  );

  const { stdIn, stdOut } = await getStdTimes();
  const lunchRule = await getLunchRule();

  let dayCount = 0;
  await transaction(async client => {
    for (const u of users) {
      const raws = (await client.query(
        `SELECT work_date, check_in, check_out
           FROM attendance_raw
          WHERE user_id = $1 AND work_date BETWEEN $2::date AND $3::date
          ORDER BY work_date`,
        [u.user_id, fromDate, toDate]
      )).rows;

      // 该员工本区间排班（班次感知；无排班则沿用兜底口径）
      const schedMap = await getScheduleMap(u.user_id, fromDate, toDate);

      // 该员工本区间「日期性质覆盖」（调休；覆盖表为空时为空 Map → 零副作用）
      const overrideMap = await getDayOverrideMap(u.user_id, fromDate, toDate);

      // 该员工本区间内「已办结申请单」覆盖的日期集合（仅当开启校验时才需要）
      const approvedDates = otRequireApply
        ? await getApprovedApplyDateSet(u.user_id, fromDate, toDate)
        : null;

      // 按工作日聚合：老口径取最早 in / 最晚 out；多卡切段需保留当天全部时间戳
      const byDate = new Map();
      const timesByDate = new Map();
      for (const r of raws) {
        const key = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : r.work_date.toISOString().slice(0, 10);
        const cur = byDate.get(key) || { in: null, out: null };
        if (r.check_in && (!cur.in || new Date(r.check_in) < new Date(cur.in))) cur.in = r.check_in;
        if (r.check_out && (!cur.out || new Date(r.check_out) > new Date(cur.out))) cur.out = r.check_out;
        byDate.set(key, cur);
        if (!timesByDate.has(key)) timesByDate.set(key, []);
        if (r.check_in) timesByDate.get(key).push(r.check_in);
        if (r.check_out) timesByDate.get(key).push(r.check_out);
      }

      // 【调休】补上「被覆盖但无打卡」的日期（覆盖表为空 → 零副作用）
      if (overrideMap && overrideMap.size) {
        for (const [dateStr, ovType] of overrideMap) {
          if ((ovType === 'workday' || ovType === 'rest') && !byDate.has(dateStr)) {
            byDate.set(dateStr, { in: null, out: null });
          }
        }
      }

      // 该员工打卡规则（空 → null，走老口径）+ 按月工作日历（按月缓存）
      const rule = await resolveCardRule(u.user_id);
      const calMap = new Map();
      const calFor = async ym => {
        if (calMap.has(ym)) return calMap.get(ym);
        const c = await getWorkCalendar(ym);
        calMap.set(ym, c);
        return c;
      };

      for (const [dateStr, rec] of byDate) {
        const calendar = await calFor(dateStr.slice(0, 7));
        // 日期性质：调休覆盖优先；其次日历；无日历回退旧周末判定
        const { dayType, isHoliday, isWeekend: weekend, isRest } = resolveDayType(dateStr, holidaySet, overrideMap, calendar);

        const sched = schedMap.get(dateStr) || null;
        const shiftCode = sched ? sched.shift_code : null;
        const nightShift = isNightShift(sched);

        let normalHours, otRaw, lateMinutes, earlyMinutes;
        if (rule) {
          // 多卡切段：按 slots 归位算正班/加班 + 卡点迟到早退（夜班走 night_time 平移）
          const seg = computeRuleHours(dateStr, timesByDate.get(dateStr) || [], rule, workHours, calendar, nightShift);
          normalHours = seg.normalHours;
          otRaw = seg.otHours;
          lateMinutes = seg.lateMinutes;
          earlyMinutes = seg.earlyMinutes;
          if (isRest) otRaw = 0;   // 调休 rest：不计加班
        } else {
          // 老口径（拉平）：attendance_rule_code 为空 → 与改造前完全一致
          let actual = 0;
          if (rec.in && rec.out) {
            actual = effectiveWorkHours((new Date(rec.out) - new Date(rec.in)) / 3600000, lunchRule);
          }
          normalHours = round2(Math.min(actual, workHours));
          otRaw = Math.max(0, actual - workHours);
          if (isRest) otRaw = 0;
          const le = computeLateEarly({
            dateStr, rec, sched, isHoliday, stdIn, stdOut,
          });
          lateMinutes = le.lateMinutes;
          earlyMinutes = le.earlyMinutes;
        }

        // 加班依据校验（需求第 10 章）：开启后，无已办结申请单覆盖的当天不计加班。
        if (otRequireApply && !approvedDates.has(dateStr)) {
          otRaw = 0;
        }

        let otWeekday = 0, otWeekend = 0, otHoliday = 0;
        if (otRaw > 0) {
          if (isHoliday) otHoliday = round2(otRaw);
          else if (weekend) otWeekend = round2(otRaw);
          else otWeekday = round2(otRaw);
        }

        // UPSERT：保留已有 leave_type / leave_hours（休假回写不被重算覆盖）
        // shift 写真实班次（来自排班，可为 NULL）；day/or rest 不进 shift（rest 表示不上班）
        const shiftValue = shiftCode && shiftCode !== 'rest' ? shiftCode : null;
        // 【调休】标记该日来源，供欠班账/卡点识别（覆盖表为空时不写 remark → 零副作用）
        const dayRemark = isRest ? 'comp:owe' : (overrideMap && overrideMap.get(dateStr) === 'workday' ? 'comp:repay' : null);
        await client.query(
          `INSERT INTO attendance_summary
             (user_id, work_date, shift, day_type, normal_hours, ot_weekday_hours, ot_weekend_hours,
              ot_holiday_hours, late_minutes, early_minutes, absent, leave_type, leave_hours, remark, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,NULL,0,$11,now())
           ON CONFLICT (user_id, work_date) DO UPDATE SET
             shift = EXCLUDED.shift,
             day_type = EXCLUDED.day_type,
             normal_hours = EXCLUDED.normal_hours,
             ot_weekday_hours = EXCLUDED.ot_weekday_hours,
             ot_weekend_hours = EXCLUDED.ot_weekend_hours,
             ot_holiday_hours = EXCLUDED.ot_holiday_hours,
             late_minutes = EXCLUDED.late_minutes,
             early_minutes = EXCLUDED.early_minutes,
             absent = CASE WHEN attendance_summary.leave_type IS NOT NULL THEN FALSE ELSE EXCLUDED.absent END,
             remark = COALESCE(EXCLUDED.remark, attendance_summary.remark),
             computed_at = now()`,
          [u.user_id, dateStr, shiftValue, dayType,
           normalHours, otWeekday, otWeekend, otHoliday, lateMinutes, earlyMinutes, dayRemark]
        );
        dayCount++;
      }
    }
  });

  return { from: fromDate, to: toDate, users: users.length, days: dayCount };
}

/**
 * 计算迟到 / 早退分钟数。
 *
 * 口径：
 *   · 有排班且班次有定义 → 按该班次时间窗判定；
 *       迟到 = 实际上班 − 计划上班（> flex_minutes 才算）
 *       早退 = 计划下班 − 实际下班（> flex_minutes 才算）
 *       跨天班次：计划下班落在 work_date + 1 天。
 *   · 无排班 / 班次无时间窗 → 读 sys_config 的标准时刻
 *       （原为硬编码 09:00 / 18:00，工厂实际 08:00 / 16:30，已于 2026-10-26 改为配置）。
 *   · 法定节假日不判迟到早退（沿用原逻辑）。
 *
 * @param {{dateStr:string, rec:{in:*,out:*}, sched:object|null, isHoliday:boolean,
 *          stdIn:{h:number,m:number}, stdOut:{h:number,m:number}}} p
 * @returns {{lateMinutes:number, earlyMinutes:number}}
 */
function computeLateEarly({ dateStr, rec, sched, isHoliday, stdIn, stdOut }) {
  let lateMinutes = 0, earlyMinutes = 0;
  if (isHoliday) return { lateMinutes, earlyMinutes };

  const startHm = sched?.start_time ? parseTimeHm(sched.start_time) : null;
  const endHm = sched?.end_time ? parseTimeHm(sched.end_time) : null;
  const crossDay = !!sched?.cross_day;
  const flex = Number(sched?.flex_minutes) || 0;
  const useShift = !!(startHm || endHm);
  const stdInHm = stdIn || DEFAULT_STD_IN;
  const stdOutHm = stdOut || DEFAULT_STD_OUT;

  if (rec.in) {
    const plannedIn = useShift && startHm
      ? atTimeOn(dateStr, startHm, 0)
      : new Date(atTime(dateStr, stdInHm.h, stdInHm.m));
    if (plannedIn) {
      const diff = Math.round((new Date(rec.in) - plannedIn) / 60000);
      if (diff > flex) lateMinutes = diff;
    }
  }
  if (rec.out) {
    const plannedOut = useShift && endHm
      ? atTimeOn(dateStr, endHm, crossDay ? 1 : 0)
      : new Date(atTime(dateStr, stdOutHm.h, stdOutHm.m));
    if (plannedOut) {
      const diff = Math.round((plannedOut - new Date(rec.out)) / 60000);
      // 跨天夜班：下班打卡若落在工作日当天（差值超 12h），视为数据错位，不计早退
      if (diff > flex && diff < 12 * 60) earlyMinutes = diff;
    }
  }
  return { lateMinutes, earlyMinutes };
}

/**
 * 考勤汇总列表（分页契约）。
 * @param {{userId?:number, from?:string, to?:string, page?:number, pageSize?:number}} opts
 */
export async function listAttendanceSummary({ userId, from, to, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND s.user_id = $${params.length}`; }
  if (from) { params.push(dateParam(from, '起始')); where += ` AND s.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND s.work_date <= $${params.length}`; }

  const selectSql =
    `SELECT s.*, u.real_name, u.employee_no,
            sd.name AS shift_name, sd.name_vi AS shift_name_vi, sd.color AS shift_color
       FROM attendance_summary s
       JOIN org_user u ON u.id = s.user_id
       LEFT JOIN attendance_shift_def sd ON sd.code = s.shift
      WHERE ${where}
      ORDER BY s.work_date DESC, s.user_id`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM attendance_summary s WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 考勤导出结构（前端生成 xlsx）。表头中越双语。
 * @param {{from?:string, to?:string, userId?:number}} opts
 * @returns {Promise<{columns:Array, rows:Array}>}
 */
export async function attendanceExport({ from, to, userId } = {}) {
  const columns = [
    { key: 'employee_no',      label: '工号',       label_vi: 'Mã nhân viên' },
    { key: 'real_name',        label: '姓名',       label_vi: 'Họ tên' },
    { key: 'work_date',        label: '日期',       label_vi: 'Ngày' },
    { key: 'shift',            label: '班次',       label_vi: 'Ca' },
    { key: 'day_type',         label: '日期性质',   label_vi: 'Loại ngày' },
    { key: 'normal_hours',     label: '正班工时',   label_vi: 'Giờ chính' },
    { key: 'ot_weekday_hours', label: '平时加班',   label_vi: 'Tăng ca thường' },
    { key: 'ot_weekend_hours', label: '周末加班',   label_vi: 'Tăng ca cuối tuần' },
    { key: 'ot_holiday_hours', label: '节假日加班', label_vi: 'Tăng ca ngày lễ' },
    { key: 'late_minutes',     label: '迟到(分)',   label_vi: 'Đi muộn (phút)' },
    { key: 'early_minutes',    label: '早退(分)',   label_vi: 'Về sớm (phút)' },
    { key: 'absent',           label: '缺勤',       label_vi: 'Vắng mặt' },
    { key: 'leave_type',       label: '休假类型',   label_vi: 'Loại nghỉ' },
    { key: 'leave_hours',      label: '休假工时',   label_vi: 'Giờ nghỉ' },
  ];
  // 班次/日期性质显示为双语名称而非裸编码
  const list = await listAttendanceSummary({ userId, from, to });
  const rows = (list || []).map(s => ({
    employee_no: s.employee_no,
    real_name: s.real_name,
    work_date: typeof s.work_date === 'string' ? s.work_date.slice(0, 10) : s.work_date,
    shift: s.shift_name || s.shift,
    day_type: s.day_type,
    normal_hours: num(s.normal_hours),
    ot_weekday_hours: num(s.ot_weekday_hours),
    ot_weekend_hours: num(s.ot_weekend_hours),
    ot_holiday_hours: num(s.ot_holiday_hours),
    late_minutes: s.late_minutes || 0,
    early_minutes: s.early_minutes || 0,
    absent: s.absent ? 'Y' : 'N',
    leave_type: s.leave_type,
    leave_hours: num(s.leave_hours),
  }));
  return { columns, rows };
}

// ============================================================
// 四、休假 → 考勤（全量对接，2026-10-28 重写）
// ------------------------------------------------------------
// 三个时机共用一个入口，避免「提交写一套、撤销又写一套」的口径分裂：
//   submit  提交 / 审批中 → 台账 pending（考勤可见的「预告」，不参与计薪）
//   close   审批完成     → 台账 written + 写 attendance_summary 日汇总
//   revoke  撤销 / 终止  → 台账 revoked + 回收日汇总（只回滚本单写过的行）
//
// 为什么必须建台账：attendance_summary 一天只有一个 leave_type 字段，
// 单据抬头信息（单号 / 起止 / 天数 / 事由 / 交接人 / 审批状态）放不进去；
// 撤销时也没有依据判断「这行假是哪张单留下的」。
// 台账 attendance_leave 一单一行，日汇总只回指台账主键，明细永远以台账为准。
// ============================================================

/**
 * 把休假单据同步到考勤。
 * @param {number} instanceId flow_instance.id
 * @param {'submit'|'close'|'revoke'} mode
 * @returns {Promise<object>}
 */
export async function syncLeaveToAttendance(instanceId, mode = 'close') {
  const toStatus = mode === 'submit' ? 'pending' : (mode === 'revoke' ? 'revoked' : 'written');
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst) return { ok: false, action: 'skipped', reason: '实例不存在' };
    if (inst.def_code !== 'leave') {
      return { ok: false, action: 'skipped', reason: `非 leave 流程：${inst.def_code}` };
    }

    const fd = inst.form_data || {};
    const userId = Number(inst.applicant_id);
    const leaveType = fd.leave_type ? String(fd.leave_type) : 'personal';
    const startDate = parseDate(fd.start_date);
    const endDate = parseDate(fd.end_date) || startDate;
    const days = num(fd.days);
    if (!userId || !startDate) {
      return { ok: false, action: 'skipped', reason: '缺少申请人或休假起始日期', userId };
    }

    // 假别名称 / 是否带薪取自字典（字典缺失不阻断，回落 code）
    const dictRow = await one(
      `SELECT name, pay_wage, counts_as_attendance FROM attendance_leave_type WHERE code = $1`,
      [leaveType]
    ).catch(() => null);

    const workHours = await getWorkHours();

    // 枚举休假区间内的自然日（含首尾）
    const dates = [];
    const cur = new Date(`${startDate}T00:00:00Z`);
    const stop = new Date(`${endDate}T00:00:00Z`);
    while (cur <= stop) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
      if (dates.length > 400) break;   // 安全上限，防止区间异常
    }

    // 只把休假工时写在「工作日」上：跨周的假（如周一至周日请 5 天）如果按自然日
    // 摊到 7 天，周日那天也会记 1.14h，结果计薪时只剩 5 天 × 5.71h = 28.6h，
    // 比实际 40h 少一半——带薪假就少发了。
    const kinds = [];
    for (const d of dates) {
      let k = null;
      try { k = await resolveDayKind(d); } catch (_) { k = null; }
      kinds.push({ date: d, kind: k });
    }
    // 日历缺失时 resolveDayKind 返回 isWorkday=null，此时退回「按自然日均摊」，
    // 不臆断哪天该上班。
    const calendarKnown = kinds.some(x => x.kind && x.kind.isWorkday !== null);
    const targets = calendarKnown
      ? kinds.filter(x => x.kind && x.kind.isWorkday === true).map(x => x.date)
      : dates;

    // 每日休假工时：按「区间内工作日数」均摊；未填 days 则按满勤 work_hours
    const span = targets.length || 1;
    const leavePerDay = days > 0 ? round2(Math.min(workHours, (days / span) * workHours)) : workHours;
    const dayFrac = round2(days > 0 ? Math.min(1, days / span) : 1);

    // ---- 台账 upsert：三态都先落台账，保证任何状态都能追溯 ----
    const row = await one(
      `INSERT INTO attendance_leave
         (instance_id, instance_no, user_id, leave_type, leave_type_name,
          start_date, end_date, days, hour_per_day, hour_source, reason, handover_to,
          status, calendar_known, applied_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,'shift',$10,$11,$12,$13,$14,now())
       ON CONFLICT (instance_id) DO UPDATE SET
         instance_no      = EXCLUDED.instance_no,
         leave_type       = EXCLUDED.leave_type,
         leave_type_name  = EXCLUDED.leave_type_name,
         start_date       = EXCLUDED.start_date,
         end_date         = EXCLUDED.end_date,
         days             = EXCLUDED.days,
         hour_per_day     = EXCLUDED.hour_per_day,
         reason           = EXCLUDED.reason,
         handover_to      = EXCLUDED.handover_to,
         status           = EXCLUDED.status,
         calendar_known   = EXCLUDED.calendar_known,
         updated_at       = now()
       RETURNING id`,
      [instanceId, inst.instance_no || null, userId, leaveType, (dictRow && dictRow.name) || leaveType,
        startDate, endDate || startDate, days, leavePerDay,
        fd.reason ? String(fd.reason) : null,
        fd.handover_to ? (Number(fd.handover_to) || null) : null,
        toStatus, calendarKnown, inst.created_at || new Date()]
    );
    const leaveRowId = Number(row.id);

    // ---- ① 审批中：只登记台账，不动考勤日汇总 ----
    if (mode === 'submit') {
      return {
        ok: true, action: 'pending', userId, leaveRowId, leaveType,
        leaveTypeName: (dictRow && dictRow.name) || leaveType,
        days: targets.length, calendarDays: dates.length, leavePerDay, calendarKnown
      };
    }

    // ---- ② 撤销 / 终止：回收本单写过的日汇总 ----
    if (mode === 'revoke') {
      const restored = await transaction(async client => {
        const rows = (await client.query(
          `SELECT id, leave_hours FROM attendance_summary WHERE leave_instance_id = $1`,
          [leaveRowId]
        )).rows;
        for (const r of rows) {
          await client.query(
            `UPDATE attendance_summary
                SET normal_hours = COALESCE(normal_hours, 0) + COALESCE(leave_hours, 0),
                    leave_type = NULL, leave_hours = 0, leave_days = 0,
                    leave_instance_id = NULL, computed_at = now()
              WHERE id = $1`,
            [r.id]
          );
        }
        await client.query(
          `UPDATE attendance_leave
              SET status = 'revoked', revoked_at = now(), updated_at = now(),
                  revoked_reason = $2
            WHERE id = $1`,
          [leaveRowId, String(inst.title || '流程撤销/终止')]
        );
        return rows.length;
      });
      return {
        ok: true, action: 'revoked', userId, leaveRowId, restored,
        reason: `已回收 ${restored} 天休假记录并恢复对应工时`
      };
    }

    // ---- ③ 审批完成：写日汇总 ----
    const writtenDates = await transaction(async client => {
      const list = [];
      for (const dateStr of targets) {
        const exist = (await client.query(
          `SELECT id, normal_hours FROM attendance_summary WHERE user_id = $1 AND work_date = $2::date`,
          [userId, dateStr]
        )).rows[0];

        if (exist) {
          const newNormal = round2(Math.max(0, num(exist.normal_hours) - leavePerDay));
          await client.query(
            `UPDATE attendance_summary
                SET leave_type = $2, leave_hours = $3, leave_days = $4,
                    leave_instance_id = $5, normal_hours = $6,
                    absent = FALSE, computed_at = now()
              WHERE id = $1`,
            [exist.id, leaveType, leavePerDay, dayFrac, leaveRowId, newNormal]
          );
        } else {
          await client.query(
            `INSERT INTO attendance_summary
               (user_id, work_date, normal_hours, leave_type, leave_hours, leave_days,
                leave_instance_id, absent, computed_at)
             VALUES ($1, $2::date, 0, $3, $4, $5, $6, FALSE, now())
             ON CONFLICT (user_id, work_date) DO UPDATE SET
               leave_type        = EXCLUDED.leave_type,
               leave_hours       = EXCLUDED.leave_hours,
               leave_days        = EXCLUDED.leave_days,
               leave_instance_id = EXCLUDED.leave_instance_id,
               absent            = FALSE,
               computed_at       = now()`,
            [userId, dateStr, leaveType, leavePerDay, dayFrac, leaveRowId]
          );
        }
        list.push(dateStr);
      }

      await client.query(
        `UPDATE attendance_leave
            SET status = 'written', written_days = $2, written_dates = $3::jsonb,
                total_hours = $4, written_at = now(), updated_at = now()
          WHERE id = $1`,
        [leaveRowId, list.length, JSON.stringify(list), round2(leavePerDay * list.length)]
      );
      return list;
    });

    return {
      ok: true, action: 'written', userId, leaveRowId,
      days: writtenDates.length,
      calendarDays: dates.length,
      leavePerDay,
      leaveType,
      leaveTypeName: (dictRow && dictRow.name) || leaveType,
      payWage: dictRow ? dictRow.pay_wage : null,
      countsAsAttendance: dictRow ? dictRow.counts_as_attendance : null,
      calendarKnown
    };
  } catch (err) {
    console.warn(
      `[attendance-service] syncLeaveToAttendance(${mode}) 失败（已忽略）instance=${instanceId}:`,
      err?.message || err
    );
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}

/** 兼容旧调用点：审批完成 → 写考勤 */
export async function onLeaveClosed(instanceId) {
  return syncLeaveToAttendance(instanceId, 'close');
}

/** 提交 / 审批中 → 台账 pending（考勤可见，但不参与计薪） */
export async function onLeaveSubmitted(instanceId) {
  return syncLeaveToAttendance(instanceId, 'submit');
}

/** 撤销 / 终止 → 台账 revoked + 回收考勤 */
export async function onLeaveRevoked(instanceId) {
  return syncLeaveToAttendance(instanceId, 'revoke');
}

/**
 * 休假台账查询（考勤侧统一入口）。
 * 返回一单一行：单号 / 工号姓名 / 假别（含字典口径）/ 起止 / 天数 / 工时 / 状态。
 *
 * @param {object} p
 *   @param {number} [p.userId]   只看某人
 *   @param {string} [p.from]     起始日（含）
 *   @param {string} [p.to]       截止日（含）
 *   @param {string} [p.status]   pending / written / revoked
 *   @param {string} [p.leaveType]
 *   @param {string} [p.keyword]  姓名或工号
 *   @param {number} [p.limit]
 */
export async function listAttendanceLeaves({
  userId = null, from = null, to = null, status = null,
  leaveType = null, keyword = null, limit = 500
} = {}) {
  const cond = ['1=1'];
  const args = [];
  const add = (sql, val) => { args.push(val); cond.push(sql.replace('$?', '$' + args.length)); };

  if (userId) add(`l.user_id = $?`, Number(userId));
  if (from) add(`l.end_date >= $?::date`, from);
  if (to) add(`l.start_date <= $?::date`, to);
  if (status) add(`l.status = $?`, status);
  if (leaveType) add(`l.leave_type = $?`, leaveType);
  if (keyword) {
    args.push('%' + String(keyword).trim() + '%');
    const i = args.length;
    cond.push(`(COALESCE(u.real_name,'') ILIKE $${i} OR COALESCE(u.employee_no,'') ILIKE $${i} OR COALESCE(l.instance_no,'') ILIKE $${i})`);
  }
  args.push(Number(limit) || 500);

  const rows = await many(
    `SELECT l.id, l.instance_id, l.instance_no, l.user_id, l.leave_type, l.leave_type_name,
            l.start_date, l.end_date, l.days, l.hour_per_day, l.total_hours,
            l.reason, l.handover_to, l.status, l.written_days, l.written_dates,
            l.calendar_known, l.applied_at, l.written_at, l.revoked_at, l.revoked_reason,
            u.real_name, u.employee_no, d.name AS dept_name,
            t.paid_by, t.pay_wage, t.counts_as_attendance, t.statutory_days
       FROM attendance_leave l
       JOIN org_user u ON u.id = l.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN attendance_leave_type t ON t.code = l.leave_type
      WHERE ${cond.join(' AND ')}
      ORDER BY l.start_date DESC, l.id DESC
      LIMIT $${args.length}`,
    args
  );

  const items = rows.map(r => ({
    id: Number(r.id),
    instanceId: Number(r.instance_id),
    instanceNo: r.instance_no,
    userId: Number(r.user_id),
    employeeNo: r.employee_no,
    realName: r.real_name,
    deptName: r.dept_name,
    leaveType: r.leave_type,
    leaveTypeName: r.leave_type_name || r.leave_type,
    startDate: r.start_date ? String(r.start_date).slice(0, 10) : null,
    endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
    days: num(r.days),
    hourPerDay: r.hour_per_day == null ? null : num(r.hour_per_day),
    totalHours: r.total_hours == null ? null : num(r.total_hours),
    reason: r.reason,
    handoverTo: r.handover_to ? Number(r.handover_to) : null,
    status: r.status,
    writtenDays: Number(r.written_days) || 0,
    writtenDates: r.written_dates || [],
    calendarKnown: r.calendar_known !== false,
    paidBy: r.paid_by || null,
    payWage: r.pay_wage === true,
    countsAsAttendance: r.counts_as_attendance === true,
    statutoryDays: r.statutory_days == null ? null : Number(r.statutory_days),
    appliedAt: r.applied_at,
    writtenAt: r.written_at,
    revokedAt: r.revoked_at,
    revokedReason: r.revoked_reason
  }));

  const totals = items.reduce((a, x) => {
    const k = x.status;
    a[k] = (a[k] || 0) + 1;
    a.daysByStatus[k] = round2((a.daysByStatus[k] || 0) + x.days);
    return a;
  }, { pending: 0, written: 0, revoked: 0, daysByStatus: { pending: 0, written: 0, revoked: 0 } });

  return { items, totals, count: items.length };
}

// ============================================================
// 五、流程终态钩子：补卡审批完成补录打卡
// ============================================================

/**
 * 补卡时段 → 补录时刻映射（第33轮扩展）。
 *
 * 基础四段（旧口径，保持不变）：
 *   morning       → 补上班 09:00
 *   morning_out   → 补下班 12:00
 *   afternoon     → 补上班 14:00
 *   afternoon_out → 补下班 18:00
 *
 * 第33轮新增夜班/加班段（对应卡点 night_missing / 加班漏卡）：
 *   night_in      → 夜班上班 20:00（跨天班次的上班）
 *   night_out     → 夜班下班 05:00（**次日**，由 crossDay 标记）
 *   ot_in / ot_out→ 加班起止，按排班班次实际时间取（缺省 18:00 / 21:00）
 *
 * crossDay=true 表示补录时刻落在 miss_date 的**次日**（夜班下班场景）。
 */
const MISS_SLOT_MAP = {
  morning:       { field: 'check_in',  hour: 9,  minute: 0,  crossDay: false },
  morning_out:   { field: 'check_out', hour: 12, minute: 0,  crossDay: false },
  afternoon:     { field: 'check_in',  hour: 14, minute: 0,  crossDay: false },
  afternoon_out: { field: 'check_out', hour: 18, minute: 0,  crossDay: false },
  night_in:      { field: 'check_in',  hour: 20, minute: 0,  crossDay: false },
  night_out:     { field: 'check_out', hour: 5,  minute: 0,  crossDay: true  },
  ot_in:         { field: 'check_in',  hour: 18, minute: 0,  crossDay: false },
  ot_out:        { field: 'check_out', hour: 21, minute: 0,  crossDay: false },
};

/**
 * 由卡点类型 + 班次推导「建议补卡时段」（供一键补卡预填）。
 *
 * 依据卡点语义：
 *   absent_no_check  → 全天无打卡，两段都缺 → 建议按班次补上班（夜班补 night_in）
 *   night_missing    → 夜班漏卡 → night_in / night_out
 *   late_early_by_shift → 迟到或早退，按 detail 判断补哪一段
 *   其他类型         → 不给建议（返回 null）
 *
 * @param {object} anomaly attendance_anomaly 行
 * @param {object|null} shift attendance_shift_def 行（该日排班班次）
 * @returns {{slot:string, field:string, hour:number, minute:number, crossDay:boolean}|null}
 */
export function suggestMissSlot(anomaly, shift) {
  if (!anomaly) return null;
  const t = anomaly.anomaly_type;
  const isNight = !!shift?.cross_day
    || (String(shift?.start_time || '').slice(0, 2) >= '18')
    || shift?.code === 'night';

  if (t === 'night_missing') {
    const slot = isNight ? 'night_in' : 'morning';
    return { slot, ...MISS_SLOT_MAP[slot] };
  }
  if (t === 'absent_no_check') {
    const slot = isNight ? 'night_in' : 'morning';
    return { slot, ...MISS_SLOT_MAP[slot] };
  }
  if (t === 'late_early_by_shift') {
    const d = anomaly.detail || {};
    // 有早退分钟 → 缺下班卡；有迟到分钟 → 缺上班卡
    if (Number(d.early_minutes) > 0) {
      const slot = isNight ? 'night_out' : 'afternoon_out';
      return { slot, ...MISS_SLOT_MAP[slot] };
    }
    if (Number(d.late_minutes) > 0) {
      const slot = isNight ? 'night_in' : 'morning';
      return { slot, ...MISS_SLOT_MAP[slot] };
    }
    const slot = isNight ? 'night_in' : 'morning';
    return { slot, ...MISS_SLOT_MAP[slot] };
  }
  return null;
}

/**
 * 补卡流程终态回调（幂等）。
 *
 * 【第33轮关键修正】补录对象改为 **业务当事人**：
 *   userId = subject_user_id ?? applicant_id
 * 文员代提时 applicant 是文员，若沿用 applicant_id 会把补卡记录错记到文员名下。
 *
 * 逻辑：从 form_data 取 miss_date / miss_time：
 *   基础四段见 MISS_SLOT_MAP 注释；夜班段（night_in/night_out）支持跨天。
 * 依据缺失的时段补一条 attendance_raw（source='flow'）并重算当天汇总。
 *
 * 另外（第33轮）：若单据源自卡点（form_data.source_anomaly_id），
 *   自动把该卡点置「已补卡闭环」（remedy_status='done'、resolved=TRUE）。
 *
 * 幂等：attendance_raw 的 UNIQUE(user_id, work_date, check_in) 保证重复调用不重复插。
 *
 * @param {number} instanceId
 * @returns {Promise<{ok:boolean, action:string, userId?:number, rawId?:number, anomalyId?:number, reason?:string}>}
 */
export async function onMissCardClosed(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst) return { ok: false, action: 'skipped', reason: '实例不存在' };
    if (inst.def_code !== 'miss_card') {
      return { ok: false, action: 'skipped', reason: `非 miss_card 流程：${inst.def_code}` };
    }

    const fd = inst.form_data || {};
    // 业务当事人优先：代提时补录到被签卡人名下
    const userId = Number(inst.subject_user_id || inst.applicant_id);
    const missDate = parseDate(fd.miss_date);
    const slot = fd.miss_time ? String(fd.miss_time) : null;

    if (!userId || !missDate) {
      return { ok: false, action: 'skipped', reason: '缺少申请人或漏打卡日期', userId };
    }

    const conf = MISS_SLOT_MAP[slot];
    if (!conf) {
      return { ok: false, action: 'skipped', reason: `未知时段：${slot}`, userId };
    }

    // 跨天时段（夜班下班）落在次日
    const effDate = conf.crossDay ? addDaysStr(missDate, 1) : missDate;
    const ts = atTime(effDate, conf.hour, conf.minute);
    // 打卡原始记录归属日 = 排班工作日（miss_date），时刻可为次日
    const rawDate = missDate;

    // 幂等写入打卡原始（source='flow'）
    const res = await query(
      `INSERT INTO attendance_raw (user_id, work_date, check_in, check_out, source, import_batch)
       VALUES ($1, $2::date, $3, $4, 'flow', $5)
       ON CONFLICT (user_id, work_date, check_in) DO NOTHING
       RETURNING id`,
      [
        userId, rawDate,
        conf.field === 'check_in' ? ts : null,
        conf.field === 'check_out' ? ts : null,
        `MISS-${instanceId}`,
      ]
    );
    const rawId = res.rows[0]?.id || null;

    // 重算当天汇总（补卡后迟到/早退/缺勤状态应更新）
    await recomputeUserDay(userId, rawDate);
    // 跨天时次日汇总也可能受影响（夜班下班跨零点）
    if (conf.crossDay) await recomputeUserDay(userId, effDate);

    // ---------- 卡点自动闭环 ----------
    const anomalyId = Number(fd.source_anomaly_id) || null;
    let closedAnomaly = null;
    if (anomalyId) {
      const cur = await one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [anomalyId]);
      if (cur) {
        await query(
          `UPDATE attendance_anomaly
              SET resolved = TRUE,
                  resolved_by = $2,
                  resolved_at = now(),
                  resolve_note = COALESCE(resolve_note, $3),
                  remedy_status = 'done',
                  remedy_instance_id = COALESCE(remedy_instance_id, $4),
                  remedy_by = $2,
                  remedy_at = now(),
                  auto_remedy = TRUE
            WHERE id = $1`,
          [anomalyId, userId, `补卡单 ${inst.instance_no} 审批通过，自动补录打卡并闭环`, instanceId]
        );
        closedAnomaly = anomalyId;
      }
    }

    return { ok: true, action: rawId ? 'inserted' : 'exists', userId, rawId,
             effectiveDate: effDate, anomalyId: closedAnomaly };
  } catch (err) {
    console.warn(`[attendance-service] onMissCardClosed 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}

/**
 * 补卡被驳回 → 卡点回退为「未补卡」（供再次发起）。
 * 由 flow-engine 在 miss_card 驳回时调用（当前为预留钩子，可被 admin 手动触发）。
 * @param {number} instanceId
 */
export async function onMissCardRejected(instanceId) {
  try {
    const inst = await one(
      `SELECT form_data, instance_no FROM flow_instance WHERE id = $1`,
      [instanceId]
    );
    const anomalyId = Number(inst?.form_data?.source_anomaly_id) || null;
    if (!anomalyId) return { ok: true, action: 'no-anomaly' };
    await query(
      `UPDATE attendance_anomaly
          SET remedy_status = 'rejected', remedy_at = now(),
              resolve_note = COALESCE(resolve_note, $2)
        WHERE id = $1 AND resolved = FALSE`,
      [anomalyId, `补卡单 ${inst.instance_no} 被驳回`]
    );
    return { ok: true, action: 'reverted', anomalyId };
  } catch (err) {
    console.warn(`[attendance-service] onMissCardRejected 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}

/**
 * 重算某员工某天的考勤汇总（供补卡后调用）。
 * 与 computeAttendance 同口径；已有休假回写保留。
 * @param {number} userId
 * @param {string} dateStr 'YYYY-MM-DD'
 */
export async function recomputeUserDay(userId, dateStr) {
  const workHours = await getWorkHours();
  const holidaySet = await getHolidaySet();
  const { stdIn, stdOut } = await getStdTimes();
  const lunchRule = await getLunchRule();
  // 日期性质：调休覆盖优先；其次工作日历；无日历回退旧周末判定
  const overrideMap = await getDayOverrideMap(userId, dateStr, dateStr);
  const calendar = await getWorkCalendar(dateStr.slice(0, 7));
  const { dayType, isHoliday, isWeekend: weekend, isRest: isRestDay } = resolveDayType(dateStr, holidaySet, overrideMap, calendar);
  // 加班依据校验开关（与 computeAttendance 同口径）
  const otRequireApply = await isOtApplyRequired();

  // 班次感知：该日有排班则按班次时间窗判定迟到早退
  const schedMap = await getScheduleMap(userId, dateStr, dateStr);
  const sched = schedMap.get(dateStr) || null;
  const shiftCode = sched ? sched.shift_code : null;
  const nightShift = isNightShift(sched);

  const raws = await many(
    `SELECT check_in, check_out FROM attendance_raw
      WHERE user_id = $1 AND work_date = $2::date`,
    [userId, dateStr]
  );
  let inTs = null, outTs = null;
  const times = [];
  for (const r of raws) {
    if (r.check_in) { times.push(r.check_in); if (!inTs || new Date(r.check_in) < new Date(inTs)) inTs = r.check_in; }
    if (r.check_out) { times.push(r.check_out); if (!outTs || new Date(r.check_out) > new Date(outTs)) outTs = r.check_out; }
  }

  const rule = await resolveCardRule(userId);
  let normalHours, otRaw, lateMinutes, earlyMinutes;
  if (rule) {
    const seg = computeRuleHours(dateStr, times, rule, workHours, calendar, nightShift);
    normalHours = seg.normalHours;
    otRaw = seg.otHours;
    lateMinutes = seg.lateMinutes;
    earlyMinutes = seg.earlyMinutes;
    if (isRestDay) otRaw = 0;
  } else {
    let actual = 0;
    if (inTs && outTs) {
      actual = effectiveWorkHours((new Date(outTs) - new Date(inTs)) / 3600000, lunchRule);
    }
    normalHours = round2(Math.min(actual, workHours));
    otRaw = Math.max(0, actual - workHours);
    if (isRestDay) otRaw = 0;
    const le = computeLateEarly({
      dateStr, rec: { in: inTs, out: outTs }, sched, isHoliday, stdIn, stdOut,
    });
    lateMinutes = le.lateMinutes;
    earlyMinutes = le.earlyMinutes;
  }
  // 加班依据校验（需求第 10 章）：无已办结申请单覆盖则不计加班
  if (otRequireApply) {
    const approvedDates = await getApprovedApplyDateSet(userId, dateStr, dateStr);
    if (!approvedDates.has(dateStr)) otRaw = 0;
  }
  let otWeekday = 0, otWeekend = 0, otHoliday = 0;
  if (otRaw > 0) {
    if (isHoliday) otHoliday = round2(otRaw);
    else if (weekend) otWeekend = round2(otRaw);
    else otWeekday = round2(otRaw);
  }

  const shiftValue = shiftCode && shiftCode !== 'rest' ? shiftCode : null;
  // 【调休】标记该日来源（覆盖表为空时不写 remark → 零副作用）
  const dayRemark = isRestDay ? 'comp:owe' : (overrideMap && overrideMap.get(dateStr) === 'workday' ? 'comp:repay' : null);
  await query(
    `INSERT INTO attendance_summary
       (user_id, work_date, shift, day_type, normal_hours, ot_weekday_hours, ot_weekend_hours,
        ot_holiday_hours, late_minutes, early_minutes, absent, remark, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,now())
     ON CONFLICT (user_id, work_date) DO UPDATE SET
       shift = EXCLUDED.shift,
       day_type = EXCLUDED.day_type,
       normal_hours = EXCLUDED.normal_hours,
       ot_weekday_hours = EXCLUDED.ot_weekday_hours,
       ot_weekend_hours = EXCLUDED.ot_weekend_hours,
       ot_holiday_hours = EXCLUDED.ot_holiday_hours,
       late_minutes = EXCLUDED.late_minutes,
       early_minutes = EXCLUDED.early_minutes,
       absent = CASE WHEN attendance_summary.leave_type IS NOT NULL THEN FALSE ELSE EXCLUDED.absent END,
       remark = COALESCE(EXCLUDED.remark, attendance_summary.remark),
       computed_at = now()`,
    [userId, dateStr, shiftValue, dayType,
     normalHours, otWeekday, otWeekend, otHoliday, lateMinutes, earlyMinutes, dayRemark]
  );
}
