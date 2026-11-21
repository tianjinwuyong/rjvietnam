// ============================================================
// S7 首页日历日程服务
// 职责：
//   1) 个人日程 oa_calendar_event 的 CRUD（仅本人可操作）
//   2) 聚合流程待办 / 完成事件到统一日历视图（供首页日历渲染）
// 时区纪律（项目已踩过的 P0 坑）：
//   区间推导一律依赖 DB 端 ::date / current_date，避免 JS UTC 与本地时区错位；
//   传入的 from/to 显式 ::date 转型后再比较。
// ============================================================
import { many, one, query } from '../db/index.js';

const ALLOWED_TYPES = ['personal', 'meeting', 'reminder'];

/**
 * 归一化一个日历事件对象（统一字段：id/title/start/end/type/source）。
 * @param {object} row 原始行
 * @param {'event'|'task'|'flow'} source 来源标识
 * @returns {object}
 */
function normalize(row, source) {
  return {
    id: row.id,
    title: row.title,
    titleVi: row.title_vi || null,
    start: row.start_at,
    end: row.end_at,
    allDay: !!row.all_day,
    type: row.event_type,
    source,
    sourceType: row.source_type || null,
    sourceId: row.source_id || null,
    remark: row.remark || null,
    remindMinutes: row.remind_minutes || 0,
  };
}

/**
 * 校验时间区间参数，返回安全默认值。
 * 默认区间：DB current_date 起算的近 30 天（完全绕开 JS 时区）。
 * @param {string} [from] YYYY-MM-DD
 * @param {string} [to] YYYY-MM-DD
 * @returns {{from:string|null,to:string|null,hasRange:boolean}}
 */
function normalizeRange(from, to) {
  const clean = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : null);
  return { from: clean(from), to: clean(to), hasRange: !!from || !!to };
}

/**
 * 合并日程列表：个人日程 + 待办任务 + 流程完成事件。
 *
 * @param {{userId:number, from?:string, to?:string}} opts
 *   from/to 为 YYYY-MM-DD（含端点）；缺省时取 DB current_date 的近 30 天。
 * @returns {Promise<Array>} 统一事件数组，按 start 升序
 */
export async function listEvents({ userId, from, to }) {
  if (!userId) throw new Error('缺少用户');
  const { from: f, to: t, hasRange } = normalizeRange(from, to);

  // 区间参数：显式模式直接 ::date；缺省模式用 current_date 推导
  const rangeFilter = col => {
    if (hasRange) {
      const parts = [];
      if (f) parts.push(`${col} >= $2::date`);
      if (t) parts.push(`${col} <= $3::date`);
      return parts.length ? parts.join(' AND ') : 'TRUE';
    }
    return `${col} BETWEEN current_date - 29 AND current_date`;
  };
  const rangeParams = hasRange ? [userId, f, t] : [userId];

  // 1) 个人日程
  const events = await many(
    `SELECT * FROM oa_calendar_event
      WHERE user_id = $1 AND ${rangeFilter('start_at::date')}
      ORDER BY start_at`,
    rangeParams
  );

  // 2) 待办任务（assigned_at 落在区间，且仍为 assigned）
  const tasks = await many(
    `SELECT t.id, t.assigned_at, t.node_name, t.status,
            i.instance_no, i.title AS instance_title, fd.name AS def_name
       FROM flow_task t
       JOIN flow_instance i ON i.id = t.instance_id
       JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE t.assignee_id = $1 AND t.status = 'assigned'
        AND ${rangeFilter('t.assigned_at::date')}
      ORDER BY t.assigned_at`,
    rangeParams
  );

  // 3) 本人发起、区间内完成的流程事件
  const finished = await many(
    `SELECT i.id, i.instance_no, i.title, i.finished_at, i.status, fd.name AS def_name
       FROM flow_instance i
       JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE i.applicant_id = $1 AND i.finished_at IS NOT NULL
        AND ${rangeFilter('i.finished_at::date')}
      ORDER BY i.finished_at`,
    rangeParams
  );

  // 4) 休假来源（S7 缺口A：休假自动同步日历）
  //    数据源：attendance_summary 中 leave_type 非空的行，按 work_date 生成日程。
  //    隐私红线：严格按 user_id = 当前用户过滤，绝不泄漏他人休假。
  //    双语假别名取自 sys_i18n_dict(dict_type='leave_type')。
  const leaves = await many(
    `SELECT a.id, a.work_date, a.leave_type, a.leave_hours,
            d.name_zh AS leave_zh, d.name_vi AS leave_vi
       FROM attendance_summary a
       LEFT JOIN sys_i18n_dict d ON d.dict_type = 'leave_type' AND d.code = a.leave_type
      WHERE a.user_id = $1 AND a.leave_type IS NOT NULL
        AND ${rangeFilter('a.work_date::date')}
      ORDER BY a.work_date`,
    rangeParams
  );

  // 5) IPQC 任务来源（S7 首页聚合：本人被指派的巡线任务）
  //    隐私/职责隔离：仅当前用户被指派（assignee_id）的任务可见。
  const ipqcTasks = await many(
    `SELECT t.id, t.plan_date, t.line, t.shift, t.status
       FROM ipqc_task t
      WHERE t.assignee_id = $1
        AND ${rangeFilter('t.plan_date::date')}
      ORDER BY t.plan_date`,
    rangeParams
  );

  const result = [
    ...events.map(r => normalize(r, 'event')),
    ...tasks.map(r => ({
      id: `task-${r.id}`,
      title: `待办：${r.instance_title || r.def_name}`,
      titleVi: null,
      start: r.assigned_at,
      end: null,
      allDay: false,
      type: 'reminder',
      source: 'task',
      sourceType: 'flow',
      sourceId: r.id,
      remark: `节点：${r.node_name || '-'}｜单号：${r.instance_no || '-'}`,
      remindMinutes: 0,
    })),
    ...finished.map(r => ({
      id: `flow-${r.id}`,
      title: `已完成：${r.title || r.def_name}`,
      titleVi: null,
      start: r.finished_at,
      end: null,
      allDay: false,
      type: 'personal',
      source: 'flow',
      sourceType: 'flow',
      sourceId: r.id,
      remark: `单号：${r.instance_no || '-'}｜状态：${r.status}`,
      remindMinutes: 0,
    })),
    ...leaves.map(r => {
      const zh = r.leave_zh || r.leave_type || '休假';
      const vi = r.leave_vi || r.leave_type || 'Nghỉ phép';
      const hours = r.leave_hours != null ? `（${r.leave_hours}h）` : '';
      return {
        id: `leave-${r.id}`,
        title: `休假：${zh}${hours}`,
        titleVi: `Nghỉ phép: ${vi}${hours}`,
        start: `${r.work_date}T00:00:00+08:00`,
        end: null,
        allDay: true,
        type: 'personal',
        source: 'leave',
        sourceType: 'leave',
        sourceId: r.id,
        remark: `${zh} / ${vi}｜${r.work_date}`,
        leaveType: r.leave_type,
        remindMinutes: 0,
      };
    }),
    ...ipqcTasks.map(r => ({
      id: `ipqc-${r.id}`,
      title: `IPQC巡线：${r.line || '-'}（${r.shift || '-'}班）`,
      titleVi: `IPQC tuần tra: ${r.line || '-'} (Ca ${r.shift || '-'})`,
      start: `${r.plan_date}T00:00:00+08:00`,
      end: null,
      allDay: true,
      type: 'reminder',
      source: 'ipqc',
      sourceType: 'ipqc',
      sourceId: r.id,
      remark: `产线：${r.line || '-'}｜班次：${r.shift || '-'}｜状态：${r.status || '-'}`,
      remindMinutes: 0,
    })),
  ];

  // 按 start 升序（字符串 ISO 可直接比较）
  result.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return result;
}

/**
 * 创建个人日程。
 * @param {object} data {title,titleVi,startAt,endAt,allDay,eventType,remark,remindMinutes,sourceType,sourceId}
 * @param {number} userId
 */
export async function createEvent(data = {}, userId) {
  if (!userId) throw new Error('缺少用户');
  const title = data.title ? String(data.title).trim() : '';
  if (!title) throw new Error('请填写日程标题');
  if (!data.startAt) throw new Error('请选择开始时间');

  const eventType = ALLOWED_TYPES.includes(data.eventType) ? data.eventType : 'personal';

  return one(
    `INSERT INTO oa_calendar_event
       (user_id, title, title_vi, start_at, end_at, all_day, event_type,
        source_type, source_id, remark, remind_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [userId, title, data.titleVi || null, data.startAt, data.endAt || null,
     !!data.allDay, eventType, data.sourceType || 'manual', data.sourceId || null,
     data.remark || null, Number(data.remindMinutes) || 0]
  );
}

/**
 * 更新个人日程（仅本人）。
 * @param {number} id
 * @param {object} data
 * @param {number} userId
 */
export async function updateEvent(id, data = {}, userId) {
  const cur = await one(`SELECT * FROM oa_calendar_event WHERE id = $1`, [id]);
  if (!cur) throw new Error('日程不存在');
  if (Number(cur.user_id) !== Number(userId)) {
    const err = new Error('只能修改自己的日程');
    err.statusCode = 403;
    throw err;
  }
  const eventType = ALLOWED_TYPES.includes(data.eventType) ? data.eventType : cur.event_type;

  return one(
    `UPDATE oa_calendar_event SET
        title = $2, title_vi = $3, start_at = $4, end_at = $5, all_day = $6,
        event_type = $7, remark = $8, remind_minutes = $9, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id,
     data.title !== undefined ? String(data.title).trim() : cur.title,
     data.titleVi !== undefined ? data.titleVi : cur.title_vi,
     data.startAt !== undefined ? data.startAt : cur.start_at,
     data.endAt !== undefined ? data.endAt : cur.end_at,
     data.allDay !== undefined ? !!data.allDay : cur.all_day,
     eventType,
     data.remark !== undefined ? data.remark : cur.remark,
     data.remindMinutes !== undefined ? Number(data.remindMinutes) || 0 : cur.remind_minutes]
  );
}

/**
 * 删除个人日程（仅本人）。
 * @param {number} id
 * @param {number} userId
 */
export async function deleteEvent(id, userId) {
  const cur = await one(`SELECT * FROM oa_calendar_event WHERE id = $1`, [id]);
  if (!cur) throw new Error('日程不存在');
  if (Number(cur.user_id) !== Number(userId)) {
    const err = new Error('只能删除自己的日程');
    err.statusCode = 403;
    throw err;
  }
  await query(`DELETE FROM oa_calendar_event WHERE id = $1`, [id]);
  return { id };
}

/**
 * 获取单条日程（仅本人）。
 * @param {number} id
 * @param {number} userId
 */
export async function getEvent(id, userId) {
  const cur = await one(`SELECT * FROM oa_calendar_event WHERE id = $1`, [id]);
  if (!cur) throw new Error('日程不存在');
  if (Number(cur.user_id) !== Number(userId)) {
    const err = new Error('无权查看该日程');
    err.statusCode = 403;
    throw err;
  }
  return cur;
}
