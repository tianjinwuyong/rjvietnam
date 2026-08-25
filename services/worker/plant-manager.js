/**
 * plant-manager.js — Plant AI Manager (瑞晶越南工厂)
 *
 * Top-level orchestrator for the Vietnam SMT factory.
 * Queries all 6 sub-managers (MES, WMS, BOM, PMC, HR, RDA) each patrol cycle,
 * synthesizes plant-wide KPIs, drives OKRs, and escalates to human via LINE.
 *
 * Usage:
 *   node plant-manager.js patrol           # Lightweight plant-wide status synthesis
 *   node plant-manager.js morning         # Morning briefing: query all managers, LINE digest
 *   node plant-manager.js evening         # End-of-day plant status report
 *   node plant-manager.js watch [min]     # Continuous loop (default 30 min)
 *   node plant-manager.js report [days]    # Multi-day plant performance report
 *   node plant-manager.js kpi             # Live KPI snapshot
 *   node plant-manager.js bus-watch       # Continuous inter-agent message listener
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const LINE_TOKEN   = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE   = join(PROJECT_ROOT, "services/worker/plant-manager-state.json");
const LOG_FILE     = join(PROJECT_ROOT, "services/worker/plant-manager.log");

// ── mem0 memory client (cross-cycle persistent state) ─────────────────
const mem = createMemoryClient({ agentId: "plant-ai" });

// ── Agent Bus ───────────────────────────────────────────────────────────
process.env.AGENT_ID = "plant-ai";

import {
  requestAgentResponse,
  agentBusHealth,
  completeAgentMessage,
  failAgentMessage,
  log as busLog,
} from "../_shared/agent-bus.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

// ── Logging ─────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Manager Bus ────────────────────────────────────────────────────────────
// Bus is created early with empty handlers; handlers are assigned after MESSAGE_HANDLERS is defined
let _bus = null;
let _busReady = false;
async function ensureBusInit() {
  if (!_busReady) {
    if (!_bus) {
      _bus = createManagerBus({
        agentId: "plant-ai",
        log,
        logPrefix: "[BUS] ",
        handlers: {}, // handlers added after MESSAGE_HANDLERS is defined
      });
    }
    await _bus.init();
    _busReady = true;
  }
}
function getBus() {
  if (!_bus) {
    _bus = createManagerBus({
      agentId: "plant-ai",
      log,
      logPrefix: "[BUS] ",
      handlers: {},
    });
  }
  return _bus;
}

// ── State (mem0-backed, with JSON file fallback) ─────────────────────
async function loadState() {
  try {
    const results = await mem.search("most recent plant manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (_) {}
  return {
    lastMorning: null,
    lastPatrol: null,
    cycleCount: 0,
    kpis: null,
    okrProgress: {},
    managerHealth: {},
  };
}

async function saveState(state) {
  try {
    const cycleLabel = `Plant manager cycle #${state.cycleCount || 0}`;
    await mem.store(
      `${cycleLabel} — patrol: ${state.lastPatrol?.slice(0, 10) || "?"} morning: ${state.lastMorning?.slice(0, 10) || "?"}`,
      { type: "plant_state", state, ts: state.lastPatrol || new Date().toISOString() }
    );
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

// ── LINE notification ───────────────────────────────────────────────────
async function sendLINE(msg) {
  if (!existsSync(LINE_TOKEN)) { log("WARN", "LINE token not found, skipping"); return; }
  const token = readFileSync(LINE_TOKEN, "utf8").trim();
  if (!token) return;
  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ message: msg }),
  });
  if (!res.ok) log("WARN", `LINE send failed: ${res.status}`);
  else log("INFO", "LINE notification sent");
}

// ── Plant Manager identity ──────────────────────────────────────────────
const AGENT_ID = "plant-ai";

// ── Outbound message helpers ────────────────────────────────────────────

async function informMesOfPlantAlert(severity, area, title, detail, action, line_code) {
  await getBus().send("mes-ai", "plant_directive", {
    source: "plant-manager",
    severity,
    area,
    title,
    detail,
    action,
    line_code,
  }, { priority: severity === "critical" ? "critical" : severity === "warning" ? "high" : "normal" });
}

async function informWmsOfPlantAlert(severity, title, detail, material_code, action) {
  await getBus().send("wms-ai", "plant_directive", {
    source: "plant-manager",
    severity,
    title,
    detail,
    material_code,
    action,
  }, { priority: severity === "critical" ? "critical" : "high" });
}

async function informBomOfPlantAlert(severity, title, detail, product_code, action) {
  await getBus().send("bom-ai", "plant_directive", {
    source: "plant-manager",
    severity,
    title,
    detail,
    product_code,
    action,
  }, { priority: severity === "critical" ? "critical" : "high" });
}

async function informHrOfPlantAlert(severity, title, detail, line_code, action) {
  await getBus().send("hr-ai", "plant_directive", {
    source: "plant-manager",
    severity,
    title,
    detail,
    line_code,
    action,
  }, { priority: severity === "critical" ? "critical" : "high" });
}

async function informRdaOfPlantAlert(severity, title, detail, metric, action) {
  await getBus().send("rda-ai", "plant_directive", {
    source: "plant-manager",
    severity,
    title,
    detail,
    metric,
    action,
  }, { priority: severity === "critical" ? "critical" : "normal" });
}

// ── Inbound message handlers ─────────────────────────────────────────────

async function handleStatusRequest(payload) {
  const { request_id, requestor, scope } = payload;
  log("INFO", `[${requestor}→PLANT] status_request: scope=${scope} req=${request_id}`);
  const kpis = await collectAllKpis();
  await getBus().send(requestor, "plant_status_response", {
    request_id,
    kpis,
    timestamp: new Date().toISOString(),
  }, { correlationId: request_id });
}

async function handleKpiReport(payload) {
  const { source, kpis } = payload;
  log("INFO", `[${source}→PLANT] kpi_report: received KPIs from ${source}`);
  const state = await loadState();
  state.managerHealth[source] = { kpis, receivedAt: new Date().toISOString() };
  await saveState(state);
}

async function handleAlertFromMes(payload) {
  const { severity, area, title, detail, line_code } = payload;
  log("WARN", `[MES→PLANT] alert: ${title} (${severity}) — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🔴 [工厂告警-MES] ${title}\n产线: ${line_code ?? "N/A"}\n详情: ${detail}`);
  }
}

async function handleAlertFromWms(payload) {
  const { severity, title, detail, material_code } = payload;
  log("WARN", `[WMS→PLANT] alert: ${title} (${severity}) — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🔴 [工厂告警-WMS] ${title}\n物料: ${material_code ?? "N/A"}\n详情: ${detail}`);
  }
}

async function handleAlertFromBom(payload) {
  const { severity, title, detail, product_code } = payload;
  log("WARN", `[BOM→PLANT] alert: ${title} (${severity}) — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🔴 [工厂告警-BOM] ${title}\n产品: ${product_code ?? "N/A"}\n详情: ${detail}`);
  }
}

async function handleAlertFromHr(payload) {
  const { severity, title, detail, line_code } = payload;
  log("WARN", `[HR→PLANT] alert: ${title} (${severity}) — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🔴 [工厂告警-HR] ${title}\n产线: ${line_code ?? "N/A"}\n详情: ${detail}`);
  }
}

async function handleAlertFromRda(payload) {
  const { severity, title, detail, metric } = payload;
  log("WARN", `[RDA→PLANT] alert: ${title} (${severity}) — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🔴 [工厂告警-RDA] ${title}\n指标: ${metric ?? "N/A"}\n详情: ${detail}`);
  }
}

async function handleAlertFromAgv(payload) {
  const { severity, title, detail, agv_code } = payload;
  log("WARN", `[AGV→PLANT] alert: ${title} (${severity}) — ${detail}`);
  if (severity === "critical" || severity === "warning") {
    await sendLINE(`🔋 [工厂告警-AGV] ${title}\nAGV: ${agv_code ?? "N/A"}\n详情: ${detail}`);
  }
}

async function handleAgvIncident(payload) {
  const { severity, detail, agv_code, incident_type } = payload;
  log("ERR", `[AGV→PLANT] incident: ${incident_type} (${severity}) — ${detail}`);
  await sendLINE(`🚨 [AGV紧急事件] ${incident_type} | AGV: ${agv_code ?? "N/A"}\n详情: ${detail}\n需要人工干预！`);
}

async function handleOkrUpdate(payload) {
  const { objective, key_result, current_value, target_value, owner } = payload;
  log("INFO", `[AGENT→PLANT] okr_update: ${objective} / ${key_result} — ${current_value}/${target_value} (${owner})`);
  const state = await loadState();
  if (!state.okrProgress[objective]) state.okrProgress[objective] = {};
  state.okrProgress[objective][key_result] = { current_value, target_value, owner, updatedAt: new Date().toISOString() };
  await saveState(state);
}

async function handleDataResponse(payload) {
  const { request_id, query, data, error } = payload;
  log("INFO", `[AGENT→PLANT] data_response: ${query} req=${request_id} ${error ? `(ERROR: ${error})` : "(ok)"}`);
}

// ── Agent Bus: Message Dispatcher ───────────────────────────────────────

const MESSAGE_HANDLERS = {
  "plant_status_request": handleStatusRequest,
  "kpi_report":          handleKpiReport,
  // Alerts from sub-managers
  "alert":               handleAlertFromMes,    // generic fallback
  "mes_alert":           handleAlertFromMes,
  "wms_alert":           handleAlertFromWms,
  "bom_alert":           handleAlertFromBom,
  "hr_alert":            handleAlertFromHr,
  "rda_alert":           handleAlertFromRda,
  "agv_alert":           handleAlertFromAgv,
  "agv_incident":        handleAgvIncident,
  // OKR tracking
  "okr_update":          handleOkrUpdate,
  // Data responses from queries
  "data_response":       handleDataResponse,
};

/**
 * Poll pending messages for plant-ai and dispatch to handlers.
 * Called once per patrol cycle.
 */
async function processAgentMessages() {
  await ensureBusInit();
  await _bus.poll(20);
}

// ── Sub-manager query helpers ───────────────────────────────────────────
/**
 * Query a sub-manager synchronously via requestAgentResponse (waits up to ttlSeconds).
 * Falls back to a fire-and-forget status_request if timeout.
 */
async function queryManager(managerId, subject, body, ttlSeconds = 30) {
  try {
    const response = await requestAgentResponse(managerId, subject, body, {
      ttlSeconds,
      priority: "high",
    });
    return { ok: true, data: response };
  } catch (err) {
    log("WARN", `[QUERY] ${managerId} ${subject} failed: ${err.message} — using stale state`);
    return { ok: false, error: err.message };
  }
}

/**
  * Query all 6 sub-managers in parallel, collect responses.
 * Returns { mes, wms, bom, hr, rda } each with { ok, data }.
 */
async function queryAllManagers(subject = "plant_status_request", body = {}, ttlSeconds = 30) {
  const managers = ["mes-ai", "wms-ai", "bom-ai", "pmc-ai", "hr-ai", "rda-ai", "agv-ai"];
  const results = await Promise.all(
    managers.map(async (mgr) => {
      const result = await queryManager(mgr, subject, body, ttlSeconds);
      return [mgr, result];
    })
  );
  const map = {};
  for (const [mgr, result] of results) {
    map[mgr] = result;
  }
  return map;
}

/**
 * Collect KPIs from all managers by querying each directly.
 * Returns a synthesized plant-wide KPI object.
 */
async function collectAllKpis() {
  const state = await loadState();
  const managers = ["mes-ai", "wms-ai", "bom-ai", "pmc-ai", "hr-ai", "rda-ai", "agv-ai"];

  const [mesResult, wmsResult, bomResult, pmcResult, hrResult, rdaResult, agvResult] = await Promise.all([
    queryManager("mes-ai", "plant_status_request", { scope: "kpi" }, 20),
    queryManager("wms-ai", "plant_status_request", { scope: "kpi" }, 20),
    queryManager("bom-ai", "plant_status_request", { scope: "kpi" }, 20),
    queryManager("pmc-ai", "plant_status_request", { scope: "kpi" }, 20),
    queryManager("hr-ai", "plant_status_request", { scope: "kpi" }, 20),
    queryManager("rda-ai", "plant_status_request", { scope: "kpi" }, 20),
    queryManager("agv-ai", "plant_status_request", { scope: "kpi" }, 20),
  ]);

  const now = new Date().toISOString();
  return {
    collectedAt: now,
    mes: mesResult,
    wms: wmsResult,
    bom: bomResult,
    pmc: pmcResult,
    hr: hrResult,
    rda: rdaResult,
    agv: agvResult,
    managerHealth: state.managerHealth,
    okrProgress: state.okrProgress,
  };
}

// ── KPI Synthesis ───────────────────────────────────────────────────────

/**
 * Synthesize a Chinese-language morning briefing from all manager responses.
 */
async function synthesizeMorningBriefing(managerResults) {
  const lines = [];
  lines.push("🌅 工厂早报 🌅");
  lines.push(`时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  // MES: production / OEE
  const mes = managerResults["mes-ai"];
  if (mes.ok && mes.data) {
    lines.push("📋 生产状况 (MES)");
    const d = mes.data;
    lines.push(`  产线数: ${d.line_count ?? "—"}`);
    lines.push(`  OEE: ${d.oee ?? "—"}%`);
    lines.push(`  产出: ${d.output ?? "—"}`);
    lines.push(`  不良: ${d.defects ?? "—"} (${d.defect_rate ?? "—"}%)`);
    lines.push(`  停机: ${d.downtime ?? "—"} min`);
    lines.push("");
  } else {
    lines.push("📋 生产状况 (MES): 数据收集中...");
    lines.push("");
  }

  // WMS: inventory
  const wms = managerResults["wms-ai"];
  if (wms.ok && wms.data) {
    lines.push("📦 库存状况 (WMS)");
    const d = wms.data;
    lines.push(`  待发料: ${d.pending_issue ?? "—"}`);
    lines.push(`  待 IQC: ${d.iqc_pending ?? "—"}`);
    lines.push(`  低库存告警: ${d.low_stock_alerts ?? "—"}`);
    lines.push(`  安全库存: ${d.safe_stock_ok ? "正常" : "不足"}`);
    lines.push("");
  } else {
    lines.push("📦 库存状况 (WMS): 数据收集中...");
    lines.push("");
  }

  // BOM: material readiness
  const bom = managerResults["bom-ai"];
  if (bom.ok && bom.data) {
    lines.push("🔧 BOM / 物料清单 (BOM)");
    const d = bom.data;
    lines.push(`  齐套率: ${d.readiness_rate ?? "—"}%`);
    lines.push(`  BOM 变更: ${d.pending_eco ?? "—"}`);
    lines.push(`  物料短缺: ${d.shortages ?? "—"}`);
    lines.push("");
  } else {
    lines.push("🔧 BOM / 物料清单 (BOM): 数据收集中...");
    lines.push("");
  }

  // HR: staffing
  const hr = managerResults["hr-ai"];
  if (hr.ok && hr.data) {
    lines.push("👷 人力状况 (HR)");
    const d = hr.data;
    lines.push(`  在岗: ${d.on_duty ?? "—"} / 需求 ${d.required ?? "—"}`);
    lines.push(`  出勤率: ${d.attendance_rate ?? "—"}%`);
    lines.push(`  待培训: ${d.training_pending ?? "—"}`);
    lines.push(`  证书过期: ${d.certs_expiring ?? "—"}`);
    lines.push("");
  } else {
    lines.push("👷 人力状况 (HR): 数据收集中...");
    lines.push("");
  }

  // RDA: data health
  const rda = managerResults["rda-ai"];
  if (rda.ok && rda.data) {
    lines.push("📊 数据分析 (RDA)");
    const d = rda.data;
    lines.push(`  异常检测: ${d.anomalies ?? "—"}`);
    lines.push(`  数据完整率: ${d.completeness ?? "—"}%`);
    lines.push(`  归档状态: ${d.archive_status ?? "—"}`);
    lines.push("");
  } else {
    lines.push("📊 数据分析 (RDA): 数据收集中...");
    lines.push("");
  }

  // OKR progress
  const state = await loadState();
  const okrs = state.okrProgress;
  const okrKeys = Object.keys(okrs);
  if (okrKeys.length > 0) {
    lines.push("🎯 OKR 进度");
    for (const [obj, krs] of Object.entries(okrs)) {
      for (const [kr, v] of Object.entries(krs)) {
        lines.push(`  ${obj} / ${kr}: ${v.current_value} / ${v.target_value} (${v.owner})`);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("以上为工厂综合状态，如有问题请联系各 AI 管理员。");

  return lines.join("\n");
}

/**
 * Synthesize a compact plant-wide status string for patrol mode.
 */
async function synthesizePatrolStatus(managerResults) {
  const parts = [];
  const mes = managerResults["mes-ai"];
  const wms = managerResults["wms-ai"];
  const bom = managerResults["bom-ai"];
  const hr = managerResults["hr-ai"];
  const rda = managerResults["rda-ai"];

  if (mes.ok) {
    const d = mes.data ?? {};
    parts.push(`MES: OEE=${d.oee ?? "?"}% 产出=${d.output ?? "?"} 不良=${d.defect_rate ?? "?"}%`);
  } else parts.push("MES: ❌");

  if (wms.ok) {
    const d = wms.data ?? {};
    parts.push(`WMS: 待发=${d.pending_issue ?? "?"} 低库存=${d.low_stock_alerts ?? "?"}`);
  } else parts.push("WMS: ❌");

  if (bom.ok) {
    const d = bom.data ?? {};
    parts.push(`BOM: 齐套=${d.readiness_rate ?? "?"}% 变更=${d.pending_eco ?? "?"}`);
  } else parts.push("BOM: ❌");

  if (hr.ok) {
    const d = hr.data ?? {};
    parts.push(`HR: 在岗=${d.on_duty ?? "?"}/${d.required ?? "?"} 出勤=${d.attendance_rate ?? "?"}%`);
  } else parts.push("HR: ❌");

  if (rda.ok) {
    const d = rda.data ?? {};
    parts.push(`RDA: 异常=${d.anomalies ?? "?"} 完整率=${d.completeness ?? "?"}%`);
  } else parts.push("RDA: ❌");

  return parts.join(" | ");
}

// ── Patrol cycle ────────────────────────────────────────────────────────

async function patrolCycle() {
  log("INFO", "=== Plant Manager patrol cycle start ===");
  const state = await loadState();
  state.cycleCount++;
  state.lastPatrol = new Date().toISOString();

  // 1. Process any pending inbound messages
  await processAgentMessages();

  // 2. Query all sub-managers for current status
  log("INFO", "Querying all sub-managers...");
  const managerResults = await queryAllManagers("plant_status_request", { scope: "kpi" }, 30);

  // 3. Synthesize and log plant-wide status
  const status = await synthesizePatrolStatus(managerResults);
  log("INFO", `Plant status: ${status}`);

  // 4. Check for critical alerts from any manager
  for (const [mgr, result] of Object.entries(managerResults)) {
    if (!result.ok) {
      log("WARN", `Manager ${mgr} did not respond: ${result.error}`);
    }
  }

  // 5. Save updated state
  await saveState(state);
  log("INFO", `=== Patrol cycle ${state.cycleCount} complete ===`);
  return { managerResults, state };
}

// ── Morning briefing ─────────────────────────────────────────────────────

async function morningBriefing() {
  log("INFO", "=== Morning briefing start ===");
  const state = await loadState();
  state.lastMorning = new Date().toISOString();

  // Process any pending inbound before briefing
  await processAgentMessages();

  // Query all managers in parallel
  log("INFO", "Querying all sub-managers for morning briefing...");
  const managerResults = await queryAllManagers("plant_status_request", { scope: "morning" }, 45);

  // Synthesize morning briefing
  const briefing = await synthesizeMorningBriefing(managerResults);
  console.log("\n" + briefing + "\n");

  // Send LINE notification
  await sendLINE(briefing);

  // Update state
  state.managerHealth = {};
  for (const [mgr, result] of Object.entries(managerResults)) {
    state.managerHealth[mgr] = {
      ok: result.ok,
      receivedAt: new Date().toISOString(),
      data: result.ok ? result.data : null,
      error: result.error ?? null,
    };
  }
  await saveState(state);
  log("INFO", "=== Morning briefing complete ===");
  return { managerResults, briefing };
}

// ── Evening report ───────────────────────────────────────────────────────

async function eveningReport() {
  log("INFO", "=== Evening report start ===");
  const state = await loadState();

  await processAgentMessages();

  log("INFO", "Querying all sub-managers for evening report...");
  const managerResults = await queryAllManagers("plant_status_request", { scope: "evening" }, 45);

  const lines = [];
  lines.push("🌙 工厂晚报 🌙");
  lines.push(`时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  const mes = managerResults["mes-ai"];
  if (mes.ok) {
    const d = mes.data ?? {};
    lines.push("📋 今日生产 (MES)");
    lines.push(`  总产出: ${d.output ?? "—"}`);
    lines.push(`  OEE: ${d.oee ?? "—"}%`);
    lines.push(`  不良率: ${d.defect_rate ?? "—"}%`);
    lines.push(`  停机时间: ${d.downtime ?? "—"} min`);
    lines.push(`  计划达成: ${d.schedule_adherence ?? "—"}%`);
    lines.push("");
  }

  const wms = managerResults["wms-ai"];
  if (wms.ok) {
    const d = wms.data ?? {};
    lines.push("📦 库存 (WMS)");
    lines.push(`  发料次数: ${d.issues_today ?? "—"}`);
    lines.push(`  IQC: 入库 ${d.received_today ?? "—"} / 待 IQC ${d.iqc_pending ?? "—"}`);
    lines.push(`  报废: ${d.scrap_today ?? "—"}`);
    lines.push("");
  }

  const bom = managerResults["bom-ai"];
  if (bom.ok) {
    const d = bom.data ?? {};
    lines.push("🔧 BOM 变更: " + (d.pending_eco ?? "—"));
    lines.push("");
  }

  const hr = managerResults["hr-ai"];
  if (hr.ok) {
    const d = hr.data ?? {};
    lines.push("👷 人力 (HR)");
    lines.push(`  出勤率: ${d.attendance_rate ?? "—"}%`);
    lines.push(`  加班: ${d.ot_hours_today ?? "—"}h`);
    lines.push("");
  }

  const rda = managerResults["rda-ai"];
  if (rda.ok) {
    const d = rda.data ?? {};
    lines.push("📊 异常: " + (d.anomalies_today ?? d.anomalies ?? "—"));
    lines.push("");
  }

  lines.push("---");
  lines.push("以上为今日工厂运营日报。");

  const report = lines.join("\n");
  console.log("\n" + report + "\n");
  await sendLINE(report);

  log("INFO", "=== Evening report complete ===");
  return { managerResults, report };
}

// ── Live KPI snapshot ────────────────────────────────────────────────────

async function liveKpiSnapshot() {
  const kpis = await collectAllKpis();
  console.log(JSON.stringify(kpis, null, 2));
  return kpis;
}

// ── Multi-day report ────────────────────────────────────────────────────

async function multiDayReport(days = 7) {
  log("INFO", `Generating ${days}-day plant performance report...`);
  const state = await loadState();
  const okrs = state.okrProgress;

  const lines = [];
  lines.push(`📈 工厂绩效报告 (近 ${days} 天)`);
  lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  // OKR progress
  if (Object.keys(okrs).length > 0) {
    lines.push("🎯 OKR 进度");
    for (const [obj, krs] of Object.entries(okrs)) {
      lines.push(`  【${obj}】`);
      for (const [kr, v] of Object.entries(krs)) {
        const pct = v.target_value > 0
          ? Math.min(100, Math.round((v.current_value / v.target_value) * 100))
          : 0;
        lines.push(`    ${kr}: ${v.current_value} / ${v.target_value} (${pct}%) ← ${v.owner}`);
      }
    }
    lines.push("");
  }

  // Manager health summary
  lines.push("🔧 各管理器状态");
  for (const [mgr, health] of Object.entries(state.managerHealth)) {
    lines.push(`  ${mgr}: ${health.ok ? "✅ 正常" : "⚠️ 异常 (" + health.error + ")"}`);
    if (health.receivedAt) lines.push(`    最近响应: ${health.receivedAt}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("报告结束");

  const report = lines.join("\n");
  console.log("\n" + report + "\n");
  await sendLINE(report);
  return report;
}

// ── Bus-watch mode ─────────────────────────────────────────────────────

async function busWatchLoop(intervalMin = 5) {
  log("INFO", `Starting bus-watch mode (poll every ${intervalMin} min)...`);
  let cycle = 0;
  while (true) {
    cycle++;
    try {
      await processAgentMessages();
      log("INFO", `[bus-watch cycle ${cycle}] processed`);
    } catch (err) {
      log("ERR", `[bus-watch] ${err.message}`);
    }
    await new Promise(r => setTimeout(r, intervalMin * 60 * 1000));
  }
}

// ── Ask ─────────────────────────────────────────────────────────────
async function ask(question) {
  log("INFO", `Q: ${question}`);
  try {
    const kpis = await collectAllKpis();
    const prompt = buildAskPrompt(kpis, question);
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    const raw = multi.text;
    const answer = raw
      .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
      .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:)/gi, "")
      .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
      .trim();
    console.log(answer);
    return answer;
  } catch (err) {
    log("ERROR", `ask failed: ${err.message}`);
    throw err;
  }
}

function buildAskPrompt(kpis, question) {
  return `你是一个SMT电子工厂的厂长AI助手（Plant AI Manager）。

用户问题：${question}

以下是工厂各子系统的实时KPI数据：

<MES_KPI>
${JSON.stringify(kpis.mes ?? {}, null, 2)}
</MES_KPI>

<WMS_KPI>
${JSON.stringify(kpis.wms ?? {}, null, 2)}
</WMS_KPI>

<BOM_KPI>
${JSON.stringify(kpis.bom ?? {}, null, 2)}
</BOM_KPI>

<HR_KPI>
${JSON.stringify(kpis.hr ?? {}, null, 2)}
</HR_KPI>

<RDA_KPI>
${JSON.stringify(kpis.rda ?? {}, null, 2)}
</RDA_KPI>

请直接回答用户问题，用中文，不要返回JSON格式。
如果数据不足，请明确说明需要补充哪些信息。`;
}

// ── Main CLI ────────────────────────────────────────────────────────────

const [, , command, arg] = process.argv;

async function main() {
  log("INFO", `Plant Manager starting — command: ${command ?? "(none)"}`);

  switch (command) {
    case "patrol":
      await patrolCycle();
      break;

    case "morning":
      await morningBriefing();
      break;

    case "evening":
      await eveningReport();
      break;

    case "kpi":
      await liveKpiSnapshot();
      break;

    case "report": {
      const days = parseInt(arg, 10) || 7;
      await multiDayReport(days);
      break;
    }

    case "bus-watch": {
      const interval = parseInt(arg, 10) || 5;
      await busWatchLoop(interval);
      break;
    }

    case "watch": {
      const intervalMin = parseInt(arg, 10) || 30;
      log("INFO", `Starting continuous patrol loop (every ${intervalMin} min)...`);
      let cycle = 0;
      while (true) {
        cycle++;
        try {
          await patrolCycle();
          log("INFO", `[watch cycle ${cycle}] complete`);
        } catch (err) {
          log("ERR", `[watch cycle ${cycle}] ${err.message}`);
        }
        await new Promise(r => setTimeout(r, intervalMin * 60 * 1000));
      }
    }

    case "ask": {
      const question = arg ?? "";
      if (!question) {
        console.log("Usage: node plant-manager.js ask \"<question>\"");
        process.exit(1);
      }
      await ask(question);
      break;
    }

    default: {
      console.log(`Plant Manager — available commands:
  node plant-manager.js patrol          # Lightweight plant-wide status
  node plant-manager.js morning         # Morning briefing → LINE
  node plant-manager.js evening         # End-of-day report → LINE
  node plant-manager.js kpi             # Live KPI snapshot to stdout
  node plant-manager.js report [days]   # Multi-day performance report
  node plant-manager.js watch [min]     # Continuous patrol loop (default 30 min)
  node plant-manager.js bus-watch [min] # Message listener only (default 5 min)
  node plant-manager.js ask "<q>"       # Interactive Q&A about plant status

Environment:
  AGENT_ID=plant-ai (auto-set)
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE — DB connection
  LINE_TOKEN — path to LINE Notify token file (default: services/worker/line_token.txt)
`);
      break;
    }
  }
}

main().catch(err => {
  log("ERR", `Fatal: ${err.message}`);
  process.exit(1);
});
