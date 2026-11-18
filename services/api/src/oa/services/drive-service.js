// 公共盘文档工作区服务：文件夹树 + 文件 + 按用户 ACL 权限
import { many, one, query, transaction } from '../db/index.js';
import { config } from '../config/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { posix } from 'node:path';

/**
 * 事务级咨询锁命名空间（pg_advisory_xact_lock 的第一个入参）。
 * 用途：按「目标目录」串行化名称分配，避免并发「复制 / 上传 / 移动」生成重复名称。
 * 取值任意但需全局唯一，避免与其它业务模块的咨询锁撞号。
 */
const ADV_DRIVE_COPY = 91;

/* ============================================================
 * 层级化磁盘存储 —— 路径解析 / 名称安全化 / 物理文件读写
 *
 * 设计口径（用户 2026-10-12 拍板）：
 *   - DB 的 drive_folder.parent_id 树是唯一权威，磁盘目录只是它的「投影」；
 *     磁盘结构损坏可凭 DB 用 rebuild-drive-layout.mjs 一键重建。
 *   - DB 的 name 保留用户输入原文（界面显示）；磁盘用 disk_name（安全化 + 去重）。
 *   - 绝对路径 = uploads 根 + 各层级 disk_name … + 文件 disk_name。
 * ============================================================ */

/** Windows 保留字符（同时规避 Linux 上易引起歧义的字符） */
const WINDOWS_ILLEGAL_RE = /[\\/:*?"<>|]/g;
/** 控制字符 */
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;
/** Windows 保留设备名（不区分大小写；含带扩展名形式） */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 取出扩展名（含前导点）；`.hidden` 这类以点开头者视为无扩展名 */
function pickExt(name) {
  const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  return dot > 0 ? name.slice(dot) : '';
}

/**
 * 把单个路径段（文件夹名 / 文件名）安全化为可落盘的名称。
 *
 * 规则：
 *   1. 替换 Windows 保留字符 `\ / : * ? " < > |` → `_`；
 *   2. 去掉控制字符；
 *   3. 去掉首尾空格与结尾句点（Windows 不允许 `name.` / `name `）；
 *   4. 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）加前缀 `_`；
 *   5. 空名兜底 → `unnamed`；
 *   6. 超长截断（保护扩展名：先切 base/ext，截 base 再拼回 ext）。
 *
 * @param {string} name 原始名称（可含非法字符）
 * @returns {string} 安全的磁盘名称
 */
export function sanitizeSegment(name) {
  const maxLen = config.upload.maxSegmentLength || 120;
  let s = String(name ?? '');
  s = s.replace(WINDOWS_ILLEGAL_RE, '_').replace(CONTROL_CHARS_RE, '');
  s = s.replace(/^[\s\u00a0]+/, '').replace(/[\s\u00a0.]+$/, '');
  if (!s) return 'unnamed';
  if (WINDOWS_RESERVED_RE.test(s)) s = `_${s}`;

  // 长度截断（保护扩展名）
  if (s.length > maxLen) {
    const ext = pickExt(s);
    const base = ext ? s.slice(0, s.length - ext.length) : s;
    const keepExt = ext.length < maxLen ? ext : '';
    const keepBase = Math.max(1, maxLen - keepExt.length);
    s = base.slice(0, keepBase) + keepExt;
  }
  // 截断后可能再次出现结尾空格/句点，再清一次
  s = s.replace(/[\s\u00a0.]+$/, '');
  return s || 'unnamed';
}

/**
 * 解析「绝对路径长度」校验。超限抛友好错误，绝不写坏磁盘。
 * @param {string} absPath 绝对路径
 */
function assertPathLength(absPath) {
  const max = config.upload.maxAbsPath || 240;
  if (absPath.length > max) {
    throw new Error('路径过长，请减少文件夹层级或缩短名称');
  }
}

/**
 * 由 DB 文件夹树解析出「相对磁盘路径」的段数组（不含 uploads 根）。
 * 例：folder(id=7, name='2026版') → ['质量体系','手册','2026版']；根目录 → []。
 * 使用 disk_name || name（disk_name 为空的历史行回落到 name）。
 *
 * @param {number|null} folderId 文件夹 id（null/0 = 根）
 * @param {object} [client] 可选的事务 client（保证读到同事务内的最新层级）
 * @returns {Promise<string[]>} 根→叶 的原始段名数组（尚未 sanitize）
 */
async function resolveFolderSegments(folderId, client) {
  if (!folderId) return [];
  const q = client || { query };
  const res = await q.query(
    `WITH RECURSIVE up AS (
        SELECT id, parent_id, COALESCE(disk_name, name) AS seg, 0 AS depth
          FROM drive_folder WHERE id = $1
        UNION ALL
        SELECT p.id, p.parent_id, COALESCE(p.disk_name, p.name), up.depth + 1
          FROM drive_folder p JOIN up ON up.parent_id = p.id
     )
     SELECT seg FROM up ORDER BY depth DESC`,
    [folderId]
  );
  return res.rows.map(r => r.seg).filter(Boolean);
}

/**
 * 计算某文件夹相对 uploads 根的磁盘目录（绝对路径），并在必要时创建。
 * @param {number|null} folderId
 * @param {object} [client]
 * @returns {Promise<string>} 绝对目录路径
 */
async function ensureFolderDirAbs(folderId, client) {
  const raw = await resolveFolderSegments(folderId, client);
  const segments = raw.map(sanitizeSegment);
  const abs = path.join(config.upload.dir, ...segments);
  assertPathLength(abs);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * 由「文件夹 id + 磁盘文件名」解析出落盘绝对路径。
 * @param {number|null} folderId
 * @param {string} diskName 磁盘文件名（已 sanitize）
 * @param {object} [client]
 * @returns {Promise<string>}
 */
async function resolveAbsPath(folderId, diskName, client) {
  const raw = await resolveFolderSegments(folderId, client);
  const segments = raw.map(sanitizeSegment);
  const abs = path.join(config.upload.dir, ...segments, diskName);
  assertPathLength(abs);
  return abs;
}

function badRelPath(msg = '非法的文件路径') {
  return Object.assign(new Error(msg), { statusCode: 400 });
}

/**
 * 把相对路径解析为 uploads 根下的绝对路径，并拒绝任何逃逸尝试。
 *
 * 安全背景（F-01 P0）：历史上这里直接 path.join，`../../server/.env` 会被解析到
 * uploads 之外；公共盘上传接口把用户传入的 tempRelPath 交给本函数后 rename，
 * 等价于「任意文件搬运 + 下载」。因此所有相对路径入口都必须经过本函数：
 *   · 拒绝 `..` 段（原文与 URL 解码后各查一次，防 %2e%2e%2f 变体）
 *   · 拒绝绝对路径 / 盘符（`/x`、`C:x`、`\\server\share`）
 *   · 解析后必须仍在 uploads 根内（双保险，防路径规范化/盘符改写绕过）
 * @param {string} relPath file_path 列的值（相对 uploads 根）
 * @returns {string} 绝对路径
 */
export function absFromRel(relPath) {
  const raw = String(relPath || '');
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* 非法百分号编码：保留原文继续校验 */ }

  for (const s of [raw, decoded]) {
    const norm = s.replace(/\\/g, '/');
    if (/^[a-zA-Z]:/.test(norm) || norm.startsWith('/')) throw badRelPath();
    if (norm.split('/').some(seg => seg === '..')) throw badRelPath();
  }

  const rel = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(config.upload.dir, ...rel.split('/').filter(Boolean));
  const rootAbs = path.resolve(config.upload.dir);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw badRelPath();
  return abs;
}

/**
 * 校验「暂存文件相对路径」：上传接口只把文件写进 `.staging-tmp/`，
 * 落位/覆盖接口必须只接受该目录下的路径，否则登录用户可借 tempRelPath 搬运任意文件。
 * @param {string} relPath
 * @returns {string} 绝对路径
 */
export function assertStagedRel(relPath) {
  const abs = absFromRel(relPath); // 内含 .. / 绝对路径 / 越根校验
  const stagingDir = path.resolve(config.upload.dir, '.staging-tmp');
  if (!abs.startsWith(stagingDir + path.sep)) throw badRelPath('非法的临时文件路径');
  return abs;
}

/** 某相对路径对应的物理文件是否存在于磁盘 */
export function physicalExists(relPath) {
  try { return !!relPath && fs.existsSync(absFromRel(relPath)); } catch { return false; }
}

/**
 * 上传前置：为「目标文件夹 + 原始文件名」准备落盘位置。
 *
 * 语义：name（界面名）与 disk_name（磁盘名）在用户未输入非法字符时应完全一致；
 *       仅当 sanitize 改写过或目录内重名加后缀时才产生差异。
 * 重名判定口径 = 该目录下现存文件记录（未删除）；命中则由调用方（addFile，持锁）追加 `(1)`。
 *
 * @param {number|null} folderId 目标文件夹
 * @param {string} fileName 原始文件名（含扩展名）
 * @returns {Promise<{segments:string[], diskName:string, segment:string, dirAbs:string}>}
 */
export async function resolveUploadPath(folderId, fileName) {
  const raw = await resolveFolderSegments(folderId);
  const segments = raw.map(sanitizeSegment);
  const diskName = sanitizeSegment(fileName);
  const dirAbs = path.join(config.upload.dir, ...segments);
  assertPathLength(path.join(dirAbs, diskName));
  return { segments, diskName, segment: diskName, dirAbs };
}

/**
 * 计算「暂存源文件」的绝对路径（先写临时名 → 再在锁内 rename 为最终名）。
 * 落在 uploads 根下的 `.staging-tmp/`：与最终路径同盘，rename 为原子操作。
 * @param {string} ext 扩展名（含点，可为 ''）
 * @returns {string}
 */
export function stagingTempAbs(ext = '') {
  const dir = path.join(config.upload.dir, '.staging-tmp');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
}

/**
 * 删除物理文件（按相对路径）。容错：文件不存在不抛错；失败仅告警。
 * @param {string} relPath
 * @returns {boolean} 是否确实删除了文件
 */
export function unlinkPhysicalSafe(relPath) {
  try {
    const abs = absFromRel(relPath);
    if (fs.existsSync(abs)) { fs.unlinkSync(abs); return true; }
  } catch (err) {
    console.warn('[drive] 删除物理文件失败：', err.message);
  }
  return false;
}

/**
 * 移动物理文件（相对路径 → 相对路径），自动创建目标目录。
 * 跨盘（EXDEV）时回落到 copyFile + unlink。
 * @param {string} srcRel
 * @param {string} dstRel
 * @returns {boolean} 是否发生了移动
 */
export function movePhysical(srcRel, dstRel) {
  const src = absFromRel(srcRel);
  const dst = absFromRel(dstRel);
  if (src === dst) return false;
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(src, dst);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
  return true;
}

/**
 * 递归移动物理目录（跨盘兜底 copyFile + unlink）。
 * @param {string} srcAbs
 * @param {string} dstAbs
 * @returns {boolean} 是否发生了移动
 */
export function movePhysicalDir(srcAbs, dstAbs) {
  if (!srcAbs || !dstAbs || srcAbs === dstAbs) return false;
  if (!fs.existsSync(srcAbs)) return false;
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  try {
    renameWithRetry(srcAbs, dstAbs);
    return true;
  } catch (err) {
    // EXDEV：跨盘；EPERM/EBUSY：Windows 目录瞬时锁 —— 一律回落到「递归复制 + 删源」兜底
    if (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
      copyDirRecursiveSync(srcAbs, dstAbs);
      rmWithRetry(srcAbs);
      return true;
    }
    throw err;
  }
}

/** 递归删除（带重试，应对 Windows 瞬时锁） */
function rmWithRetry(abs) {
  const delays = [0, 50, 150, 400];
  let lastErr;
  for (const ms of delays) {
    try {
      if (ms) sleepSync(ms);
      fs.rmSync(abs, { recursive: true, force: true });
      return;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/**
 * Windows 下目录 rename 偶发 EPERM/EBUSY（杀软/索引/句柄瞬时占用）→ 短暂重试。
 * @param {string} src
 * @param {string} dst
 */
function renameWithRetry(src, dst) {
  const delays = [0, 30, 80, 200, 400];
  let lastErr;
  for (const ms of delays) {
    try {
      if (ms) sleepSync(ms);
      fs.renameSync(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
    }
  }
  throw lastErr;
}

/** 同步休眠（毫秒）：Node 无内置同步 sleep，用 Atomics.wait 实现，不阻塞事件循环以外的线程 */
function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

/** 递归复制目录（内容级；不复制空目录以外的属性） */
function copyDirRecursiveSync(srcAbs, dstAbs) {
  fs.mkdirSync(dstAbs, { recursive: true });
  for (const ent of fs.readdirSync(srcAbs, { withFileTypes: true })) {
    const s = path.join(srcAbs, ent.name);
    const d = path.join(dstAbs, ent.name);
    if (ent.isDirectory()) copyDirRecursiveSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 判断某用户对某文件夹是否拥有某种能力 */
function can(perm, folder, user) {
  if (!folder) return false;
  if (user.isAdmin) return true;
  if (folder.owner_id === user.id) return true;
  return !!folder[perm]; // folder 已带 acl 字段（本用户在该文件夹上的权限行）
}

/** 列出根目录（顶层文件夹 + 根级文件暂不支持，文件必须挂在文件夹下） */
export async function listRoot(user) {
  // 顶层文件夹：owner 是自己的、admin 全部、或 ACL 授权了 can_read 的
  const folders = await many(
    `SELECT f.*, a.can_read, a.can_edit, a.can_upload, a.can_delete, a.can_create,
            u.real_name AS owner_name,
            uc.username AS created_by_username, uc.real_name AS created_by_name,
            ub.username AS updated_by_username, ub.real_name AS updated_by_name
       FROM drive_folder f
       LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $1
       LEFT JOIN org_user u ON u.id = f.owner_id
       LEFT JOIN org_user uc ON uc.id = f.created_by
       LEFT JOIN org_user ub ON ub.id = f.updated_by
      WHERE f.parent_id IS NULL AND f.deleted_at IS NULL
        AND (f.owner_id = $1 OR $2 OR a.can_read = TRUE)
      ORDER BY f.name`,
    [user.id, user.isAdmin]
  );
  return folders;
}

/** 列出某文件夹的内容：子文件夹 + 文件，并返回当前用户在该文件夹的权限 */
export async function listFolder(folderId, user) {
  const folder = await one(
    `SELECT f.*, a.can_read, a.can_edit, a.can_upload, a.can_delete, a.can_create,
            u.real_name AS owner_name,
            uc.username AS created_by_username, uc.real_name AS created_by_name,
            ub.username AS updated_by_username, ub.real_name AS updated_by_name
       FROM drive_folder f
       LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $2
       LEFT JOIN org_user u ON u.id = f.owner_id
       LEFT JOIN org_user uc ON uc.id = f.created_by
       LEFT JOIN org_user ub ON ub.id = f.updated_by
      WHERE f.id = $1 AND f.deleted_at IS NULL`,
    [folderId, user.id]
  );
  if (!folder) throw new Error('文件夹不存在');
  // S7 修复：读取权限须走 ACL 继承（effectiveAcl），而非仅看本行 ACL
  const eff = await effectiveAcl(folderId, user);
  if (!eff.canRead) {
    const err = new Error('您没有该文件夹的访问权限');
    err.statusCode = 403;
    throw err;
  }

  const rawSubfolders = await many(
    `SELECT f.*, a.can_read, a.can_edit, a.can_upload, a.can_delete, a.can_create,
            u.real_name AS owner_name,
            uc.username AS created_by_username, uc.real_name AS created_by_name,
            ub.username AS updated_by_username, ub.real_name AS updated_by_name
       FROM drive_folder f
       LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $2
       LEFT JOIN org_user u ON u.id = f.owner_id
       LEFT JOIN org_user uc ON uc.id = f.created_by
       LEFT JOIN org_user ub ON ub.id = f.updated_by
      WHERE f.parent_id = $1 AND f.deleted_at IS NULL
      ORDER BY f.name`,
    [folderId, user.id]
  );
  // 子文件夹按「有效读权限」过滤（子默认继承父，除非被显式中断/拒绝）
  const subfolders = [];
  for (const sf of rawSubfolders) {
    if (user.isAdmin || sf.owner_id === user.id) { subfolders.push(sf); continue; }
    const sfEff = await effectiveAcl(sf.id, user);
    if (sfEff.canRead) subfolders.push(sf);
  }

  const files = await many(
    `SELECT df.*, u.real_name AS uploader_name, u.username AS uploader_username,
            ub.username AS updated_by_username, ub.real_name AS updated_by_name
       FROM drive_file df
       LEFT JOIN org_user u ON u.id = df.uploaded_by
       LEFT JOIN org_user ub ON ub.id = df.updated_by
      WHERE df.folder_id = $1 AND df.deleted_at IS NULL ORDER BY df.name`,
    [folderId]
  );

  return {
    folder,
    perm: {
      canRead: eff.canRead,
      canEdit: eff.canEdit,
      canUpload: eff.canUpload,
      canDelete: eff.canDelete,
      canCreate: eff.canCreate,
      canGrant: eff.canGrant,
      isOwner: folder.owner_id === user.id || user.isAdmin,
    },
    subfolders,
    files,
  };
}

/** 面包屑 */
export async function breadcrumb(folderId) {
  const chain = [];
  let cur = folderId;
  while (cur) {
    const f = await one(`SELECT id, parent_id, name FROM drive_folder WHERE id = $1`, [cur]);
    if (!f) break;
    chain.unshift({ id: f.id, name: f.name });
    cur = f.parent_id;
  }
  return chain;
}

/**
 * 新建文件夹。
 *
 * 【并发/重名 · QA 缺陷 G14】
 *   原实现是裸 `INSERT INTO drive_folder ...`：既不同名去重，也不持目录咨询锁，
 *   并发（或连点两次）会建出两个同名同级目录；而 DB 侧也没有 UNIQUE(parent_id,name) 兜底。
 *   现改为与 addFile / renameFolder / copyFolder 完全相同的范式：
 *     事务 + `pg_advisory_xact_lock(ADV_DRIVE_COPY, parentId||0)` + `uniqueName('folder', ...)`
 *   保证同一目录下的名称分配串行化，重名自动编号为 `名称(1)`（与上传冲突惯例一致），
 *   disk_name 与最终 name 同步（磁盘只是 DB 树的投影）。
 *   纵深防御：sql/131 迁移另加 UNIQUE 索引（parent_id,name / 根目录 name），
 *   正常路径不会触发 23505；真触发也只会是 409「数据已存在，请勿重复提交」。
 *
 * 语义变化（需知会前端）：同名创建从「静默产生重复目录」改为「返回自动编号后的名字」，
 * 返回体仍是插入行，前端按 `r.name` 展示即为最终名。
 */
export async function createFolder({ parentId, name }, user) {
  if (!name || !name.trim()) throw new Error('请填写文件夹名称');
  let parent = null;
  if (parentId) {
    parent = await one(
      `SELECT f.*, a.can_create FROM drive_folder f
        LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $2
       WHERE f.id = $1`,
      [parentId, user.id]
    );
    if (!parent) throw new Error('父文件夹不存在');
    if (!can('can_create', parent, user) && !(await canEffective('canCreate', parentId, user))) {
      const err = new Error('您没有在该文件夹下新建子文件夹的权限');
      err.statusCode = 403;
      throw err;
    }
  }
  const scope = parentId ? Number(parentId) : null;
  const trimmed = name.trim();
  return transaction(async client => {
    // 与 addFile/renameFolder 同键：按目标目录串行化名称分配
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, scope || 0]);
    const finalName = await uniqueName('folder', scope, trimmed, { style: 'numbered', client });
    // 与 renameFolder 同一口径：磁盘段名 = sanitizeSegment(最终界面名)，保证 name↔disk 一一对应
    // （不用 diskNameForName —— 那套为「文件名带扩展名」设计，遇到 `v1.2` 这类含点目录名会算偏）
    const disk = sanitizeSegment(finalName);
    const r = (await client.query(
      `INSERT INTO drive_folder (parent_id, name, disk_name, owner_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$4,$4) RETURNING *`,
      [scope, finalName, disk, user.id]
    )).rows[0];
    return r;
  });
}

/**
 * 重命名文件夹。
 *
 * 层级化存储改造：
 *   1. 先按同目录去重规则确定新 name（`名称(1)`），并同步确定新 disk_name（本层段名）；
 *   2. 在事务内：仅更新自身 name/disk_name。子孙文件夹的 `disk_name` 存的是「本层段名」，
 *      改名不改前缀 → 子孙段名天然不动，无需改动；
 *      但它们下所有文件的 `file_path` 前缀变了 → 一次 `replace()` UPDATE 重写前缀；
 *   3. 事务提交后：`fs.rename` 整个磁盘目录（旧路径 → 新路径）。
 *
 * 说明：`disk_name` 始终只存本层段名（不含路径），因此改名/移动不会对子孙段名做二次 sanitize，
 *       避免长名被反复截断而损坏。
 */
export async function renameFolder(folderId, name, user) {
  if (!name || !name.trim()) throw new Error('请填写名称');
  const f = await getFolderWithPerm(folderId, user);
  if (!f) throw new Error('文件夹不存在');
  if (!can('can_edit', f, user) && !(await canEffective('canEdit', folderId, user))) {
    const err = new Error('您没有重命名的权限');
    err.statusCode = 403;
    throw err;
  }
  const trimmed = name.trim();
  const newSelfDisk = sanitizeSegment(trimmed);

  // 先算出「旧相对路径」（改名前），供磁盘 rename 用
  const oldSegments = (await resolveFolderSegments(folderId)).map(sanitizeSegment);
  const oldRel = posix.join(...oldSegments);
  const parentSegments = (await resolveFolderSegments(f.parent_id)).map(sanitizeSegment);
  assertPathLength(path.join(config.upload.dir, ...parentSegments, newSelfDisk));

  // 最终落盘段名（uniqueName 去重后可能变化）与相对路径，事务内外共用
  let finalDisk = newSelfDisk;
  let newRel = posix.join(...parentSegments, newSelfDisk);

  const finalName = await transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, f.parent_id || 0]);
    const fn = await uniqueName('folder', f.parent_id, trimmed, { style: 'numbered', client, excludeId: folderId });
    const disk = sanitizeSegment(fn);
    finalDisk = disk;
    newRel = posix.join(...parentSegments, disk);

    // 更新自身：name（界面名）+ disk_name（磁盘段名）
    await client.query(
      `UPDATE drive_folder SET name = $2, disk_name = $3, updated_by = $4, updated_at = now() WHERE id = $1`,
      [folderId, fn, disk, user.id]
    );
    // 子孙文件夹：disk_name 存「本层段名」，改名不改前缀 → 子孙段名天然不动，无需改动。
    //   仅需重写这些文件夹下所有文件的 file_path 前缀（一次 UPDATE 完成）。
    if (oldRel && newRel !== oldRel) {
      await client.query(
        `UPDATE drive_file
            SET file_path = replace(file_path, $1, $2)
          WHERE file_path LIKE $3`,
        [`${oldRel}/`, `${newRel}/`, `${oldRel}/%`]
      );
    }
    return fn;
  });

  // 事务提交后做物理 rename（磁盘是 DB 的投影：DB 先改，物理后跟；失败可由重建脚本修复）
  if (oldRel !== newRel) {
    try {
      const oldAbs = path.join(config.upload.dir, ...oldSegments);
      const newAbs = path.join(config.upload.dir, ...parentSegments, finalDisk);
      movePhysicalDir(oldAbs, newAbs);
    } catch (err) {
      console.warn('[drive] 文件夹改名物理移动失败（可跑 rebuild-drive-layout 修复）：', err.message);
    }
  }
  return { name: finalName };
}

/** 删除文件夹（软删除进回收站：递归标记子文件夹与文件；保留 file_path 以免误删物理文件） */
export async function deleteFolder(folderId, user) {
  const f = await getFolderWithPerm(folderId, user);
  if (!f) throw new Error('文件夹不存在');
  if (!can('can_delete', f, user) && !(await canEffective('canDelete', folderId, user))) {
    const err = new Error('您没有删除该文件夹的权限');
    err.statusCode = 403;
    throw err;
  }
  // 递归收集子孙文件夹 id（仅未删除的）
  const descendants = await many(
    `WITH RECURSIVE sub AS (
        SELECT id FROM drive_folder WHERE id = $1
        UNION ALL
        SELECT c.id FROM drive_folder c JOIN sub s ON c.parent_id = s.id
         WHERE c.deleted_at IS NULL
     )
     SELECT id FROM sub`,
    [folderId]
  );
  const ids = descendants.map(r => r.id);
  await transaction(async client => {
    // 标记子孙文件夹（含自身）；仅记录尚未删除者的原位置
    await client.query(
      `UPDATE drive_folder
          SET deleted_at = COALESCE(deleted_at, now()),
              deleted_by = $2,
              orig_folder_id = COALESCE(orig_folder_id, parent_id)
        WHERE id = ANY($1::bigint[])`,
      [ids, user.id]
    );
    // 标记这些文件夹下的文件
    await client.query(
      `UPDATE drive_file
          SET deleted_at = COALESCE(deleted_at, now()),
              deleted_by = $2,
              orig_folder_id = COALESCE(orig_folder_id, folder_id)
        WHERE folder_id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [ids, user.id]
    );
  });
  await logAudit({ userId: user.id, action: 'delete', targetType: 'folder', targetId: folderId, targetName: f.name, detail: { folderCount: ids.length } });
  return true;
}

/**
 * 新增文件记录（上传落库）。
 *
 * 修复（P2）：原实现直接 INSERT，无同目录去重 → 并发/串行上传同名文件会产生多行同名记录。
 * 现改为：事务 + `pg_advisory_xact_lock(91, folderId)` 内选定唯一名后插入。
 * 命名风格：`名称(1).ext`（保留扩展名），与系统"上传冲突"惯例一致（区别于复制用的「- 副本」）。
 *
 * 层级化存储改造（用户口径 2026-10-12）：
 *   - 调用方（上传路由）已把文件写到磁盘的**临时名**（tempRelPath），并把期望的磁盘名
 *     （diskName，已 sanitize）与界面名（fileName，用户原文）一并传入；
 *   - 本函数在持锁事务内：`uniqueName` 决定最终**界面名** name；据此派生最终**磁盘名** disk_name
 *     （用户原文无非法字符时二者一致；若 uniqueName 追加了 `(1)` 后缀，则 disk 同步追加）；
 *   - 事务提交后：把临时物理文件 `fs.renameSync` 到最终路径（DB file_path / disk_name 指向处），
 *     实现「先写临时名、锁内定名、再原子更名」，从根上杜绝并发撞名。
 *
 * @param {{folderId:number|null, fileName:string, diskName?:string, filePath?:string, tempRelPath?:string, fileSize:number, mimeType:string}} p
 * @returns {Promise<object>} 新插入的 drive_file 行（含最终使用的 name / disk_name / file_path）
 */
export async function addFile({ folderId, fileName, diskName, filePath, tempRelPath, fileSize, mimeType }, user) {
  const f = await getFolderWithPerm(folderId, user);
  if (!can('can_upload', f, user) && !(await canEffective('canUpload', folderId, user))) {
    const err = new Error('您没有在该文件夹上传文件的权限');
    err.statusCode = 403;
    throw err;
  }
  // F-01：用户可传的相对路径必须先校验（落库/rename 之前），非法路径一律 400。
  // 兼容分支 filePath 同样只接受暂存目录，否则可把 uploads 内任意他人文件 rename 走。
  if (tempRelPath) assertStagedRel(tempRelPath);
  else if (filePath) assertStagedRel(filePath);

  const rawName = String(fileName || '').trim() || 'unnamed';
  const segments = (await resolveFolderSegments(folderId)).map(sanitizeSegment);
  const dirRel = posix.join(...segments);
  // 磁盘名：优先用调用方传入（已 sanitize），否则自行 sanitize
  const wantedDisk = sanitizeSegment(diskName || rawName);

  const result = await transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, folderId || 0]);
    const finalName = await uniqueName('file', folderId, rawName, { style: 'numbered', client });
    // 使界面名与磁盘名一致：仅当 uniqueName 追加了后缀时，磁盘名同步追加同一后缀。
    const disk = diskNameForName(rawName, finalName, wantedDisk);
    const finalRel = posix.join(dirRel, disk);
    assertPathLength(path.join(config.upload.dir, ...segments, disk));
    const row = (await client.query(
      `INSERT INTO drive_file (folder_id, name, disk_name, file_path, file_size, mime_type, uploaded_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [folderId, finalName, disk, finalRel, fileSize || 0, mimeType || null, user.id]
    )).rows[0];
    return row;
  });

  // 物理落盘：临时文件 → 最终路径（同盘 rename，原子）。若未提供临时文件（如内部调用），
  // 且提供了 filePath（历史语义），则保持兼容（不搬运）。
  if (tempRelPath && result.file_path) {
    try {
      const srcAbs = absFromRel(tempRelPath);
      const dstAbs = absFromRel(result.file_path);
      if (srcAbs !== dstAbs) {
        fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
        if (fs.existsSync(srcAbs)) fs.renameSync(srcAbs, dstAbs);
      }
    } catch (err) {
      console.warn('[drive] 上传物理落盘失败：', err.message);
    }
  } else if (filePath && result.file_path !== filePath) {
    // 兼容：调用方给了 filePath 但没给临时文件 → 尝试按 filePath 归位
    try { movePhysical(filePath, result.file_path); } catch { /* 忽略 */ }
  }

  await logAudit({ userId: user.id, action: 'upload', targetType: 'file', targetId: result.id, targetName: result.name, detail: { folderId, diskName: result.disk_name } });
  return result;
}

/**
 * 依据「原始名 → 最终界面名」推导磁盘名，保持两者尽量一致。
 * 若最终名 = 原名（无重名）→ 直接 sanitize(原名)；
 * 若最终名 = 原名 + 后缀（`base(1).ext`）→ 在已 sanitize 的原名基础上，对 base 段追加同一后缀。
 * @param {string} rawName 用户原始名
 * @param {string} finalName uniqueName 给出的最终界面名
 * @param {string} wantedDisk 已 sanitize 的原始磁盘名（含扩展名）
 * @returns {string}
 */
function diskNameForName(rawName, finalName, wantedDisk) {
  if (finalName === rawName) return wantedDisk;
  const fe = pickExt(finalName);
  const fbase = fe ? finalName.slice(0, finalName.length - fe.length) : finalName;
  const we = pickExt(wantedDisk);
  const wbase = we ? wantedDisk.slice(0, wantedDisk.length - we.length) : wantedDisk;
  // 后缀 = 最终名 base 相对原始名 base 多出的部分（如 `(1)` / ` - 副本(2)`）
  const rb = pickExt(rawName);
  const rbase = rb ? rawName.slice(0, rawName.length - rb.length) : rawName;
  const suffix = fbase.startsWith(rbase) ? fbase.slice(rbase.length) : '';
  const combined = `${wbase}${suffix}${we}`;
  return combined.length <= (config.upload.maxSegmentLength || 120) ? combined : wantedDisk;
}

/**
 * 用新上传的文件替换已有文件的内容（「本地编辑后保存回公共盘」）。
 * 权限：管理员 / 文件夹 owner / 上传者本人 / 对该文件夹有 canEdit 或 canUpload。
 * 说明：直接覆盖当前内容（不生成版本），并记录最后更新人与更新时间。
 */
export async function replaceFileContent(fileId, { filePath, fileSize, mimeType }, user) {
  if (!filePath) throw new Error('缺少文件内容');
  // F-01：覆盖内容只接受「暂存目录」下的路径，杜绝借 filePath 搬运服务器任意文件
  assertStagedRel(filePath);
  const file = await one(`SELECT * FROM drive_file WHERE id = $1 AND deleted_at IS NULL`, [fileId]);
  if (!file) throw new Error('文件不存在');

  const folder = await getFolderWithPerm(file.folder_id, user);
  let allowed = user.isAdmin
    || (folder && folder.owner_id === user.id)
    || (file.uploaded_by != null && file.uploaded_by === user.id);
  if (!allowed) {
    allowed = (await canEffective('canEdit', file.folder_id, user))
      || (await canEffective('canUpload', file.folder_id, user));
  }
  if (!allowed) throw forbid('您没有保存该文件的权限');

  // 覆盖内容时，保持磁盘名与界面名不变（同一条记录就地替换），disk_name 沿用现值（为空则按 name 兜底补算）。
  const disk = file.disk_name || sanitizeSegment(file.name || 'unnamed');
  const dirSegments = (await resolveFolderSegments(file.folder_id)).map(sanitizeSegment);
  const finalRel = posix.join(...dirSegments, disk);
  assertPathLength(path.join(config.upload.dir, ...dirSegments, disk));

  const r = await one(
    `UPDATE drive_file
        SET disk_name = COALESCE(disk_name, $6), file_path = $2, file_size = $3,
            mime_type = COALESCE($4, mime_type), updated_by = $5, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [fileId, finalRel, fileSize || 0, mimeType || null, user.id, disk]
  );
  // 兼容旧路径：若调用方给的是临时路径且与最终路径不同，则搬运物理文件
  if (filePath && filePath !== finalRel) {
    try { movePhysical(filePath, finalRel); } catch { /* 忽略 */ }
  }
  await logAudit({
    userId: user.id, action: 'update', targetType: 'file', targetId: fileId,
    targetName: file.name, detail: { folderId: file.folder_id, size: fileSize || 0, mode: 'replace-content' },
  });
  return r;
}

/**
 * 单个文件 / 文件夹的最新元数据（属性面板专用）。
 * 直接从库中读取，保证展示的「大小 / 创建人 / 最后更新人 / 时间」都是当前真实值，
 * 不依赖列表页可能已经过期的内存数据。
 * @param {'file'|'folder'} type
 */
export async function getItemMeta(type, id, user) {
  if (!id) throw new Error('缺少标识');
  if (type === 'file') {
    const f = await one(
      `SELECT df.*,
              uc.username AS uploader_username, uc.real_name AS uploader_name,
              ub.username AS updated_by_username, ub.real_name AS updated_by_name
         FROM drive_file df
         LEFT JOIN org_user uc ON uc.id = df.uploaded_by
         LEFT JOIN org_user ub ON ub.id = df.updated_by
        WHERE df.id = $1 AND df.deleted_at IS NULL`,
      [id]
    );
    if (!f) throw new Error('文件不存在');
    const canRead = user.isAdmin
      || (f.uploaded_by != null && f.uploaded_by === user.id)
      || (await canEffective('canRead', f.folder_id, user));
    if (!canRead) throw forbid('您没有查看该文件的权限');
    return f;
  }

  const f = await one(
    `SELECT d.*,
            uc.username AS created_by_username, uc.real_name AS created_by_name,
            ub.username AS updated_by_username, ub.real_name AS updated_by_name
       FROM drive_folder d
       LEFT JOIN org_user uc ON uc.id = d.created_by
       LEFT JOIN org_user ub ON ub.id = d.updated_by
      WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [id]
  );
  if (!f) throw new Error('文件夹不存在');
  // 与 listRoot 的可见性口径保持一致：管理员 / owner / 有效读权限
  const canRead = user.isAdmin
    || (f.owner_id != null && f.owner_id === user.id)
    || (await canEffective('canRead', id, user));
  if (!canRead) throw forbid('您没有查看该文件夹的权限');
  return f;
}

/** 删除文件（软删除进回收站） */
export async function deleteFile(fileId, user) {
  const file = await one(
    `SELECT df.*, f.owner_id, a.can_delete
       FROM drive_file df
       JOIN drive_folder f ON f.id = df.folder_id
       LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $2
      WHERE df.id = $1`,
    [fileId, user.id]
  );
  if (!file) throw new Error('文件不存在');
  if (!(user.isAdmin || file.owner_id === user.id || file.can_delete)) {
    const err = new Error('您没有删除该文件的权限');
    err.statusCode = 403;
    throw err;
  }
  await query(
    `UPDATE drive_file
        SET deleted_at = COALESCE(deleted_at, now()),
            deleted_by = $2,
            orig_folder_id = COALESCE(orig_folder_id, folder_id)
      WHERE id = $1`,
    [fileId, user.id]
  );
  await logAudit({ userId: user.id, action: 'delete', targetType: 'file', targetId: fileId, targetName: file.name, detail: { folderId: file.folder_id } });
  return true;
}

/**
 * 重命名文件（编辑更新）。
 *
 * 层级化存储改造：
 *   - name（界面名）与 disk_name（磁盘名）同步更新（用户原文无非法字符时二者一致）；
 *   - 事务提交后 `fs.rename` 物理文件（旧 file_path → 新 file_path）。
 */
export async function renameFile(fileId, name, user) {
  if (!name || !name.trim()) throw new Error('请填写名称');
  const file = await one(
    `SELECT df.*, f.owner_id, a.can_edit
       FROM drive_file df
       JOIN drive_folder f ON f.id = df.folder_id
       LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $2
      WHERE df.id = $1`,
    [fileId, user.id]
  );
  if (!file) throw new Error('文件不存在');
  if (!(user.isAdmin || file.owner_id === user.id || file.can_edit)) {
    const err = new Error('您没有重命名该文件的权限');
    err.statusCode = 403;
    throw err;
  }
  const trimmed = name.trim();
  const segments = (await resolveFolderSegments(file.folder_id)).map(sanitizeSegment);

  const result = await transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, file.folder_id || 0]);
    const fn = await uniqueName('file', file.folder_id, trimmed, { style: 'numbered', client, excludeId: fileId });
    const wantedDisk = sanitizeSegment(trimmed);
    const disk = diskNameForName(trimmed, fn, wantedDisk);
    const newRel = posix.join(...segments, disk);
    assertPathLength(path.join(config.upload.dir, ...segments, disk));
    await client.query(
      `UPDATE drive_file SET name = $2, disk_name = $3, file_path = $4, updated_by = $5, updated_at = now()
        WHERE id = $1`,
      [fileId, fn, disk, newRel, user.id]
    );
    return { name: fn, filePath: newRel };
  });

  // 物理改名
  if (file.file_path && result.filePath && file.file_path !== result.filePath) {
    try { movePhysical(file.file_path, result.filePath); } catch (err) {
      console.warn('[drive] 文件改名物理移动失败（可跑 rebuild-drive-layout 修复）：', err.message);
    }
  }
  await logAudit({ userId: user.id, action: 'rename', targetType: 'file', targetId: fileId, targetName: result.name, detail: { folderId: file.folder_id } });
  return { name: result.name };
}

/* ============================================================
 * 权限管理（含「可授权」委派）
 *   - 管理员 / 文件夹所有者：始终可管理权限
 *   - 被授予「可授权」(can_grant) 的用户：可在该文件夹及其子树内授权
 *   - 防提权：非所有者只能授出自己拥有的能力，且只能改自己授予的记录
 * ============================================================ */

/** 权限管理：列出 ACL（admin / owner / 被授予 canGrant 者） */
export async function listAcl(folderId, user) {
  const f = await getFolderWithPerm(folderId, user);
  if (!f) throw new Error('文件夹不存在');
  const isOwner = user.isAdmin || f.owner_id === user.id;
  const eff = await effectiveAcl(folderId, user);
  if (!isOwner && !eff.canGrant) {
    const err = new Error('只有文件夹所有者、管理员或被授予「可授权」的用户可以管理权限');
    err.statusCode = 403;
    throw err;
  }
  const list = await many(
    `SELECT a.*, u.real_name, u.username, u.department_id, d.name AS dept_name, d.name_en AS dept_name_en,
            g.real_name AS granted_by_name
       FROM drive_acl a
       LEFT JOIN org_user u ON u.id = a.user_id
       LEFT JOIN org_department d ON d.id = COALESCE(a.dept_id, u.department_id)
       LEFT JOIN org_user g ON g.id = a.granted_by
      WHERE a.folder_id = $1 ORDER BY u.real_name`,
    [folderId]
  );
  const rows = list.map((r) => ({
    ...r,
    can_grant: !!r.can_grant,
    // 非所有者只能操作自己授予的记录（owner/admin 可操作全部）
    manageable: isOwner || r.granted_by === user.id,
  }));
  return { list: rows, ownerId: f.owner_id, isOwner, canManage: true, canGrant: isOwner || eff.canGrant };
}

/** 设置某用户权限（含「可授权」开关） */
export async function setAcl(folderId, acl, user) {
  const f = await getFolderWithPerm(folderId, user);
  if (!f) throw new Error('文件夹不存在');
  const isOwner = user.isAdmin || f.owner_id === user.id;
  const eff = await effectiveAcl(folderId, user);
  if (!isOwner && !eff.canGrant) {
    const err = new Error('只有文件夹所有者、管理员或被授予「可授权」的用户可以管理权限');
    err.statusCode = 403;
    throw err;
  }

  const { userId, canRead, canEdit, canUpload, canDelete, canCreate } = acl;
  // inherit（可选）：是否从父文件夹继承权限。传 false 即「显式中断继承」。
  const inherit = acl.inherit === undefined ? true : !!acl.inherit;
  if (!userId) throw new Error('请选择用户');

  const targetId = Number(userId);
  if (!Number.isFinite(targetId)) throw new Error('用户参数不正确');
  if (targetId === f.owner_id) throw new Error('所有者拥有全部权限，无需单独设置');
  if (targetId === user.id) throw new Error('不能给自己授予权限');

  const target = await one(
    `SELECT id, real_name, is_admin, active FROM org_user WHERE id = $1`,
    [targetId]
  );
  if (!target) throw new Error('用户不存在');
  if (!target.active) throw new Error('该用户已停用');
  if (target.is_admin) throw new Error('系统管理员默认拥有全部权限，无需授权');

  // 「全部权限」口径 = 5 项全勾
  const allFive = !!canRead && !!canEdit && !!canUpload && !!canDelete && !!canCreate;
  // 「可授权」：未显式传入时，拥有全部 5 项即默认可授权
  //   ——兼容旧前端（不传 canGrant，但勾满 5 项时应自动获得转授权能力）
  //   新前端显式传 false 时以 false 为准（可给"全部文件权限但不许转授"）。
  const canGrant = acl.canGrant === undefined ? allFive : !!acl.canGrant;

  // 防提权：非 owner/admin 只能授出自己在该文件夹上真正拥有的能力
  if (!isOwner) {
    const checks = [
      ['只读', !!canRead, eff.canRead],
      ['编辑更新', !!canEdit, eff.canEdit],
      ['上传', !!canUpload, eff.canUpload],
      ['删除', !!canDelete, eff.canDelete],
      ['新建子文件夹', !!canCreate, eff.canCreate],
    ];
    const over = checks.filter(([, want, have]) => want && !have).map(([name]) => name);
    if (over.length) throw new Error(`不能授予自己未拥有的权限：${over.join('、')}`);
    if (canGrant && !eff.canGrant) throw new Error('不能授予「可授权」能力：你自己不具备该能力');
  }

  // 非所有者只能修改自己授予的记录（不能覆盖 owner / 其他委派者的授权）
  const exist = await one(
    `SELECT id, granted_by FROM drive_acl WHERE folder_id = $1 AND user_id = $2`,
    [folderId, targetId]
  );
  if (exist && !isOwner && exist.granted_by !== user.id) {
    throw new Error('只能修改自己授予的权限记录');
  }

  if (exist) {
    await query(
      `UPDATE drive_acl
          SET can_read=$2, can_edit=$3, can_upload=$4, can_delete=$5, can_create=$6,
              can_grant=$7, granted_by=$8, inherit=$9
        WHERE id = $1`,
      [exist.id, !!canRead, !!canEdit, !!canUpload, !!canDelete, !!canCreate, canGrant, user.id, inherit]
    );
  } else {
    await query(
      `INSERT INTO drive_acl (folder_id, user_id, can_read, can_edit, can_upload, can_delete, can_create, can_grant, granted_by, inherit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [folderId, targetId, !!canRead, !!canEdit, !!canUpload, !!canDelete, !!canCreate, canGrant, user.id, inherit]
    );
  }

  await logAudit({
    userId: user.id,
    action: exist ? 'acl_update' : 'acl_grant',
    targetType: 'folder',
    targetId: folderId,
    targetName: f.name,
    detail: {
      targetUserId: targetId, targetName: target.real_name,
      canRead: !!canRead, canEdit: !!canEdit, canUpload: !!canUpload,
      canDelete: !!canDelete, canCreate: !!canCreate, canGrant, inherit,
    },
  });
  return true;
}

/** 移除某用户权限（并级联撤销其在子树内转授出去的权限） */
export async function removeAcl(folderId, userId, user) {
  const f = await getFolderWithPerm(folderId, user);
  if (!f) throw new Error('文件夹不存在');
  const isOwner = user.isAdmin || f.owner_id === user.id;
  const eff = await effectiveAcl(folderId, user);
  if (!isOwner && !eff.canGrant) {
    const err = new Error('只有文件夹所有者、管理员或被授予「可授权」的用户可以管理权限');
    err.statusCode = 403;
    throw err;
  }

  const targetId = Number(userId);
  if (!Number.isFinite(targetId)) throw new Error('用户参数不正确');
  const row = await one(
    `SELECT id, granted_by FROM drive_acl WHERE folder_id = $1 AND user_id = $2`,
    [folderId, targetId]
  );
  if (!row) return true; // 幂等：本来就没有权限
  if (!isOwner && row.granted_by !== user.id) {
    throw new Error('只能撤销自己授予的权限');
  }

  await query(`DELETE FROM drive_acl WHERE id = $1`, [row.id]);
  // 级联：本文件夹子树内、由该用户转授出去的下级权限一并失效（递归追溯）
  await cascadeRevoke(folderId, [targetId]);

  await logAudit({
    userId: user.id,
    action: 'acl_remove',
    targetType: 'folder',
    targetId: folderId,
    targetName: f.name,
    detail: { targetUserId: targetId },
  });
  return true;
}

/**
 * 级联撤销：在 folderId 的整棵子树内，删除所有 granted_by ∈ revokedIds 的授权行，
 * 并把被删行的 user_id 作为下一轮 revokedIds 继续追溯，直到没有新的被授权人。
 * 用于「撤销 B 时，B 转授给 C 的权限也一并失效」，避免留下收不回的后门。
 */
async function cascadeRevoke(folderId, revokedIds) {
  let frontier = [...new Set(revokedIds.filter(Boolean))];
  let rounds = 0;
  while (frontier.length && rounds < 20) {
    rounds += 1;
    const removed = await many(
      `WITH RECURSIVE sub AS (
          SELECT id FROM drive_folder WHERE id = $1
          UNION ALL
          SELECT c.id FROM drive_folder c JOIN sub s ON c.parent_id = s.id
       )
       DELETE FROM drive_acl a
         USING sub
        WHERE a.folder_id = sub.id
          AND a.granted_by = ANY($2::bigint[])
        RETURNING a.user_id`,
      [folderId, frontier]
    );
    frontier = [...new Set(removed.map((r) => r.user_id).filter(Boolean))];
  }
}

async function getFolderWithPerm(folderId, user) {
  return one(
    `SELECT f.*, a.can_read, a.can_edit, a.can_upload, a.can_delete, a.can_create, a.can_grant
       FROM drive_folder f
       LEFT JOIN drive_acl a ON a.folder_id = f.id AND a.user_id = $2
      WHERE f.id = $1`,
    [folderId, user.id]
  );
}

/* ============================================================
 * S7 公共盘增强：移动 / 复制 / 回收站 / 权限继承 / 检索 / 分享 / 审计
 * ============================================================ */

/** 抛出 403 业务错误 */
function forbid(msg) {
  const err = new Error(msg);
  err.statusCode = 403;
  return err;
}

/**
 * 权限继承：向上递归父文件夹计算当前用户在某文件夹上的有效权限。
 * 规则：
 *   - 管理员/owner：全部权限；
 *   - 命中本文件夹上针对「本人/本人部门/本人角色」的 ACL：以该行为准；
 *     若该行 inherit=FALSE（显式中断继承），到此为止不再向上；
 *   - 否则若 inherit=TRUE，则继续向上取父文件夹的有效权限（继承）。
 * @param {number} folderId
 * @param {object} user {id, departmentId, roleCode, isAdmin}
 * @returns {Promise<{canRead:boolean,canEdit:boolean,canUpload:boolean,canDelete:boolean,canCreate:boolean,inheritedFrom:number|null}>}
 */
export async function effectiveAcl(folderId, user) {
  const empty = { canRead: false, canEdit: false, canUpload: false, canDelete: false, canCreate: false, canGrant: false, inheritedFrom: null };
  if (!folderId) return empty;

  const folder = await one(`SELECT id, parent_id, owner_id FROM drive_folder WHERE id = $1`, [folderId]);
  if (!folder) return empty;
  if (user.isAdmin || folder.owner_id === user.id) {
    return { canRead: true, canEdit: true, canUpload: true, canDelete: true, canCreate: true, canGrant: true, inheritedFrom: folderId };
  }

  const deptId = user.dept_id || user.departmentId || user.department_id || null;
  const roleCode = user.roleCode || user.role_code || (Array.isArray(user.roles) ? user.roles[0] : null) || null;

  // 本文件夹上命中当前用户维度的 ACL（用户维度优先，其次部门，最后角色）
  const row = await one(
    `SELECT * FROM drive_acl
      WHERE folder_id = $1
        AND (
          (user_id = $2)
          OR (user_id IS NULL AND dept_id IS NOT NULL AND dept_id = $3)
          OR (user_id IS NULL AND dept_id IS NULL AND role_code IS NOT NULL AND role_code = $4)
        )
      ORDER BY (user_id IS NOT NULL) DESC, (dept_id IS NOT NULL) DESC
      LIMIT 1`,
    [folderId, user.id, deptId, roleCode]
  );

  if (row) {
    const granted = {
      canRead: !!row.can_read, canEdit: !!row.can_edit, canUpload: !!row.can_upload,
      canDelete: !!row.can_delete, canCreate: !!row.can_create, canGrant: !!row.can_grant,
      inheritedFrom: folderId,
    };
    // 显式中断继承：直接返回本行权限，不再向上
    if (row.inherit === false) return granted;
    // inherit=TRUE：若本行未授予任何权限，则继续向上继承父权限（合并）
    const anyGranted = row.can_read || row.can_edit || row.can_upload || row.can_delete || row.can_create || row.can_grant;
    if (anyGranted) return granted;
  }

  // 无本层授权 → 向上继承父文件夹
  if (folder.parent_id) {
    const up = await effectiveAcl(folder.parent_id, user);
    if (up.canRead || up.canEdit || up.canUpload || up.canDelete || up.canCreate) {
      return { ...up, inheritedFrom: up.inheritedFrom || folder.parent_id };
    }
  }
  return empty;
}

/** 简易 can 判定：基于 effectiveAcl（供新增功能使用） */
async function canEffective(perm, folderId, user) {
  const acl = await effectiveAcl(folderId, user);
  return !!acl[perm];
}

/** 校验目标文件夹是否是源文件夹本身或其后代（防环） */
async function isDescendant(candidateId, ancestorId) {
  if (!candidateId) return false;
  const r = await one(
    `WITH RECURSIVE sub AS (
        SELECT id FROM drive_folder WHERE id = $1
        UNION ALL
        SELECT c.id FROM drive_folder c JOIN sub s ON c.parent_id = s.id
     )
     SELECT 1 AS x FROM sub WHERE id = $2 LIMIT 1`,
    [ancestorId, candidateId]
  );
  return !!r;
}

/**
 * 移动文件到目标文件夹。
 *
 * 修复（P2）：移入「已存在同名文件」的目录时同样去重（`名称(1).ext`），
 * 与 addFile 共用 uniqueName，避免同目录出现重复名称（I6）。
 *
 * 层级化存储改造：移动后 file_path 指向目标目录；事务提交后物理 `fs.rename`（跨盘兜底）。
 *
 * @param {number} fileId
 * @param {number} targetFolderId
 * @param {object} user
 * @returns {Promise<object>} 更新后的 drive_file 行（含最终使用的 name / file_path）
 */
export async function moveFile(fileId, targetFolderId, user) {
  const file = await one(`SELECT * FROM drive_file WHERE id = $1 AND deleted_at IS NULL`, [fileId]);
  if (!file) throw new Error('文件不存在');
  const src = await getFolderWithPerm(file.folder_id, user);
  if (!can('can_delete', src, user) && !(await canEffective('canDelete', file.folder_id, user))) {
    throw forbid('您没有移动该文件的权限');
  }
  const target = await one(`SELECT * FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`, [targetFolderId]);
  if (!target) throw new Error('目标文件夹不存在');
  if (!(await canEffective('canUpload', targetFolderId, user)) && !(await canEffective('canCreate', targetFolderId, user))) {
    throw forbid('您没有移动到该目标文件夹的权限');
  }
  const targetSegments = (await resolveFolderSegments(targetFolderId)).map(sanitizeSegment);
  const oldRel = file.file_path;

  // 目标目录已有同名文件时去重；excludeId 排除自身，保证"移动到自己所在目录"不改名。
  const moved = await transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, targetFolderId || 0]);
    const finalName = await uniqueName('file', targetFolderId, file.name, { style: 'numbered', client, excludeId: fileId });
    const disk = diskNameForName(file.name, finalName, file.disk_name || sanitizeSegment(file.name));
    const newRel = posix.join(...targetSegments, disk);
    assertPathLength(path.join(config.upload.dir, ...targetSegments, disk));
    return (await client.query(
      `UPDATE drive_file SET folder_id = $2, name = $3, disk_name = $4, file_path = $5,
              updated_by = $6, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [fileId, targetFolderId, finalName, disk, newRel, user.id]
    )).rows[0];
  });

  if (oldRel && moved.file_path && oldRel !== moved.file_path) {
    try { movePhysical(oldRel, moved.file_path); } catch (err) {
      console.warn('[drive] 文件移动物理搬运失败（可跑 rebuild-drive-layout 修复）：', err.message);
    }
  }
  await logAudit({ userId: user.id, action: 'move', targetType: 'file', targetId: fileId, targetName: moved.name, detail: { from: file.folder_id, to: targetFolderId } });
  return moved;
}

/**
 * 移动文件夹到目标文件夹（防环）。
 *
 * 层级化存储改造：
 *   - 事务内更新父指针，并**一次性重写所有子孙文件的 file_path 前缀**（子孙文件夹 disk_name
 *     存本层段名，移动不改段名，无需改动）；
 *   - 事务提交后**整体 `fs.rename` 目录**（跨盘 EXDEV → 递归 copy+unlink 兜底）。
 *
 * @param {number} folderId
 * @param {number} targetFolderId 目标父文件夹（可为 null 表示移到根）
 * @param {object} user
 */
export async function moveFolder(folderId, targetFolderId, user) {
  const folder = await one(`SELECT * FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`, [folderId]);
  if (!folder) throw new Error('文件夹不存在');
  if (!(user.isAdmin || folder.owner_id === user.id || await canEffective('canDelete', folder.parent_id, user))) {
    throw forbid('您没有移动该文件夹的权限');
  }
  if (targetFolderId) {
    if (Number(targetFolderId) === Number(folderId)) throw new Error('不能移动到自身');
    const isDesc = await isDescendant(targetFolderId, folderId);
    if (isDesc) throw new Error('不能移动到自己的子文件夹（会形成环）');
    const target = await one(`SELECT * FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`, [targetFolderId]);
    if (!target) throw new Error('目标文件夹不存在');
    if (!(await canEffective('canCreate', targetFolderId, user))) throw forbid('您没有在该目标文件夹创建的权限');
  } else if (!user.isAdmin) {
    throw forbid('只有管理员可以移动到根目录');
  }

  const oldSegments = (await resolveFolderSegments(folderId)).map(sanitizeSegment);
  const oldRel = posix.join(...oldSegments);
  const targetSegments = (await resolveFolderSegments(targetFolderId)).map(sanitizeSegment);
  const selfDisk = sanitizeSegment(folder.disk_name || folder.name);
  const newRel = posix.join(...targetSegments, selfDisk);
  assertPathLength(path.join(config.upload.dir, ...targetSegments, selfDisk));

  await transaction(async client => {
    // 与上传/复制同一维度加锁：目标父目录维度串行化，避免与并发新增/复制撞名
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, targetFolderId || 0]);
    await client.query(
      `UPDATE drive_folder SET parent_id = $2, updated_by = $3, updated_at = now() WHERE id = $1`,
      [folderId, targetFolderId || null, user.id]
    );
    // 子孙文件夹的 disk_name 存「本层段名」，移动只改父指针，段名不变，无需改动。
    //   仅一次性重写这些文件夹下所有文件的相对路径前缀。
    if (oldRel && newRel !== oldRel) {
      await client.query(
        `UPDATE drive_file SET file_path = replace(file_path, $1, $2) WHERE file_path LIKE $3`,
        [`${oldRel}/`, `${newRel}/`, `${oldRel}/%`]
      );
    }
  });

  // 物理整体搬家
  if (oldRel !== newRel) {
    try {
      const oldAbs = path.join(config.upload.dir, ...oldSegments);
      const newAbs = path.join(config.upload.dir, ...targetSegments, selfDisk);
      movePhysicalDir(oldAbs, newAbs);
    } catch (err) {
      console.warn('[drive] 文件夹移动物理搬运失败（可跑 rebuild-drive-layout 修复）：', err.message);
    }
  }
  await logAudit({ userId: user.id, action: 'move', targetType: 'folder', targetId: folderId, targetName: folder.name, detail: { from: folder.parent_id, to: targetFolderId || null } });
  return true;
}

/**
 * 复制文件到目标文件夹（物理文件共享同一 file_path，仅新增记录）。
 * @param {number} fileId
 * @param {number} targetFolderId
 * @param {object} user
 */
/**
 * 在目标目录内选定一个「不冲突」的名称（供 copy / upload / move 复用，避免三份实现漂移）。
 *
 * 命名风格（style）：
 *   - `'copy'`     ：复制语义 → `base - <tag>` / `base - <tag>(n)`（tag 默认「副本」，n≥2）
 *   - `'numbered'` ：上传/移动语义 → `base(1)` / `base(2)` …（与系统"上传冲突"惯例一致）
 * 文件保留扩展名；`.hidden` 这类以点开头的名称视为无扩展名。
 *
 * 并发安全：调用方必须持有同一目标目录的 `pg_advisory_xact_lock`，
 * 否则并发操作会同时读到"该名称未被占用"，生成重复名称。
 *
 * @param {'file'|'folder'} kind
 * @param {number|null} scopeId 目标目录（file=folder_id / folder=parent_id；null=根）
 * @param {string} name 原始名称
 * @param {{ style?: 'copy'|'numbered', tag?: string, client?: object, excludeId?: number|null }} [opts]
 * @returns {Promise<string>} 最终可用名称
 */
async function uniqueName(kind, scopeId, name, opts = {}) {
  const { style = 'copy', tag = '副本', client, excludeId = null } = opts;
  const q = client || { query };
  const isFile = kind === 'file';
  const table = isFile ? 'drive_file' : 'drive_folder';
  const scopeCol = isFile ? 'folder_id' : 'parent_id';
  const dot = isFile ? name.lastIndexOf('.') : -1;
  const hasExt = dot > 0;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';

  const taken = async cand => {
    const params = [];
    let where;
    if (scopeId == null) {
      where = `${scopeCol} IS NULL`;
    } else {
      params.push(scopeId);
      where = `${scopeCol} = $1`;
    }
    params.push(cand);
    where += ` AND name = $${params.length} AND deleted_at IS NULL`;
    if (excludeId != null) {
      params.push(excludeId);
      where += ` AND id <> $${params.length}`;
    }
    const res = await q.query(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`, params);
    return res.rows.length > 0;
  };

  const make = i => (style === 'numbered'
    ? `${base}(${i})${ext}`
    : `${base}${i === 1 ? ` - ${tag}` : ` - ${tag}(${i})`}${ext}`);

  if (!(await taken(name))) return name;
  for (let i = 1; i <= 500; i++) {
    const cand = make(i);
    if (!(await taken(cand))) return cand;
  }
  // 极端兜底：以时间戳收尾，绝不返回已占用名称
  return style === 'numbered'
    ? `${base}(${Date.now()})${ext}`
    : `${base} - ${tag}(${Date.now()})${ext}`;
}

/**
 * 复制文件到目标文件夹。
 *
 * ⚠️ 语义变更（用户口径 2026-10-12）：复制不再共享 file_path，必须**真拷贝**物理文件。
 *
 * 【best-effort 口径 + 显式留痕】（2026-10-12 经 team-lead 评审后定稿）
 *   源物理文件缺失时，**仍提交 DB 行**（不 fail-fast），理由：
 *     - 架构原则：`drive_folder.parent_id` 树是**唯一权威**，磁盘只是它的**投影**
 *       （设计文档 §一/§3.7）。磁盘文件缺失属「投影漂移」，应由 `rebuild-drive-layout.mjs`
 *       这个**安全网**修复；若为投影缺陷而**拒绝 DB 层操作**，等于把磁盘状态抬到 DB 之上，
 *       与本项目核心架构原则相悖。
 *     - 生产路径虽不常见，但**确实可能**出现「DB 有行、磁盘无文件」：
 *       ① `cleanup-drive-legacy.mjs` 删库行/移走磁盘后，若只从备份 JSON 重导 DB 行而未跑
 *          `rebuild-drive-layout.mjs`；② UPLOAD_DIR 磁盘被误清理/还原点回滚/网络盘断连；
 *       ③ `replaceFileContent` 覆盖写盘与落库之间出现不一致。
 *       此时**保留用户的复制意图**（可重试、可 repair）比直接报错更符合「DB 权威」模型。
 *     - 反对 fail-fast：一旦磁盘抖动就拒复制，用户操作直接丢失且无自动补偿。
 *   但**绝不静默**：源缺失/拷贝失败时写一条 `copy_incomplete` 审计记录（而非仅 console.warn），
 *   让幽灵记录在审计面板与 `rebuild-drive-layout.mjs` 的「缺失清单」中**双重可见**，便于运维处置。
 *
 * 取号与插入持有目标目录咨询锁（`pg_advisory_xact_lock`），避免并发复制撞名。
 *
 * @param {number} fileId
 * @param {number} targetFolderId
 * @param {object} user
 * @returns {Promise<object>} 新插入的 drive_file 行
 */
export async function copyFile(fileId, targetFolderId, user, nameSuffix) {
  const file = await one(`SELECT * FROM drive_file WHERE id = $1 AND deleted_at IS NULL`, [fileId]);
  if (!file) throw new Error('文件不存在');
  const src = await getFolderWithPerm(file.folder_id, user);
  if (!can('can_read', src, user) && !(await canEffective('canRead', file.folder_id, user))) {
    throw forbid('您没有读取该文件的权限');
  }
  if (!(await canEffective('canUpload', targetFolderId, user)) && !(await canEffective('canCreate', targetFolderId, user))) {
    throw forbid('您没有复制到该目标文件夹的权限');
  }
  const targetSegments = (await resolveFolderSegments(targetFolderId)).map(sanitizeSegment);
  const srcAbs = absFromRel(file.file_path);

  const copy = await transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, targetFolderId || 0]);
    const newName = await uniqueName('file', targetFolderId, file.name, { style: 'copy', tag: nameSuffix, client });
    const origDisk = file.disk_name || sanitizeSegment(file.name);
    const newDisk = diskNameForName(file.name, newName, origDisk);
    const newRel = posix.join(...targetSegments, newDisk);
    assertPathLength(path.join(config.upload.dir, ...targetSegments, newDisk));
    const r = (await client.query(
      `INSERT INTO drive_file (folder_id, name, disk_name, file_path, file_size, mime_type, uploaded_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [targetFolderId, newName, newDisk, newRel, file.file_size, file.mime_type, user.id]
    )).rows[0];
    return { row: r };
  });

  // 真拷贝物理文件（best-effort：源缺失/拷贝失败不阻断 DB 记录，但写审计留痕，不静默）
  let physicalOk = false;
  let physicalErr = null;
  try {
    const dstAbs = absFromRel(copy.row.file_path);
    if (fs.existsSync(srcAbs)) {
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.copyFileSync(srcAbs, dstAbs);
      physicalOk = true;
    } else {
      physicalErr = '源物理文件缺失';
    }
  } catch (err) {
    physicalErr = err.message;
  }
  if (!physicalOk) {
    console.warn(`[drive] 复制源物理文件缺失/失败，仅创建 DB 记录（待 rebuild-drive-layout 修复）：${file.file_path} — ${physicalErr}`);
    // 显式留痕：让「幽灵记录」在审计面板可见，而非仅在控制台
    await logAudit({
      userId: user.id, action: 'copy_incomplete', targetType: 'file', targetId: copy.row.id,
      targetName: copy.row.name,
      detail: { reason: physicalErr, sourceId: fileId, sourcePath: file.file_path, targetPath: copy.row.file_path, note: '源缺失，DB 行已建；请跑 rebuild-drive-layout.mjs 处置缺失清单' },
    });
  }

  await logAudit({ userId: user.id, action: 'copy', targetType: 'file', targetId: copy.row.id, targetName: copy.row.name, detail: { from: file.folder_id, to: targetFolderId, sourceId: fileId, physicalOk } });
  return copy.row;
}

/**
 * 复制文件夹到目标文件夹（递归复制子文件夹与文件）。
 *
 * ⚠️ 语义变更（用户口径 2026-10-12）：不再共享 file_path，**目录 + 文件全部真拷贝** 到磁盘。
 * 每个子孙文件夹/文件都在目标树内按 sanitize + 去重规则确定磁盘名。
 *
 * 【best-effort 口径 + 显式留痕】与 copyFile 一致：源物理文件缺失**不阻断** DB 复制
 *   （磁盘是 DB 的投影，由 `rebuild-drive-layout.mjs` 修复），但**逐个留痕** `copy_incomplete`
 *   审计记录 + 控制台告警，绝不静默。理由详见 copyFile 上方注释。
 *
 * @param {number} folderId
 * @param {number} targetFolderId
 * @param {object} user
 */
export async function copyFolder(folderId, targetFolderId, user, nameSuffix) {
  const folder = await one(`SELECT * FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`, [folderId]);
  if (!folder) throw new Error('文件夹不存在');
  if (!(await canEffective('canRead', folderId, user)) && !(user.isAdmin || folder.owner_id === user.id)) {
    throw forbid('您没有读取该文件夹的权限');
  }
  if (targetFolderId) {
    if (Number(targetFolderId) === Number(folderId) || await isDescendant(targetFolderId, folderId)) {
      throw new Error('不能复制到自身或其子文件夹');
    }
    if (!(await canEffective('canCreate', targetFolderId, user))) throw forbid('您没有在该目标文件夹创建的权限');
  }

  // 事务内维护「待拷贝物理文件」与「缺失清单」，供提交后真拷贝 / 留痕
  const pendingCopies = [];  // [srcRel, dstRel, name]
  const result = await transaction(async client => {
    // 与 copyFile 同理：名称分配必须与插入同锁，避免并发复制产生重名
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, targetFolderId || 0]);
    const targetSegments = await resolveFolderSegments(targetFolderId, client);
    const rootName = await uniqueName('folder', targetFolderId || null, folder.name, { style: 'copy', tag: nameSuffix, client });
    const rootDisk = sanitizeSegment(rootName);
    const rootDirRel = posix.join(...targetSegments.map(sanitizeSegment), rootDisk);
    assertPathLength(path.join(config.upload.dir, ...targetSegments.map(sanitizeSegment), rootDisk));
    const root = (await client.query(
      `INSERT INTO drive_folder (parent_id, name, disk_name, owner_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$4,$4) RETURNING id`,
      [targetFolderId || null, rootName, rootDisk, user.id]
    )).rows[0].id;

    // 广度复制：逐层处理；同步维护「目标物理相对目录」
    const queue = [{ src: folderId, dst: root, dstDirRel: rootDirRel }];
    while (queue.length) {
      const { src, dst, dstDirRel } = queue.shift();
      const subs = (await client.query(
        `SELECT * FROM drive_folder WHERE parent_id = $1 AND deleted_at IS NULL`, [src]
      )).rows;
      for (const s of subs) {
        const childDisk = sanitizeSegment(s.disk_name || s.name);
        const childDstDirRel = posix.join(dstDirRel, childDisk);
        const childDst = (await client.query(
          `INSERT INTO drive_folder (parent_id, name, disk_name, owner_id, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$4,$4) RETURNING id`,
          [dst, s.name, childDisk, user.id]
        )).rows[0].id;
        queue.push({ src: s.id, dst: childDst, dstDirRel: childDstDirRel });
      }
      const files = (await client.query(
        `SELECT * FROM drive_file WHERE folder_id = $1 AND deleted_at IS NULL`, [src]
      )).rows;
      for (const f of files) {
        const disk = sanitizeSegment(f.disk_name || f.name);
        const dstRel = posix.join(dstDirRel, disk);
        const newRow = (await client.query(
          `INSERT INTO drive_file (folder_id, name, disk_name, file_path, file_size, mime_type, uploaded_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
          [dst, f.name, disk, dstRel, f.file_size, f.mime_type, user.id]
        )).rows[0];
        if (f.file_path) pendingCopies.push({ srcRel: f.file_path, dstRel, name: f.name, newId: newRow.id });
      }
    }
    return { id: root, name: rootName };
  });

  // 事务提交后真拷贝物理文件（best-effort：缺失/失败逐个留痕，不阻断）
  for (const p of pendingCopies) {
    try {
      const sAbs = absFromRel(p.srcRel);
      const dAbs = absFromRel(p.dstRel);
      if (fs.existsSync(sAbs)) {
        fs.mkdirSync(path.dirname(dAbs), { recursive: true });
        fs.copyFileSync(sAbs, dAbs);
      } else {
        throw new Error('源物理文件缺失');
      }
    } catch (err) {
      console.warn(`[drive] 复制文件夹源缺失/失败，仅创建 DB 记录（待 rebuild-drive-layout 修复）：${p.srcRel} — ${err.message}`);
      await logAudit({
        userId: user.id, action: 'copy_incomplete', targetType: 'file', targetId: p.newId, targetName: p.name,
        detail: { reason: err.message, sourcePath: p.srcRel, targetPath: p.dstRel, from: folderId, to: targetFolderId || null, note: '源缺失，DB 行已建；请跑 rebuild-drive-layout.mjs 处置缺失清单' },
      });
    }
  }

  await logAudit({ userId: user.id, action: 'copy', targetType: 'folder', targetId: result.id, targetName: result.name, detail: { from: folderId, to: targetFolderId || null } });
  return result;
}

/**
 * 回收站列表：当前用户可管理的被删除项（admin 全部；否则仅自己删除的）。
 * @param {object} user
 */
export async function listTrash(user) {
  const files = await many(
    `SELECT df.*, u.real_name AS deleted_by_name
       FROM drive_file df LEFT JOIN org_user u ON u.id = df.deleted_by
      WHERE df.deleted_at IS NOT NULL AND ($2 OR df.deleted_by = $1)
      ORDER BY df.deleted_at DESC`,
    [user.id, user.isAdmin]
  );
  const folders = await many(
    `SELECT df.*, u.real_name AS deleted_by_name
       FROM drive_folder df LEFT JOIN org_user u ON u.id = df.deleted_by
      WHERE df.deleted_at IS NOT NULL AND ($2 OR df.deleted_by = $1)
      ORDER BY df.deleted_at DESC`,
    [user.id, user.isAdmin]
  );
  return { files, folders };
}

/**
 * 从回收站还原（恢复原位置；若原文件夹已不存在则回到根目录）。
 * @param {'file'|'folder'} type
 * @param {number} id
 * @param {object} user
 */
export async function restoreItem(type, id, user) {
  if (type === 'file') {
    const f = await one(`SELECT * FROM drive_file WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
    if (!f) throw new Error('回收站中无此文件');
    if (!user.isAdmin && f.deleted_by !== user.id) throw forbid('只能还原自己删除的文件');
    // 文件的 folder_id 为 NOT NULL，还原时保持原 folder_id：
    // 若其父文件夹也一并被删除，则后续还原父文件夹时该文件自然归位。
    //
    // 层级化存储：恢复前若「原路径名」已被别的文件占用，则重算 disk_name 并重命名物理文件。
    const segments = (await resolveFolderSegments(f.folder_id)).map(sanitizeSegment);
    const restored = await transaction(async client => {
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADV_DRIVE_COPY, f.folder_id || 0]);
      const fn = await uniqueName('file', f.folder_id, f.name, { style: 'numbered', client, excludeId: id });
      const disk = diskNameForName(f.name, fn, f.disk_name || sanitizeSegment(f.name));
      const newRel = posix.join(...segments, disk);
      assertPathLength(path.join(config.upload.dir, ...segments, disk));
      await client.query(
        `UPDATE drive_file SET name = $2, disk_name = $3, file_path = $4,
                deleted_at = NULL, deleted_by = NULL, orig_folder_id = NULL, updated_at = now()
          WHERE id = $1`,
        [id, fn, disk, newRel]
      );
      return { name: fn, filePath: newRel };
    });
    if (f.file_path && restored.filePath && f.file_path !== restored.filePath) {
      try { movePhysical(f.file_path, restored.filePath); } catch (err) {
        console.warn('[drive] 还原文件物理重命名失败：', err.message);
      }
    }
    await logAudit({ userId: user.id, action: 'restore', targetType: 'file', targetId: id, targetName: restored.name, detail: { restoredTo: f.folder_id } });
    return { id, restoredTo: f.folder_id };
  }

  if (type === 'folder') {
    const f = await one(`SELECT * FROM drive_folder WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
    if (!f) throw new Error('回收站中无此文件夹');
    if (!user.isAdmin && f.deleted_by !== user.id) throw forbid('只能还原自己删除的文件夹');
    const origId = f.orig_folder_id;
    const parent = origId ? await one(`SELECT id FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`, [origId]) : null;
    const dest = parent ? origId : null;
    // 记录恢复前的相对目录（供物理目录 rename）
    const oldSegments = (await resolveFolderSegments(id)).map(sanitizeSegment);
    const oldRel = posix.join(...oldSegments);
    const targetSegments = (await resolveFolderSegments(dest)).map(sanitizeSegment);
    const selfDisk = sanitizeSegment(f.disk_name || f.name);
    const newRel = posix.join(...targetSegments, selfDisk);

    await transaction(async client => {
      const subs = (await client.query(
        `WITH RECURSIVE sub AS (
            SELECT id FROM drive_folder WHERE id = $1
            UNION ALL
            SELECT c.id FROM drive_folder c JOIN sub s ON c.parent_id = s.id
         )
         SELECT id FROM sub`,
        [id]
      )).rows.map(r => r.id);
      await client.query(
        `UPDATE drive_folder SET deleted_at = NULL, deleted_by = NULL, orig_folder_id = NULL, updated_at = now()
          WHERE id = ANY($1::bigint[])`,
        [subs]
      );
      await client.query(
        `UPDATE drive_file SET deleted_at = NULL, deleted_by = NULL, orig_folder_id = NULL, updated_at = now()
          WHERE folder_id = ANY($1::bigint[])`,
        [subs]
      );
      // 归位父目录 + 重写子孙 file_path 前缀
      await client.query(`UPDATE drive_folder SET parent_id = $2 WHERE id = $1`, [id, dest]);
      if (oldRel && newRel !== oldRel) {
        await client.query(
          `UPDATE drive_file SET file_path = replace(file_path, $1, $2) WHERE file_path LIKE $3`,
          [`${oldRel}/`, `${newRel}/`, `${oldRel}/%`]
        );
      }
    });

    if (oldRel && newRel && oldRel !== newRel) {
      try {
        const oldAbs = path.join(config.upload.dir, ...oldSegments);
        const newAbs = path.join(config.upload.dir, ...targetSegments, selfDisk);
        movePhysicalDir(oldAbs, newAbs);
      } catch (err) {
        console.warn('[drive] 还原文件夹物理移动失败：', err.message);
      }
    }
    await logAudit({ userId: user.id, action: 'restore', targetType: 'folder', targetId: id, targetName: f.name, detail: { restoredTo: dest } });
    return { id, restoredTo: dest };
  }
  throw new Error('未知类型');
}

/**
 * 收集一批「待彻底删除」的文件物理相对路径，并过滤掉仍被其它 DB 行引用的路径。
 *
 * ⚠️ 安全第一：历史「复制」曾共享同一 file_path，物理文件可能被多行引用。
 *    仅当某 file_path 不再被任何其它 drive_file 行引用时才允许删除物理文件。
 *
 * @param {object} client 事务 client
 * @param {Array<{id:number, file_path:string}>} files 待删文件行
 * @returns {Promise<string[]>} 可安全 unlink 的相对路径集合
 */
async function safePhysicalPathsForDelete(client, files) {
  const safe = new Set();
  for (const f of files) {
    if (!f.file_path) continue;
    const res = await client.query(
      `SELECT count(*)::int AS n FROM drive_file WHERE file_path = $1 AND id <> $2`,
      [f.file_path, f.id]
    );
    if ((res.rows[0]?.n || 0) === 0) safe.add(f.file_path);
  }
  return [...safe];
}

/**
 * 彻底删除（仅管理员或删除者本人）。
 *
 * 层级化存储改造（用户口径 2026-10-12）：**新增真删物理文件**。
 *   - 文件：先确认物理路径不再被其它记录引用 → `fs.unlink` → 删 DB 行；
 *   - 文件夹：收集「含自身」递归子孙集合下所有文件的物理路径 → 逐个安全 unlink → 删 DB（CASCADE）。
 *   - 物理删除在 DB 事务提交后执行（避免回滚后物理已删的错位）；先做引用检查保证安全。
 */
export async function purgeItem(type, id, user) {
  if (type === 'file') {
    const f = await one(`SELECT * FROM drive_file WHERE id = $1`, [id]);
    if (!f) throw new Error('文件不存在');
    if (!user.isAdmin && f.deleted_by !== user.id) throw forbid('只能彻底删除自己删除的文件');
    const toDelete = await transaction(async client => {
      const paths = await safePhysicalPathsForDelete(client, [f]);
      await client.query(`DELETE FROM drive_file WHERE id = $1`, [id]);
      return paths;
    });
    for (const rel of toDelete) unlinkPhysicalSafe(rel);
    await logAudit({ userId: user.id, action: 'purge', targetType: 'file', targetId: id, targetName: f.name, detail: { physicalDeleted: toDelete.length } });
    return true;
  }
  if (type === 'folder') {
    const f = await one(`SELECT * FROM drive_folder WHERE id = $1`, [id]);
    if (!f) throw new Error('文件夹不存在');
    if (!user.isAdmin && f.deleted_by !== user.id) throw forbid('只能彻底删除自己删除的文件夹');
    const toDelete = await transaction(async client => {
      // 「含自身」的递归子孙文件夹集合
      const folderIds = (await client.query(
        `WITH RECURSIVE sub AS (
            SELECT id FROM drive_folder WHERE id = $1
            UNION ALL
            SELECT c.id FROM drive_folder c JOIN sub s ON c.parent_id = s.id
         )
         SELECT id FROM sub`,
        [id]
      )).rows.map(r => r.id);
      // 这些文件夹下的所有文件（含已软删/未软删），用于物理删除与引用检查
      const files = (await client.query(
        `SELECT id, file_path FROM drive_file WHERE folder_id = ANY($1::bigint[])`,
        [folderIds]
      )).rows;
      const paths = await safePhysicalPathsForDelete(client, files);
      // 硬删（先文件、再文件夹，避免悬空）
      await client.query(`DELETE FROM drive_file WHERE folder_id = ANY($1::bigint[])`, [folderIds]);
      await client.query(`DELETE FROM drive_folder WHERE id = ANY($1::bigint[])`, [folderIds]);
      return paths;
    });
    for (const rel of toDelete) unlinkPhysicalSafe(rel);
    // 尽力清理空目录（非必需；失败忽略）
    try {
      const segs = (await resolveFolderSegments(f.parent_id)).map(sanitizeSegment);
      const dirAbs = path.join(config.upload.dir, ...segs, sanitizeSegment(f.disk_name || f.name));
      pruneEmptyDirs(dirAbs);
    } catch { /* 忽略 */ }
    await logAudit({ userId: user.id, action: 'purge', targetType: 'folder', targetId: id, targetName: f.name, detail: { physicalDeleted: toDelete.length } });
    return true;
  }
  throw new Error('未知类型');
}

/** 递归向上删除空目录（仅删空目录，遇到非空即停） */
function pruneEmptyDirs(absDir) {
  let cur = absDir;
  const root = path.resolve(config.upload.dir);
  while (cur && path.resolve(cur).startsWith(root) && path.resolve(cur) !== root) {
    try {
      const entries = fs.readdirSync(cur);
      if (entries.length) break;
      fs.rmdirSync(cur);
    } catch { break; }
    cur = path.dirname(cur);
  }
}

/* ============================================================
 * 回收站保留期：7 个工作日（用户口径 2026-10-12）
 *   界面删除后立即在系统界面不显示；满「7 个工作日」自动真删物理文件。
 *   工作日定义：仅排除周六、周日，**不含法定节假日**（本项目无节假日日历）。
 * ============================================================ */

/** 回收站保留的工作日数（替代原 30 天自然日） */
const TRASH_RETAIN_WORKDAYS = 7;
/** 候选预筛窗口（自然日）：14 自然日 ≥ 7 工作日，避免全表扫；再逐行精判 */
const TRASH_PREFILTER_DAYS = 14;

/**
 * 在 date 基础上加 n 个工作日（跳过周六、周日）。
 * ⚠️ 仅排除周六/周日，**不含法定节假日**（如需精确节假日需引入节假日日历表，本次不做）。
 * @param {Date|string} date 起始时间
 * @param {number} n 工作日数
 * @returns {Date} 结果时间
 */
export function addWorkingDays(date, n) {
  const d = new Date(date);
  let remaining = Math.max(0, Number(n) || 0);
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--; // 0=周日,6=周六
  }
  return d;
}

/**
 * 回收站自动清理：彻底删除「删除时刻 + 7 个工作日」已到的回收站项。
 *
 * 语义与手动 purgeItem 保持一致（硬删 DB 行 + **真删物理文件**；ON DELETE CASCADE 带走子孙）。
 * 工作日判定在 JS 侧完成：
 *   1. SQL 预筛 `deleted_at < now() - interval '14 days'`（14 自然日 ≥ 7 工作日，避免全表扫）；
 *   2. 逐行用 `addWorkingDays(deleted_at, 7) <= now` 精判。
 * ⚠️ 工作日仅排除周六周日，**不含法定节假日**。
 *
 * @returns {Promise<{files:number, folders:number, total:number, workdays:number}>}
 */
export async function purgeExpiredTrash() {
  const now = new Date();
  // 阶段1：预筛候选（自然日窗口）
  const candidateFolders = await many(
    `SELECT id, deleted_at FROM drive_folder
      WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '${TRASH_PREFILTER_DAYS} days'`
  );
  const candidateFiles = await many(
    `SELECT id, deleted_at, file_path FROM drive_file
      WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '${TRASH_PREFILTER_DAYS} days'`
  );
  // 阶段2：JS 精判「7 个工作日」是否已到
  const expiredFolderIds = candidateFolders
    .filter(r => addWorkingDays(r.deleted_at, TRASH_RETAIN_WORKDAYS) <= now)
    .map(r => r.id);
  const expiredBaseFiles = candidateFiles
    .filter(r => addWorkingDays(r.deleted_at, TRASH_RETAIN_WORKDAYS) <= now);

  // 过期文件夹「含自身」的递归子孙集合（先清文件、再清文件夹，避免悬空）
  let folderIds = [];
  if (expiredFolderIds.length) {
    const rows = await many(
      `WITH RECURSIVE sub AS (
          SELECT id FROM drive_folder WHERE id = ANY($1::bigint[])
          UNION ALL
          SELECT c.id FROM drive_folder c JOIN sub s ON c.parent_id = s.id
       )
       SELECT DISTINCT id FROM sub`,
      [expiredFolderIds]
    );
    folderIds = rows.map(r => r.id);
  }

  const result = await transaction(async client => {
    let fileCount = 0;
    let folderCount = 0;
    const physicalPaths = [];

    if (folderIds.length) {
      const files = (await client.query(
        `SELECT id, file_path FROM drive_file WHERE folder_id = ANY($1::bigint[])`,
        [folderIds]
      )).rows;
      physicalPaths.push(...await safePhysicalPathsForDelete(client, files));
      const delFiles = await client.query(`DELETE FROM drive_file WHERE folder_id = ANY($1::bigint[])`, [folderIds]);
      fileCount += delFiles.rowCount;
      const delFolders = await client.query(`DELETE FROM drive_folder WHERE id = ANY($1::bigint[])`, [folderIds]);
      folderCount += delFolders.rowCount;
    }

    // 独立的过期文件（不属于上面已删文件夹）
    if (expiredBaseFiles.length) {
      const ids = expiredBaseFiles.map(r => r.id);
      physicalPaths.push(...await safePhysicalPathsForDelete(client, expiredBaseFiles));
      const delLoose = await client.query(`DELETE FROM drive_file WHERE id = ANY($1::bigint[])`, [ids]);
      fileCount += delLoose.rowCount;
    }

    // 留痕：审计日志（容错，不阻断清理）
    if (fileCount + folderCount > 0) {
      try {
        await client.query(
          `INSERT INTO drive_audit_log (user_id, action, target_type, target_id, target_name, detail)
           VALUES (NULL, 'purge', 'trash', NULL, NULL, $1::jsonb)`,
          [JSON.stringify({ source: 'cron', files: fileCount, folders: folderCount, retainWorkdays: TRASH_RETAIN_WORKDAYS, note: '工作日仅排除周六周日，不含法定节假日' })]
        );
      } catch (err) {
        console.warn('[drive-audit] 写清理日志失败：', err.message);
      }
    }
    return { files: fileCount, folders: folderCount, total: fileCount + folderCount, workdays: TRASH_RETAIN_WORKDAYS, paths: physicalPaths };
  });

  // 事务提交后真删物理文件
  let physicalDeleted = 0;
  for (const rel of result.paths || []) { if (unlinkPhysicalSafe(rel)) physicalDeleted++; }

  return { files: result.files, folders: result.folders, total: result.total, workdays: TRASH_RETAIN_WORKDAYS, physicalDeleted };
}

/**
 * 全文/文件名检索：仅返回用户有权限（canRead）的项。
 * @param {{keyword:string, user:object}} opts
 */
export async function searchDrive({ keyword, user }) {
  const kw = keyword ? String(keyword).trim() : '';
  if (!kw) return { files: [], folders: [] };
  const like = `%${kw}%`;
  // F-04：to_tsquery 会把 `' & ! ( :` 当语法字符 → 语法错误 500；
  // 改用 websearch_to_tsquery（用户输入按普通词解析，永不抛语法错）。
  const tsQuery = kw || 'zzzznomatch';

  const files = await many(
    `SELECT df.*, f.owner_id AS folder_owner, u.real_name AS uploader_name
       FROM drive_file df
       JOIN drive_folder f ON f.id = df.folder_id
       LEFT JOIN org_user u ON u.id = df.uploaded_by
      WHERE df.deleted_at IS NULL
        AND (df.name ILIKE $1 OR to_tsvector('simple', df.name) @@ websearch_to_tsquery('simple', $2))
      ORDER BY df.name LIMIT 200`,
    [like, tsQuery]
  );
  const folders = await many(
    `SELECT f.*, u.real_name AS owner_name
       FROM drive_folder f LEFT JOIN org_user u ON u.id = f.owner_id
      WHERE f.deleted_at IS NULL
        AND (f.name ILIKE $1 OR to_tsvector('simple', f.name) @@ websearch_to_tsquery('simple', $2))
      ORDER BY f.name LIMIT 200`,
    [like, tsQuery]
  );

  // 权限隔离：逐项过滤（owner/admin 直通；否则须 canRead）
  const allowedFiles = [];
  for (const file of files) {
    if (user.isAdmin || file.folder_owner === user.id) { allowedFiles.push(file); continue; }
    const acl = await effectiveAcl(file.folder_id, user);
    if (acl.canRead) allowedFiles.push(file);
  }
  const allowedFolders = [];
  for (const folder of folders) {
    if (user.isAdmin || folder.owner_id === user.id) { allowedFolders.push(folder); continue; }
    const acl = await effectiveAcl(folder.id, user);
    if (acl.canRead) allowedFolders.push(folder);
  }
  return { files: allowedFiles, folders: allowedFolders };
}

/**
 * 创建分享链接。
 * @param {{fileId?:number, folderId?:number, password?:string, expireDays?:number}} data
 * @param {object} user
 */
export async function createShare(data = {}, user) {
  const { fileId, folderId, password, expireDays } = data;
  if (!fileId && !folderId) throw new Error('请指定分享的文件或文件夹');
  if (fileId && folderId) throw new Error('文件与文件夹不可同时分享');
  if (fileId) {
    const f = await one(`SELECT * FROM drive_file WHERE id = $1 AND deleted_at IS NULL`, [fileId]);
    if (!f) throw new Error('文件不存在');
    if (!(user.isAdmin || await canEffective('canRead', f.folder_id, user))) throw forbid('您没有分享该文件的权限');
  }
  if (folderId) {
    const f = await one(`SELECT * FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`, [folderId]);
    if (!f) throw new Error('文件夹不存在');
    if (!(user.isAdmin || f.owner_id === user.id || await canEffective('canRead', folderId, user))) throw forbid('您没有分享该文件夹的权限');
  }
  const token = crypto.randomBytes(24).toString('hex');
  const pwdHash = password ? crypto.createHash('sha256').update(String(password)).digest('hex') : null;
  const expireAt = expireDays ? new Date(Date.now() + Number(expireDays) * 86400000).toISOString() : null;

  const row = await one(
    `INSERT INTO drive_share (file_id, folder_id, token, password_hash, expire_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, token, expire_at`,
    [fileId || null, folderId || null, token, pwdHash, expireAt, user.id]
  );
  await logAudit({ userId: user.id, action: 'share', targetType: fileId ? 'file' : 'folder', targetId: fileId || folderId, targetName: null, detail: { token, expireAt } });
  return { token: row.token, expireAt: row.expire_at, hasPassword: !!pwdHash, id: row.id };
}

/**
 * 解析分享 token：校验有效期与密码，返回被分享目标。
 * @param {string} token
 * @param {string} [password]
 */
export async function resolveShare(token, password) {
  const share = await one(`SELECT * FROM drive_share WHERE token = $1`, [token]);
  if (!share) throw new Error('分享链接无效');
  if (share.expire_at && new Date(share.expire_at).getTime() < Date.now()) {
    throw new Error('分享链接已过期');
  }
  if (share.password_hash) {
    const pwdHash = password ? crypto.createHash('sha256').update(String(password)).digest('hex') : null;
    if (pwdHash !== share.password_hash) {
      const err = new Error('提取码错误');
      err.statusCode = 403;
      throw err;
    }
  }
  if (share.file_id) {
    const file = await one(
      `SELECT df.id, df.name, df.file_path, df.file_size, df.mime_type, df.folder_id
         FROM drive_file df WHERE df.id = $1 AND df.deleted_at IS NULL`,
      [share.file_id]
    );
    if (!file) throw new Error('分享的文件已被删除');
    return { type: 'file', file };
  }
  const folder = await one(
    `SELECT id, name, parent_id FROM drive_folder WHERE id = $1 AND deleted_at IS NULL`,
    [share.folder_id]
  );
  if (!folder) throw new Error('分享的文件夹已被删除');
  const files = await many(
    `SELECT id, name, file_size, mime_type FROM drive_file WHERE folder_id = $1 AND deleted_at IS NULL`,
    [share.folder_id]
  );
  return { type: 'folder', folder, files };
}

/**
 * 写审计日志（容错：审计失败不影响主流程）。
 * @param {{userId:number, action:string, targetType?:string, targetId?:number, targetName?:string, detail?:object}} entry
 */
export async function logAudit({ userId, action, targetType, targetId, targetName, detail }) {
  try {
    await query(
      `INSERT INTO drive_audit_log (user_id, action, target_type, target_id, target_name, detail)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [userId || null, action, targetType || null, targetId || null, targetName || null, JSON.stringify(detail || {})]
    );
  } catch (err) {
    console.warn('[drive-audit] 写日志失败：', err.message);
  }
}

/**
 * 审计日志列表（分页）。
 * @param {{page?:number,pageSize?:number,action?:string,userId?:number,from?:string,to?:string}} opts
 */
export async function listAudit({ page, pageSize, action, userId, from, to } = {}) {
  const params = [];
  let where = '1=1';
  if (action) { params.push(action); where += ` AND a.action = $${params.length}`; }
  if (userId) { params.push(userId); where += ` AND a.user_id = $${params.length}`; }
  if (from) { params.push(from); where += ` AND a.created_at::date >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` AND a.created_at::date <= $${params.length}::date`; }

  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM drive_audit_log a WHERE ${where}`, params);
  const list = await many(
    `SELECT a.*, u.real_name AS user_name
       FROM drive_audit_log a LEFT JOIN org_user u ON u.id = a.user_id
      WHERE ${where} ORDER BY a.created_at DESC LIMIT ${size} OFFSET ${(p - 1) * size}`,
    params
  );
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/** 导出全部审计日志（供 CSV 导出，上限 10000 条） */
export async function exportAudit() {
  return many(
    `SELECT a.id, u.real_name AS user_name, a.action, a.target_type, a.target_id,
            a.target_name, a.detail, a.created_at
       FROM drive_audit_log a LEFT JOIN org_user u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT 10000`
  );
}
