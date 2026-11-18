// ============================================================
// 调休 / 补班 服务（第 35 轮，迁移 33_comp_day.sql）
// ------------------------------------------------------------
// 需求（用户 2026-10-13）：「周三正班休息，周日上班，补周三的欠账」。
//   · 同一人两日期在工时上平移互抵，不产生加班费
//   · 按小时计算（Q5，0.5h 起）
//   · 个别人调休 + 集体调休（HR 一键批量）
//
// 职责：
//   · 日期性质覆盖（attendance_day_override）读写：user 优先 dept
//   · 欠班/补班小时账（attendance_owe_ledger）：owe 正 / repay 负 / FIFO 冲抵
//   · 余额 / 明细 / 统计 / 逾期扫描 / 批量下发
//   · 流程终态钩子 onCompDayClosed（幂等）：写覆盖 + 改排班 + 记账 + 冲抵 + 重算
//   · 驳回回滚 onCompDayRejected
//
// 设计约束：
//   · 终态回调幂等（按 source_instance_id + 唯一键收敛），失败仅 warn 不阻断主流程。
//   · 覆盖表为空时，既有考勤计算行为逐位不变（零副作用）。
//   · 中越双语：label 同时提供 label 与 label_vi。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { dateParam } from '../utils/params.js';

const REST_CODE = 'rest';
const DAY_TYPES = new Set(['workday', 'rest', 'holiday']);

// ------------------------------------------------------------
// 通用工具
// ------------------------------------------------------------
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}
function parseDate(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    return null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}
async function getConfig(key, fallback = null) {
  const r = await one(`SELECT value FROM sys_config WHERE key = $1`, [key]);
  return r?.value ?? fallback;
}
async function getMinHours() {
  const v = num(await getConfig('comp_min_hours', '0.5'));
  return v > 0 ? v : 0.5;
}
async function getRepayWindowDays() {
  return num(await getConfig('comp_repay_window_days', '0'));
}
async function getAlertDays() {
  return num(await getConfig('comp_owe_alert_days', '7'));
}

/**
 * 计算欠班的应还截止日。
 * 口径：comp_repay_window_days = 0 → 同月内（欠班日所在月最后一天）；
 *       > 0 → 欠班日 + N 天。
 * @param {string} oweDate 'YYYY-MM-DD'
 * @param {number} windowDays
 */
function computeExpireDate(oweDate, windowDays) {
  const d = new Date(`${oweDate}T00:00:00Z`);
  if (windowDays > 0) {
    d.setUTCDate(d.getUTCDate() + windowDays);
  } else {
    // 同月内：当月最后一天
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * 校验调休小时数（按小时，Q5）。
 */
async function assertHours(hours, fieldLabel = '小时数') {
  const h = round2(num(hours));
  const min = await getMinHours();
  if (h <= 0) throw Object.assign(new Error(`${fieldLabel}必须大于 0`), { statusCode: 400 });
  if (h < min) throw Object.assign(new Error(`${fieldLabel}不得小于最小粒度 ${min} 小时`), { statusCode: 400 });
  return h;
}

// ============================================================
// 一、日期性质覆盖 读写
// ============================================================

/**
 * 覆盖列表（分页契约；未传 page 返回数组）。
 */
export async function listOverrides({ from, to, userId, departmentId, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (from) { params.push(dateParam(from, '起始')); where += ` AND o.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND o.work_date <= $${params.length}`; }
  if (userId) { params.push(Number(userId)); where += ` AND o.user_id = $${params.length}`; }
  if (departmentId) { params.push(Number(departmentId)); where += ` AND o.department_id = $${params.length}`; }

  const selectSql =
    `SELECT o.*, u.real_name, u.employee_no, u.department_id,
            d.name AS department_name, cu.real_name AS created_by_name,
            fi.instance_no AS source_instance_no
       FROM attendance_day_override o
       LEFT JOIN org_user u ON u.id = o.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN org_user cu ON cu.id = o.created_by
       LEFT JOIN flow_instance fi ON fi.id = o.source_instance_id
      WHERE ${where}
      ORDER BY o.work_date DESC, o.id DESC`;

  if (page === undefined || page === null || page === '') return many(selectSql, params);
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM attendance_day_override o WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 写覆盖（幂等 UPSERT）。
 * @param {{workDate:string, dayType:string, scope?:'user'|'dept', userId?:number, departmentId?:number,
 *          hours?:number, sourceInstanceId?:number, remark?:string}} data
 * @param {number} operator
 */
export async function upsertOverride(data, operator) {
  const workDate = parseDate(data?.workDate);
  const dayType = String(data?.dayType || '').trim();
  const scope = data?.scope === 'dept' ? 'dept' : 'user';
  if (!workDate) throw Object.assign(new Error('日期无效（YYYY-MM-DD）'), { statusCode: 400 });
  if (!DAY_TYPES.has(dayType)) {
    throw Object.assign(new Error('日期性质非法（workday/rest/holiday）'), { statusCode: 400 });
  }

  if (scope === 'user') {
    const userId = Number(data?.userId);
    if (!userId) throw Object.assign(new Error('指定人覆盖必须提供员工'), { statusCode: 400 });
    const r = await one(
      `INSERT INTO attendance_day_override
         (work_date, day_type, scope, user_id, hours, source_instance_id, remark, created_by, updated_at)
       VALUES ($1::date,$2,'user',$3,$4,$5,$6,$7,now())
       ON CONFLICT (work_date, user_id) WHERE scope = 'user' DO UPDATE SET
         day_type = EXCLUDED.day_type,
         hours = EXCLUDED.hours,
         source_instance_id = EXCLUDED.source_instance_id,
         remark = EXCLUDED.remark,
         updated_at = now()
       RETURNING *`,
      [workDate, dayType, userId, data?.hours != null ? round2(data.hours) : null,
       data?.sourceInstanceId ? Number(data.sourceInstanceId) : null,
       data?.remark != null ? String(data.remark) : null, operator || null]
    );
    return r;
  }

  const departmentId = Number(data?.departmentId);
  if (!departmentId) throw Object.assign(new Error('部门覆盖必须提供部门'), { statusCode: 400 });
  const r = await one(
    `INSERT INTO attendance_day_override
       (work_date, day_type, scope, department_id, hours, source_instance_id, remark, created_by, updated_at)
     VALUES ($1::date,$2,'dept',$3,$4,$5,$6,$7,now())
     ON CONFLICT (work_date, department_id) WHERE scope = 'dept' DO UPDATE SET
       day_type = EXCLUDED.day_type,
       hours = EXCLUDED.hours,
       source_instance_id = EXCLUDED.source_instance_id,
       remark = EXCLUDED.remark,
       updated_at = now()
     RETURNING *`,
    [workDate, dayType, departmentId, data?.hours != null ? round2(data.hours) : null,
     data?.sourceInstanceId ? Number(data.sourceInstanceId) : null,
     data?.remark != null ? String(data.remark) : null, operator || null]
  );
  return r;
}

/** 删除覆盖 */
export async function removeOverride(id) {
  const row = await one(`SELECT * FROM attendance_day_override WHERE id = $1`, [Number(id)]);
  if (!row) throw Object.assign(new Error('覆盖记录不存在'), { statusCode: 404 });
  await query(`DELETE FROM attendance_day_override WHERE id = $1`, [Number(id)]);
  return { ok: true, id: Number(id) };
}

// ============================================================
// 二、欠班/补班账
// ============================================================

/**
 * 欠班余额（小时）。余额 = Σowe − Σrepay − Σannual_offset（仅未作废）。
 * @param {number} userId
 * @returns {Promise<{userId:number, oweHours:number, repayHours:number, offsetHours:number, balance:number, openCount:number}>}
 */
export async function oweBalance(userId) {
  const uid = Number(userId);
  if (!uid) throw Object.assign(new Error('员工必填'), { statusCode: 400 });
  const r = await one(
    `SELECT
        COALESCE(SUM(hours) FILTER (WHERE entry_type = 'owe' AND status <> 'cancelled'), 0)           AS owe_hours,
        COALESCE(SUM(hours) FILTER (WHERE entry_type = 'repay' AND status <> 'cancelled'), 0)         AS repay_hours,
        COALESCE(SUM(hours) FILTER (WHERE entry_type = 'annual_offset' AND status <> 'cancelled'), 0) AS offset_hours,
        COUNT(*) FILTER (WHERE entry_type = 'owe' AND status = 'open')::int                           AS open_count
       FROM attendance_owe_ledger WHERE user_id = $1`,
    [uid]
  );
  const owe = round2(r?.owe_hours);
  const repay = round2(r?.repay_hours);
  const offset = round2(r?.offset_hours);
  return {
    userId: uid,
    oweHours: owe,
    repayHours: repay,
    offsetHours: offset,
    balance: round2(owe - repay - offset),
    openCount: Number(r?.open_count) || 0,
  };
}

/**
 * 账本明细（分页契约）。
 */
export async function oweLedger({ userId, status, from, to, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (userId) { params.push(Number(userId)); where += ` AND l.user_id = $${params.length}`; }
  if (status) { params.push(String(status)); where += ` AND l.status = $${params.length}`; }
  if (from) { params.push(dateParam(from, '起始')); where += ` AND l.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND l.work_date <= $${params.length}`; }

  const selectSql =
    `SELECT l.*, u.real_name, u.employee_no, u.department_id, d.name AS department_name,
            cu.real_name AS created_by_name, fi.instance_no AS source_instance_no
       FROM attendance_owe_ledger l
       JOIN org_user u ON u.id = l.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN org_user cu ON cu.id = l.created_by
       LEFT JOIN flow_instance fi ON fi.id = l.source_instance_id
      WHERE ${where}
      ORDER BY l.work_date DESC, l.id DESC`;

  if (page === undefined || page === null || page === '') return many(selectSql, params);
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(
    `SELECT COUNT(*)::int AS n FROM attendance_owe_ledger l JOIN org_user u ON u.id = l.user_id WHERE ${where}`,
    params
  );
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 记一笔欠班（幂等：同一 sourceInstanceId + entry_type + workDate 只记一次）。
 */
export async function postOwe({ userId, hours, workDate, sourceInstanceId, remark, createdBy } = {}, client = null) {
  const uid = Number(userId);
  const wd = parseDate(workDate);
  if (!uid || !wd) throw Object.assign(new Error('记账缺少员工或日期'), { statusCode: 400 });
  const h = await assertHours(hours, '欠班小时');
  const windowDays = await getRepayWindowDays();
  const expireDate = computeExpireDate(wd, windowDays);
  const runner = client ? client.query.bind(client) : query;

  // 幂等：同来源单据同类型同日期只记一次
  if (sourceInstanceId) {
    const exist = await (client ? client.query(`SELECT id FROM attendance_owe_ledger WHERE source_instance_id=$1 AND entry_type='owe' AND work_date=$2::date`, [Number(sourceInstanceId), wd]) : one(`SELECT id FROM attendance_owe_ledger WHERE source_instance_id=$1 AND entry_type='owe' AND work_date=$2::date`, [Number(sourceInstanceId), wd]));
    const eid = exist?.rows ? exist.rows[0]?.id : exist?.id;
    if (eid) return { id: eid, reused: true };
  }

  const res = await runner(
    `INSERT INTO attendance_owe_ledger
       (user_id, entry_type, hours, work_date, status, expire_date, source_instance_id, remark, created_by)
     VALUES ($1,'owe',$2,$3::date,'open',$4::date,$5,$6,$7)
     RETURNING id`,
    [uid, h, wd, expireDate, sourceInstanceId ? Number(sourceInstanceId) : null,
     remark != null ? String(remark) : null, createdBy || null]
  );
  return { id: res.rows ? res.rows[0]?.id : res?.id, reused: false };
}

/**
 * 记一笔补班（repay）。随后自动 FIFO 冲抵。
 */
export async function postRepay({ userId, hours, workDate, sourceInstanceId, remark, createdBy } = {}, client = null) {
  const uid = Number(userId);
  const wd = parseDate(workDate);
  if (!uid || !wd) throw Object.assign(new Error('记账缺少员工或日期'), { statusCode: 400 });
  const h = await assertHours(hours, '补班小时');
  const runner = client ? client.query.bind(client) : query;

  if (sourceInstanceId) {
    const exist = await (client ? client.query(`SELECT id FROM attendance_owe_ledger WHERE source_instance_id=$1 AND entry_type='repay' AND work_date=$2::date`, [Number(sourceInstanceId), wd]) : one(`SELECT id FROM attendance_owe_ledger WHERE source_instance_id=$1 AND entry_type='repay' AND work_date=$2::date`, [Number(sourceInstanceId), wd]));
    const eid = exist?.rows ? exist.rows[0]?.id : exist?.id;
    if (eid) return { id: eid, reused: true };
  }

  const res = await runner(
    `INSERT INTO attendance_owe_ledger
       (user_id, entry_type, hours, work_date, status, source_instance_id, remark, created_by)
     VALUES ($1,'repay',$2,$3::date,'settled',$4,$5,$6)
     RETURNING id`,
    [uid, h, wd, sourceInstanceId ? Number(sourceInstanceId) : null,
     remark != null ? String(remark) : null, createdBy || null]
  );
  const repayId = res.rows ? res.rows[0]?.id : res?.id;
  await autoPairRepay(uid, repayId, client);
  return { id: repayId, reused: false };
}

/**
 * FIFO 冲抵：用最新一笔 repay 依次冲抵最早的 open owe（同人）。
 * 每条 owe/repay 记录只写配对关系（pair_id），不改 hours（保留原始账值）；
 * 全额冲抵的 owe 置 settled；repay 行本身状态置 settled。
 * @param {number} userId
 * @param {number} repayId
 * @param {*} client 可选事务连接
 */
export async function autoPairRepay(userId, repayId, client = null) {
  const runner = client ? client.query.bind(client) : query;
  const pick = async (sql, p) => (client ? (await client.query(sql, p)).rows : many(sql, p));
  const pickOne = async (sql, p) => (client ? (await client.query(sql, p)).rows[0] : one(sql, p));

  const repay = await pickOne(`SELECT * FROM attendance_owe_ledger WHERE id = $1 AND entry_type = 'repay'`, [Number(repayId)]);
  if (!repay) return { paired: 0 };

  let remain = num(repay.hours);
  const openOwes = await pick(
    `SELECT * FROM attendance_owe_ledger
      WHERE user_id = $1 AND entry_type = 'owe' AND status = 'open'
      ORDER BY work_date ASC, id ASC`,
    [Number(userId)]
  );

  let paired = 0;
  for (const owe of openOwes) {
    if (remain <= 0) break;
    const oweHours = num(owe.hours);
    // 逐笔全额配对（按小时口径：仅当剩余 >= 该笔欠班时才结清；部分不拆行，留到尾差）
    if (remain + 1e-9 >= oweHours) {
      await runner(`UPDATE attendance_owe_ledger SET status = 'settled', pair_id = $2 WHERE id = $1`, [owe.id, Number(repayId)]);
      await runner(`UPDATE attendance_owe_ledger SET pair_id = COALESCE(pair_id, $2) WHERE id = $1`, [Number(repayId), owe.id]);
      remain = round2(remain - oweHours);
      paired++;
    }
  }
  // repay 若仍有剩余（多还），保留为 settled 但备注余量（不生成负欠）
  if (remain > 0) {
    await runner(
      `UPDATE attendance_owe_ledger
          SET remark = COALESCE(remark || ' | ', '') || $2
        WHERE id = $1`,
      [Number(repayId), `多还 ${remain}h（无对应欠班）`]
    );
  }
  return { paired, remain };
}

/**
 * 年假抵扣一笔欠班（Q10）。
 */
export async function offsetByAnnual({ oweId, hours, remark, createdBy } = {}) {
  const owe = await one(`SELECT * FROM attendance_owe_ledger WHERE id = $1 AND entry_type = 'owe'`, [Number(oweId)]);
  if (!owe) throw Object.assign(new Error('欠班记录不存在'), { statusCode: 404 });
  const allow = String(await getConfig('comp_allow_annual_offset', 'true')) === 'true';
  if (!allow) throw Object.assign(new Error('系统未开启年假抵扣'), { statusCode: 400 });
  const h = round2(num(hours) || num(owe.hours));
  return transaction(async client => {
    const r = await client.query(
      `INSERT INTO attendance_owe_ledger
         (user_id, entry_type, hours, work_date, status, pair_id, source_instance_id, remark, created_by)
       VALUES ($1,'annual_offset',$2,$3::date,'settled',$4,$5,$6,$7)
       RETURNING id`,
      [owe.user_id, h, owe.work_date, owe.id, owe.source_instance_id,
       remark != null ? String(remark) : '年假抵扣', createdBy || null]
    );
    await client.query(`UPDATE attendance_owe_ledger SET status = 'settled', pair_id = $2 WHERE id = $1`,
      [owe.id, r.rows[0].id]);
    return { ok: true, offsetId: r.rows[0].id, oweId: owe.id, hours: h };
  });
}

/**
 * 统计（欠班中 / 已冲抵 / 逾期）。
 */
export async function compStats({ from, to, departmentId } = {}) {
  const params = [];
  let where = '1=1';
  if (from) { params.push(dateParam(from, '起始')); where += ` AND l.work_date >= $${params.length}`; }
  if (to) { params.push(dateParam(to, '结束')); where += ` AND l.work_date <= $${params.length}`; }
  if (departmentId) { params.push(Number(departmentId)); where += ` AND u.department_id = $${params.length}`; }

  const byStatus = await many(
    `SELECT l.entry_type, l.status, COUNT(*)::int AS n, COALESCE(SUM(l.hours),0) AS hours
       FROM attendance_owe_ledger l JOIN org_user u ON u.id = l.user_id
      WHERE ${where} AND l.status <> 'cancelled'
      GROUP BY l.entry_type, l.status ORDER BY l.entry_type, l.status`,
    params
  );
  const overdue = await one(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(l.hours),0) AS hours
       FROM attendance_owe_ledger l JOIN org_user u ON u.id = l.user_id
      WHERE ${where} AND l.entry_type = 'owe' AND l.status = 'open' AND l.expire_date < CURRENT_DATE`,
    params
  );
  const openTotal = await one(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(l.hours),0) AS hours
       FROM attendance_owe_ledger l JOIN org_user u ON u.id = l.user_id
      WHERE ${where} AND l.entry_type = 'owe' AND l.status = 'open'`,
    params
  );
  return {
    byStatus,
    openCount: Number(openTotal?.n) || 0,
    openHours: round2(openTotal?.hours),
    overdueCount: Number(overdue?.n) || 0,
    overdueHours: round2(overdue?.hours),
  };
}

/**
 * 扫描逾期欠班（供 cron）：返回逾期明细（含提醒提前窗口）。
 * @param {string} [asOf] 'YYYY-MM-DD'，默认为库里 CURRENT_DATE
 */
export async function scanOverdue(asOf) {
  const d = parseDate(asOf) || null;
  const alertDays = await getAlertDays();
  const rows = await many(
    `SELECT l.id, l.user_id, l.hours, l.work_date, l.expire_date,
            u.real_name, u.employee_no, u.department_id, d.name AS department_name,
            (l.expire_date < COALESCE($1::date, CURRENT_DATE)) AS overdue,
            (l.expire_date - COALESCE($1::date, CURRENT_DATE)) AS days_left
       FROM attendance_owe_ledger l
       JOIN org_user u ON u.id = l.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE l.entry_type = 'owe' AND l.status = 'open'
        AND l.expire_date <= COALESCE($1::date, CURRENT_DATE) + $2::int
      ORDER BY l.expire_date ASC`,
    [d, alertDays]
  );
  return { alertDays, rows };
}

// ============================================================
// 三、集体调休批量下发（Q8）
// ============================================================

/**
 * HR 一键批量下发集体调休。
 * @param {{userIds?:number[], departmentId?:number, oweDate:string, oweHours:number,
 *          repayDate?:string, repayHours?:number, shiftCode?:string, remark?:string}} data
 * @param {number} operator
 */
export async function batchCompDay(data, operator) {
  const oweDate = parseDate(data?.oweDate);
  const repayDate = parseDate(data?.repayDate);
  const oweHours = await assertHours(data?.oweHours, '欠班小时');
  const repayHours = data?.repayHours != null && num(data.repayHours) > 0
    ? await assertHours(data.repayHours, '补班小时') : oweHours;
  const shiftCode = data?.shiftCode ? String(data.shiftCode) : 'day';
  if (!oweDate) throw Object.assign(new Error('欠班日期无效'), { statusCode: 400 });
  if (repayDate && repayDate < oweDate) {
    throw Object.assign(new Error('补班日期不得早于欠班日期'), { statusCode: 400 });
  }

  // 解析目标员工
  let userIds = Array.isArray(data?.userIds) ? data.userIds.map(Number).filter(Boolean) : [];
  if (!userIds.length && data?.departmentId) {
    const rows = await many(`SELECT id FROM org_user WHERE active = TRUE AND department_id = $1`, [Number(data.departmentId)]);
    userIds = rows.map(r => Number(r.id));
  }
  if (!userIds.length) throw Object.assign(new Error('未解析到任何员工'), { statusCode: 400 });
  if (userIds.length > 2000) throw Object.assign(new Error('单次批量超过 2000 人，请缩小范围'), { statusCode: 400 });

  const remark = data?.remark != null ? String(data.remark) : '集体调休批量下发';

  let affected = 0;
  await transaction(async client => {
    for (const uid of userIds) {
      // 覆盖：欠班日 → rest
      await client.query(
        `INSERT INTO attendance_day_override (work_date, day_type, scope, user_id, remark, created_by, updated_at)
         VALUES ($1::date,'rest','user',$2,$3,$4,now())
         ON CONFLICT (work_date, user_id) WHERE scope = 'user' DO UPDATE SET
           day_type = 'rest', remark = EXCLUDED.remark, updated_at = now()`,
        [oweDate, uid, remark, operator || null]
      );
      // 排班：欠班日 → rest
      await client.query(
        `INSERT INTO attendance_schedule (user_id, work_date, shift_code, source, remark, created_by, updated_at)
         VALUES ($1,$2::date,'rest','manual',$3,$4,now())
         ON CONFLICT (user_id, work_date) DO UPDATE SET
           shift_code = 'rest', source = 'manual', remark = EXCLUDED.remark, updated_at = now()`,
        [uid, oweDate, remark, operator || null]
      );
      // 记账：欠班
      await client.query(
        `INSERT INTO attendance_owe_ledger (user_id, entry_type, hours, work_date, status, expire_date, remark, created_by)
         VALUES ($1,'owe',$2,$3::date,'open',$4::date,$5,$6)`,
        [uid, oweHours, oweDate, computeExpireDate(oweDate, await getRepayWindowDays()), remark, operator || null]
      );

      if (repayDate) {
        await client.query(
          `INSERT INTO attendance_day_override (work_date, day_type, scope, user_id, remark, created_by, updated_at)
           VALUES ($1::date,'workday','user',$2,$3,$4,now())
           ON CONFLICT (work_date, user_id) WHERE scope = 'user' DO UPDATE SET
             day_type = 'workday', remark = EXCLUDED.remark, updated_at = now()`,
          [repayDate, uid, remark, operator || null]
        );
        await client.query(
          `INSERT INTO attendance_schedule (user_id, work_date, shift_code, source, remark, created_by, updated_at)
           VALUES ($1,$2::date,$3,'manual',$4,$5,now())
           ON CONFLICT (user_id, work_date) DO UPDATE SET
             shift_code = EXCLUDED.shift_code, source = 'manual', remark = EXCLUDED.remark, updated_at = now()`,
          [uid, repayDate, shiftCode, remark, operator || null]
        );
        await client.query(
          `INSERT INTO attendance_owe_ledger (user_id, entry_type, hours, work_date, status, remark, created_by)
           VALUES ($1,'repay',$2,$3::date,'settled',$4,$5)`,
          [uid, repayHours, repayDate, remark, operator || null]
        );
      }
      affected++;
    }
  });

  return { ok: true, action: 'batch_comp', users: userIds.length, affected,
           oweDate, oweHours, repayDate: repayDate || null, repayHours: repayDate ? repayHours : null };
}

// ============================================================
// 四、流程终态钩子
// ============================================================

/**
 * 调休/补班审批完成 → 登记覆盖 + 调排班 + 记账 + 冲抵 + 重算（幂等）。
 *
 * 幂等：以 source_instance_id 为键，重复调用不再重复记账；
 *   覆盖为 UPSERT，排班为 UPSERT，故整体收敛。
 *
 * @param {number} instanceId
 * @returns {Promise<{ok:boolean, action:string, ...}>}
 */
export async function onCompDayClosed(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst) return { ok: false, action: 'skipped', reason: '实例不存在' };
    if (inst.def_code !== 'comp_day') {
      return { ok: false, action: 'skipped', reason: `非 comp_day 流程：${inst.def_code}` };
    }

    const fd = inst.form_data || {};
    // 业务当事人优先（代提时调休对象为被代提人）
    const userId = Number(inst.subject_user_id || inst.applicant_id);
    const oweDate = parseDate(fd.owe_date);
    const oweHours = num(fd.owe_hours);
    const repayDate = parseDate(fd.repay_date);
    const repayHours = num(fd.repay_hours) > 0 ? num(fd.repay_hours) : oweHours;
    const shiftCode = fd.shift_code ? String(fd.shift_code) : 'day';
    const compType = fd.comp_type ? String(fd.comp_type) : 'pair';

    if (!userId || !oweDate) {
      return { ok: false, action: 'skipped', reason: '缺少调休人或欠班日期', userId };
    }

    await transaction(async client => {
      // 1) 覆盖：欠班日 → rest
      if (compType !== 'repay') {
        await client.query(
          `INSERT INTO attendance_day_override (work_date, day_type, scope, user_id, remark, source_instance_id, created_by, updated_at)
           VALUES ($1::date,'rest','user',$2,$3,$4,$5,now())
           ON CONFLICT (work_date, user_id) WHERE scope = 'user' DO UPDATE SET
             day_type = 'rest', source_instance_id = EXCLUDED.source_instance_id, updated_at = now()`,
          [oweDate, userId, `调休单 ${inst.instance_no}`, instanceId, userId]
        );
        // 排班：欠班日 → rest
        await client.query(
          `INSERT INTO attendance_schedule (user_id, work_date, shift_code, source, remark, created_by, updated_at)
           VALUES ($1,$2::date,'rest','manual',$3,$4,now())
           ON CONFLICT (user_id, work_date) DO UPDATE SET
             shift_code = 'rest', source = 'manual', remark = EXCLUDED.remark, updated_at = now()`,
          [userId, oweDate, `调休单 ${inst.instance_no}`, userId]
        );
        // 2) 记账：欠班（幂等）
        await postOwe({ userId, hours: oweHours, workDate: oweDate,
          sourceInstanceId: instanceId, remark: `调休单 ${inst.instance_no}`, createdBy: userId }, client);
      }

      // 3) 补班（若有）
      if (repayDate && compType !== 'owe_rest') {
        await client.query(
          `INSERT INTO attendance_day_override (work_date, day_type, scope, user_id, remark, source_instance_id, created_by, updated_at)
           VALUES ($1::date,'workday','user',$2,$3,$4,$5,now())
           ON CONFLICT (work_date, user_id) WHERE scope = 'user' DO UPDATE SET
             day_type = 'workday', source_instance_id = EXCLUDED.source_instance_id, updated_at = now()`,
          [repayDate, userId, `调休单 ${inst.instance_no}`, instanceId, userId]
        );
        await client.query(
          `INSERT INTO attendance_schedule (user_id, work_date, shift_code, source, remark, created_by, updated_at)
           VALUES ($1,$2::date,$3,'manual',$4,$5,now())
           ON CONFLICT (user_id, work_date) DO UPDATE SET
             shift_code = EXCLUDED.shift_code, source = 'manual', remark = EXCLUDED.remark, updated_at = now()`,
          [userId, repayDate, shiftCode, `调休单 ${inst.instance_no}`, userId]
        );
        await postRepay({ userId, hours: repayHours, workDate: repayDate,
          sourceInstanceId: instanceId, remark: `调休单 ${inst.instance_no}`, createdBy: userId }, client);
      }
    });

    // 4) 重算相关日期（覆盖已落库，重算即生效）
    const { recomputeUserDay } = await import('./attendance-service.js');
    const dates = new Set([oweDate, repayDate].filter(Boolean));
    // 重算欠班日所在月前2天~后2天，覆盖跨天班次影响
    for (const dd of dates) {
      const base = new Date(`${dd}T00:00:00Z`);
      for (let off = -1; off <= 1; off++) {
        const d2 = new Date(base); d2.setUTCDate(d2.getUTCDate() + off);
        await recomputeUserDay(userId, d2.toISOString().slice(0, 10));
      }
    }

    const balance = await oweBalance(userId);
    return { ok: true, action: 'applied', userId, oweDate, oweHours,
             repayDate: repayDate || null, repayHours, balance };
  } catch (err) {
    console.warn(`[comp-service] onCompDayClosed 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}

/**
 * 调休单被驳回 → 回滚本单产生的覆盖/排班/账（幂等）。
 */
export async function onCompDayRejected(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst || inst.def_code !== 'comp_day') {
      return { ok: true, action: 'skipped' };
    }
    const fd = inst.form_data || {};
    const userId = Number(inst.subject_user_id || inst.applicant_id);
    const oweDate = parseDate(fd.owe_date);
    const repayDate = parseDate(fd.repay_date);

    await transaction(async client => {
      // 账：本单产生的流水作废
      await client.query(
        `UPDATE attendance_owe_ledger SET status = 'cancelled'
          WHERE source_instance_id = $1 AND status <> 'cancelled'`,
        [instanceId]
      );
      // 覆盖：仅删除本单来源的
      await client.query(
        `DELETE FROM attendance_day_override WHERE source_instance_id = $1 AND scope = 'user'`,
        [instanceId]
      );
    });

    // 重算
    const { recomputeUserDay } = await import('./attendance-service.js');
    for (const dd of [oweDate, repayDate].filter(Boolean)) {
      await recomputeUserDay(userId, dd);
    }
    return { ok: true, action: 'reverted', userId };
  } catch (err) {
    console.warn(`[comp-service] onCompDayRejected 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}
