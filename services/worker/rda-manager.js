/**
 * rda-manager.js
 * Report Data Analysis Manager — Main orchestrator.
 * Manages archive scheduling, patrol, and insight generation.
 *
 * Usage: node rda-manager.js <command> [options]
 *   patrol          — lightweight patrol: check missing, anomaly scan
 *   archive-daily   — full daily archive of all reports
 *   archive-weekly  — weekly period archive of all period-aware reports
 *   archive-monthly — monthly period archive
 *   insights        — generate Ornith insight report (--days 7)
 *   cleanup         — purge expired archives (--dry-run to preview)
 *   retention-report— show retention stats
 *   export          --id <archiveId> --format csv|xlsx
 *   dashboard       — show current state summary
 *   once            — single run (one patrol cycle)
 *   bus-watch       — continuous message listener (poll every 30s)
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createManagerBus } from "../_shared/manager-bus.js";
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 4,
});

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}
const command = process.argv[2] ?? "dashboard";

// ── Logging helper ────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.error(`${ts} [${level}] [RDA] ${msg}`);
}

// ── Agent Bus — Inbound Handlers ─────────────────────────────
async function handleAnalysisRequest(payload) {
  const { request_id, analysis_type, parameters } = payload;
  console.log(`[RDA←MES] analysis_request: ${analysis_type} req=${request_id}`);
  // TODO: Implement full analysis (correlation, anomaly detection, pattern mining)
  // bus.poll() auto-completes the message when handler returns without throwing
}

async function handleDefectPatternQuery(payload) {
  const { material_code, station_code, period_days } = payload;
  console.log(`[RDA←MES] defect_pattern_query: material=${material_code} station=${station_code}`);
}

async function handleMaterialSubstituted(payload) {
  const { original_material, substituted_material, reason, operator_name } = payload;
  console.log(`[RDA←WMS] material_substituted: ${original_material}→${substituted_material} by ${operator_name}`);
}

async function handleOperatorPerformanceRda(payload) {
  const { operator_name, line_code, yield_pct, defect_count, period_hours } = payload;
  console.log(`[RDA←HR] operator_performance: ${operator_name} @ ${line_code} yield=${yield_pct}%`);
}

// ── Plant Manager directive handler ───────────────────────────────────────
async function handlePlantDirective(payload) {
  const { source, severity, title, detail, metric, action } = payload;
  console.log(`[PLANT→RDA] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical") {
    // RDA is data-focused; log but do not send LINE for data metrics
    console.log(`[RDA] Critical data directive from Plant: ${title}`);
  }
}

// ── Plant Manager status request handler ──────────────────────────────────
async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  console.log(`[PLANT→RDA] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    // Quick health check via direct query
    const healthRaw = execSync(`node "${path.join(__dirname, "rda-query.js")}" dashboard`, { encoding: "utf8", timeout: 15000 });
    const health = JSON.parse(healthRaw);
    const kpis = {
      anomalies_last_24h: health.anomalies_last_24h ?? 0,
      archive_ready:       health.archive_ready ?? 0,
      data_completeness:   health.data_completeness ?? "0%",
      last_archive_at:     health.last_archive_at ?? null,
    };
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "rda-ai",
      kpis,
    }, { correlationId: request_id });
    console.log(`[RDA] plant_status_response sent for req=${request_id}`);
  } catch (err) {
    console.error(`[RDA] plant_status_request failed: ${err.message}`);
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "rda-ai",
      error: err.message,
    }, { correlationId: request_id });
  }
}

const MESSAGE_HANDLERS = {
  "analysis_request":        handleAnalysisRequest,
  "defect_pattern_query":    handleDefectPatternQuery,
  "material_substituted":    handleMaterialSubstituted,
  "operator_performance":    handleOperatorPerformanceRda,
  // Plant Manager
  "plant_directive":         handlePlantDirective,
  "plant_status_request":    handlePlantStatusRequest,
};

// ── Manager Bus (now that handlers are defined) ─────────────────
const bus = createManagerBus({
  agentId: "rda-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: MESSAGE_HANDLERS,
});

async function processAgentMessages() {
  await bus.init();
  await bus.poll(20);
}

// ── Agent Bus — Outbound Senders ─────────────────────────────
async function informMesReportReady(requestId, reportType, summary) {
  await bus.send("mes-ai", "report_ready", { request_id: requestId, report_type: reportType, summary });
}

async function informMesAnomalyDetected(anomalyType, severity, detail) {
  await bus.send("mes-ai", "anomaly_detected", { anomaly_type: anomalyType, severity, detail });
}

async function informWmsBomUsageFeedback(materialCode, actualQty, bomQty, lineCode) {
  await bus.send("wms-ai", "bom_usage_feedback", { material_code: materialCode, actual_qty: actualQty, bom_qty: bomQty, line_code: lineCode });
}

async function informBomComponentFailureRate(componentCode, failureRate, sampleSize, lineCode) {
  await bus.send("bom-ai", "component_failure_rate", { component_code: componentCode, failure_rate: failureRate, sample_size: sampleSize, line_code: lineCode });
}

async function informHrDataForAnalysis(scope, filters) {
  await bus.send("hr-ai", "hr_data_for_analysis", { request_id: `hr-${Date.now()}`, data_scope: scope, filters });
}

// ── Helpers ──────────────────────────────────────────────────
async function query(sql, params = []) {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r.rows; }
  finally { client.release(); }
}

function runQueryJs(subCmd, extraArgs = "") {
  const qPath = path.join(__dirname, "rda-query.js");
  const cmd = `node "${qPath}" ${subCmd} ${extraArgs}`;
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 30000 });
    return JSON.parse(out);
  } catch (e) {
    console.error(`[rda-query] Error running: ${cmd}`, e.message);
    return null;
  }
}

// ── Report source keys grouped by domain ─────────────────────
const REPORT_BY_DOMAIN = {
  production:  ["work-order-progress", "oee-by-line", "defect-analysis"],
  warehouse:   ["inventory-ledger", "material-movement", "material-balance"],
  quality:     ["iqc-summary", "aoi-yield", "spi-yield", "oqc-summary", "delivery-risk"],
  "hr-equipment": ["attendance-summary", "equipment-downtime", "maintenance-summary"],
  finance:     ["ar-aging", "ap-aging"],
};

const ALL_REPORTS = Object.values(REPORT_BY_DOMAIN).flat();
const PERIOD_AWARE_REPORTS = ["oee-by-line", "defect-analysis", "material-movement",
  "iqc-summary", "aoi-yield", "spi-yield", "oqc-summary", "attendance-summary",
  "equipment-downtime", "maintenance-summary"];

// ── Report data fetcher (via API for auth) ───────────────────
async function fetchReportViaAPI(sourceKey, period = null) {
  // Try local API first, fall back to direct DB query
  try {
    const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8080/api";
    const token = process.env.API_TOKEN;
    if (!token) throw new Error("No API_TOKEN set, falling back to direct DB");

    const url = period
      ? `${baseUrl}/reports/${sourceKey}?period=${period}`
      : `${baseUrl}/reports/${sourceKey}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const json = await resp.json();
    return json.data?.rows || json.rows || [];
  } catch (e) {
    console.warn(`[fetchReport] API failed for ${sourceKey}: ${e.message}, trying direct DB`);
    return fetchReportDirect(sourceKey, period);
  }
}

async function fetchReportDirect(sourceKey, period = null) {
  // Map source_key to view name (same logic as server.js REPORT_MAP)
  const VIEW_MAP = {
    "work-order-progress": "v_report_work_order_progress",
    "oee-by-line": "v_report_oee_by_line",
    "defect-analysis": "v_report_defect_analysis",
    "inventory-ledger": "v_report_inventory_ledger",
    "material-movement": "v_report_material_movement",
    "material-balance": "v_report_material_balance",
    "iqc-summary": "v_report_iqc_summary",
    "delivery-risk": "v_report_delivery_risk",
    "aoi-yield": "v_report_aoi_yield",
    "spi-yield": "v_report_spi_yield",
    "oqc-summary": "v_report_oqc_summary",
    "attendance-summary": "v_report_attendance_summary",
    "equipment-downtime": "v_report_equipment_downtime",
    "maintenance-summary": "v_report_maintenance_summary",
    "ar-aging": "v_report_ar_aging",
    "ap-aging": "v_report_ap_aging",
  };

  const view = VIEW_MAP[sourceKey];
  if (!view) { console.error(`Unknown source_key: ${sourceKey}`); return []; }

  const rows = await query(`SELECT * FROM ${view} LIMIT 5000`);
  return rows;
}

// ── Commands ─────────────────────────────────────────────────

async function archiveReport(sourceKey, period = null, userAgent = "system:manager") {
  // Fetch data
  const rows = await fetchReportViaAPI(sourceKey, period);
  if (!rows || !rows.length) {
    console.log(`  ${sourceKey}: 0 rows (skipped)`);
    return 0;
  }

  // Archive via rda-query.js
  const paramJson = period ? JSON.stringify({ period }) : "{}";
  const rowsJson = JSON.stringify(rows);
  const qPath = path.join(__dirname, "rda-query.js");
  const cmd = `node "${qPath}" archive-snapshot --source ${sourceKey} --rows '${rowsJson.replace(/'/g, "'\\''")}' --params '${paramJson}' --userAgent "${userAgent}" 2>&1`;

  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 15000 });
    const result = JSON.parse(out);
    console.log(`  ${sourceKey}: archived ${rows.length} rows (id=${result.id})`);
    return rows.length;
  } catch (e) {
    console.error(`  ${sourceKey}: archive failed: ${e.message}`);
    return 0;
  }
}

async function archiveDaily() {
  console.log(`[RDA] Daily archive — ${new Date().toISOString()}`);
  let totalArchived = 0;
  let totalRows = 0;
  let failed = 0;

  for (const src of ALL_REPORTS) {
    try {
      const n = await archiveReport(src, null, "system:daily-snapshot");
      if (n > 0) { totalArchived++; totalRows += n; }
      else failed++;
    } catch (e) {
      console.error(`  ${src}: ERROR - ${e.message}`);
      failed++;
    }
  }

  // Log snapshot
  await query(`
    INSERT INTO archive_snapshots (snapshot_type, description, total_archived, status, started_by)
    VALUES ($1, $2, $3, $4, $5)
  `, ["scheduled:daily", `Daily full snapshot: ${totalArchived}/${ALL_REPORTS.length} reports, ${totalRows} rows`,
    totalArchived, failed > 0 ? "partial" : "completed", "rda-manager"]);

  console.log(`[RDA] Daily archive done: ${totalArchived}/${ALL_REPORTS.length} archived, ${totalRows} rows, ${failed} failed`);
}

async function archiveWeekly() {
  console.log(`[RDA] Weekly period archive — ${new Date().toISOString()}`);
  let total = 0;
  for (const src of PERIOD_AWARE_REPORTS) {
    const n = await archiveReport(src, "weekly", "system:weekly-snapshot");
    if (n > 0) total++;
  }
  await query(`INSERT INTO archive_snapshots (snapshot_type, description, total_archived, status, started_by)
    VALUES ('scheduled:weekly', $1, $2, 'completed', 'rda-manager')`,
    [`Weekly period snapshot: ${total}/${PERIOD_AWARE_REPORTS.length} archived`, total]);
  console.log(`[RDA] Weekly archive done: ${total}/${PERIOD_AWARE_REPORTS.length}`);
}

async function archiveMonthly() {
  console.log(`[RDA] Monthly period archive — ${new Date().toISOString()}`);
  let total = 0;
  for (const src of PERIOD_AWARE_REPORTS) {
    const n = await archiveReport(src, "monthly", "system:monthly-snapshot");
    if (n > 0) total++;
  }
  await query(`INSERT INTO archive_snapshots (snapshot_type, description, total_archived, status, started_by)
    VALUES ('scheduled:monthly', $1, $2, 'completed', 'rda-manager')`,
    [`Monthly period snapshot: ${total}/${PERIOD_AWARE_REPORTS.length} archived`, total]);
  console.log(`[RDA] Monthly archive done: ${total}/${PERIOD_AWARE_REPORTS.length}`);
}

async function patrol() {
  // Lightweight: check for missing data, recent anomalies
  console.log(`[RDA] Patrol — ${new Date().toISOString()}`);

  // 1. Check archive count by source in last 24h
  const recent = await query(`
    SELECT a.source_key, ac.name_zh, COUNT(*) AS archives_today
    FROM document_archives a
    JOIN archive_categories ac ON ac.id = a.category_id
    WHERE a.archived_at >= NOW() - INTERVAL '24 hours'
    GROUP BY a.source_key, ac.name_zh
    ORDER BY a.source_key
  `);

  if (recent.length === 0) {
    console.log("  ⚠️  No archives in last 24h");
  } else {
    console.log(`  Recent archives (24h): ${recent.length} sources`);
    for (const r of recent) {
      console.log(`    ${r.source_key}: ${r.archives_today} archives`);
    }
  }

  // 2. Check sources with no data
  const withData = new Set(recent.map(r => r.source_key));
  const missing = ALL_REPORTS.filter(s => !withData.has(s));
  if (missing.length) {
    console.log(`  ⚠️  Missing sources (no archive in 24h): ${missing.join(", ")}`);
  }

  // 3. Quick size check
  const stats = await query(`
    SELECT COUNT(*) AS total, SUM(row_count) AS total_rows,
      MIN(archived_at) AS oldest, MAX(archived_at) AS newest
    FROM document_archives
  `);
  console.log(`  DB: ${stats[0].total} total archives, ${stats[0].total_rows} total rows`);
  console.log(`  Date range: ${String(stats[0].oldest).slice(0, 10)} → ${String(stats[0].newest).slice(0, 10)}`);

  // 4. Process inbound agent messages
  try { await processAgentMessages(); } catch (e) { console.error(`[BUS] ${e.message}`); }

  console.log(`[RDA] Patrol done`);
}

async function insights() {
  const days = Number(args.days) || 7;
  console.log(`[RDA] Insights — last ${days} days`);

  // Collect recent data
  const recentArchives = await query(`
    SELECT source_key, COUNT(*) AS cnt, SUM(row_count) AS total_rows
    FROM document_archives
    WHERE archived_at >= NOW() - INTERVAL '1 day' * $1
    GROUP BY source_key
    ORDER BY cnt DESC
  `, [days]);

  const byCategory = await query(`
    SELECT ac.code, ac.name_zh, COUNT(*) AS cnt
    FROM document_archives a
    JOIN archive_categories ac ON ac.id = a.category_id
    WHERE a.archived_at >= NOW() - INTERVAL '1 day' * $1
    GROUP BY ac.code, ac.name_zh
    ORDER BY cnt DESC
  `, [days]);

  const retention = await query(`
    SELECT COUNT(*) AS expiring_soon FROM document_archives
    WHERE expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'
    AND NOT is_pinned
  `);

  const result = {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    archiveSummary: {
      totalSources: recentArchives.length,
      totalArchives: recentArchives.reduce((s, r) => s + Number(r.cnt), 0),
      totalRows: recentArchives.reduce((s, r) => s + Number(r.total_rows), 0),
      byCategory,
    },
    retentionInfo: {
      expiringIn30Days: Number(retention[0].expiring_soon),
    },
    dataSources: recentArchives,
  };

  console.log(JSON.stringify(result, null, 2));
}

async function cleanup() {
  const dryRun = args.dryRun === "true";
  console.log(`[RDA] Cleanup — ${dryRun ? "DRY RUN" : "EXECUTING"}`);

  const result = runQueryJs("purge-expired", dryRun ? "--dryRun true" : "");
  if (result) {
    console.log(`  Expired archives: ${result.dryRun ? `would delete ${result.wouldDelete}` : `deleted ${result.deleted}`}`);
  }
}

async function retentionReport() {
  const result = runQueryJs("retention-report", args.days ? `--days ${args.days}` : "");
  if (result) console.log(JSON.stringify(result, null, 2));
}

async function dashboard() {
  const total = await query("SELECT COUNT(*) AS n FROM document_archives");
  const byType = await query(`
    SELECT archive_type, COUNT(*) AS n FROM document_archives GROUP BY archive_type ORDER BY n DESC
  `);
  const byCat = await query(`
    SELECT ac.code, ac.name_zh, COUNT(*) AS n FROM document_archives a
    JOIN archive_categories ac ON ac.id = a.category_id
    GROUP BY ac.code, ac.name_zh ORDER BY n DESC LIMIT 15
  `);
  const recent = await query(`
    SELECT source_key, archived_at, row_count FROM document_archives
    ORDER BY archived_at DESC LIMIT 10
  `);
  const oldest = await query("SELECT MIN(archived_at) AS oldest FROM document_archives");
  const expiring = await query("SELECT COUNT(*) AS n FROM document_archives WHERE expires_at < NOW() AND NOT is_pinned");

  console.log(`
╔══════════════════════════════════════════╗
║     RDA Manager — Dashboard             ║
╚══════════════════════════════════════════╝
Total archives:  ${total[0].n}
Oldest archive:  ${String(oldest[0].oldest).slice(0, 19)}
Expired (unpurged): ${expiring[0].n}

By type:
${byType.map(t => `  ${t.archive_type}: ${t.n}`).join("\n")}

Top categories:
${byCat.map(c => `  ${c.code}: ${c.n}`).join("\n")}

Last 10 archives:
${recent.map(r => `  [${String(r.archived_at).slice(0, 19)}] ${r.source_key} (${r.row_count} rows)`).join("\n")}
`);
}

async function once() {
  console.log(`[RDA] Once — ${new Date().toISOString()}`);
  await patrol();
  console.log("");
  await insights();
  try { await processAgentMessages(); } catch (e) { console.error(`[BUS] ${e.message}`); }
}

async function busWatchLoop(intervalMs = 30 * 1000) {
  console.log(`RDA bus-watch started (poll every ${intervalMs / 1000}s)`);
  await bus.init();
  for (;;) {
    try { await processAgentMessages(); } catch (e) { console.error(`[BUS] ${e.message}`); }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ── Main ─────────────────────────────────────────────────────
const handlers = {
  patrol, "archive-daily": archiveDaily, "archive-weekly": archiveWeekly,
  "archive-monthly": archiveMonthly, insights, cleanup,
  "retention-report": retentionReport, dashboard, once,
  "bus-watch": busWatchLoop,
};

if (handlers[command]) {
  handlers[command]().catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Available: " + Object.keys(handlers).join(", "));
  process.exit(1);
}
