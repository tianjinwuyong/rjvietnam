// ============================================================
// 打卡规则 + 工作日历 管理服务（批次 A）
// ------------------------------------------------------------
// 只做后端管理 API 的数据读写；切段计算在 attendance-service。
// 规则/槽位变更后调用 invalidateCardRuleCache 使缓存失效。
// ============================================================
import { one, many, query, transaction } from '../db/index.js';
import { invalidateCardRuleCache, getWorkCalendar } from './attendance-service.js';

const SEGMENTS = new Set(['normal1', 'normal2', 'ot']);
const INOUT = new Set(['in', 'out']);
const APPLY_TO = new Set(['any', 'normal', 'ot']);

function slotError(slot, i) {
  if (!SEGMENTS.has(slot.segment)) return `第 ${i + 1} 个卡点 segment 非法`;
  if (!INOUT.has(slot.in_out)) return `第 ${i + 1} 个卡点 in_out 非法`;
  return null;
}

function windowError(w, i) {
  const n = i + 1;
  if (!w.in_time || !w.out_time) return `第 ${n} 个用餐窗口起止时间必填`;
  const m = Number(w.minutes);
  if (!(m > 0)) return `第 ${n} 个用餐窗口扣除分钟数必须大于 0`;
  if (w.apply_to && !APPLY_TO.has(w.apply_to)) return `第 ${n} 个用餐窗口 apply_to 非法`;
  return null;
}

async function loadSlots(code) {
  return many(
    `SELECT id, seq, segment, in_out, fixed_time, night_time, cross_day,
            lunch_deduct_minutes, ot_fixed_start_time
       FROM attendance_rule_slot WHERE rule_code = $1 ORDER BY seq`,
    [code]
  );
}

/** 不计薪用餐窗口（表可能尚未迁移时降级为空） */
async function loadWindows(code) {
  try {
    return await many(
      `SELECT id, seq, name, in_time, out_time, cross_day, minutes, apply_to
         FROM attendance_rule_window WHERE rule_code = $1 ORDER BY seq`,
      [code]
    );
  } catch { return []; }
}

export async function listRules() {
  const rules = await many(`SELECT * FROM attendance_rule ORDER BY code`);
  for (const r of rules) {
    r.slots = await loadSlots(r.code);
    r.windows = await loadWindows(r.code);
  }
  return rules;
}

export async function getRule(code) {
  const r = await one(`SELECT * FROM attendance_rule WHERE code = $1`, [code]);
  if (!r) return null;
  r.slots = await loadSlots(code);
  r.windows = await loadWindows(code);
  return r;
}

/**
 * 新增/更新规则（含槽位整体替换）。返回规则对象。
 * windows 不传 → 保持原用餐窗口不变；传数组 → 整体替换（传空数组即清空）。
 * 这样旧界面（不认识 windows 字段）保存规则时不会把窗口删掉。
 */
export async function saveRule({ code, name, name_vi, card_count, active, slots = [], windows }) {
  if (!code) throw Object.assign(new Error('规则编码必填'), { statusCode: 400 });
  if (!name) throw Object.assign(new Error('规则名称必填'), { statusCode: 400 });
  if (!(Number(card_count) > 0)) throw Object.assign(new Error('卡数必须大于 0'), { statusCode: 400 });

  const list = (Array.isArray(slots) ? slots : []).map((s, i) => {
    const err = slotError(s || {}, i);
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
    return {
      seq: Number(s.seq),
      segment: s.segment,
      in_out: s.in_out,
      fixed_time: s.fixed_time || null,
      night_time: s.night_time || null,
      cross_day: !!s.cross_day,
      lunch_deduct_minutes: Number(s.lunch_deduct_minutes) || 0,
      ot_fixed_start_time: s.ot_fixed_start_time || null,
    };
  });

  const win = Array.isArray(windows) ? windows.map((w, i) => {
    const err = windowError(w || {}, i);
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
    return {
      seq: Number(w.seq) || (i + 1),
      name: w.name || null,
      in_time: w.in_time,
      out_time: w.out_time,
      cross_day: !!w.cross_day,
      minutes: Number(w.minutes),
      apply_to: w.apply_to || 'any',
    };
  }) : null;

  await transaction(async client => {
    await client.query(
      `INSERT INTO attendance_rule (code, name, name_vi, card_count, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, name_vi = EXCLUDED.name_vi,
         card_count = EXCLUDED.card_count, active = EXCLUDED.active`,
      [code, name, name_vi || null, Number(card_count), active !== false]
    );
    await client.query(`DELETE FROM attendance_rule_slot WHERE rule_code = $1`, [code]);
    for (const s of list) {
      await client.query(
        `INSERT INTO attendance_rule_slot
           (rule_code, seq, segment, in_out, fixed_time, night_time, cross_day, lunch_deduct_minutes, ot_fixed_start_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [code, s.seq, s.segment, s.in_out, s.fixed_time, s.night_time, s.cross_day, s.lunch_deduct_minutes, s.ot_fixed_start_time]
      );
    }
    if (win) {
      await client.query(`DELETE FROM attendance_rule_window WHERE rule_code = $1`, [code]);
      for (const w of win) {
        await client.query(
          `INSERT INTO attendance_rule_window
             (rule_code, seq, name, in_time, out_time, cross_day, minutes, apply_to)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [code, w.seq, w.name, w.in_time, w.out_time, w.cross_day, w.minutes, w.apply_to]
        );
      }
    }
  });
  invalidateCardRuleCache();
  return getRule(code);
}

export async function deleteRule(code) {
  const r = await query(`DELETE FROM attendance_rule WHERE code = $1`, [code]);
  if (!r.rowCount) throw Object.assign(new Error('规则不存在'), { statusCode: 404 });
  invalidateCardRuleCache();
  return { ok: true };
}

// ---------------- 工作日历 ----------------

/** upsert 某月工作日历。days 为逐日权重映射。 */
/**
 * 列出越南法定节假日（可按年过滤）。
 * 假日以 attendance_holiday 为唯一真值：日型判定（resolveDayKind）、
 * 3.0/4.1 倍率、日历展示都读这张表，避免多处维护口径不一致。
 * @param {string|number} [year] 'YYYY'，不传返回全部
 */
export async function listHolidays(year) {
  const y = /^\d{4}$/.test(String(year || '')) ? String(year) : null;
  const sql =
    `SELECT to_char(holiday_date,'YYYY-MM-DD') AS date,
            to_char(holiday_date,'YYYY-MM')   AS year_month,
            to_char(holiday_date,'DD')        AS day,
            name, name_vi, name_en, is_paid, is_statutory,
            holiday_type, note, source
       FROM attendance_holiday
      WHERE region_code = 'VN'` + (y ? ` AND to_char(holiday_date,'YYYY') = $1` : '') +
    ` ORDER BY holiday_date`;
  try {
    return await many(sql, y ? [y] : []);
  } catch {
    return [];   // 96 号迁移之前的库没有这张表，降级为空
  }
}

/** 某月法定假日：'DD' → { name, holiday_type } */
async function monthHolidayMap(yearMonth) {
  const rows = await many(
    `SELECT to_char(holiday_date,'DD') AS dd, name, holiday_type
       FROM attendance_holiday
      WHERE region_code = 'VN' AND is_statutory
        AND to_char(holiday_date,'YYYY-MM') = $1`,
    [yearMonth]
  ).catch(() => []);
  const map = new Map();
  for (const r of rows) map.set(r.dd, r);
  return map;
}

export async function upsertWorkCalendar({ yearMonth, rule, days }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(yearMonth || ''))) {
    throw Object.assign(new Error('year_month 格式应为 YYYY-MM'), { statusCode: 400 });
  }
  const dayMap = (days && typeof days === 'object') ? days : {};

  // 法定假日不接受日历覆盖：一律置为休息（0）。
  // 假日只由 attendance_holiday 维护，否则「按规则生成」会把节假日抹平。
  const hols = await monthHolidayMap(yearMonth);
  const forced = [];
  for (const [dd, h] of hols) {
    if (Number(dayMap[dd]) !== 0) forced.push({ day: dd, name: h.name });
    dayMap[dd] = 0;
  }

  await query(
    `INSERT INTO attendance_work_calendar (year_month, rule, days)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (year_month) DO UPDATE SET rule = EXCLUDED.rule, days = EXCLUDED.days`,
    [yearMonth, rule || '5day', JSON.stringify(dayMap)]
  );
  const cal = await getWorkCalendar(yearMonth);
  return { ...cal, forced_holidays: forced };
}
