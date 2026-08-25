/**
 * procurement-manager.js — Procurement AI Manager Brain
 *
 * Orchestrates Ornith analysis for procurement + contract workflow.
 *
 * Usage:
 *   node procurement-manager.js patrol           # One-shot procurement patrol
 *   node procurement-manager.js watch            # Continuous loop (every 30min)
 *   node procurement-manager.js morning          # Morning digest + LINE
 *   node procurement-manager.js test             # Self-test
 *   node procurement-manager.js ask "<q>"        # Interactive Q&A
 *   node procurement-manager.js bus-watch        # Continuous message listener
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const QUERY_SCRIPT = join(PROJECT_ROOT, "services/worker/procurement-query.js");
const EXEC_SCRIPT  = join(PROJECT_ROOT, "services/worker/procurement-execute.js");
const ORNITH_MODEL  = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const LINE_TOKEN    = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE    = join(PROJECT_ROOT, "services/worker/procurement-last-state.json");
const LOG_FILE      = join(PROJECT_ROOT, "services/worker/procurement-manager.log");

process.env.AGENT_ID = "procurement-ai";

// ── Agent Bus ────────────────────────────────────────────────────────────
import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";

const mem = createMemoryClient({ agentId: "procurement-ai" });

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try { require("fs").appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Manager Bus (lazy) ──────────────────────────────────────────────────────
let _bus = null;
function getBus() {
  if (!_bus) {
    _bus = createManagerBus({
      agentId: "procurement-ai",
      log,
      logPrefix: "[BUS] ",
      handlers: MESSAGE_HANDLERS,
    });
  }
  return _bus;
}

// ── Run external script ──────────────────────────────────────────────────
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

// ── Ornith LLM ──────────────────────────────────────────────────────────
async function askOrnith(prompt) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ORNITH_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  return (await res.json()).response || "";
}

function parseOrnithJSON(raw) {
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/gi, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();
  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) try { return JSON.parse(tagMatch[1]); } catch (_) {}
  const jsonMatch = clean.match(/\{[\s\S]*?"alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  return null;
}

// ── LINE ────────────────────────────────────────────────────────────────
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

// ── State ────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const results = await mem.search("most recent procurement manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (_) {}
  return { lastCycle: null, lastRun: null };
}

async function saveState(state) {
  try {
    await mem.store(`Procurement cycle — lastRun=${state.lastRun?.slice(0, 10) || "?"}`, { type: "procurement_state", state, ts: state.lastRun || new Date().toISOString() });
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { require("fs").writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

// ── Query All ────────────────────────────────────────────────────────────
async function queryAll() {
  const raw = await run([QUERY_SCRIPT, "all"]);
  try { return JSON.parse(raw); } catch (_) {
    log("WARN", "Failed to parse procurement-query output");
    return {};
  }
}

// ── Build Ornith Prompt ────────────────────────────────────────────────
function buildPrompt(data) {
  return `工厂采购管理巡逻报告 — ${new Date().toLocaleString("zh-CN")}

<REQUISITIONS>
${JSON.stringify(data.requisitions ?? [], null, 2)}
</REQUISITIONS>

<RFQ_LIST>
${JSON.stringify(data.rfqList ?? [], null, 2)}
</RFQ_LIST>

<PO_LIST>
${JSON.stringify(data.poList ?? [], null, 2)}
</PO_LIST>

<DELIVERY_STATUS>
${JSON.stringify(data.deliveryStatus ?? [], null, 2)}
</DELIVERY_STATUS>

<CONTRACTS>
${JSON.stringify(data.contracts ?? [], null, 2)}
</CONTRACTS>

<PENDING_APPROVALS>
${JSON.stringify(data.pendingApprovals ?? [], null, 2)}
</PENDING_APPROVALS>

<SUPPLIER_SCORE>
${JSON.stringify(data.scorecards ?? [], null, 2)}
</SUPPLIER_SCORE>

<SUPPLIER_PERFORMANCE>
${JSON.stringify(data.supplierPerformance ?? [], null, 2)}
</SUPPLIER_PERFORMANCE>

你是一个SMT电子工厂的采购 AI 管理员。基于以上采购数据，做出智能决策。

严格按照以下JSON格式返回（只返回JSON，不要其他文字）：

<ANALYSIS>
{
  "alerts": [
    {
      "severity": "critical|warning|info",
      "area": "requisition|rfq|po|delivery|contract|approval|supplier",
      "title": "标题",
      "detail": "详细描述",
      "action": "具体行动",
      "urgency": "immediate|24h|this_week"
    }
  ],
  "rfq_actions": [
    { "rfq_no": "RFQ-...", "action": "CREATE|SEND|AWARD|CANCEL", "reason": "原因" }
  ],
  "po_actions": [
    { "po_no": "PO-...", "action": "SEND|CLOSE|TRACK", "reason": "原因" }
  ],
  "approval_actions": [
    { "task_id": 1, "contract_id": 1, "action": "APPROVE|REJECT", "reason": "原因" }
  ],
  "escalations": [
    { "area": "supplier|contract|delivery", "detail": "描述", "target": "目标Agent", "urgency": "immediate|24h" }
  ],
  "summary": "一句话总结本次巡逻发现"
}
</ANALYSIS>`;
}

// ── Outbound: inform WMS of material needed ──────────────────────────────
async function informWmsMaterialShortage(materialCode, requiredQty, woCode, urgency) {
  await getBus().send("wms-ai", "material_needed", {
    material_code: materialCode,
    required_qty: requiredQty,
    work_order_code: woCode,
    urgency,
  });
}

// ── Outbound: inform PMC of procurement update ──────────────────────────
async function informPmcProcurementUpdate(poNo, status, supplierCode) {
  await getBus().send("pmc-ai", "procurement_update", {
    po_no: poNo,
    status,
    supplier_code: supplierCode,
  });
}

// ── Inbound: MES material needed ──────────────────────────────────────
async function handleMaterialNeeded(payload) {
  const { material_code, required_qty, work_order_code, urgency } = payload;
  log("INFO", `[MES→PROC] material_needed: ${material_code} x${required_qty} for WO:${work_order_code} urgency=${urgency}`);
  // Ornith will see this in the next patrol cycle via procurement data
}

async function handlePlantDirective(payload) {
  const { severity, title, detail, action } = payload;
  log("WARN", `[PLANT→PROC] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical" || severity === "warning") {
    await sendLINE(`🏭 [工厂指令-采购] ${title}\n详情: ${detail}\n行动: ${action ?? "(见详情)"}`);
  }
}

// ── Message Dispatcher ─────────────────────────────────────────────────
const MESSAGE_HANDLERS = {
  "material_needed":        handleMaterialNeeded,
  "plant_directive":        handlePlantDirective,
};

// ── Patrol Cycle ──────────────────────────────────────────────────────
async function patrolCycle() {
  const cycleId = `pr-${Date.now().toString(36)}`;
  log("INFO", `=== Procurement Patrol [${cycleId}] START ===`);

  await getBus().init();

  try {
    log("INFO", "Querying procurement data...");
    const raw = await queryAll();
    log("INFO", `  Requisitions: ${raw.requisitions?.length ?? 0}`);
    log("INFO", `  RFQs: ${raw.rfqList?.length ?? 0}`);
    log("INFO", `  POs: ${raw.poList?.length ?? 0}`);
    log("INFO", `  Contracts: ${raw.contracts?.length ?? 0}`);
    log("INFO", `  Pending approvals: ${raw.pendingApprovals?.length ?? 0}`);
    log("INFO", `  Delivery alerts: ${(raw.deliveryStatus ?? []).filter(d => d.delivery_flag !== 'ON_TRACK').length}`);

    log("INFO", "Sending to Ornith for analysis...");
    let analysis = null;
    try {
      const prompt = buildPrompt(raw);
      const ornithRaw = await askOrnith(prompt);
      analysis = parseOrnithJSON(ornithRaw);
      log("INFO", `Ornith: ${analysis ? "OK" : "FAILED to parse"}`);
      if (analysis) {
        log("INFO", `  Alerts: ${analysis.alerts?.length ?? 0}`);
        log("INFO", `  Summary: ${analysis.summary ?? ""}`);
      }
    } catch (e) {
      log("ERROR", `Ornith failed: ${e.message}`);
    }

    // Execute alerts
    if (analysis?.alerts) {
      const critical = analysis.alerts.filter(a => a.severity === "critical");
      if (critical.length > 0) {
        const msg = `🚨 采购紧急告警 (${cycleId})\n${critical.map(a => `[${a.area}] ${a.title}: ${a.detail}`).join("\n")}`;
        await sendLINE(msg);
      }
    }

    // Escalations
    for (const e of (analysis?.escalations ?? [])) {
      if (e.area === "supplier" || e.area === "contract") {
        await getBus().send("pmc-ai", "procurement_escalation", {
          area: e.area, detail: e.detail, urgency: e.urgency,
        });
      }
    }

    await saveState({ lastCycle: cycleId, lastRun: new Date().toISOString() });
    log("INFO", `=== Procurement Patrol [${cycleId}] DONE ===`);
    return { cycleId, analysis };
  } catch (e) {
    log("ERROR", `Patrol error: ${e.message}`);
    return { cycleId, error: e.message };
  }
}

// ── Morning Digest ────────────────────────────────────────────────────
async function morningDigest() {
  await getBus().init();
  log("INFO", "=== Procurement Morning Digest ===");
  const result = await patrolCycle();
  if (result.analysis?.summary) {
    await sendLINE(`🌅 采购晨报 (${new Date().toLocaleDateString("zh-CN")})\n${result.analysis.summary}`);
  }
}

// ── Ask ───────────────────────────────────────────────────────────────
async function ask(question) {
  log("INFO", `Q: ${question}`);
  try {
    const raw = await queryAll();
    const prompt = buildAskPrompt(raw, question);
    const ornithRaw = await askOrnith(prompt);
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
  return `你是一个SMT电子工厂的采购 AI 管理员。

用户问题：${question}

以下是当前采购系统中的实时数据：

<REQUISITIONS>
${JSON.stringify(data.requisitions ?? [], null, 2)}
</REQUISITIONS>

<RFQ_LIST>
${JSON.stringify(data.rfqList ?? [], null, 2)}
</RFQ_LIST>

<PO_LIST>
${JSON.stringify(data.poList ?? [], null, 2)}
</PO_LIST>

<DELIVERY_STATUS>
${JSON.stringify(data.deliveryStatus ?? [], null, 2)}
</DELIVERY_STATUS>

<CONTRACTS>
${JSON.stringify(data.contracts ?? [], null, 2)}
</CONTRACTS>

<PENDING_APPROVALS>
${JSON.stringify(data.pendingApprovals ?? [], null, 2)}
</PENDING_APPROVALS>

<SUPPLIER_SCORE>
${JSON.stringify(data.scorecards ?? [], null, 2)}
</SUPPLIER_SCORE>

请直接回答用户问题，用中文，不要返回JSON格式。
如果数据不足，请明确说明需要补充哪些信息。`;
}

// ── Bus Watch Loop ────────────────────────────────────────────────────
async function busWatchLoop(intervalMs = 30 * 1000) {
  log("INFO", `Procurement bus-watch started (poll every ${intervalMs / 1000}s)`);
  await getBus().init();
  for (;;) {
    try {
      const messages = await getBus().poll(20);
      log("INFO", `[BUS] Processed ${messages.length} message(s)`);
    } catch (e) {
      log("WARN", `bus-watch: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ── Self-Test ────────────────────────────────────────────────────────
async function selfTest() {
  log("INFO", "=== Procurement Self-Test ===");
  const scopes = [
    { n: 1, title: "Requisitions",    query: "requisitions" },
    { n: 2, title: "RFQ List",        query: "rfq-list" },
    { n: 3, title: "PO List",         query: "po-list" },
    { n: 4, title: "Contracts",        query: "contract-list" },
    { n: 5, title: "Pending Approvals",query: "pending-approvals" },
    { n: 6, title: "Supplier Scorecard", query: "supplier-scorecard" },
    { n: 7, title: "Delivery Status",  query: "delivery-status" },
  ];
  let passed = 0;
  for (const s of scopes) {
    try {
      const raw = await run([QUERY_SCRIPT, s.query]);
      const d = JSON.parse(raw);
      const ok = d && !d.error;
      log("INFO", `${ok ? "PASS" : "FAIL"} [${s.n}] ${s.title}`);
      if (ok) passed++;
    } catch (e) {
      log("ERROR", `FAIL [${s.n}] ${s.title}: ${e.message}`);
    }
  }
  log("INFO", `\n=== Result: ${passed}/${scopes.length} ===`);
  return { passed, total: scopes.length };
}

// ── Main CLI ─────────────────────────────────────────────────────────
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
      console.log("Usage: node procurement-manager.js ask \"<question>\"");
      process.exit(1);
    }
    ask(question).then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  }
  default:
    console.log(`Procurement AI Manager
Usage: node procurement-manager.js <patrol|watch|morning|bus-watch|test|ask>

Commands:
  patrol     — Run one procurement patrol analysis cycle
  morning    — Morning digest + LINE notification
  watch      — Continuous patrol loop (every 30min)
  bus-watch  — Continuous inter-agent message listener
  test       — Self-test with 7 query scopes
  ask        — Interactive Q&A about procurement
`);
}

async function patrolLoop(intervalMs = 30 * 60 * 1000) {
  log("INFO", `Procurement patrol loop started, interval=${intervalMs}ms`);
  for (;;) {
    await patrolCycle();
    log("INFO", `Sleeping ${intervalMs / 1000}s...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
