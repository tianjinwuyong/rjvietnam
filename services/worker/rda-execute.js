/**
 * rda-execute.js — RDA AI Manager executor
 * Bridges Ornith's RDA decisions to archive/analysis API calls.
 *
 * Usage:
 *   node rda-execute.js <action> [options]
 *
 * Actions:
 *   archive-snapshot   --scope incremental|full --domain MES|WMS|BOM|PMC|HR|ALL
 *   data-analysis      --scope trends|correlation|comparative --days N
 *   trend-detection    --domain ALL|MES|WMS|BOM|PMC|HR
 *   anomaly-alert      --domain ALL|MES|WMS|BOM|PMC|HR --threshold N
 *   retention-warning  --scope all_tables|mes|wms|bom|pmc|hr
 *   report-generation  --scope insights|daily|weekly|monthly --format json|csv
 *   patrol
 *   help
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

const JWT_SECRET = process.env.JWT_SECRET ?? "smt-factory-secret-2026";
const API_BASE   = process.env.API_BASE   ?? "http://127.0.0.1:8080";

const pool = new Pool({
  host:     process.env.PGHOST     || "127.0.0.1",
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "smt_factory",
  user:     process.env.PGUSER     || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.log(`${ts} [${level}] ${msg}`);
}

function jwtSign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}

async function apiCall(method, path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${method} ${path} failed ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function lineNotify(message) {
  const tokenPath = "services/worker/line_token.txt";
  if (!existsSync(tokenPath)) { log("WARN", "LINE token not found"); return; }
  const token = readFileSync(tokenPath, "utf-8").trim();
  try {
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: process.env.LINE_GROUP_ID ?? "Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        messages: [{ type: "text", text: `[RDA] ${message}` }],
      }),
    });
  } catch (e) {
    log("WARN", `LINE notify failed: ${e.message}`);
  }
}

async function archiveSnapshot(scope, domain, token) {
  const domains = domain === "ALL" ? ["MES", "WMS", "BOM", "PMC", "HR"] : [domain];
  const results = [];
  for (const d of domains) {
    log("INFO", `Archiving ${d} (${scope})...`);
    try {
      const data = await apiCall("POST", "/api/rda/archive", { domain: d, scope }, token);
      results.push({ domain: d, status: "success", archived: data.archived ?? 0 });
    } catch (err) {
      log("ERROR", `Archive ${d} failed: ${err.message}`);
      results.push({ domain: d, status: "error", error: err.message });
    }
  }
  return results;
}

async function dataAnalysis(scope, days, token) {
  log("INFO", `Running ${scope} analysis for last ${days} days...`);
  try {
    const data = await apiCall("POST", "/api/rda/analyze", { scope, days }, token);
    log("INFO", `Analysis complete`);
    return data;
  } catch (err) {
    log("ERROR", `Analysis failed: ${err.message}`);
    return { error: err.message };
  }
}

async function trendDetection(domain, token) {
  const domains = domain === "ALL" ? ["MES", "WMS", "BOM", "PMC", "HR"] : [domain];
  const results = [];
  for (const d of domains) {
    log("INFO", `Detecting trends for ${d}...`);
    try {
      const data = await apiCall("GET", `/api/rda/trends/${d}`, null, token);
      results.push({ domain: d, trends: data.trends || [] });
    } catch (err) {
      log("ERROR", `Trend detection ${d} failed: ${err.message}`);
    }
  }
  return results;
}

async function anomalyAlert(domain, threshold, token) {
  log("INFO", `Scanning ${domain} for anomalies (threshold: ${threshold})...`);
  try {
    const data = await apiCall("POST", "/api/rda/anomalies", { domain, threshold }, token);
    const anomalies = data.anomalies || [];
    if (anomalies.length > 0) {
      await lineNotify(`Anomaly Alert [${domain}]: ${anomalies.length} anomalies detected`);
    }
    return data;
  } catch (err) {
    log("ERROR", `Anomaly detection failed: ${err.message}`);
    return { error: err.message };
  }
}

async function retentionWarning(scope, token) {
  log("INFO", `Checking retention for ${scope}...`);
  try {
    const data = await apiCall("GET", `/api/rda/retention/${scope}`, null, token);
    const warnings = data.warnings || [];
    if (warnings.length > 0) {
      await lineNotify(`Retention Warning: ${warnings.length} tables approaching retention limit`);
    }
    return data;
  } catch (err) {
    log("ERROR", `Retention check failed: ${err.message}`);
    return { error: err.message };
  }
}

async function reportGeneration(scope, format, token) {
  log("INFO", `Generating ${scope} report in ${format}...`);
  try {
    const data = await apiCall("POST", "/api/rda/reports", { scope, format }, token);
    log("INFO", `Report generated: ${data.report_id || "unknown"}`);
    return data;
  } catch (err) {
    log("ERROR", `Report generation failed: ${err.message}`);
    return { error: err.message };
  }
}

async function patrol(token) {
  log("INFO", "RDA patrol starting...");
  const snapshot = await archiveSnapshot("incremental", "ALL", token);
  const analysis = await dataAnalysis("trends", 7, token);
  const anomalies = await anomalyAlert("ALL", 3, token);
  const retention = await retentionWarning("all_tables", token);
  const report = await reportGeneration("daily", "json", token);
  log("INFO", "RDA patrol complete.");
  return { snapshot, analysis, anomalies, retention, report };
}

// CLI
const [action, ...restArgs] = process.argv.slice(2);
const args = {};
for (let i = 0; i < restArgs.length; i++) {
  if (restArgs[i].startsWith("--")) {
    args[restArgs[i].slice(2)] = restArgs[i + 1] ?? null;
    i++;
  }
}

async function main() {
  const token = jwtSign({ agent: "rda-ai", role: "executor" });

  switch (action) {
    case "archive-snapshot": {
      console.log(JSON.stringify(await archiveSnapshot(args.scope || "incremental", args.domain || "ALL", token), null, 2));
      break;
    }
    case "data-analysis": {
      console.log(JSON.stringify(await dataAnalysis(args.scope || "trends", Number(args.days || 7), token), null, 2));
      break;
    }
    case "trend-detection": {
      console.log(JSON.stringify(await trendDetection(args.domain || "ALL", token), null, 2));
      break;
    }
    case "anomaly-alert": {
      console.log(JSON.stringify(await anomalyAlert(args.domain || "ALL", Number(args.threshold || 3), token), null, 2));
      break;
    }
    case "retention-warning": {
      console.log(JSON.stringify(await retentionWarning(args.scope || "all_tables", token), null, 2));
      break;
    }
    case "report-generation": {
      console.log(JSON.stringify(await reportGeneration(args.scope || "daily", args.format || "json", token), null, 2));
      break;
    }
    case "patrol": {
      console.log(JSON.stringify(await patrol(token), null, 2));
      break;
    }
    default:
      console.log(`RDA Executor Usage:
  node rda-execute.js archive-snapshot --scope incremental|full --domain ALL|MES|WMS|BOM|PMC|HR
  node rda-execute.js data-analysis --scope trends|correlation --days N
  node rda-execute.js trend-detection --domain ALL|MES|WMS|BOM|PMC|HR
  node rda-execute.js anomaly-alert --domain ALL --threshold N
  node rda-execute.js retention-warning --scope all_tables|mes|wms|bom|pmc|hr
  node rda-execute.js report-generation --scope insights|daily|weekly --format json|csv
  node rda-execute.js patrol`);
  }

  await pool.end();
}

main().catch(async err => {
  console.error(JSON.stringify({ error: err.message }));
  await pool.end().catch(() => {});
  process.exit(1);
});
