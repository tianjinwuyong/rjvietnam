/**
 * plant-execute.js — Plant AI Manager executor
 * Top-level factory orchestrator. Queries all sub-managers and synthesizes KPIs.
 *
 * Usage:
 *   node plant-execute.js <action> [options]
 *
 * Actions:
 *   plant-patrol         Lightweight patrol of all sub-managers
 *   morning-brief        Full morning briefing synthesis
 *   evening-report       End-of-day production report
 *   kpi-snapshot        Live KPI snapshot across all domains
 *   inter-manager-sync  Trigger cross-manager coordination
 *   line-notification   Send LINE digest to factory managers
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
        messages: [{ type: "text", text: `[Plant] ${message}` }],
      }),
    });
  } catch (e) {
    log("WARN", `LINE notify failed: ${e.message}`);
  }
}

// Spawn sub-manager patrol in parallel
async function spawnManagerPatrol(manager, script, args = []) {
  return new Promise(resolve => {
    const child = spawn("node", [script, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      try {
        resolve({ manager, code, data: JSON.parse(out) });
      } catch {
        resolve({ manager, code, error: err || out });
      }
    });
  });
}

import { spawn } from "child_process";

async function plantPatrol() {
  log("INFO", "Plant patrol starting — querying all sub-managers...");

  const subManagers = [
    { name: "MES", script: "mes-query.js", args: ["patrol"] },
    { name: "WMS", script: "wms-query.js", args: ["all"] },
    { name: "BOM", script: "bom-query.js", args: ["all"] },
    { name: "PMC", script: "pmc-query.js", args: ["all"] },
    { name: "HR",  script: "hr-query.js",  args: ["all"] },
    { name: "RDA", script: "rda-query.js", args: ["all"] },
  ];

  const results = await Promise.all(
    subManagers.map(m => spawnManagerPatrol(m.name, `services/worker/${m.script}`, m.args))
  );

  const summary = {};
  for (const r of results) {
    summary[r.manager] = r.code === 0 ? r.data || "ok" : { error: r.error || "failed" };
  }

  // Synthesize cross-domain issues
  const issues = [];
  // Example synthesis logic (real implementation would use Ornith)
  if (summary.WMS?.lowStock?.length > 0) {
    issues.push({ domain: "WMS", type: "low_stock", count: summary.WMS.lowStock.length });
  }
  if (summary.MES?.defectRate > 0.05) {
    issues.push({ domain: "MES", type: "yield_warning", rate: summary.MES.defectRate });
  }
  if (summary.PMC?.shortageCount > 0) {
    issues.push({ domain: "PMC", type: "shortage", count: summary.PMC.shortageCount });
  }

  log("INFO", `Plant patrol complete. Issues: ${issues.length}`);
  return { subManagers: Object.keys(summary), results: summary, issues };
}

async function morningBrief(token) {
  log("INFO", "Generating morning brief...");
  const patrol = await plantPatrol();

  const brief = {
    timestamp: new Date().toISOString(),
    shift: "morning",
    summary: {
      all_systems: patrol.issues.length === 0,
      issue_count: patrol.issues.length,
    },
    key_issues: patrol.issues.slice(0, 5),
    wms_status: patrol.results.WMS?.health || patrol.results.WMS,
    mes_status: patrol.results.MES,
    pmc_status: patrol.results.PMC,
    hr_status: patrol.results.HR,
  };

  const msg = `早班简报 [${new Date().toLocaleDateString("zh-CN")}]
问题数: ${brief.key_issues.length}
${brief.key_issues.map((i, idx) => `${idx+1}. ${i.domain} - ${i.type}`).join("\n") || "无重大问题"}`;

  await lineNotify(msg);
  return brief;
}

async function eveningReport(token) {
  log("INFO", "Generating evening report...");
  const patrol = await plantPatrol();

  const report = {
    timestamp: new Date().toISOString(),
    shift: "evening",
    daily_summary: patrol.results,
    issues_raised: patrol.issues,
  };

  const msg = `晚班报告 [${new Date().toLocaleDateString("zh-CN")}]
问题数: ${report.issues_raised.length}
${report.issues_raised.map((i, idx) => `${idx+1}. ${i.domain} - ${i.type}`).join("\n") || "无"}`;

  await lineNotify(msg);
  return report;
}

async function kpiSnapshot() {
  log("INFO", "Fetching KPI snapshot...");
  const mes = await spawnManagerPatrol("MES", "services/worker/mes-query.js", ["kpi"]);
  const wms = await spawnManagerPatrol("WMS", "services/worker/wms-query.js", ["health"]);
  const pmc = await spawnManagerPatrol("PMC", "services/worker/pmc-query.js", ["kpi"]);

  return {
    timestamp: new Date().toISOString(),
    MES: mes.code === 0 ? mes.data : { error: mes.error },
    WMS: wms.code === 0 ? wms.data : { error: wms.error },
    PMC: pmc.code === 0 ? pmc.data : { error: pmc.error },
  };
}

async function interManagerSync(action, targetManagers, token) {
  log("INFO", `Inter-manager sync: ${action} targeting ${targetManagers.join(", ")}`);
  const results = [];
  for (const m of targetManagers) {
    try {
      const data = await apiCall("POST", `/api/agent/${m}/sync`, { action }, token);
      results.push({ manager: m, status: "success", data });
    } catch (err) {
      results.push({ manager: m, status: "error", error: err.message });
    }
  }
  return { action, results };
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
  const token = jwtSign({ agent: "plant-ai", role: "executor" });

  switch (action) {
    case "plant-patrol": {
      console.log(JSON.stringify(await plantPatrol(), null, 2));
      break;
    }
    case "morning-brief": {
      console.log(JSON.stringify(await morningBrief(token), null, 2));
      break;
    }
    case "evening-report": {
      console.log(JSON.stringify(await eveningReport(token), null, 2));
      break;
    }
    case "kpi-snapshot": {
      console.log(JSON.stringify(await kpiSnapshot(), null, 2));
      break;
    }
    case "inter-manager-sync": {
      const targets = (args.targets || "MES,WMS,BOM,PMC,HR,RDA").split(",");
      console.log(JSON.stringify(await interManagerSync(args.action || "sync", targets, token), null, 2));
      break;
    }
    case "line-notification": {
      await lineNotify(args.message || "Plant manager test notification");
      console.log(JSON.stringify({ status: "sent" }));
      break;
    }
    default:
      console.log(`Plant Executor Usage:
  node plant-execute.js plant-patrol
  node plant-execute.js morning-brief
  node plant-execute.js evening-report
  node plant-execute.js kpi-snapshot
  node plant-execute.js inter-manager-sync --action <name> [--targets MES,WMS,...]
  node plant-execute.js line-notification --message <text>`);
  }

  await pool.end();
}

main().catch(async err => {
  console.error(JSON.stringify({ error: err.message }));
  await pool.end().catch(() => {});
  process.exit(1);
});
