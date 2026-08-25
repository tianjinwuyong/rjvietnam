/**
 * pmc-manager.js — PMC AI Manager Brain
 *
 * Usage:
 *   node pmc-manager.js patrol       # One-shot PMC analysis
 *   node pmc-manager.js watch        # Continuous loop (every 30min)
 *   node pmc-manager.js morning      # Morning digest + LINE
 *   node pmc-manager.js test         # Self-test with PMC queries
 *   node pmc-manager.js bus-watch   # Listen for inter-agent messages continuously
 *   node pmc-manager.js ask "<q>"   # Interactive Q&A about production status
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const QUERY_SCRIPT  = join(PROJECT_ROOT, "services/worker/pmc-query.js");
const EXEC_SCRIPT  = join(PROJECT_ROOT, "services/worker/pmc-execute.js");
const ORNITH_MODEL = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const LINE_TOKEN   = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE   = join(PROJECT_ROOT, "services/worker/pmc-last-state.json");
const LOG_FILE     = join(PROJECT_ROOT, "services/worker/pmc-manager.log");

process.env.AGENT_ID = "pmc-ai";

import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

const mem = createMemoryClient({ agentId: "pmc-ai" });

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try { require("fs").appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Manager Bus ────────────────────────────────────────────────────────────
let bus = null;
function getBus() {
  if (!bus) bus = createManagerBus({ agentId: "pmc-ai", log, logPrefix: "[BUS] ", handlers: MESSAGE_HANDLERS });
  return bus;
}

// ── CLI runner ─────────────────────────────────────────────────────────
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

function parseOrnithJSON(raw) {
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/i, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();
  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) try { return JSON.parse(tagMatch[1]); } catch (_) {}
  const jsonMatch = clean.match(/\{[\s\S]*?"alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  return null;
}

// ── LINE ───────────────────────────────────────────────────────────────
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

// ── State ─────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const results = await mem.search("most recent PMC manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (_) {}
  return { woSummary: null, kitSummary: null, deliverySummary: null, lastCycle: null };
}

async function saveState(state) {
  try {
    const label = `PMC cycle — ${state.lastCycle?.slice(0, 10) || "?"}`;
    await mem.store(`${label} — WO:${(state.woSummary?.length || 0)} KIT:${(state.kitSummary?.length || 0)} DELIVERY:${(state.deliverySummary?.length || 0)}`, { type: "pmc_state", state, ts: state.lastRun || new Date().toISOString() });
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { require("fs").writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

// ── Agent Bus: Outbound Senders ────────────────────────────────────────

async function informMesWoScheduleChanged(woCode, newStatus, reason) {
  await getBus().send("mes-ai", "wo_schedule_changed", {
    work_order_code: woCode,
    new_status: newStatus,
    reason,
  });
}

async function informMesLineCapacityUpdate(lineCode, utilizationPct, availableSlots) {
  await getBus().send("mes-ai", "line_capacity_update", {
    line_code: lineCode,
    utilization_pct: utilizationPct,
    available_slots: availableSlots,
  });
}

async function informWmsMaterialShortage(materialCode, requiredQty, woCode, urgency) {
  await getBus().send("wms-ai", "material_shortage", {
    material_code: materialCode,
    required_qty: requiredQty,
    work_order_code: woCode,
    urgency,
  });
}

async function informWmsKitAlert(woCode, kitReadyPct, shortageItems) {
  await getBus().send("wms-ai", "kit_alert", {
    work_order_code: woCode,
    kit_ready_pct: kitReadyPct,
    shortage_items: shortageItems,
  });
}

async function informHrOperatorShortage(lineCode, shift, shortageCount) {
  await getBus().send("hr-ai", "operator_shortage", {
    line_code: lineCode,
    shift,
    shortage_count: shortageCount,
  });
}

async function informRdaDeliveryPrediction(poNumber, customerName, dueDate, riskLevel, confidence) {
  await getBus().send("rda-ai", "delivery_prediction", {
    po_number: poNumber,
    customer_name: customerName,
    due_date: dueDate,
    risk_level: riskLevel,
    confidence,
  });
}

// ── Agent Bus: Inbound Handlers ──────────────────────────────────────

async function handleLineProductivityUpdate(payload) {
  // MES reports line productivity data
  const { line_code, wo_code, completed_qty, cycle_time_ms, uptime_pct, shift } = payload;
  log("INFO", `[MES→PMC] productivity: line=${line_code} WO=${wo_code} qty=${completed_qty} uptime=${uptime_pct}%`);
  try {
    const raw = await run([QUERY_SCRIPT, "wo-progress", "--wocode", wo_code]);
    const data = JSON.parse(raw);
    log("INFO", `[MES→PMC] WO:${wo_code} progress updated: ${data.completed_qty}/${data.planned_qty}`);
  } catch (_) {}
}

async function handleMaterialShortageResolved(payload) {
  // WMS: material shortage has been resolved
  const { material_code, wo_code, resolution } = payload;
  log("INFO", `[WMS→PMC] shortage_resolved: ${material_code} for WO:${wo_code} — ${resolution}`);
}

async function handleOperatorAssigned(payload) {
  // HR: operator assigned to line
  const { line_code, operator_name, shift, wo_code } = payload;
  log("INFO", `[HR→PMC] operator_assigned: ${operator_name} → line ${line_code} shift=${shift} WO=${wo_code}`);
}

async function handleDeliveryForecastUpdate(payload) {
  // RDA: revised delivery forecast
  const { po_number, risk_level, confidence } = payload;
  log("INFO", `[RDA→PMC] forecast_update: PO=${po_number} risk=${risk_level} confidence=${confidence}`);
}

async function handleDataRequest(payload) {
  const { request_id, query, filters } = payload;
  log("INFO", `[AGENT→PMC] data_request: ${query} from ${request_id}`);
  try {
    let data;
    switch (query) {
      case "wo-list":
        data = JSON.parse(await run([QUERY_SCRIPT, "wo-list"]));
        break;
      case "wo-detail":
        data = JSON.parse(await run([QUERY_SCRIPT, "wo-detail", "--wocode", filters?.wo_code ?? ""]));
        break;
      case "wo-progress":
        data = JSON.parse(await run([QUERY_SCRIPT, "wo-progress", "--wocode", filters?.wo_code ?? ""]));
        break;
      case "kit-readiness":
        data = JSON.parse(await run([QUERY_SCRIPT, "kit-readiness", "--wocode", filters?.wo_code ?? ""]));
        break;
      case "delivery-status":
        data = JSON.parse(await run([QUERY_SCRIPT, "delivery-status"]));
        break;
      case "capacity-analysis":
        data = JSON.parse(await run([QUERY_SCRIPT, "capacity-analysis"]));
        break;
      case "shortage-list":
        data = JSON.parse(await run([QUERY_SCRIPT, "shortage-list"]));
        break;
      case "pmc-kpi":
        data = JSON.parse(await run([QUERY_SCRIPT, "pmc-kpi"]));
        break;
      default:
        data = { error: `Unknown query: ${query}` };
    }
    await getBus().send(payload.source_agent || "mes-ai", "data_response", {
      request_id, query, data,
    }, { correlationId: request_id });
  } catch (err) {
    await getBus().send(payload.source_agent || "mes-ai", "data_response", {
      request_id, query, error: err.message,
    }, { correlationId: request_id });
  }
}

// ── Plant Manager directive handler ───────────────────────────────────────
async function handlePlantDirective(payload) {
  const { source, severity, area, title, detail, action } = payload;
  log("WARN", `[PLANT→PMC] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical" || severity === "warning") {
    await sendLINE(`🏭 [工厂指令-PMC] ${title}\n详情: ${detail}\n行动: ${action ?? "(见详情)"}`);
  }
}

// ── Plant Manager status request handler ──────────────────────────────────
async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  log("INFO", `[PLANT→PMC] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    const rawData = await queryAll();
    const state = await loadState();
    const kpis = {
      wo_summary:     rawData.woSummary ?? {},
      kit_summary:    rawData.kitSummary ?? {},
      delivery:       rawData.deliverySummary ?? {},
      capacity:       rawData.capacityAnalysis?.summary ?? {},
      shortage:       rawData.shortageList?.summary ?? {},
      last_cycle:     state.lastCycle,
      last_run:       state.lastRun,
    };
    await getBus().send("plant-ai", "plant_status_response", {
      request_id,
      source: "pmc-ai",
      kpis,
    }, { correlationId: request_id });
    log("INFO", `[PLANT→PMC] plant_status_response sent for req=${request_id}`);
  } catch (err) {
    log("ERR", `[PLANT→PMC] plant_status_request failed: ${err.message}`);
    await getBus().send("plant-ai", "plant_status_response", {
      request_id,
      source: "pmc-ai",
      error: err.message,
    }, { correlationId: request_id });
  }
}

// ── Message Dispatcher ─────────────────────────────────────────────────
const MESSAGE_HANDLERS = {
  "line_productivity_update":   handleLineProductivityUpdate,
  "material_shortage_resolved": handleMaterialShortageResolved,
  "operator_assigned":          handleOperatorAssigned,
  "delivery_forecast_update":   handleDeliveryForecastUpdate,
  "data_request":               handleDataRequest,
  // Plant Manager
  "plant_directive":            handlePlantDirective,
  "plant_status_request":       handlePlantStatusRequest,
};

async function processAgentMessages() {
  await getBus().init();
  await getBus().poll(20);
}

// ── Query All PMC data ─────────────────────────────────────────────────
async function queryAll() {
  const raw = await run([QUERY_SCRIPT, "all"]);
  try { return JSON.parse(raw); } catch (_) {
    log("WARN", "Failed to parse pmc-query.js output as JSON");
    return {};
  }
}

// ── Build Ornith prompt ───────────────────────────────────────────────
function buildPrompt(data) {
  return `PMC巡逻报告 — ${new Date().toLocaleString("zh-CN")}

<WO_SUMMARY>
${JSON.stringify(data.woSummary ?? {}, null, 2)}
</WO_SUMMARY>

<KIT_STATUS>
${JSON.stringify(data.kitSummary ?? {}, null, 2)}
</KIT_STATUS>

<DELIVERY_STATUS>
${JSON.stringify(data.deliverySummary ?? {}, null, 2)}
</DELIVERY_STATUS>

<CAPACITY>
${JSON.stringify(data.capacityAnalysis ?? {}, null, 2)}
</CAPACITY>

<SHORTAGE>
${JSON.stringify(data.shortageList ?? {}, null, 2)}
</SHORTAGE>

你是一个SMT电子工厂的PMC AI管理员（生产计划物料控制）。基于以上PMC巡逻数据，做出智能决策。

严格按照以下JSON格式返回（只返回JSON，不要其他文字）：

<ANALYSIS>
{
  "alerts": [
    {
      "severity": "critical|warning|info",
      "area": "wo|kit|delivery|capacity|shortage",
      "title": "标题",
      "detail": "详细描述",
      "action": "具体行动",
      "urgency": "immediate|24h|this_week"
    }
  ],
  "wo_actions": [
    { "wo_code": "代码", "action": "RELEASE|HOLD|SPEED_UP|RESCHEDULE", "reason": "原因" }
  ],
  "escalations": [
    { "area": "material|delivery|capacity|hr", "detail": "描述", "target": "目标Agent", "urgency": "immediate|24h" }
  ],
  "summary": "一句话总结本次巡逻发现"
}
</ANALYSIS>`;
}

// ── Send outbound messages based on Ornith analysis ───────────────────
async function sendOutboundMessages(analysis, rawData) {
  if (!analysis) return;

  // WO actions
  for (const action of analysis.wo_actions ?? []) {
    try {
      if (action.action === "RELEASE") {
        await run([EXEC_SCRIPT, "wo-release", "--wocode", action.wo_code]);
        await informMesWoScheduleChanged(action.wo_code, "released", action.reason);
      } else if (action.action === "HOLD") {
        await run([EXEC_SCRIPT, "wo-hold", "--wocode", action.wo_code, "--reason", action.reason]);
        await informMesWoScheduleChanged(action.wo_code, "on_hold", action.reason);
      }
    } catch (err) {
      log("WARN", `WO action failed for ${action.wo_code}: ${err.message}`);
    }
  }

  // Capacity alerts → MES
  const highLoad = (rawData.capacityAnalysis?.lines ?? []).filter(l => l.status === "HIGH_LOAD");
  for (const line of highLoad) {
    await informMesLineCapacityUpdate(line.line, line.estimated_utilization, 0);
  }

  // Shortage escalations → WMS
  for (const s of (analysis.escalations ?? []).filter(e => e.area === "material")) {
    const shortageItems = (rawData.shortageList?.shortages ?? []).slice(0, 5);
    for (const item of shortageItems) {
      await informWmsMaterialShortage(item.material, item.shortfall_qty, item.wo_code ?? "UNKNOWN", s.urgency);
    }
  }

  // Delivery risk → RDA
  const atRisk = (rawData.deliverySummary?.at_risk ?? []);
  for (const d of atRisk.slice(0, 5)) {
    await informRdaDeliveryPrediction(d.po_number, d.customer_name, d.due_date, d.risk_level, 0.8);
  }

  // Operator shortage → HR
  for (const e of (analysis.escalations ?? []).filter(e => e.area === "hr")) {
    log("INFO", `Escalating to HR: ${e.detail}`);
    await informHrOperatorShortage(e.line_code ?? "UNKNOWN", e.shift ?? "day", 1);
  }
}

// ── Patrol Cycle ──────────────────────────────────────────────────────
async function patrolCycle() {
  const cycleId = `pc-${Date.now().toString(36)}`;
  log("INFO", `=== PMC Patrol [${cycleId}] START ===`);

  await getBus().init();

  try {
    // Step 1: Query all PMC data
    log("INFO", "Querying PMC data...");
    const rawData = await queryAll();
    log("INFO", `  WO Summary: running=${rawData.woSummary?.running ?? 0} released=${rawData.woSummary?.released ?? 0}`);
    log("INFO", `  Kit ready: ${rawData.kitSummary?.ready ?? 0} partial=${rawData.kitSummary?.partial ?? 0} shortage=${rawData.kitSummary?.shortage ?? 0}`);
    log("INFO", `  Delivery: on_time=${rawData.deliverySummary?.on_time ?? 0} at_risk=${rawData.deliverySummary?.at_risk ?? 0}`);
    log("INFO", `  Capacity: high_load=${rawData.capacityAnalysis?.summary?.high_load ?? 0} available=${rawData.capacityAnalysis?.summary?.available ?? 0}`);
    log("INFO", `  Shortage: ${rawData.shortageList?.summary?.total_shortage_items ?? 0} items`);

    // Step 1b: Process inbound messages
    log("INFO", "Processing inter-agent messages...");
    try { await processAgentMessages(); } catch (e) { log("WARN", `Agent msg processing: ${e.message}`); }

    // Step 2: Multi-model analysis
    log("INFO", "Asking LLM for PMC analysis...");
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
        log("INFO", `  Alerts: ${analysis.alerts?.length ?? 0}`);
        log("INFO", `  WO Actions: ${analysis.wo_actions?.length ?? 0}`);
        log("INFO", `  Summary: ${analysis.summary ?? ""}`);
      }
    } catch (e) {
      log("ERROR", `Analysis failed: ${e.message}`);
    }

    // Step 3: Handle critical alerts
    if (analysis?.alerts) {
      const critical = analysis.alerts.filter(a => a.severity === "critical");
      if (critical.length > 0) {
        const msg = `PMC AI Critical Alert (${cycleId})\n${critical.map(a => `[${a.area}] ${a.title}: ${a.detail}`).join("\n")}`;
        await sendLINE(msg);
      }
    }

    // Step 3b: Send outbound messages
    log("INFO", "Sending outbound inter-agent messages...");
    try { await sendOutboundMessages(analysis, rawData); } catch (e) { log("WARN", `Outbound messaging: ${e.message}`); }

    // Step 4: Save state
    await saveState({
      woSummary: rawData.woSummary ?? {},
      kitSummary: rawData.kitSummary ?? {},
      deliverySummary: rawData.deliverySummary ?? {},
      capacitySummary: rawData.capacityAnalysis?.summary ?? {},
      shortageSummary: rawData.shortageList?.summary ?? {},
      lastCycle: cycleId,
      lastRun: new Date().toISOString(),
    });

    log("INFO", `=== PMC Patrol [${cycleId}] DONE ===`);
    return { cycleId, data: rawData, analysis };
  } catch (e) {
    log("ERROR", `Patrol error: ${e.message}`);
    return { cycleId, error: e.message };
  }
}

// ── Morning Digest ─────────────────────────────────────────────────────
async function morningDigest() {
  await getBus().init();
  log("INFO", "=== PMC Morning Digest ===");
  try { await processAgentMessages(); } catch (_) {}
  const result = await patrolCycle();
  if (result.analysis?.summary) {
    const lineMsg = `PMC Daily Digest (${new Date().toLocaleDateString("zh-CN")})\n${result.analysis.summary}`;
    await sendLINE(lineMsg);
  }
}

// ── Loops ─────────────────────────────────────────────────────────────
async function busWatchLoop(intervalMs = 30 * 1000) {
  log("INFO", `PMC bus-watch started (poll every ${intervalMs / 1000}s)`);
  await getBus().init();
  for (;;) {
    try { await processAgentMessages(); } catch (e) { log("WARN", `bus-watch: ${e.message}`); }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function patrolLoop(intervalMs = 30 * 60 * 1000) {
  log("INFO", `PMC patrol loop started, interval=${intervalMs}ms`);
  for (;;) {
    await patrolCycle();
    log("INFO", `Sleeping ${intervalMs / 1000}s...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ── Ask ───────────────────────────────────────────────────────────────
async function ask(question) {
  log("INFO", `Q: ${question}`);
  try {
    // Fetch fresh PMC data for context
    const rawData = await queryAll();

    const prompt = buildAskPrompt(rawData, question);
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    const ornithRaw = multi.text;

    // Strip thinking tags and extra whitespace before displaying
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
  return `你是一个SMT电子工厂的PMC AI管理员（生产计划物料控制）。

用户问题：${question}

以下是当前PMC系统中的实时数据，请基于这些数据回答用户问题：

<WO_SUMMARY>
${JSON.stringify(data.woSummary ?? {}, null, 2)}
</WO_SUMMARY>

<KIT_STATUS>
${JSON.stringify(data.kitSummary ?? {}, null, 2)}
</KIT_STATUS>

<DELIVERY_STATUS>
${JSON.stringify(data.deliverySummary ?? {}, null, 2)}
</DELIVERY_STATUS>

<CAPACITY>
${JSON.stringify(data.capacityAnalysis ?? {}, null, 2)}
</CAPACITY>

<SHORTAGE>
${JSON.stringify(data.shortageList ?? {}, null, 2)}
</SHORTAGE>

请直接回答用户问题，用中文，不要返回JSON格式。
如果数据不足，请明确说明需要补充哪些信息。`;
}

// ── Self-Test ─────────────────────────────────────────────────────────
async function selfTest() {
  log("INFO", "=== PMC Self-Test ===\n");

  const scopes = [
    { n: 1, title: "WO List",           query: "wo-list" },
    { n: 2, title: "Kit Readiness",    query: "kit-readiness" },
    { n: 3, title: "Delivery Status",   query: "delivery-status" },
    { n: 4, title: "Capacity Analysis", query: "capacity-analysis" },
    { n: 5, title: "Shortage List",     query: "shortage-list" },
    { n: 6, title: "PMC KPI",           query: "pmc-kpi" },
  ];

  let passed = 0;
  for (const s of scopes) {
    try {
      const raw = await run([QUERY_SCRIPT, s.query]);
      const data = JSON.parse(raw);
      const ok = data && !data.error;
      log("INFO", `${ok ? "PASS" : "FAIL"} [${s.n}] ${s.title}`);
      if (ok) passed++;
    } catch (e) {
      log("ERROR", `FAIL [${s.n}] ${s.title}: ${e.message}`);
    }
  }

  log("INFO", `\n=== Result: ${passed}/${scopes.length} passed ===`);
  return { passed, total: scopes.length };
}

// ── Main ───────────────────────────────────────────────────────────────
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
    const question = process.argv[3];
    if (!question) {
      console.log("Usage: node pmc-manager.js ask \"<question>\"");
      process.exit(1);
    }
    ask(question).then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  }
  default:
    console.log(`Usage: node pmc-manager.js <patrol|watch|morning|bus-watch|test|ask>`);
    process.exit(1);
}