/**
 * 集成中枢 · 告警
 * ------------------------------------------------------------
 * 解决的问题：回写失败的事件原来只是把 outbox 行置成 'failed'，
 * 之后没人知道、也没人处理（用户 2026-10-26 要求补齐）。
 *
 * 规则：
 *  - 一个「异常对象」一个 alert_key（如 outbox_failed:123），未关闭前重复命中
 *    只累加 hit_count、刷新 last_seen_at，不重复通知，避免刷屏；
 *  - 新告警（或关闭后重新开）才通知系统管理员：站内信 + 邮件/飞书（按全局配置）；
 *  - 条件消失后自动关闭：每轮扫描开始前取时间戳，扫描完把「本轮没再命中」的
 *    同类告警置 closed，不用人工去点。
 *
 * 只读外部系统的都是本文件之外的模块；这里只读 OA 自己的表。
 */
import { many, one, query } from '../db/index.js';
import { notifyMany } from './notify.js';
import { listAdminUserIds } from '../utils/admin.js';

/** 告警类别 → 中文（前端不重复维护一份） */
export const ALERT_CATEGORY_TEXT = {
  outbox_failed: '回写失败',
  outbox_stuck: '回写卡住',
  outbox_backlog: '回写积压',
  system_test: '系统不可达',
  reconcile_diff: '对账差异',
};

const SCAN_CATEGORIES = ['outbox_failed', 'outbox_stuck', 'outbox_backlog', 'system_test'];

/**
 * 通知节流：同一类别 30 秒内只推一条站内信。
 * 场景：一次扫描可能同时发现 50 条 failed 事件，逐条通知会把管理员信箱打爆；
 * 告警本身一条不少（列表里都在），只是不重复推消息。代价是极端并发下会少推几条通知。
 */
const NOTIFY_GAP_MS = 30_000;
const lastNotifyAt = new Map();


/**
 * 产生（或累加）一条告警。
 * @returns {Promise<{id:number,isNew:boolean,hitCount:number}|null>}
 */
export async function raiseAlert({
  key, level = 'amber', category, systemCode = null, title, detail = '',
  refType = null, refId = null, notify = true,
} = {}) {
  if (!key || !category || !title) return null;
  // xmax = 0 ⇒ 本次是 INSERT（新告警）；否则是 ON CONFLICT 命中（已有未关闭告警）
  const row = await one(
    `INSERT INTO sys_integration_alert
       (alert_key, level, category, system_code, title, detail, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (alert_key) WHERE status <> 'closed'
     DO UPDATE SET hit_count    = sys_integration_alert.hit_count + 1,
                   last_seen_at = now(),
                   level        = EXCLUDED.level,
                   title        = EXCLUDED.title,
                   detail       = EXCLUDED.detail,
                   -- 已 ack 的告警再次命中，说明问题还在，退回 open 让它在列表里冒头
                   status       = CASE WHEN sys_integration_alert.status = 'ack' THEN 'open'
                                       ELSE sys_integration_alert.status END
     RETURNING id, hit_count, status, (xmax = 0) AS is_new`,
    [String(key).slice(0, 200), level, category, systemCode, String(title).slice(0, 200), detail, refType, refId]
  );
  // 用 hit_count=1 判断「新告警」比依赖 xmax 更稳（审计 F-13）：
  // ON CONFLICT 命中时 hit_count 必然已经 >=1，只有真正 INSERT 才会是 1
  const isNew = Number(row?.hit_count) === 1;
  if (isNew && notify) {
    const now = Date.now();
    const last = lastNotifyAt.get(category) || 0;
    if (now - last >= NOTIFY_GAP_MS) {
      lastNotifyAt.set(category, now);
      // 通知失败不能影响扫描主流程
      pushToAdmins({ ...row, level, title, detail, category, systemCode }).catch(() => {});
    }
  }
  return { id: row?.id, isNew, hitCount: row?.hit_count };
}

async function pushToAdmins({ level, title, detail, category, systemCode }) {
  const ids = await listAdminUserIds().catch(() => []);
  if (!ids.length) return 0;
  const tag = level === 'red' ? '【集成告警·严重】' : '【集成告警】';
  return notifyMany(ids, {
    title: `${tag}${title}`,
    content: [detail, systemCode ? `系统：${systemCode}` : '', `类别：${ALERT_CATEGORY_TEXT[category] || category}`]
      .filter(Boolean).join('\n'),
    link: '/integration-console.html',
    category: 'system',
  });
}

/**
 * 关闭「本轮确认过、且症状确实消失」的告警。
 * @param {string[]} categories 本轮扫描涉及的类别
 * @param {Date} sinceTs 本轮扫描开始时间
 * @param {string[]} seenKeys 本轮**实际产生/命中**的 alert_key（必须传，防止误关，审计 F-01）
 */
export async function closeStaleAlerts(categories, sinceTs, seenKeys = []) {
  if (!categories?.length || !sinceTs) return 0;
  const r = await query(
    `UPDATE sys_integration_alert
        SET status = 'closed', closed_at = now(), closed_reason = 'auto_not_seen'
      WHERE status <> 'closed'
        AND category = ANY($1)
        AND last_seen_at < $2
        AND alert_key <> ALL($3::text[])`,
    [categories, sinceTs, seenKeys]
  );
  return r.rowCount || 0;
}

/** 清理过期已关闭记录（默认留 90 天），由对账任务顺带调用，避免告警表无限长大 */
export async function purgeOldAlerts(days = 90) {
  const d = Math.max(7, Math.min(3650, Number(days) || 90));
  const r = await query(
    `DELETE FROM sys_integration_alert
      WHERE status = 'closed'
        AND COALESCE(closed_at, last_seen_at) < now() - ($1 || ' days')::interval`,
    [String(d)]
  );
  return r.rowCount || 0;
}

/**
 * 扫描一轮告警。由定时任务每 5 分钟调用，也可手动触发。
 * @returns {Promise<{raised:number,closed:number,checked:{failed:number,stuck:number,pending:number}}>}
 */
export async function scanIntegrationAlerts() {
  const startedAt = (await one(`SELECT now() AS t`))?.t;
  let raised = 0;
  // 本轮实际产生/命中的 key：只有它们允许参与「自动关闭」判断（审计 F-01）
  const seen = new Set();
  const markRaised = async (opts) => {
    seen.add(opts.key);
    const r = await raiseAlert(opts);
    if (r?.isNew) raised += 1;
    return r;
  };

  /* ① 投递彻底失败（重试 8 次后置 failed，永不自动重试） */
  const LIMIT = 50;
  const failed = await many(
    `SELECT id, system_code, event, instance_id, attempts, last_error, created_at,
            payload->>'instanceNo' AS instance_no
       FROM flow_webhook_outbox
      WHERE status = 'failed'
      ORDER BY id DESC LIMIT $1`,
    [LIMIT]
  );
  for (const r of failed) {
    await markRaised({
      key: `outbox_failed:${r.id}`,
      level: 'red',
      category: 'outbox_failed',
      systemCode: r.system_code,
      title: `回写 ${r.system_code || ''} 失败：${r.instance_no || ('单据#' + r.instance_id)}`,
      detail: [
        `事件：${r.event}`,
        `尝试次数：${r.attempts}`,
        `最后错误：${String(r.last_error || '—').slice(0, 300)}`,
        '处理：到「事件日志」里点重放，或修复对方地址/密钥后自动重试',
      ].join('\n'),
      refType: 'outbox',
      refId: r.id,
    });
  }

  /* ② 卡住：还在 pending，但已经超过 30 分钟没投出去（正常 10 秒一轮）
   *
   * 为什么不把 'sending' 也算进来（B10 引入该状态后特意核对过）：
   *   sending 是「本轮正在投递」的短暂瞬间，单条最长 8s（AbortSignal.timeout(8000)）；
   *   即使进程半途崩溃，wms-webhook.js 的 reclaimStuck() 会在 10 分钟后把它改回 pending/failed。
   *   也就是说 sending 的寿命被硬约束在 ≤10 分钟 < 本告警的 30 分钟阈值 —— 没有盲区，
   *   而把 sending 纳入反而会误报：认领时不动 next_retry_at，一条「已到期 30 分钟才被认领」
   *   的行会在飞行途中直接命中 `next_retry_at < now()-30min`。故此处保持 pending-only。
   */
  const stuck = await many(
    `SELECT id, system_code, event, instance_id, attempts, last_error,
            payload->>'instanceNo' AS instance_no
       FROM flow_webhook_outbox
      WHERE status = 'pending' AND next_retry_at < now() - interval '30 minutes'
      ORDER BY id LIMIT $1`,
    [LIMIT]
  );
  for (const r of stuck) {
    await markRaised({
      key: `outbox_stuck:${r.id}`,
      level: 'amber',
      category: 'outbox_stuck',
      systemCode: r.system_code,
      title: `回写卡住 30 分钟：${r.instance_no || ('单据#' + r.instance_id)}`,
      detail: `事件：${r.event}\n已尝试：${r.attempts} 次\n最后错误：${String(r.last_error || '—').slice(0, 300)}`,
      refType: 'outbox',
      refId: r.id,
    });
  }

  /* ③ 积压：待投递超过 100 条（一轮只投 20 条，说明对方一直不通）
   *   口径含 'sending'：投递任务一轮会认领最多 20 行进 sending，若只数 pending，
   *   这 20 行在对端不通（每批最长 160s）期间会从计数里「消失」，100 的阈值最多被低估 20 条。
   *   这里只对齐「在途」的判定，阈值 100 与 amber 分级均未改动。
   */
  const pendingCount = Number((await one(
    `SELECT count(*)::int AS n FROM flow_webhook_outbox WHERE status IN ('pending','sending')`
  ))?.n || 0);
  if (pendingCount > 100) {
    await markRaised({
      key: 'outbox_backlog',
      level: 'amber',
      category: 'outbox_backlog',
      title: `回写队列积压 ${pendingCount} 条`,
      detail: '待投递事件超过 100 条，通常是对端不可达或验签一直失败。检查「系统连接」里的地址与密钥。',
    });
  }

  /* ④ 系统最近一次连通性测试失败 */
  const badSystems = await many(
    `SELECT system_code, name, last_test_error
       FROM sys_integration_system
      WHERE enabled = TRUE AND last_test_ok = FALSE`
  );
  for (const s of badSystems) {
    await markRaised({
      key: `system_test:${s.system_code}`,
      level: 'amber',
      category: 'system_test',
      systemCode: s.system_code,
      title: `${s.name || s.system_code} 最近一次连接测试失败`,
      detail: String(s.last_test_error || '—').slice(0, 300),
    });
  }

  /* 本轮结果被截断时不自动关闭：否则第 51 条以后的告警会被误关（审计 F-01） */
  const truncated = failed.length >= LIMIT || stuck.length >= LIMIT;
  let closed = 0;
  let closeSkipped = '';
  if (truncated) {
    closeSkipped = `本轮结果被截断（失败 ${failed.length} / 卡住 ${stuck.length} 条，上限 ${LIMIT}），跳过自动关闭`;
  } else {
    closed = await closeStaleAlerts(SCAN_CATEGORIES, startedAt, [...seen]);
  }
  return { raised, closed, closeSkipped, checked: { failed: failed.length, stuck: stuck.length, pending: pendingCount } };
}

/* ------------------------------ 查询 / 处理 ------------------------------ */

export async function listAlerts({ status = 'open', limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(n);
  const rows = await many(
    `SELECT a.*, u.real_name AS acked_by_name,
            CASE a.category
              WHEN 'outbox_failed'  THEN '回写失败'
              WHEN 'outbox_stuck'   THEN '回写卡住'
              WHEN 'outbox_backlog' THEN '回写积压'
              WHEN 'system_test'    THEN '系统不可达'
              WHEN 'reconcile_diff' THEN '对账差异'
              ELSE a.category END AS category_text
       FROM sys_integration_alert a
       LEFT JOIN org_user u ON u.id = a.acked_by
       ${w}
      ORDER BY CASE a.level WHEN 'red' THEN 0 ELSE 1 END, a.last_seen_at DESC
      LIMIT $${params.length}`,
    params
  );
  const counts = await one(
    `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
            count(*) FILTER (WHERE status = 'open' AND level = 'red')::int AS red,
            count(*) FILTER (WHERE status = 'ack')::int AS ack
       FROM sys_integration_alert`
  );
  return { list: rows, counts: counts || { open: 0, red: 0, ack: 0 } };
}

/** 标记已处理（人工确认知道这件事了；问题若再次命中会自动退回 open） */
export async function ackAlert(id, userId) {
  const row = await one(
    `UPDATE sys_integration_alert
        SET status = 'ack', acked_at = now(), acked_by = $2
      WHERE id = $1 AND status = 'open'
      RETURNING id, status`,
    [Number(id), userId || null]
  );
  if (!row) {
    const exists = await one(`SELECT id, status FROM sys_integration_alert WHERE id = $1`, [Number(id)]);
    if (!exists) throw Object.assign(new Error('告警不存在'), { statusCode: 404, isBiz: true });
    return exists; // 已经是 ack/closed，幂等返回
  }
  return row;
}

/** 顶部小卡片用：未处理数量 + 是否红 */
export async function alertBadge() {
  const r = await one(
    `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
            count(*) FILTER (WHERE status = 'open' AND level = 'red')::int AS red
       FROM sys_integration_alert`
  );
  return r || { open: 0, red: 0 };
}
