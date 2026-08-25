/**
 * bom-manager.js — BOM AI Manager Brain
 *
 * Orchestrates Ornith analysis + Node execution for BOM management.
 * Runs on schedule via Windows Task Scheduler or on-demand.
 *
 * Usage:
 *   node bom-manager.js patrol         # One-shot BOM analysis
 *   node bom-manager.js watch          # Continuous loop (every 30min)
 *   node bom-manager.js morning        # Morning BOM digest + LINE
 *   node bom-manager.js test           # Self-test with 5 scenarios
 *   node bom-manager.js bus-watch      # Listen for inter-agent messages continuously
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const QUERY_SCRIPT = join(PROJECT_ROOT, "services/worker/bom-query.js");
const ORNITH_MODEL = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const LINE_TOKEN    = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE    = join(PROJECT_ROOT, "services/worker/bom-last-state.json");
const LOG_FILE      = join(PROJECT_ROOT, "services/worker/bom-manager.log");

// ── Agent Bus ────────────────────────────────────────────────────────────
process.env.AGENT_ID = "bom-ai";

import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

const mem = createMemoryClient({ agentId: "bom-ai" });

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try { require("fs").appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Manager Bus ────────────────────────────────────────────────────────────
let bus = null; // defined after MESSAGE_HANDLERS below

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(err));
      else resolve(out);
    });
  });
}

/** Extract balanced-brace JSON object starting at `start` index in `str`. */
function extractJsonObject(str, start) {
  if (str[start] !== '{') {
    while (start >= 0 && str[start] !== '{') start--;
  }
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    else if (str[i] === '"') { i++; while (i < str.length && str[i] !== '"') { if (str[i] === '\\') i++; i++; } }
  }
  return null;
}

function parseOrnithJSON(raw) {
  if (!raw) return null;
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/i, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();

  // Strategy 0: direct full JSON parse
  try { return JSON.parse(clean); } catch (_) {}

  // Strategy 1: <ANALYSIS> tag with JSON inside
  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) try { return JSON.parse(tagMatch[1]); } catch (_) {}

  // Strategy 2: bare JSON with "alerts" and "summary"
  const jsonMatch = clean.match(/\{[\s\S]*"alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) try { return JSON.parse(jsonMatch[0]); } catch (_) {}

  // Strategy 3: substring from first "alerts" key (brace-counting)
  const alt = clean.match(/"alerts"\s*:\s*\[/);
  if (alt) {
    const objStr = extractJsonObject(clean, clean.indexOf('"alerts"'));
    if (objStr) try { return JSON.parse(objStr); } catch (_) {}
  }

  // Strategy 4: find "anomalies" field (Ornith alternative schema)
  const anomaliesMatch = clean.match(/"anomalies"\s*:\s*\[/);
  if (anomaliesMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"anomalies"'));
    if (objStr) try { return JSON.parse(objStr); } catch (_) {}
  }

  // Strategy 5: find any JSON object with "summary" (string)
  const summaryMatch = clean.match(/"summary"\s*:\s*"[^"]*"/);
  if (summaryMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"summary"'));
    if (objStr) try { return JSON.parse(objStr); } catch (_) {}
  }

  return null;
}

async function sendLINE(msg) {
  if (!existsSync(LINE_TOKEN)) { log("WARN", "No LINE token, skip"); return; }
  const token = readFileSync(LINE_TOKEN, "utf8").trim();
  if (!token) return;
  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg }),
  });
  if (!res.ok) log("WARN", `LINE fail: ${res.status}`);
}

async function loadState() {
  try {
    const results = await mem.search("most recent BOM manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (_) {}
  return { bomLines: [], materialReadiness: [], lastCycle: null };
}

async function saveState(state) {
  try {
    const label = `BOM cycle — ${state.lastCycle?.slice(0, 10) || "?"}`;
    await mem.store(`${label} — ${Object.keys(state).filter(k => k !== "lastCycle" && k !== "lastRun").length} data fields`, { type: "bom_state", state, ts: state.lastRun || new Date().toISOString() });
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { require("fs").writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

// ── Agent Bus: Outbound Message Senders ───────────────────────────────────────

async function informMesBomUpdated(productCode, oldVersion, newVersion, changes, effectiveDate) {
  await bus.send("mes-ai", "bom_updated", {
    product_code: productCode,
    old_version: oldVersion,
    new_version: newVersion,
    changes,
    effective_date: effectiveDate,
  });
}

async function informMesAlternativeAvailable(originalMaterial, alternativeMaterial, substitutionReason, supplier) {
  await bus.send("mes-ai", "alternative_available", {
    original_material: originalMaterial,
    alternative_material: alternativeMaterial,
    substitution_reason: substitutionReason,
    supplier,
  });
}

async function informMesBomAccuracyAlert(productCode, expectedMaterial, actualOnLine, description) {
  await bus.send("mes-ai", "bom_accuracy_alert", {
    product_code: productCode,
    expected_material: expectedMaterial,
    actual_on_line: actualOnLine,
    description,
  }, { priority: "critical" });
}

async function informWmsSupplierQualityConcern(materialCode, defectRate, supplierCode) {
  await bus.send("wms-ai", "supplier_quality_concern", {
    material_code: materialCode,
    defect_rate: defectRate,
    supplier_code: supplierCode,
  });
}

async function informWmsBomChangeAffected(materialCode, bomVersionsAffected) {
  await bus.send("wms-ai", "bom_change_affected", {
    material_code: materialCode,
    bom_versions_affected: bomVersionsAffected,
  });
}

async function informHrEcoPendingApproval(ecoId, productCode, changeSummary) {
  await bus.send("hr-ai", "eco_pending_approval", {
    eco_id: ecoId,
    product_code: productCode,
    change_summary: changeSummary,
  });
}

async function informRdaBomAccuracyFeedback(productCode, accuracyRate, discrepancyCount) {
  await bus.send("rda-ai", "bom_accuracy_feedback", {
    product_code: productCode,
    accuracy_rate: accuracyRate,
    discrepancy_count: discrepancyCount,
  });
}

// ── Agent Bus: Inbound Message Handlers ──────────────────────────────────────

async function handleMaterialSubstitutionNeeded(payload) {
  // MES found wrong material on feeder — find if actual is a valid substitute
  const { work_order_code, product_code, expected_material, actual_on_feeder, station_code } = payload;
  log("INFO", `[MES→BOM] material_substitution_needed: expected=${expected_material} actual=${actual_on_feeder} for ${product_code}`);
  try {
    const raw = await run([QUERY_SCRIPT, "bom-explode", "--product", product_code]);
    const bomData = JSON.parse(raw);
    const lines = Array.isArray(bomData) ? bomData : (bomData.data ?? []);
    const match = lines.find(l => l.material_code === actual_on_feeder);
    if (match) {
      await informMesAlternativeAvailable(expected_material, actual_on_feeder, "Pin-compatible, BOM alternate", match.supplier ?? "unknown");
    } else {
      await informMesBomAccuracyAlert(product_code, expected_material, actual_on_feeder,
        `Station ${station_code}: BOM requires ${expected_material} but feeder has ${actual_on_feeder}`);
    }
  } catch (err) {
    log("WARN", `handleMaterialSubstitutionNeeded failed: ${err.message}`);
  }
}

async function handleComponentFailureRate(payload) {
  // MES detected high defect rate for a component
  const { material_code, defect_rate_pct, station_type, defect_code, period_days } = payload;
  log("WARN", `[MES→BOM] component_failure_rate: ${material_code} — ${defect_rate_pct}% ${defect_code} at ${station_type} over ${period_days}d`);
  try {
    // Query supplier for this material
    const raw = await run([QUERY_SCRIPT, "bom-detail", "--material", material_code]);
    const data = JSON.parse(raw);
    const material = (Array.isArray(data) ? data : (data.data ?? []))[0];
    if (material?.supplier_code) {
      await informWmsSupplierQualityConcern(material_code, defect_rate_pct, material.supplier_code);
    }
  } catch (_) {}
}

async function handleBomUsageFeedback(payload) {
  // MES reports actual consumption vs BOM expected
  const { product_code, material_code, bom_qty_per, actual_avg_consumption, sample_size } = payload;
  log("INFO", `[MES→BOM] bom_usage_feedback: ${product_code}/${material_code} — BOM=${bom_qty_per} actual=${actual_avg_consumption} (n=${sample_size})`);
  // Check if discrepancy exceeds 10%
  if (bom_qty_per > 0) {
    const delta = Math.abs(actual_avg_consumption - bom_qty_per) / bom_qty_per;
    if (delta > 0.10) {
      await informRdaBomAccuracyFeedback(product_code, (1 - delta) * 100, Math.round(delta * sample_size));
      log("WARN", `BOM usage discrepancy > 10% for ${product_code}/${material_code} — flagged for audit`);
    }
  }
}

async function handleMaterialNeededBom(payload) {
  // MES needs substitute material for a shortage
  const { work_order_code, material_code, required_qty, line_code, urgency } = payload;
  log("INFO", `[MES→BOM] material_needed: ${material_code} x${required_qty} for WO:${work_order_code} urgency=${urgency}`);
  try {
    const raw = await run([QUERY_SCRIPT, "bom-explode", "--product", material_code]);
    const bomData = JSON.parse(raw);
    const lines = Array.isArray(bomData) ? bomData : (bomData.data ?? []);
    const substitutes = lines.filter(l => l.material_code !== material_code && l.is_alternate);
    if (substitutes.length > 0) {
      for (const sub of substitutes) {
        await informMesAlternativeAvailable(material_code, sub.material_code, "Available substitute", sub.supplier ?? "unknown");
      }
    }
  } catch (_) {}
}

async function handleBomChangeAffected(payload) {
  // WMS: BOM change affects picked material
  const { material_code, bom_versions_affected } = payload;
  log("INFO", `[WMS→BOM] bom_change_affected: ${material_code} in versions ${bom_versions_affected?.join(", ")}`);
}

async function handleSupplierQualityConcern(payload) {
  // WMS/BOM reports component failure from supplier
  const { material_code, defect_rate, supplier_code } = payload;
  log("WARN", `[WMS→BOM] supplier_quality_concern: ${material_code} from ${supplier_code} — defect rate ${defect_rate}%`);
}

async function handleIqcHoldBom(payload) {
  // WMS put material on IQC hold
  const { lot_no, material_code, qty, reason } = payload;
  log("INFO", `[WMS→BOM] iqc_hold: ${lot_no} (${material_code}) x${qty} — ${reason}`);
}

async function handleMaterialIssuedBom(payload) {
  // WMS issued material to line
  const { lot_no, material_code, qty, work_order_code, line_code } = payload;
  log("INFO", `[WMS→BOM] material_issued: ${lot_no} (${material_code}) x${qty} → ${line_code} WO:${work_order_code}`);
}

async function handleEcoPendingApproval(payload) {
  // HR: ECO pending approval — ensure training scheduled
  const { eco_id, product_code, change_summary } = payload;
  log("INFO", `[HR→BOM] eco_pending: ${eco_id} for ${product_code} — ${change_summary}`);
}

async function handleBomUpdatedHr(payload) {
  // BOM was updated — check if operators need retraining
  const { product_code, old_version, new_version, changes, effective_date } = payload;
  log("INFO", `[BOM→BOM] bom_updated: ${product_code} v${old_version}→v${new_version} effective ${effective_date}`);
}

async function handleAnomalyDetectedBom(payload) {
  // RDA: anomaly in BOM-related data
  const { source, metric, expected_range, actual, z_score, period } = payload;
  log("INFO", `[RDA→BOM] anomaly_detected: ${metric} — actual=${actual} expected=${expected_range} z=${z_score} over ${period}`);
}

async function handleReportReadyBom(payload) {
  // RDA: BOM-related report is ready
  const { report_key, period, archive_id, summary } = payload;
  log("INFO", `[RDA→BOM] report_ready: ${report_key} (${period}) archive_id=${archive_id} — ${summary}`);
}

async function handleDataRequest(payload) {
  // Generic data request from another agent
  const { request_id, query, filters } = payload;
  log("INFO", `[AGENT→BOM] data_request: ${query} from ${request_id}`);
  try {
    let data;
    switch (query) {
      case "bom-list":
        data = JSON.parse(await run([QUERY_SCRIPT, "bom-list"]));
        break;
      case "bom-explode":
        data = JSON.parse(await run([QUERY_SCRIPT, "bom-explode", "--product", filters?.product_code ?? ""]));
        break;
      case "material-readiness":
        data = JSON.parse(await run([QUERY_SCRIPT, "material-readiness", "--wocode", filters?.work_order_code ?? ""]));
        break;
      case "eco-list":
        data = JSON.parse(await run([QUERY_SCRIPT, "eco-list"]));
        break;
      default:
        data = { error: `Unknown query: ${query}` };
    }
    await bus.send(payload.source_agent || "mes-ai", "data_response", {
      request_id,
      query,
      data,
    }, { correlationId: request_id });
  } catch (err) {
    await bus.send(payload.source_agent || "mes-ai", "data_response", {
      request_id,
      query,
      error: err.message,
    }, { correlationId: request_id });
  }
}

// ── Plant Manager directive handler ───────────────────────────────────────
async function handlePlantDirective(payload) {
  const { source, severity, title, detail, product_code, action } = payload;
  log("WARN", `[PLANT→BOM] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🏭 [工厂指令-BOM] ${title}\n产品: ${product_code ?? "N/A"}\n详情: ${detail}`);
  }
}

// ── Plant Manager status request handler ──────────────────────────────────
async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  log("INFO", `[PLANT→BOM] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    const [bomRaw, ecoRaw] = await Promise.all([
      run([QUERY_SCRIPT, "bom-list"]),
      run([QUERY_SCRIPT, "eco-list"]),
    ]);
    const bomData = JSON.parse(bomRaw);
    const ecoData = JSON.parse(ecoRaw);
    const kpis = {
      total_boms:       Array.isArray(bomData) ? bomData.length : (bomData.data?.length ?? 0),
      pending_eco:       Array.isArray(ecoData) ? ecoData.filter(e => e.status === "pending").length : 0,
      bom_versions:      Array.isArray(bomData) ? new Set(bomData.map(b => b.product_code)).size : 0,
    };
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "bom-ai",
      kpis,
    }, { correlationId: request_id });
    log("INFO", `[PLANT→BOM] plant_status_response sent for req=${request_id}`);
  } catch (err) {
    log("ERR", `[PLANT→BOM] plant_status_request failed: ${err.message}`);
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "bom-ai",
      error: err.message,
    }, { correlationId: request_id });
  }
}

// ── Agent Bus: Message Dispatcher ─────────────────────────────────────────────

const MESSAGE_HANDLERS = {
  "material_substitution_needed": handleMaterialSubstitutionNeeded,
  "component_failure_rate":      handleComponentFailureRate,
  "bom_usage_feedback":          handleBomUsageFeedback,
  "material_needed":              handleMaterialNeededBom,
  "bom_change_affected":         handleBomChangeAffected,
  "supplier_quality_concern":    handleSupplierQualityConcern,
  "iqc_hold":                    handleIqcHoldBom,
  "material_issued":             handleMaterialIssuedBom,
  "eco_pending_approval":         handleEcoPendingApproval,
  "bom_updated":                 handleBomUpdatedHr,
  "anomaly_detected":            handleAnomalyDetectedBom,
  "report_ready":                handleReportReadyBom,
  "data_request":               handleDataRequest,
  // Plant Manager
  "plant_directive":            handlePlantDirective,
  "plant_status_request":       handlePlantStatusRequest,
};

// ── Manager Bus (after MESSAGE_HANDLERS) ─────────────────────────────────
bus = createManagerBus({
  agentId: "bom-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: MESSAGE_HANDLERS,
});

async function processAgentMessages() {
  await bus.init();
  await bus.poll(20);
}

// ── Agent Bus: Outbound — send messages based on Ornith analysis ───────────────

async function sendOutboundMessages(analysis, rawData) {
  if (!analysis) return;

  // ECO/BOM change alerts
  for (const alert of analysis.alerts ?? []) {
    if (alert.area === "bom" && alert.severity === "critical") {
      // Find affected product from rawData
      const products = rawData["phantom-materials"] ?? rawData["orphan-inventory"] ?? [];
      for (const p of products) {
        await informMesBomUpdated(
          p.product_code ?? p.code ?? "UNKNOWN",
          "old",
          "new",
          [alert.detail],
          new Date().toISOString().slice(0, 10)
        );
      }
    }
  }

  // Phantom material recommendations → inform MES + WMS
  for (const rec of analysis.phantom_recommendations ?? []) {
    if (rec.action === "REMOVE_LINE") {
      await informMesBomAccuracyAlert(
        rec.bom_id?.toString() ?? "UNKNOWN",
        "inactive-material",
        rec.material_id?.toString() ?? "unknown",
        `Phantom BOM line: material inactive but referenced in BOM`
      );
    }
  }

  // Duplicate BOM lines → inform MES
  for (const rec of analysis.duplicate_recommendations ?? []) {
    if (rec.action === "MERGE_LINES") {
      await informMesBomAccuracyAlert(
        rec.bom_id?.toString() ?? "UNKNOWN",
        rec.material_code,
        rec.material_code,
        `Duplicate BOM lines for material ${rec.material_code} — needs cleanup`
      );
    }
  }

  // Cost anomalies → inform WMS (stock value impact)
  for (const anomaly of rawData["cost-anomaly"] ?? []) {
    if (anomaly.cost_delta_pct > 20) {
      await informWmsSupplierQualityConcern(
        anomaly.material_code ?? "UNKNOWN",
        anomaly.cost_delta_pct,
        anomaly.supplier_code ?? "unknown"
      );
    }
  }

  // Orphan inventory → inform MES BOM accuracy
  for (const orphan of rawData["orphan-inventory"] ?? []) {
    await informMesBomAccuracyAlert(
      orphan.product_code ?? "UNKNOWN",
      orphan.material_code ?? "UNKNOWN",
      "no-bom",
      `Material ${orphan.material_code} has stock but no active BOM references it`
    );
  }
}

async function queryAll() {
  const raw = await run([QUERY_SCRIPT, "all"]);
  try { return JSON.parse(raw); } catch (_) {
    log("WARN", "Failed to parse bom-query.js output as JSON");
    return {};
  }
}

function buildPrompt(data) {
  return `工厂BOM巡逻报告 — ${new Date().toLocaleString("zh-CN")}

<PHANTOM_MATERIALS>
${JSON.stringify(data["phantom-materials"] ?? [], null, 2)}
</PHANTOM_MATERIALS>

<DUPLICATE_LINES>
${JSON.stringify(data["duplicate-lines"] ?? [], null, 2)}
</DUPLICATE_LINES>

<ZERO_QTY>
${JSON.stringify(data["zero-qty"] ?? [], null, 2)}
</ZERO_QTY>

<ORPHAN_INVENTORY>
${JSON.stringify(data["orphan-inventory"] ?? [], null, 2)}
</ORPHAN_INVENTORY>

<COST_ANOMALIES>
${JSON.stringify(data["cost-anomaly"] ?? [], null, 2)}
</COST_ANOMALIES>

<MATERIALS_NO_BOM>
${JSON.stringify(data["materials-no-bom"] ?? [], null, 2)}
</MATERIALS_NO_BOM>

你是一个SMT电子工厂的BOM AI管理员。基于以上BOM数据巡逻结果，做出智能决策。

严格按照以下JSON格式返回（只返回JSON，不要其他文字）：

<ANALYSIS>
{
  "alerts": [
    {
      "severity": "critical|warning|info",
      "area": "bom|material|cost",
      "title": "标题",
      "detail": "详细描述",
      "action": "具体行动",
      "urgency": "immediate|24h|this_week"
    }
  ],
  "phantom_recommendations": [
    { "bom_id": 数字, "material_id": 数字, "action": "REMOVE_LINE|CREATE_MATERIAL", "reason": "原因" }
  ],
  "duplicate_recommendations": [
    { "bom_id": 数字, "material_code": "代码", "action": "MERGE_LINES|REMOVE_DUPLICATE", "reason": "原因" }
  ],
  "inventory_recommendations": [
    { "material_code": "代码", "current_stock": 数字, "action": "REALLOCATE|WRITE_OFF|RETURN_VENDOR", "reason": "原因" }
  ],
  "summary": "一句话总结本次巡逻发现"
}
</ANALYSIS>`;
}

async function patrolCycle() {
  const cycleId = `bc-${Date.now().toString(36)}`;
  log("INFO", `=== BOM Patrol [${cycleId}] START ===`);

  await bus.init();

  try {
    // Step 1: Query all BOM checks
    log("INFO", "Querying BOM data...");
    const rawData = await queryAll();
    log("INFO", `  Phantom: ${rawData["phantom-materials"]?.length ?? 0}`);
    log("INFO", `  Duplicates: ${rawData["duplicate-lines"]?.length ?? 0}`);
    log("INFO", `  Zero-qty: ${rawData["zero-qty"]?.length ?? 0}`);
    log("INFO", `  Orphans: ${rawData["orphan-inventory"]?.length ?? 0}`);
    log("INFO", `  Cost-anomaly: ${rawData["cost-anomaly"]?.length ?? 0}`);
    log("INFO", `  Materials-no-BOM: ${rawData["materials-no-bom"]?.length ?? 0}`);

    // Step 1b: Process inbound messages from other agents
    log("INFO", "Processing inter-agent messages...");
    try { await processAgentMessages(); } catch (e) { log("WARN", `Agent msg processing: ${e.message}`); }

    // Step 2: Feed Ornith for analysis
    log("INFO", "Asking Ornith for BOM analysis...");
    let analysis = null;
    try {
      const prompt = buildPrompt(rawData);
      let ornithRaw;
      try {
        const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
        ornithRaw = multi.text;
        log("INFO", `Primary model ${multi.model} responded (${ornithRaw.length} chars)`);
        if (scoreResponse(ornithRaw) < 4) {
          const fb = await askLLM("validator", prompt, { temperature: 0.1 });
          if (scoreResponse(fb) > scoreResponse(ornithRaw)) { ornithRaw = fb; log("INFO", "Using validator output"); }
        }
      } catch (e) {
        log("ERROR", `Multi-model analysis failed: ${e.message}`);
        return;
      }
      analysis = parseOrnithJSON(ornithRaw);
      log("INFO", `LLM analysis: ${analysis ? "OK" : "FAILED to parse"}`);
      if (analysis) {
        const alertCount = analysis.alerts?.length ?? 0;
        log("INFO", `  Alerts: ${alertCount}`);
        log("INFO", `  Summary: ${analysis.summary ?? ""}`);
      }
    } catch (e) {
      log("ERROR", `Analysis failed: ${e.message}`);
    }

    // Step 3: Handle alerts
    if (analysis?.alerts) {
      const critical = analysis.alerts.filter(a => a.severity === "critical");
      if (critical.length > 0) {
        const msg = `🚨 BOM AI 严重警报 (${cycleId})\n${critical.map(a => `[${a.area}] ${a.title}: ${a.detail}`).join("\n")}`;
        await sendLINE(msg);
      }
    }

    // Step 3b: Send outbound messages to other agents
    log("INFO", "Sending outbound inter-agent messages...");
    try { await sendOutboundMessages(analysis, rawData); } catch (e) { log("WARN", `Outbound messaging: ${e.message}`); }

    // Step 4: Save state
    await saveState({
      phantomMaterials: rawData["phantom-materials"] ?? [],
      duplicateLines: rawData["duplicate-lines"] ?? [],
      zeroQty: rawData["zero-qty"] ?? [],
      orphanInventory: rawData["orphan-inventory"] ?? [],
      costAnomalies: rawData["cost-anomaly"] ?? [],
      materialsNoBom: rawData["materials-no-bom"] ?? [],
      lastCycle: cycleId,
      lastRun: new Date().toISOString(),
    });

    log("INFO", `=== BOM Patrol [${cycleId}] DONE ===`);
    return { cycleId, data: rawData, analysis };
  } catch (e) {
    log("ERROR", `Patrol error: ${e.message}`);
    return { cycleId, error: e.message };
  }
}

async function morningDigest() {
  await bus.init();
  log("INFO", "=== BOM Morning Digest ===");
  try { await processAgentMessages(); } catch (_) {}
  const result = await patrolCycle();
  if (result.analysis?.summary) {
    const lineMsg = `🌅 BOM晨报 (${new Date().toLocaleDateString("zh-CN")})\n${result.analysis.summary}`;
    await sendLINE(lineMsg);
  }
}

// ── Continuous message listener ───────────────────────────────────────────────
async function busWatchLoop(intervalMs = 30 * 1000) {
  log("INFO", `BOM bus-watch started (poll every ${intervalMs / 1000}s)`);
  await bus.init();
  for (;;) {
    try {
      await processAgentMessages();
    } catch (e) {
      log("WARN", `bus-watch error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function patrolLoop(intervalMs = 30 * 60 * 1000) {
  log("INFO", `BOM patrol loop started, interval=${intervalMs}ms`);
  for (;;) {
    await patrolCycle();
    log("INFO", `Sleeping ${intervalMs / 1000}s...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ── Self-test with 5 scenarios ───────────────────────────────────────
async function selfTest() {
  log("INFO", "=== BOM Self-Test: 5 Scenarios ===\n");

  const scenarios = [
    { n: 1, title: "Phantom material reference", query: "phantom-materials" },
    { n: 2, title: "Duplicate BOM lines",        query: "duplicate-lines" },
    { n: 3, title: "Zero/negative qty lines",     query: "zero-qty" },
    { n: 4, title: "Orphan inventory (stock no BOM)", query: "orphan-inventory" },
    { n: 5, title: "Cost anomaly >20%",           query: "cost-anomaly" },
  ];

  let passed = 0;
  for (const s of scenarios) {
    try {
      const raw = await run([QUERY_SCRIPT, s.query]);
      const data = JSON.parse(raw);
      const count = Array.isArray(data) ? data.length : (data[s.query]?.length ?? 0);
      const ok = count > 0;
      log("INFO", `${ok ? "PASS" : "----"} [Scenario ${s.n}] ${s.title} — found ${count} issue(s)`);
      if (ok) passed++;
      else log("INFO", `  (none found — data not seeded)`);
    } catch (e) {
      log("ERROR", `FAIL  [Scenario ${s.n}] ${s.title}: ${e.message}`);
    }
  }

  log("INFO", `\n=== Result: ${passed}/${scenarios.length} passed ===`);
  return { passed, total: scenarios.length };
}

// ── Ask ─────────────────────────────────────────────────────────────
async function ask(question) {
  log("INFO", `Q: ${question}`);
  try {
    const rawData = await queryAll();
    const prompt = buildAskPrompt(rawData, question);
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    const ornithRaw = multi.text;
    const answer = ornithRaw
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

function buildAskPrompt(data, question) {
  return `你是一个SMT电子工厂的BOM AI管理员（物料清单管理）。

用户问题：${question}

以下是当前BOM系统中的实时数据，请基于这些数据回答用户问题：

<PHANTOM_MATERIALS>
${JSON.stringify(data["phantom-materials"] ?? [], null, 2)}
</PHANTOM_MATERIALS>

<DUPLICATE_LINES>
${JSON.stringify(data["duplicate-lines"] ?? [], null, 2)}
</DUPLICATE_LINES>

<ZERO_QTY>
${JSON.stringify(data["zero-qty"] ?? [], null, 2)}
</ZERO_QTY>

<ORPHAN_INVENTORY>
${JSON.stringify(data["orphan-inventory"] ?? [], null, 2)}
</ORPHAN_INVENTORY>

<COST_ANOMALIES>
${JSON.stringify(data["cost-anomaly"] ?? [], null, 2)}
</COST_ANOMALIES>

<MATERIALS_NO_BOM>
${JSON.stringify(data["materials-no-bom"] ?? [], null, 2)}
</MATERIALS_NO_BOM>

请直接回答用户问题，用中文，不要返回JSON格式。
如果数据不足，请明确说明需要补充哪些信息。`;
}

// ── Main dispatch ────────────────────────────────────────────────────
const cmd = process.argv[2] ?? "patrol";
switch (cmd) {
  case "patrol":
    patrolCycle().then(r => {
      if (r.analysis) console.log(JSON.stringify(r.analysis, null, 2));
      process.exit(r.error ? 1 : 0);
    }).catch(e => { log("FATAL", e.message); process.exit(1); });
    break;
  case "watch":
    patrolLoop();
    break;
  case "morning":
    morningDigest().then(() => process.exit(0));
    break;
  case "bus-watch":
    busWatchLoop().catch(e => { log("FATAL", e.message); process.exit(1); });
    break;
  case "test":
    selfTest().then(r => process.exit(r.passed === r.total ? 0 : 1));
    break;
  case "ask": {
    const question = process.argv[3] ?? "";
    if (!question) {
      console.log("Usage: node bom-manager.js ask \"<question>\"");
      process.exit(1);
    }
    ask(question).then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  }
  default:
    console.log(`Usage: node bom-manager.js <patrol|watch|morning|bus-watch|test|ask>`);
    process.exit(1);
}
