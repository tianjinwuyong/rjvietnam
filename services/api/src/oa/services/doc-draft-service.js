// ============================================================
// doc-draft-service —— 体系文件「新建页」草稿暂存
//
// 为什么单独一张表、而不是复用 doc_system.status='draft'：
//   1) doc_system 的草稿会占体系文件编号（取号在创建事务里），草稿每建一次废一次
//      就会白白吃掉编号 —— 与本工单「编号跳到 004」同源；
//   2) 受控文件列表 / 台账 / 统计都按 doc_system 统计，塞草稿进去会污染口径；
//   3) 这里要的是「新建页的暂存态」，语义上根本不是一份体系文件。
//
// 权限模型（最简单且不会越权）：**只看 owner_id**。
//   除本人外任何角色（含管理员）都读不到别人的草稿 —— 草稿是半成品，
//   管理员也不需要看，避免「未完成内容被误认为正式文件」。
// ============================================================
import { many, one, query } from '../db/index.js';

// 单份草稿正文上限：富文本 HTML（含 drawio 内嵌源码）按 8MB 字符截断保护，
// 超限直接拒绝而不是静默截断 —— 静默截断会造成"恢复后内容少了半截"这种更难查的问题。
const MAX_CONTENT_CHARS = 8 * 1024 * 1024;

function badRequest(msg, statusCode = 400) {
  return Object.assign(new Error(msg), { statusCode, isBiz: true });
}

function assertContentSize(zh, vi) {
  for (const [label, val] of [['中文', zh], ['越南语', vi]]) {
    if (typeof val === 'string' && val.length > MAX_CONTENT_CHARS) {
      throw badRequest(`${label}正文过大（超过 8MB），请精简后再保存草稿`);
    }
  }
}

/** 允许写入的字段 → 列名（白名单，杜绝前端传任意列名拼 SQL） */
const FIELD_MAP = {
  title: 'title',
  titleVi: 'title_vi',
  category: 'category',
  level: 'level',
  ownerDeptId: 'owner_dept_id',
  securityLevel: 'security_level',
  codeAuto: 'code_auto',
  codeManual: 'code_manual',
  contentZh: 'content_zh',
  contentVi: 'content_vi',
  files: 'files',
};

/**
 * 从请求体挑出白名单字段，生成 SET/列片段。
 * @param {object} body
 * @param {boolean} partial true=只更新出现的字段（PUT 局部更新），false=全量
 */
function pick(body, partial) {
  const cols = [];
  const vals = [];
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (!(key in body)) {
      if (partial) continue;
      // 全量插入时缺省字段用 null（由列默认值兜底的部分另行处理）
      cols.push(col); vals.push(null); continue;
    }
    let v = body[key];
    if (key === 'level') v = v == null || v === '' ? null : Number(v);
    if (key === 'files') v = v && typeof v === 'object' ? v : {};
    if (typeof v === 'string' && v.length > 100000 && key !== 'contentZh' && key !== 'contentVi') {
      v = v.slice(0, 100000);   // 标题/编号等短字段的防御性截断
    }
    cols.push(col); vals.push(v);
  }
  return { cols, vals };
}

/** 列表：只回摘要字段，正文不入列表响应（避免草稿列表把几 MB 正文全拉下来） */
export async function listDrafts(ownerId, { page = 1, size = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(size) || 20));
  const total = Number((await one(
    `SELECT count(*)::int n FROM doc_draft WHERE owner_id = $1`, [ownerId]
  ))?.n || 0);

  const rows = await many(
    `SELECT d.id, d.title, d.title_vi, d.category, d.level, d.owner_dept_id,
            d.security_level, d.code_auto, d.code_manual, d.files,
            d.created_at, d.updated_at,
            -- 摘要：剥掉标签后取前 80 字，供列表一眼认出是哪份
            left(regexp_replace(coalesce(nullif(d.content_zh,''), d.content_vi, ''), '<[^>]*>', '', 'g'), 80) AS excerpt,
            (coalesce(length(d.content_zh),0) + coalesce(length(d.content_vi),0)) AS content_len,
            dept.name AS dept_name
       FROM doc_draft d
       LEFT JOIN org_department dept ON dept.id = d.owner_dept_id
      WHERE d.owner_id = $1
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT $2 OFFSET $3`,
    [ownerId, s, (p - 1) * s]
  );

  return { list: rows, total, page: p, size: s };
}

/** 最近一条草稿（新建页进入时用于「你有未完成的草稿」提示），没有则 null */
export async function latestDraft(ownerId) {
  return await one(
    `SELECT id, title, title_vi, category, level, updated_at
       FROM doc_draft WHERE owner_id = $1
      ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [ownerId]
  );
}

/** 详情（含正文）；非本人 → 404（不区分「不存在」与「无权」，避免探测） */
export async function getDraft(ownerId, id) {
  const row = await one(`SELECT * FROM doc_draft WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  if (!row) throw badRequest('草稿不存在或已被废除', 404);
  return row;
}

/** 新建草稿 */
export async function createDraft(ownerId, body = {}) {
  assertContentSize(body.contentZh, body.contentVi);
  const { cols, vals } = pick(body, false);
  const res = await query(
    `INSERT INTO doc_draft (owner_id, ${cols.join(',')})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
     RETURNING *`,
    [ownerId, ...vals]
  );
  return res.rows[0];
}

/**
 * 局部更新草稿。
 * 前端自动保存只传变化的字段（通常是 contentZh / contentVi / title 等），
 * 因此这里必须做「部分更新」，不能用全量覆盖把未传字段清空。
 */
export async function updateDraft(ownerId, id, body = {}) {
  assertContentSize(body.contentZh, body.contentVi);
  const { cols, vals } = pick(body, true);
  if (!cols.length) {
    return await getDraft(ownerId, id);   // 没东西可改，原样返回（不报错，自动保存容错）
  }
  const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const res = await query(
    `UPDATE doc_draft SET ${sets}, updated_at = now()
      WHERE id = $1 AND owner_id = $2
      RETURNING *`,
    [id, ownerId, ...vals]
  );
  if (!res.rows[0]) throw badRequest('草稿不存在或已被废除', 404);
  return res.rows[0];
}

/** 废除草稿（物理删除一行，不产生任何业务痕迹） */
export async function deleteDraft(ownerId, id) {
  const res = await query(`DELETE FROM doc_draft WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, ownerId]);
  if (!res.rows[0]) throw badRequest('草稿不存在或已被废除', 404);
  return { id: res.rows[0].id };
}

/**
 * 正式创建成功后回收草稿。
 * 供 POST /api/docs 之后的调用方使用；不校验存在性（可能已被别处删除），静默幂等。
 */
export async function consumeDraft(ownerId, id) {
  if (!id) return { deleted: 0 };
  const res = await query(`DELETE FROM doc_draft WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  return { deleted: res.rowCount || 0 };
}
