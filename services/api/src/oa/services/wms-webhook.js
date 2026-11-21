/**
 * WMS 业务系统回调（出站 Webhook）
 * ------------------------------------------------------------
 * 设计：
 *  - 业务侧（flow-engine）在状态变化时只往 flow_webhook_outbox 写一条记录（与业务同事务），
 *    不直接发 HTTP，避免审批事务被外部系统拖死；
 *  - 独立投递任务轮询 outbox，失败指数退避；
 *  - 带 HMAC-SHA256 签名，WMS 侧验签。
 */
import crypto from 'node:crypto';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { getWmsWebhookConfig, getSystemConfig } from './integration-config.js';

const MAX_ATTEMPTS = 8;
/** 进程内重入守卫：上一轮投递未结束，新的 10s tick 直接跳过（B10） */
let running = false;

export function wmsWebhookConfig() {
  return getWmsWebhookConfig();
}

/** 写一条待投递事件（必须传事务句柄，保证与业务状态同事务）
 *  @returns {Promise<boolean>} 真的写进 outbox 了才返回 true；
 *    没配回调地址 / 没有 biz_system 时返回 false —— 调用方（对账）必须据此判断，
 *    否则会出现「说补发了、其实一条都没进队列」的谎报（QA 缺陷 C）。 */
export async function enqueueWmsEvent(tx, inst, event, extra = {}) {
  if (!inst || !inst.biz_system) return false; // 只推送外部业务系统单据
  const systemCode = String(inst.biz_system).toUpperCase();
  const sys = await getSystemConfig(systemCode).catch(() => null);
  const cfg = (sys && sys.webhookUrl)
    ? { url: sys.webhookUrl, secret: sys.webhookSecret || '' }
    : wmsWebhookConfig();
  if (!cfg.url) return false;

  const payload = {
    event,
    instanceId: Number(inst.id),
    instanceNo: inst.instance_no,
    bizSystem: inst.biz_system,
    bizType: inst.biz_type,
    bizKey: inst.biz_key,
    status: extra.status || inst.status,
    nodeIndex: extra.nodeIndex ?? inst.current_index ?? null,
    approver: extra.approver || null,
    comment: extra.comment || '',
    finalResult: inst.form_data?.final_result || null,
    occurredAt: new Date().toISOString(),
  };

  await tx.query(
    `INSERT INTO flow_webhook_outbox (instance_id, event, system_code, target_url, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [inst.id, event, systemCode, cfg.url, JSON.stringify(payload)]
  );
  return true;
}

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * 投递一批待发送事件（10s 一轮，由 src/server.js 的 setInterval 调起）。
 *
 * 【并发与重入 · QA 缺陷 B10】
 *   原实现是裸 `SELECT ... WHERE status='pending'`，无认领、无重入守卫：
 *   批 20 条 × 每条最长 8s ≫ 10s 周期 → 上一轮没跑完，下一轮读到同一批 → 同一事件重复投递。
 *   三层防护：
 *     ① 进程内重入守卫 `running`：上一轮未结束，本轮直接跳过（同一进程最快最省）；
 *     ② 原子认领：`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` 把 pending 一次性
 *        改成 sending 并 `attempts+1`，多进程/多实例下也不会重复取到同一行；
 *     ③ 卡死回收：sending 且 claimed_at 超过 10 分钟的视为进程崩溃遗留，按失败重新排队
 *        （否则事件会永远卡在 sending，且不会被告警统计到）。
 *
 * 【重试计数口径变更】
 *   attempts 改为「认领时 +1」（原实现是成功/失败各加一次，认领后崩溃则计数丢失）。
 *   因此失败分支不再 +1，直接沿用 RETURNING 回来的 row.attempts。
 *
 * 【幂等键】
 *   请求头补 `X-OA-Event-Id: oa-outbox-<outbox 行 id>-<event>`（稳定可推导，非随机）。
 *   本仓库内**没有**对端（WMS）的入站契约，故不改 payload body 结构，避免对端解析失败。
 */
export async function dispatchWmsOutbox(limit = 20) {
  if (running) return { skipped: true, sent: 0, failed: 0, reclaimed: 0, reason: 'busy' };
  running = true;
  try {
    const reclaimed = await reclaimStuck();
    const rows = (await query(
      `UPDATE flow_webhook_outbox o
          SET status = 'sending', claimed_at = now(), attempts = o.attempts + 1
        WHERE o.id IN (
              SELECT id FROM flow_webhook_outbox
               WHERE status = 'pending' AND next_retry_at <= now()
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED
        )
        RETURNING o.*`,
      [limit]
    )).rows;

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const body = JSON.stringify(row.payload);
      const sys = await getSystemConfig(row.system_code || 'WMS').catch(() => null);
      const secret = (sys && sys.webhookSecret) || wmsWebhookConfig().secret || '';
      const eventId = `oa-outbox-${row.id}-${row.event}`;
      try {
        const res = await fetch(row.target_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-OA-Signature': sign(body, secret),
            'X-OA-Event-Id': eventId,
          },
          body,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await query(
          `UPDATE flow_webhook_outbox
              SET status='sent', last_error=NULL, claimed_at=NULL
            WHERE id=$1 AND status='sending'`,
          [row.id]
        );
        sent += 1;
      } catch (e) {
        const attempts = Number(row.attempts) || 1; // 认领时已 +1
        const giveUp = attempts >= MAX_ATTEMPTS;
        const delaySec = Math.min(600, Math.pow(2, attempts) * 10);
        await query(
          `UPDATE flow_webhook_outbox
              SET attempts=$2,
                  status=$3,
                  last_error=$4,
                  claimed_at=NULL,
                  next_retry_at = now() + ($5 || ' seconds')::interval
            WHERE id=$1 AND status='sending'`,
          [row.id, attempts, giveUp ? 'failed' : 'pending', String(e?.message || e), String(delaySec)]
        );
        failed += 1;
      }
    }
    return { sent, failed, reclaimed };
  } finally {
    running = false;
  }
}

/** 卡死回收：认领后超过 10 分钟仍未回写结果的行（进程崩溃/OOM 遗留）重新排队或判失败 */
async function reclaimStuck() {
  try {
    const r = await query(
      `UPDATE flow_webhook_outbox
          SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'pending' END,
              last_error = '[卡死回收] 认领后超时未回写结果，视为投递中断',
              claimed_at = NULL,
              next_retry_at = now()
        WHERE status = 'sending'
          AND claimed_at IS NOT NULL
          AND claimed_at < now() - interval '10 minutes'
        RETURNING id`,
      [MAX_ATTEMPTS]
    );
    if (r.rowCount) console.warn(`[wms-webhook] 卡死回收 ${r.rowCount} 条：${r.rows.map(x => x.id).join(',')}`);
    return r.rowCount || 0;
  } catch (e) {
    console.warn('[wms-webhook] 卡死回收失败（已忽略）:', e?.message || e);
    return 0;
  }
}
