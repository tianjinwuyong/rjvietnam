// ============================================================
// 受控文件评审 · 阅读痕迹（doc-review-read）
// ------------------------------------------------------------
// 解决一个 ISO 外审必问的问题：审批人点「通过」时，到底看过文件没有？
//
// 之前的做法只在界面上写一句"请先阅读正文再决定是否通过"——提示归提示，
// 技术上仍然可以直接点通过，库里也没有任何证据。
//
// 这里的口径：
//   · 前端渲染出正文 → POST /api/instances/:id/doc-read → 落一条痕迹（chars 实测）
//   · 审批（approval 类型节点）→ assertDocReviewed() → 没有痕迹就 409 拦住
//   · 正文确实读不了（纸质/扫描件/该版本无正文）→ 审批人显式「确认未读通过」，
//     落 waived_at + 原因；这是**有记录的例外**，不是静默放行
//
// 只对「单据带了 doc_id（体系文件受控发行一类）」生效；请假、领料等单据完全不受影响。
// ============================================================
import { one, query } from '../db/index.js';

/** 单据 → 被评审文件（无关联文件时返回 null） */
function docCtxOf(formData) {
  const form = formData || {};
  const docId = Number(form.doc_id || 0);
  if (!docId) return null;
  return { docId, version: String(form.version || '') };
}

/**
 * 该版本是否存在"可读正文"。
 * 没有正文的版本（只挂了扫描件/纸质版）不能要求"读正文"，否则审批人永远过不去。
 */
export async function hasReadableContent(docId, version) {
  const row = await one(
    `SELECT 1 AS ok FROM doc_version_lang
      WHERE doc_id = $1 AND version = $2 AND length(COALESCE(content, '')) > 0
      LIMIT 1`,
    [docId, version]
  );
  return !!row;
}

/** 服务端实测该语言正文长度——不采信前端上报的字符数 */
async function contentLength(docId, version, lang) {
  const row = await one(
    `SELECT length(COALESCE(content, '')) AS n FROM doc_version_lang
      WHERE doc_id = $1 AND version = $2 AND lang = $3`,
    [docId, version, lang]
  );
  return Number(row?.n || 0);
}

/** 读取某人在某单上的阅读档案（无则 null） */
export async function getReadRow(instanceId, userId) {
  return one(
    `SELECT instance_id, doc_id, version, user_id, langs, chars, dwell_ms,
            read_count, first_read_at, last_read_at, waived_at, waive_reason
       FROM doc_review_read
      WHERE instance_id = $1 AND user_id = $2`,
    [instanceId, userId]
  );
}

/**
 * 痕迹是否对"当前这版"有效。
 * 单据撤回重提可能换版本（V1.0 → V2.0），旧痕迹不能算数 —— 否则读的是上一版，
 * 却拿去批新版，正是 ISO 要防的"没看就批"。
 */
function freshFor(row, version) {
  if (!row) return null;
  const v = String(version || '');
  if (v && String(row.version || '') !== v) return null;   // 版本对不上 → 视为没读
  return row;
}

/**
 * 落阅读痕迹（前端渲染出正文后调用）。
 * 重复调用只累加：read_count+1、dwell_ms 取较大值、langs 去重合并、chars 取较大值。
 */
export async function recordRead({ instanceId, docId, version, userId, lang, dwellMs, ip, ua }) {
  const l = lang === 'vi' ? 'vi' : 'zh';
  const chars = await contentLength(docId, version, l);
  // 前端上报的是"抽屉打开且有正文"的时长，只作参考值；上限一天，防止被塞天文数字
  const dwell = Math.max(0, Math.min(Number(dwellMs) || 0, 86400000));

  const row = await one(
    `INSERT INTO doc_review_read
       (instance_id, doc_id, version, user_id, langs, chars, dwell_ms, read_count, ip, ua)
     VALUES ($1, $2, $3, $4, ARRAY[$5]::text[], $6, $7, 1, $8, $9)
     ON CONFLICT (instance_id, user_id) DO UPDATE SET
       -- 版本变了就是"换了一版文件"，旧版的字符数/语言/时长一律不继承
       langs        = CASE WHEN doc_review_read.version = EXCLUDED.version
                           THEN ARRAY(SELECT DISTINCT unnest(doc_review_read.langs || EXCLUDED.langs))
                           ELSE EXCLUDED.langs END,
       chars        = CASE WHEN doc_review_read.version = EXCLUDED.version
                           THEN GREATEST(doc_review_read.chars, EXCLUDED.chars)
                           ELSE EXCLUDED.chars END,
       dwell_ms     = CASE WHEN doc_review_read.version = EXCLUDED.version
                           THEN GREATEST(doc_review_read.dwell_ms, EXCLUDED.dwell_ms)
                           ELSE EXCLUDED.dwell_ms END,
       read_count   = CASE WHEN doc_review_read.version = EXCLUDED.version
                           THEN doc_review_read.read_count + 1 ELSE 1 END,
       version      = EXCLUDED.version,
       last_read_at = now(),
       ip           = COALESCE(EXCLUDED.ip, doc_review_read.ip),
       ua           = COALESCE(EXCLUDED.ua, doc_review_read.ua)
     RETURNING instance_id, version, chars, dwell_ms, read_count, last_read_at, waived_at`,
    [instanceId, docId, version, userId, l, chars, dwell, ip || null, ua || null]
  );
  return row;
}

/** 记录"确认未阅读仍要通过"（审批人显式豁免，写原因备审计） */
export async function recordWaiver({ instanceId, docId, version, userId, reason, ip, ua }) {
  const why = String(reason || '').trim();
  if (why.length < 2) {
    const err = new Error('请填写未阅读正文的原因（至少 2 个字），该内容会记入审计痕迹');
    err.statusCode = 400;
    throw err;
  }
  const row = await one(
    `INSERT INTO doc_review_read
       (instance_id, doc_id, version, user_id, chars, waived_at, waive_reason, ip, ua)
     VALUES ($1, $2, $3, $4, 0, now(), $5, $6, $7)
     ON CONFLICT (instance_id, user_id) DO UPDATE SET
       -- 换了版本：旧版读过的字符数不作数，豁免重新记到新版本上
       chars        = CASE WHEN doc_review_read.version = EXCLUDED.version
                           THEN doc_review_read.chars ELSE 0 END,
       version      = EXCLUDED.version,
       waived_at    = now(),
       waive_reason = EXCLUDED.waive_reason,
       ip           = COALESCE(EXCLUDED.ip, doc_review_read.ip),
       ua           = COALESCE(EXCLUDED.ua, doc_review_read.ua)
     RETURNING instance_id, version, waived_at, waive_reason`,
    [instanceId, docId, version, userId, why, ip || null, ua || null]
  );
  return row;
}

/**
 * 审批前置校验口径（供 /read-status 与 approveTask 共用）：
 *   required = 单据关联了文件 且 该版本确实有正文
 *   satisfied = 读过（chars>0） 或 已显式豁免（waived_at 非空）
 */
export async function getReadStatus({ instanceId, userId, formData }) {
  const ctx = docCtxOf(formData);
  if (!ctx) return { required: false, reason: 'no_doc' };

  const hasContent = await hasReadableContent(ctx.docId, ctx.version);
  if (!hasContent) {
    // 没有正文（只挂附件/纸质版）：不拦审批，但把情况说清楚，前端据此改成"看附件"
    return { required: false, reason: 'no_content', docId: ctx.docId, version: ctx.version };
  }

  const raw = await getReadRow(instanceId, userId);
  const row = freshFor(raw, ctx.version);      // 版本对不上 = 没读过这一版
  const read = !!row && Number(row.chars) > 0;
  const waived = !!row && !!row.waived_at;
  return {
    required: true,
    reason: read ? 'read' : (waived ? 'waived' : (raw ? 'stale_version' : 'unread')),
    satisfied: read || waived,
    docId: ctx.docId,
    version: ctx.version,
    read,
    readAt: row?.last_read_at || null,
    chars: Number(row?.chars || 0),
    dwellMs: Number(row?.dwell_ms || 0),
    readCount: Number(row?.read_count || 0),
    langs: row?.langs || [],
    waived,
    waivedAt: row?.waived_at || null,
    waiveReason: row?.waive_reason || null,
    // 有痕迹但版本对不上时，把"读的是哪一版"告诉前端，便于提示"该版已换，请重读"
    staleVersion: raw && !row ? String(raw.version || '') : null,
  };
}

/**
 * 审批闸门：没读就抛 409。
 * 放在引擎里（而不是路由）是为了同时覆盖单条与批量审批。
 */
export async function assertDocReviewed({ instanceId, userId, formData }) {
  const ctx = docCtxOf(formData);
  if (!ctx) return;
  if (!(await hasReadableContent(ctx.docId, ctx.version))) return;

  const raw = await getReadRow(instanceId, userId);
  const row = freshFor(raw, ctx.version);
  if (row && (Number(row.chars) > 0 || row.waived_at)) return;

  // 读的是上一版（撤回重提换了版本）→ 也要挡住，并说清原因
  const stale = !!raw && !row;
  const err = new Error(stale
    ? '您阅读的是该文件的上一版本，请先阅读本次评审版本的正文再审批（ISO 9001 7.5.2）'
    : '请先阅读受审文件正文再审批（ISO 9001 7.5.2 评审记录要求）');
  err.statusCode = 409;
  throw err;
}

/** 本单所有阅读痕迹（审计用：谁读了、谁豁免了、什么时候） */
export async function listReads(instanceId) {
  return query(
    `SELECT r.user_id, u.real_name, u.username, r.chars, r.dwell_ms, r.read_count,
            r.langs, r.first_read_at, r.last_read_at, r.waived_at, r.waive_reason
       FROM doc_review_read r
       LEFT JOIN org_user u ON u.id = r.user_id
      WHERE r.instance_id = $1
      ORDER BY r.last_read_at DESC`,
    [instanceId]
  );
}
