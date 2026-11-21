/**
 * 集成中枢 · 对账
 * ------------------------------------------------------------
 * 原来只有 iqc-reconcile-service.js，而且它直连 WMS 数据库（wmsQuery）。
 * 这台机器到 WMS 只开 3000 端口，PG 端口全不通 → 那段对账实际跑不起来。
 * 本文件改用两条「已经验证可通」的路子：
 *   ① 回写对账：只查 OA 自己的 flow_instance / flow_webhook_outbox
 *   ② IQC 对账：走 WMS 的 HTTP 接口（/api/iqc/pending），不碰数据库
 *
 * 三类差异（IQC）：
 *   🔴 OA 已提交/已审批，但 WMS 仍把它挂在待检池  → 结果没落地，库存没放行，必须人工看
 *   🟠 WMS 有待检批次，OA 镜像里没有             → 漏拉了，页面会少单
 *   🟡 OA 显示待检，WMS 早已处理                 → 页面积压「假待检」
 *
 * 会自动补的只有一种：回写对账里「本该发但没发/发失败」的事件 → 重新入队一次。
 * 其余只记录 + 告警，绝不擅自改外部系统的状态。
 */
import { many, one, query } from '../db/index.js';
import { getWmsLoginConfig } from './wms-iqc-live.js';
import { apiGet } from './wms-iqc-pull.js';
import { enqueueWmsEvent } from './wms-webhook.js';
import { raiseAlert, purgeOldAlerts } from './integration-alert.js';

const PAGE_SIZE = 200;
const MAX_PAGES = 30;
/** 只核对「审批完成」类终态；terminated/withdrawn 不走 completed 事件（见 reconcileOutbox 注释） */
const DONE_STATUS = ['completed', 'archived'];
/** 对账自动补发上限：超过就不再加量重试，只留告警等人处理（审计 F-03） */
const MAX_AUTO_RETRY = 3;

/* ------------------------------ ① 回写对账 ------------------------------ */

/**
 * 核对「OA 已到终态的外部单据」是否真的把结果送出去了。
 * @param {{hours?:number, autoRetry?:boolean}} opts
 */
export async function reconcileOutbox({ hours = 72, autoRetry = true } = {}) {
  const h = Math.max(1, Math.min(24 * 30, Number(hours) || 72));
  // 只认 event='completed'：terminated/withdrawn 走的是 rejected 事件、历史上根本没发过，
  // 把它们纳入会变成永久红告警（安全审计 F-14）
  const rows = await many(
    `SELECT i.id, i.instance_no, i.biz_system, i.biz_type, i.biz_key, i.status,
            i.current_index, i.form_data, i.updated_at,
            d.id AS outbox_id, d.event AS outbox_event, d.status AS outbox_status,
            d.attempts, d.last_error, COALESCE(d.manual_retry_count, 0) AS manual_retry_count
       FROM flow_instance i
       LEFT JOIN LATERAL (
         SELECT o.id, o.event, o.status, o.attempts, o.last_error, o.manual_retry_count
           FROM flow_webhook_outbox o
          WHERE o.instance_id = i.id AND o.event = 'completed'
          ORDER BY o.id DESC LIMIT 1
       ) d ON TRUE
      WHERE i.biz_system IS NOT NULL
        AND i.status = ANY($1::text[])
        AND i.updated_at > now() - ($2 || ' hours')::interval
      ORDER BY i.updated_at DESC
      LIMIT 500`,
    [DONE_STATUS, String(h)]
  );

  // 系统被主动停用时一律不自动补发：人关掉的开关，程序不要偷偷打开（审计 F-08）
  const disabled = new Set(
    (await many(`SELECT system_code FROM sys_integration_system WHERE enabled = FALSE`))
      .map((r) => String(r.system_code).toUpperCase())
  );

  const items = [];
  let resent = 0;
  let retried = 0;
  let capped = 0;

  for (const r of rows) {
    const sysCode = String(r.biz_system || '').toUpperCase();
    const base = {
      refType: 'instance',
      refId: r.id,
      instanceNo: r.instance_no,
      system: r.biz_system,
      bizType: r.biz_type,
      bizKey: r.biz_key,
      instanceStatus: r.status,
      outboxId: r.outbox_id || null,
      outboxStatus: r.outbox_status || null,
      attempts: r.attempts || 0,
      error: r.last_error || '',
    };

    /* 情况 A：审批完成了，但一条 completed 回写记录都没有 */
    if (!r.outbox_id) {
      let action = 'missing';
      if (autoRetry && !disabled.has(sysCode)) {
        try {
          const queued = await enqueueWmsEvent({ query }, {
            id: r.id, instance_no: r.instance_no, biz_system: r.biz_system,
            biz_type: r.biz_type, biz_key: r.biz_key, status: r.status,
            current_index: r.current_index, form_data: r.form_data,
          }, 'completed', { status: r.status });
          // enqueue 在「没配回调地址」时返回 false，不能报成补发成功（QA 缺陷 C）
          if (queued) {
            action = 'resent';
            resent += 1;
          } else {
            action = 'skipped_no_webhook';
          }
        } catch (e) {
          action = 'resend_failed';
          base.error = e.message;
        }
      } else if (disabled.has(sysCode)) {
        action = 'skipped_disabled';
      }
      const skippedCfg = action === 'skipped_disabled' || action === 'skipped_no_webhook';
      items.push({ ...base, kind: 'missing_outbox', level: skippedCfg ? 'amber' : 'red', action });
      continue;
    }

    if (r.outbox_status === 'sent') continue;

    /* 情况 B：有记录但还没送达 */
    /*
     * 在途 = pending（排队/退避中）**或 sending（本轮正在投递，见 wms-webhook.js 的原子认领）**。
     * 少了 'sending' 会漏判：投递任务把行认领成 sending 的那段时间（单条最长 8s），
     * 对账若正好扫到，会落到下方 `action = r.outbox_status` 变成 level:'red'，
     * 进而 raiseAlert「对账差异：…未回写」——把在途事件误报成未送达（QA 缺陷 B10 的回归风险）。
     * 未送达与否只由 pending/failed 表达，sending 永远属于「还在路上」。
     */
    if (r.outbox_status === 'pending' || r.outbox_status === 'sending') {
      // 还在队列里正常重试 / 正在投递，不算差异（否则每次对账都报一堆噪音）
      items.push({ ...base, kind: 'inflight', level: 'ok', action: 'inflight' });
      continue;
    }

    let action = r.outbox_status || 'unknown';
    if (r.outbox_status === 'failed') {
      if (disabled.has(sysCode)) {
        action = 'skipped_disabled';
      } else if (!autoRetry) {
        action = 'failed';
      } else if (Number(r.manual_retry_count) >= MAX_AUTO_RETRY) {
        action = 'retry_capped';
        capped += 1;
      } else {
        // 置回 pending 让 10 秒一轮的投递任务再跑，并记账（上限 3 次，防止无限重发，审计 F-03）
        await query(
          `UPDATE flow_webhook_outbox
              SET status = 'pending', next_retry_at = now(), attempts = 0,
                  manual_retry_count = manual_retry_count + 1
            WHERE id = $1 AND status = 'failed'`,
          [r.outbox_id]
        );
        action = 'retried';
        retried += 1;
      }
    }
    items.push({ ...base, kind: 'undelivered', level: 'red', action });
  }

  const realDiffs = items.filter((i) => i.level !== 'ok').length;
  return {
    checked: rows.length,
    diffs: realDiffs,
    resent,
    retried,
    capped,
    items,
    hours: h,
  };
}

/* ------------------------------ ② IQC 对账 ------------------------------ */

/** 拉 WMS 待检池（pending + rejected），只读 */
async function fetchWmsPendingLots() {
  const cfg = await getWmsLoginConfig();
  if (!cfg) return { skipped: '未配置 WMS 登录账号' };
  const map = new Map();
  const errors = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    let page;
    try {
      page = await apiGet(cfg, '/api/iqc/pending', {
        page: p, pageSize: PAGE_SIZE, statuses: 'pending,rejected',
      });
    } catch (e) {
      errors.push(`第 ${p} 页：${e.message}`);
      break;
    }
    const arr = Array.isArray(page?.items) ? page.items : [];
    for (const it of arr) {
      const lotNo = String(it.lotNo || '').trim();
      if (lotNo) map.set(lotNo, {
        inspectionNo: it.inspectionNo || '',
        materialCode: it.materialCode || '',
        status: it.status || '',
      });
    }
    const total = Number(page?.total) || 0;
    if (!arr.length || map.size >= total) break;
  }
  // WMS 一页都没拿到（401/超时/网络不通）时，绝不能拿空集合和 OA 对账：
  // 否则 219 条镜像会被全部判成「假待检」，瞬时喷 219 条假差异（QA 缺陷 A）
  if (!map.size && errors.length) {
    return { skipped: `WMS 接口不可达，本轮不做 IQC 对账：${errors[0]}` };
  }
  return { map, errors, total: map.size };
}

/**
 * IQC 三向对账（走 HTTP，不依赖 WMS 数据库）。
 * @param {{limit?:number}} opts
 */
export async function reconcileIqc({ limit = 200 } = {}) {
  const wms = await fetchWmsPendingLots();
  if (wms.skipped) return { skipped: wms.skipped, diffs: 0, items: [] };

  const mirror = await many(
    `SELECT lot_no, inspection_no, material_code, status, wms_status
       FROM iqc_lot_mirror`
  );
  const oa = new Map(mirror.map((r) => [r.lot_no, r]));
  const items = [];
  // 只拉到部分页时，「WMS 里没有」不代表真没有，这类判断一律不成立（QA 已知局限）
  const partial = (wms.errors || []).length > 0;

  /* 🟠 WMS 有、OA 没有 → 漏拉 */
  for (const [lotNo, w] of wms.map) {
    if (!oa.has(lotNo)) {
      items.push({
        kind: 'missing_in_oa', level: 'amber', lotNo,
        inspectionNo: w.inspectionNo, materialCode: w.materialCode,
        detail: 'WMS 待检池里有这条，OA 镜像没有（会漏单）',
      });
    }
  }

  for (const [lotNo, r] of oa) {
    /* 🟡 OA 待检、WMS 已不在待检池 → 页面积压「假待检」 */
    if (r.status === 'pending' && !wms.map.has(lotNo)) {
      if (partial) continue; // 只拉到部分页，无法断言「WMS 真没有」
      items.push({
        kind: 'stale_pending', level: 'amber', lotNo,
        inspectionNo: r.inspection_no, materialCode: r.material_code,
        detail: 'OA 仍显示待检，WMS 已处理完（下次自动同步会收口）',
      });
      continue;
    }
    /* 🔴 OA 已提交/已审批、WMS 还挂在待检池 → 结果没落地 */
    if ((r.status === 'submitted' || r.status === 'approved') && wms.map.has(lotNo)) {
      items.push({
        kind: 'oa_ahead', level: 'red', lotNo,
        inspectionNo: r.inspection_no, materialCode: r.material_code,
        detail: `OA 状态 ${r.status}，但 WMS 仍是待检（库存未放行）→ 需要重试回写或人工处理`,
      });
    }
  }

  return {
    checked: { wms: wms.map.size, oa: oa.size },
    diffs: items.length,
    errors: wms.errors,
    items: items.slice(0, Math.max(20, limit)),
  };
}

/* --------------------------- ③ 汇总 + 落库 + 告警 --------------------------- */

/**
 * 跑一轮完整对账。定时任务与「立即对账」按钮共用。
 * @param {{hours?:number, iqc?:boolean, actor?:number, kind?:string}} opts
 */
async function doReconcile({ hours = 72, iqc = true, actor = null, kind = 'manual' } = {}) {
  const run = await one(
    `INSERT INTO sys_integration_reconcile_run (kind, triggered_by, summary)
     VALUES ($1,$2,'{}'::jsonb) RETURNING id`,
    [String(kind).slice(0, 20), actor || null]
  );
  const startedAt  = (await one(`SELECT now() AS t`))?.t;

  const out = { outbox: null, iqc: null, alerts: { raised: 0, closed: 0 } };
  const items = [];

  try {
    out.outbox = await reconcileOutbox({ hours, autoRetry: true });
    for (const it of out.outbox.items) {
      items.push({ scope: 'outbox', ...it });
      // level='ok' 是「还在队列里正常重试」，不算差异，不进告警台
      if (it.level === 'ok') continue;
      await raiseAlert({
        key: `reconcile_diff:instance:${it.refId}`,
        level: it.level || 'amber',
        category: 'reconcile_diff',
        systemCode: it.system,
        title: `对账差异：${it.instanceNo || ('单据#' + it.refId)} 未回写 ${it.system}`,
        detail: [
          `单据状态：${it.instanceStatus}`,
          `回写记录：${it.outboxId ? `#${it.outboxId}（${it.outboxStatus}）` : '不存在'}`,
          `系统动作：${it.action}`,
          it.error ? `错误：${String(it.error).slice(0, 200)}` : '',
        ].filter(Boolean).join('\n'),
        refType: 'instance',
        refId: it.refId,
      });
    }
  } catch (e) {
    out.outbox = { error: e.message };
    items.push({ scope: 'outbox', kind: 'run_error', level: 'amber', detail: e.message });
  }

  if (iqc) {
    try {
      out.iqc = await reconcileIqc();
      for (const it of (out.iqc.items || [])) {
        items.push({ scope: 'iqc', ...it });
        // 只把「红/橙」两类推到告警台；🟡 假待检会自愈，只在结果里列出来
        if (it.kind === 'stale_pending') continue;
        await raiseAlert({
          key: `reconcile_diff:lot:${it.kind}:${it.lotNo}`,
          level: it.level || 'amber',
          category: 'reconcile_diff',
          systemCode: 'WMS',
          title: `IQC 对账差异：${it.inspectionNo || it.lotNo}`,
          detail: it.detail,
          refType: 'lot',
          refId: null,
        });
      }
    } catch (e) {
      out.iqc = { error: e.message };
      items.push({ scope: 'iqc', kind: 'run_error', level: 'amber', detail: e.message });
    }
  }

  /* 同一轮里没有再现的「对账差异」告警自动关闭。
     但本轮只要有任一环节「没查全」（出错 / WMS 不可达 / 只拉到部分页），就不关，
     否则一次网络抖动会把所有差异告警清空（安全审计 F-01 / QA 已知局限）。 */
  const blind = !!out.outbox?.error || !!out.iqc?.error || !!out.iqc?.skipped
    || (out.iqc?.errors || []).length > 0;
  if (!blind) {
    try {
      const closed = await query(
        `UPDATE sys_integration_alert
            SET status = 'closed', closed_at = now(), closed_reason = 'auto_not_seen'
          WHERE status <> 'closed' AND category = 'reconcile_diff' AND last_seen_at < $1`,
        [startedAt]
      );
      out.alerts.closed = closed.rowCount || 0;
    } catch { /* 关闭失败不影响主结果 */ }
  }

  /* 顺带清理过期的已关闭告警，避免表无限长大（6 小时一次足够） */
  try { await purgeOldAlerts(90); } catch { /* 忽略 */ }

  const summary = {
    ok: !out.outbox?.error && !out.iqc?.error,
    ranAt: new Date().toISOString(),
    outbox: out.outbox ? {
      checked: out.outbox.checked, diffs: out.outbox.diffs,
      resent: out.outbox.resent, retried: out.outbox.retried, hours: out.outbox.hours,
      error: out.outbox.error || null,
    } : null,
    iqc: out.iqc ? {
      skipped: out.iqc.skipped || null,
      checked: out.iqc.checked || null,
      diffs: out.iqc.diffs || 0,
      errors: out.iqc.errors || [],
      error: out.iqc.error || null,
    } : null,
    closedAlerts: out.alerts.closed,
  };

  await query(
    `UPDATE sys_integration_reconcile_run
        SET summary = $2, items = $3, finished_at = now()
      WHERE id = $1`,
    [run.id, JSON.stringify(summary), JSON.stringify(items.slice(0, 300))]
  );

  return { runId: run.id, ...summary, items: items.slice(0, 300) };
}

/** 并发闸门：对账要拉 WMS 全量待检，同时跑两轮既浪费又会给对方压力 */
let reconcileRunning = false;

/**
 * 对外入口：同一时刻只允许一轮对账。
 * 正在跑时再点「立即对账」会得到 409，而不是悄悄并发拉两遍。
 */
export async function runIntegrationReconcile(opts = {}) {
  if (reconcileRunning) {
    throw Object.assign(new Error('已有一轮对账正在执行，请稍后再试'), { statusCode: 409, isBiz: true });
  }
  reconcileRunning = true;
  try {
    return await doReconcile(opts);
  } finally {
    reconcileRunning = false;
  }
}

/** 最近 N 次对账记录（控制台展示用，不含明细，明细点开再看） */
export async function listReconcileRuns({ limit = 10 } = {}) {
  const n = Math.min(50, Math.max(1, Number(limit) || 10));
  const rows = await many(
    `SELECT id, kind, summary, jsonb_array_length(items) AS item_count,
            started_at, finished_at, triggered_by
       FROM sys_integration_reconcile_run
      ORDER BY id DESC LIMIT $1`,
    [n]
  );
  return rows;
}

export async function getReconcileRun(id) {
  return one(`SELECT * FROM sys_integration_reconcile_run WHERE id = $1`, [Number(id)]);
}
