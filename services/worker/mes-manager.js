/**
 * mes-manager.js — MES AI Manager Brain
 *
 * Orchestrates Ornith analysis + Node.js execution.
 * Runs on schedule via Windows Task Scheduler or continuous loop.
 *
  * Usage:
  *   node mes-manager.js patrol              # One-shot analysis
  *   node mes-manager.js morning             # Morning digest + LINE
  *   node mes-manager.js evening             # Evening OEE report
  *   node mes-manager.js watch [intervalMin] # Continuous loop
  *   node mes-manager.js eval [limit]        # Score recent decisions
  *   node mes-manager.js report [days]       # Performance report
  *   node mes-manager.js ask "<question>"    # Interactive Q&A
  */

import { spawn } from "child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
import { createMemoryClient, memoryHealth } from "../../_shared/memory-client.js";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const EXEC_SCRIPT   = join(PROJECT_ROOT, "services/worker/mes-execute.js");
const QUERY_SCRIPT  = join(PROJECT_ROOT, "services/worker/mes-query.js");
const EVAL_SCRIPT   = join(PROJECT_ROOT, "services/worker/mes-evaluator.js");
const ORNITH_MODEL = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const LINE_TOKEN    = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE   = join(PROJECT_ROOT, "services/worker/last-state.json");
const PENDING_FILE = join(PROJECT_ROOT, "services/worker/pending-approvals.json");
const LOG_FILE     = join(PROJECT_ROOT, "services/worker/mes-manager.log");

// ── mem0 memory client (persistent across patrol cycles) ─────────────────
const mem = createMemoryClient({ agentId: "mes-ai" });

// ── Agent Bus (inter-agent communication) ─────────────────────────────────────
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

// ── Logging ───────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch (_) {}
}

// ── Manager Bus ────────────────────────────────────────────────────────────
let bus = null;

// ── Run external script (args as array, no shell injection) ──────────
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out);
    });
  });
}

// ── Run opencode (args as array, uses cmd /c on Windows) ─────────────
function runOpencode(args) {
  return new Promise((resolve, reject) => {
    const cmdLine = `opencode ${args.join(" ")}`;
    const child = spawn("cmd", ["/c", cmdLine], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH },
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out);
    });
  });
}



// ── Robust Ornith output parser (6 fallback strategies) ──────────────

/** Extract balanced-brace JSON object starting at `start` index in `str`. */
function extractJsonObject(str, start) {
  if (str[start] !== '{') {
    // Scan backwards to find the opening brace
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

function parseOrnithOutput(raw) {
  if (!raw) return null;

  // Strip thinking blocks
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/i, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();

  // Strategy 0: direct full JSON parse (most common clean output)
  try { return JSON.parse(clean); } catch (_) {}

  // Strategy 1: <ANALYSIS> tag with JSON inside
  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) {
    try { return JSON.parse(tagMatch[1]); } catch (_) {}
  }

  // Strategy 2: bare JSON with "alerts" and "summary"
  const jsonMatch = clean.match(/\{[\s\S]*"alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  }

  // Strategy 3: substring from first "alerts" key (brace-counting)
  const altMatch = clean.match(/"alerts"\s*:\s*\[/);
  if (altMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"alerts"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }

  // Strategy 4: find "anomalies" field (Ornith alternative schema)
  const anomaliesMatch = clean.match(/"anomalies"\s*:\s*\[/);
  if (anomaliesMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"anomalies"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }

  // Strategy 5: find any JSON object that has "summary" (string)
  const summaryMatch = clean.match(/"summary"\s*:\s*"[^"]*"/);
  if (summaryMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"summary"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }

  return null;
}

// ── LINE notification ─────────────────────────────────────────────────
async function sendLINE(message) {
  if (!existsSync(LINE_TOKEN)) {
    log("WARN", "LINE token not found, skipping notification");
    return;
  }
  const token = readFileSync(LINE_TOKEN, "utf8").trim();
  if (!token) return;

  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ message }),
  });
  if (!res.ok) log("WARN", `LINE send failed: ${res.status}`);
  else log("INFO", "LINE notification sent");
}

// ── Build Ornith prompt from MES data ─────────────────────────────────
function buildPrompt(mesData) {
  const ts = new Date().toLocaleString("zh-CN");
  return `## MES AI Manager — Analysis Request
Factory data snapshot — ${ts}

<LINES>
${JSON.stringify(mesData.lines ?? [], null, 2)}
</LINES>

<RUNS>
${JSON.stringify(mesData.runs ?? [], null, 2)}
</RUNS>

<STATION_EVENTS>
${JSON.stringify(mesData.events ?? [], null, 2)}
</STATION_EVENTS>

<STAGNATION>
${JSON.stringify(mesData.stagnation ?? [], null, 2)}
</STAGNATION>

<SCRAPS>
${JSON.stringify(mesData.scraps ?? [], null, 2)}
</SCRAPS>

<DOWNTIMES>
${JSON.stringify(mesData.downtimes ?? [], null, 2)}
</DOWNTIMES>

<FEEDER_BINDINGS>
${JSON.stringify(mesData.feeders ?? [], null, 2)}
</FEEDER_BINDINGS>

<FOOL_PROOF_RULES>
${JSON.stringify(mesData.fool_proof ?? [], null, 2)}
</FOOL_PROOF_RULES>

<MATERIAL_VERIFICATIONS>
${JSON.stringify(mesData.material_verify ?? [], null, 2)}
</MATERIAL_VERIFICATIONS>

<FIRST_ARTICLE>
${JSON.stringify(mesData.first_article ?? [], null, 2)}
</FIRST_ARTICLE>

<DUPLICATE_SN>
${JSON.stringify(mesData.duplicate_serials ?? [], null, 2)}
</DUPLICATE_SN>

<NG_EVENTS>
${JSON.stringify(mesData.ng_events ?? [], null, 2)}
</NG_EVENTS>

Context: You are an MES AI Manager for a Vietnam SMT factory.
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [
    {{
      "severity": "critical|warning|info",
      "area": "line|quality|stagnation|scrap|downtime|feeder|foolproof|material",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动",
      "line_code": "产线号",
      "urgency": "immediate|24h|this_week"
    }}
  ],
  "yield_alerts": [
    {{
      "line_code": "SMT-1F",
      "station_type": "AOI",
      "yield": 94.1,
      "baseline": 97.0,
      "status": "warning|critical|ok"
    }}
  ],
  "stagnation_actions": [
    {{
      "sn": "PCB-SN号或id",
      "level": "normal|warning|alert|critical",
      "recommendation": "continue|rework|scrap",
      "auto_execute": true
    }}
  ],
  "scrap_decisions": [
    {{
      "sn": "scrap记录的id或标识",
      "action": "approve|reject|pending",
      "reason": "判定原因",
      "auto_execute": true
    }}
  ],
  "downtime_flags": [
    {{
      "downtime_no": "停机编号或id",
      "duration_minutes": 0,
      "recommendation": "close|escalate|investigate",
      "auto_execute": true
    }}
  ],
  "feeder_checks": [
    {{
      "binding_id": "feeder绑定id",
      "action": "warn|block|pass",
      "reason": "原因"
    }}
  ],
  "oee_report": {{
    "line_code": "",
    "availability": 0,
    "performance": 0,
    "quality": 0,
    "oee": 0,
    "rating": "world_class|acceptable|needs_improvement|critical"
  }},
  "line_actions": [
    {{
      "line_code": "SMT-1F",
      "action": "alert|check|flag",
      "level": "info|warning|critical",
      "message": "操作信息"
    }}
  ],
  "duplicate_sn_actions": [
    {{
      "serial_no": "重复的SN号",
      "appearances": 2,
      "work_order_code": "工单号",
      "product_code": "产品编号",
      "line_code": "产线",
      "action": "investigate|quarantine|release",
      "reason": "判定原因"
    }}
  ],
  "ng_station_summary": [
    {{
      "station_code": "站号",
      "station_type": "SPI|AOI|ICT|FCT|...",
      "line_code": "SMT-1F",
      "ng_count": 5,
      "ng_rate": 3.2,
      "top_ng_type": "FAIL|REJECT|ERROR",
      "status": "normal|warning|critical"
    }}
  ],
  "summary": "一句话总结当前产线状态"
}}
</ANALYSIS>`;
}

// ── Interactive Q&A prompt builder ─────────────────────────────────────────
function buildAskPrompt(question, data) {
  const ts = new Date().toLocaleString("zh-CN");
  return `工厂MES AI管理员问答 — ${ts}

你是一个SMT电子工厂的MES AI管理员。请根据以下当前生产数据，回答用户的问题。

<LINES>
${JSON.stringify(data.lines ?? [], null, 2)}
</LINES>

<RUNS>
${JSON.stringify(data.runs ?? [], null, 2)}
</RUNS>

<STATION_EVENTS>
${JSON.stringify(data.events ?? [], null, 2)}
</STATION_EVENTS>

<DOWNTIMES>
${JSON.stringify(data.downtimes ?? [], null, 2)}
</DOWNTIMES>

<FEEDER_BINDINGS>
${JSON.stringify(data.feeders ?? [], null, 2)}
</FEEDER_BINDINGS>

<OEE>
${JSON.stringify(data.oee ?? [], null, 2)}
</OEE>

<DUPLICATE_SN>
${JSON.stringify(data.duplicate_serials ?? [], null, 2)}
</DUPLICATE_SN>

<NG_EVENTS>
${JSON.stringify(data.ng_events ?? [], null, 2)}
</NG_EVENTS>

用户问题: ${question}

请用中文回答，直接回复，不要返回JSON格式。
如果数据不足以回答，请明确说明需要哪些补充信息。`;
}

// ── Log Ornith decision to audit log ────────────────────────────────────
async function logOrnithDecision(cycleId, decisionType, item, area = "mes") {
  try {
    const input = JSON.stringify({
      line_code: item.line_code || "",
      station_code: item.station_type || item.station_code || "",
      ...(item.sn ? { pcb_serial: item.sn } : {}),
      ...(item.work_order_code ? { work_order_code: item.work_order_code } : {}),
    });
    const output = JSON.stringify(item);
    const autoExecute = item.auto_execute !== false;

    await run([
      EXEC_SCRIPT, "audit-log",
      "--decision", decisionType,
      "--area", area,
      "--ornith", output,
      "--auto", autoExecute ? "true" : "false",
      "--cycle", cycleId,
    ]);
  } catch (err) {
    log("WARN", `[AUDIT] logOrnithDecision failed: ${err.message}`);
  }
}

// ── Save manual (non-auto) decisions to pending-approvals.json ────────
function savePendingApprovals(analysis) {
  const pending = {
    stagnation: (analysis.stagnation_actions ?? []).filter(d => d.auto_execute === false).map(d => ({ sn: d.sn, level: d.level, recommendation: d.recommendation })),
    scrap:      (analysis.scrap_decisions ?? []).filter(d => d.auto_execute === false).map(d => ({ sn: d.sn, action: d.action, reason: d.reason })),
    downtime:   (analysis.downtime_flags ?? []).filter(d => d.auto_execute === false).map(d => ({ id: d.downtime_no, recommendation: d.recommendation })),
    feeder:     (analysis.feeder_checks ?? []).filter(d => d.auto_execute === false).map(d => ({ bindingId: d.binding_id, action: d.action, reason: d.reason })),
    line:       (analysis.line_actions ?? []).filter(d => d.auto_execute === false).map(d => ({ line_code: d.line_code, action: d.action, level: d.level, message: d.message })),
  };

  const total = pending.stagnation.length + pending.scrap.length + pending.downtime.length +
                pending.feeder.length + pending.line.length;

  if (total > 0) {
    log("INFO", `Saving ${total} manual decisions to pending-approvals.json`);
    try {
      writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
    } catch (_) {}
  }
}

// ── Delta detection (mem0-backed, with JSON file fallback) ─────────────
async function loadState() {
  // Try mem0 first — recall the most recent patrol state
  try {
    const results = await mem.search("most recent patrol cycle state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const state = latest.metadata?.state;
      if (state) return state;
    }
  } catch (_) {}
  // Fallback to JSON file
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (_) {}
  return { lastCycle: null, cycleCount: 0, anomalies: [], alerts: [] };
}

async function saveState(state) {
  // Store in mem0 for semantic recall
  try {
    const summary = state.summary || `Patrol cycle #${state.cycleCount || 0}`;
    const alertSummary = state.anomalies?.length > 0
      ? ` — ${state.anomalies.length} anomalies: ${state.anomalies.slice(0, 3).map(a => a.title).join(", ")}`
      : " — no anomalies";
    await mem.store(
      `MES patrol cycle #${state.cycleCount || 0} complete. ${summary}${alertSummary}`,
      { type: "patrol_state", state, cycleId: state.cycleId, ts: state.lastCycle }
    );
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  // Also write JSON file as fallback
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (_) {}
}

function generateCycleId() {
  return `mc-${Date.now().toString(36)}`;
}

// ── Agent Bus: Outbound message helpers ────────────────────────────────────

async function informWmsMaterialNeeded(workOrderCode, materialCode, requiredQty, lineCode, urgency = "normal") {
  await bus.send("wms-ai", "material_needed", {
    work_order_code: workOrderCode,
    material_code: materialCode,
    required_qty: requiredQty,
    line_code: lineCode,
    urgency,
  }, { priority: urgency === "immediate" ? "critical" : urgency === "this_week" ? "normal" : "low" });
}

async function informWmsLineFinished(workOrderCode, lineCode, completedQty, unusedMaterials = []) {
  await bus.send("wms-ai", "line_finished", {
    work_order_code: workOrderCode,
    line_code: lineCode,
    completed_qty: completedQty,
    unused_materials: unusedMaterials,
  });
}

async function informWmsFeederMismatch(stationCode, expectedMaterial, actualMaterial, feederSlot, lineCode) {
  await bus.send("wms-ai", "feeder_mismatch", {
    station_code: stationCode,
    expected_material: expectedMaterial,
    actual_material: actualMaterial,
    feeder_slot: feederSlot,
    line_code: lineCode,
  }, { priority: "critical" });
}

async function informWmsScrapAtLine(lotNo, qty, reasonCode, workOrderCode) {
  await bus.send("wms-ai", "scrap_at_line", {
    lot_no: lotNo,
    quantity: qty,
    reason_code: reasonCode,
    work_order_code: workOrderCode,
  });
}

async function informWmsRequestIssue(workOrderCode, lineCode, items) {
  await bus.send("wms-ai", "request_issue", {
    work_order_code: workOrderCode,
    line_code: lineCode,
    items,
  });
}

async function informBomSubstitutionNeeded(workOrderCode, productCode, expected, actualOnFeeder, stationCode) {
  await bus.send("bom-ai", "material_substitution_needed", {
    work_order_code: workOrderCode,
    product_code: productCode,
    expected_material: expected,
    actual_on_feeder: actualOnFeeder,
    station_code: stationCode,
  }, { priority: "high" });
}

async function informBomComponentFailureRate(materialCode, defectRatePct, stationType, defectCode, periodDays = 7) {
  await bus.send("bom-ai", "component_failure_rate", {
    material_code: materialCode,
    defect_rate_pct: defectRatePct,
    station_type: stationType,
    defect_code: defectCode,
    period_days: periodDays,
  });
}

async function informBomBomUsageFeedback(productCode, materialCode, bomQtyPer, actualAvgConsumption, sampleSize) {
  await bus.send("bom-ai", "bom_usage_feedback", {
    product_code: productCode,
    material_code: materialCode,
    bom_qty_per: bomQtyPer,
    actual_avg_consumption: actualAvgConsumption,
    sample_size: sampleSize,
  });
}

async function informHrLineUnderstaffed(lineCode, requiredOps, actualOps, stationType, shift) {
  await bus.send("hr-ai", "line_understaffed", {
    line_code: lineCode,
    required_operators: requiredOps,
    actual_operators: actualOps,
    station_type: stationType,
    shift,
  }, { priority: "high" });
}

async function informHrOperatorPerformance(stationCode, operatorName, shift, yieldPct, defectCount, sampleSize, periodHours) {
  await bus.send("hr-ai", "operator_performance", {
    station_code: stationCode,
    operator_name: operatorName,
    shift,
    yield_pct: yieldPct,
    defect_count: defectCount,
    sample_size: sampleSize,
    period_hours: periodHours,
  });
}

async function informHrStationCertGap(lineCode, stationCode, stationType, operatorName, missingCert) {
  await bus.send("hr-ai", "station_cert_gap", {
    line_code: lineCode,
    station_code: stationCode,
    station_type: stationType,
    operator_name: operatorName,
    missing_certification: missingCert,
  }, { priority: "critical" });
}

async function informHrTrainingNeeded(lineCode, stationType, defectCode, defectTrend) {
  await bus.send("hr-ai", "training_needed", {
    line_code: lineCode,
    station_type: stationType,
    defect_code: defectCode,
    defect_trend: defectTrend,
  });
}

async function requestAgvKitDelivery(workOrderCode, lineCode, stationCode, materialCodes, priority = "normal") {
  // MES → AGV: request material kit delivery to a line station
  await bus.send("agv-ai", "kit_delivery_request", {
    request_id: `kit-${Date.now().toString(36)}`,
    work_order_code: workOrderCode,
    line_code: lineCode,
    destination_station: stationCode,
    material_codes: materialCodes,
    priority,
  }, { priority: priority === "urgent" ? "high" : "normal" });
}

async function informAgvTaskCancel(taskCode, reason) {
  // MES → AGV: cancel an assigned task
  await bus.send("agv-ai", "task_cancel", {
    task_code: taskCode,
    reason,
  });
}

async function informAgvStationBlock(zoneCode, stationCode, reason, durationMin) {
  // MES → AGV: block a station (maintenance, obstruction)
  await bus.send("agv-ai", "station_block", {
    zone_code: zoneCode,
    station_code: stationCode,
    reason,
    duration_min: durationMin,
  }, { priority: "high" });
}

async function informAgvIncident(agvCode, incidentType, detail, severity = "warning") {
  // MES → HR: report AGV incident for operator attention
  await bus.send("hr-ai", "agv_incident", {
    agv_code: agvCode,
    incident_type: incidentType,
    detail,
    severity,
    reported_at: new Date().toISOString(),
  }, { priority: severity === "critical" ? "critical" : "normal" });
}

async function requestRdaAnalysis(dataPoints, priority = "normal") {
  await bus.send("rda-ai", "analysis_request", {
    request_id: `mes-req-${Date.now().toString(36)}`,
    data_points: dataPoints,
    priority,
  });
}

async function requestRdaDefectPattern(materialCode, stationType, defectCode, periodDays = 30) {
  await bus.send("rda-ai", "defect_pattern_query", {
    material_code: materialCode,
    station_type: stationType,
    defect_code: defectCode,
    period_days: periodDays,
  });
}

// ── Agent Bus: Inbound message handlers ──────────────────────────────────────

async function handleMaterialIssued(payload) {
  // WMS: material was issued to a line — verify feeder binding is correct
  const { lot_no, material_code, qty, work_order_code, line_code, station_code } = payload;
  log("INFO", `[WMS→MES] material_issued: ${lot_no} (${material_code}) x${qty} → ${line_code}/${station_code} WO:${work_order_code}`);
  // Feed into Ornith context for next patrol cycle by updating the feeder check
  // Flag if no feeder binding found for this lot
  try {
    const raw = await run([QUERY_SCRIPT, "feeders"]);
    const data = JSON.parse(raw);
    const binding = (data.feeders ?? []).find(f =>
      f.reel_code === lot_no || f.lot_no === lot_no
    );
    if (!binding) {
      log("WARN", `Material ${lot_no} issued but no feeder binding found — flagging for verification`);
      await sendLINE(`⚠️ [MES] 物料已发料但未找到 feeder 绑定: ${lot_no} → ${line_code}/${station_code}`);
    }
  } catch (err) {
    log("WARN", `handleMaterialIssued check failed: ${err.message}`);
  }
}

async function handleIqcReleased(payload) {
  // WMS: lot passed IQC and is now released for use
  const { lot_no, material_code, qty, released_at } = payload;
  log("INFO", `[WMS→MES] iqc_released: ${lot_no} (${material_code}) x${qty} released at ${released_at}`);
}

async function handleIqcHold(payload) {
  // WMS: lot is on hold — if it was bound to a feeder, alert line supervisor
  const { lot_no, material_code, reason, qty } = payload;
  log("INFO", `[WMS→MES] iqc_hold: ${lot_no} (${material_code}) x${qty} — ${reason}`);
  try {
    const raw = await run([QUERY_SCRIPT, "feeders"]);
    const data = JSON.parse(raw);
    const binding = (data.feeders ?? []).find(f =>
      (f.reel_code === lot_no || f.lot_no === lot_no) && !f.unbound_at
    );
    if (binding) {
      await sendLINE(`🔴 [MES 紧急] 物料 ${lot_no} 被 IQC 判定 Hold，但仍在 Feeder ${binding.feeder_no} 上使用中！请立即检查！`);
    }
  } catch (_) {}
}

async function handleScrapCreated(payload) {
  // WMS: material was scrapped in warehouse
  const { lot_no, material_code, qty, reason_code } = payload;
  log("INFO", `[WMS→MES] scrap_created: ${lot_no} (${material_code}) x${qty} — ${reason_code}`);
}

async function handleLineReturn(payload) {
  // WMS: line returned unused material to warehouse
  const { lot_no, qty, work_order_code, reason } = payload;
  log("INFO", `[WMS→MES] line_return: ${lot_no} x${qty} ← WO:${work_order_code} (${reason})`);
}

async function handleLowStockWarning(payload) {
  // WMS: material running low
  const { material_code, days_remaining, threshold, critical } = payload;
  log("INFO", `[WMS→MES] low_stock_warning: ${material_code} — ${days_remaining} days remaining (threshold: ${threshold})`);
  // Include in next Ornith analysis by storing in pending state
}

async function handleMsdAlert(payload) {
  // WMS: MSD material approaching exposure limit
  const { lot_no, material_code, exposed_hours, limit_hours, line_code } = payload;
  log("WARN", `[WMS→MES] msd_alert: ${lot_no} (${material_code}) exposed ${exposed_hours}h / ${limit_hours}h on ${line_code}`);
  await sendLINE(`🔧 [MES MSD告警] ${lot_no} (${material_code}) 在 ${line_code} 已暴露 ${exposed_hours}h（限制${limit_hours}h）— 需要烘烤！`);
}

async function handleBomUpdated(payload) {
  // BOM: engineering change approved, BOM version updated
  const { product_code, old_version, new_version, changes, effective_date } = payload;
  log("INFO", `[BOM→MES] bom_updated: ${product_code} v${old_version}→v${new_version} effective ${effective_date}`);
  // Check if any active runs are using this product
  try {
    const raw = await run([QUERY_SCRIPT, "runs"]);
    const data = JSON.parse(raw);
    const affected = (data.data ?? data.runs ?? []).filter(r =>
      r.product_code === product_code && (r.status === "running" || r.status === "released")
    );
    if (affected.length > 0) {
      await sendLINE(`⚠️ [MES BOM变更] 产品 ${product_code} BOM 已更新 v${old_version}→v${new_version}，影响 ${affected.length} 个活跃工单。请确认是否需要停线检查！`);
    }
  } catch (_) {}
}

async function handleAlternativeAvailable(payload) {
  // BOM: alternative material suggested for a shortage
  const { original_material, alternative_material, substitution_reason, supplier } = payload;
  log("INFO", `[BOM→MES] alternative_available: ${original_material} → ${alternative_material} (${substitution_reason})`);
}

async function handleBomAccuracyAlert(payload) {
  // BOM: BOM audit found mismatch between BOM and actual material on line
  const { product_code, expected_material, actual_on_line, description } = payload;
  log("ERR", `[BOM→MES] bom_accuracy_alert: ${product_code} — expected ${expected_material} but found ${actual_on_line} — ${description}`);
  await sendLINE(`🔴 [MES BOM错误] ${product_code} 物料不符！BOM要求 ${expected_material}，实际使用 ${actual_on_line}。描述: ${description}。请立即停线检查！`);
}

async function handleOperatorAbsent(payload) {
  // HR: employee didn't clock in
  const { employee_id, name, shift_type, line_code, station_type } = payload;
  log("WARN", `[HR→MES] operator_absent: ${name} (${employee_id}) on ${line_code}/${station_type} (${shift_type}) shift`);
  // Include in staffing assessment for next patrol
}

async function handleShiftChange(payload) {
  // HR: shift schedule updated
  const { line_code, old_operator, new_operator, station_code, effective_from } = payload;
  log("INFO", `[HR→MES] shift_change: ${line_code}/${station_code} — ${old_operator} → ${new_operator} from ${effective_from}`);
}

async function handleCertificationExpiring(payload) {
  // HR: operator certification about to expire
  const { employee_id, name, certification, expires_at, station_type } = payload;
  log("WARN", `[HR→MES] certification_expiring: ${name} (${certification}) expires ${expires_at}`);
}

async function handleNewOperatorAssigned(payload) {
  // HR: new operator added to line
  const { employee_id, name, line_code, station_type, certifications, start_date } = payload;
  log("INFO", `[HR→MES] new_operator: ${name} (${employee_id}) assigned to ${line_code}/${station_type}`);
}

async function handleOtLimitWarning(payload) {
  // HR: operator approaching OT limit
  const { employee_id, name, ot_this_month, legal_limit, line_code } = payload;
  log("WARN", `[HR→MES] ot_limit_warning: ${name} on ${line_code} — ${ot_this_month}h / ${legal_limit}h this month`);
}

async function handleReportReady(payload) {
  // RDA: scheduled report is ready
  const { report_key, period, archive_id, summary } = payload;
  log("INFO", `[RDA→MES] report_ready: ${report_key} (${period}) archive_id=${archive_id} — ${summary}`);
}

async function handleAnomalyDetected(payload) {
  // RDA: statistical anomaly found in historical data
  const { source, metric, station_type, line_code, expected_range, actual, z_score, period } = payload;
  log("WARN", `[RDA→MES] anomaly_detected: ${metric} on ${line_code}/${station_type} — actual=${actual} (expected ${expected_range}) z=${z_score}`);
  await sendLINE(`📊 [MES 数据异常] ${line_code}/${station_type} ${metric}: 实测${actual}，预期${expected_range}，z-score=${z_score}（${period}）`);
}

async function handleTrendAlert(payload) {
  // RDA: long-term trend detected
  const { subject, line_code, station_type, slope, p_value, days } = payload;
  log("WARN", `[RDA→MES] trend_alert: ${subject} on ${line_code}/${station_type} — slope=${slope} p=${p_value} over ${days}d`);
}

async function handleDataRequest(payload) {
  // Another agent requesting MES data — respond with current data
  const { request_id, query, filters } = payload;
  log("INFO", `[AGENT→MES] data_request: ${query} from ${request_id}`);
  try {
    let data;
    switch (query) {
      case "lines":
        data = JSON.parse(await run([QUERY_SCRIPT, "lines"]));
        break;
      case "runs":
        data = JSON.parse(await run([QUERY_SCRIPT, "runs"]));
        break;
      case "oee":
        data = JSON.parse(await run([QUERY_SCRIPT, "oee"]));
        break;
      case "events":
        data = JSON.parse(await run([QUERY_SCRIPT, "events"]));
        break;
      default:
        data = { error: `Unknown query type: ${query}` };
    }
    await bus.send("rda-ai", "data_response", {
      request_id,
      query,
      data,
    }, { correlationId: request_id });
  } catch (err) {
    await bus.send("rda-ai", "data_response", {
      request_id,
      query,
      error: err.message,
    }, { correlationId: request_id });
  }
}

// ── Plant Manager directive handler ───────────────────────────────────────
async function handlePlantDirective(payload) {
  const { source, severity, area, title, detail, line_code, action } = payload;
  log("WARN", `[PLANT→MES] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🏭 [工厂指令-MES] ${title}\n产线: ${line_code ?? "N/A"}\n详情: ${detail}`);
  }
}

// ── Plant Manager status request handler ───────────────────────────────────
async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  log("INFO", `[PLANT→MES] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    const [linesRaw, runsRaw, oeeRaw] = await Promise.all([
      run([QUERY_SCRIPT, "lines"]),
      run([QUERY_SCRIPT, "runs"]),
      run([QUERY_SCRIPT, "oee"]),
    ]);
    const lines = JSON.parse(linesRaw);
    const runs  = JSON.parse(runsRaw);
    const oee   = JSON.parse(oeeRaw);
    const runningLines = (Array.isArray(lines) ? lines : []).filter(l => l.status === "running").length;
    const kpis = {
      line_count:       Array.isArray(lines) ? lines.length : 0,
      running_lines:    runningLines,
      active_runs:     Array.isArray(runs) ? runs.filter(r => r.status === "running").length : 0,
      oee:             oee.oee ?? null,
      output_today:    oee.output_today ?? 0,
      defect_rate:     oee.defect_rate ?? null,
      downtime_min:    oee.downtime_min ?? 0,
    };
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "mes-ai",
      kpis,
    }, { correlationId: request_id });
    log("INFO", `[PLANT→MES] plant_status_response sent for req=${request_id}`);
  } catch (err) {
    log("ERR", `[PLANT→MES] plant_status_request failed: ${err.message}`);
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "mes-ai",
      error: err.message,
    }, { correlationId: request_id });
  }
}

// ── AGV event handlers ───────────────────────────────────────────────────────

async function handleAgvLowBattery(payload) {
  // AGV fleet reported low battery
  const { agv_code, battery_pct, threshold, recommended_action } = payload;
  log("WARN", `[AGV→MES] agv_low_battery: ${agv_code} at ${battery_pct}% (threshold=${threshold})`);
  // Dispatch to charging or flag for manual dispatch
  try {
    const raw = await run([EXEC_SCRIPT, "agv-charge", "--agv", agv_code]);
    log("INFO", `[AGV] auto-charge result: ${raw.trim()}`);
    await sendLINE(`🔋 [AGV低电量] ${agv_code} 电量${battery_pct}% — 已自动安排回桩充电`);
  } catch (err) {
    log("ERR", `[AGV] auto-charge failed for ${agv_code}: ${err.message}`);
    await sendLINE(`⚠️ [AGV低电量] ${agv_code} 电量${battery_pct}%，自动充电失败: ${err.message}`);
  }
}

async function handleAgvStuck(payload) {
  // AGV stuck or blocked — escalate to human
  const { agv_code, zone_code, station_code, reason, duration_min } = payload;
  log("ERR", `[AGV→MES] agv_stuck: ${agv_code} at ${zone_code}/${station_code} — ${reason} (${duration_min}min)`);
  await sendLINE(`🚨 [AGV卡住] ${agv_code} 在 ${zone_code}/${station_code} 卡住: ${reason}，已持续${duration_min}分钟。需要人工干预！`);
  // Create incident record
  await run([EXEC_SCRIPT, "audit-log", "--area", "agv", "--decision", "agv_stuck"]);
}

async function handleAgvDocked(payload) {
  // AGV docked at station — update position and check if task can be completed
  const { agv_code, station_code, zone_code, task_id, docked_at } = payload;
  log("INFO", `[AGV→MES] agv_docked: ${agv_code} → ${station_code} (task ${task_id})`);
  // Trigger task completion if this was the destination
  if (task_id) {
    try {
      const raw = await run([EXEC_SCRIPT, "agv-task-complete", "--task-id", String(task_id)]);
      log("INFO", `[AGV] task ${task_id} auto-completed: ${raw.trim()}`);
    } catch (err) {
      log("WARN", `[AGV] task ${task_id} auto-complete failed: ${err.message}`);
    }
  }
  // Notify PMC if this was a kit delivery
  await bus.send("pmc-ai", "material_arrived", {
    source: "agv",
    agv_code,
    station_code,
    zone_code,
    arrived_at: docked_at,
  });
}

async function handleAgvTaskCompleted(payload) {
  // AGV task finished successfully
  const { task_id, task_code, agv_code, outcome, duration_s, distance_m } = payload;
  log("INFO", `[AGV→MES] agv_task_completed: ${task_code} by ${agv_code} — ${outcome}`);
  // Update WMS inventory position if this was a material delivery
  await bus.send("wms-ai", "agv_task_completed", {
    task_id,
    task_code,
    agv_code,
    outcome,
    duration_s,
    distance_m,
  });
  // Check AGV battery — if low, route to charging
  try {
    const fleetRaw = await run([QUERY_SCRIPT, "agv-fleet"]);
    const fleet = JSON.parse(fleetRaw);
    const agv = fleet.fleet?.find(a => a.code === agv_code);
    if (agv && agv.battery_pct <= agv.low_battery_threshold) {
      await run([EXEC_SCRIPT, "agv-return", "--agv", agv_code]);
      await sendLINE(`🔋 [AGV] ${agv_code} 电量低(${agv.battery_pct}%)，已安排回桩充电`);
    }
  } catch (_) {}
}

// ── Agent Bus: Main message poller ────────────────────────────────────────────

const MESSAGE_HANDLERS = {
  // WMS → MES
  "material_issued":       handleMaterialIssued,
  "iqc_released":         handleIqcReleased,
  "iqc_hold":             handleIqcHold,
  "scrap_created":        handleScrapCreated,
  "line_return":          handleLineReturn,
  "low_stock_warning":    handleLowStockWarning,
  "msd_alert":           handleMsdAlert,
  // BOM → MES
  "bom_updated":          handleBomUpdated,
  "alternative_available": handleAlternativeAvailable,
  "bom_accuracy_alert":   handleBomAccuracyAlert,
  // HR → MES
  "operator_absent":      handleOperatorAbsent,
  "shift_change":         handleShiftChange,
  "certification_expiring": handleCertificationExpiring,
  "new_operator_assigned": handleNewOperatorAssigned,
  "ot_limit_warning":     handleOtLimitWarning,
  // RDA → MES
  "report_ready":         handleReportReady,
  "anomaly_detected":     handleAnomalyDetected,
  "trend_alert":          handleTrendAlert,
  "data_request":         handleDataRequest,
  // Plant Manager
  "plant_directive":      handlePlantDirective,
  "plant_status_request": handlePlantStatusRequest,
  // AGV → MES
  "agv_low_battery":     handleAgvLowBattery,
  "agv_stuck":           handleAgvStuck,
  "agv_docked":          handleAgvDocked,
  "agv_task_completed":  handleAgvTaskCompleted,
};

// ── Manager Bus (after MESSAGE_HANDLERS) ─────────────────────────────────
bus = createManagerBus({
  agentId: "mes-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: MESSAGE_HANDLERS,
});

/**
 * Poll pending messages for mes-ai and dispatch each to its handler.
 * Called once per patrol cycle after the MES data query.
 */
async function processAgentMessages() {
  if (!bus) return;
  await bus.init();
  const messages = await bus.poll(20);
  if (!messages || messages.length === 0) return;

  log("INFO", `[AGENT-BUS] Received ${messages.length} message(s)`);

  for (const msg of messages) {
    const handler = MESSAGE_HANDLERS[msg.subject];
    if (!handler) {
      log("WARN", `[AGENT-BUS] No handler for subject="${msg.subject}" from ${msg.source_agent} — skipping`);
      await completeAgentMessage(msg.message_id);
      continue;
    }

    try {
      const payload = typeof msg.payload === "string"
        ? JSON.parse(msg.payload)
        : (msg.payload || {});
      await handler(payload);
      await completeAgentMessage(msg.message_id);
      log("INFO", `[AGENT-BUS] Handled ${msg.subject} from ${msg.source_agent} (id=${msg.message_id})`);
    } catch (err) {
      log("ERR", `[AGENT-BUS] Handler error for ${msg.subject}: ${err.message}`);
      await failAgentMessage(msg.message_id, err.message);
    }
  }
}

// ── Execute Ornith decisions ─────────────────────────────────────────
async function executeDecisions(analysis, cycleId) {
  const results = [];

  // Yield alerts
  for (const alert of analysis.yield_alerts ?? []) {
    if (alert.status === "critical" || alert.status === "warning") {
      await logOrnithDecision(cycleId, "yield_warning", alert, "quality");
      try {
        const out = await run([
          EXEC_SCRIPT, "yield-warning",
          "--line", alert.line_code,
          "--station", alert.station_type,
          "--yield", String(alert.yield),
          "--baseline", String(alert.baseline),
        ]);
        results.push({ type: "yield", line: alert.line_code, output: out.trim() });
      } catch (err) {
        log("ERR", `yield-warning ${alert.line_code} failed: ${err.message}`);
        results.push({ type: "yield", line: alert.line_code, error: err.message });
      }
    }
  }

  // Stagnation actions
  for (const action of analysis.stagnation_actions ?? []) {
    await logOrnithDecision(cycleId, "stagnation_action", action, "stagnation");

    if (action.auto_execute !== false && (action.level === "alert" || action.level === "critical")) {
      try {
        const notes = `[MES-AI] ${action.recommendation} (level: ${action.level})`;
        // Try API call via mes-execute
        // If sn is a numeric id, pass directly; otherwise flag for dashboard
        const id = parseInt(action.sn, 10);
        if (!isNaN(id)) {
          const out = await run([EXEC_SCRIPT, "resolve-stagnation", "--id", String(id), "--notes", notes]);
          results.push({ type: "stagnation", id, output: out.trim() });
        } else {
          log("INFO", `Stagnation ${action.sn}: ${action.recommendation} (non-numeric SN, logging only)`);
          results.push({ type: "stagnation", sn: action.sn, recommendation: action.recommendation });
        }
      } catch (err) {
        log("ERR", `resolve-stagnation failed: ${err.message}`);
        results.push({ type: "stagnation", error: err.message });
      }
    } else {
      log("INFO", `Stagnation ${action.sn}: ${action.recommendation} (auto=false or level=${action.level})`);
      results.push({ type: "stagnation", sn: action.sn, recommendation: action.recommendation, skipped: true });
    }
  }

  // Scrap decisions
  for (const decision of analysis.scrap_decisions ?? []) {
    await logOrnithDecision(cycleId, "scrap_decision", decision, "scrap");

    if (decision.auto_execute !== false && (decision.action === "approve" || decision.action === "reject")) {
      try {
        const id = parseInt(decision.sn, 10);
        if (!isNaN(id)) {
          const reject = decision.action === "reject";
          const args = [EXEC_SCRIPT, "approve-scrap", "--id", String(id)];
          if (reject) args.push("--reject");
          const out = await run(args);
          results.push({ type: "scrap", id, action: decision.action, output: out.trim() });
        } else {
          log("INFO", `Scrap ${decision.sn}: ${decision.action} (non-numeric SN, logging only)`);
          results.push({ type: "scrap", sn: decision.sn, action: decision.action });
        }
      } catch (err) {
        log("ERR", `approve-scrap failed: ${err.message}`);
        results.push({ type: "scrap", error: err.message });
      }
    } else {
      results.push({ type: "scrap", sn: decision.sn, action: decision.action, skipped: true });
    }
  }

  // Downtime flags
  for (const flag of analysis.downtime_flags ?? []) {
    await logOrnithDecision(cycleId, "downtime_flag", flag, "downtime");

    if (flag.auto_execute !== false && flag.recommendation === "escalate") {
      try {
        const out = await run([
          EXEC_SCRIPT, "flag-downtime",
          "--id", String(flag.downtime_no),
          "--severity", "critical",
        ]);
        results.push({ type: "downtime", id: flag.downtime_no, output: out.trim() });
      } catch (err) {
        log("ERR", `flag-downtime failed: ${err.message}`);
      }
    }
  }

  // Feeder checks
  for (const fc of analysis.feeder_checks ?? []) {
    await logOrnithDecision(cycleId, "feeder_check", fc, "feeder");
    if (fc.action === "block") {
      results.push({ type: "feeder", bindingId: fc.binding_id, action: "block", reason: fc.reason });
    } else {
      log("INFO", `Feeder ${fc.binding_id}: ${fc.action} (${fc.reason})`);
    }
  }

  // Line actions
  for (const la of analysis.line_actions ?? []) {
    await logOrnithDecision(cycleId, "line_action", la, "line");
    log("INFO", `[LINE-ACTION] ${la.line_code}: ${la.action}/${la.level} — ${la.message}`);
    results.push({ type: "line_action", lineCode: la.line_code, action: la.action, message: la.message });
  }

  return results;
}

// ── Send outbound inter-agent messages based on Ornith analysis ───────
/**
 * Inspect Ornith analysis and exec results, send messages to other agents.
 * @param {object} analysis   - Parsed Ornith output
 * @param {Array}  execResults - Results from executeDecisions()
 * @param {object} mesData     - Raw MES data from query
 */
async function sendOutboundMessages(analysis, execResults, mesData) {
  const resultsMap = {};
  for (const r of execResults) {
    if (r.line) resultsMap[`yield_${r.line}`] = r;
    if (r.id) resultsMap[`${r.type}_${r.id}`] = r;
    if (r.sn) resultsMap[`${r.type}_${r.sn}`] = r;
  }

  // ── WMS: Material needed (yield drop → material shortage suspected)
  for (const alert of analysis.yield_alerts ?? []) {
    if (alert.status === "critical" || alert.status === "warning") {
      // Check if there's an active WO on this line that might need expedited material
      const runs = mesData.runs ?? [];
      const activeRun = runs.find(r =>
        r.line_code === alert.line_code && r.status === "running"
      );
      if (activeRun) {
        await informWmsMaterialNeeded(
          activeRun.work_order_code || activeRun.wo_code,
          alert.material_code || "UNKNOWN",
          alert.shortage_qty || 0,
          alert.line_code,
          alert.status === "critical" ? "immediate" : "normal"
        );
      }
    }
  }

  // ── WMS: Line finished (run completed)
  const runs = mesData.runs ?? [];
  for (const run of runs) {
    if (run.status === "completed" || run.status === "closed") {
      const unusedMaterials = [];
      // Infer unused from feeder bindings that are still active
      const feeders = mesData.feeders ?? [];
      const lineFeeders = feeders.filter(f =>
        f.line_code === run.line_code && !f.unbound_at
      );
      for (const f of lineFeeders) {
        unusedMaterials.push({
          lot_no: f.lot_no || f.reel_code,
          material_code: f.material_code,
          qty: f.quantity || 0,
        });
      }
      await informWmsLineFinished(
        run.work_order_code || run.wo_code,
        run.line_code,
        run.completed_qty || 0,
        unusedMaterials
      );
    }
  }

  // ── WMS: Feeder mismatch (block action)
  for (const fc of analysis.feeder_checks ?? []) {
    if (fc.action === "block") {
      await informWmsFeederMismatch(
        fc.station_code || fc.stationCode || "",
        fc.expected_material || "",
        fc.actual_material || "",
        fc.feeder_slot || "",
        fc.line_code || ""
      );
    }
  }

  // ── BOM: Component failure rate (yield alert → component issue suspected)
  for (const alert of analysis.yield_alerts ?? []) {
    if ((alert.status === "critical" || alert.status === "warning") && alert.station_type) {
      const defectRate = alert.defect_rate ?? ((alert.baseline - alert.yield) / alert.baseline * 100).toFixed(1);
      await informBomComponentFailureRate(
        alert.material_code || "",
        parseFloat(defectRate),
        alert.station_type,
        alert.defect_code || "YIELD_DROP",
        7
      );
    }
  }

  // ── BOM: BOM usage feedback (if we have actual consumption data)
  for (const stagnation of analysis.stagnation_actions ?? []) {
    if (stagnation.level === "critical" && stagnation.work_order_code) {
      // Find the WO to get product
      const wo = runs.find(r => r.work_order_code === stagnation.work_order_code);
      if (wo?.product_code) {
        await informBomBomUsageFeedback(
          wo.product_code,
          stagnation.material_code || "",
          stagnation.bom_qty_per || 0,
          stagnation.actual_consumption || 0,
          stagnation.sample_size || 0
        );
      }
    }
  }

  // ── HR: Line understaffed (detected in alerts)
  for (const alert of analysis.alerts ?? []) {
    if (alert.area === "line" && alert.title?.toLowerCase().includes("understaffed")) {
      await informHrLineUnderstaffed(
        alert.line_code || "",
        alert.required_operators || 5,
        alert.actual_operators || 0,
        alert.station_type || "",
        alert.shift || "DAY"
      );
    }
  }

  // ── HR: Operator performance (yield data at operator level)
  // This is enriched when we have operator-level yield from station events
  if (analysis.operator_performance) {
    for (const op of analysis.operator_performance) {
      await informHrOperatorPerformance(
        op.station_code || "",
        op.operator_name || "",
        op.shift || "DAY",
        op.yield_pct || 0,
        op.defect_count || 0,
        op.sample_size || 0,
        op.period_hours || 8
      );
    }
  }

  // ── HR: Station cert gap (feeder check block → operator may lack cert)
  for (const fc of analysis.feeder_checks ?? []) {
    if (fc.action === "block" && fc.reason?.toLowerCase().includes("cert")) {
      await informHrStationCertGap(
        fc.line_code || "",
        fc.station_code || "",
        fc.station_type || "",
        fc.operator_name || "UNKNOWN",
        fc.missing_cert || "OPERATOR_CERT"
      );
    }
  }

  // ── HR: Training needed (same defect code appearing repeatedly)
  const defectCounts = {};
  for (const ev of (mesData.events ?? [])) {
    if (ev.result === "FAIL" && ev.event_type) {
      defectCounts[ev.event_type] = (defectCounts[ev.event_type] || 0) + 1;
    }
  }
  for (const [defectCode, count] of Object.entries(defectCounts)) {
    if (count >= 10) { // 10+ of same defect in last patrol window
      const ev = (mesData.events ?? []).find(e => e.event_type === defectCode);
      await informHrTrainingNeeded(
        ev?.line_code || "",
        ev?.station_type || "",
        defectCode,
        `increasing_${count}x_last_period`
      );
    }
  }

  // ── RDA: Request historical analysis for critical yield drops
  for (const alert of analysis.yield_alerts ?? []) {
    if (alert.status === "critical") {
      await requestRdaAnalysis(
        ["yield_by_line_30d", "downtime_by_reason_7d", "scrap_by_reason_30d"],
        "high"
      );
      break; // only once per cycle
    }
  }

  // ── RDA: Defect pattern query for material-related defects
  for (const alert of analysis.yield_alerts ?? []) {
    if (alert.material_code && alert.station_type) {
      await requestRdaDefectPattern(
        alert.material_code,
        alert.station_type,
        alert.defect_code || "YIELD_DROP",
        30
      );
    }
  }
}

// ── Send grouped alerts to LINE ─────────────────────────────────────
async function sendAlertsToLINE(analysis) {
  const criticalAlerts = (analysis.alerts ?? []).filter(a => a.severity === "critical");
  const warningAlerts  = (analysis.alerts ?? []).filter(a => a.severity === "warning");

  if (criticalAlerts.length > 0) {
    let msg = "🔴 MES紧急告警\n━━━━━━━━━━━━━━━━━━";
    for (const a of criticalAlerts) {
      msg += `\n[${a.area.toUpperCase()}] ${a.title}`;
      msg += `\n详情: ${a.detail}`;
      msg += `\n行动: ${a.action}`;
      if (a.line_code) msg += `\n产线: ${a.line_code}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }

  if (warningAlerts.length > 0) {
    let msg = "🟡 MES预警\n━━━━━━━━━━━━━━━━━━";
    for (const a of warningAlerts) {
      msg += `\n[${a.area.toUpperCase()}] ${a.title}`;
      msg += `\n行动: ${a.action}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }
}

// ── Patrol cycle ────────────────────────────────────────────────────
async function patrolCycle() {
  const cycleId = generateCycleId();
  log("INFO", `=== MES Manager patrol starting === [cycle ${cycleId}]`);

  // 1. Query all MES data
  log("INFO", "Querying MES data...");
  let mesData;
  try {
    const raw = await run([QUERY_SCRIPT, "all"]);
    mesData = JSON.parse(raw);
    log("INFO", `Queried ${mesData.lines?.length || 0} lines, ${mesData.events?.length || 0} events`);
  } catch (err) {
    log("ERR", `mes-query failed: ${err.message}`);
    return;
  }

  // 1b. Process messages from other agents (WMS/BOM/HR/RDA)
  log("INFO", "Processing inter-agent messages...");
  try {
    await processAgentMessages();
  } catch (err) {
    log("WARN", `Agent message processing failed: ${err.message}`);
  }

  // 2. Delta detection (mem0-backed state recall)
  const prevState = await loadState();
  const elapsed = prevState.lastCycle
    ? ((Date.now() - new Date(prevState.lastCycle).getTime()) / 3600000).toFixed(1)
    : "0";
  log("INFO", `Time since last cycle: ${elapsed}h`);

  // 3. Multi-model analysis
  log("INFO", "Feeding data to LLM...");
  let analysisText;
  try {
    const prompt = buildPrompt(mesData);
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    analysisText = multi.text;
    log("INFO", `Primary model ${multi.model} responded (${analysisText.length} chars)`);
    if (scoreResponse(analysisText) < 4) {
      const fb = await askLLM("validator", prompt, { temperature: 0.1 });
      if (scoreResponse(fb) > scoreResponse(analysisText)) { analysisText = fb; log("INFO", "Using validator output"); }
    }
  } catch (err) {
    log("ERR", `Multi-model analysis failed: ${err.message}`);
    await saveState({ ...prevState, lastCycle: new Date().toISOString(), error: `LLM: ${err.message}` });
    return;
  }

  // 4. Parse Ornith output
  const analysis = parseOrnithOutput(analysisText);
  if (!analysis) {
    log("WARN", "Could not parse Ornith output — saving raw for debugging");
    await saveState({ ...prevState, lastCycle: new Date().toISOString(), rawResponse: analysisText.slice(0, 2000) });

    // Print raw output (truncated) to console for manual inspection
    console.log("Raw Ornith output (first 1KB):", analysisText?.slice(0, 1024));
    return;
  }

  log("INFO", `Analysis: ${analysis.summary || "(no summary)"}`);
  logDecisions(analysis);

  // 5. Execute decisions
  const execResults = await executeDecisions(analysis, cycleId);
  log("INFO", `Executed ${execResults.length} actions`);

  // 5b. Send outbound messages to other agents based on analysis
  log("INFO", "Sending outbound inter-agent messages...");
  try {
    await sendOutboundMessages(analysis, execResults, mesData);
  } catch (err) {
    log("WARN", `Outbound messaging failed: ${err.message}`);
  }

  // 6. Save manual (non-auto) decisions
  savePendingApprovals(analysis);

  // 7. Self-evaluate recent decisions via judge LLM
  try {
    await run([EVAL_SCRIPT, "score-recent", "--limit", "5"]);
    log("INFO", "Self-evaluation complete");
  } catch (err) {
    log("WARN", `Evaluator call failed: ${err.message}`);
  }

  // 8. Send LINE alerts
    await sendAlertsToLINE(analysis);

  // 9. Save patrol state (mem0-backed + JSON fallback)
  await saveState({
    lastCycle:  new Date().toISOString(),
    cycleCount: (prevState.cycleCount || 0) + 1,
    cycleId,
    summary:    analysis.summary,
    alertCount: analysis.alerts?.length || 0,
    execCount:  execResults.length,
    execResults,
    anomalies:  analysis.alerts?.filter(a => a.severity === "critical" || a.severity === "warning") || [],
  });

  log("INFO", "=== MES patrol cycle complete ===");
}

// ── Log decisions summary ───────────────────────────────────────────
function logDecisions(analysis) {
  const sections = [
    ["Alerts",        analysis.alerts],
    ["Yield alerts",  analysis.yield_alerts],
    ["Stagnation",    analysis.stagnation_actions],
    ["Scrap",         analysis.scrap_decisions],
    ["Downtime",      analysis.downtime_flags],
    ["Feeder checks", analysis.feeder_checks],
    ["Line actions",  analysis.line_actions],
  ];
  for (const [label, items] of sections) {
    if (items?.length > 0) {
      log("INFO", `[DECISION] ${label}: ${items.length}`);
      for (const d of items) {
        const auto = d.auto_execute !== false ? "AUTO" : "MANUAL";
        log("INFO", `  [${auto}] ${JSON.stringify(d)}`);
      }
    }
  }
}

// ── Morning digest ──────────────────────────────────────────────────
async function morningDigest() {
  log("INFO", "Generating morning MES digest");

  try {
    const raw = await run([QUERY_SCRIPT, "all"]);
    const data = JSON.parse(raw);

    const lines = data.lines || [];
    const runs = data.runs || [];
    const events = data.events || [];
    const stagnation = data.stagnation || [];

    const lineStatus = lines.map(l => {
      const icon = l.status === "running" ? "✅" : l.status === "changeover" ? "🟡" : l.status === "down" ? "🔴" : "⚪";
      return `  ${icon} ${l.line_code} (${l.status})`;
    }).join("\n");

    const runningWOs = runs.filter(r => r.status === "running")
      .map(r => `  ${r.line_code}: ${r.wo_code} (${r.completed_qty}/${r.planned_qty})`)
      .join("\n");

    const yield24h = {};
    for (const ev of events) {
      if (!yield24h[ev.line_code]) yield24h[ev.line_code] = { pass: 0, fail: 0 };
      if (ev.result === "PASS") yield24h[ev.line_code].pass++;
      else if (ev.result === "FAIL") yield24h[ev.line_code].fail++;
    }
    const yieldStr = Object.entries(yield24h).map(([lc, v]) => {
      const total = v.pass + v.fail;
      const rate = total > 0 ? ((v.pass / total) * 100).toFixed(1) : "N/A";
      return `  ${lc}: ${rate}%`;
    }).join("\n");

    const stagnantCount = stagnation.filter(s => s.status === "open" || s.status === "escalated").length;

    // Mini performance summary
    let perfLine = "";
    try {
      const repOut = await run([EVAL_SCRIPT, "report", "--days", "7"]);
      const rep = JSON.parse(repOut);
      const o = rep.overall;
      const acc = o.accuracy || "N/A";
      if (o.evaluated > 0) {
        perfLine = `🤖 AI准确率: ${acc} (${o.evaluated}条评分)`;
      }
    } catch (_) {}

    const message = `🌅 MES晨报 ${new Date().toLocaleDateString("zh-CN")}
━━━━━━━━━━━━━━━━━━
🏭 产线状态 (${lines.length}条)
${lineStatus}

📊 近24h良率
${yieldStr || "  (无数据)"}

${runningWOs ? `📋 运行中工单\n${runningWOs}\n` : ""}
⚠️ 待处理: 呆滞PCB ${stagnantCount}批
${perfLine ? `\n${perfLine}` : ""}`;

    await sendLINE(message);
    console.log(JSON.stringify({ ok: true, message, lines: lines.length, stagnantCount }));
  } catch (err) {
    log("ERR", `Morning digest failed: ${err.message}`);
    console.error(JSON.stringify({ error: err.message }));
  }
}

// ── Evening OEE report ─────────────────────────────────────────────
async function eveningReport() {
  log("INFO", "Generating evening OEE report");

  try {
    const raw = await run([QUERY_SCRIPT, "all"]);
    const data = JSON.parse(raw);
    const oee = data.oee || [];

    const oeeLines = oee.map(o => {
      const oeePct = (o.oee * 100).toFixed(1);
      const rating = oeePct >= 85 ? "✅ World Class" :
                     oeePct >= 70 ? "🟡 Acceptable" :
                     oeePct >= 50 ? "🟠 Needs Improvement" : "🔴 Critical";
      return `  ${o.line_code}: OEE ${oeePct}% ${rating}`;
    }).join("\n");

    const totalEvents = data.events?.length || 0;
    const passEvents = data.events?.filter(e => e.result === "PASS").length || 0;
    const totalYield = totalEvents > 0 ? ((passEvents / totalEvents) * 100).toFixed(1) : "N/A";

    const message = `🌇 MES日报 ${new Date().toLocaleDateString("zh-CN")}
━━━━━━━━━━━━━━━━━━
📊 OEE
${oeeLines || "  (无数据)"}

📈 整体良率: ${totalYield}% (${passEvents}/${totalEvents})
━━━━━━━━━━━━━━━━━━`;

    await sendLINE(message);
    console.log(JSON.stringify({ ok: true, message, oee }));
  } catch (err) {
    log("ERR", `Evening report failed: ${err.message}`);
    console.error(JSON.stringify({ error: err.message }));
  }
}

// ── Watch loop (continuous) ─────────────────────────────────────────
async function watchLoop(intervalMin = 15) {
  log("INFO", `Starting MES watch loop (every ${intervalMin}min)`);
  const ms = intervalMin * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) { log("WARN", "Previous patrol still running — skipping"); return; }
    running = true;
    try { await patrolCycle(); } catch (err) { log("ERR", `Patrol error: ${err.message}`); }
    running = false;
  };

  await tick();
  const timer = setInterval(tick, ms);
  process.on("SIGINT",  () => { log("INFO", "Shutting down"); clearInterval(timer); process.exit(0); });
  process.on("SIGTERM", () => { log("INFO", "Shutting down"); clearInterval(timer); process.exit(0); });
}

// ── CLI dispatch ─────────────────────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "patrol":
      await patrolCycle();
      break;
    case "morning":
      await morningDigest();
      break;
    case "evening":
      await eveningReport();
      break;
    case "watch":
      await watchLoop(Number(args[0]) || 15);
      break;
    case "eval": {
      const limit = Number(args[0]) || 5;
      log("INFO", `Scoring up to ${limit} recent decisions...`);
      try {
        const out = await run([EVAL_SCRIPT, "score-recent", "--limit", String(limit)]);
        log("INFO", `Evaluate: ${out.trim()}`);
      } catch (err) {
        log("ERR", `Evaluation failed: ${err.message}`);
      }
      break;
    }
    case "report": {
      const days = Number(args[0]) || 7;
      log("INFO", `Generating performance report (last ${days} days)...`);
      try {
        const out = await run([EVAL_SCRIPT, "report", "--days", String(days)]);
        const report = JSON.parse(out);
        log("INFO", `Report: ${JSON.stringify(report.overall)}`);
        if (report.overall?.evaluated > 0) {
          const msg = `📊 MES AI准确率报告 (近${days}天)\n━━━━━━━━━━━━━━━━━━\n评价: ${report.overall.evaluated}条 | 准确率: ${report.overall.accuracy}\n总决策: ${report.overall.total}`;
          await sendLINE(msg);
        }
      } catch (err) {
        log("ERR", `Report failed: ${err.message}`);
      }
      break;
    }
    case "ask": {
      const question = args.join(" ");
      if (!question) {
        console.error("Usage: node mes-manager.js ask \"<question>\"");
        process.exit(1);
      }
      log("INFO", `Q: ${question}`);
      try {
        const raw = await run([QUERY_SCRIPT, "all"]);
        const data = JSON.parse(raw);
        const prompt = buildAskPrompt(question, data);
        const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
        console.log("\n" + multi.text.trim() + "\n");
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
      break;
    }
    default:
      console.log(`MES AI Manager
Usage: node mes-manager.js <command>

Commands:
  patrol             — Run one patrol analysis cycle
  morning            — Send morning digest to LINE
  evening            — Send evening OEE report
  watch [min]        — Continuous patrol loop (default 15min)
  eval [limit]       — Score recent decisions (default: 5)
  report [days]      — Performance report (default: 7 days)
  ask "<question>"    — Ask a question (enclosed in quotes)
`);
      process.exit(1);
  }
}

main();
