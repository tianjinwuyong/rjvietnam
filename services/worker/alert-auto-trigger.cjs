#!/usr/bin/env node
/**
 * alert-auto-trigger.js — runs every 5 minutes via cron
 * Checks: overdue WOs, material risk, line stagnation → sends alerts via notification channels
 *
 * Usage: node alert-auto-trigger.js
 * Cron:  every 5 min  node /path/to/alert-auto-trigger.js
 */
"use strict";

const pg = require("pg");
const https = require("https");
const http = require("http");

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: parseInt(process.env.PGPORT || "5432"),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "smt_factory",
});

// Deduplication window: don't re-alert for same WO/line within this many hours
const ALERT_COOLDOWN_HOURS = 2;

async function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: chunks.join("") }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function upsertAlertSentLog(client, alertKey, alertType, workOrderCode, lineCode) {
  // Try insert, on conflict do update
  const r = await client.query(`
    INSERT INTO alert_sent_log (alert_key, alert_type, work_order_code, line_code, last_sent_at, send_count)
    VALUES ($1, $2, $3, $4, NOW(), 1)
    ON CONFLICT (alert_key) DO UPDATE SET
      last_sent_at = NOW(),
      send_count = alert_sent_log.send_count + 1
    RETURNING send_count, last_sent_at
  `, [alertKey, alertType, workOrderCode ?? null, lineCode ?? null]);
  return r.rows[0];
}

async function isInCooldown(client, alertKey) {
  const r = await client.query(`
    SELECT last_sent_at FROM alert_sent_log
    WHERE alert_key = $1 AND last_sent_at > NOW() - INTERVAL '${ALERT_COOLDOWN_HOURS} hours'
  `, [alertKey]);
  return r.rows.length > 0;
}

async function sendAlertViaChannel(channel, alert) {
  try {
    if (channel.channel_type === "telegram" && channel.telegram_bot_token && channel.telegram_chat_id) {
      const msg = `🔔 *${alert.title}*\n${alert.message}${alert.workOrderCode ? `\n工单: \`${alert.workOrderCode}\`` : ""}${alert.lineCode ? `\n产线: ${alert.lineCode}` : ""}`;
      const res = await fetch(`https://api.telegram.org/bot${channel.telegram_bot_token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: channel.telegram_chat_id, text: msg, parse_mode: "Markdown" }),
      });
      return res.ok;
    } else if (channel.channel_type === "http_webhook" && channel.webhook_url) {
      const res = await fetch(channel.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alert),
      });
      return res.ok;
    }
  } catch (e) {
    console.error(`  [sendAlertViaChannel] Error: ${e.message}`);
  }
  return false;
}

async function dispatchAlerts(alerts) {
  const channels = await pool.query("SELECT * FROM notification_channels WHERE is_active = TRUE");
  const results = [];
  for (const ch of channels.rows) {
    for (const alert of alerts) {
      const ok = await sendAlertViaChannel(ch, alert);
      results.push({ channel: ch.name, alertKey: alert.key, ok });
    }
  }
  return results;
}

async function checkOverdueWorkOrders(client) {
  const alerts = [];
  const rows = await client.query(`
    SELECT
      wo.code,
      wo.status,
      p.code AS product_code,
      wo.planned_qty,
      COALESCE(wo.completed_qty, 0) AS completed_qty,
      wo.due_date,
      CURRENT_DATE - DATE(wo.due_date) AS days_overdue
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    WHERE wo.due_date < CURRENT_DATE
      AND wo.status NOT IN ('draft','completed','closed','cancelled')
    ORDER BY wo.due_date ASC
    LIMIT 20
  `);

  for (const row of rows.rows) {
    const alertKey = `overdue:${row.code}`;
    const inCooldown = await isInCooldown(client, alertKey);
    if (inCooldown) { console.log(`  [overdue] ${row.code} — in cooldown, skip`); continue; }

    const daysOverdue = Math.abs(row.days_overdue);
    const priority = daysOverdue >= 5 ? 1 : daysOverdue >= 2 ? 2 : 3;
    const alert = {
      key: alertKey,
      type: "overdue",
      workOrderCode: row.code,
      lineCode: null,
      priority,
      title: daysOverdue >= 5 ? "🔴 工单严重逾期" : daysOverdue >= 2 ? "🟠 工单逾期" : "🟡 工单即将逾期",
      message: `工单 ${row.code}（${row.product_code}）计划数量 ${row.planned_qty}，已逾期 ${daysOverdue} 天，完成率 ${row.planned_qty > 0 ? Math.round(row.completed_qty / row.planned_qty * 100) : 0}%`,
    };
    await upsertAlertSentLog(client, alertKey, "overdue", row.code, null);
    alerts.push(alert);
    console.log(`  [overdue] ${row.code} — ${daysOverdue} days overdue → alert queued`);
  }
  return alerts;
}

async function checkMaterialRisk(client) {
  const alerts = [];
  const rows = await client.query(`
    SELECT
      wo.code,
      p.code AS product_code,
      wo.planned_qty,
      wo.status,
      ROUND(
        CASE WHEN SUM(bl.qty_per * wo.planned_qty) = 0 THEN 1
        ELSE SUM(COALESCE(inv.available_qty, 0)) / NULLIF(SUM(bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate, 0) / 100)), 0)
        END * 100
      )::int AS availability_pct
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN boms b ON b.product_id = p.id AND b.status = 'active'
    JOIN bom_lines bl ON bl.bom_id = b.id
    LEFT JOIN LATERAL (
      SELECT SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)) AS available_qty
      FROM material_lots ml
      WHERE ml.material_id = bl.material_id AND ml.iqc_status = 'released' AND ml.lot_status = 'active'
    ) inv ON TRUE
    WHERE wo.status IN ('released', 'running')
    GROUP BY wo.code, p.code, wo.planned_qty, wo.status
    HAVING (
      CASE WHEN SUM(bl.qty_per * wo.planned_qty) = 0 THEN 1
      ELSE SUM(COALESCE(inv.available_qty, 0)) / NULLIF(SUM(bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate, 0) / 100)), 0)
      END
    ) < 0.6
    ORDER BY availability_pct ASC NULLS LAST
    LIMIT 10
  `);

  for (const row of rows.rows) {
    const alertKey = `material_risk:${row.code}`;
    const inCooldown = await isInCooldown(client, alertKey);
    if (inCooldown) { console.log(`  [material_risk] ${row.code} — in cooldown, skip`); continue; }

    await upsertAlertSentLog(client, alertKey, "material_risk", row.code, null);
    alerts.push({
      key: alertKey,
      type: "material_risk",
      workOrderCode: row.code,
      lineCode: null,
      priority: 2,
      title: "🟣 物料缺口预警",
      message: `工单 ${row.code}（${row.product_code}）物料齐套率仅 ${row.availability_pct}%，低于60%阈值，存在逾期风险`,
    });
    console.log(`  [material_risk] ${row.code} — ${row.availability_pct}% availability → alert queued`);
  }
  return alerts;
}

async function checkLineStagnation(client) {
  const alerts = [];
  const rows = await client.query(`
    SELECT DISTINCT
      ss.line_code,
      pl.name_zh AS line_name,
      MAX(se.occurred_at) AS last_event_at,
      EXTRACT(EPOCH FROM (NOW() - MAX(se.occurred_at))) / 60 AS minutes_idle
    FROM station_events se
    JOIN station_sequences ss ON ss.id = se.station_id
    JOIN production_lines pl ON pl.internal_code = ss.line_code
    WHERE se.occurred_at > NOW() - INTERVAL '2 hours'
    GROUP BY ss.line_code, pl.name_zh
    HAVING MAX(se.occurred_at) < NOW() - INTERVAL '30 minutes'
    ORDER BY minutes_idle DESC
    LIMIT 10
  `);

  for (const row of rows.rows) {
    const alertKey = `stagnation:${row.line_code}`;
    const inCooldown = await isInCooldown(client, alertKey);
    if (inCooldown) { console.log(`  [stagnation] ${row.line_code} — in cooldown, skip`); continue; }

    await upsertAlertSentLog(client, alertKey, "stagnation", null, row.line_code);
    alerts.push({
      key: alertKey,
      type: "stagnation",
      workOrderCode: null,
      lineCode: row.line_code,
      priority: row.minutes_idle > 60 ? 1 : 2,
      title: "🟠 产线停滞告警",
      message: `产线 ${row.line_name}（${row.line_code}）已 ${Math.round(row.minutes_idle)} 分钟无新事件，可能出现异常，请及时检查`,
    });
    console.log(`  [stagnation] ${row.line_code} — ${Math.round(row.minutes_idle)}min idle → alert queued`);
  }
  return alerts;
}

async function main() {
  console.log(`\n[alert-auto-trigger] Starting at ${new Date().toISOString()}`);
  const client = await pool.connect();

  try {
    const allAlerts = [];
    console.log("[alert-auto-trigger] Checking overdue work orders...");
    allAlerts.push(...(await checkOverdueWorkOrders(client)));
    console.log("[alert-auto-trigger] Checking material risk...");
    allAlerts.push(...(await checkMaterialRisk(client)));
    console.log("[alert-auto-trigger] Checking line stagnation...");
    allAlerts.push(...(await checkLineStagnation(client)));

    if (allAlerts.length === 0) {
      console.log("[alert-auto-trigger] No alerts triggered this cycle.");
    } else {
      console.log(`[alert-auto-trigger] Dispatching ${allAlerts.length} alerts...`);
      const results = await dispatchAlerts(allAlerts);
      for (const r of results) {
        if (r.ok) console.log(`  ✅ [${r.channel}] ${r.alertKey}`);
        else console.log(`  ❌ [${r.channel}] ${r.alertKey}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`[alert-auto-trigger] Done at ${new Date().toISOString()}\n`);
}

main().catch((e) => {
  console.error("[alert-auto-trigger] Fatal:", e);
  process.exit(1);
});
