// ============================================================
// 体系文件服务（doc-service）—— S1 改造版
// 职责：编号池取号 / 版本号字符串化 / 双语正文 / 密级 / 印章 / 编辑锁 / 版本履历
// 改造要点（T02）：
//   1) 版本号字符串化：新增 bumpVersion()（minor/major）
//   2) nextDocCode 改为序号池取号（doc_code_seq + doc_code_ledger），删除旧 regexp_match
//   3) 双语正文 doc_version_lang（zh/vi 挂同一 version，结构上禁各语言独立升版）
//   4) 密级 security_level（secret 禁下载禁打印，允许预览）
//   5) 编号冻结 code_state（作废置 frozen，永不复用）
// 保留：doc_edit_lock 独占编辑锁；sys_doc_version.content/change_log 作中文兼容镜像继续写。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { many, one, query, transaction } from '../db/index.js';
import { config } from '../config/index.js';
import { notify } from './notify.js';
import { createIssueFeed, notifyIssueFeed } from './doc-issue-feed.js';
import { movePhysical, absFromRel } from './drive-service.js';

const LOCK_TIMEOUT_MIN = () => config.doc.lockTimeoutMin;

/**
 * 把 /api/upload 落在 uploads/.staging-tmp/ 的临时文件定名到稳定目录，
 * 返回「相对 uploads 根」的最终路径（不含 uploads/ 前缀，与 /api/files/* 一致）。
 *
 * 背景：/api/upload 为并发安全只写临时名；调用方必须随后定名落位，
 * 否则文件会永久滞留在过渡目录（历史上体系文件附件就踩过这个坑）。
 *
 * - 非 .staging-tmp/ 开头的路径（历史数据 / 已在正式目录）原样返回，兼容存量。
 * - 临时文件不存在则抛业务错，绝不落库一个指向空气的路径。
 *
 * @param {object} p
 * @param {string} p.filePath  相对 uploads 根的路径（通常来自 /api/upload 的 tempRelPath）
 * @param {number} p.docId     文档 id（用于分目录，避免单目录文件过多）
 * @param {string} [p.fileName] 原始文件名（用于取扩展名）
 * @returns {string|null} 最终相对路径
 */
/**
 * 通用「暂存 → 正式」落位：把 /api/upload 写入 uploads/.staging-tmp/ 的临时文件
 * 定名到稳定子目录，避免永久滞留暂存区（并发安全的唯一出栈路径）。
 * @param {{filePath:string, subDir:string, fileName?:string}} p
 * @returns {string|null} 正式相对路径
 */
export function finalizeStagedFile({ filePath, subDir, fileName }) {
  const rel = String(filePath ?? '').trim().replace(/\\/g, '/');
  if (!rel) return null;
  // 防目录穿越：rel 会被拼到 uploads 根下，绝不允许 .. 逃逸
  if (rel.includes('..')) throw new Error('非法的文件路径');
  if (!rel.startsWith('.staging-tmp/')) return rel;

  const fromName = fileName ? path.extname(String(fileName)) : '';
  const ext = (fromName || path.extname(rel)).toLowerCase();
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const sub = String(subDir || 'misc').replace(/^\/+|\/+$/g, '');
  const finalRel = `${sub}/${stamp}${ext}`;

  if (!fs.existsSync(absFromRel(rel))) {
    throw new Error('上传的临时文件已失效，请重新上传');
  }
  if (!movePhysical(rel, finalRel)) {
    throw new Error('文件落位失败，请重新上传');
  }
  return finalRel;
}

export function finalizeDocFile({ filePath, docId, fileName }) {
  return finalizeStagedFile({ filePath, subDir: `docs/${Number(docId)}`, fileName });
}

/** 分类 code → 编号前缀（§3.2A 七类；L2/L3 需部门代码） */
const CATEGORY_PREFIX = {
  l1_manual: 'DT-MM-',
  l2_procedure: 'DT-SP-',   // + <DEPT>-
  l3_manage: 'DT-OP-',      // + <DEPT>-
  l4_form: 'FM-',
  product_l3: 'DT-PD-',     // + <DEPT>-（§3.2A product_l3 语义，设计未明确前缀，自主决策见报告）
  external: 'WB-',          // + <DEPT>-
  temporary: 'TP-',         // + <DEPT>-
};

/** 需要部门代码前缀的分类 */
const DEPT_SCOPED = new Set(['l2_procedure', 'l3_manage', 'product_l3', 'external', 'temporary']);

/** 检查锁是否有效；超时则自动释放 */
function isLockAlive(lock) {
  if (!lock) return false;
  const elapsed = (Date.now() - new Date(lock.heartbeat_at).getTime()) / 60000;
  return elapsed <= LOCK_TIMEOUT_MIN();
}

/** 版本号解析：仅接受 /^(\d+)\.(\d+)$/，非法抛错 */
export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  if (!m) throw new Error(`非法版本号：${version}`);
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * 版本号自增（字符串化）。
 *  - minor（小改）：'1.0'→'1.1'→…→'1.9'→'2.0'（1.9 进位到 2.0）
 *  - major（换版）：'1.x'→'2.0'
 * @param {string} version 当前版本号（如 '1.0'）
 * @param {'minor'|'major'} type 升版类型
 * @returns {string} 新版本号
 */
export function bumpVersion(version, type = 'minor') {
  const { major, minor } = parseVersion(version);
  if (type === 'major') return `${major + 1}.0`;
  // minor：minor+1；到 10 进位为 major+1.0
  if (minor + 1 >= 10) return `${major + 1}.0`;
  return `${major}.${minor + 1}`;
}

/** 列表：按分类与状态筛选（含密级/作废筛选） */
export async function listDocs({ level, category, status, security, keyword, page = 1, size = 20 }) {
  const params = [];
  let where = '1=1';
  if (level) { params.push(level); where += ` AND d.level = $${params.length}`; }
  if (category) { params.push(category); where += ` AND d.category = $${params.length}`; }
  if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
  if (security) { params.push(security); where += ` AND d.security_level = $${params.length}`; }
  if (keyword) { params.push(`%${keyword}%`); where += ` AND (d.title ILIKE $${params.length} OR d.title_vi ILIKE $${params.length} OR d.code ILIKE $${params.length})`; }

  const rows = await many(
    `SELECT d.id, d.code, d.title, d.title_vi, d.level, d.category, d.status, d.current_version,
            d.security_level, d.code_state, d.issue_date, d.next_review_date, d.product_scope,
            u.real_name AS created_by_name, dep.name AS owner_dept,
            (SELECT COUNT(*)::int FROM sys_doc_version v WHERE v.doc_id = d.id) AS version_count
       FROM doc_system d
       LEFT JOIN org_user u ON u.id = d.created_by
       LEFT JOIN org_department dep ON dep.id = d.owner_dept_id
      WHERE ${where}
      ORDER BY d.updated_at DESC
      LIMIT ${Number(size)} OFFSET ${(Number(page) - 1) * Number(size)}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM doc_system d WHERE ${where}`, params);
  return { list: rows, total: cnt?.n || 0 };
}

/**
 * 详情 + 双语正文 + 版本履历 + 锁 + 关联 + 印章。
 * @param {number} docId
 * @param {string} lang 当前语言（zh/vi），用于主语言正文
 */
export async function getDoc(docId, lang = 'zh') {
  const doc = await one(
    `SELECT d.*, u.real_name AS created_by_name
       FROM doc_system d LEFT JOIN org_user u ON u.id = d.created_by
      WHERE d.id = $1`,
    [docId]
  );
  if (!doc) return null;

  const versions = await many(
    `SELECT v.id, v.version, v.status, v.change_log, v.created_by, v.published_at,
            u.real_name AS editor_name
       FROM sys_doc_version v LEFT JOIN org_user u ON u.id = v.created_by
      WHERE v.doc_id = $1 ORDER BY v.version DESC`,
    [docId]
  );

  // 每个版本的语言齐备情况（存在性标记，供前端"缺语言"提示）
  const langRows = await many(
    `SELECT doc_id, version, lang, file_id, sealed_file_id, content, change_summary
       FROM doc_version_lang WHERE doc_id = $1`,
    [docId]
  );
  const langMap = new Map();
  for (const r of langRows) {
    const key = `${r.version}`;
    if (!langMap.has(key)) langMap.set(key, { zh: false, vi: false });
    if (r.lang === 'zh' || r.lang === 'vi') langMap.get(key)[r.lang] = true;
  }
  for (const v of versions) {
    const flags = langMap.get(String(v.version)) || { zh: false, vi: false };
    v.has_zh = flags.zh;
    v.has_vi = flags.vi;
  }

  const lock = await one(`SELECT * FROM doc_edit_lock WHERE doc_id = $1`, [docId]);
  const lockAlive = isLockAlive(lock);
  if (lock && !lockAlive) {
    await query(`DELETE FROM doc_edit_lock WHERE doc_id = $1`, [docId]);
  }
  const lockUser = lockAlive ? await one(`SELECT id, real_name FROM org_user WHERE id = $1`, [lock.lock_user]) : null;

  // 当前版本（sys_doc_version 兼容镜像）
  const curVersion = await one(
    `SELECT * FROM sys_doc_version WHERE doc_id = $1 AND version = $2`,
    [docId, doc.current_version]
  );
  // 当前版本双语正文 + 各语言绑定的文件（file_id → attachment，见 06_doc_system.sql 该列注释）
  const curLang = await many(
    `SELECT l.lang, l.file_id, l.sealed_file_id, l.content, l.change_summary,
            a.file_name  AS file_name,  a.file_path  AS file_path,
            sa.file_name AS sealed_file_name, sa.file_path AS sealed_file_path
       FROM doc_version_lang l
       LEFT JOIN attachment a  ON a.id  = l.file_id
       LEFT JOIN attachment sa ON sa.id = l.sealed_file_id
      WHERE l.doc_id = $1 AND l.version = $2`,
    [docId, doc.current_version]
  );
  const langs = { zh: null, vi: null };
  for (const r of curLang) langs[r.lang] = r;

  // 关联文件
  const relations = await many(
    `SELECT r.id, r.related_doc_id, r.relation_type, d.code, d.title, d.title_vi, d.status
       FROM doc_relation r JOIN doc_system d ON d.id = r.related_doc_id
      WHERE r.doc_id = $1 ORDER BY r.id`,
    [docId]
  );

  return {
    ...doc,
    versions,
    lock: lockAlive ? { ...lock, user: lockUser } : null,
    currentContent: curVersion,                 // 兼容旧前端
    currentLang: langs,                         // {zh, vi}
    langUsed: lang,
    missingLang: (lang === 'zh' ? !langs.zh : lang === 'vi' ? !langs.vi : false),
    relations,
  };
}

/**
 * 组织部门 id → 大写 code（取号前缀用）。
 * @param {number} deptId
 * @returns {Promise<string>} 如 'QA'
 */
async function deptCodeOf(deptId) {
  if (!deptId) return 'XX';
  const dept = await one(`SELECT code FROM org_department WHERE id = $1`, [deptId]);
  return String(dept?.code || 'XX').toUpperCase();
}

/**
 * 计算编号前缀（§3.2A 七类）。
 * @param {string} category 分类 code
 * @param {number} level 文件级别（category 缺失时退化）
 * @param {number} deptId 责任部门
 */
async function resolvePrefix(category, level, deptId) {
  let base;
  if (category && CATEGORY_PREFIX[category]) {
    base = CATEGORY_PREFIX[category];
  } else {
    // 退化：按 level 推断（兼容旧调用）
    base = Number(level) === 1 ? 'DT-MM-' : Number(level) === 4 ? 'FM-' : Number(level) === 2 ? 'DT-SP-' : 'DT-OP-';
  }
  // 需部门代码前缀的分类（L2/L3/product_l3/external/temporary）
  if (base === 'DT-SP-' || base === 'DT-OP-' || base === 'DT-PD-' || base === 'WB-' || base === 'TP-') {
    base = `${base}${await deptCodeOf(deptId)}-`;
  }
  return base;
}

/**
 * 编号「预览」——只读，不消耗序号。
 *
 * 背景（缺陷修复）：原 GET /api/docs/next-code 直接调用 nextDocCode，而 nextDocCode 会
 * 真实自增 doc_code_seq 并写 doc_code_ledger。于是「进入新建页 / 切换分类 / 切换级别」
 * 这类纯浏览动作都会白白吞掉一个编号，导致系统里一条文件都没有、编号却已经跑到 004
 * （库里留下 4 条 doc_id 为 NULL 的孤儿台账）。预览必须是纯读操作。
 *
 * 取号动作只允许发生在真正落库那一刻（POST /api/docs → createDoc）。
 * @param {string} category 分类 code
 * @param {number} level 级别
 * @param {number} deptId 责任部门
 * @returns {Promise<{prefix: string, code: string, nextSeq: number}>}
 */
export async function peekNextDocCode(category, level, deptId) {
  const prefix = await resolvePrefix(category, level, deptId);
  // 只读当前水位；没有记录时视为 0（下一个即 001）
  const row = await one(`SELECT max_seq FROM doc_code_seq WHERE prefix = $1`, [prefix]);
  const nextSeq = Number(row?.max_seq || 0) + 1;
  return { prefix, nextSeq, code: `${prefix}${String(nextSeq).padStart(3, '0')}` };
}

/**
 * 序号池取号（并发安全）。取号即写 doc_code_ledger（state='active'）。
 * @param {string} category 分类 code
 * @param {number} level 级别
 * @param {number} deptId 责任部门
 * @param {object} [client] 事务 client（可选，传入时在事务内取号）
 * @returns {Promise<string>} 编号，如 'DT-MM-001'
 */
export async function nextDocCode(category, level, deptId, client = null) {
  const prefix = await resolvePrefix(category, level, deptId);
  const q = client || { query };
  // 原子自增：首次插入 max_seq=1，之后 +1
  const res = await q.query(
    `INSERT INTO doc_code_seq (prefix, max_seq) VALUES ($1, 1)
     ON CONFLICT (prefix) DO UPDATE SET max_seq = doc_code_seq.max_seq + 1, updated_at = now()
     RETURNING max_seq`,
    [prefix]
  );
  const seq = Number(res.rows[0].max_seq);
  const code = `${prefix}${String(seq).padStart(3, '0')}`;   // 超 999 自然 4 位
  await q.query(
    `INSERT INTO doc_code_ledger (code, prefix, seq, state) VALUES ($1, $2, $3, 'active')
     ON CONFLICT (code) DO NOTHING`,
    [code, prefix, seq]
  );
  return code;
}

/** 创建文档（草稿）；未填编号时按规则自动从序号池取号 */
export async function createDoc({ title, titleVi, code, level, category, ownerDeptId, content, securityLevel, createdBy }) {
  return transaction(async client => {
    let finalCode = code;
    if (!finalCode) {
      finalCode = await nextDocCode(category, level, ownerDeptId, client);
    }
    const docRes = await client.query(
      `INSERT INTO doc_system (title, title_vi, code, level, category, owner_dept_id, status,
                               current_version, security_level, code_state, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'draft','1.0',$7,'active',$8) RETURNING *`,
      [title, titleVi || null, finalCode, level || 1, category || null, ownerDeptId || null,
        securityLevel || 'public', createdBy]
    );
    const doc = docRes.rows[0];
    // 版本序号记录（中文兼容镜像）；1.0 初版修订摘要默认「初版发行」（2026-11-07）
    await client.query(
      `INSERT INTO sys_doc_version (doc_id, version, status, content, change_log, created_by)
       VALUES ($1, '1.0', 'draft', $2, '初版发行', $3)`,
      [doc.id, content || '', createdBy]
    );
    // 双语正文初始（zh）
    await client.query(
      `INSERT INTO doc_version_lang (doc_id, version, lang, content, change_summary)
       VALUES ($1, '1.0', 'zh', $2, '初版发行')
       ON CONFLICT (doc_id, version, lang) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [doc.id, content || '']
    );
    // 台账登记 doc_id
    await client.query(`UPDATE doc_code_ledger SET doc_id = $2 WHERE code = $1`, [finalCode, doc.id]);
    return doc;
  });
}

/** 领取独占编辑锁 */
export async function acquireLock(docId, userId) {
  // 原子抢占（compare-and-swap）：
  //   仅当「原本无锁 / 锁就属于自己 / 原锁心跳已超时」时才写入并返回该行。
  //
  // 原实现是 check-then-act —— 先 SELECT 判断锁是否被他人持有，再 INSERT ... ON CONFLICT DO UPDATE。
  // 两个用户并发抢锁时会先后通过判断，后者直接覆盖前者的锁，双方都收到"已获得编辑权"，
  // 随后互相覆盖彼此的编辑内容。
  const ttlMin = LOCK_TIMEOUT_MIN();
  const claimed = await one(
    `INSERT INTO doc_edit_lock (doc_id, version_id, lock_user, lock_at, heartbeat_at)
     VALUES ($1, (SELECT id FROM sys_doc_version WHERE doc_id=$1 AND version=(SELECT current_version FROM doc_system WHERE id=$1)), $2, now(), now())
     ON CONFLICT (doc_id) DO UPDATE
        SET lock_user = EXCLUDED.lock_user, lock_at = now(), heartbeat_at = now()
      WHERE doc_edit_lock.lock_user = EXCLUDED.lock_user
         OR doc_edit_lock.heartbeat_at < now() - ($3::int * INTERVAL '1 minute')
     RETURNING lock_user`,
    [docId, userId, ttlMin]
  );
  if (claimed) return { acquired: true };

  // 未抢到 → 说明锁被他人有效持有，回传持有者姓名便于前端提示
  const holder = await one(
    `SELECT u.real_name FROM doc_edit_lock l
       LEFT JOIN org_user u ON u.id = l.lock_user
      WHERE l.doc_id = $1`,
    [docId]
  );
  throw new Error(`文件正被 ${holder?.real_name || '其他用户'} 编辑，请稍后再试`);
}

/** 心跳续期 */
export async function heartbeatLock(docId, userId) {
  const r = await query(
    `UPDATE doc_edit_lock SET heartbeat_at = now() WHERE doc_id = $1 AND lock_user = $2`,
    [docId, userId]
  );
  return r.rowCount > 0;
}

/** 释放锁 */
export async function releaseLock(docId, userId) {
  await query(`DELETE FROM doc_edit_lock WHERE doc_id = $1 AND lock_user = $2`, [docId, userId]);
  return true;
}

/** 断言当前用户持有有效锁 */
async function assertLock(docId, userId) {
  const lock = await one(`SELECT * FROM doc_edit_lock WHERE doc_id = $1`, [docId]);
  if (!lock || Number(lock.lock_user) !== Number(userId) || !isLockAlive(lock)) {
    throw new Error('您已失去编辑权，请重新领取编辑锁');
  }
}

/**
 * 保存草稿（双语正文/双语摘要分开存）。
 * @param {object} p { docId, userId, lang='zh', content, summary, fileId }
 */
export async function saveDraft({ docId, userId, lang = 'zh', content, summary, fileId }) {
  await assertLock(docId, userId);
  const doc = await one(`SELECT current_version FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  const version = doc.current_version;
  // 双语正文表（按语言）
  await query(
    `INSERT INTO doc_version_lang (doc_id, version, lang, content, change_summary, file_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (doc_id, version, lang) DO UPDATE
       SET content = EXCLUDED.content,
           change_summary = COALESCE(EXCLUDED.change_summary, doc_version_lang.change_summary),
           file_id = COALESCE(EXCLUDED.file_id, doc_version_lang.file_id),
           updated_at = now()`,
    [docId, version, lang, content ?? null, summary ?? null, fileId ? Number(fileId) : null]
  );
  // 中文兼容镜像继续写 sys_doc_version（保护旧 UI）
  if (lang === 'zh') {
    await query(
      `UPDATE sys_doc_version SET content = $2, change_log = COALESCE($3, change_log)
        WHERE doc_id = $1 AND version = $4`,
      [docId, content ?? null, summary ?? null, version]
    );
  }
  return true;
}

/**
 * 升版：按 bumpType（minor/major）生成新版本，只在 sys_doc_version 插一行。
 * 结构上保证中越共用版本号（各语言不可独立升版）。
 * @param {object} p { docId, userId, bumpType='minor', content, changeLog }
 */
export async function bumpDocVersion({ docId, userId, bumpType = 'minor', content, changeLog }) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  const newVersion = bumpVersion(doc.current_version, bumpType);

  return transaction(async client => {
    const verRes = await client.query(
      `INSERT INTO sys_doc_version (doc_id, version, status, content, change_log, created_by)
       VALUES ($1,$2,'draft',$3,$4,$5) RETURNING *`,
      [docId, newVersion, content || '', changeLog || '', userId]
    );
    await client.query(
      `UPDATE doc_system SET current_version = $2, status = 'draft', updated_at = now() WHERE id = $1`,
      [docId, newVersion]
    );
    // 中文兼容镜像正文
    await client.query(
      `INSERT INTO doc_version_lang (doc_id, version, lang, content, change_summary)
       VALUES ($1,$2,'zh',$3,$4)
       ON CONFLICT (doc_id, version, lang) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [docId, newVersion, content || '', changeLog || '']
    );
    return verRes.rows[0];
  });
}

/**
 * 维护某语言正文/摘要（缺语言补齐）。
 * @param {object} p { docId, userId, version, lang, fileId, summary, content }
 */
export async function maintainVersionLang({ docId, userId, version, lang, fileId, summary, content }) {
  if (!['zh', 'vi'].includes(lang)) throw new Error('语言仅支持 zh / vi');
  await query(
    `INSERT INTO doc_version_lang (doc_id, version, lang, file_id, change_summary, content)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (doc_id, version, lang) DO UPDATE
       SET file_id = COALESCE(EXCLUDED.file_id, doc_version_lang.file_id),
           change_summary = COALESCE(EXCLUDED.change_summary, doc_version_lang.change_summary),
           content = COALESCE(EXCLUDED.content, doc_version_lang.content),
           updated_at = now()`,
    [docId, version, lang, fileId ? Number(fileId) : null, summary ?? null, content ?? null]
  );
  return true;
}

/**
 * 提交评审：发行新版本（在现有版本上 bump minor），触发评审节点。
 * 保留兼容旧签名（content/changeLog/reviewers）。
 */
export async function submitForReview(docId, userId, content, changeLog, reviewers) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');

  const newVersion = bumpVersion(doc.current_version, 'minor');
  const ver = await one(
    `INSERT INTO sys_doc_version (doc_id, version, status, content, change_log, created_by)
     VALUES ($1,$2,'reviewing',$3,$4,$5) RETURNING *`,
    [docId, newVersion, content || '', changeLog || '', userId]
  );
  await query(
    `UPDATE doc_system SET current_version = $2, status = 'reviewing', updated_at = now() WHERE id = $1`,
    [docId, newVersion]
  );
  await query(`DELETE FROM doc_edit_lock WHERE doc_id = $1`, [docId]);

  const list = (reviewers || []).filter(Boolean);
  if (!list.length) throw new Error('请选择评审人员');
  for (const rid of list) {
    await query(
      `INSERT INTO doc_review (version_id, doc_id, node_index, node_name, assignee_id, status)
       VALUES ($1,$2,0,'评审',$3,'pending')`,
      [ver.id, docId, Number(rid)]
    );
    await notify(Number(rid), {
      title: `【文件评审】${doc.title}`,
      content: `${doc.title} 已提交评审，请评审。`,
      link: `/docs/${docId}`,
      category: 'todo',
    });
  }
  return ver;
}

/** 评审通过/驳回（旧路径保留） */
export async function reviewDoc(docId, userId, action, comment) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  const ver = await one(
    `SELECT * FROM sys_doc_version WHERE doc_id = $1 AND status = 'reviewing' ORDER BY version DESC LIMIT 1`,
    [docId]
  );
  if (!ver) throw new Error('当前无待评审版本');

  const task = await one(
    `SELECT * FROM doc_review WHERE version_id = $1 AND assignee_id = $2 AND status = 'pending'`,
    [ver.id, userId]
  );
  if (!task) throw new Error('您没有该文件的待评审任务');

  if (action === 'reject') {
    await query(`UPDATE doc_review SET status='rejected', comment=$2, finished_at=now() WHERE id=$1`, [task.id, comment]);
    await query(`UPDATE sys_doc_version SET status='rejected' WHERE id=$1`, [ver.id]);
    await query(`UPDATE doc_system SET status='rejected', updated_at=now() WHERE id=$1`, [docId]);
    return { status: 'rejected' };
  }

  await query(`UPDATE doc_review SET status='approved', comment=$2, finished_at=now() WHERE id=$1`, [task.id, comment]);
  const pending = await one(
    `SELECT COUNT(*)::int AS n FROM doc_review WHERE version_id = $1 AND status = 'pending'`,
    [ver.id]
  );
  if (pending?.n > 0) return { status: 'reviewing', remaining: pending.n };

  await query(`UPDATE sys_doc_version SET status='published', published_at=now() WHERE id=$1`, [ver.id]);
  await query(`UPDATE doc_system SET status='published', updated_at=now() WHERE id=$1`, [docId]);
  await query(
    `UPDATE sys_doc_version SET status='obsolete' WHERE doc_id=$1 AND id <> $2 AND status='published'`,
    [docId, ver.id]
  );
  return { status: 'published' };
}

/** 直接发行（四级表单等简化场景） */
export async function publishDirect(docId, userId) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  await query(
    `UPDATE sys_doc_version SET status='published', published_at=now() WHERE doc_id=$1 AND version = $2`,
    [docId, doc.current_version]
  );
  await query(
    `UPDATE doc_system SET status='published', issue_date=COALESCE(issue_date, CURRENT_DATE),
            next_review_date=COALESCE(next_review_date, (CURRENT_DATE + (COALESCE(review_cycle_months,24) || ' months')::interval)::date),
            updated_at=now()
      WHERE id=$1`,
    [docId]
  );

  // 首页「体系文件发行动态」+ 全员推送（需求 2）：直接发行默认面向全员。
  // 幂等：createIssueFeed 按 doc_id+version 收敛，重复发行不重复推送；失败不阻断发行主流程。
  try {
    const { feed, created } = await createIssueFeed({
      docId,
      version: doc.current_version,
      userId,
      scope: 'all',
    });
    if (created) await notifyIssueFeed(feed);
  } catch (err) {
    console.warn('[doc-service] 发行动态创建/推送失败（不影响发行）:', err.message);
  }

  return true;
}

/**
 * 作废（编号冻结，永不复用）。
 * @param {object} p { docId, userId, reason }
 */
export async function obsoleteDoc({ docId, userId, reason }) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  return transaction(async client => {
    await client.query(
      `UPDATE doc_system SET status='obsolete', code_state='frozen', updated_at=now() WHERE id=$1`,
      [docId]
    );
    await client.query(
      `UPDATE sys_doc_version SET status='obsolete' WHERE doc_id=$1 AND status='published'`,
      [docId]
    );
    await client.query(
      `UPDATE doc_code_ledger SET state='frozen' WHERE doc_id=$1`,
      [docId]
    );
    const rec = await client.query(
      `INSERT INTO doc_obsolete_record (doc_id, version, reason, obsolete_date)
       VALUES ($1,$2,$3,CURRENT_DATE) RETURNING *`,
      [docId, doc.current_version, reason || '未填写原因']
    );
    return rec.rows[0];
  });
}

/** 销毁登记 */
export async function destroyDoc({ docId, userId, method, destroyDate }) {
  const rec = await one(
    `UPDATE doc_obsolete_record
        SET destroy_status='destroyed', destroy_method=$2, destroy_date=COALESCE($3::date, CURRENT_DATE), destroy_by=$4
      WHERE doc_id=$1 AND destroy_status='pending'
      RETURNING *`,
    [docId, method || 'shred', destroyDate || null, userId]
  );
  if (!rec) throw new Error('无待销毁记录（请先作废）');
  return rec;
}

/** 更新元数据（标题双语/分类/密级/来源等） */
export async function updateDoc(docId, patch = {}) {
  const fields = [];
  const params = [docId];
  const map = {
    title: 'title', titleVi: 'title_vi', category: 'category', securityLevel: 'security_level',
    ownerDeptId: 'owner_dept_id', issueDate: 'issue_date', nextReviewDate: 'next_review_date',
    reviewCycleMonths: 'review_cycle_months', externalSource: 'external_source',
    externalNo: 'external_no', productScope: 'product_scope',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      params.push(patch[k]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (!fields.length) throw new Error('无可更新字段');
  const doc = await one(
    `UPDATE doc_system SET ${fields.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    params
  );
  if (!doc) throw new Error('文档不存在');
  return doc;
}

/** 密码校验辅助：密级是否为 secret */
export function isSecret(doc) {
  return doc?.security_level === 'secret';
}

export { LOCK_TIMEOUT_MIN, resolvePrefix, deptCodeOf };
