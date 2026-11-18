// 附件下载授权（/api/files/*）—— 把「仅登录」升级为「按归属分类授权」
//
// 背景（B3 / IDOR）：
//   历史实现只做 authenticate（登录即放行），随后 `path.join(upload.dir, rel)` 直接读盘，
//   唯一的额外校验是「secret 密级文档附件禁下载」。于是任何登录用户只要知道（或枚举到）
//   file_path，就能下载任意流程单据附件 / 任意会议交付件 / 任意公共盘文件 —— 越权下载。
//
// 设计原则（重要）：
//   1) **不发明新策略**：每个分类都复用项目里「该业务自己的可见性判定」，
//      与对应读取接口（/api/docs/:id、/api/instances/:id、/api/drive/*、/api/meeting/*）
//      的口径保持一一对应，避免出现「能看单据却下不了附件」或反之。
//   2) **不打断现有下载**：无法归类时按「归属文档/单据是否存在」兜底，
//      只有真正无迹可循的孤儿文件才收紧为「仅管理员」。
//   3) admin / API Key 服务身份恒放行（与 flow.js 附件上传口径一致）。

import { one, many } from '../db/index.js';
import { effectiveAcl } from '../services/drive-service.js';

/** 文件归属分类 */
export const FILE_CATEGORY = {
  DRIVE: 'drive',        // 公共盘（drive_file + drive_acl）
  DOC: 'doc',            // 受控文档附件（doc_system）
  FLOW: 'flow',          // 流程单据附件（flow_instance）
  MEETING: 'meeting',    // 会议交付件（meeting_item_submission）
  MODULE: 'module',      // 无隔离的业务附件（IPQC/FAI/设备巡检/知识库…）
  STAGING: 'staging',    // 上传暂存区（本不应被外部下载）
  UNKNOWN: 'unknown',    // 无任何归属记录
};

/** 拒绝原因 → 对外文案（不透漏内部判定细节） */
const DENY_MSG = {
  not_found: '文件不存在',
  doc_missing: '无权下载该文件',
  doc_secret: '秘密文件禁止下载',
  flow_denied: '无权下载该单据的附件',
  meeting_denied: '无权下载该会议交付件',
  drive_denied: '没有该文件的读取权限',
  staging_denied: '无权下载该文件',
  unknown: '无权下载该文件',
};

/** 对外统一文案（调用方无需感知具体分支） */
export function denyMessage(reason) {
  return DENY_MSG[reason] || DENY_MSG.unknown;
}

function userPerms(user) {
  return Array.isArray(user?.permissions) ? user.permissions : [];
}

function hasAnyPerm(user, codes) {
  const perms = userPerms(user);
  return codes.some((c) => perms.includes(c));
}

/**
 * 把 `/api/files/*` 的 rel 拆成「顶层段 + 第二段」。
 * 例：`docs/1489/1793-abc.xlsx` → { head:'docs', sub:'1489' }
 */
function splitRel(rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  return { clean, head: parts[0] || '', sub: parts[1] || '' };
}

/* ============================================================
 * 各分类授权判定
 * ============================================================ */

/** 公共盘：复用 drive-service 的 effectiveAcl（含父目录继承 / owner / admin 特判） */
async function checkDrive(user, row) {
  if (Number(row.uploaded_by) === Number(user.id)) return true;   // 上传者本人恒可读
  const acl = await effectiveAcl(row.folder_id, user);
  return !!acl.canRead;
}

/** 受控文档：文档详情接口对所有登录用户开放，故「文档存在且非 secret」即可读 */
async function checkDoc(docId) {
  if (!docId) return { ok: false, reason: 'doc_missing' };
  const doc = await one(
    `SELECT id, code, security_level FROM doc_system WHERE id = $1`,
    [docId]
  );
  if (!doc) return { ok: false, reason: 'doc_missing' };
  if (doc.security_level === 'secret') return { ok: false, reason: 'doc_secret', doc };
  return { ok: true };
}

/**
 * 流程单据附件：完全复用 routes/flow.js 的可见性口径
 * （发起人 / 任务处理人 assignee / 抄送 cc），见 flow.js 上传附件处的注释与 SQL。
 */
async function checkFlow(instanceId, user) {
  if (!instanceId) return false;
  const hit = await one(
    `SELECT 1 AS ok
       FROM flow_instance fi
      WHERE fi.id = $1
        AND (
          fi.applicant_id = $2
          OR EXISTS (SELECT 1 FROM flow_task t WHERE t.instance_id = fi.id AND t.assignee_id = $2)
          OR EXISTS (SELECT 1 FROM flow_cc  c WHERE c.instance_id = fi.id AND c.user_id   = $2)
        )`,
    [instanceId, user.id]
  );
  return !!hit;
}

/**
 * 会议交付件：复用 meeting-service 的可见性口径
 * （管理权 / 提交人 / 主持人 / 记录人 / 创建人 / 参会人 / 同系列成员）。
 * 注意：meeting-service 的 isMeetingVisible 未导出，这里按其 SQL 等价实现，
 * 权限码同样取 'meeting:manage' / 'meeting:action'。
 */
async function checkMeeting(submissionId, user) {
  if (!submissionId) return false;
  if (hasAnyPerm(user, ['meeting:manage', 'meeting:action'])) return true;

  const hit = await one(
    `SELECT 1 AS ok
       FROM meeting_item_submission s
       LEFT JOIN meeting_action   ma ON s.item_type = 'action'   AND ma.id = s.item_id AND ma.deleted_at IS NULL
       LEFT JOIN meeting_decision md ON s.item_type = 'decision' AND md.id = s.item_id AND md.deleted_at IS NULL
       LEFT JOIN meeting m ON m.id = COALESCE(ma.meeting_id, md.meeting_id) AND m.deleted_at IS NULL
      WHERE s.id = $1
        AND (
          s.submitted_by = $2
          OR m.host_id    = $2
          OR m.recorder_id = $2
          OR m.created_by = $2
          OR EXISTS (SELECT 1 FROM meeting_attendee a WHERE a.meeting_id = m.id AND a.user_id = $2)
          OR EXISTS (
            SELECT 1 FROM meeting mm
              JOIN meeting_attendee a2 ON a2.meeting_id = mm.id AND a2.user_id = $2
             WHERE mm.series_id = s.series_id AND mm.deleted_at IS NULL
          )
        )`,
    [submissionId, user.id]
  );
  return !!hit;
}

/* ============================================================
 * 对外主入口
 * ============================================================ */

/**
 * 判定「该用户能否下载该文件」。
 *
 * @param {string} rel       `/api/files/*` 捕获到的相对路径（相对 uploads 根）
 * @param {object} user      req.user（org_user 行 + permissions/isAdmin/isApi）
 * @returns {Promise<{allowed:boolean, category:string, reason:string,
 *                    dimension?:string, doc?:{id:number, code:string}}>}
 *          `dimension` 用于日志：file_path / docId / instanceId / submissionId / folderId
 */
export async function authorizeFileDownload(rel, user) {
  const { clean, head, sub } = splitRel(rel);

  // 0) 管理员 / 外部系统服务身份：恒放行（与 flow.js 附件上传口径一致）
  if (user?.isAdmin || user?.isApi) {
    return { allowed: true, category: FILE_CATEGORY.MODULE, reason: 'admin' };
  }
  if (!user?.id) return { allowed: false, category: FILE_CATEGORY.UNKNOWN, reason: 'unknown' };

  // 1) 公共盘（先查，因为公共盘的 file_path 前缀由用户自建文件夹名决定，无固定形态）
  const driveFile = await one(
    `SELECT id, folder_id, uploaded_by FROM drive_file
      WHERE file_path = $1 AND deleted_at IS NULL LIMIT 1`,
    [clean]
  );
  if (driveFile) {
    const can = await checkDrive(user, driveFile);
    return {
      allowed: can,
      category: FILE_CATEGORY.DRIVE,
      reason: can ? 'drive_acl' : 'drive_denied',
      dimension: `folder_id=${driveFile.folder_id}`,
    };
  }

  // 2) attachment 归属记录（同一 file_path 可能被多条业务记录引用 → 任一授权通道命中即放行）
  const rows = await many(
    `SELECT id, biz_type, biz_id, instance_id, uploaded_by
       FROM attachment WHERE file_path = $1`,
    [clean]
  );

  let firstDeny = null;   // 记录「有记录但被拒」的强原因，用于收尾

  for (const row of rows) {
    // 2.1 受控文档
    if (row.biz_type === 'doc') {
      const r = await checkDoc(Number(row.biz_id));
      if (r.ok) {
        return { allowed: true, category: FILE_CATEGORY.DOC, reason: 'doc_readable', dimension: `doc_id=${row.biz_id}` };
      }
      if (r.reason === 'doc_secret') {
        return { allowed: false, category: FILE_CATEGORY.DOC, reason: 'doc_secret', dimension: `doc_id=${row.biz_id}`, doc: r.doc };
      }
      firstDeny = firstDeny || { reason: r.reason, category: FILE_CATEGORY.DOC, dimension: `doc_id=${row.biz_id}` };
      continue;
    }

    // 2.2 流程单据
    if (row.biz_type === 'flow') {
      const instanceId = row.instance_id || row.biz_id;
      if (await checkFlow(instanceId, user)) {
        return { allowed: true, category: FILE_CATEGORY.FLOW, reason: 'flow_visible', dimension: `instance_id=${instanceId}` };
      }
      firstDeny = { reason: 'flow_denied', category: FILE_CATEGORY.FLOW, dimension: `instance_id=${instanceId}` };
      continue;
    }

    // 2.3 会议交付件
    if (String(row.biz_type || '').startsWith('meeting')) {
      if (await checkMeeting(Number(row.biz_id), user)) {
        return { allowed: true, category: FILE_CATEGORY.MEETING, reason: 'meeting_visible', dimension: `submission_id=${row.biz_id}` };
      }
      firstDeny = { reason: 'meeting_denied', category: FILE_CATEGORY.MEETING, dimension: `submission_id=${row.biz_id}` };
      continue;
    }

    // 2.4 其余业务附件（ipqc / fai / equipment_inspect / knowledge / training …）
    //     这些业务的读取接口本身对所有登录用户开放（未见按人隔离），
    //     故附件同样对登录用户开放 —— 与现状一致，不制造新的 403。
    return {
      allowed: true,
      category: FILE_CATEGORY.MODULE,
      reason: `biz_readable:${row.biz_type}`,
      dimension: `biz=${row.biz_type}:${row.biz_id}`,
    };
  }

  // 3) 无 attachment 记录 → 按路径前缀兜底（覆盖「历史遗留 / 正文 docx / 版本文件」）
  if (head === 'docs' && /^\d+$/.test(sub)) {
    const r = await checkDoc(Number(sub));
    if (r.ok) {
      return { allowed: true, category: FILE_CATEGORY.DOC, reason: 'doc_path_readable', dimension: `doc_id=${sub}` };
    }
    if (r.reason === 'doc_secret') {
      return { allowed: false, category: FILE_CATEGORY.DOC, reason: 'doc_secret', dimension: `doc_id=${sub}`, doc: r.doc };
    }
    return { allowed: false, category: FILE_CATEGORY.DOC, reason: 'doc_missing', dimension: `doc_id=${sub}` };
  }

  if (head === 'flows' && /^\d+$/.test(sub)) {
    const ok = await checkFlow(Number(sub), user);
    return {
      allowed: ok,
      category: FILE_CATEGORY.FLOW,
      reason: ok ? 'flow_visible' : 'flow_denied',
      dimension: `instance_id=${sub}`,
    };
  }

  if (head === '.staging-tmp' || clean.startsWith('.staging-tmp/')) {
    return { allowed: false, category: FILE_CATEGORY.STAGING, reason: 'staging_denied' };
  }

  // 4) 有记录但全部被拒 → 用最强原因返回
  if (firstDeny) return { allowed: false, ...firstDeny };

  // 5) 完全无迹可循：仅管理员可下（调用方会记 warn，便于盘点历史孤儿文件）
  return { allowed: false, category: FILE_CATEGORY.UNKNOWN, reason: 'unknown' };
}
