/**
 * 会议模块 · 服务层（一期）
 * ----------------------------------------------------------------------------
 * 覆盖：会议系列 / 单次会议 / 参会人 / 纪要 / 决议 / 待办 / 交付件 / 会前回顾 /
 *       连续跟进表 / 我的待办 / 定时扫描（会前提醒 + 逾期扫描）。
 *
 * 设计要点：
 *   - 时区：所有「当前年 / 当天 / 逾期」一律用 SQL 的 Asia/Shanghai 口径；
 *          前端提交的墙钟字符串统一按 Asia/Shanghai 解释（见 toShTs）。
 *   - 并发：状态流转一律 CAS（UPDATE ... WHERE status=<前置> RETURNING），
 *          rowCount=0 → 409；编号一律原子取号（meeting_seq / series 计数器）。
 *   - 可见性：集中实现 assertMeetingVisible / assertSeriesVisible，所有读路径过它。
 *   - 交付件：提交 → 主持人确认（关闭）或驳回（回到进行中）；关闭以交付件为前提。
 *   - 通知：复用 notify/notifyMany，category='meeting'，站内信体验完整。
 */
import { many, one, query, transaction } from '../db/index.js';
import { toId, toInt } from '../utils/params.js';
import { notify, notifyMany } from './notify.js';

// ============================================================================
// 常量：状态机
// ============================================================================
const MEETING_FLOW = {
  draft: ['scheduled', 'canceled'],
  scheduled: ['ongoing', 'canceled', 'scheduled'], // scheduled→scheduled = 改期
  ongoing: ['ended', 'canceled'],
  ended: ['minuted'],
  minuted: ['closed'],
  closed: [],
  canceled: [],
};

const ACTION_FLOW = {
  open: ['doing', 'done', 'canceled'],
  doing: ['done', 'canceled'],
  done: ['closed', 'doing', 'canceled'], // done→doing = 重开
  closed: ['doing'],                     // 重开
  canceled: [],
};

const MEETING_STATUS = ['draft', 'scheduled', 'ongoing', 'ended', 'minuted', 'closed', 'canceled'];
const ACTION_STATUS = ['open', 'doing', 'done', 'closed', 'canceled'];
const CLOSED_ACTION_STATUS = ['open', 'doing', 'done']; // 未关闭三态（用于 overdue / follow）

// ============================================================================
// 基础工具
// ============================================================================
/** 业务异常（4xx 受控文案由统一错误出口透传） */
function bizError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isAdmin(user) {
  return !!user?.isAdmin;
}

function hasPerm(user, code) {
  return !!user && Array.isArray(user.permissions) && user.permissions.includes(code);
}

/** 是否具备会议管理权（改期/取消/结束/关闭/编辑） */
function isMeetingManager(user) {
  return isAdmin(user) || hasPerm(user, 'meeting:manage');
}

/** 是否具备待办管理权 */
function isActionManager(user) {
  return isMeetingManager(user) || hasPerm(user, 'meeting:action');
}

/**
 * 是否可「管理/审查」某会议下的事项（决议/待办）及其交付件。
 * 判定 = 待办管理权（admin / meeting:manage / meeting:action）**或** 是该会议的主持人/记录人。
 * 抽为共用函数，供 submitDeliverable / reviewDeliverable / 各列表的 can_review 复用，
 * 避免多处判定漂移（曾出现"提交按管理权、确认按主持人"两套口径不一致导致的 403）。
 * @param {number|null|undefined} meetingId
 * @param {object} user
 * @returns {Promise<boolean>}
 */
async function canManageItemOfMeeting(meetingId, user) {
  if (isActionManager(user)) return true;
  const mid = toId(meetingId);
  if (mid === null) return false;
  const m = await one(`SELECT host_id, recorder_id FROM meeting WHERE id = $1`, [mid]);
  if (!m) return false;
  const uid = Number(user?.id);
  return Number(m.host_id) === uid || Number(m.recorder_id) === uid;
}

/**
 * 为一批「事项」行补权威标记（前端据此决定是否显示"确认/驳回"按钮，不再自行猜权限）：
 *   - can_review            = 当前用户可确认/驳回该行所属会议的交付件
 *                             （= 待办管理权 或 该会议主持人/记录人，与 reviewDeliverable 完全一致）
 *   - has_pending_submission= 该事项是否已有「待审查」的交付件（前端可提示"有待确认的交付件"）
 * 会用 1~2 次批量查询覆盖整页，不做 N+1。
 * @param {Array<object>} rows 列表行（原地写入两个布尔字段）
 * @param {object} user
 * @param {{defaultType?: 'action'|'decision'|null, idKey?: string}} [opts]
 *        defaultType：行内无 item_type 时（如「我的待办」全为 action）的兜底类型；
 *        idKey：事项主键字段名（默认 item_id，回退 id）。
 * @returns {Promise<Array<object>>}
 */
async function decorateReviewFlags(rows, user, { defaultType = null, idKey = 'item_id' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const uid = Number(user?.id);
  const globalReview = isActionManager(user);

  // 行内事项主键 / 类型归一
  const items = [];
  for (const r of rows) {
    const t = r.item_type === 'decision' || r.item_type === 'action' ? r.item_type : defaultType;
    const rawId = r[idKey] !== undefined && r[idKey] !== null ? r[idKey] : r.id;
    const itemId = toId(rawId);
    if (t && itemId !== null) items.push({ t, itemId });
  }

  // 1) 所属会议主持人/记录人映射（一次查询）
  const meetingIds = [...new Set(rows.map(r => toId(r.source_meeting_id ?? r.meeting_id)).filter(x => x !== null))];
  const hostMap = new Map();
  if (meetingIds.length) {
    const ms = await many(`SELECT id, host_id, recorder_id FROM meeting WHERE id = ANY($1::bigint[])`, [meetingIds]);
    for (const x of ms) hostMap.set(Number(x.id), x);
  }

  // 2) 待审查交付件集合（一次查询，按 (item_type,item_id) 行值匹配）
  const pend = new Set();
  if (items.length) {
    const ph = items.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',');
    const subs = await many(
      `SELECT item_type, item_id FROM meeting_item_submission
        WHERE status = 'pending' AND (item_type, item_id) IN (${ph})`,
      items.flatMap(x => [x.t, x.itemId])
    );
    for (const s of subs) pend.add(`${s.item_type}:${s.item_id}`);
  }

  for (const r of rows) {
    const m = hostMap.get(Number(toId(r.source_meeting_id ?? r.meeting_id)));
    const isHostRec = !!m && (Number(m.host_id) === uid || Number(m.recorder_id) === uid);
    r.can_review = globalReview || isHostRec;
    const t = r.item_type === 'decision' || r.item_type === 'action' ? r.item_type : defaultType;
    const itemId = toId(r[idKey] !== undefined && r[idKey] !== null ? r[idKey] : r.id);
    r.has_pending_submission = t && itemId !== null ? pend.has(`${t}:${itemId}`) : false;
  }
  return rows;
}

/** 解析请求体里的 id 数组（容错） */
function idList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => toId(x)).filter(x => x !== null))];
}

/** 协办人 id 列表（JSONB 数组 → number[]） */
function coOwnerIds(action) {
  const v = action?.co_owner_ids;
  if (!Array.isArray(v)) return [];
  return v.map(x => Number(x)).filter(n => Number.isFinite(n));
}

/**
 * 把前端提交的「墙钟字符串」按 Asia/Shanghai 解释为 timestamptz 字符串。
 * 支持：'YYYY-MM-DD'、'YYYY-MM-DD HH:mm[:ss]'、'YYYY-MM-DDTHH:mm[:ss]'、已带偏移/Z 的原样返回。
 * @param {*} v
 * @returns {string|null}
 */
function toShTs(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  // 已带时区偏移或 Z：原样交由 PG 解释
  if (/[+-]\d{2}:?\d{2}$/.test(s) || /Z$/i.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00+08:00`;
  const norm = s.replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(norm)) return `${norm}:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(norm)) return `${norm}+08:00`;
  // 兜底：交给 PG，若非法会以 SQLSTATE 处理（不会回显原文）
  return s;
}

/** 归一化日期字符串 YYYY-MM-DD（DATE 列，无时区） */
function toDateStr(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, 10);
}

/** 分页参数归一 */
function paging(page, pageSize, defSize = 20, maxSize = 200) {
  const p = toInt(page, { def: 1, min: 1, max: 100000 }) ?? 1;
  const s = toInt(pageSize, { def: defSize, min: 1, max: maxSize }) ?? defSize;
  return { p, s, offset: (p - 1) * s };
}

// ---------------------------------------------------------------------------
// 枚举白名单 + 显式校验（杜绝"非法入参静默默认"，尤其用于改状态/不可逆动作）
// ---------------------------------------------------------------------------
const ENUM = {
  meetingForm: ['offline', 'online', 'hybrid'],
  cycleType: ['weekly', 'biweekly', 'monthly', 'quarterly', 'adhoc'],
  attendeeRole: ['host', 'recorder', 'attendee', 'observer'],
  attendStatus: ['unknown', 'present', 'absent', 'leave'],
  decisionResult: ['passed', 'rejected', 'deferred'],
  itemStatus: ['open', 'doing', 'done', 'closed', 'canceled'],
  decisionStatus: ['open', 'done', 'closed', 'canceled'],
  actionPriority: ['high', 'normal', 'low'],
  reviewResult: ['confirm', 'reject'],
  reviewHandle: ['pending', 'defer', 'request_close', 'cancel', 'no_progress', 'upgrade'],
};

/**
 * 显式枚举校验：
 *   - 未传（undefined/null/''）→ 返回 `def`（若 `required` 则抛 400）；
 *   - 传了合法值 → 返回该值；
 *   - 传了非法值 → **抛 400 并给出明确消息**（绝不静默落默认分支）。
 * @param {*} value
 * @param {string[]} allowed
 * @param {{field:string,label?:string,required?:boolean,def?:*}} opts
 */
function pickEnum(value, allowed, { field, label, required = false, def = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bizError(`请指定${label || field}（${allowed.join(' / ')}）`, 400);
    return def;
  }
  const v = String(value);
  if (!allowed.includes(v)) {
    throw bizError(`${label || field}取值非法：${v}，允许：${allowed.join(' / ')}`, 400);
  }
  return v;
}

/** 状态流转断言（非法 → 409） */
function assertTransition(flow, from, to, label) {
  if (!(flow[from] || []).includes(to)) {
    throw bizError(`${label}当前状态「${from}」不允许流转到「${to}」`, 409);
  }
}

/** 纪要硬门槛：仅 ended / minuted / closed 可写 */
function assertCanWriteMinutes(m) {
  if (!['ended', 'minuted', 'closed'].includes(m.status)) {
    throw bizError('会议尚未结束，请先结束会议再填写纪要', 400);
  }
}

/** 写事项留痕 */
async function logItem(exec, { itemType = 'action', itemId, actorId = null, logType, fromStatus = null, toStatus = null, content = null }) {
  await exec(
    `INSERT INTO meeting_item_log (item_type, item_id, actor_id, log_type, from_status, to_status, content)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [itemType, itemId, actorId, logType, fromStatus, toStatus, content]
  );
}

/** 会议单号：原子取号 MOM-<年>-<4位>（年取自 Asia/Shanghai） */
async function nextMeetingNo(exec) {
  const { year } = (await exec(
    `SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Shanghai'))::int AS year`
  )).rows[0];
  const row = (await exec(
    `INSERT INTO meeting_seq (year, last_no) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_no = meeting_seq.last_no + 1
     RETURNING last_no`,
    [year]
  )).rows[0];
  return `MOM-${year}-${String(row.last_no).padStart(4, '0')}`;
}

/** 系列内事项编号：原子自增返回 {no, seq} */
async function nextSeriesItemNo(exec, seriesId, kind) {
  const col = kind === 'A' ? 'action_seq' : 'decision_seq';
  const row = (await exec(
    `UPDATE meeting_series SET ${col} = ${col} + 1, updated_at = now()
      WHERE id = $1 RETURNING ${col} AS seq, COALESCE(prefix, 'MTG') AS prefix`,
    [seriesId]
  )).rows[0];
  if (!row) throw bizError('会议系列不存在', 404);
  return { no: `${row.prefix}-${kind}${String(row.seq).padStart(4, '0')}`, seq: row.seq };
}

// ============================================================================
// 可见性隔离
// ============================================================================
/** 会议是否对该用户可见（管理员/管理权全可见；参会/主持/记录/创建/同系列成员可见） */
async function isMeetingVisible(m, user) {
  if (!m) return false;
  if (isMeetingManager(user)) return true;
  const uid = Number(user.id);
  if (Number(m.host_id) === uid || Number(m.recorder_id) === uid || Number(m.created_by) === uid) return true;
  const direct = await one(
    `SELECT 1 FROM meeting_attendee WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
    [m.id, uid]
  );
  if (direct) return true;
  if (m.series_id) {
    const seriesMember = await one(
      `SELECT 1 FROM meeting mm JOIN meeting_attendee a ON a.meeting_id = mm.id
        WHERE mm.series_id = $1 AND a.user_id = $2 AND mm.deleted_at IS NULL LIMIT 1`,
      [m.series_id, uid]
    );
    if (seriesMember) return true;
  }
  return false;
}

/**
 * 断言会议可见，返回会议行；不存在 404、不可见 403。
 * @param {number} meetingId
 * @param {object} user
 */
export async function assertMeetingVisible(meetingId, user) {
  const m = await one(`SELECT * FROM meeting WHERE id = $1 AND deleted_at IS NULL`, [meetingId]);
  if (!m) throw bizError('会议不存在', 404);
  if (!await isMeetingVisible(m, user)) throw bizError('无权查看该会议', 403);
  return m;
}

/** 系列是否可见：管理者 / 创建人 / 默认主持人 / 参与过该系列任一场会议 */
async function isSeriesVisible(s, user) {
  if (!s) return false;
  if (isMeetingManager(user)) return true;
  const uid = Number(user.id);
  if (Number(s.created_by) === uid || Number(s.default_host_id) === uid) return true;
  // 该系列任一未删除会议里，我是「参会人 / 主持人 / 记录人」即可见。
  // 主持人/记录人：工厂口径「管理员建号、逐场指派主持人」时，主持人通常不在参会人名单中，
  // 但仍能主持该场会并确认交付件 —— 台账（连续跟进表）必须同步可见。
  const hit = await one(
    `SELECT 1 FROM meeting mm
      LEFT JOIN meeting_attendee a ON a.meeting_id = mm.id AND a.user_id = $2
      WHERE mm.series_id = $1 AND mm.deleted_at IS NULL
        AND (a.user_id IS NOT NULL OR mm.host_id = $2 OR mm.recorder_id = $2)
      LIMIT 1`,
    [s.id, uid]
  );
  return !!hit;
}

/** 断言系列可见，返回系列行 */
export async function assertSeriesVisible(seriesId, user) {
  const s = await one(`SELECT * FROM meeting_series WHERE id = $1 AND deleted_at IS NULL`, [seriesId]);
  if (!s) throw bizError('会议系列不存在', 404);
  if (!await isSeriesVisible(s, user)) throw bizError('无权查看该会议系列', 403);
  return s;
}

// ============================================================================
// 通知辅助
// ============================================================================
/** 取会议全部参会人 id（去重、去空） */
async function attendeeIds(meetingId) {
  const rows = await many(`SELECT user_id FROM meeting_attendee WHERE meeting_id = $1`, [meetingId]);
  return [...new Set(rows.map(r => Number(r.user_id)).filter(Boolean))];
}

/** 取会议（含主持/记录）用于通知的责任人 */
function meetingStakeholders(m) {
  return [m?.host_id, m?.recorder_id].map(Number).filter(Boolean);
}

function fmtTs(v) {
  if (!v) return '—';
  try {
    // v 为 ISO(UTC)；转 Asia/Shanghai 可读文本
    return new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  } catch {
    return String(v);
  }
}

/** 推送会议变更通知给全体参会人 */
async function notifyAttendees(meetingId, payload) {
  const ids = await attendeeIds(meetingId);
  if (!ids.length) return 0;
  return notifyMany(ids, { ...payload, category: 'meeting' });
}

// ============================================================================
// 会议系列
// ============================================================================
export async function listSeries({ enabled, keyword, page, pageSize } = {}, user) {
  const { p, s, offset } = paging(page, pageSize);
  const params = [];
  let where = `s.deleted_at IS NULL`;
  if (enabled === 'true' || enabled === true) where += ` AND s.enabled = TRUE`;
  if (enabled === 'false' || enabled === false) where += ` AND s.enabled = FALSE`;
  if (keyword) {
    params.push(`%${keyword}%`);
    where += ` AND (s.name ILIKE $${params.length} OR s.name_vi ILIKE $${params.length} OR s.code ILIKE $${params.length})`;
  }
  // 非管理者只看自己相关的系列
  if (!isMeetingManager(user)) {
    params.push(Number(user.id));
    const u = params.length;
    where += ` AND (s.created_by = $${u} OR s.default_host_id = $${u}
                    OR EXISTS (SELECT 1 FROM meeting mm JOIN meeting_attendee a ON a.meeting_id = mm.id
                                WHERE mm.series_id = s.id AND a.user_id = $${u} AND mm.deleted_at IS NULL)
                    OR EXISTS (SELECT 1 FROM meeting mm
                                WHERE mm.series_id = s.id AND mm.deleted_at IS NULL
                                  AND (mm.host_id = $${u} OR mm.recorder_id = $${u})))`;
  }

  const list = await many(
    `SELECT s.*,
            (SELECT COUNT(*)::int FROM meeting mm WHERE mm.series_id = s.id AND mm.deleted_at IS NULL) AS meeting_count,
            (SELECT COUNT(*)::int FROM meeting_action a WHERE a.series_id = s.id AND a.deleted_at IS NULL
               AND a.status IN ('open','doing','done')) AS open_action_count,
            (SELECT MAX(mm.planned_start) FROM meeting mm WHERE mm.series_id = s.id AND mm.deleted_at IS NULL) AS last_meeting_at,
            cu.real_name AS creator_name, dh.real_name AS default_host_name
       FROM meeting_series s
       LEFT JOIN org_user cu ON cu.id = s.created_by
       LEFT JOIN org_user dh ON dh.id = s.default_host_id
      WHERE ${where}
      ORDER BY s.id DESC
      LIMIT ${s} OFFSET ${offset}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM meeting_series s WHERE ${where}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: s };
}

export async function getSeries(id, user) {
  const s = await assertSeriesVisible(id, user);
  const stats = await one(
    `SELECT
       (SELECT COUNT(*)::int FROM meeting mm WHERE mm.series_id = $1 AND mm.deleted_at IS NULL) AS meeting_count,
       (SELECT COUNT(*)::int FROM meeting_action a WHERE a.series_id = $1 AND a.deleted_at IS NULL
          AND a.status IN ('open','doing','done')) AS open_action_count,
       (SELECT COUNT(*)::int FROM meeting_decision d WHERE d.series_id = $1 AND d.deleted_at IS NULL) AS decision_count`,
    [id]
  );
  const creator = await one(`SELECT real_name FROM org_user WHERE id = $1`, [s.created_by]);
  return { ...s, stats, creator_name: creator?.real_name || null };
}

export async function createSeries(data, user) {
  const name = data?.name ? String(data.name).trim() : '';
  if (!name) throw bizError('请填写系列名称');

  // 编号前缀必须跨系列唯一（否则不同系列会生成相同事项编号，撞 (series_id,action_no) 之外的唯一约束）
  const prefix = data.prefix ? String(data.prefix).trim().slice(0, 20) : null;
  if (prefix) {
    const dup = await one(`SELECT 1 FROM meeting_series WHERE prefix = $1 AND deleted_at IS NULL LIMIT 1`, [prefix]);
    if (dup) throw bizError(`编号前缀「${prefix}」已被其它系列占用，请更换`, 400);
  }

  const row = await one(
    `INSERT INTO meeting_series
       (code, prefix, name, name_vi, cycle_type, cycle_param, default_duration_min, default_form, location,
        default_host_id, default_recorder_id, default_attendees, default_agenda_items,
        allow_self_close, remind_hours, enabled, remark, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      data.code || null,
      prefix,
      name,
      data.nameVi || null,
      pickEnum(data.cycleType, ENUM.cycleType, { field: 'cycleType', label: '周期类型', def: 'adhoc' }),
      JSON.stringify(data.cycleParam || {}),
      toInt(data.defaultDurationMin, { def: 60, min: 0, max: 600 }),
      pickEnum(data.defaultForm, ENUM.meetingForm, { field: 'defaultForm', label: '会议形式', def: 'offline' }),
      data.location || null,
      toId(data.defaultHostId),
      toId(data.defaultRecorderId),
      JSON.stringify(Array.isArray(data.defaultAttendees) ? data.defaultAttendees : []),
      JSON.stringify(Array.isArray(data.defaultAgendaItems) ? data.defaultAgendaItems : []),
      !!data.allowSelfClose,
      toInt(data.remindHours, { def: 24, min: 0, max: 720 }),
      data.enabled === false ? false : true,
      data.remark || null,
      user.id,
    ]
  );
  // 未指定前缀 → 由系列 id 派生一个跨系列唯一、人类可读的前缀（MTG<id>），保证事项编号形如 MTG12-A0001
  if (!prefix) {
    return await one(
      `UPDATE meeting_series SET prefix = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [row.id, `MTG${row.id}`]
    );
  }
  return row;
}

export async function updateSeries(id, data, user) {
  if (!isMeetingManager(user) && !hasPerm(user, 'meeting:series') && Number((await one(`SELECT created_by FROM meeting_series WHERE id=$1`, [id]))?.created_by) !== Number(user.id)) {
    throw bizError('无权修改该会议系列', 403);
  }
  const exist = await one(`SELECT id FROM meeting_series WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!exist) throw bizError('会议系列不存在', 404);
  // 修改前缀同样需跨系列唯一
  if (data.prefix !== undefined && data.prefix !== null && String(data.prefix).trim() !== '') {
    const p = String(data.prefix).trim().slice(0, 20);
    const dup = await one(`SELECT 1 FROM meeting_series WHERE prefix = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`, [p, id]);
    if (dup) throw bizError(`编号前缀「${p}」已被其它系列占用，请更换`, 400);
  }
  await query(
    `UPDATE meeting_series SET
       code = COALESCE($2, code),
       prefix = COALESCE($3, prefix),
       name = COALESCE($4, name),
       name_vi = COALESCE($5, name_vi),
       cycle_type = COALESCE($6, cycle_type),
       cycle_param = COALESCE($7::jsonb, cycle_param),
       default_duration_min = COALESCE($8, default_duration_min),
       default_form = COALESCE($9, default_form),
       location = COALESCE($10, location),
       default_host_id = $11,
       default_recorder_id = $12,
       default_attendees = COALESCE($13::jsonb, default_attendees),
       default_agenda_items = COALESCE($14::jsonb, default_agenda_items),
       allow_self_close = COALESCE($15, allow_self_close),
       remind_hours = COALESCE($16, remind_hours),
       enabled = COALESCE($17, enabled),
       remark = COALESCE($18, remark),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      data.code ?? null,
      data.prefix ? String(data.prefix).slice(0, 20) : null,
      data.name ? String(data.name).trim() : null,
      data.nameVi ?? null,
      pickEnum(data.cycleType, ENUM.cycleType, { field: 'cycleType', label: '周期类型' }),
      data.cycleParam !== undefined ? JSON.stringify(data.cycleParam || {}) : null,
      data.defaultDurationMin !== undefined ? toInt(data.defaultDurationMin, { def: 60, min: 0, max: 600 }) : null,
      pickEnum(data.defaultForm, ENUM.meetingForm, { field: 'defaultForm', label: '会议形式' }),
      data.location ?? null,
      data.defaultHostId !== undefined ? toId(data.defaultHostId) : null,
      data.defaultRecorderId !== undefined ? toId(data.defaultRecorderId) : null,
      data.defaultAttendees !== undefined ? JSON.stringify(data.defaultAttendees || []) : null,
      data.defaultAgendaItems !== undefined ? JSON.stringify(data.defaultAgendaItems || []) : null,
      data.allowSelfClose !== undefined ? !!data.allowSelfClose : null,
      data.remindHours !== undefined ? toInt(data.remindHours, { def: 24, min: 0, max: 720 }) : null,
      data.enabled !== undefined ? !!data.enabled : null,
      data.remark ?? null,
    ]
  );
  return { id };
}

export async function deleteSeries(id, user) {
  if (!isMeetingManager(user) && !hasPerm(user, 'meeting:series')) throw bizError('无权停用该会议系列', 403);
  const r = await query(
    `UPDATE meeting_series SET deleted_at = now(), enabled = FALSE, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('会议系列不存在', 404);
  return { id };
}

// ============================================================================
// 单次会议
// ============================================================================
export async function listMeetings(filters, user) {
  const { seriesId, status, from, to, hostId, mine, keyword } = filters || {};
  const { p, s, offset } = paging(filters?.page, filters?.pageSize);
  const params = [];
  let where = `m.deleted_at IS NULL`;

  if (seriesId !== undefined && seriesId !== '') {
    const sid = toId(seriesId);
    if (sid === null) throw bizError('请求参数格式不正确');
    params.push(sid); where += ` AND m.series_id = $${params.length}`;
  }
  if (status) { params.push(String(status)); where += ` AND m.status = $${params.length}`; }
  if (from) { params.push(toShTs(from)); where += ` AND m.planned_start >= $${params.length}::timestamptz`; }
  if (to) { params.push(toShTs(to)); where += ` AND m.planned_start <= $${params.length}::timestamptz`; }
  if (hostId) {
    const hid = toId(hostId);
    if (hid === null) throw bizError('请求参数格式不正确');
    params.push(hid); where += ` AND m.host_id = $${params.length}`;
  }
  if (keyword) {
    params.push(`%${keyword}%`);
    where += ` AND (m.title ILIKE $${params.length} OR m.title_vi ILIKE $${params.length} OR m.meeting_no ILIKE $${params.length})`;
  }

  const uid = Number(user.id);
  if (mine === 'true' || mine === true) {
    params.push(uid);
    const u = params.length;
    where += ` AND (m.host_id = $${u} OR m.recorder_id = $${u} OR m.created_by = $${u}
                    OR EXISTS (SELECT 1 FROM meeting_attendee a WHERE a.meeting_id = m.id AND a.user_id = $${u}))`;
  } else if (!isMeetingManager(user)) {
    params.push(uid);
    const u = params.length;
    where += ` AND (m.host_id = $${u} OR m.recorder_id = $${u} OR m.created_by = $${u}
                    OR EXISTS (SELECT 1 FROM meeting_attendee a WHERE a.meeting_id = m.id AND a.user_id = $${u})
                    OR EXISTS (SELECT 1 FROM meeting mm JOIN meeting_attendee a ON a.meeting_id = mm.id
                                WHERE mm.series_id = m.series_id AND a.user_id = $${u} AND mm.deleted_at IS NULL))`;
  }

  const list = await many(
    `SELECT m.id, m.meeting_no, m.series_id, m.series_seq, m.title, m.title_vi,
            m.planned_start, m.planned_end, m.form, m.location, m.online_link,
            m.status, m.host_id, m.recorder_id, m.actual_start, m.actual_end,
            m.created_by, m.created_at, m.updated_at,
            s.name AS series_name,
            hu.real_name AS host_name, ru.real_name AS recorder_name,
            (SELECT COUNT(*)::int FROM meeting_attendee a WHERE a.meeting_id = m.id) AS attendee_count,
            (SELECT COUNT(*)::int FROM meeting_action a WHERE a.meeting_id = m.id AND a.deleted_at IS NULL) AS action_count,
            (SELECT COUNT(*)::int FROM meeting_decision d WHERE d.meeting_id = m.id AND d.deleted_at IS NULL) AS decision_count
       FROM meeting m
       LEFT JOIN meeting_series s ON s.id = m.series_id
       LEFT JOIN org_user hu ON hu.id = m.host_id
       LEFT JOIN org_user ru ON ru.id = m.recorder_id
      WHERE ${where}
      ORDER BY m.planned_start DESC NULLS LAST, m.id DESC
      LIMIT ${s} OFFSET ${offset}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM meeting m WHERE ${where}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: s };
}

export async function getMeeting(id, user) {
  const m = await assertMeetingVisible(id, user);
  const [series, attendees, decisions, actions, review] = await Promise.all([
    m.series_id ? one(`SELECT id, name, name_vi, code, prefix, allow_self_close FROM meeting_series WHERE id = $1`, [m.series_id]) : Promise.resolve(null),
    many(`SELECT a.*, u.real_name, u.position, d.name AS dept_name, d.name_en AS dept_name_en FROM meeting_attendee a
            LEFT JOIN org_user u ON u.id = a.user_id
            LEFT JOIN org_department d ON d.id = u.department_id
           WHERE a.meeting_id = $1 ORDER BY a.id`, [id]),
    many(`SELECT * FROM meeting_decision WHERE meeting_id = $1 AND deleted_at IS NULL ORDER BY seq NULLS LAST, id`, [id]),
    many(`SELECT a.*, u.real_name AS owner_name FROM meeting_action a
            LEFT JOIN org_user u ON u.id = a.owner_id
           WHERE a.meeting_id = $1 AND a.deleted_at IS NULL ORDER BY a.seq NULLS LAST, a.id`, [id]),
    many(`SELECT r.*, a.action_no, a.title AS action_title, a.status AS action_status, a.due_date
           FROM meeting_review_item r JOIN meeting_action a ON a.id = r.action_id
          WHERE r.meeting_id = $1 ORDER BY r.id`, [id]),
  ]);
  const host = m.host_id ? (await one(`SELECT real_name FROM org_user WHERE id=$1`, [m.host_id]))?.real_name : null;
  const recorder = m.recorder_id ? (await one(`SELECT real_name FROM org_user WHERE id=$1`, [m.recorder_id]))?.real_name : null;
  // 权威标记：本场会议内我能否确认/驳回交付件（主持人/记录人 或 管理权）；附每项 has_pending_submission
  const canReview = await canManageItemOfMeeting(m.id, user);
  await decorateReviewFlags(decisions, user, { defaultType: 'decision' });
  await decorateReviewFlags(actions, user, { defaultType: 'action' });
  return { ...m, series, attendees, decisions, actions, review, host_name: host, recorder_name: recorder, can_review: canReview };
}

/**
 * 新建会议。未指定系列时自动建一个"临时系列"（临时会自成一系），保证事项编号可取号。
 * @param {object} data
 * @param {object} user
 */
export async function createMeeting(data, user) {
  const title = data?.title ? String(data.title).trim() : '';
  if (!title) throw bizError('请填写会议标题');
  if (!hasPerm(user, 'meeting:create') && !isMeetingManager(user)) throw bizError('没有发起会议的权限', 403);

  const attendees = Array.isArray(data.attendees) ? data.attendees : [];

  return transaction(async client => {
    const exec = (t, pp) => client.query(t, pp);
    let seriesId = toId(data.seriesId);
    if (seriesId !== null) {
      const s = (await exec(`SELECT id FROM meeting_series WHERE id = $1 AND deleted_at IS NULL`, [seriesId])).rows[0];
      if (!s) throw bizError('会议系列不存在', 404);
    } else {
      // 临时会自成一系（cycle_type=adhoc）。前缀先留空，落库后按 id 自动派生为 MTG<id>
      // —— 与 createSeries 同口径；若写死 'MTG' 会撞上前缀唯一索引，导致第二个临时会 409。
      const s = (await exec(
        `INSERT INTO meeting_series (name, prefix, cycle_type, default_form, location, created_by)
         VALUES ($1, NULL, 'adhoc', $2, $3, $4) RETURNING id`,
        [`临时会议·${title}`, pickEnum(data.form, ENUM.meetingForm, { field: 'form', label: '会议形式', def: 'offline' }), data.location || null, user.id]
      )).rows[0];
      await exec(`UPDATE meeting_series SET prefix = $2 WHERE id = $1`, [s.id, `MTG${s.id}`]);
      seriesId = s.id;
    }

    const meetingNo = await nextMeetingNo(exec);
    const row = (await exec(
      `INSERT INTO meeting
         (meeting_no, series_id, title, title_vi, planned_start, planned_end, form, location, online_link,
          agenda_items, status, host_id, recorder_id, created_by)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10::jsonb,'draft',$11,$12,$13)
       RETURNING *`,
      [
        meetingNo, seriesId, title, data.titleVi || null,
        toShTs(data.plannedStart), toShTs(data.plannedEnd),
        pickEnum(data.form, ENUM.meetingForm, { field: 'form', label: '会议形式', def: 'offline' }), data.location || null, data.onlineLink || null,
        JSON.stringify(Array.isArray(data.agendaItems) ? data.agendaItems : []),
        toId(data.hostId) || user.id, toId(data.recorderId),
        user.id,
      ]
    )).rows[0];

    if (attendees.length) await insertAttendees(exec, row.id, attendees);
    return row;
  });
}

/** 批量插入参会人（ON CONFLICT 幂等），返回新增数 */
async function insertAttendees(exec, meetingId, items) {
  let added = 0;
  for (const it of items) {
    const uid = toId(it?.userId ?? it?.id);
    if (uid === null) continue;
    const snap = (await exec(
      `SELECT u.real_name, d.name AS dept_name, d.name_en AS dept_name_en FROM org_user u
         LEFT JOIN org_department d ON d.id = u.department_id WHERE u.id = $1`,
      [uid]
    )).rows[0] || {};
    const r = await exec(
      `INSERT INTO meeting_attendee (meeting_id, user_id, role, required, snapshot_name, snapshot_dept)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (meeting_id, user_id) DO NOTHING`,
      [meetingId, uid, pickEnum(it.role, ENUM.attendeeRole, { field: 'role', label: '参会人角色', def: 'attendee' }), it.required === false ? false : true,
        snap.real_name || null, snap.dept_name || null]
    );
    added += r.rowCount;
  }
  return added;
}

export async function updateMeeting(id, data, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id) && Number(m.created_by) !== Number(user.id)) {
    throw bizError('无权修改该会议', 403);
  }
  const r = await query(
    `UPDATE meeting SET
       title = COALESCE($2, title),
       title_vi = COALESCE($3, title_vi),
       planned_start = COALESCE($4::timestamptz, planned_start),
       planned_end = COALESCE($5::timestamptz, planned_end),
       form = COALESCE($6, form),
       location = COALESCE($7, location),
       online_link = COALESCE($8, online_link),
       agenda_items = COALESCE($9::jsonb, agenda_items),
       host_id = COALESCE($10, host_id),
       recorder_id = COALESCE($11, recorder_id),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL AND status IN ('draft','scheduled')`,
    [
      id,
      data.title ? String(data.title).trim() : null,
      data.titleVi ?? null,
      toShTs(data.plannedStart),
      toShTs(data.plannedEnd),
      pickEnum(data.form, ENUM.meetingForm, { field: 'form', label: '会议形式' }),
      data.location ?? null,
      data.onlineLink ?? null,
      data.agendaItems !== undefined ? JSON.stringify(data.agendaItems || []) : null,
      data.hostId !== undefined ? toId(data.hostId) : null,
      data.recorderId !== undefined ? toId(data.recorderId) : null,
    ]
  );
  if (r.rowCount === 0) {
    throw bizError(`会议当前状态「${m.status}」不允许编辑`, 409);
  }
  return { id };
}

/**
 * 发布并通知：draft→scheduled（+ 群发 + 生成会前回顾清单）。
 * 允许从 draft 或 scheduled 发起（scheduled→scheduled 视为重新排期）。
 */
export async function scheduleMeeting(id, data, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限排期该会议', 403);
  assertTransition(MEETING_FLOW, m.status, 'scheduled', '会议');

  const attendees = Array.isArray(data?.attendees) ? data.attendees : [];
  const doNotify = data?.notify !== false;

  const result = await transaction(async client => {
    const exec = (t, pp) => client.query(t, pp);
    const upd = (await exec(
      `UPDATE meeting SET
         planned_start = COALESCE($2::timestamptz, planned_start),
         planned_end = COALESCE($3::timestamptz, planned_end),
         form = COALESCE($4, form),
         location = COALESCE($5, location),
         online_link = COALESCE($6, online_link),
         agenda_items = COALESCE($7::jsonb, agenda_items),
         host_id = COALESCE($8, host_id),
         recorder_id = COALESCE($9, recorder_id),
         status = 'scheduled',
         updated_at = now()
       WHERE id = $1 AND status IN ('draft','scheduled') AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        toShTs(data?.plannedStart), toShTs(data?.plannedEnd), pickEnum(data?.form, ENUM.meetingForm, { field: 'form', label: '会议形式' }),
        data?.location ?? null, data?.onlineLink ?? null,
        data?.agendaItems !== undefined ? JSON.stringify(data.agendaItems || []) : null,
        data?.hostId !== undefined ? toId(data.hostId) : null,
        data?.recorderId !== undefined ? toId(data.recorderId) : null,
      ]
    )).rows[0];
    if (!upd) throw bizError('会议已被修改，请刷新后重试', 409);

    const added = attendees.length ? await insertAttendees(exec, id, attendees) : 0;

    // 系列会次序号：首次排期时 +1
    if (upd.series_id && upd.series_seq == null) {
      const seq = (await exec(
        `UPDATE meeting_series SET series_seq = series_seq + 1, updated_at = now()
          WHERE id = $1 RETURNING series_seq`,
        [upd.series_id]
      )).rows[0]?.series_seq;
      if (seq != null) {
        await exec(`UPDATE meeting SET series_seq = $2 WHERE id = $1`, [id, seq]);
        upd.series_seq = seq;
      }
    }

    // 生成会前回顾清单：该系列全部未关闭事项快照（幂等）
    let reviewAdded = 0;
    if (upd.series_id) {
      const rr = await exec(
        `INSERT INTO meeting_review_item (meeting_id, action_id, handle_type)
         SELECT $1, a.id, 'pending'
           FROM meeting_action a
          WHERE a.series_id = $2 AND a.deleted_at IS NULL AND a.status IN ('open','doing','done')
         ON CONFLICT (meeting_id, action_id) DO NOTHING`,
        [id, upd.series_id]
      );
      reviewAdded = rr.rowCount;
    }
    return { meeting: upd, added, reviewAdded };
  });

  let notified = 0;
  if (doNotify) {
    notified = await notifyAttendees(id, {
      title: `【会议通知】${result.meeting.title}`,
      content: `会议「${result.meeting.title}」已排期：${fmtTs(result.meeting.planned_start)}`
        + `，地点：${result.meeting.location || '—'}。请准时参加。`,
      link: `/meeting/${id}`,
    });
    await markNotified(id);
  }
  return { meeting: result.meeting, notified, reviewAdded: result.reviewAdded, attendeeAdded: result.added };
}

/** 标记参会人通知状态为 sent */
async function markNotified(meetingId) {
  await query(
    `UPDATE meeting_attendee SET notify_status = 'sent', notified_at = now()
      WHERE meeting_id = $1 AND notify_status <> 'sent'`,
    [meetingId]
  );
}

/** 改期：scheduled→scheduled，重发通知（含新→旧时间） */
export async function rescheduleMeeting(id, data, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限改期该会议', 403);
  if (m.status !== 'scheduled') throw bizError(`会议当前状态「${m.status}」不允许改期`, 409);

  const oldStart = m.planned_start;
  const r = await query(
    `UPDATE meeting SET
       planned_start = COALESCE($2::timestamptz, planned_start),
       planned_end = COALESCE($3::timestamptz, planned_end),
       form = COALESCE($4, form),
       location = COALESCE($5, location),
       online_link = COALESCE($6, online_link),
       updated_at = now()
     WHERE id = $1 AND status = 'scheduled' AND deleted_at IS NULL`,
    [
      id,
      toShTs(data?.plannedStart), toShTs(data?.plannedEnd),
      data?.form !== undefined ? pickEnum(data?.form, ENUM.meetingForm, { field: 'form', label: '会议形式' }) : null, data?.location ?? null, data?.onlineLink ?? null,
    ]
  );
  if (r.rowCount === 0) throw bizError('会议已被修改，请刷新后重试', 409);
  const now = await one(`SELECT * FROM meeting WHERE id = $1`, [id]);

  const notified = await notifyAttendees(id, {
    title: `【会议改期】${now.title}`,
    content: `会议「${now.title}」已改期：原 ${fmtTs(oldStart)} → 新 ${fmtTs(now.planned_start)}，地点：${now.location || '—'}。`,
    link: `/meeting/${id}`,
  });
  return { meeting: now, notified };
}

/** 取消：→canceled（+ 通知 + 原因） */
export async function cancelMeeting(id, { reason } = {}, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限取消该会议', 403);
  assertTransition(MEETING_FLOW, m.status, 'canceled', '会议');
  const r = await query(
    `UPDATE meeting SET status = 'canceled', cancel_reason = $2, updated_at = now()
      WHERE id = $1 AND status = $3 AND deleted_at IS NULL`,
    [id, reason ? String(reason).slice(0, 500) : null, m.status]
  );
  if (r.rowCount === 0) throw bizError('会议状态已变更，请刷新后重试', 409);
  const notified = await notifyAttendees(id, {
    title: `【会议取消】${m.title}`,
    content: `会议「${m.title}」已取消。原因：${reason || '未填写'}。`,
    link: `/meeting/${id}`,
  });
  return { id, notified };
}

/** 开始：scheduled→ongoing，写 actual_start */
export async function startMeeting(id, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限开始该会议', 403);
  assertTransition(MEETING_FLOW, m.status, 'ongoing', '会议');
  const r = await query(
    `UPDATE meeting SET status = 'ongoing', actual_start = COALESCE(actual_start, now()), updated_at = now()
      WHERE id = $1 AND status = 'scheduled' AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('会议状态已变更，请刷新后重试', 409);
  return one(`SELECT * FROM meeting WHERE id = $1`, [id]);
}

/** 结束：ongoing→ended，写 actual_end；通知记录人 + 主持人填纪要 */
export async function endMeeting(id, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限结束该会议', 403);
  assertTransition(MEETING_FLOW, m.status, 'ended', '会议');
  const r = await query(
    `UPDATE meeting SET status = 'ended', actual_end = COALESCE(actual_end, now()), updated_at = now()
      WHERE id = $1 AND status = 'ongoing' AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('会议状态已变更，请刷新后重试', 409);
  const ids = meetingStakeholders(m);
  if (ids.length) {
    await notifyMany(ids, {
      title: `【纪要待填】${m.title}`,
      content: `会议「${m.title}」已结束，请及时填写会议纪要。`,
      link: `/meeting/${id}`,
      category: 'meeting',
    });
  }
  return one(`SELECT * FROM meeting WHERE id = $1`, [id]);
}

/** 关闭：minuted→closed */
export async function closeMeeting(id, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限关闭该会议', 403);
  assertTransition(MEETING_FLOW, m.status, 'closed', '会议');
  const r = await query(
    `UPDATE meeting SET status = 'closed', updated_at = now()
      WHERE id = $1 AND status = 'minuted' AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('会议状态已变更，请刷新后重试', 409);
  return { id };
}

/** 软删会议 */
export async function deleteMeeting(id, user) {
  if (!isMeetingManager(user)) throw bizError('无权删除该会议', 403);
  const r = await query(`UPDATE meeting SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (r.rowCount === 0) throw bizError('会议不存在', 404);
  return { id };
}

// ============================================================================
// 参会人
// ============================================================================
export async function listAttendees(id, user) {
  await assertMeetingVisible(id, user);
  return many(
    `SELECT a.*, u.real_name, u.position, d.name AS dept_name, d.name_en AS dept_name_en
       FROM meeting_attendee a
       LEFT JOIN org_user u ON u.id = a.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE a.meeting_id = $1 ORDER BY a.id`,
    [id]
  );
}

export async function addAttendees(id, items, user) {
  const m = await assertMeetingVisible(id, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限管理参会人', 403);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw bizError('请选择参会人员');
  const added = await insertAttendees((t, pp) => query(t, pp), id, list);
  return { added };
}

export async function updateAttendee(meetingId, aid, data, user) {
  const m = await assertMeetingVisible(meetingId, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限管理参会人', 403);
  const r = await query(
    `UPDATE meeting_attendee SET
       role = COALESCE($3, role),
       required = COALESCE($4, required),
       note = COALESCE($5, note)
     WHERE id = $1 AND meeting_id = $2`,
    [aid, meetingId,
     pickEnum(data.role, ENUM.attendeeRole, { field: 'role', label: '参会人角色' }),
     data.required !== undefined ? !!data.required : null, data.note ?? null]
  );
  if (r.rowCount === 0) throw bizError('参会人不存在', 404);
  return { id: aid };
}

export async function removeAttendee(meetingId, aid, user) {
  const m = await assertMeetingVisible(meetingId, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限管理参会人', 403);
  const r = await query(`DELETE FROM meeting_attendee WHERE id = $1 AND meeting_id = $2`, [aid, meetingId]);
  if (r.rowCount === 0) throw bizError('参会人不存在', 404);
  return { id: aid };
}

/** 标记到场/请假/缺席：管理者 或 本人 */
export async function markAttend(meetingId, aid, data, user) {
  const m = await assertMeetingVisible(meetingId, user);
  const row = await one(`SELECT * FROM meeting_attendee WHERE id = $1 AND meeting_id = $2`, [aid, meetingId]);
  if (!row) throw bizError('参会人不存在', 404);
  const mine = Number(row.user_id) === Number(user.id);
  if (!mine && !isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限修改到场状态', 403);
  const status = pickEnum(data.attendStatus, ENUM.attendStatus, { field: 'attendStatus', label: '到场状态', def: 'unknown' });
  await query(
    `UPDATE meeting_attendee SET attend_status = $3, note = COALESCE($4, note) WHERE id = $1 AND meeting_id = $2`,
    [aid, meetingId, status, data.note ?? null]
  );
  return { id: aid };
}

/** 手动再推通知 */
export async function notifyMeeting(id, userIds, user) {
  await assertMeetingVisible(id, user);
  if (!isMeetingManager(user)) throw bizError('无权限推送会议通知', 403);
  const ids = Array.isArray(userIds) && userIds.length ? idList(userIds) : await attendeeIds(id);
  if (!ids.length) return { notified: 0 };
  const m = await one(`SELECT * FROM meeting WHERE id = $1`, [id]);
  const notified = await notifyMany(ids, {
    title: `【会议通知】${m.title}`,
    content: `会议「${m.title}」时间：${fmtTs(m.planned_start)}，地点：${m.location || '—'}。`,
    link: `/meeting/${id}`,
    category: 'meeting',
  });
  await query(
    `UPDATE meeting_attendee SET notify_status = 'sent', notified_at = now()
      WHERE meeting_id = $1 AND user_id = ANY($2::bigint[]) AND notify_status <> 'sent'`,
    [id, ids]
  );
  return { notified };
}

// ============================================================================
// 纪要（核心硬门槛）
// ============================================================================
export async function saveMinutes(id, data, user) {
  const m = await assertMeetingVisible(id, user);
  assertCanWriteMinutes(m);
  await query(
    `UPDATE meeting SET minutes_content = $2, minutes_content_vi = $3, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id, data?.minutesContent ?? null, data?.minutesContentVi ?? null]
  );
  return { id };
}

export async function confirmMinutes(id, data, user) {
  const m = await assertMeetingVisible(id, user);
  assertCanWriteMinutes(m);
  const content = data?.minutesContent ?? m.minutes_content;
  if (!content || !String(content).trim()) throw bizError('纪要正文不能为空');
  const r = await query(
    `UPDATE meeting SET
       minutes_content = $2,
       minutes_content_vi = $3,
       minutes_submitted_at = now(),
       minutes_submitted_by = $4,
       status = 'minuted',
       updated_at = now()
     WHERE id = $1 AND status IN ('ended','minuted','closed') AND deleted_at IS NULL`,
    [id, content, data?.minutesContentVi ?? m.minutes_content_vi, user.id]
  );
  if (r.rowCount === 0) throw bizError('会议尚未结束，请先结束会议再确认纪要', 400);
  const updated = await one(`SELECT * FROM meeting WHERE id = $1`, [id]);
  await notifyAttendees(id, {
    title: `【纪要已发布】${updated.title}`,
    content: `会议「${updated.title}」的会议纪要已发布，请查阅。`,
    link: `/meeting/${id}`,
  });
  return updated;
}

// ============================================================================
// 决议
// ============================================================================
export async function listDecisions(meetingId, user) {
  await assertMeetingVisible(meetingId, user);
  const rows = await many(
    `SELECT * FROM meeting_decision WHERE meeting_id = $1 AND deleted_at IS NULL ORDER BY seq NULLS LAST, id`,
    [meetingId]
  );
  return decorateReviewFlags(rows, user, { defaultType: 'decision' });
}

export async function createDecision(meetingId, data, user) {
  const m = await assertMeetingVisible(meetingId, user);
  if (!isMeetingManager(user) && Number(m.recorder_id) !== Number(user.id) && Number(m.host_id) !== Number(user.id)) {
    throw bizError('无权限录入决议', 403);
  }
  const content = data?.content ? String(data.content).trim() : '';
  if (!content) throw bizError('请填写决议内容');

  return transaction(async client => {
    const exec = (t, pp) => client.query(t, pp);
    const { no, seq } = await nextSeriesItemNo(exec, m.series_id, 'D');
    const row = (await exec(
      `INSERT INTO meeting_decision (decision_no, meeting_id, series_id, seq, content, content_vi, result, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8) RETURNING *`,
      [no, meetingId, m.series_id, seq, content, data.contentVi || null, pickEnum(data.result, ENUM.decisionResult, { field: 'result', label: '决议结果', def: 'passed' }), user.id]
    )).rows[0];
    await logItem(exec, { itemType: 'decision', itemId: row.id, actorId: user.id, logType: 'create', toStatus: 'open', content });
    return row;
  });
}

export async function updateDecision(id, data, user) {
  const d = await one(`SELECT * FROM meeting_decision WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!d) throw bizError('决议不存在', 404);
  await assertMeetingVisible(d.meeting_id, user);
  if (!isMeetingManager(user)) throw bizError('无权限修改决议', 403);
  const r = await query(
    `UPDATE meeting_decision SET
       content = COALESCE($2, content),
       content_vi = COALESCE($3, content_vi),
       result = COALESCE($4, result),
       status = COALESCE($5, status),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, data.content ?? null, data.contentVi ?? null,
     pickEnum(data.result, ENUM.decisionResult, { field: 'result', label: '决议结果' }),
     pickEnum(data.status, ENUM.decisionStatus, { field: 'status', label: '决议状态' })]
  );
  return { id };
}

export async function deleteDecision(id, user) {
  const d = await one(`SELECT * FROM meeting_decision WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!d) throw bizError('决议不存在', 404);
  await assertMeetingVisible(d.meeting_id, user);
  if (!isMeetingManager(user)) throw bizError('无权限删除决议', 403);
  await query(`UPDATE meeting_decision SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
  return { id };
}

// ============================================================================
// 待办事项
// ============================================================================
export async function listActions(meetingId, user) {
  await assertMeetingVisible(meetingId, user);
  const rows = await many(
    `SELECT a.*, u.real_name AS owner_name FROM meeting_action a
       LEFT JOIN org_user u ON u.id = a.owner_id
      WHERE a.meeting_id = $1 AND a.deleted_at IS NULL ORDER BY a.seq NULLS LAST, a.id`,
    [meetingId]
  );
  return decorateReviewFlags(rows, user, { defaultType: 'action' });
}

export async function getAction(id, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  // 可见性：责任人/协办本人或会议可见者
  const uid = Number(user.id);
  const mine = Number(a.owner_id) === uid || coOwnerIds(a).includes(uid);
  if (!mine) {
    if (!a.meeting_id) { if (!isActionManager(user)) throw bizError('无权查看该待办', 403); }
    else await assertMeetingVisible(a.meeting_id, user);
  }
  const [logs, submissions] = await Promise.all([
    many(`SELECT l.*, u.real_name AS actor_name FROM meeting_item_log l
            LEFT JOIN org_user u ON u.id = l.actor_id
           WHERE l.item_type = 'action' AND l.item_id = $1 ORDER BY l.created_at`, [id]),
    many(`SELECT s.*, u.real_name AS submitter_name, r.real_name AS reviewer_name
            FROM meeting_item_submission s
            LEFT JOIN org_user u ON u.id = s.submitted_by
            LEFT JOIN org_user r ON r.id = s.reviewed_by
           WHERE s.item_type = 'action' AND s.item_id = $1 ORDER BY s.created_at DESC`, [id]),
  ]);
  const owner = a.owner_id ? await one(`SELECT real_name FROM org_user WHERE id = $1`, [a.owner_id]) : null;
  const series = a.series_id ? await one(`SELECT id, name, prefix, allow_self_close FROM meeting_series WHERE id = $1`, [a.series_id]) : null;
  const meeting = a.meeting_id ? await one(`SELECT id, meeting_no, title, series_seq, planned_start FROM meeting WHERE id = $1`, [a.meeting_id]) : null;
  // 权威标记：能否提交（责任人/协办本人 或 主持人/记录人/管理权）与 能否确认/驳回
  const canManage = await canManageItemOfMeeting(a.meeting_id, user);
  const can_submit = mine || canManage;
  return {
    action: { ...a, owner_name: owner?.real_name || null },
    logs, submissions, series, meeting,
    can_submit, can_review: canManage,
  };
}

export async function createAction(meetingId, data, user) {
  const m = await assertMeetingVisible(meetingId, user);
  if (!isMeetingManager(user) && Number(m.recorder_id) !== Number(user.id) && Number(m.host_id) !== Number(user.id)) {
    throw bizError('无权限录入待办', 403);
  }
  const title = data?.title ? String(data.title).trim() : '';
  if (!title) throw bizError('请填写待办标题');

  const ownerId = toId(data.ownerId);
  const coOwners = idList(data.coOwnerIds);
  const decisionId = toId(data.decisionId);

  const created = await transaction(async client => {
    const exec = (t, pp) => client.query(t, pp);
    const { no, seq } = await nextSeriesItemNo(exec, m.series_id, 'A');
    const row = (await exec(
      `INSERT INTO meeting_action
         (action_no, meeting_id, series_id, decision_id, seq, title, title_vi, detail, detail_vi,
          owner_id, co_owner_ids, due_date, priority, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::date,$13,'open',$14) RETURNING *`,
      [
        no, meetingId, m.series_id, decisionId, seq, title, data.titleVi || null,
        data.detail || null, data.detailVi || null, ownerId,
        JSON.stringify(coOwners), toDateStr(data.dueDate), pickEnum(data.priority, ENUM.actionPriority, { field: 'priority', label: '优先级', def: 'normal' }), user.id,
      ]
    )).rows[0];
    await logItem(exec, { itemType: 'action', itemId: row.id, actorId: user.id, logType: 'create', toStatus: 'open', content: title });
    return row;
  });

  const notifyIds = [...new Set([ownerId, ...coOwners].filter(Boolean))];
  if (notifyIds.length) {
    await notifyMany(notifyIds, {
      title: `【待办指派】${created.action_no || ''}`,
      content: `新待办「${created.title}」，截止：${created.due_date || '—'}，请及时处理。`,
      link: `/meeting/actions/${created.id}`,
      category: 'meeting',
    });
  }
  return created;
}

export async function updateAction(id, data, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  const uid = Number(user.id);
  const mine = Number(a.owner_id) === uid || coOwnerIds(a).includes(uid);
  if (!mine && !isActionManager(user)) throw bizError('无权修改该待办', 403);

  const from = a.status;
  const r = await query(
    `UPDATE meeting_action SET
       title = COALESCE($2, title),
       title_vi = COALESCE($3, title_vi),
       detail = COALESCE($4, detail),
       detail_vi = COALESCE($5, detail_vi),
       owner_id = COALESCE($6, owner_id),
       co_owner_ids = COALESCE($7::jsonb, co_owner_ids),
       due_date = COALESCE($8::date, due_date),
       priority = COALESCE($9, priority),
       progress_note = COALESCE($10, progress_note),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [
      id, data.title ?? null, data.titleVi ?? null, data.detail ?? null, data.detailVi ?? null,
      data.ownerId !== undefined ? toId(data.ownerId) : null,
      data.coOwnerIds !== undefined ? JSON.stringify(idList(data.coOwnerIds)) : null,
      data.dueDate !== undefined ? toDateStr(data.dueDate) : null,
      pickEnum(data.priority, ENUM.actionPriority, { field: 'priority', label: '优先级' }), data.progressNote ?? null,
    ]
  );
  await logItem((t, pp) => query(t, pp), {
    itemType: 'action', itemId: id, actorId: user.id, logType: 'assign',
    fromStatus: from, toStatus: from, content: '更新待办信息',
  });
  return { id };
}

export async function addProgress(id, data, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  const uid = Number(user.id);
  const mine = Number(a.owner_id) === uid || coOwnerIds(a).includes(uid);
  if (!mine && !isActionManager(user)) throw bizError('无权限追加进展', 403);
  const content = data?.content ? String(data.content).trim() : '';
  if (!content) throw bizError('请填写进展内容');
  await query(`UPDATE meeting_action SET progress_note = $2, updated_at = now() WHERE id = $1`, [id, content]);
  await logItem((t, pp) => query(t, pp), {
    itemType: 'action', itemId: id, actorId: user.id, logType: 'progress', fromStatus: a.status, toStatus: a.status, content,
  });
  return { id };
}

export async function claimAction(id, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  const uid = Number(user.id);
  const mine = Number(a.owner_id) === uid || coOwnerIds(a).includes(uid);
  if (!mine && !isActionManager(user)) throw bizError('无权限认领该待办', 403);
  assertTransition(ACTION_FLOW, a.status, 'doing', '待办');
  const r = await query(
    `UPDATE meeting_action SET status = 'doing', updated_at = now()
      WHERE id = $1 AND status = 'open' AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('待办状态已变更，请刷新后重试', 409);
  await logItem((t, pp) => query(t, pp), { itemType: 'action', itemId: id, actorId: user.id, logType: 'claim', fromStatus: 'open', toStatus: 'doing' });
  return one(`SELECT * FROM meeting_action WHERE id = $1`, [id]);
}

/** 责任人标记完成：doing→done（CAS）。不关闭（关闭需交付件或管理权）。 */
export async function doneAction(id, data, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  if (Number(a.owner_id) !== Number(user.id)) throw bizError('仅责任人可标记完成', 403);
  assertTransition(ACTION_FLOW, a.status, 'done', '待办');
  const r = await query(
    `UPDATE meeting_action SET
       status = 'done', done_note = COALESCE($2, done_note), evidence = COALESCE($3, evidence), updated_at = now()
     WHERE id = $1 AND status = 'doing' AND owner_id = $4 AND deleted_at IS NULL`,
    [id, data?.doneNote ?? null, data?.evidence ?? null, user.id]
  );
  if (r.rowCount === 0) throw bizError('待办状态已变更，请刷新后重试', 409);
  await logItem((t, pp) => query(t, pp), { itemType: 'action', itemId: id, actorId: user.id, logType: 'done', fromStatus: 'doing', toStatus: 'done', content: data?.doneNote ?? null });
  return one(`SELECT * FROM meeting_action WHERE id = $1`, [id]);
}

/** 验收关闭：done→closed（CAS）。交付件为前提；主持人/管理权；责任人自关需 allow_self_close */
export async function closeAction(id, data, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);

  // 权限：管理权 / 来源会议主持人；或责任人本人且系列允许自关
  let allowed = isActionManager(user);
  if (!allowed && a.meeting_id) {
    const m = await one(`SELECT host_id FROM meeting WHERE id = $1`, [a.meeting_id]);
    if (m && Number(m.host_id) === Number(user.id)) allowed = true;
  }
  let selfClose = false;
  if (!allowed && Number(a.owner_id) === Number(user.id)) {
    const s = a.series_id ? await one(`SELECT allow_self_close FROM meeting_series WHERE id = $1`, [a.series_id]) : null;
    if (s?.allow_self_close) { allowed = true; selfClose = true; }
  }
  if (!allowed) throw bizError('无权关闭该待办', 403);

  // 交付件为前提：至少存在一条非驳回的提交记录
  const hasSubmission = await one(
    `SELECT 1 FROM meeting_item_submission
      WHERE item_type = 'action' AND item_id = $1 AND status <> 'rejected' LIMIT 1`,
    [id]
  );
  if (!hasSubmission) throw bizError('请先提交交付件再关闭待办', 400);

  assertTransition(ACTION_FLOW, a.status, 'closed', '待办');
  const r = await query(
    `UPDATE meeting_action SET
       status = 'closed', closed_by = $2, closed_at = now(), close_note = COALESCE($3, close_note), updated_at = now()
     WHERE id = $1 AND status = 'done' AND deleted_at IS NULL`,
    [id, user.id, data?.closeNote ?? null]
  );
  if (r.rowCount === 0) {
    const cur = await one(`SELECT status FROM meeting_action WHERE id = $1`, [id]);
    throw bizError(`该待办当前状态为「${cur?.status || '?'}」，无法关闭（须先完成）`, 409);
  }
  await logItem((t, pp) => query(t, pp), { itemType: 'action', itemId: id, actorId: user.id, logType: 'close', fromStatus: 'done', toStatus: 'closed', content: data?.closeNote ?? null });

  const notifyIds = [...new Set([a.owner_id, ...coOwnerIds(a)].filter(Boolean))];
  if (notifyIds.length) {
    await notifyMany(notifyIds, {
      title: `【待办已关闭】${a.action_no || ''}`,
      content: `待办「${a.title}」已验收关闭。${data?.closeNote ? '意见：' + data.closeNote : ''}`,
      link: `/meeting/actions/${id}`,
      category: 'meeting',
    });
  }
  return one(`SELECT * FROM meeting_action WHERE id = $1`, [id]);
}

/** 重开：closed|done→doing */
export async function reopenAction(id, data, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  let allowed = isActionManager(user);
  if (!allowed && a.meeting_id) {
    const m = await one(`SELECT host_id FROM meeting WHERE id = $1`, [a.meeting_id]);
    if (m && Number(m.host_id) === Number(user.id)) allowed = true;
  }
  if (!allowed) throw bizError('无权重开该待办', 403);
  if (!['closed', 'done'].includes(a.status)) throw bizError(`待办当前状态「${a.status}」不允许重开`, 409);
  const r = await query(
    `UPDATE meeting_action SET
       status = 'doing', reopened_count = reopened_count + 1, updated_at = now()
     WHERE id = $1 AND status IN ('closed','done') AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('待办状态已变更，请刷新后重试', 409);
  await logItem((t, pp) => query(t, pp), {
    itemType: 'action', itemId: id, actorId: user.id, logType: 'reopen', fromStatus: a.status, toStatus: 'doing', content: data?.reason ?? null,
  });
  return one(`SELECT * FROM meeting_action WHERE id = $1`, [id]);
}

/** 取消：open|doing|done→canceled */
export async function cancelAction(id, data, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  let allowed = isActionManager(user);
  if (!allowed && a.meeting_id) {
    const m = await one(`SELECT host_id FROM meeting WHERE id = $1`, [a.meeting_id]);
    if (m && Number(m.host_id) === Number(user.id)) allowed = true;
  }
  if (!allowed) throw bizError('无权限取消该待办', 403);
  if (!['open', 'doing', 'done'].includes(a.status)) throw bizError(`待办当前状态「${a.status}」不允许取消`, 409);
  const r = await query(
    `UPDATE meeting_action SET status = 'canceled', updated_at = now()
      WHERE id = $1 AND status IN ('open','doing','done') AND deleted_at IS NULL`,
    [id]
  );
  if (r.rowCount === 0) throw bizError('待办状态已变更，请刷新后重试', 409);
  await logItem((t, pp) => query(t, pp), { itemType: 'action', itemId: id, actorId: user.id, logType: 'cancel', fromStatus: a.status, toStatus: 'canceled', content: data?.reason ?? null });
  return { id };
}

export async function deleteAction(id, user) {
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!a) throw bizError('待办不存在', 404);
  if (!isActionManager(user)) throw bizError('无权限删除该待办', 403);
  await query(`UPDATE meeting_action SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
  return { id };
}

// ============================================================================
// 交付件（提交 / 确认 / 驳回）
// ============================================================================
async function loadItemForDeliverable(itemType, itemId) {
  if (itemType === 'decision') {
    const d = await one(`SELECT * FROM meeting_decision WHERE id = $1 AND deleted_at IS NULL`, [itemId]);
    if (!d) throw bizError('决议不存在', 404);
    return { item: d, meetingId: d.meeting_id, seriesId: d.series_id, status: d.status, title: d.content };
  }
  const a = await one(`SELECT * FROM meeting_action WHERE id = $1 AND deleted_at IS NULL`, [itemId]);
  if (!a) throw bizError('待办不存在', 404);
  return { item: a, meetingId: a.meeting_id, seriesId: a.series_id, status: a.status, title: a.title, action: a };
}

/**
 * 提交交付件。
 * 待办：责任人/协办本人 或 该会议主持人/记录人 或 管理权；提交后状态 → done（待确认）。
 * 决议：该会议主持人/记录人 或 管理权（**非管理员的主持人也可提交**，与确认口径一致）；提交后状态 → done。
 */
export async function submitDeliverable(itemType, itemId, data, user) {
  const type = itemType === 'decision' ? 'decision' : 'action';
  const ctx = await loadItemForDeliverable(type, itemId);
  const uid = Number(user.id);

  if (type === 'action') {
    const mine = Number(ctx.item.owner_id) === uid || coOwnerIds(ctx.item).includes(uid);
    if (!mine && !(await canManageItemOfMeeting(ctx.meetingId, user))) throw bizError('无权限提交该待办的交付件', 403);
  } else if (!(await canManageItemOfMeeting(ctx.meetingId, user))) {
    // 决议：主持人/记录人（含非管理员）或 管理权；无关人员仍 403
    throw bizError('无权限提交该决议的交付件', 403);
  }
  if (ctx.status === 'closed' || ctx.status === 'canceled') throw bizError('事项已关闭或取消，无法提交交付件', 409);

  const content = data?.content ? String(data.content).trim() : '';
  if (!content && !data?.filePath) throw bizError('请填写交付说明或上传附件');

  return transaction(async client => {
    const exec = (t, pp) => client.query(t, pp);
    const sub = (await exec(
      `INSERT INTO meeting_item_submission (item_type, item_id, series_id, content, submitted_by, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [type, itemId, ctx.seriesId, content || null, user.id]
    )).rows[0];

    // 提交后事项进入"已完成（待确认）"
    if (['open', 'doing'].includes(ctx.status)) {
      const table = type === 'action' ? 'meeting_action' : 'meeting_decision';
      const extra = type === 'action' ? `, done_note = COALESCE($2, done_note)` : '';
      const params = type === 'action' ? [itemId, content || null] : [itemId];
      await exec(
        `UPDATE ${table} SET status = 'done'${extra}, updated_at = now()
          WHERE id = $1 AND status IN ('open','doing') AND deleted_at IS NULL`,
        params
      );
    }
    await logItem(exec, { itemType: type, itemId, actorId: user.id, logType: 'submit', fromStatus: ctx.status, toStatus: 'done', content: content || '提交交付件' });

    // 关联附件（前端先 /api/upload 拿 filePath）
    if (data?.filePath) {
      await exec(
        `INSERT INTO attachment (biz_type, biz_id, file_name, file_path, file_size, mime_type, uploaded_by)
         VALUES ('meeting_submission', $1, $2, $3, $4, $5, $6)`,
        [sub.id, data.fileName || data.filePath, data.filePath, data.fileSize || 0, data.mimeType || null, user.id]
      );
    }
    return sub;
  }).then(async sub => {
    // 通知确认人（主持人/记录人）
    if (ctx.meetingId) {
      const m = await one(`SELECT host_id, recorder_id, title FROM meeting WHERE id = $1`, [ctx.meetingId]);
      const ids = [...new Set(meetingStakeholders(m).filter(id => id !== uid))];
      if (ids.length) {
        await notifyMany(ids, {
          title: `【交付件待确认】${ctx.title}`,
          content: `「${ctx.title}」已提交交付件，请确认或驳回。`,
          link: type === 'action' ? `/meeting/actions/${itemId}` : `/meeting/${ctx.meetingId}`,
          category: 'meeting',
        });
      }
    }
    return sub;
  });
}

/** 交付件附件关联（幂等：同 submission + 同 filePath 不重复）；仅提交人本人或管理权 */
export async function addSubmissionAttachment(submissionId, data, user) {
  const sub = await one(`SELECT * FROM meeting_item_submission WHERE id = $1`, [submissionId]);
  if (!sub) throw bizError('交付件提交记录不存在', 404);
  if (Number(sub.submitted_by) !== Number(user.id) && !isActionManager(user)) {
    throw bizError('无权为该交付件添加附件', 403);
  }
  if (!data?.filePath) throw bizError('缺少文件信息');
  const dup = await one(
    `SELECT * FROM attachment WHERE biz_type = 'meeting_submission' AND biz_id = $1 AND file_path = $2 LIMIT 1`,
    [submissionId, data.filePath]
  );
  if (dup) return dup;
  return one(
    `INSERT INTO attachment (biz_type, biz_id, file_name, file_path, file_size, mime_type, uploaded_by)
     VALUES ('meeting_submission', $1, $2, $3, $4, $5, $6) RETURNING *`,
    [submissionId, data.fileName || data.filePath, data.filePath, data.fileSize || 0, data.mimeType || null, user.id]
  );
}

/**
 * 确认 / 驳回交付件。
 * 确认：submission→confirmed；事项 → closed（CAS done→closed；若仍 open/doing 则并到 done 后再关）。
 * 驳回：submission→rejected；事项 → doing；reopened_count+1。
 */
export async function reviewDeliverable(submissionId, data, user) {
  const sub = await one(`SELECT * FROM meeting_item_submission WHERE id = $1`, [submissionId]);
  if (!sub) throw bizError('交付件提交记录不存在', 404);
  const type = sub.item_type === 'decision' ? 'decision' : 'action';

  // 权限：来源会议主持人/记录人 或 管理权（与 submitDeliverable 复用同一套判定，避免漂移）
  const owner = type === 'action'
    ? await one(`SELECT meeting_id FROM meeting_action WHERE id = $1`, [sub.item_id])
    : await one(`SELECT meeting_id FROM meeting_decision WHERE id = $1`, [sub.item_id]);
  const allowed = await canManageItemOfMeeting(owner?.meeting_id, user);
  if (!allowed) throw bizError('无权限确认该交付件', 403);
  if (sub.status === 'confirmed') throw bizError('该交付件已确认', 409);

  // 严格校验审查动作：必须显式指定 confirm | reject，**禁止静默默认**
  // （曾因只认 'reject' 其余落 'confirm' 导致字段名写错即被误"确认关闭"，不可逆）
  const rawDecision = data?.result ?? data?.decision;
  if (rawDecision === undefined || rawDecision === null || rawDecision === '') {
    throw bizError('请指定审查结果：confirm（确认关闭）或 reject（驳回）', 400);
  }
  const decision = pickEnum(rawDecision, ENUM.reviewResult, { field: 'result', label: '审查结果', required: true });
  // 理由字段兼容：首选 note，同时接受 comment 作为别名（取 note ?? comment）
  const noteRaw = data?.note ?? data?.comment;
  const note = (noteRaw === undefined || noteRaw === null || noteRaw === '') ? null : String(noteRaw).slice(0, 2000);
  const table = type === 'action' ? 'meeting_action' : 'meeting_decision';

  return transaction(async client => {
    const exec = (t, pp) => client.query(t, pp);
    const cur = (await exec(`SELECT status FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [sub.item_id])).rows[0];
    const from = cur?.status || null;

    await exec(
      `UPDATE meeting_item_submission SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
        WHERE id = $1 AND status <> 'confirmed'`,
      [submissionId, decision === 'reject' ? 'rejected' : 'confirmed', user.id, note]
    );

    if (decision === 'confirm') {
      await exec(
        `UPDATE ${table} SET status = 'closed', updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND status IN ('open','doing','done')`,
        [sub.item_id]
      );
      if (type === 'action') {
        await exec(`UPDATE meeting_action SET closed_by = $2, closed_at = now() WHERE id = $1`, [sub.item_id, user.id]);
      }
      await logItem(exec, { itemType: type, itemId: sub.item_id, actorId: user.id, logType: 'confirm', fromStatus: from, toStatus: 'closed', content: note });
    } else {
      await exec(
        `UPDATE ${table} SET status = 'doing', updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND status <> 'canceled'`,
        [sub.item_id]
      );
      if (type === 'action') {
        await exec(`UPDATE meeting_action SET reopened_count = reopened_count + 1 WHERE id = $1`, [sub.item_id]);
      }
      await logItem(exec, { itemType: type, itemId: sub.item_id, actorId: user.id, logType: 'reject', fromStatus: from, toStatus: 'doing', content: note });
    }
    return { id: submissionId, status: decision === 'reject' ? 'rejected' : 'confirmed' };
  }).then(async r => {
    // 通知责任人
    let notifyId = null;
    if (type === 'action') {
      notifyId = (await one(`SELECT owner_id FROM meeting_action WHERE id = $1`, [sub.item_id]))?.owner_id;
    }
    if (notifyId) {
      await notify(notifyId, {
        title: decision === 'reject' ? '【交付件被驳回】' : '【交付件已确认】',
        content: decision === 'reject' ? `交付件被驳回，请修改后重新提交。${note ? '意见：' + note : ''}` : '交付件已确认，事项已关闭。',
        link: `/meeting/actions/${sub.item_id}`,
        category: 'meeting',
      });
    }
    return r;
  });
}

/** 交付件列表（含附件） */
export async function listSubmissions(itemType, itemId, user) {
  const type = itemType === 'decision' ? 'decision' : 'action';
  const ctx = await loadItemForDeliverable(type, itemId);
  const uid = Number(user.id);
  const mine = type === 'action' && (Number(ctx.item.owner_id) === uid || coOwnerIds(ctx.item).includes(uid));
  if (!mine) {
    if (ctx.meetingId) await assertMeetingVisible(ctx.meetingId, user);
    else if (!isActionManager(user)) throw bizError('无权查看交付件', 403);
  }
  const submissions = await many(
    `SELECT s.*, u.real_name AS submitter_name, r.real_name AS reviewer_name
       FROM meeting_item_submission s
       LEFT JOIN org_user u ON u.id = s.submitted_by
       LEFT JOIN org_user r ON r.id = s.reviewed_by
      WHERE s.item_type = $1 AND s.item_id = $2 ORDER BY s.created_at DESC`,
    [type, itemId]
  );
  for (const s of submissions) {
    s.attachments = await many(
      `SELECT id, file_name, file_path, file_size, mime_type, uploaded_by, created_at
         FROM attachment WHERE biz_type = 'meeting_submission' AND biz_id = $1 ORDER BY id`,
      [s.id]
    );
  }
  return submissions;
}

// ============================================================================
// 会前回顾清单
// ============================================================================
export async function listReview(meetingId, user) {
  await assertMeetingVisible(meetingId, user);
  return many(
    `SELECT r.*, a.action_no, a.title AS action_title, a.title_vi AS action_title_vi,
            a.status AS action_status, a.due_date, a.priority, a.owner_id, u.real_name AS owner_name
       FROM meeting_review_item r
       JOIN meeting_action a ON a.id = r.action_id
       LEFT JOIN org_user u ON u.id = a.owner_id
      WHERE r.meeting_id = $1 ORDER BY r.id`,
    [meetingId]
  );
}

export async function handleReview(meetingId, rid, data, user) {
  const m = await assertMeetingVisible(meetingId, user);
  if (!isMeetingManager(user) && Number(m.host_id) !== Number(user.id)) throw bizError('无权限处理会前回顾项', 403);
  const handleType = pickEnum(data?.handleType, ENUM.reviewHandle, { field: 'handleType', label: '会前回顾处理方式', def: 'pending' });
  const r = await query(
    `UPDATE meeting_review_item SET handle_type = $3, handled_at = now(), handled_by = $4, note = $5
      WHERE id = $1 AND meeting_id = $2`,
    [rid, meetingId, handleType, user.id, data?.note ?? null]
  );
  if (r.rowCount === 0) throw bizError('回顾项不存在', 404);
  return { id: rid };
}

// ============================================================================
// 连续跟进表 / 我的待办 / 导出
// ============================================================================
/** 系列跟进表（决议 ∪ 待办 一张表） */
export async function seriesFollowTable(seriesId, filters, user) {
  await assertSeriesVisible(seriesId, user);
  const { view, status, ownerId, priority, overdue, keyword } = filters || {};
  const { p, s, offset } = paging(filters?.page, filters?.pageSize, 20, 500);

  const params = [seriesId];
  let where = `it.series_id = $1 AND it.deleted_at IS NULL`;
  if (view === 'todo' || view === 'action') where += ` AND it.item_type = 'action'`;
  if (status) { params.push(String(status)); where += ` AND it.status = $${params.length}`; }
  if (priority) { params.push(String(priority)); where += ` AND it.priority = $${params.length}`; }
  if (ownerId) {
    const oid = toId(ownerId);
    if (oid !== null) {
      params.push(oid);
      const u = params.length;
      where += ` AND (it.owner_id = $${u} OR it.co_owner_ids @> to_jsonb($${u}::bigint))`;
    }
  }
  if (overdue === 'true' || overdue === true) where += ` AND it.overdue = TRUE`;
  if (keyword) {
    params.push(`%${keyword}%`);
    const u = params.length;
    where += ` AND (it.title ILIKE $${u} OR it.item_no ILIKE $${u})`;
  }

  const base = `FROM v_meeting_items it`;
  const list = await many(
    `SELECT it.item_type, it.item_id, it.item_no, it.status, it.priority, it.due_date, it.seq,
            it.title, it.title_vi, it.detail, it.detail_vi, it.result, it.overdue,
            it.owner_id, it.co_owner_ids,
            u.real_name AS owner_name,
            m.id AS source_meeting_id, m.meeting_no, m.series_seq AS source_seq, m.planned_start AS source_at,
            (SELECT content FROM meeting_item_log l
              WHERE l.item_type = it.item_type AND l.item_id = it.item_id
              ORDER BY l.created_at DESC LIMIT 1) AS latest_progress,
            (SELECT created_at FROM meeting_item_log l
              WHERE l.item_type = it.item_type AND l.item_id = it.item_id
              ORDER BY l.created_at DESC LIMIT 1) AS last_update_at
       ${base}
       LEFT JOIN org_user u ON u.id = it.owner_id
       LEFT JOIN meeting m ON m.id = it.meeting_id
      WHERE ${where}
      ORDER BY (it.status IN ('open','doing','done')) DESC,
               it.overdue DESC,
               (it.priority = 'high') DESC, (it.priority = 'normal') DESC,
               it.due_date ASC NULLS LAST, it.item_no DESC
      LIMIT ${s} OFFSET ${offset}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n ${base} WHERE ${where}`, params);
  const summary = await one(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('open','doing','done')) AS open_count,
       COUNT(*) FILTER (WHERE overdue) AS overdue_count,
       COUNT(*) FILTER (WHERE status = 'closed') AS closed_count,
       COUNT(*) FILTER (WHERE item_type = 'action') AS action_count,
       COUNT(*) FILTER (WHERE item_type = 'decision') AS decision_count
       FROM v_meeting_items WHERE series_id = $1 AND deleted_at IS NULL`,
    [seriesId]
  );
  // 每行补 can_review / has_pending_submission（权威标记，前端据此显示"确认/驳回"按钮）
  await decorateReviewFlags(list, user);
  return { list, total: cnt?.n || 0, page: p, pageSize: s, summary };
}

/** 跨系列「我的待办」（责任人或协办） */
export async function myActions(filters, user) {
  const { status, overdue } = filters || {};
  const { p, s, offset } = paging(filters?.page, filters?.pageSize);
  const uid = Number(user.id);
  const params = [uid];
  let where = `a.deleted_at IS NULL AND (a.owner_id = $1 OR a.co_owner_ids @> to_jsonb($1::bigint))`;
  if (status) { params.push(String(status)); where += ` AND a.status = $${params.length}`; }
  if (overdue === 'true' || overdue === true) where += ` AND a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE AND a.status IN ('open','doing','done')`;

  const list = await many(
    `SELECT a.*, s.name AS series_name, m.meeting_no,
            (a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE AND a.status IN ('open','doing','done')) AS overdue
       FROM meeting_action a
       LEFT JOIN meeting_series s ON s.id = a.series_id
       LEFT JOIN meeting m ON m.id = a.meeting_id
      WHERE ${where}
      ORDER BY (a.status IN ('open','doing','done')) DESC, a.due_date ASC NULLS LAST, a.id DESC
      LIMIT ${s} OFFSET ${offset}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM meeting_action a WHERE ${where}`, params);
  // 每行补 can_review / has_pending_submission（我的待办若我恰为主持人/记录人，也可在此确认）
  await decorateReviewFlags(list, user, { defaultType: 'action' });
  return { list, total: cnt?.n || 0, page: p, pageSize: s };
}

/**
 * 我的会议（首页「我的会议」栏数据来源）。
 * 口径：我主持 / 记录 / 发起 / 参会的会议，排除已取消；未结束（进行中/已排期）优先，按计划开始升序。
 * @param {object} user 登录用户
 * @param {{scope?:'upcoming'|'today'|'all', limit?:number}} [opts]
 *   · upcoming（默认）：未结束且计划结束时间未过（进行中/已排期）
 *   · today：计划开始在今天（Asia/Shanghai）
 *   · all：全部相关的未取消会议
 * @returns {Promise<Array<object>>} data 为数组（按 planned_start 升序、未结束优先）
 */
export async function myMeetings(user, { scope = 'upcoming', limit } = {}) {
  const uid = Number(user.id);
  const params = [uid];
  const sc = ['upcoming', 'today', 'all'].includes(scope) ? scope : 'upcoming';
  let where = `m.deleted_at IS NULL
    AND m.status <> 'canceled'
    AND (m.host_id = $1 OR m.recorder_id = $1 OR m.created_by = $1
         OR EXISTS (SELECT 1 FROM meeting_attendee a WHERE a.meeting_id = m.id AND a.user_id = $1))`;
  if (sc === 'upcoming') {
    where += ` AND m.status IN ('scheduled','ongoing') AND (m.planned_end IS NULL OR m.planned_end >= now())`;
  } else if (sc === 'today') {
    where += ` AND m.planned_start IS NOT NULL
               AND (m.planned_start AT TIME ZONE 'Asia/Shanghai')::date
                   = (now() AT TIME ZONE 'Asia/Shanghai')::date`;
  }
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return many(
    `SELECT m.id, m.meeting_no, m.title, m.title_vi, m.planned_start, m.planned_end,
            m.form, m.location, m.online_link, m.status, m.host_id, m.recorder_id,
            m.actual_start, m.actual_end,
            hu.real_name AS host_name, ru.real_name AS recorder_name,
            (m.host_id = $1) AS is_host,
            (SELECT COUNT(*)::int FROM meeting_attendee a WHERE a.meeting_id = m.id) AS attendee_count
       FROM meeting m
       LEFT JOIN org_user hu ON hu.id = m.host_id
       LEFT JOIN org_user ru ON ru.id = m.recorder_id
      WHERE ${where}
      ORDER BY (m.status IN ('ongoing','scheduled')) DESC,
               m.planned_start ASC NULLS LAST, m.id DESC
      LIMIT ${n}`,
    params
  );
}

/** 导出跟进表（中越双语表头） */
export async function exportFollow(seriesId, filters, user) {  const data = await seriesFollowTable(seriesId, { ...filters, page: 1, pageSize: 500 }, user);
  const columns = [
    { key: 'item_no', label: '事项编号', label_vi: 'Mã việc' },
    { key: 'item_type', label: '类型', label_vi: 'Loại' },
    { key: 'title', label: '事项', label_vi: 'Nội dung' },
    { key: 'owner_name', label: '责任人', label_vi: 'Người phụ trách' },
    { key: 'due_date', label: '截止日', label_vi: 'Hạn chót' },
    { key: 'priority', label: '优先级', label_vi: 'Ưu tiên' },
    { key: 'status', label: '状态', label_vi: 'Trạng thái' },
    { key: 'overdue', label: '逾期', label_vi: 'Quá hạn' },
    { key: 'meeting_no', label: '来源会议', label_vi: 'Cuộc họp nguồn' },
    { key: 'latest_progress', label: '最新进展', label_vi: 'Tiến độ mới nhất' },
  ];
  const rows = data.list.map(r => ({
    item_no: r.item_no || '',
    item_type: r.item_type === 'decision' ? '决议' : '待办',
    title: r.title || '',
    owner_name: r.owner_name || '',
    due_date: r.due_date || '',
    priority: r.priority || '',
    status: r.status || '',
    overdue: r.overdue ? '是' : '',
    meeting_no: r.meeting_no || '',
    latest_progress: r.latest_progress || '',
  }));
  return { columns, rows };
}

// ============================================================================
// 定时扫描（供 cron.js 调用；亦导出供手工触发）
// ============================================================================
/** 会前提醒：会前 remind_hours 内、同会议同日去重 */
export async function scanMeetingReminders() {
  const rows = await many(
    `SELECT m.id, m.meeting_no, m.title, m.planned_start, m.location,
            COALESCE(s.remind_hours, 24) AS remind_hours, m.host_id, m.recorder_id
       FROM meeting m
       LEFT JOIN meeting_series s ON s.id = m.series_id
      WHERE m.deleted_at IS NULL AND m.status = 'scheduled'
        AND m.planned_start IS NOT NULL
        AND COALESCE(s.remind_hours, 24) > 0
        AND m.planned_start <= now() + (COALESCE(s.remind_hours, 24) || ' hours')::interval
        AND m.planned_start >= now()`
  );
  let sent = 0;
  for (const m of rows) {
    const dup = await one(
      `SELECT 1 FROM notification
        WHERE category = 'meeting' AND link = $1 AND title LIKE '【会议提醒】%'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = (now() AT TIME ZONE 'Asia/Shanghai')::date
        LIMIT 1`,
      [`/meeting/${m.id}`]
    );
    if (dup) continue;
    const ids = [...new Set([...(await attendeeIds(m.id)), ...meetingStakeholders(m)])];
    if (!ids.length) continue;
    sent += await notifyMany(ids, {
      title: `【会议提醒】${m.title}`,
      content: `会议「${m.title}」将于 ${fmtTs(m.planned_start)} 开始，地点：${m.location || '—'}，请准时参加。`,
      link: `/meeting/${m.id}`,
      category: 'meeting',
    });
  }
  return sent;
}

/** 逾期扫描：due < 今天且未关闭；同日同事项去重 */
export async function scanActionOverdue() {
  const rows = await many(
    `SELECT a.id, a.action_no, a.title, a.due_date, a.owner_id, a.co_owner_ids, a.meeting_id
       FROM meeting_action a
      WHERE a.deleted_at IS NULL AND a.status IN ('open','doing','done')
        AND a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE`
  );
  let sent = 0;
  for (const a of rows) {
    const dup = await one(
      `SELECT 1 FROM notification
        WHERE category = 'meeting' AND link = $1 AND title LIKE '【待办逾期】%'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = (now() AT TIME ZONE 'Asia/Shanghai')::date
        LIMIT 1`,
      [`/meeting/actions/${a.id}`]
    );
    if (dup) continue;
    const ids = new Set([a.owner_id, ...coOwnerIds(a)].map(Number).filter(Boolean));
    if (a.meeting_id) {
      const m = await one(`SELECT host_id FROM meeting WHERE id = $1`, [a.meeting_id]);
      if (m?.host_id) ids.add(Number(m.host_id));
    }
    if (!ids.size) continue;
    sent += await notifyMany([...ids], {
      title: `【待办逾期】${a.action_no || ''}`,
      content: `待办「${a.title}」已于 ${a.due_date} 到期仍未关闭，请尽快处理。`,
      link: `/meeting/actions/${a.id}`,
      category: 'meeting',
    });
  }
  return sent;
}
