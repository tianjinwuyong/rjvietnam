// ============================================================
// 体系文件发行动态 · 服务层（doc-issue-feed）
// ------------------------------------------------------------
// 需求：
//   2、体系文件发行后，推送到所有账号的首页（首页「体系文件发行动态」模块）。
//      不管是谁阅读了，都要有浏览记录，表示已经下发接收。
// ------------------------------------------------------------
// 职责：
//   · createIssueFeed   发行成功后落一条「发行动态」（按 doc_id+version 幂等收敛，不重复推送）
//   · notifyIssueFeed   向目标人群（全员/部门/人员）推送站内通知（category='doc_issue'）
//   · listFeeds         当前用户可见的发行动态（含「我是否已读」）
//   · markFeedRead      写阅读（下发接收）记录（幂等 upsert：重复读只刷新时间/累加次数）
//   · getFeedReads      阅读情况（已读名单 + 未读名单 + summary），限管理员/发行方
// 依赖：db（many/one/query/transaction）、notify（notifyMany）、utils/admin（isAdminUser）
// ============================================================
import { many, one, query } from '../db/index.js';
import { notifyMany } from './notify.js';
import { isAdminUser } from '../utils/admin.js';
import { toId } from '../utils/params.js';

/** 发行动态的通知分类（前端可按此分组展示） */
export const FEED_CATEGORY = 'doc_issue';

/** 业务异常（4xx 受控文案由统一错误出口透传） */
function bizError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** jsonb 数组（可能是数字或字符串）归一为去重的正整数 id 数组 */
function normalizeIdArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const id = toId(x);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 目标范围中文文案（用于通知正文与列表展示） */
function scopeLabel(scope) {
  if (scope === 'dept') return '指定部门';
  if (scope === 'user') return '指定人员';
  return '全员';
}

/**
 * 依据部门 code 列表解析部门 id（用于把发行表单选定的部门转入发行动态目标）。
 * @param {string[]} codes 部门 code 数组
 * @returns {Promise<number[]>}
 */
export async function resolveDeptIdsByCodes(codes) {
  const list = (Array.isArray(codes) ? codes : []).map(c => String(c).trim()).filter(Boolean);
  if (!list.length) return [];
  const rows = await many(`SELECT id FROM org_department WHERE code = ANY($1)`, [list]);
  return rows.map(r => Number(r.id));
}

/**
 * 解析某条发行动态的目标用户 id 列表（供推送与「未读名单」计算复用）。
 * @param {{target_scope:string, dept_ids:any, user_ids:any}} feed
 * @returns {Promise<number[]>}
 */
export async function targetUserIds(feed) {
  const scope = feed?.target_scope || 'all';
  if (scope === 'dept') {
    const deptIds = normalizeIdArray(feed.dept_ids);
    if (!deptIds.length) return [];
    const rows = await many(
      `SELECT id FROM org_user WHERE active = TRUE AND department_id = ANY($1::bigint[])`,
      [deptIds]
    );
    return rows.map(r => Number(r.id));
  }
  if (scope === 'user') {
    const userIds = normalizeIdArray(feed.user_ids);
    if (!userIds.length) return [];
    const rows = await many(
      `SELECT id FROM org_user WHERE active = TRUE AND id = ANY($1::bigint[])`,
      [userIds]
    );
    return rows.map(r => Number(r.id));
  }
  // all：全体在职账号
  const rows = await many(`SELECT id FROM org_user WHERE active = TRUE`);
  return rows.map(r => Number(r.id));
}

/**
 * 目标人群明细（含姓名/部门），用于阅读名单（已读 ∪ 未读）。
 * @param {{target_scope:string, dept_ids:any, user_ids:any}} feed
 * @returns {Promise<Array<{id:number, real_name:string, dept:string|null}>>}
 */
async function targetUserRows(feed) {
  const scope = feed?.target_scope || 'all';
  const base = `SELECT u.id, u.real_name, d.name AS dept
                  FROM org_user u
                  LEFT JOIN org_department d ON d.id = u.department_id
                 WHERE u.active = TRUE AND COALESCE(u.is_system, FALSE) = FALSE`;
  if (scope === 'dept') {
    const deptIds = normalizeIdArray(feed.dept_ids);
    if (!deptIds.length) return [];
    return many(`${base} AND u.department_id = ANY($1::bigint[]) ORDER BY u.id`, [deptIds]);
  }
  if (scope === 'user') {
    const userIds = normalizeIdArray(feed.user_ids);
    if (!userIds.length) return [];
    return many(`${base} AND u.id = ANY($1::bigint[]) ORDER BY u.id`, [userIds]);
  }
  return many(`${base} ORDER BY u.id`);
}

/**
 * 创建一条发行动态（幂等：同一 doc_id+version 只保留一条）。
 * @param {object} p { docId, version, userId, scope='all', deptIds=[], userIds=[], remark }
 * @returns {Promise<{feed:object, created:boolean}>} created=true 表示本次新建（调用方据此决定是否推送，避免重复推送）
 */
export async function createIssueFeed({ docId, version, userId, scope = 'all', deptIds = [], userIds = [], remark = null } = {}) {
  const did = toId(docId);
  if (did === null) throw bizError('文档参数不正确');
  // 四级表单不进「发行动态」（2026-11-07 用户要求：动态只显示一二三级文件，表单不要）。
  // 在唯一入口收敛：既不落 doc_issue_feed，也不推送；调用方拿 created=false 自然跳过通知。
  const doc = await one(`SELECT id, code, title, current_version, level FROM doc_system WHERE id = $1`, [did]);
  if (!doc) throw bizError('文档不存在', 404);
  if (Number(doc.level) >= 4) return { feed: null, created: false, skipped: 'level4_form' };
  const ver = version ? String(version) : String(doc.current_version || '');
  const safeScope = ['all', 'dept', 'user'].includes(scope) ? scope : 'all';

  const inserted = await one(
    `INSERT INTO doc_issue_feed
       (doc_id, version, doc_code_snapshot, title_snapshot, issued_by, target_scope, dept_ids, user_ids, remark)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
     ON CONFLICT (doc_id, version) DO NOTHING
     RETURNING *`,
    [
      did, ver, doc.code || null, doc.title || null, toId(userId),
      safeScope, JSON.stringify(normalizeIdArray(deptIds)), JSON.stringify(normalizeIdArray(userIds)),
      remark ? String(remark).slice(0, 500) : null,
    ]
  );
  if (inserted) return { feed: inserted, created: true };

  // 冲突：已有同 doc_id+version 动态，返回既有（幂等，不重复推送）
  const existing = await one(`SELECT * FROM doc_issue_feed WHERE doc_id = $1 AND version = $2`, [did, ver]);
  return { feed: existing, created: false };
}

/**
 * 向发行动态的目标人群推送站内通知。
 * @param {object} feed doc_issue_feed 行
 * @returns {Promise<number>} 推送人数
 */
export async function notifyIssueFeed(feed) {
  if (!feed) return 0;
  const ids = await targetUserIds(feed);
  if (!ids.length) return 0;
  const version = feed.version ? ` V${feed.version}` : '';
  const title = `【体系文件发行】${feed.doc_code_snapshot || ''}${version}`.trim();
  const content = `${feed.title_snapshot || feed.doc_code_snapshot || '体系文件'} 已发行（发行范围：${scopeLabel(feed.target_scope)}），请查阅并确认接收。`;
  return notifyMany(ids, {
    title,
    content,
    link: `/docs/${feed.doc_id}`,
    category: FEED_CATEGORY,
  });
}

/**
 * 当前用户可见的发行动态列表（含「我是否已读」）。
 * 可见性：管理员看全部；否则 all 全员可见 / dept 命中我部门 / user 命中我 / 我是发行人。
 * @param {object} user 登录用户（含 id / dept_id / isAdmin）
 * @param {{limit?:number, offset?:number}} opts
 * @returns {Promise<Array<object>>}
 */
export async function listFeeds(user, { limit = 8, offset = 0 } = {}) {
  const uid = Number(user?.id) || 0;
  const deptId = toId(user?.dept_id);
  const params = [uid];
  let where = `TRUE`;
  if (!user?.isAdmin) {
    // 命中：全员 / 我所在部门在目标内 / 我在目标人员内 / 我是发行人
    let deptCond = 'FALSE';
    if (deptId !== null) {
      params.push(JSON.stringify([deptId]));
      deptCond = `f.dept_ids @> $${params.length}::jsonb`;
    }
    params.push(JSON.stringify([uid]));
    const userIdx = params.length;
    where += ` AND (f.target_scope = 'all'
                     OR (f.target_scope = 'dept' AND ${deptCond})
                     OR (f.target_scope = 'user' AND f.user_ids @> $${userIdx}::jsonb)
                     OR f.issued_by = $1)`;
  }
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 50);
  const off = Math.max(Number(offset) || 0, 0);
  // 只显示一二三级文件（四级表单不进发行动态，2026-11-07）；
  // 文档已被物理删除的动态一并隐藏（COALESCE 兜底视为四级）。
  const list = await many(
    `SELECT f.id, f.doc_id, f.version, f.doc_code_snapshot, f.title_snapshot,
            f.issued_at, f.issued_by, f.target_scope, f.dept_ids, f.user_ids, f.remark,
            u.real_name AS issued_by_name,
            (r.id IS NOT NULL) AS is_read,
            r.first_read_at, r.last_read_at, r.read_count
       FROM doc_issue_feed f
       LEFT JOIN doc_system ds ON ds.id = f.doc_id
       LEFT JOIN org_user u ON u.id = f.issued_by
       LEFT JOIN doc_issue_read r ON r.feed_id = f.id AND r.user_id = $1
      WHERE ${where} AND COALESCE(ds.level, 4) < 4
      ORDER BY f.issued_at DESC, f.id DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  // 附目标范围文案与部门名（便于前端直接展示）
  const deptIdsAll = [...new Set(list.flatMap(r => normalizeIdArray(r.dept_ids)))];
  const deptMap = new Map();
  if (deptIdsAll.length) {
    const ds = await many(`SELECT id, name FROM org_department WHERE id = ANY($1::bigint[])`, [deptIdsAll]);
    for (const d of ds) deptMap.set(Number(d.id), d.name);
  }
  return list.map(r => ({
    ...r,
    scope_label: scopeLabel(r.target_scope),
    target_dept_names: normalizeIdArray(r.dept_ids).map(id => deptMap.get(id)).filter(Boolean),
    target_user_count: normalizeIdArray(r.user_ids).length,
  }));
}

/**
 * 取单条发行动态并做可见性校验（读/写阅读记录前调用）。
 * @param {number} feedId
 * @param {object} user
 * @returns {Promise<object>} feed 行
 */
export async function assertFeedVisible(feedId, user) {
  const feed = await one(`SELECT * FROM doc_issue_feed WHERE id = $1`, [feedId]);
  if (!feed) throw bizError('发行动态不存在', 404);
  if (user?.isAdmin) return feed;
  const uid = Number(user?.id) || 0;
  const scope = feed.target_scope || 'all';
  if (scope === 'all') return feed;
  if (Number(feed.issued_by) === uid) return feed;
  if (scope === 'dept') {
    const deptId = toId(user?.dept_id);
    if (deptId !== null && normalizeIdArray(feed.dept_ids).includes(deptId)) return feed;
  } else if (scope === 'user') {
    if (normalizeIdArray(feed.user_ids).includes(uid)) return feed;
  }
  throw bizError('无权查看该发行动态', 403);
}

/**
 * 写阅读（下发接收）记录——幂等：
 *   · 首次阅读：insert 一行 first_read_at=last_read_at=now(), read_count=1
 *   · 重复阅读：仅刷新 last_read_at、read_count+1，不产生重复行
 * 调用前会做可见性校验（非目标人群不可写入）。
 * @param {number} feedId
 * @param {object} user
 * @returns {Promise<{feed_id:number, user_id:number, first_read_at:string, last_read_at:string, read_count:number}>}
 */
export async function markFeedRead(feedId, user) {
  const feed = await assertFeedVisible(feedId, user);
  const uid = Number(user?.id);
  if (!uid) throw bizError('登录已失效，请重新登录', 401);
  const row = await one(
    `INSERT INTO doc_issue_read (feed_id, user_id, first_read_at, last_read_at, read_count)
     VALUES ($1, $2, now(), now(), 1)
     ON CONFLICT (feed_id, user_id)
     DO UPDATE SET last_read_at = now(), read_count = doc_issue_read.read_count + 1
     RETURNING feed_id, user_id, first_read_at, last_read_at, read_count`,
    [feed.id, uid]
  );
  return row;
}

/**
 * 阅读情况（已读名单 + 未读名单 + summary）。限管理员 / 发行方 / 拥有 doc:manage 权限者。
 * 「未读」= 目标人群 − 已读集合（实时计算，无需为未读落行）。
 * @param {number} feedId
 * @param {object} user
 * @returns {Promise<{feed:object, read:Array, unread:Array, summary:{read_count:number,total:number,rate:number}}>}
 */
export async function getFeedReads(feedId, user) {
  const feed = await one(`SELECT * FROM doc_issue_feed WHERE id = $1`, [feedId]);
  if (!feed) throw bizError('发行动态不存在', 404);
  const uid = Number(user?.id) || 0;
  const isIssuer = Number(feed.issued_by) === uid;
  const hasManage = Array.isArray(user?.permissions) && user.permissions.includes('doc:manage');
  const admin = await isAdminUser(uid);
  if (!admin && !isIssuer && !hasManage) throw bizError('无权查看该发行动态的阅读情况', 403);

  const targets = await targetUserRows(feed);
  const readRows = await many(
    `SELECT user_id, first_read_at, last_read_at, read_count
       FROM doc_issue_read WHERE feed_id = $1`,
    [feed.id]
  );
  const readMap = new Map(readRows.map(r => [Number(r.user_id), r]));

  const read = [];
  const unread = [];
  for (const u of targets) {
    const rid = Number(u.id);
    const r = readMap.get(rid);
    if (r) {
      read.push({
        user_id: rid, real_name: u.real_name, dept: u.dept,
        first_read_at: r.first_read_at, last_read_at: r.last_read_at, read_count: Number(r.read_count),
      });
    } else {
      unread.push({ user_id: rid, real_name: u.real_name, dept: u.dept });
    }
  }
  const total = targets.length;
  const readCount = read.length;
  return {
    feed,
    read,
    unread,
    summary: { read_count: readCount, total, rate: total ? Math.round((readCount / total) * 1000) / 10 : 0 },
  };
}

export default {
  FEED_CATEGORY,
  createIssueFeed,
  notifyIssueFeed,
  listFeeds,
  markFeedRead,
  getFeedReads,
  assertFeedVisible,
  targetUserIds,
  resolveDeptIdsByCodes,
};
