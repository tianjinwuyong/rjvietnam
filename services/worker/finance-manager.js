/**
 * finance-manager.js — Finance AI Manager Brain
 *
 * Orchestrates Ornith analysis + Node.js execution.
 * Runs on schedule via Windows Task Scheduler or continuous loop.
 *
 * Usage:
 *   node finance-manager.js patrol              # One-shot analysis cycle
 *   node finance-manager.js morning             # Morning financial digest + LINE
 *   node finance-manager.js evening             # End-of-day summary
 *   node finance-manager.js monthend           # Month-end close procedure
 *   node finance-manager.js watch [intervalMin] # Continuous loop
 *   node finance-manager.js eval [limit]       # Score recent decisions
 *   node finance-manager.js report [days]       # Performance report
 *   node finance-manager.js ask "<question>"   # Interactive Q&A
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const EXEC_SCRIPT  = join(PROJECT_ROOT, "services/worker/finance-execute.js");
const QUERY_SCRIPT = join(PROJECT_ROOT, "services/worker/finance-query.js");
const EVAL_SCRIPT   = join(PROJECT_ROOT, "services/worker/finance-evaluator.js");
const SOP_MANAGER  = join(PROJECT_ROOT, "services/worker/finance-sop-manager.js");
const LINE_TOKEN    = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE   = join(PROJECT_ROOT, "services/worker/finance-last-state.json");
const PENDING_FILE = join(PROJECT_ROOT, "services/worker/finance-pending-approvals.json");
const LOG_FILE     = join(PROJECT_ROOT, "services/worker/finance-manager.log");

// ── Agent Bus ─────────────────────────────────────────────────────────────────
import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

const mem = createMemoryClient({ agentId: "finance-ai" });

// ── Logging ─────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Manager Bus ──────────────────────────────────────────────────────────────
let bus = null;

// ── Run external script ────────────────────────────────────────────────────
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

// ── Parse JSON from script output (strips non-JSON prefix lines) ──────────────
// Handles dotenv "◇ injected env..." and any other stdout noise before JSON.
function parseJsonOutput(raw) {
  if (!raw || !raw.trim()) return null;
  let str = raw.trim();
  // Keep stripping leading lines that don't start with { or [ (handles multi-line dotenv noise)
  const lines = str.split("\n");
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart > 0) {
    str = lines.slice(jsonStart).join("\n").trim();
  }
  try { return JSON.parse(str); } catch (_) {}
  // Try finding JSON object anywhere as last resort
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  return null;
}

// ── Robust Ornith output parser (6 fallback strategies) ──────────────────────
function extractJsonObject(str, start) {
  if (str[start] !== "{") {
    while (start >= 0 && str[start] !== "{") start--;
  }
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") { depth--; if (depth === 0) return str.slice(start, i + 1); }
    else if (str[i] === '"') { i++; while (i < str.length && str[i] !== '"') { if (str[i] === "\\") i++; i++; } }
  }
  return null;
}

function parseOrnithOutput(raw) {
  if (!raw) return null;
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/i, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();

  try { return JSON.parse(clean); } catch (_) {}

  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) { try { return JSON.parse(tagMatch[1]); } catch (_) {} }

  const jsonMatch = clean.match(/\{[\s\S]*"alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch (_) {} }

  const altMatch = clean.match(/"alerts"\s*:\s*\[/);
  if (altMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"alerts"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }

  const summaryMatch = clean.match(/"summary"\s*:\s*"[^"]*"/);
  if (summaryMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"summary"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }

  return null;
}

// ── LINE notification ───────────────────────────────────────────────────────
async function sendLINE(message) {
  if (!existsSync(LINE_TOKEN)) { log("WARN", "LINE token not found, skipping notification"); return; }
  const token = readFileSync(LINE_TOKEN, "utf8").trim();
  if (!token) return;

  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message }),
  });
  if (!res.ok) log("WARN", `LINE send failed: ${res.status}`);
  else log("INFO", "LINE notification sent");
}

// ── Build Ornith prompt from Finance data ──────────────────────────────────
function buildPrompt(fData) {
  const ts = new Date().toLocaleString("zh-CN");
  return `## Finance AI Manager — Analysis Request

Factory financial snapshot — ${ts}

<AR_AGING>
${JSON.stringify(fData.arAging ?? [], null, 2)}
</AR_AGING>

<AP_AGING>
${JSON.stringify(fData.apAging ?? [], null, 2)}
</AP_AGING>

<WO_COSTS>
${JSON.stringify(fData.woCosts ?? [], null, 2)}
</WO_COSTS>

<INVENTORY_VALUATION>
${JSON.stringify(fData.inventoryValuation ?? [], null, 2)}
</INVENTORY_VALUATION>

<MATERIAL_FINANCIAL_EVENTS>
${JSON.stringify(fData.materialEvents ?? [], null, 2)}
</MATERIAL_FINANCIAL_EVENTS>

<EXCHANGE_RATES>
${JSON.stringify(fData.fxRates ?? [], null, 2)}
</EXCHANGE_RATES>

Context: You are a Finance AI Manager for a Vietnam SMT electronics factory (RuiJing).
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD
Currency: USD unless noted
VAT Rate: 10% standard (0% export, 5%/8% reduced)
CIT Rate: 20%
WHT: 1%/2%/5% for foreign contractors

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [
    {{
      "severity": "critical|warning|info",
      "area": "ar|ap|wo_cost|inventory|tax|fx|compliance",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动",
      "amount": "金额（如适用）",
      "urgency": "immediate|24h|this_week"
    }}
  ],
  "ar_followup": [
    {{
      "invoice_no": "",
      "customer_name": "",
      "outstanding_amount": 0,
      "days_overdue": 0,
      "action": "reminder|warning|escalate|suspend"
    }}
  ],
  "ap_payment_plan": [
    {{
      "invoice_no": "",
      "supplier_name": "",
      "amount": 0,
      "due_date": "",
      "priority": "P1|P2|P3|P4",
      "recommendation": "pay_now|pay_early|pay_on_due|defer"
    }}
  ],
  "wo_cost_variance": [
    {{
      "work_order_code": "",
      "standard_cost": 0,
      "actual_cost": 0,
      "variance_pct": 0,
      "action": "ok|review|escalate"
    }}
  ],
  "fx_recommendations": [
    {{
      "currency_pair": "",
      "current_rate": 0,
      "recommendation": "",
      "rationale": ""
    }}
  ],
  "material_event_actions": [
    {{
      "event_id": "",
      "event_type": "",
      "amount": 0,
      "action": "acknowledge|escalate|approve",
      "auto_execute": true
    }}
  ],
  "summary": "一句话总结当前财务状态"
}}
</ANALYSIS>`;
}

// ── Interactive Q&A prompt ─────────────────────────────────────────────────
function buildAskPrompt(question, fData) {
  return `工厂财务AI管理员问答 — ${new Date().toLocaleString("zh-CN")}

你是一个越南SMT电子工厂的财务AI管理员。请根据以下财务数据，回答用户的问题。

<AR_AGING>
${JSON.stringify(fData.arAging ?? [], null, 2)}
</AR_AGING>

<AP_AGING>
${JSON.stringify(fData.apAging ?? [], null, 2)}
</AP_AGING>

<WO_COSTS>
${JSON.stringify(fData.woCosts ?? [], null, 2)}
</WO_COSTS>

<INVENTORY_VALUATION>
${JSON.stringify(fData.inventoryValuation ?? [], null, 2)}
</INVENTORY_VALUATION>

<MATERIAL_FINANCIAL_EVENTS>
${JSON.stringify(fData.materialEvents ?? [], null, 2)}
</MATERIAL_FINANCIAL_EVENTS>

用户问题: ${question}

请用中文回答，直接回复，不要返回JSON格式。`;
}

// ── Audit log Ornith decision ────────────────────────────────────────────────
async function logOrnithDecision(cycleId, decisionType, item, area = "finance") {
  try {
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

// ── Save manual decisions to pending-approvals.json ─────────────────────────
function savePendingApprovals(analysis) {
  const pending = {
    arFollowup: (analysis.ar_followup ?? []).filter(d => d.action === "escalate" || d.action === "suspend"),
    apPayment: (analysis.ap_payment_plan ?? []).filter(d => d.recommendation === "defer"),
    woCost: (analysis.wo_cost_variance ?? []).filter(d => d.action === "escalate"),
    materialEvents: (analysis.material_event_actions ?? []).filter(d => d.auto_execute === false),
  };

  const total = pending.arFollowup.length + pending.apPayment.length + pending.woCost.length + pending.materialEvents.length;

  if (total > 0) {
    log("INFO", `Saving ${total} manual decisions to pending-approvals.json`);
    try { writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2)); } catch (_) {}
  }
}

// ── State management (mem0-backed, with JSON file fallback) ───────────
async function loadState() {
  try {
    const results = await mem.search("most recent finance manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch (_) {}
  return { lastCycle: null, cycleCount: 0, alerts: [] };
}

async function saveState(state) {
  try {
    await mem.store(`Finance cycle #${state.cycleCount || 0} — ${state.lastCycle?.slice(0, 10) || "?"} — ${(state.alerts || []).length} alerts`, { type: "finance_state", state, ts: state.lastCycle || new Date().toISOString() });
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

function generateCycleId() {
  return `fin-${Date.now().toString(36)}`;
}

// ── Inter-agent messaging: Finance → WMS ──────────────────────────────────
async function informWmsScrapCostRecorded(lotNo, qty, unitCost, woCode, reasonCode) {
  await bus.send("wms-ai", "scrap_cost_recorded", {
    lot_no: lotNo, qty, unit_cost: unitCost, work_order_code: woCode, reason_code: reasonCode,
  });
}

async function informWmsCompensationReceived(supplierId, amount, invoiceNo) {
  await bus.send("wms-ai", "compensation_received", {
    supplier_id: supplierId, amount, invoice_no: invoiceNo,
  });
}

async function informWmsMaterialReturned(lotNo, qty, reason, woCode) {
  await bus.send("wms-ai", "material_returned", {
    lot_no: lotNo, qty, reason, work_order_code: woCode,
  });
}

// ── Finance → MES ──────────────────────────────────────────────────────────
async function informMesWoCostThreshold(woCode, actualCost, standardCost, variancePct) {
  await bus.send("mes-ai", "wo_cost_exceeds_threshold", {
    work_order_code: woCode, actual_cost: actualCost, standard_cost: standardCost,
    variance_pct: variancePct,
  }, { priority: variancePct > 20 ? "critical" : "warning" });
}

async function informMesCostPosted(woCode, totalCost, glEntryId) {
  await bus.send("mes-ai", "cost_posted_to_gl", {
    work_order_code: woCode, total_cost: totalCost, gl_entry_id: glEntryId,
  });
}

// ── Finance → PMC ──────────────────────────────────────────────────────────
async function informPmcWoCostAlert(woCode, variancePct, amount) {
  await bus.send("pmc-ai", "wo_cost_variance_alert", {
    work_order_code: woCode, variance_pct: variancePct, amount_usd: amount,
  });
}

async function requestPmcWoBudgetReview(woCode, scopeChange) {
  await bus.send("pmc-ai", "budget_exceeded", {
    work_order_code: woCode, scope_change: scopeChange,
  });
}

// ── Finance → HR ────────────────────────────────────────────────────────────
async function requestHrPayrollConfirm(grossAmount, netAmount, currency) {
  await bus.send("hr-ai", "payroll_amount", {
    gross_amount: grossAmount, net_amount: netAmount, currency,
  });
}

async function informHrOvertimeHoursForCost(employeeId, hours, laborCost) {
  await bus.send("hr-ai", "overtime_hours", {
    employee_id: employeeId, hours, labor_cost: laborCost,
  });
}

// ── Agent Bus: Inbound message handlers ─────────────────────────────────────

async function handleWoCompleted(payload) {
  const { work_order_code, line_code, completed_qty } = payload;
  log("INFO", `[MES→FIN] wo_completed: ${work_order_code} on ${line_code} — ${completed_qty} units`);
  // Trigger WO cost finalization
  try {
    const out = await run([EXEC_SCRIPT, "post-wo-cost", work_order_code]);
    log("INFO", `WO cost posted for ${work_order_code}: ${out.trim()}`);
    await sendLINE(`✅ [财务] 工单 ${work_order_code} 已完成，成本已结转`);
  } catch (err) {
    log("ERR", `post-wo-cost failed for ${work_order_code}: ${err.message}`);
    await sendLINE(`⚠️ [财务] 工单 ${work_order_code} 成本结转失败: ${err.message}`);
  }
}

async function handleActualHoursRecorded(payload) {
  const { work_order_code, employee_id, hours, labor_cost_usd } = payload;
  log("INFO", `[MES→FIN] actual_hours: ${employee_id} on WO:${work_order_code} — ${hours}h = $${labor_cost_usd}`);
  await informHrOvertimeHoursForCost(employee_id, hours, labor_cost_usd);
}

async function handleWoClosed(payload) {
  const { work_order_code, final_cost, variance_pct } = payload;
  log("INFO", `[PMC→FIN] wo_closed: ${work_order_code} — final cost $${final_cost} (${variance_pct}%)`);
  if (variance_pct > 10) {
    await sendLINE(`🔴 [财务] 工单 ${work_order_code} 成本超支 ${variance_pct}% — 需要审阅`);
    await informPmcWoCostAlert(work_order_code, variance_pct, final_cost);
  }
}

async function handleMaterialScrapped(payload) {
  const { lot_no, qty, unit_cost_usd, reason_code, work_order_code } = payload;
  log("INFO", `[WMS→FIN] material_scrapped: ${lot_no} x${qty} @ $${unit_cost_usd} (${reason_code}) — WO:${work_order_code}`);
  await informWmsScrapCostRecorded(lot_no, qty, unit_cost_usd, work_order_code, reason_code);
}

async function handleCompensationApproved(payload) {
  const { supplier_id, amount, invoice_no } = payload;
  log("INFO", `[WMS→FIN] compensation_approved: supplier ${supplier_id} — $${amount} (${invoice_no})`);
  await informWmsCompensationReceived(supplier_id, amount, invoice_no);
}

async function handleMaterialReturned(payload) {
  const { lot_no, qty, reason, work_order_code } = payload;
  log("INFO", `[WMS→FIN] material_returned: ${lot_no} x${qty} (${reason}) — WO:${work_order_code}`);
  await informWmsMaterialReturned(lot_no, qty, reason, work_order_code);
}

async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  log("INFO", `[PLANT→FIN] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    const raw = await run([QUERY_SCRIPT, "dashboard-summary"]);
    const data = JSON.parse(raw);
    await bus.send("plant-ai", "plant_status_response", {
      request_id, source: "finance-ai",
      kpis: {
        total_ar_outstanding: data.totalArOutstanding ?? 0,
        total_ap_outstanding: data.totalApOutstanding ?? 0,
        total_inventory_value: data.totalInventoryValue ?? 0,
        total_wip_cost: data.totalWipCost ?? 0,
        currency: data.currency ?? "USD",
      },
    }, { correlationId: request_id });
    log("INFO", `[PLANT→FIN] plant_status_response sent`);
  } catch (err) {
    log("ERR", `plant_status_request failed: ${err.message}`);
    await bus.send("plant-ai", "plant_status_response", { request_id, source: "finance-ai", error: err.message }, { correlationId: request_id });
  }
}

// ── Agent Bus: message handlers map ──────────────────────────────────────────
const MESSAGE_HANDLERS = {
  "wo_completed":          handleWoCompleted,
  "actual_hours_recorded":  handleActualHoursRecorded,
  "wo_closed":              handleWoClosed,
  "material_scrapped":      handleMaterialScrapped,
  "compensation_approved":  handleCompensationApproved,
  "material_returned":     handleMaterialReturned,
  "plant_status_request":   handlePlantStatusRequest,
};

// ── Manager Bus init (after handlers) ───────────────────────────────────────
bus = createManagerBus({ agentId: "finance-ai", log, logPrefix: "[BUS] ", handlers: MESSAGE_HANDLERS });

// ── Process agent messages ────────────────────────────────────────────────────
async function processAgentMessages() {
  if (!bus) return;
  await bus.init();
  const messages = await bus.poll(20);
  if (!messages || messages.length === 0) return;
  log("INFO", `[AGENT-BUS] Received ${messages.length} message(s)`);
  for (const msg of messages) {
    const handler = MESSAGE_HANDLERS[msg.subject];
    if (!handler) {
      log("WARN", `[AGENT-BUS] No handler for subject="${msg.subject}" — skipping`);
      await completeAgentMessage(msg.message_id);
      continue;
    }
    try {
      const payload = typeof msg.payload === "string" ? JSON.parse(msg.payload) : (msg.payload || {});
      await handler(payload);
      await completeAgentMessage(msg.message_id);
      log("INFO", `[AGENT-BUS] Handled ${msg.subject} (id=${msg.message_id})`);
    } catch (err) {
      log("ERR", `[AGENT-BUS] Handler error for ${msg.subject}: ${err.message}`);
      await failAgentMessage(msg.message_id, err.message);
    }
  }
}

// ── Execute Ornith decisions ─────────────────────────────────────────────────
async function executeDecisions(analysis, cycleId) {
  const results = [];

  // AR follow-up
  for (const item of analysis.ar_followup ?? []) {
    await logOrnithDecision(cycleId, "ar_followup", item, "ar");
    if (item.action === "escalate" || item.action === "suspend") {
      await sendLINE(`🔴 [AR催收] ${item.customer_name} 逾期${item.days_overdue}天 — 发票 ${item.invoice_no} 金额 $${item.outstanding_amount} — 请立即处理`);
      results.push({ type: "ar_followup", invoice: item.invoice_no, action: item.action });
    }
  }

  // AP payment plan
  for (const item of analysis.ap_payment_plan ?? []) {
    await logOrnithDecision(cycleId, "ap_payment_plan", item, "ap");
    if (item.recommendation === "pay_now") {
      results.push({ type: "ap_payment_plan", invoice: item.invoice_no, action: "pay_now" });
    } else if (item.recommendation === "defer") {
      results.push({ type: "ap_payment_plan", invoice: item.invoice_no, action: "defer" });
    }
  }

  // WO cost variance
  for (const item of analysis.wo_cost_variance ?? []) {
    await logOrnithDecision(cycleId, "wo_cost_variance", item, "wo_cost");
    if (item.action === "escalate") {
      await sendLINE(`🔴 [工单成本] ${item.work_order_code} 成本差异 ${item.variance_pct}% — $${item.actual_cost - item.standard_cost} 超支`);
      await informMesWoCostThreshold(item.work_order_code, item.actual_cost, item.standard_cost, item.variance_pct);
      results.push({ type: "wo_cost", wo: item.work_order_code, action: "escalate" });
    }
  }

  // Material financial events
  for (const item of analysis.material_event_actions ?? []) {
    await logOrnithDecision(cycleId, "material_event_action", item, "inventory");
    if (item.auto_execute !== false && item.action === "acknowledge") {
      try {
        // Strip "MFE-" or similar prefix if Ornith hallucinates IDs like "MFE-01"
        const rawId = String(item.event_id);
        const numericId = rawId.replace(/^[A-Za-z]+-?0*/, "") || rawId;
        const out = await run([EXEC_SCRIPT, "ack-material-event", numericId]);
        results.push({ type: "material_event", eventId: item.event_id, output: out.trim() });
      } catch (err) {
        log("ERR", `ack-material-event failed for ${item.event_id}: ${err.message}`);
      }
    } else if (item.action === "escalate") {
      await sendLINE(`🟠 [物料财务事件] 事件 ${item.event_id} (${item.event_type}) 金额 $${item.amount} — 需要人工审批`);
      results.push({ type: "material_event", eventId: item.event_id, action: "escalate" });
    }
  }

  // FX recommendations
  for (const rec of analysis.fx_recommendations ?? []) {
    if (rec.recommendation) {
      log("INFO", `[FX] ${rec.currency_pair} @ ${rec.current_rate}: ${rec.recommendation}`);
      results.push({ type: "fx", currency: rec.currency_pair, recommendation: rec.recommendation });
    }
  }

  return results;
}

// ── Send grouped alerts to LINE ─────────────────────────────────────────────
async function sendAlertsToLINE(analysis) {
  const critical = (analysis.alerts ?? []).filter(a => a.severity === "critical");
  const warning  = (analysis.alerts ?? []).filter(a => a.severity === "warning");

  if (critical.length > 0) {
    let msg = "🔴 财务紧急告警\n━━━━━━━━━━━━━━━━━━";
    for (const a of critical) {
      msg += `\n[${a.area.toUpperCase()}] ${a.title}`;
      msg += `\n详情: ${a.detail}`;
      if (a.amount) msg += `\n金额: $${a.amount}`;
      msg += `\n行动: ${a.action}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }

  if (warning.length > 0) {
    let msg = "🟡 财务预警\n━━━━━━━━━━━━━━━━━━";
    for (const a of warning) {
      msg += `\n[${a.area.toUpperCase()}] ${a.title}`;
      if (a.amount) msg += ` $${a.amount}`;
      msg += `\n行动: ${a.action}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }
}

// ── Patrol cycle ───────────────────────────────────────────────────────────
// Accepts optional tier: "local" (default) | "premium" | "cloud"
async function patrolCycle(tier = "local") {
  const cycleId = generateCycleId();
  log("INFO", `=== Finance Manager patrol starting === [cycle ${cycleId}] [tier=${tier}]`);

  // 1. Query all finance data
  log("INFO", "Querying finance data...");
  let fData;
  try {
    const raw = await run([QUERY_SCRIPT, "--json", "all"]);
    fData = parseJsonOutput(raw);
    log("INFO", `AR: ${fData.arAging?.length ?? 0} rows, AP: ${fData.apAging?.length ?? 0} rows, WO: ${fData.woCosts?.length ?? 0} rows`);
  } catch (err) {
    log("ERR", `finance-query failed: ${err.message}`);
    return;
  }

  // 2. Process inter-agent messages
  log("INFO", "Processing inter-agent messages...");
  try { await processAgentMessages(); } catch (err) { log("WARN", `Agent message processing failed: ${err.message}`); }

  // 3. Delta detection
  const prevState = await loadState();
  const elapsed = prevState.lastCycle ? ((Date.now() - new Date(prevState.lastCycle).getTime()) / 3600000).toFixed(1) : "0";
  log("INFO", `Time since last cycle: ${elapsed}h`);

  // 4. Multi-model analysis
  const prompt = buildPrompt(fData);

  // 4a. Primary analysis (Ornith for local, minimax-m3 for premium, GPT-4o for cloud)
  log("INFO", `Feeding data to LLM (tier=${tier})...`);
  let analysisResult;
  try {
    analysisResult = await askLLMWithFallback("analysis", prompt, { tier });
    log("INFO", `Primary model ${analysisResult.model} responded (${analysisResult.text.length} chars)`);
  } catch (err) {
    log("ERR", `All models failed: ${err.message}`);
    await saveState({ ...prevState, lastCycle: new Date().toISOString(), error: `LLM: ${err.message}` });
    return;
  }
  const primaryText = analysisResult.text;

  // 4b. Quality check — if primary is low quality, try fallback model
  let finalText = primaryText;
  const quality = scoreResponse(primaryText);
  if (quality < 4 && tier !== "cloud") {
    log("WARN", `Primary output quality ${quality}/10 — low, retrying with validator (phi4:14b)`);
    try {
      const fallback = await askLLM("validator", prompt, { temperature: 0.1 });
      log("INFO", `Validator (phi4:14b) responded (${fallback.length} chars)`);
      if (scoreResponse(fallback) > quality) {
        finalText = fallback;
        log("INFO", "Using validator output (higher quality)");
      } else {
        log("INFO", "Keeping primary output (validator not better)");
      }
    } catch (err) {
      log("WARN", `Validator call failed: ${err.message}`);
    }
  }

  // 5. Parse LLM output
  let analysis = parseOrnithOutput(finalText);
  if (!analysis) {
    log("WARN", "Could not parse LLM output — saving raw for debugging");
    await saveState({ ...prevState, lastCycle: new Date().toISOString(), rawResponse: finalText.slice(0, 2000) });
    console.log("Raw LLM output (first 1KB):", finalText?.slice(0, 1024));
    return;
  }

  log("INFO", `Analysis: ${analysis.summary || "(no summary)"}`);
  if (analysisResult.model) log("INFO", `Primary model: ${analysisResult.model}`);
  logDecisions(analysis);

  // 6. Execute decisions
  const execResults = await executeDecisions(analysis, cycleId);
  log("INFO", `Executed ${execResults.length} actions`);

  // 7. Save manual decisions
  savePendingApprovals(analysis);

  // 8. Self-evaluate recent decisions
  try {
    await run([EVAL_SCRIPT, "score-recent", "--limit", "5"]);
    log("INFO", "Self-evaluation complete");
  } catch (err) { log("WARN", `Evaluator call failed: ${err.message}`); }

  // 9. Send LINE alerts
  await sendAlertsToLINE(analysis);

  // 10. Save state
  await saveState({
    lastCycle:  new Date().toISOString(),
    cycleCount: (prevState.cycleCount || 0) + 1,
    cycleId,
    tier,
    modelUsed: analysisResult.model,
    summary:    analysis.summary,
    alertCount: analysis.alerts?.length || 0,
    execCount:  execResults.length,
    execResults,
    anomalies:  analysis.alerts?.filter(a => a.severity === "critical" || a.severity === "warning") || [],
  });

  log("INFO", `=== Finance patrol cycle complete [tier=${tier}] ===`);
}

// ── Log decisions summary ────────────────────────────────────────────────────
function logDecisions(analysis) {
  const sections = [
    ["Alerts",              analysis.alerts],
    ["AR Follow-up",        analysis.ar_followup],
    ["AP Payment Plan",     analysis.ap_payment_plan],
    ["WO Cost Variance",    analysis.wo_cost_variance],
    ["Material Events",      analysis.material_event_actions],
    ["FX Recommendations", analysis.fx_recommendations],
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

// ── Morning financial digest ──────────────────────────────────────────────────
async function morningDigest() {
  log("INFO", "Generating morning financial digest");

  try {
    const raw = await run([QUERY_SCRIPT, "all"]);
    const data = parseJsonOutput(raw);

    const arTotal = (data.arAging ?? []).reduce((s, r) => s + parseFloat(r.total_outstanding || 0), 0);
    const arOverdue = (data.arAging ?? []).reduce((s, r) => s + parseFloat(r.overdue_90 || 0), 0);
    const apTotal = (data.apAging ?? []).reduce((s, r) => s + parseFloat(r.total_outstanding || 0), 0);
    const invValue = (data.inventoryValuation ?? []).reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
    const wipCost = (data.woCosts ?? []).filter(w => w.cost_status === "accumulating")
      .reduce((s, w) => s + parseFloat(w.total_actual_cost || 0), 0);
    const openEvents = (data.materialEvents ?? []).filter(e => e.status === "open").length;
    const overdueArDays = (data.arAging ?? []).filter(r => parseFloat(r.overdue_90 || 0) > 0);

    let perfLine = "";
    try {
      const repOut = await run([EVAL_SCRIPT, "report", "--days", "7"]);
      const rep = JSON.parse(repOut);
      if (rep.overall?.evaluated > 0) {
        perfLine = `🤖 AI准确率: ${rep.overall.accuracy} (${rep.overall.evaluated}条评分)`;
      }
    } catch (_) {}

    const message = `🌅 财务晨报 ${new Date().toLocaleDateString("zh-CN")}
━━━━━━━━━━━━━━━━━━
💰 应收账款: $${arTotal.toLocaleString()} (逾期90天+: $${arOverdue.toLocaleString()})
💸 应付账款: $${apTotal.toLocaleString()}
📦 库存价值: $${invValue.toLocaleString()}
⚙️  在制成本: $${wipCost.toLocaleString()}
━━━━━━━━━━━━━━━━━━
⚠️ 今日关注
  - AR逾期90天+客户: ${overdueArDays.length}家${arOverdue > 0 ? ` — 金额 $${arOverdue.toLocaleString()}` : ""}
  - 待处理物料财务事件: ${openEvents}件
${perfLine ? `\n${perfLine}` : ""}
━━━━━━━━━━━━━━━━━━`;

    await sendLINE(message);
    console.log(JSON.stringify({ ok: true, message, arTotal, apTotal, invValue }));
  } catch (err) {
    log("ERR", `Morning digest failed: ${err.message}`);
    console.error(JSON.stringify({ error: err.message }));
  }
}

// ── Evening summary ──────────────────────────────────────────────────────────
async function eveningSummary() {
  log("INFO", "Generating evening financial summary");

  try {
    const raw = await run([QUERY_SCRIPT, "all"]);
    const data = parseJsonOutput(raw);

    const arTotal = (data.arAging ?? []).reduce((s, r) => s + parseFloat(r.total_outstanding || 0), 0);
    const apTotal = (data.apAging ?? []).reduce((s, r) => s + parseFloat(r.total_outstanding || 0), 0);
    const woCostOpen = data.woCosts ?? [];
    const overBudget = woCostOpen.filter(w => {
      const std = parseFloat(w.total_standard_cost) || 0;
      const act = parseFloat(w.total_actual_cost) || 0;
      return std > 0 && (act - std) / std > 0.1;
    });

    const message = `🌇 财务日报 ${new Date().toLocaleDateString("zh-CN")}
━━━━━━━━━━━━━━━━━━
💰 应收账款: $${arTotal.toLocaleString()}
💸 应付账款: $${apTotal.toLocaleString()}
⚙️  超预算工单: ${overBudget.length}件
━━━━━━━━━━━━━━━━━━`;

    await sendLINE(message);
    console.log(JSON.stringify({ ok: true, message }));
  } catch (err) {
    log("ERR", `Evening summary failed: ${err.message}`);
    console.error(JSON.stringify({ error: err.message }));
  }
}

// ── Month-end close ─────────────────────────────────────────────────────────
async function monthEndClose() {
  log("INFO", "Starting month-end close procedure");

  const today = new Date();
  const fiscalYear = today.getFullYear();
  const period = today.getMonth() + 1;

  try {
    // 1. Run FX revaluation
    log("INFO", "Running FX revaluation...");
    try {
      const fxOut = await run([EXEC_SCRIPT, "fx-reval", today.toISOString().split("T")[0]]);
      log("INFO", `FX reval: ${fxOut.trim()}`);
      await sendLINE(`✅ [月结] FX重估完成: ${fxOut.trim()}`);
    } catch (err) { log("ERR", `fx-reval failed: ${err.message}`); }

    // 2. Post all open WO costs
    log("INFO", "Posting open WO costs...");
    const raw = await run([QUERY_SCRIPT, "wo-cost"]);
    const woCosts = parseJsonOutput(raw);
    for (const wo of (woCosts.woCosts ?? []).filter(w => w.cost_status === "accumulating")) {
      try {
        const out = await run([EXEC_SCRIPT, "post-wo-cost", String(wo.work_order_id || wo.wo_code)]);
        log("INFO", `WO cost posted: ${out.trim()}`);
      } catch (err) { log("ERR", `post-wo-cost failed for ${wo.wo_code}: ${err.message}`); }
    }

    // 3. Close fiscal period
    log("INFO", "Closing fiscal period...");
    try {
      const closeOut = await run([EXEC_SCRIPT, "close-period", String(fiscalYear), String(period)]);
      log("INFO", `Period closed: ${closeOut.trim()}`);
      await sendLINE(`✅ [月结] 会计期间 ${fiscalYear}-${period} 已关闭`);
    } catch (err) { log("ERR", `close-period failed: ${err.message}`); }

    console.log(JSON.stringify({ ok: true, fiscalYear, period }));
  } catch (err) {
    log("ERR", `Month-end close failed: ${err.message}`);
    console.error(JSON.stringify({ error: err.message }));
    await sendLINE(`🔴 [月结] 月结失败: ${err.message}`);
  }
}

// ── Watch loop ─────────────────────────────────────────────────────────────
async function watchLoop(intervalMin = 15, tier = "local") {
  log("INFO", `Starting Finance watch loop (every ${intervalMin}min, tier=${tier})`);
  const ms = intervalMin * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) { log("WARN", "Previous patrol still running — skipping"); return; }
    running = true;
    try { await patrolCycle(tier); } catch (err) { log("ERR", `Patrol error: ${err.message}`); }
    running = false;
  };

  await tick();
  const timer = setInterval(tick, ms);
  process.on("SIGINT",  () => { log("INFO", "Shutting down"); clearInterval(timer); process.exit(0); });
  process.on("SIGTERM", () => { log("INFO", "Shutting down"); clearInterval(timer); process.exit(0); });
}

// ── CLI dispatch ────────────────────────────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  const tierFlag = args.includes("--tier") ? args[args.indexOf("--tier") + 1] : "local";

  switch (cmd) {
    case "patrol": {
      const localArgs = args.filter(a => !a.startsWith("--"));
      const tier = localArgs[0] || tierFlag;
      await patrolCycle(tier);
      break;
    }
    case "morning":
      await morningDigest();
      break;
    case "evening":
      await eveningSummary();
      break;
    case "monthend":
      await monthEndClose();
      break;
    case "watch": {
      const watchInterval = args.find(a => /^\d+$/.test(a));
      const watchTier = args.find(a => ["local","premium","cloud"].includes(a)) || "local";
      await watchLoop(Number(watchInterval) || 15, watchTier);
      break;
    }
    case "eval": {
      const limit = Number(args[0]) || 5;
      log("INFO", `Scoring up to ${limit} recent decisions...`);
      try {
        const out = await run([EVAL_SCRIPT, "score-recent", "--limit", String(limit)]);
        log("INFO", `Evaluate: ${out.trim()}`);
      } catch (err) { log("ERR", `Evaluation failed: ${err.message}`); }
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
          const msg = `📊 财务AI准确率报告 (近${days}天)\n━━━━━━━━━━━━━━━━━━\n评价: ${report.overall.evaluated}条 | 准确率: ${report.overall.accuracy}`;
          await sendLINE(msg);
        }
      } catch (err) { log("ERR", `Report failed: ${err.message}`); }
      break;
    }
    case "ask": {
      const question = args.join(" ");
      if (!question) { console.error("Usage: node finance-manager.js ask \"<question>\""); process.exit(1); }
      log("INFO", `Q: ${question}`);
      try {
        const raw = await run([QUERY_SCRIPT, "all"]);
        const data = parseJsonOutput(raw);
        const prompt = buildAskPrompt(question, data);
        const answer = await askLLM("analysis", prompt);
        console.log("\n" + answer.trim() + "\n");
      } catch (err) { console.error("Error:", err.message); process.exit(1); }
      break;
    }
    default:
      console.log(`Finance AI Manager — Multi-Model Edition
Usage: node finance-manager.js <command> [options]

Commands:
  patrol [tier]       — Run one patrol analysis cycle
  morning             — Send morning financial digest to LINE
  evening             — Send end-of-day summary to LINE
  monthend            — Month-end close procedure
  watch [min] [tier]  — Continuous patrol loop (default 15min)
  eval [limit]        — Score recent decisions (default: 5)
  report [days]       — Report over N days (default: 7)
  ask "<question>"    — Interactive Q&A

Tiers (model selection):
  local   (default)   — Ornith-9B -> phi4:14b (fallback) + cross-validate
  premium              — minimax-m3:cloud -> Ornith -> phi4
  cloud                — GPT-4o -> minimax-m3 -> Ornith -> phi4

Examples:
  node finance-manager.js patrol
  node finance-manager.js patrol premium
  node finance-manager.js patrol cloud
  node finance-manager.js watch 15 premium
`);
      process.exit(1);
  }
}

main();
