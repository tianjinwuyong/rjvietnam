// ============================================================
// 排班管理 + 班次定义 + 卡点识别服务
// 职责：
//   · 班次定义读写（时间窗 + 两种待遇口径配置）
//   · 排班导入（可覆盖的 UPSERT，与打卡的只增不改不同）/ 查询 / 手工调班 / 批量刷班 / 导出
//   · 卡点识别 detectAnomalies：比对「应上班次（排班）」与「实际打卡」，产出 7 类违规异常
//   · 卡点列表 / 统计 / 人工闭环
// 设计约束：
//   · 后端不解析 xlsx；仅提供 template() 与 importSchedule(rows)，逐行 upsert。
//   · 排班「可改」：导入用 ON CONFLICT DO UPDATE；手工调整 source='manual'。
//   · 卡点识别幂等：UNIQUE(user_id, work_date, anomaly_type) 收敛；已闭环的不被覆盖。
//   · 夜班跨天：以排班记录的工作日为归属日，下班时刻落在次日。
// 中越双语：所有 label 同时提供 label 与 label_vi。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { dateParam } from '../utils/params.js';
import { makeShiftResolver } from './shift-resolver.js';

// 休息占位码（非班次，不入 attendance_shift_def）
export const REST_CODE = 'rest';

/** 数值化，非法返回 0 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 四舍五入到 2 位小数 */
function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/** 解析 'YYYY-MM-DD'，非法返回 null（与 attendance-service 同口径） */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, da] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/** 日期加减天数 → 'YYYY-MM-DD' */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 判断日期是否周末 */
function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * 把 'HH:MM:SS' 或 'HH:MM' 解析为 {h, m}。
 * @param {string} t
 * @returns {{h:number,m:number}|null}
 */
function parseTime(t) {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(t).trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * 构造某工作日某时刻的绝对时间戳（**UTC 基准**，与 attendance-service 同口径）。
 * 全库 TIMESTAMPTZ 统一 UTC 存取，详见 db/index.js。
 * @param {string} dateStr 'YYYY-MM-DD' 工作日
 * @param {{h:number,m:number}} hm
 * @param {number} dayOffset 偏移天数（跨天班次下班用 1）
 * @returns {string|null} ISO
 */
function atDateTime(dateStr, hm, dayOffset = 0) {
  if (!dateStr || !hm) return null;
  const base = dayOffset ? addDays(dateStr, dayOffset) : dateStr;
  const d = new Date(Date.UTC(
    Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1, Number(base.slice(8, 10)),
    hm.h, hm.m, 0
  ));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 取 sys_config 值 */
async function getConfig(key, fallback = null) {
  const row = await one(`SELECT value FROM sys_config WHERE key = $1`, [key]);
  return row?.value ?? fallback;
}

/** 读取跨班连上判定阈值（小时），默认 8 */
async function getCrossThresholdHours() {
  const v = await getConfig('attendance_consecutive_cross_hours', null);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

/** 读取法定节假日集合（与 attendance-service 同源） */
async function getHolidaySet() {
  const v = await getConfig('attendance_holidays', '');
  const set = new Set();
  if (v) {
    String(v).split(',').map(s => parseDate(s.trim())).filter(Boolean).forEach(d => set.add(d));
  }
  return set;
}

// ============================================================
// 一、班次定义
// ============================================================

/**
 * 班次定义列表。
 * @param {{includeInactive?:boolean}} opts
 */
export async function listShiftDefs({ includeInactive = false } = {}) {
  const where = includeInactive ? '1=1' : 'active = TRUE';
  return many(
    `SELECT * FROM attendance_shift_def WHERE ${where} ORDER BY sort_order, code`
  );
}

/**
 * 取单个班次定义（未启用也返回，便于历史数据回显）。
 * @param {string} code
 */
export async function getShiftDef(code) {
  if (!code || code === REST_CODE) return null;
  return one(`SELECT * FROM attendance_shift_def WHERE code = $1`, [code]);
}

/**
 * 取班次定义映射表 { code: row }，供批量计算复用（减少查询次数）。
 */
export async function getShiftDefMap() {
  const rows = await many(`SELECT * FROM attendance_shift_def`);
  const map = new Map();
  for (const r of rows) map.set(r.code, r);
  return map;
}

/**
 * 更新班次定义（时间窗 + 待遇口径）。
 * code 不可改；不传的字段保持原值。
 * @param {string} code
 * @param {object} data
 */
export async function updateShiftDef(code, data = {}) {
  const cur = await one(`SELECT * FROM attendance_shift_def WHERE code = $1`, [code]);
  if (!cur) throw Object.assign(new Error(`班次编码「${code}」不存在`), { statusCode: 404 });

  const name = data.name != null ? String(data.name).trim() : cur.name;
  if (!name) throw Object.assign(new Error('班次名称必填'), { statusCode: 400 });

  const start = data.startTime !== undefined ? String(data.startTime || '').trim() || null : cur.start_time;
  const end = data.endTime !== undefined ? String(data.endTime || '').trim() || null : cur.end_time;

  await query(
    `UPDATE attendance_shift_def SET
       name = $2, name_vi = $3, start_time = $4, end_time = $5,
       cross_day = $6, flex_minutes = $7,
       allowance_per_day = $8, allowance_per_hour = $9, ot_rate_factor = $10,
       color = $11, sort_order = $12, active = $13, updated_at = now()
     WHERE code = $1`,
    [
      code, name,
      data.nameVi !== undefined ? (data.nameVi || null) : cur.name_vi,
      start, end,
      data.crossDay !== undefined ? !!data.crossDay : cur.cross_day,
      data.flexMinutes !== undefined ? Math.max(0, Number(data.flexMinutes) || 0) : cur.flex_minutes,
      data.allowancePerDay !== undefined ? num(data.allowancePerDay) : num(cur.allowance_per_day),
      data.allowancePerHour !== undefined ? num(data.allowancePerHour) : num(cur.allowance_per_hour),
      data.otRateFactor !== undefined ? num(data.otRateFactor) || 1 : num(cur.ot_rate_factor),
      data.color !== undefined ? (data.color || null) : cur.color,
      data.sortOrder !== undefined ? Number(data.sortOrder) || 0 : cur.sort_order,
      data.active !== undefined ? !!data.active : cur.active,
    ]
  );
  return getShiftDef(code);
}

// ============================================================
// 二、排班导入 / 查询 / 手工调整
// ============================================================

/**
 * 排班导入模板列定义（供前端生成 Excel）。
 * 与 attendanceImportTemplate 保持一致：同步返回 {columns}（不含班次选项），
 * 班次可选值请用 GET /api/attendance/shifts 单独获取。
 */
export function scheduleImportTemplate() {
  return {
    columns: [
      { key: 'employee_no', label: '工号',   label_vi: 'Mã nhân viên' },
      { key: 'work_date',   label: '日期',   label_vi: 'Ngày' },
      { key: 'shift_code',  label: '班次编码', label_vi: 'Mã ca' },
      { key: 'remark',      label: '备注',   label_vi: 'Ghi chú' },
    ],
  };
}

/**
 * 批量导入排班（逐行校验，UPSERT 可覆盖）。
 * 与打卡导入不同：排班允许覆盖（ERP 导错要能改）。
 * @param {object[]} rows 每行 {employee_no, work_date, shift_code, remark}
 * @param {number} userId 操作者
 * @returns {Promise<{inserted:number, updated:number, failed:number, errors:Array, batch:string}>}
 */
export async function importSchedule(rows, userId) {
  const errors = [];
  let inserted = 0, updated = 0, failed = 0;
  const list = Array.isArray(rows) ? rows : [];
  const batch = `SCH-${Date.now()}-${userId || 0}`;

  // 预取班次定义（含 rest），避免逐行查库。
  // 用 shift-resolver 而不是裸 Set：现场填「白班/夜班/Ca đêm」也要能导入 ——
  // 编码优先命中，与改造前完全一致；只有编码没命中时才走名称别名。
  const shiftRows = await many(`SELECT code, name, name_vi FROM attendance_shift_def`);
  const resolveShift = makeShiftResolver(shiftRows);
  const validCodes = new Set(shiftRows.map(r => r.code));
  validCodes.add(REST_CODE);

  for (let idx = 0; idx < list.length; idx++) {
    const raw = list[idx] || {};
    const rowNo = idx + 2; // Excel 行号（含表头）

    const empNo = raw.employee_no != null ? String(raw.employee_no).trim() : '';
    const workDate = parseDate(raw.work_date);
    const rawShift = raw.shift_code != null ? String(raw.shift_code).trim() : '';
    const shiftCode = resolveShift(rawShift);

    if (!empNo) { errors.push({ row: rowNo, field: 'employee_no', msg: '工号必填' }); failed++; continue; }
    if (!workDate) { errors.push({ row: rowNo, field: 'work_date', msg: `日期无效：${raw.work_date}` }); failed++; continue; }
    if (!rawShift) { errors.push({ row: rowNo, field: 'shift_code', msg: '班次编码必填' }); failed++; continue; }
    if (!shiftCode) {
      errors.push({ row: rowNo, field: 'shift_code', msg: `班次编码不存在：${rawShift}（可用：${[...validCodes].join('/')}，也可填中文名如「白班」）` });
      failed++;
      continue;
    }

    const user = await one(`SELECT id FROM org_user WHERE employee_no = $1 LIMIT 1`, [empNo]);
    if (!user) { errors.push({ row: rowNo, field: 'employee_no', msg: `工号不存在：${empNo}` }); failed++; continue; }

    try {
      // 先探是否存在，以区分 inserted / updated（upsert 结果需返回给用户）
      const exist = await one(
        `SELECT id FROM attendance_schedule WHERE user_id = $1 AND work_date = $2::date`,
        [user.id, workDate]
      );
      await query(
        `INSERT INTO attendance_schedule
           (user_id, work_date, shift_code, source, import_batch, remark, created_by, updated_at)
         VALUES ($1, $2::date, $3, 'import', $4, $5, $6, now())
         ON CONFLICT (user_id, work_date) DO UPDATE SET
           shift_code = EXCLUDED.shift_code,
           source = EXCLUDED.source,
           import_batch = EXCLUDED.import_batch,
           remark = EXCLUDED.remark,
           updated_at = now()`,
        [user.id, workDate, shiftCode, batch, raw.remark != null ? String(raw.remark) : null, userId || null]
      );
      if (exist) updated++; else inserted++;
    } catch (err) {
      errors.push({ row: rowNo, field: '', msg: err.message });
      failed++;
    }
  }
  return { inserted, updated, failed, errors, batch };
}

/**
 * 排班列表 / 月历数据。
 * 未传 page 返回数组；传 page 返回 {list,total,page,pageSize}。
 * @param {{from?:string,to?:string,userId?:number,departmentId?:number,shiftCode?:string,page?:number,pageSize?:number}} opts
 */
export async function listSchedule({ from, to, userId, departmentId, shiftCode, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND s.user_id = $${params.length}`; }
  if (departmentId) { params.push(Number(departmentId)); where += ` AND u.department_id = $${params.length}`; }
  if (shiftCode) { params.push(String(shiftCode)); where += ` AND s.shift_code = $${params.length}`; }
  if (from) { params.push(dateParam(from, '起始')); where += ` AND s.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND s.work_date <= $${params.length}`; }

  const selectSql =
    `SELECT s.*, u.real_name, u.employee_no, u.department_id,
            d.name AS department_name, d.name_vi AS department_name_vi,
            sd.name AS shift_name, sd.name_vi AS shift_name_vi, sd.color AS shift_color
       FROM attendance_schedule s
       JOIN org_user u ON u.id = s.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN attendance_shift_def sd ON sd.code = s.shift_code
      WHERE ${where}
      ORDER BY s.work_date, u.employee_no, u.id`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(
    `SELECT COUNT(*)::int AS n FROM attendance_schedule s JOIN org_user u ON u.id = s.user_id WHERE ${where}`,
    params
  );
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 手工调整单个排班单元格（月历点击调班）。
 * 传 shiftCode = null / '' / 'rest' 中的 rest 表示设为休息；
 * 传 shiftCode = '__clear__' 或 null 且 clear=true 表示删除该排班记录。
 * @param {{userId:number, workDate:string, shiftCode:string, remark?:string}} data
 * @param {number} operator
 */
export async function setScheduleCell(data, operator) {
  const userId = Number(data?.userId);
  const workDate = parseDate(data?.workDate);
  if (!userId) throw Object.assign(new Error('员工必填'), { statusCode: 400 });
  if (!workDate) throw Object.assign(new Error('日期无效（YYYY-MM-DD）'), { statusCode: 400 });

  const user = await one(`SELECT id, employee_no FROM org_user WHERE id = $1`, [userId]);
  if (!user) throw Object.assign(new Error('员工不存在'), { statusCode: 400 });

  // 清空：删除该单元格排班
  const shiftCode = data?.shiftCode != null ? String(data.shiftCode).trim() : '';
  if (data?.clear === true || shiftCode === '__clear__' || shiftCode === '') {
    await query(
      `DELETE FROM attendance_schedule WHERE user_id = $1 AND work_date = $2::date`,
      [userId, workDate]
    );
    return { ok: true, action: 'cleared', userId, workDate };
  }

  // 校验班次编码
  const valid = shiftCode === REST_CODE
    || !!(await one(`SELECT code FROM attendance_shift_def WHERE code = $1`, [shiftCode]));
  if (!valid) {
    throw Object.assign(new Error(`班次编码「${shiftCode}」不存在或未启用，请从班次设置中选择`), { statusCode: 400 });
  }

  await query(
    `INSERT INTO attendance_schedule
       (user_id, work_date, shift_code, source, remark, created_by, updated_at)
     VALUES ($1, $2::date, $3, 'manual', $4, $5, now())
     ON CONFLICT (user_id, work_date) DO UPDATE SET
       shift_code = EXCLUDED.shift_code,
       source = 'manual',
       remark = EXCLUDED.remark,
       updated_at = now()`,
    [userId, workDate, shiftCode, data?.remark != null ? String(data.remark) : null, operator || null]
  );
  return { ok: true, action: 'set', userId, workDate, shiftCode };
}

/**
 * 批量刷班（月历框选多人多日）。
 * @param {{userIds:number[], dates:string[], shiftCode:string, remark?:string}} data
 * @param {number} operator
 */
export async function batchSetSchedule(data, operator) {
  const userIds = Array.isArray(data?.userIds) ? data.userIds.map(Number).filter(Boolean) : [];
  const rawDates = Array.isArray(data?.dates) ? data.dates : [];
  const dates = [...new Set(rawDates.map(parseDate).filter(Boolean))];
  const shiftCode = data?.shiftCode != null ? String(data.shiftCode).trim() : '';

  if (!userIds.length) throw Object.assign(new Error('请至少选择一名员工'), { statusCode: 400 });
  if (!dates.length) throw Object.assign(new Error('请至少选择一个日期'), { statusCode: 400 });
  if (!shiftCode) throw Object.assign(new Error('请选择班次'), { statusCode: 400 });
  if (shiftCode !== REST_CODE) {
    const valid = !!(await one(`SELECT code FROM attendance_shift_def WHERE code = $1`, [shiftCode]));
    if (!valid) throw Object.assign(new Error(`班次编码「${shiftCode}」不存在或未启用`), { statusCode: 400 });
  }
  if (userIds.length * dates.length > 5000) {
    throw Object.assign(new Error('单次批量刷班超过 5000 格，请缩小范围'), { statusCode: 400 });
  }

  const remark = data?.remark != null ? String(data.remark) : null;
  let affected = 0;
  await transaction(async client => {
    for (const uid of userIds) {
      for (const d of dates) {
        await client.query(
          `INSERT INTO attendance_schedule
             (user_id, work_date, shift_code, source, remark, created_by, updated_at)
           VALUES ($1, $2::date, $3, 'manual', $4, $5, now())
           ON CONFLICT (user_id, work_date) DO UPDATE SET
             shift_code = EXCLUDED.shift_code,
             source = 'manual',
             remark = EXCLUDED.remark,
             updated_at = now()`,
          [uid, d, shiftCode, remark, operator || null]
        );
        affected++;
      }
    }
  });
  return { ok: true, action: 'batch_set', affected, users: userIds.length, dates: dates.length, shiftCode };
}

/**
 * 排班导出结构（前端生成 xlsx）。表头中越双语。
 * @param {{from?:string,to?:string,departmentId?:number}} opts
 */
export async function scheduleExport({ from, to, departmentId } = {}) {
  const columns = [
    { key: 'employee_no',  label: '工号',     label_vi: 'Mã nhân viên' },
    { key: 'real_name',    label: '姓名',     label_vi: 'Họ tên' },
    { key: 'department_name', label: '部门',  label_vi: 'Bộ phận' },
    { key: 'work_date',    label: '日期',     label_vi: 'Ngày' },
    { key: 'shift_name',   label: '班次',     label_vi: 'Ca' },
    { key: 'shift_code',   label: '班次编码', label_vi: 'Mã ca' },
    { key: 'source',       label: '来源',     label_vi: 'Nguồn' },
    { key: 'remark',       label: '备注',     label_vi: 'Ghi chú' },
  ];
  const list = await listSchedule({ from, to, departmentId });
  const rows = (list || []).map(s => ({
    employee_no: s.employee_no,
    real_name: s.real_name,
    department_name: s.department_name,
    work_date: typeof s.work_date === 'string' ? s.work_date.slice(0, 10) : String(s.work_date).slice(0, 10),
    shift_name: s.shift_name || (s.shift_code === REST_CODE ? '休息' : s.shift_code),
    shift_code: s.shift_code,
    source: s.source,
    remark: s.remark,
  }));
  return { columns, rows };
}

// ============================================================
// 三、卡点识别 detectAnomalies
// ------------------------------------------------------------
// 比对「应上班次（排班）」与「实际打卡」，产出 7 类违规异常：
//   absent_no_check   应到未到（排班上班但无任何打卡）      high
//   work_on_rest      休息日出勤（排班休息却有打卡）        medium
//   night_missing     夜班缺卡（排班夜班但只有单边打卡）    high
//   shift_mismatch    班次错位（打卡推导班次 ≠ 排班班次）    high
//   consecutive_cross 跨班连上（前日下班↔当日上班间隔过短）  high
//   late_early_by_shift 迟到早退（按班次时间窗，超容差）     medium
//   unscheduled       未排班出勤（无排班记录却有打卡）       low
//
// 口径要点：
//   · 夜班跨天：工作日 = 排班的 work_date（上班当天）；下班时刻在次日。
//   · 迟到 = 实际上班 - 计划上班（> flex_minutes 才算）；早退 = 计划下班 - 实际下班。
//   · 一天多次打卡取最早上班 / 最晚下班。
//   · 已 resolved=true 的卡点不被重算覆盖（人工确认过的不翻案）。
//   · 无排班记录的天，只判 unscheduled（不判"应到未到"——没有"应到"依据）。
// ============================================================

/** 由打卡时刻推导实际班次：取与打卡时段最贴合的班次（UTC 基准，与 atDateTime 一致） */
function inferShiftFromPunch(checkIn, shiftDefs) {
  if (!checkIn) return null;
  const d = new Date(checkIn);
  if (Number.isNaN(d.getTime())) return null;
  // 与计划时刻同用 UTC 视角，避免两套基准混比
  const localHour = d.getUTCHours() + d.getUTCMinutes() / 60;
  let best = null, bestDist = Infinity;
  for (const sd of shiftDefs) {
    const hm = parseTime(sd.start_time);
    if (!hm) continue;
    const sh = hm.h + hm.m / 60;
    // 环形距离（一天 24h），保证 23:00 与 01:00 相距 2h 而非 22h
    let dist = Math.abs(localHour - sh);
    if (dist > 12) dist = 24 - dist;
    if (dist < bestDist) { bestDist = dist; best = sd; }
  }
  // 距离超过 6 小时视为无法归入任何班次
  return bestDist <= 6 ? best?.code || null : null;
}

/**
 * 卡点识别主流程。
 * @param {{from:string, to:string, userId?:number, departmentId?:number}} opts
 * @returns {Promise<{from:string,to:string,users:number,detected:number,inserted:number,updated:number,skippedResolved:number,byType:object}>}
 */
export async function detectAnomalies({ from, to, userId, departmentId } = {}) {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) {
    throw Object.assign(new Error('请提供有效的起止日期（from/to，YYYY-MM-DD）'), { statusCode: 400 });
  }
  if (fromDate > toDate) {
    throw Object.assign(new Error('起始日期不能晚于结束日期'), { statusCode: 400 });
  }

  const shiftDefs = await many(`SELECT * FROM attendance_shift_def WHERE active = TRUE ORDER BY sort_order`);
  const shiftMap = new Map(shiftDefs.map(s => [s.code, s]));
  const crossThreshold = await getCrossThresholdHours();
  const holidaySet = await getHolidaySet();

  // 【调休】日期性质覆盖（第 35 轮）：user 优先 dept；为空时零副作用
  let overrideRowMap = new Map(); // `${userId}|${date}` → day_type
  let deptOverrideMap = new Map(); // `${deptId}|${date}` → day_type
  try {
    const ovRows = await many(
      `SELECT work_date, day_type, scope, user_id, department_id
         FROM attendance_day_override
        WHERE work_date BETWEEN $1::date AND $2::date`,
      [fromDate, toDate]
    );
    for (const r of ovRows) {
      const k = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : String(r.work_date).slice(0, 10);
      if (r.scope === 'user' && r.user_id) overrideRowMap.set(`${r.user_id}|${k}`, r.day_type);
      else if (r.scope === 'dept' && r.department_id) deptOverrideMap.set(`${r.department_id}|${k}`, r.day_type);
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err; // 覆盖表未迁移则忽略
  }

  // 取该区间内有排班 / 有打卡 / 有调休覆盖的用户
  const params = [fromDate, toDate];
  let userFilter = '';
  let deptFilter = '';
  if (userId) { params.push(Number(userId)); userFilter = ` AND ou.id = $${params.length}`; }
  if (departmentId) { params.push(Number(departmentId)); deptFilter = ` AND ou.department_id = $${params.length}`; }

  const users = await many(
    `SELECT DISTINCT ou.id, ou.real_name, ou.employee_no, ou.department_id
       FROM org_user ou
      WHERE ou.active = TRUE
        AND (
          EXISTS (SELECT 1 FROM attendance_schedule s
                   WHERE s.user_id = ou.id AND s.work_date BETWEEN $1::date AND $2::date)
          OR EXISTS (SELECT 1 FROM attendance_raw r
                      WHERE r.user_id = ou.id AND r.work_date BETWEEN $1::date AND $2::date)
          -- 【调休】仅有日期性质覆盖、既无排班也无打卡的用户也必须纳入：
          --   欠班日通常"不改排班、不打考勤"，仅靠覆盖表表达，否则 comp_no_repay /
          --   owe_unsettled 两个卡点永远无法命中（欠班被静默吞掉）。
          OR EXISTS (SELECT 1 FROM attendance_day_override o
                      WHERE o.work_date BETWEEN $1::date AND $2::date
                        AND (
                              (o.scope = 'user' AND o.user_id = ou.id)
                           OR (o.scope = 'dept' AND o.department_id = ou.department_id)
                        ))
        )${userFilter}${deptFilter}`,
    params
  ).catch(err => {
    // 覆盖表尚未迁移（42P01）→ 回退为原两来源查询，保持零副作用
    if (err?.code !== '42P01') throw err;
    return many(
      `SELECT DISTINCT ou.id, ou.real_name, ou.employee_no, ou.department_id
         FROM org_user ou
        WHERE ou.active = TRUE
          AND (
            EXISTS (SELECT 1 FROM attendance_schedule s
                     WHERE s.user_id = ou.id AND s.work_date BETWEEN $1::date AND $2::date)
            OR EXISTS (SELECT 1 FROM attendance_raw r
                        WHERE r.user_id = ou.id AND r.work_date BETWEEN $1::date AND $2::date)
          )${userFilter}${deptFilter}`,
      params
    );
  });

  const byType = {};
  let detected = 0, inserted = 0, updated = 0, skippedResolved = 0;

  for (const u of users) {
    // 排班（区间内 + 前一日，前一日用于跨班连上判定）
    const schedRows = await many(
      `SELECT work_date, shift_code FROM attendance_schedule
        WHERE user_id = $1 AND work_date BETWEEN ($2::date - INTERVAL '1 day') AND $3::date`,
      [u.id, fromDate, toDate]
    );
    const schedMap = new Map();
    for (const s of schedRows) {
      const k = typeof s.work_date === 'string' ? s.work_date.slice(0, 10) : String(s.work_date).slice(0, 10);
      schedMap.set(k, s.shift_code);
    }

    // 打卡（区间内 + 前一日）
    const rawRows = await many(
      `SELECT work_date, check_in, check_out FROM attendance_raw
        WHERE user_id = $1 AND work_date BETWEEN ($2::date - INTERVAL '1 day') AND $3::date`,
      [u.id, fromDate, toDate]
    );
    // 按工作日聚合（最早上班 / 最晚下班；跨天夜班的下班可能记在次日行，这里按 work_date 归属）
    const punchMap = new Map();
    for (const r of rawRows) {
      const k = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : String(r.work_date).slice(0, 10);
      const cur = punchMap.get(k) || { in: null, out: null, inRaw: null, outRaw: null };
      if (r.check_in && (!cur.in || new Date(r.check_in) < new Date(cur.in))) { cur.in = r.check_in; cur.inRaw = r; }
      if (r.check_out && (!cur.out || new Date(r.check_out) > new Date(cur.out))) { cur.out = r.check_out; cur.outRaw = r; }
      punchMap.set(k, cur);
    }

    // 遍历区间内每一天
    let cursor = fromDate;
    let guard = 0;
    while (cursor <= toDate && guard++ < 400) {
      const curDate = cursor;
      const shiftCode = schedMap.get(curDate) || null;
      const punch = punchMap.get(curDate) || { in: null, out: null };
      const hasPunch = !!(punch.in || punch.out);
      // 【调休】日期性质覆盖优先（user > dept）
      const ovType = overrideRowMap.get(`${u.id}|${curDate}`)
        || (u.department_id ? deptOverrideMap.get(`${u.department_id}|${curDate}`) : null)
        || null;
      const schedIsRest = shiftCode === REST_CODE;
      let hasSched = !!shiftCode;
      let isRest = schedIsRest;
      // 覆盖为 rest：该日视为休息（即便排班未改）
      if (ovType === 'rest') { isRest = true; if (!hasSched) hasSched = true; }
      // 覆盖为 workday：该日视为上班（即便排班是 rest / 无排班）
      if (ovType === 'workday') {
        isRest = false;
        if (!hasSched) hasSched = true;
      }

      // 产生的异常 [{type, severity, detail}]
      const found = [];

      // ---------- 无排班但有打卡 → 未排班出勤 ----------
      // 覆盖为 workday 时不算"未排班"（属已批准的调休补班）
      if (!hasSched && hasPunch && ovType !== 'workday') {
        found.push({
          type: 'unscheduled', severity: 'low', expected: null,
          detail: { check_in: punch.in, check_out: punch.out, note: '无排班记录却有打卡，请确认是否漏导排班或临时加班' },
        });
      }

      if (hasSched && !isRest) {
        const sd = shiftMap.get(shiftCode);
        const startHm = sd ? parseTime(sd.start_time) : null;
        const endHm = sd ? parseTime(sd.end_time) : null;
        const crossDay = !!sd?.cross_day;
        const flex = sd ? Number(sd.flex_minutes) || 0 : 0;

        // 实际班次推导
        const actualShift = inferShiftFromPunch(punch.in, shiftDefs);

        // ---------- 应到未到 ----------
        if (!hasPunch) {
          found.push({
            type: 'absent_no_check', severity: 'high', expected: shiftCode,
            detail: {
              expected_shift: shiftCode,
              planned_in: startHm ? `${sd.start_time}` : null,
              note: '排班为上班，但当天无任何打卡记录',
            },
          });
        } else {
          // ---------- 夜班缺卡 ----------
          if (crossDay && sd?.code && String(sd.code).includes('night') && (!punch.in || !punch.out)) {
            found.push({
              type: 'night_missing', severity: 'high', expected: shiftCode, actual: actualShift,
              detail: {
                check_in: punch.in, check_out: punch.out,
                note: !punch.in ? '夜班缺上班打卡' : '夜班缺下班打卡',
              },
            });
          }

          // ---------- 班次错位 ----------
          if (actualShift && actualShift !== shiftCode) {
            found.push({
              type: 'shift_mismatch', severity: 'high', expected: shiftCode, actual: actualShift,
              detail: {
                check_in: punch.in, check_out: punch.out,
                note: `打卡时刻推导为「${actualShift}」，与排班「${shiftCode}」不符`,
              },
            });
          }

          // ---------- 迟到 / 早退（按班次时间窗） ----------
          let lateMinutes = 0, earlyMinutes = 0;
          const isHoliday = holidaySet.has(curDate);
          if (!isHoliday && startHm && punch.in) {
            const plannedIn = new Date(atDateTime(curDate, startHm, 0));
            const diff = Math.round((new Date(punch.in) - plannedIn) / 60000);
            if (diff > flex) lateMinutes = diff;
          }
          if (!isHoliday && endHm && punch.out) {
            const plannedOut = new Date(atDateTime(curDate, endHm, crossDay ? 1 : 0));
            const diff = Math.round((plannedOut - new Date(punch.out)) / 60000);
            // 跨天夜班：下班打卡若落在工作日当天（早退超过 12h），视为数据错位，不计早退
            if (diff > flex && diff < 12 * 60) earlyMinutes = diff;
          }
          if (lateMinutes > 0 || earlyMinutes > 0) {
            found.push({
              type: 'late_early_by_shift', severity: 'medium', expected: shiftCode, actual: actualShift,
              detail: {
                late_minutes: lateMinutes, early_minutes: earlyMinutes,
                planned_in: sd?.start_time || null, planned_out: sd?.end_time || null,
                check_in: punch.in, check_out: punch.out,
                flex_minutes: flex,
              },
            });
          }
        }

        // ---------- 跨班连上 ----------
        // 前一日有排班且为上班，前一日实际下班 与 当日实际上班 间隔 < 阈值 且班次不同
        const prevDate = addDays(curDate, -1);
        const prevShift = schedMap.get(prevDate);
        if (prevShift && prevShift !== REST_CODE && prevShift !== shiftCode && punch.in) {
          const prevPunch = punchMap.get(prevDate);
          if (prevPunch?.out) {
            const gapHours = (new Date(punch.in) - new Date(prevPunch.out)) / 3600000;
            if (gapHours >= 0 && gapHours < crossThreshold) {
              found.push({
                type: 'consecutive_cross', severity: 'high',
                expected: shiftCode, actual: actualShift,
                detail: {
                  prev_shift: prevShift, cur_shift: shiftCode,
                  prev_check_out: prevPunch.out, cur_check_in: punch.in,
                  gap_hours: round2(gapHours), threshold_hours: crossThreshold,
                  note: `前一日「${prevShift}」下班后仅 ${round2(gapHours)}h 即接「${shiftCode}」上班`,
                },
              });
            }
          }
        }
      }

      // ---------- 休息日出勤 ----------
      // 覆盖为 workday（已批准调休补班）→ 不报；覆盖为 rest 时视为休息，照常按 rest 判定
      if (isRest && hasPunch && ovType !== 'workday') {
        found.push({
          type: 'work_on_rest', severity: 'medium', expected: REST_CODE, actual: inferShiftFromPunch(punch.in, shiftDefs),
          detail: {
            check_in: punch.in, check_out: punch.out,
            note: ovType === 'rest'
              ? '该日为调休休息日（已批准），但有打卡记录，请确认是否报批加班'
              : '排班为休息，但有打卡记录，请确认是否报批加班',
          },
        });
      }

      // ---------- 【调休】已批补班但未出勤 → comp_no_repay ----------
      if (ovType === 'workday' && !hasPunch) {
        found.push({
          type: 'comp_no_repay', severity: 'medium', expected: null, actual: null,
          detail: {
            note: '该日已被批准为调休补班日（日期性质覆盖为上班），但当天无任何打卡记录',
            overridden_day_type: 'workday',
          },
        });
      }

      // ---------- 落库（幂等 + 保护已闭环） ----------
      for (const f of found) {
        detected++;
        byType[f.type] = (byType[f.type] || 0) + 1;
        const exist = await one(
          `SELECT id, resolved FROM attendance_anomaly
            WHERE user_id = $1 AND work_date = $2::date AND anomaly_type = $3`,
          [u.id, curDate, f.type]
        );
        if (exist?.resolved) { skippedResolved++; continue; } // 人工确认过的不翻案

        await query(
          `INSERT INTO attendance_anomaly
             (user_id, work_date, anomaly_type, severity, expected_shift, actual_shift, detail, detected_at)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, work_date, anomaly_type) DO UPDATE SET
             severity = EXCLUDED.severity,
             expected_shift = EXCLUDED.expected_shift,
             actual_shift = EXCLUDED.actual_shift,
             detail = EXCLUDED.detail,
             detected_at = now()`,
          [
            u.id, curDate, f.type, f.severity, f.expected || null, f.actual || null,
            JSON.stringify(f.detail || {}),
          ]
        );
        if (exist) updated++; else inserted++;
      }

      cursor = addDays(cursor, 1);
    }

    // ---------- 【调休】欠班逾期未补 → owe_unsettled（每人一条，挂在欠班日） ----------
    try {
      const overdue = await many(
        `SELECT id, work_date, hours FROM attendance_owe_ledger
          WHERE user_id = $1 AND entry_type = 'owe' AND status = 'open'
            AND expire_date < CURRENT_DATE
            AND work_date BETWEEN $2::date AND $3::date`,
        [u.id, fromDate, toDate]
      );
      for (const od of overdue) {
        const odDate = typeof od.work_date === 'string' ? od.work_date.slice(0, 10) : String(od.work_date).slice(0, 10);
        detected++; byType.owe_unsettled = (byType.owe_unsettled || 0) + 1;
        const exist = await one(
          `SELECT id, resolved FROM attendance_anomaly
            WHERE user_id = $1 AND work_date = $2::date AND anomaly_type = 'owe_unsettled'`,
          [u.id, odDate]
        );
        if (exist?.resolved) { skippedResolved++; continue; }
        await query(
          `INSERT INTO attendance_anomaly
             (user_id, work_date, anomaly_type, severity, expected_shift, actual_shift, detail, detected_at)
           VALUES ($1, $2::date, 'owe_unsettled', 'high', NULL, NULL, $3, now())
           ON CONFLICT (user_id, work_date, anomaly_type) DO UPDATE SET
             severity = EXCLUDED.severity, detail = EXCLUDED.detail, detected_at = now()`,
          [u.id, odDate, JSON.stringify({ owe_ledger_id: Number(od.id), hours: num(od.hours), note: '欠班已超应还截止日仍未补' })]
        );
        if (exist) updated++; else inserted++;
      }
    } catch (err) {
      if (err?.code !== '42P01') throw err; // 账本表未迁移则忽略
    }
  }

  return {
    from: fromDate, to: toDate, users: users.length,
    detected, inserted, updated, skippedResolved, byType,
  };
}

// ============================================================
// 四、卡点列表 / 统计 / 闭环
// ============================================================

/**
 * 卡点列表（分页契约；未传 page 返回数组）。
 * @param {{from?:string,to?:string,userId?:number,anomalyType?:string,severity?:string,resolved?:boolean,page?:number,pageSize?:number}} opts
 */
export async function listAnomalies({
  from, to, userId, anomalyType, severity, resolved, departmentId, page, pageSize,
} = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND a.user_id = $${params.length}`; }
  if (departmentId) { params.push(Number(departmentId)); where += ` AND u.department_id = $${params.length}`; }
  if (anomalyType) { params.push(String(anomalyType)); where += ` AND a.anomaly_type = $${params.length}`; }
  if (severity) { params.push(String(severity)); where += ` AND a.severity = $${params.length}`; }
  if (resolved !== undefined && resolved !== null && resolved !== '') {
    params.push(String(resolved) === 'true' || resolved === true);
    where += ` AND a.resolved = $${params.length}`;
  }
  if (from) { params.push(dateParam(from, '起始')); where += ` AND a.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND a.work_date <= $${params.length}`; }

  const selectSql =
    `SELECT a.*, u.real_name, u.employee_no, u.department_id,
            d.name AS department_name,
            ru.real_name AS resolved_by_name,
            mu.real_name AS remedy_by_name,
            fi.instance_no AS remedy_instance_no, fi.status AS remedy_instance_status,
            sd.name AS expected_shift_name, sd.name_vi AS expected_shift_name_vi,
            sd.start_time AS shift_start_time, sd.end_time AS shift_end_time,
            sd.cross_day AS shift_cross_day, sd.name_vi AS shift_name_vi
       FROM attendance_anomaly a
       JOIN org_user u ON u.id = a.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN org_user ru ON ru.id = a.resolved_by
       LEFT JOIN org_user mu ON mu.id = a.remedy_by
       LEFT JOIN flow_instance fi ON fi.id = a.remedy_instance_id
       LEFT JOIN attendance_shift_def sd ON sd.code = a.expected_shift
      WHERE ${where}
      ORDER BY a.work_date DESC, CASE a.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, u.id`;

  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(
    `SELECT COUNT(*)::int AS n FROM attendance_anomaly a JOIN org_user u ON u.id = a.user_id WHERE ${where}`,
    params
  );
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 卡点统计（按类型 / 严重度聚合）。
 * @param {{from?:string,to?:string,departmentId?:number}} opts
 */
export async function anomalyStats({ from, to, departmentId } = {}) {
  const params = [];
  let where = '1=1';
  if (from) { params.push(dateParam(from, '起始')); where += ` AND a.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND a.work_date <= $${params.length}`; }
  if (departmentId) { params.push(Number(departmentId)); where += ` AND u.department_id = $${params.length}`; }

  const byType = await many(
    `SELECT a.anomaly_type, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE a.resolved = FALSE)::int AS unresolved
       FROM attendance_anomaly a JOIN org_user u ON u.id = a.user_id
      WHERE ${where} GROUP BY a.anomaly_type ORDER BY n DESC`,
    params
  );
  const total = await one(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE a.resolved = FALSE)::int AS unresolved,
            COUNT(DISTINCT a.user_id)::int AS users
       FROM attendance_anomaly a JOIN org_user u ON u.id = a.user_id WHERE ${where}`,
    params
  );
  return { total: total?.n || 0, unresolved: total?.unresolved || 0, users: total?.users || 0, byType };
}

/**
 * 卡点人工闭环。
 * @param {number} id
 * @param {string} note 闭环说明
 * @param {number} operator
 */
export async function resolveAnomaly(id, note, operator) {
  const cur = await one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [id]);
  if (!cur) throw Object.assign(new Error('卡点记录不存在'), { statusCode: 404 });
  if (cur.resolved) return { ...cur, alreadyResolved: true };

  await query(
    `UPDATE attendance_anomaly
        SET resolved = TRUE, resolved_by = $2, resolved_at = now(), resolve_note = $3
      WHERE id = $1`,
    [id, operator || null, note != null ? String(note) : null]
  );
  return one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [id]);
}

/**
 * 撤销闭环（误操作回退）。
 * @param {number} id
 */
export async function unresolveAnomaly(id) {
  const cur = await one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [id]);
  if (!cur) throw Object.assign(new Error('卡点记录不存在'), { statusCode: 404 });
  await query(
    `UPDATE attendance_anomaly
        SET resolved = FALSE, resolved_by = NULL, resolved_at = NULL, resolve_note = NULL
      WHERE id = $1`,
    [id]
  );
  return one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [id]);
}

/**
 * 卡点导出结构（前端生成 xlsx）。
 */
export async function anomalyExport({ from, to, anomalyType, resolved, departmentId } = {}) {
  const columns = [
    { key: 'employee_no',    label: '工号',     label_vi: 'Mã nhân viên' },
    { key: 'real_name',      label: '姓名',     label_vi: 'Họ tên' },
    { key: 'department_name', label: '部门',    label_vi: 'Bộ phận' },
    { key: 'work_date',      label: '日期',     label_vi: 'Ngày' },
    { key: 'anomaly_type',   label: '卡点类型', label_vi: 'Loại bất thường' },
    { key: 'severity',       label: '严重度',   label_vi: 'Mức độ' },
    { key: 'expected_shift', label: '应上班次', label_vi: 'Ca dự kiến' },
    { key: 'expected_shift_name', label: '应上班次名称', label_vi: 'Tên ca dự kiến' },
    { key: 'actual_shift',   label: '实际班次', label_vi: 'Ca thực tế' },
    { key: 'remedy_status',  label: '补卡状态', label_vi: 'Trạng thái bổ sung' },
    { key: 'resolved',       label: '已闭环',   label_vi: 'Đã xử lý' },
    { key: 'resolve_note',   label: '闭环说明', label_vi: 'Ghi chú xử lý' },
  ];
  const list = await listAnomalies({ from, to, anomalyType, resolved, departmentId });
  const REMEDY_ZH = { none: '未补卡', applying: '补卡审批中', done: '已补卡闭环', rejected: '补卡被驳回' };
  const rows = (list || []).map(a => ({
    employee_no: a.employee_no,
    real_name: a.real_name,
    department_name: a.department_name,
    work_date: typeof a.work_date === 'string' ? a.work_date.slice(0, 10) : String(a.work_date).slice(0, 10),
    anomaly_type: a.anomaly_type,
    severity: a.severity,
    expected_shift: a.expected_shift,
    expected_shift_name: a.expected_shift_name || (a.expected_shift === REST_CODE ? '休息' : a.expected_shift),
    actual_shift: a.actual_shift,
    remedy_status: REMEDY_ZH[a.remedy_status] || a.remedy_status || '未补卡',
    resolved: a.resolved ? 'Y' : 'N',
    resolve_note: a.resolve_note,
  }));
  return { columns, rows };
}

// ============================================================
// 五、卡点一键补卡（第33轮：加班/夜班漏卡支持签卡补卡）
// ============================================================

/**
 * 允许一键补卡的卡点类型（可由 sys_config.anomaly_auto_remedy_types 覆盖）。
 * 缺省：全天无打卡、夜班漏卡 —— 这两类即"漏卡"，本质可用补卡修复。
 * 排除 work_on_rest / shift_mismatch 等"排班本身就不一致"的类型，
 * 那些应先改排班而非补卡。
 */
const DEFAULT_REMEDIABLE = ['absent_no_check', 'night_missing'];

/** 读取可补卡类型集合（带 sys_config 覆盖） */
async function remediableTypes() {
  const row = await one(`SELECT value FROM sys_config WHERE key = 'anomaly_auto_remedy_types'`);
  if (!row?.value) return new Set(DEFAULT_REMEDIABLE);
  try {
    const arr = JSON.parse(row.value);
    if (Array.isArray(arr) && arr.length) return new Set(arr.map(String));
  } catch { /* 非 JSON → 逗号分隔兜底 */ }
  return new Set(String(row.value).split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * 补卡预填信息（供前端一键发起补卡时带出）。
 * 返回被签卡人、日期、建议时段、原因、班次等，前端直接填进 miss_card 表单。
 *
 * @param {number} anomalyId
 * @returns {Promise<object>}
 */
export async function missCardPreview(anomalyId) {
  const a = await one(
    `SELECT a.*, u.real_name, u.employee_no, u.department_id, d.name AS department_name
       FROM attendance_anomaly a
       JOIN org_user u ON u.id = a.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE a.id = $1`,
    [anomalyId]
  );
  if (!a) throw Object.assign(new Error('卡点记录不存在'), { statusCode: 404 });

  const shift = a.expected_shift
    ? await one(`SELECT * FROM attendance_shift_def WHERE code = $1`, [a.expected_shift])
    : null;

  const remediable = await remediableTypes();
  const { suggestMissSlot } = await import('./attendance-service.js');
  const suggestion = suggestMissSlot(a, shift);

  // 卡点类型 → 签卡原因选项（前端预填用）
  const REASON_BY_TYPE = {
    night_missing: 'night_shift',
    absent_no_check: 'forget',
    late_early_by_shift: 'forget',
    unscheduled: 'overtime',
  };
  const shiftIsNight = !!shift?.cross_day
    || String(shift?.start_time || '').slice(0, 2) >= '18'
    || shift?.code === 'night';
  const reasonType = a.anomaly_type === 'night_missing' || shiftIsNight
    ? (shiftIsNight ? 'night_shift' : 'overtime')
    : (REASON_BY_TYPE[a.anomaly_type] || 'forget');

  const workDate = typeof a.work_date === 'string' ? a.work_date.slice(0, 10) : String(a.work_date).slice(0, 10);

  return {
    anomalyId: Number(a.id),
    anomalyType: a.anomaly_type,
    severity: a.severity,
    subjectUserId: Number(a.user_id),
    subjectName: a.real_name,
    employeeNo: a.employee_no,
    departmentId: a.department_id ? Number(a.department_id) : null,
    departmentName: a.department_name,
    workDate,
    expectedShift: a.expected_shift,
    expectedShiftName: shift?.name || null,
    shiftIsNight,
    detail: a.detail || {},
    remediable: remediable.has(String(a.anomaly_type)),
    alreadyRemedied: a.resolved === true || a.remedy_status === 'done',
    remedyStatus: a.remedy_status || 'none',
    remedyInstanceId: a.remedy_instance_id ? Number(a.remedy_instance_id) : null,
    suggestion,                       // { slot, field, hour, minute, crossDay } | null
    reasonType,                       // 预填的未打卡原因
    suggestTitle: `签卡补卡申请单（${workDate} ${a.real_name}）`,
  };
}

/**
 * 一键发起补卡：在卡点上创建 miss_card 实例（草稿或直接提交），并回写卡点状态。
 *
 * 事务语义：
 *   1) 校验卡点存在、类型可补、未闭环、无在途补卡单。
 *   2) 用 createInstance 建单（applicantId=操作人，subjectUserId=被签卡人）。
 *   3) 回写 anomaly.remedy_instance_id / remedy_status='applying' / remedy_by。
 *   4) submitNow=true 时立即提交（走审批流）。
 *
 * 【授权】代提授权由路由层的 assertDelegateAllowed 统一把关（与 /api/instances 同源），
 *   本函数只做"卡点可补"的业务校验。
 *
 * @param {number} anomalyId
 * @param {object} opts { operatorId, submitNow, slot, reasonType, evidence, witness, formData }
 * @returns {Promise<{instance:object, anomaly:object, submitted:boolean}>}
 */
export async function createMissCardFromAnomaly(anomalyId, opts = {}) {
  const operatorId = Number(opts.operatorId);
  if (!operatorId) throw Object.assign(new Error('操作人缺失'), { statusCode: 400 });

  const a = await one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [anomalyId]);
  if (!a) throw Object.assign(new Error('卡点记录不存在'), { statusCode: 404 });
  if (a.resolved) throw Object.assign(new Error('该卡点已闭环，无需补卡'), { statusCode: 400 });

  const remediable = await remediableTypes();
  if (!remediable.has(String(a.anomaly_type))) {
    throw Object.assign(
      new Error(`卡点类型「${a.anomaly_type}」不支持补卡（应先调整排班或人工确认）`),
      { statusCode: 400 }
    );
  }

  // 已有在途补卡单 → 直接返回，避免重复建单
  if (a.remedy_instance_id) {
    const exist = await one(`SELECT * FROM flow_instance WHERE id = $1`, [a.remedy_instance_id]);
    if (exist && ['draft', 'running'].includes(exist.status)) {
      return { instance: exist, anomaly: a, submitted: exist.status === 'running', reused: true };
    }
  }

  const def = await one(`SELECT * FROM flow_definition WHERE code = 'miss_card' AND active = TRUE`);
  if (!def) throw Object.assign(new Error('签卡补卡流程未定义或已停用'), { statusCode: 500 });

  // 建议时段（未显式传 slot 时按卡点类型推导）
  let slot = opts.slot ? String(opts.slot) : null;
  if (!slot) {
    const shift = a.expected_shift
      ? await one(`SELECT * FROM attendance_shift_def WHERE code = $1`, [a.expected_shift])
      : null;
    const { suggestMissSlot } = await import('./attendance-service.js');
    slot = suggestMissSlot(a, shift)?.slot || 'morning';
  }

  const workDate = typeof a.work_date === 'string' ? a.work_date.slice(0, 10) : String(a.work_date).slice(0, 10);
  const shift = a.expected_shift
    ? await one(`SELECT * FROM attendance_shift_def WHERE code = $1`, [a.expected_shift])
    : null;
  const shiftIsNight = !!shift?.cross_day || shift?.code === 'night';
  const reasonType = opts.reasonType
    || (a.anomaly_type === 'night_missing' || shiftIsNight ? 'night_shift' : 'forget');

  const subject = await one(`SELECT real_name FROM org_user WHERE id = $1`, [a.user_id]);

  const formData = {
    miss_date: workDate,
    miss_time: slot,
    reason_type: reasonType,
    evidence: opts.evidence != null ? String(opts.evidence) : '',
    witness: opts.witness ?? null,
    on_behalf_of: Number(a.user_id),
    source_anomaly_id: Number(a.id),
    ...(opts.formData || {}),
  };

  const { createInstance, submitInstance } = await import('./flow-engine.js');
  const inst = await createInstance({
    definitionId: def.id,
    userId: operatorId,
    title: opts.title || `签卡补卡申请单（${workDate} ${subject?.real_name || ''}）`,
    formData,
    subjectUserId: Number(a.user_id),
  });

  // 回写卡点：补卡审批中
  await query(
    `UPDATE attendance_anomaly
        SET remedy_instance_id = $2, remedy_status = 'applying', remedy_by = $3, remedy_at = now()
      WHERE id = $1`,
    [Number(a.id), inst.id, operatorId]
  );

  let submitted = false;
  let advance = null;
  if (opts.submitNow) {
    advance = await submitInstance({ instanceId: inst.id, userId: operatorId });
    submitted = true;
  }

  const fresh = await one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [a.id]);
  return { instance: { ...inst, advance }, anomaly: fresh, submitted };
}

/**
 * 撤销卡点的补卡关联（补卡单被删除/撤回时回收）。
 * @param {number} anomalyId
 */
export async function clearAnomalyRemedy(anomalyId) {
  const a = await one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [anomalyId]);
  if (!a) throw Object.assign(new Error('卡点记录不存在'), { statusCode: 404 });
  await query(
    `UPDATE attendance_anomaly
        SET remedy_instance_id = NULL,
            remedy_status = CASE WHEN resolved THEN 'done' ELSE 'none' END,
            remedy_by = NULL
      WHERE id = $1`,
    [anomalyId]
  );
  return one(`SELECT * FROM attendance_anomaly WHERE id = $1`, [anomalyId]);
}

/**
 * 补卡状态统计（卡点页签顶部：可补卡 / 审批中 / 已闭环 / 被驳回）。
 * @param {{from?:string,to?:string,departmentId?:number}} opts
 */
export async function remedyStats({ from, to, departmentId } = {}) {
  const base = [];
  let where = '1=1';
  if (from) { base.push(dateParam(from, '起始')); where += ` AND a.work_date >= $${base.length}`; }
  if (to) { base.push(dateParam(to, '结束')); where += ` AND a.work_date <= $${base.length}`; }
  if (departmentId) { base.push(Number(departmentId)); where += ` AND u.department_id = $${base.length}`; }

  const byStatus = await many(
    `SELECT COALESCE(a.remedy_status, 'none') AS status, COUNT(*)::int AS n
       FROM attendance_anomaly a JOIN org_user u ON u.id = a.user_id
      WHERE ${where}
      GROUP BY 1`,
    base
  );
  const out = { none: 0, applying: 0, done: 0, rejected: 0 };
  for (const r of byStatus) out[r.status] = r.n;

  // 可一键补卡数：未闭环 + 类型在可补集合内 + 无在途补卡单
  // 注意：可补类型数组作为**额外的**绑定参数追加在 base 之后
  const remediable = [...(await remediableTypes())];
  const params2 = [...base, remediable];
  const canRemedy = await one(
    `SELECT COUNT(*)::int AS n
       FROM attendance_anomaly a JOIN org_user u ON u.id = a.user_id
      WHERE ${where} AND a.resolved = FALSE
        AND a.anomaly_type = ANY($${params2.length}::text[])
        AND (a.remedy_instance_id IS NULL OR a.remedy_status IN ('none','rejected'))`,
    params2
  );

  return { ...out, canRemedy: canRemedy?.n || 0, remediableTypes: remediable };
}
