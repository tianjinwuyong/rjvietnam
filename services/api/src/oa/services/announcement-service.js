// ============================================================
// S7 通告公告服务（中越双语）
// 可见性规则：
//   * published：全员可见
//   * draft：仅发布者本人或系统管理员可见
// 已读：getAnnouncement 被访问时写 announcement_read；unreadCount 供首页红点。
// ============================================================
import { many, one, query } from '../db/index.js';

/** 判断是否具备通告管理权（发布/删除/编辑他人） */
function canManage(user, row) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return !!row && row.publisher_id === user.id;
}

/**
 * 通告列表（分页）。
 * @param {{keyword?:string,status?:string,category?:string,page?:number,pageSize?:number}} opts
 * @param {object} user 当前用户（用于 draft 可见性过滤）
 * @returns {Promise<{list:Array,total:number,page:number,pageSize:number}>}
 */
export async function listAnnouncements({ keyword, status, category, page, pageSize } = {}, user = {}) {
  const params = [];
  let where = '1=1';

  // 可见性：非管理员只看「已发布」或「自己发布的草稿」
  let joinUserParam;
  if (user.isAdmin) {
    if (status) { params.push(status); where += ` AND a.status = $${params.length}`; }
  } else if (status && status !== 'published') {
    // 指定了非 published 状态：仅自己发布的
    params.push(status, user.id);
    where += ` AND a.status = $${params.length - 1} AND a.publisher_id = $${params.length}`;
  } else {
    // 默认：已发布 OR 自己发布的
    params.push(user.id);
    where += ` AND (a.status = 'published' OR a.publisher_id = $${params.length})`;
    if (status) { params.push(status); where += ` AND a.status = $${params.length}`; }
  }

  if (category) { params.push(category); where += ` AND a.category = $${params.length}`; }
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    where += ` AND (a.title ILIKE $${i} OR a.title_vi ILIKE $${i} OR a.content ILIKE $${i} OR a.content_vi ILIKE $${i})`;
  }

  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);

  const cnt = await one(`SELECT COUNT(*)::int AS n FROM announcement a WHERE ${where}`, params);
  const list = await many(
    `SELECT a.*, u.real_name AS publisher_name,
            (r.id IS NOT NULL) AS is_read,
            (SELECT COUNT(*)::int FROM announcement_read ar WHERE ar.announcement_id = a.id) AS read_count
       FROM announcement a
       LEFT JOIN org_user u ON u.id = a.publisher_id
       LEFT JOIN announcement_read r ON r.announcement_id = a.id AND r.user_id = $${params.length + 1}
      WHERE ${where}
      ORDER BY a.top DESC, COALESCE(a.publish_at, a.created_at) DESC
      LIMIT ${size} OFFSET ${(p - 1) * size}`,
    [...params, user.id || null]
  );

  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 通告详情（读取时自动标记已读）。
 * @param {number} id
 * @param {object} user
 */
export async function getAnnouncement(id, user = {}) {
  const row = await one(
    `SELECT a.*, u.real_name AS publisher_name,
            (SELECT COUNT(*)::int FROM announcement_read ar WHERE ar.announcement_id = a.id) AS read_count
       FROM announcement a
       LEFT JOIN org_user u ON u.id = a.publisher_id
      WHERE a.id = $1`,
    [id]
  );
  if (!row) throw new Error('通告不存在');
  // draft 仅发布者/管理员可见
  if (row.status !== 'published' && row.publisher_id !== user.id && !user.isAdmin) {
    const err = new Error('无权查看该通告');
    err.statusCode = 403;
    throw err;
  }
  // 读取即已读
  if (user.id) await markRead(id, user.id);
  const isRead = await one(
    `SELECT 1 AS x FROM announcement_read WHERE announcement_id = $1 AND user_id = $2`,
    [id, user.id]
  );
  return { ...row, is_read: !!isRead };
}

/**
 * 创建通告（默认 draft）。
 * @param {object} data
 * @param {number} userId
 */
export async function createAnnouncement(data = {}, userId) {
  const title = data.title ? String(data.title).trim() : '';
  if (!title) throw new Error('请填写通告标题');
  if (!userId) throw new Error('缺少发布者');

  return one(
    `INSERT INTO announcement
       (title, title_vi, content, content_vi, category, publisher_id,
        publish_at, expire_at, status, top)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [title, data.titleVi || null, data.content || null, data.contentVi || null,
     data.category || 'notice', userId,
     data.publishAt || null, data.expireAt || null,
     data.status === 'published' ? 'published' : 'draft', !!data.top]
  );
}

/**
 * 更新通告（仅发布者/管理员）。
 * @param {number} id
 * @param {object} data
 * @param {object} user
 */
export async function updateAnnouncement(id, data = {}, user = {}) {
  const cur = await one(`SELECT * FROM announcement WHERE id = $1`, [id]);
  if (!cur) throw new Error('通告不存在');
  if (!canManage(user, cur)) {
    const err = new Error('只能修改自己发布的通告');
    err.statusCode = 403;
    throw err;
  }
  return one(
    `UPDATE announcement SET
        title = $2, title_vi = $3, content = $4, content_vi = $5,
        category = $6, expire_at = $7, top = $8, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id,
     data.title !== undefined ? String(data.title).trim() : cur.title,
     data.titleVi !== undefined ? data.titleVi : cur.title_vi,
     data.content !== undefined ? data.content : cur.content,
     data.contentVi !== undefined ? data.contentVi : cur.content_vi,
     data.category !== undefined ? data.category : cur.category,
     data.expireAt !== undefined ? data.expireAt : cur.expire_at,
     data.top !== undefined ? !!data.top : cur.top]
  );
}

/**
 * 发布通告（draft → published）。
 * @param {number} id
 * @param {object} user
 */
export async function publishAnnouncement(id, user = {}) {
  const cur = await one(`SELECT * FROM announcement WHERE id = $1`, [id]);
  if (!cur) throw new Error('通告不存在');
  if (!canManage(user, cur)) {
    const err = new Error('只能发布自己创建的通告');
    err.statusCode = 403;
    throw err;
  }
  if (cur.status === 'published') return { id, status: 'published', alreadyPublished: true };
  const r = await one(
    `UPDATE announcement SET status = 'published', publish_at = COALESCE(publish_at, now()), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id]
  );
  return r;
}

/**
 * 删除通告（仅发布者/管理员，级联删除已读记录）。
 * @param {number} id
 * @param {object} user
 */
export async function deleteAnnouncement(id, user = {}) {
  const cur = await one(`SELECT * FROM announcement WHERE id = $1`, [id]);
  if (!cur) throw new Error('通告不存在');
  if (!canManage(user, cur)) {
    const err = new Error('只能删除自己发布的通告');
    err.statusCode = 403;
    throw err;
  }
  await query(`DELETE FROM announcement WHERE id = $1`, [id]);
  return { id };
}

/**
 * 未读通告数（首页红点）。仅统计已发布、未过期、且当前用户未读的通告。
 * @param {number} userId
 */
export async function unreadCount(userId) {
  if (!userId) return 0;
  const r = await one(
    `SELECT COUNT(*)::int AS n
       FROM announcement a
      WHERE a.status = 'published'
        AND (a.expire_at IS NULL OR a.expire_at >= now())
        AND NOT EXISTS (
              SELECT 1 FROM announcement_read ar
               WHERE ar.announcement_id = a.id AND ar.user_id = $1
            )`,
    [userId]
  );
  return r?.n || 0;
}

/**
 * 标记已读（幂等）。
 * @param {number} announcementId
 * @param {number} userId
 */
export async function markRead(announcementId, userId) {
  if (!announcementId || !userId) throw new Error('参数不完整');
  await query(
    `INSERT INTO announcement_read (announcement_id, user_id)
     VALUES ($1,$2) ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [announcementId, userId]
  );
  return true;
}
