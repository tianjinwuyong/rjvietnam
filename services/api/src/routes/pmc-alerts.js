// ============================================================================
// PMC 告警通道 / NG 评审 —— 从 server.js 整段搬迁（阶段3轮4）。
// 原 server.js 15059-15294（9 路由：alert-channels 列表/修改、alerts/send、
// alert-history、ng-reviews CRUD/auto-import、ng-summary）。
// 挂载在 app 级鉴权闸门之后（原行号）,wrapper 鉴权;模块只直接 import query 与
// envelope 族,不消费任何注入依赖。
// ============================================================================
import { query } from "../db.js";
import { listEnvelope, mutateEnvelope, errorEnvelope } from "../shared/helpers.js";

export function registerPmcAlertsRoutes(app) {

// ── Alert Notification System ───────────────────────────────────────────

// GET /pmc/alert-channels — list notification channels
app.get("/pmc/alert-channels", async (req, res) => {
  try {
    const rows = await query(`
      SELECT id, name, channel_type, webhook_url, telegram_chat_id, telegram_bot_token, is_active
      FROM notification_channels ORDER BY id ASC
    `);
    res.json(listEnvelope(rows.rows));
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /pmc/alert-channels/:id — update channel (enable/disable/set token)
app.patch("/pmc/alert-channels/:id", async (req, res) => {
  try {
    const { name, webhook_url, telegram_chat_id, telegram_bot_token, is_active } = req.body?.payload ?? {};
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
    if (webhook_url !== undefined) { updates.push(`webhook_url = $${idx++}`); params.push(webhook_url); }
    if (telegram_chat_id !== undefined) { updates.push(`telegram_chat_id = $${idx++}`); params.push(telegram_chat_id); }
    if (telegram_bot_token !== undefined) { updates.push(`telegram_bot_token = $${idx++}`); params.push(telegram_bot_token); }
    if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(is_active); }
    if (!updates.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    updates.push("created_at = created_at"); // no-op to avoid empty SET
    params.push(req.params.id);
    const r = await query(`UPDATE notification_channels SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, name, channel_type, is_active`, params);
    res.json(mutateEnvelope(r.rows[0]));
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /pmc/alerts/send — send a test or real alert via configured channels
// Body: { alertType, workOrderCode, lineCode, priority, title, message }
app.post("/pmc/alerts/send", async (req, res) => {
  try {
    const { alertType, workOrderCode, lineCode, priority, title, message } = req.body?.payload ?? {};
    if (!title || !message) return res.status(400).json(errorEnvelope("VALIDATION", "title and message required"));

    const channels = await query("SELECT * FROM notification_channels WHERE is_active = TRUE");
    const results = [];
    for (const ch of channels.rows) {
      let sent = false, responseBody = "";
      try {
        if (ch.channel_type === "telegram" && ch.telegram_bot_token && ch.telegram_chat_id) {
          const tgMsg = `🔔 *${title}*\n${message}\n${workOrderCode ? `\n工单: \`${workOrderCode}\`` : ""}${lineCode ? `\n产线: ${lineCode}` : ""}`;
          const tgRes = await fetch(`https://api.telegram.org/bot${ch.telegram_bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: ch.telegram_chat_id, text: tgMsg, parse_mode: "Markdown" }),
          });
          responseBody = await tgRes.text();
          sent = tgRes.ok;
        } else if (ch.channel_type === "http_webhook" && ch.webhook_url) {
          const whRes = await fetch(ch.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alertType, workOrderCode, lineCode, priority, title, message }),
          });
          responseBody = await whRes.text();
          sent = whRes.ok;
        }
      } catch (e) {
        responseBody = String(e.message);
      }
      // Log to alert_history
      const logR = await query(`
        INSERT INTO alert_history (alert_type, work_order_code, line_code, priority, title, message, channel_id, delivery_status, response_body)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
      `, [alertType ?? "manual", workOrderCode ?? null, lineCode ?? null, priority ?? null, title, message, ch.id, sent ? "sent" : "failed", responseBody]);
      results.push({ channelId: ch.id, channelName: ch.name, status: sent ? "sent" : "failed", logId: logR.rows[0]?.id });
    }
    res.json(mutateEnvelope({ sent: results.filter((r) => r.status === "sent").length, total: results.length, results }));
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/alert-history — alert notification log
// Query: ?limit=50&offset=0&alertType=overdue
app.get("/pmc/alert-history", async (req, res) => {
  try {
    const { limit = 50, offset = 0, alertType } = req.query;
    const cond = alertType ? "WHERE ah.alert_type = $1" : "";
    const params = alertType ? [alertType] : [];
    const rows = await query(`
      SELECT ah.*, nc.name AS channel_name, nc.channel_type
      FROM alert_history ah
      LEFT JOIN notification_channels nc ON nc.id = ah.channel_id
      ${cond}
      ORDER BY ah.sent_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, Number(limit), Number(offset)]);
    const countR = await query(`SELECT COUNT(*)::int AS total FROM alert_history ${cond}`, params);
    res.json({ data: { items: rows.rows, total: countR.rows[0]?.total ?? 0, limit: Number(limit), offset: Number(offset) } });
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/ng-reviews — list NG reviews (pending / reviewed / closed)
app.get("/pmc/ng-reviews", async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const cond = status ? "WHERE nr.review_status = $1" : "";
    const params = status ? [status] : [];
    const rows = await query(`
      SELECT nr.*,
        se.result AS ng_sn,
        se.event_type AS ng_event_type,
        pl.name_zh AS line_name,
        ss.station_code
      FROM ng_reviews nr
      LEFT JOIN station_events se ON se.id = nr.ng_event_id
      LEFT JOIN station_sequences ss ON ss.id = se.station_id
      LEFT JOIN production_lines pl ON pl.internal_code = ss.line_code
      ${cond}
      ORDER BY nr.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, Number(limit), Number(offset)]);
    const countR = await query(`SELECT COUNT(*)::int AS total FROM ng_reviews ${cond}`, params);
    res.json({ data: { items: rows.rows, total: countR.rows[0]?.total ?? 0, limit: Number(limit), offset: Number(offset) } });
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /pmc/ng-reviews/:id — QA engineer submits review (root cause + improvement + status)
app.patch("/pmc/ng-reviews/:id", async (req, res) => {
  try {
    const { rootCause, improvementAction, reviewStatus, reviewedBy } = req.body?.payload ?? {};
    const updates = [];
    const params = [];
    let idx = 1;
    if (rootCause !== undefined) { updates.push(`root_cause = $${idx++}`); params.push(rootCause); }
    if (improvementAction !== undefined) { updates.push(`improvement_action = $${idx++}`); params.push(improvementAction); }
    if (reviewStatus !== undefined) {
      updates.push(`review_status = $${idx++}`); params.push(reviewStatus);
      if (reviewStatus === "closed") { updates.push(`closed_at = NOW()`); }
    }
    if (reviewedBy !== undefined) { updates.push(`reviewed_by = $${idx++}`); params.push(reviewedBy); }
    updates.push(`reviewed_at = NOW()`);
    if (!updates.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    params.push(req.params.id);
    const r = await query(`UPDATE ng_reviews SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "NG review not found"));
    res.json(mutateEnvelope(r.rows[0]));
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /pmc/ng-reviews — create NG review (e.g. from pending NG event, or manually)
app.post("/pmc/ng-reviews", async (req, res) => {
  try {
    const { ngEventId, workOrderCode, lineCode, stationCode, ngReasonCode, ngReasonText, ngQty } = req.body?.payload ?? {};
    if (!ngQty || ngQty < 1) return res.status(400).json(errorEnvelope("VALIDATION", "ngQty required"));
    const r = await query(`
      INSERT INTO ng_reviews (ng_event_id, work_order_code, line_code, station_code, ng_reason_code, ng_reason_text, ng_qty)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [ngEventId ?? null, workOrderCode ?? null, lineCode ?? null, stationCode ?? null, ngReasonCode ?? null, ngReasonText ?? null, ngQty]);
    res.json(mutateEnvelope(r.rows[0]));
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /pmc/ng-reviews/auto-import — import recent unreviewed NG events into ng_reviews
// Run this as part of the alert trigger or manually
app.post("/pmc/ng-reviews/auto-import", async (req, res) => {
  try {
    const r = await query(`
      INSERT INTO ng_reviews (ng_event_id, work_order_code, line_code, station_code, ng_reason_code, ng_reason_text, ng_qty)
      SELECT DISTINCT ON (se.id)
        se.id,
        ps.source_work_order_code,
        ss.line_code,
        ss.station_code,
        se.event_type,
        se.result,
        1
      FROM station_events se
      LEFT JOIN pcb_serials ps ON ps.id = se.pcb_serial_id
      LEFT JOIN station_sequences ss ON ss.id = se.station_id
      LEFT JOIN ng_reviews nr ON nr.ng_event_id = se.id
      WHERE se.event_type = 'NG'
        AND nr.id IS NULL
        AND se.occurred_at > NOW() - INTERVAL '7 days'
      RETURNING id, work_order_code, line_code, station_code
    `);
    res.json(mutateEnvelope({ imported: r.rows.length, rows: r.rows }));
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/ng-summary — NG statistics dashboard
app.get("/pmc/ng-summary", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await query(`
      SELECT
        nr.review_status,
        COUNT(*)::int AS count,
        SUM(nr.ng_qty)::int AS total_ng_qty
      FROM ng_reviews nr
      WHERE nr.created_at > NOW() - INTERVAL '${Number(days)} days'
      GROUP BY nr.review_status
    `);
    const byStation = await query(`
      SELECT nr.station_code, COUNT(*)::int AS ng_count, SUM(nr.ng_qty)::int AS total_qty
      FROM ng_reviews nr
      WHERE nr.created_at > NOW() - INTERVAL '${Number(days)} days'
      GROUP BY nr.station_code
      ORDER BY total_qty DESC
      LIMIT 10
    `);
    const byReason = await query(`
      SELECT nr.ng_reason_text, COUNT(*)::int AS count
      FROM ng_reviews nr
      WHERE nr.created_at > NOW() - INTERVAL '${Number(days)} days'
      GROUP BY nr.ng_reason_text
      ORDER BY count DESC
      LIMIT 10
    `);
    res.json({ data: { byStatus: stats.rows, byStation: byStation.rows, byReason: byReason.rows } });
  } catch (err) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}

