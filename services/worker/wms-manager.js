/**
 * wms-manager.js — WMS AI Manager Brain
 *
 * Orchestrates Ornith analysis + PowerShell/Node execution.
 * Runs on schedule via Windows Task Scheduler or continuous loop.
 *
 * Usage:
 *   node wms-manager.js patrol         # One-shot analysis
 *   node wms-manager.js morning        # Morning digest + LINE
 *   node wms-manager.js iqc-cycle     # IQC decision cycle
 *   node wms-manager.js watch          # Continuous loop (every 30min)
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);

const PROJECT_ROOT = join(__dirname, "..", ".."); // smt-factory-system/
const EXEC_SCRIPT  = join(PROJECT_ROOT, "services/worker/wms-execute.js");
const QUERY_SCRIPT = join(PROJECT_ROOT, "services/worker/watchdog-query.js");
const EVAL_SCRIPT  = join(PROJECT_ROOT, "services/worker/wms-evaluator.js");
const ORNITH_MODEL = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const OPENCODE_EXE = `${process.env.APPDATA}\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe`;
const LINE_TOKEN  = join(PROJECT_ROOT, "services/worker/line_token.txt");
const STATE_FILE  = join(PROJECT_ROOT, "services/worker/last-state.json");
const LOG_FILE    = join(PROJECT_ROOT, "services/worker/wms-manager.log");

// ── Agent Bus (inter-agent communication) ─────────────────────────────────────
import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

const mem = createMemoryClient({ agentId: "wms-ai" });

// ── Logging ───────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try {
    const { appendFileSync } = require("fs");
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
    // Build a command line: opencode run [args...] < prompt from stdin or file
    // Use cmd /c so that Windows can find the exe in PATH
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

// ── Parse Ornith JSON output ──────────────────────────────────────────
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

function parseOrnithOutput(raw) {
  if (!raw) return null;
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/i, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();

  // Strategy 0: direct full JSON parse (most common clean output)
  try { return JSON.parse(clean); } catch (_) {}

  // Strategy 1: <ANALYSIS>...</ANALYSIS> block
  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) {
    try { return JSON.parse(tagMatch[1]); } catch (_) {}
  }
  // Strategy 2: bare JSON object with "alerts" and "summary"
  const jsonMatch = clean.match(/\{[\s\S]*"alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  }
  // Strategy 3: any JSON with alerts key (brace-counting)
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
  // Strategy 5: find any JSON object with "summary" (string)
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
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) log("WARN", `LINE notification failed: ${res.status}`);
  else log("INFO", "LINE notification sent");
}

// ── State management (mem0-backed, with JSON file fallback) ─────────
async function loadState() {
  try {
    const results = await mem.search("most recent WMS manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (_) {}
  return { iqcNg: [], workOrders: [], lastCycle: null };
}

async function saveState(state) {
  try {
    const label = `WMS cycle — ${state.lastCycle?.slice(0, 10) || "?"}`;
    await mem.store(`${label} — ${(state.iqcNg || []).length} IQC NG, ${(state.workOrders || []).length} WOs`, { type: "wms_state", state, ts: state.lastCycle || new Date().toISOString() });
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { require("fs").writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

// ── Delta detection ───────────────────────────────────────────────────
async function detectNewNg(currentLots) {
  const prev = await loadState();
  const prevMap = {};
  (prev.iqcNg || []).forEach(l => { prevMap[l.lot_no] = l.iqc_status; });

  return currentLots.filter(l => {
    if (l.iqc_status === "pending") return false;
    const prevStatus = prevMap[l.lot_no];
    return !prevStatus || prevStatus === "pending";
  });
}

async function detectNewWo(currentWos) {
  const prev = await loadState();
  const prevMap = {};
  (prev.workOrders || []).forEach(w => { prevMap[w.code] = w.status; });

  return currentWos.filter(w => {
    if (w.status !== "released") return false;
    const prevStatus = prevMap[w.code];
    return !prevStatus || prevStatus === "draft";
  });
}

// ── Build Ornith prompt ────────────────────────────────────────────────
function buildPrompt(data, newNgLots, newWo, elapsedHours) {
  const ts = new Date().toLocaleString("zh-CN");
  return `工厂WMS巡逻报告 — ${ts}
系统运行时间: ${elapsedHours}h

<WORK_ORDERS>
${JSON.stringify(data.workOrders ?? [], null, 2)}
</WORK_ORDERS>

<IQC_LOTS>
新发现的IQC异常批次:
${JSON.stringify(newNgLots ?? [], null, 2)}

所有IQC批次:
${JSON.stringify(data.iqcNg ?? [], null, 2)}
</IQC_LOTS>

<INVENTORY_HEALTH>
${JSON.stringify(data.wmsHealth ?? {}, null, 2)}
</INVENTORY_HEALTH>

<QUALITY>
${JSON.stringify(data.quality ?? {}, null, 2)}
</QUALITY>

<EXPIRY_WARNING>
${JSON.stringify(data.expiryWarning ?? [], null, 2)}
</EXPIRY_WARNING>

<PERIODIC_QUALITY>
${JSON.stringify(data.periodicQuality ?? {}, null, 2)}
</PERIODIC_QUALITY>

<DAMAGE_CLAIMS>
${JSON.stringify(data.damageClaims ?? {}, null, 2)}
</DAMAGE_CLAIMS>

你是一个SMT电子工厂的WMS AI管理员。基于以上数据，做出智能决策。

严格按照以下JSON格式返回（只返回JSON，不要其他文字）：

<ANALYSIS>
{
  "alerts": [
    {
      "severity": "critical|warning|info",
      "area": "iqc|wo|wms|quality|msd|expiry|damage|ng_waste",
      "title": "标题",
      "detail": "详细描述",
      "action": "具体行动",
      "lot_no": "批次号（如适用）",
      "urgency": "immediate|24h|this_week"
    }
  ],
  "iqc_decisions": [
    {
      "lot_no": "批次号",
      "action": "IQC_RELEASE|IQC_HOLD|IQC_REJECT",
      "reason": "判定原因",
      "auto_execute": true
    }
  ],
  "issue_to_line": [
    {
      "lot_no": "批次号",
      "qty": 数量,
      "work_order_code": "工单号"
    }
  ],
  "msd_alerts": [
    {
      "lot_no": "批次号",
      "material": "物料",
      "exposed_hours": 已暴露小时,
      "action": "BAKE|BLOCK|RELEASE"
    }
  ],
  "expiry_alerts": [
    {
      "lot_no": "批次号",
      "material_code": "物料编号",
      "material_name_zh": "物料名称",
      "expiry_date": "YYYY-MM-DD",
      "days_remaining": 5,
      "alert_level": "expired|critical|warning|notice",
      "action": "SCRAP|RETURN|VENDOR_RETURN|VENDOR_HOLD|USE_FIRST|CONTINUE",
      "reason": "原因说明"
    }
  ],
  "quality_check_actions": [
    {
      "lot_no": "批次号",
      "material_code": "物料编号",
      "check_type": "expiring_soon|mid_life_no_inspection",
      "urgency": "critical|warning|notice",
      "action": "QUALITY_REINSPECT|ADVANCE_USAGE|HOLD|RELEASE",
      "reason": "原因说明",
      "auto_execute": true
    }
  ],
  "damage_alerts": [
    {
      "lot_no": "批次号",
      "material_code": "物料编号",
      "material_name_zh": "物料名称",
      "supplier_code": "供应商编号",
      "claim_type": "iqc_rejected|production_damage|appearance_damage",
      "defect_code": "缺陷代码",
      "defect_severity": "critical|major|minor",
      "claim_age": "recent|within_3months|older",
      "action": "VENDOR_RETURN|SCRAP|HOLD|BLOCK",
      "replenishment_qty": 补货数量,
      "reason": "原因说明",
      "auto_execute": true
    }
  ],
  "ng_waste_actions": [
    {
      "work_order_code": "工单号",
      "line_code": "产线编号",
      "station_code": "站号",
      "material_code": "物料编号",
      "material_name_zh": "物料名称",
      "ng_count": 1,
      "material_per_unit": 1.0,
      "total_waste_qty": 物料浪费总量,
      "action": "DEDUCT_STORAGE|REQUISITION|BOTH",
      "replenishment_qty": 补货数量,
      "auto_execute": true
    }
  ],
  "summary": "一句话总结"
}
</ANALYSIS>`;
}

// ── Execute IQC decisions ─────────────────────────────────────────────
async function executeIqcDecisions(decisions, cycleId) {
  const results = [];
  for (const d of decisions ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[IQC] ${d.action} on ${d.lot_no} — auto=false, skipping`);
      continue;
    }
    await logOrnithDecision(cycleId, "iqc", d);
    try {
      const out = await run([
        EXEC_SCRIPT, "iqc-decide",
        "--lotno", d.lot_no,
        "--action", d.action.replace("IQC_", ""),
        "--reason", d.reason,
      ]);
      log("INFO", `[IQC] ${d.action} ${d.lot_no}: OK`);
      results.push({ lot_no: d.lot_no, action: d.action, result: "ok" });
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("IQC_STATUS_BLOCKED") || msg.includes("409")) {
        log("INFO", `[IQC] ${d.action} ${d.lot_no}: already in status, skipping`);
        results.push({ lot_no: d.lot_no, action: d.action, result: "skipped" });
      } else {
        log("ERROR", `[IQC] ${d.action} ${d.lot_no} failed: ${msg}`);
        results.push({ lot_no: d.lot_no, action: d.action, result: "failed", error: msg });
      }
    }
  }
  return results;
}

// ── Execute issue to line (FIFO-enforced) ─────────────────────────────
// Always validates via pickCandidate FIFO. If Ornith suggests a different
// lot, override with FIFO candidate and log the deviation.
async function executeIssueToLine(items) {
  const results = [];
  for (const d of items ?? []) {
    if (!d.work_order_code) {
      log("WARN", `[ISSUE] Missing work_order_code, skipping`);
      results.push({ lot_no: d.lot_no ?? null, wo: null, result: "missing-wo" });
      continue;
    }

    // Always resolve via FIFO pick candidate first
    let fifoLotNo = null;
    try {
      const raw = await run([QUERY_SCRIPT, "pick-candidate", "--wocode", d.work_order_code, "--qty", String(d.qty ?? 0)]);
      const candidate = JSON.parse(raw);
      fifoLotNo = candidate.lot_no ?? null;
    } catch (_) {}

    const suggestedLotNo = d.lot_no ?? null;
    let resolvedLotNo;
    let fifoDeviation = false;

    if (suggestedLotNo) {
      // Ornith suggested a lot — validate against FIFO
      if (fifoLotNo && suggestedLotNo !== fifoLotNo) {
        log("WARN", `[ISSUE] FIFO deviation — Ornith suggested ${suggestedLotNo}, FIFO candidate is ${fifoLotNo} for WO:${d.work_order_code} — overriding`);
        fifoDeviation = true;
        resolvedLotNo = fifoLotNo;
      } else {
        resolvedLotNo = suggestedLotNo;
      }
    } else {
      // No Ornith suggestion — use FIFO candidate
      resolvedLotNo = fifoLotNo;
    }

    if (!resolvedLotNo) {
      log("WARN", `[ISSUE] WO:${d.work_order_code} qty:${d.qty ?? 0} — no available lot (FIFO), saving as pending`);
      results.push({ lot_no: null, wo: d.work_order_code, result: "no-lot" });
      continue;
    }

    try {
      await run([
        EXEC_SCRIPT, "issue-to-line",
        "--lotno", resolvedLotNo,
        "--qty", String(d.qty ?? 0),
        "--wocode", d.work_order_code,
      ]);
      const deviationNote = fifoDeviation ? " [FIFO OVERRIDE]" : "";
      log("INFO", `[ISSUE] ${resolvedLotNo} → WO:${d.work_order_code}: OK${deviationNote}`);
      results.push({ lot_no: resolvedLotNo, wo: d.work_order_code, result: "ok", fifo_deviation: fifoDeviation ?? false });
    } catch (err) {
      log("ERROR", `[ISSUE] ${resolvedLotNo} → WO:${d.work_order_code} failed: ${err.message}`);
      results.push({ lot_no: resolvedLotNo, wo: d.work_order_code, result: "failed", error: err.message });
    }
  }
  return results;
}

// ── Save manual (non-auto) decisions to pending-approvals.json ────────
// Dashboard reads this file to present operator approval queue.
const PENDING_FILE = join(PROJECT_ROOT, "services/worker/pending-approvals.json");

function savePendingApprovals(analysis) {
  const pending = {
    iqc:      (analysis.iqc_decisions ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, action: d.action, reason: d.reason })),
    issue:    (analysis.issue_to_line ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, work_order_code: d.work_order_code })),
    pick:     (analysis.pick ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, work_order_code: d.work_order_code })),
    putaway:  (analysis.put_away ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, location: d.location })),
    return:   (analysis.return_to_line ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, work_order_code: d.work_order_code, reason: d.reason })),
    scrap:    (analysis.scrap ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, reason: d.reason })),
    msd:      (analysis.msd_alerts ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, material: d.material, exposed_hours: d.exposed_hours, action: d.action })),
    expiry:   (analysis.expiry_alerts ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, material_code: d.material_code, expiry_date: d.expiry_date, days_remaining: d.days_remaining, alert_level: d.alert_level, action: d.action, reason: d.reason })),
    quality_check: (analysis.quality_check_actions ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, material_code: d.material_code, check_type: d.check_type, urgency: d.urgency, action: d.action, reason: d.reason })),
    damage:   (analysis.damage_alerts ?? []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, material_code: d.material_code, supplier_code: d.supplier_code, claim_type: d.claim_type, defect_code: d.defect_code, action: d.action, replenishment_qty: d.replenishment_qty, reason: d.reason })),
    ng_waste: (analysis.ng_waste_actions ?? []).filter(d => d.auto_execute === false).map(d => ({ work_order_code: d.work_order_code, material_code: d.material_code, ng_count: d.ng_count, total_waste_qty: d.total_waste_qty, replenishment_qty: d.replenishment_qty, action: d.action, reason: d.reason })),
  };

  const total = pending.iqc.length + pending.issue.length + pending.pick.length +
                pending.putaway.length + pending.return.length + pending.scrap.length +
                pending.msd.length + pending.expiry.length + pending.quality_check.length +
                pending.damage.length + pending.ng_waste.length;
                pending.msd.length + pending.expiry.length + pending.quality_check.length;

  if (total > 0) {
    log("INFO", `Saving ${total} manual decisions to pending-approvals.json`);
    try {
      require("fs").writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
    } catch (_) {}
  }
}
async function executePick(picks) {
  const results = [];
  for (const d of picks ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[PICK] ${d.lot_no} x${d.qty} → WO:${d.work_order_code} — auto=false, skipping`);
      continue;
    }
    try {
      await run([EXEC_SCRIPT, "pick", "--lotno", d.lot_no, "--qty", String(d.qty), "--wocode", d.work_order_code]);
      log("INFO", `[PICK] ${d.lot_no} x${d.qty} → WO:${d.work_order_code}: OK`);
      results.push({ lot_no: d.lot_no, qty: d.qty, wo: d.work_order_code, result: "ok" });
    } catch (err) {
      log("ERROR", `[PICK] ${d.lot_no} failed: ${err.message}`);
      results.push({ lot_no: d.lot_no, result: "failed", error: err.message });
    }
  }
  return results;
}

// ── Execute put-away ─────────────────────────────────────────────────
async function executePutAway(items) {
  const results = [];
  for (const d of items ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[PUT_AWAY] ${d.lot_no} → ${d.location} — auto=false, skipping`);
      continue;
    }
    try {
      await run([EXEC_SCRIPT, "put-away", "--lotno", d.lot_no, "--location", d.location]);
      log("INFO", `[PUT_AWAY] ${d.lot_no} → ${d.location}: OK`);
      results.push({ lot_no: d.lot_no, location: d.location, result: "ok" });
    } catch (err) {
      log("ERROR", `[PUT_AWAY] ${d.lot_no} failed: ${err.message}`);
      results.push({ lot_no: d.lot_no, result: "failed", error: err.message });
    }
  }
  return results;
}

// ── Execute line return ──────────────────────────────────────────────
async function executeReturnLine(returns) {
  const results = [];
  for (const d of returns ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[RETURN] ${d.lot_no} x${d.qty} ← WO:${d.work_order_code} — auto=false, skipping`);
      continue;
    }
    try {
      await run([EXEC_SCRIPT, "return-line", "--lotno", d.lot_no, "--qty", String(d.qty), "--wocode", d.work_order_code, "--reason", d.reason || "LINE_CANCEL"]);
      log("INFO", `[RETURN] ${d.lot_no} x${d.qty} ← WO:${d.work_order_code}: OK`);
      results.push({ lot_no: d.lot_no, qty: d.qty, wo: d.work_order_code, result: "ok" });
    } catch (err) {
      log("ERROR", `[RETURN] ${d.lot_no} failed: ${err.message}`);
      results.push({ lot_no: d.lot_no, result: "failed", error: err.message });
    }
  }
  return results;
}

// ── Execute scrap ───────────────────────────────────────────────────
async function executeScrap(scraps) {
  const results = [];
  for (const d of scraps ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[SCRAP] ${d.lot_no} x${d.qty} — auto=false, skipping`);
      continue;
    }
    try {
      await run([EXEC_SCRIPT, "scrap", "--lotno", d.lot_no, "--qty", String(d.qty), "--reason", d.reason || "DAMAGED"]);
      log("INFO", `[SCRAP] ${d.lot_no} x${d.qty}: OK`);
      results.push({ lot_no: d.lot_no, qty: d.qty, result: "ok" });
    } catch (err) {
      log("ERROR", `[SCRAP] ${d.lot_no} failed: ${err.message}`);
      results.push({ lot_no: d.lot_no, result: "failed", error: err.message });
    }
  }
  return results;
}

// ── MSD (Moisture Sensitive Device) alerts ──────────────────────────
async function handleMsdAlerts(msdAlerts) {
  const results = [];
  for (const a of msdAlerts ?? []) {
    const level = a.exposed_hours > 168 ? "critical" : a.exposed_hours > 72 ? "warning" : "info";
    log("INFO", `[MSD] ${a.lot_no} (${a.material}) exposed ${a.exposed_hours}h — ${a.action}`);
    if (a.action === "BAKE" && a.auto_execute) {
      log("INFO", `[MSD] Auto-baking ${a.lot_no} (requires human setup, flagging for operator)`);
    }
    results.push({ lot_no: a.lot_no, material: a.material, exposed_hours: a.exposed_hours, action: a.action, level });
  }
  return results;
}

// ── Execute expiry alerts (shelf-life based) ──────────────────────────────
async function executeExpiryAlerts(alerts, cycleId) {
  const results = [];
  for (const a of alerts ?? []) {
    const area = "expiry";
    if (a.auto_execute !== false) {
      await logOrnithDecision(cycleId, area, a, area);
      if (a.action === "SCRAP") {
        try {
          await run([EXEC_SCRIPT, "scrap", "--lotno", a.lot_no, "--qty", String(a.qty ?? 0), "--reason", a.reason || "SHELF_LIFE_EXPIRED"]);
          log("INFO", `[EXPIRY] SCRAP ${a.lot_no} (${a.material_name_zh}) — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[EXPIRY] SCRAP ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else if (a.action === "RETURN" || a.action === "VENDOR_RETURN") {
        try {
          await run([EXEC_SCRIPT, "vendor-return",
            "--lotno", a.lot_no,
            "--qty", String(a.qty ?? 0),
            "--reason", `EXPIRY: ${a.reason || "SHELF_LIFE_EXPIRED"}`
          ]);
          log("INFO", `[EXPIRY] VENDOR_RETURN ${a.lot_no} — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[EXPIRY] VENDOR_RETURN ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else if (a.action === "HOLD") {
        try {
          await run([EXEC_SCRIPT, "iqc-decide", "--lotno", a.lot_no, "--action", "hold", "--reason", a.reason || "SHELF_LIFE_NEAR_EXPIRY"]);
          log("INFO", `[EXPIRY] HOLD ${a.lot_no} — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[EXPIRY] HOLD ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else {
        log("INFO", `[EXPIRY] ${a.action} on ${a.lot_no} — acknowledged`);
        results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
      }
    } else {
      log("INFO", `[EXPIRY] ${a.action} on ${a.lot_no} — auto=false, pending approval`);
      results.push({ lot_no: a.lot_no, action: a.action, result: "manual" });
    }
  }
  return results;
}

// ── Execute periodic quality check actions ──────────────────────────────────
async function executeQualityCheckActions(actions, cycleId) {
  const results = [];
  for (const a of actions ?? []) {
    if (a.auto_execute !== false) {
      await logOrnithDecision(cycleId, "quality_check", a, "quality_check");
      if (a.action === "QUALITY_REINSPECT") {
        // Move lot back to IQC for re-inspection
        try {
          await run([EXEC_SCRIPT, "iqc-decide", "--lotno", a.lot_no, "--action", "hold", "--reason", `Periodic quality check: ${a.check_type} — ${a.reason || ""}`]);
          log("INFO", `[QUALITY CHECK] Re-IQC queued for ${a.lot_no} (${a.material_code}) — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[QUALITY CHECK] Re-IQC ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else if (a.action === "ADVANCE_USAGE") {
        // Flag for priority usage (FIFO bump — handled by moving to front of pick queue)
        log("INFO", `[QUALITY CHECK] ADVANCE_USAGE for ${a.lot_no} — flagged for priority`);
        results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
      } else if (a.action === "HOLD") {
        try {
          await run([EXEC_SCRIPT, "iqc-decide", "--lotno", a.lot_no, "--action", "hold", "--reason", `Quality check: ${a.reason || ""}`]);
          log("INFO", `[QUALITY CHECK] HOLD ${a.lot_no} — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[QUALITY CHECK] HOLD ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else {
        log("INFO", `[QUALITY CHECK] ${a.action} on ${a.lot_no} — acknowledged`);
        results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
      }
    } else {
      log("INFO", `[QUALITY CHECK] ${a.action} on ${a.lot_no} — auto=false, pending approval`);
      results.push({ lot_no: a.lot_no, action: a.action, result: "manual" });
    }
  }
  return results;
}

// ── Execute damage alerts — vendor return / compensation ──────────────────────
async function executeDamageAlerts(alerts, cycleId) {
  const results = [];
  for (const a of alerts ?? []) {
    if (a.auto_execute !== false) {
      await logOrnithDecision(cycleId, "damage_alert", a, "damage");
      if (a.action === "VENDOR_RETURN") {
        try {
          const qty = a.replenishment_qty ?? 0;
          await run([EXEC_SCRIPT, "vendor-return",
            "--lotno", a.lot_no,
            "--qty", String(qty),
            "--reason", `DAMAGE_CLAIM: ${a.defect_code ?? "NG"} — ${a.reason ?? ""}`
          ]);
          log("INFO", `[DAMAGE] VENDOR_RETURN ${a.lot_no} (${a.material_code}) — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });

          // Notify BOM: supplier quality issue
          await informBomComponentFailureRate(
            a.material_code,
            a.defect_severity === "critical" ? 100 : a.defect_severity === "major" ? 50 : 10,
            "receiving",
            a.defect_code ?? "DAMAGE",
            30
          );
        } catch (err) {
          log("ERROR", `[DAMAGE] VENDOR_RETURN ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else if (a.action === "SCRAP") {
        try {
          await run([EXEC_SCRIPT, "scrap",
            "--lotno", a.lot_no,
            "--qty", String(a.replenishment_qty ?? 0),
            "--reason", `DAMAGE_SCRAP: ${a.defect_code ?? "NG"}`
          ]);
          log("INFO", `[DAMAGE] SCRAP ${a.lot_no} — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[DAMAGE] SCRAP ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else if (a.action === "HOLD") {
        try {
          await run([EXEC_SCRIPT, "iqc-decide",
            "--lotno", a.lot_no,
            "--action", "hold",
            "--reason", `Damage claim: ${a.defect_code ?? ""}`
          ]);
          log("INFO", `[DAMAGE] HOLD ${a.lot_no} — OK`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
        } catch (err) {
          log("ERROR", `[DAMAGE] HOLD ${a.lot_no} failed: ${err.message}`);
          results.push({ lot_no: a.lot_no, action: a.action, result: "failed", error: err.message });
        }
      } else {
        log("INFO", `[DAMAGE] ${a.action} on ${a.lot_no} — acknowledged`);
        results.push({ lot_no: a.lot_no, action: a.action, result: "ok" });
      }
    } else {
      log("INFO", `[DAMAGE] ${a.action} on ${a.lot_no} — auto=false, pending approval`);
      results.push({ lot_no: a.lot_no, action: a.action, result: "manual" });
    }
  }
  return results;
}

// ── Execute NG waste actions — deduct storage + trigger replenishment ──────────
// NG waste = production defects where materials were consumed but product failed.
// Ornith detects ng_waste_actions → WMS deducts consumed material qty from storage
// and signals PMC/procurement to order replacement materials.
async function executeNgWasteActions(actions, cycleId) {
  const results = [];
  for (const a of actions ?? []) {
    if (a.auto_execute !== false) {
      await logOrnithDecision(cycleId, "ng_waste", a, "ng_waste");
      const wasteQty = a.total_waste_qty ?? (a.ng_count * (a.material_per_unit ?? 1));

      if (a.action === "DEDUCT_STORAGE" || a.action === "BOTH") {
        // Deduct wasted material from the material lot used for this NG
        try {
          // Find the lot that was consumed (from NG events via MES scrap_at_line)
          // We deduct from the lot that was issued to the line
          await run([EXEC_SCRIPT, "scrap",
            "--lotno", a.lot_no ?? "UNKNOWN",
            "--qty", String(wasteQty),
            "--reason", `NG_WASTE: WO=${a.work_order_code} line=${a.line_code} ng_count=${a.ng_count}`
          ]);
          log("INFO", `[NG WASTE] Deducted ${wasteQty} ${a.material_code} for NG waste — OK`);
          results.push({ work_order: a.work_order_code, action: "DEDUCT", result: "ok" });
        } catch (err) {
          log("ERROR", `[NG WASTE] Deduct failed for WO:${a.work_order_code}: ${err.message}`);
          results.push({ work_order: a.work_order_code, action: "DEDUCT", result: "failed", error: err.message });
        }
      }

      if (a.action === "REQUISITION" || a.action === "BOTH") {
        // Signal procurement to order replacement materials
        try {
          await informProcurementReplenishment(
            a.material_code,
            a.replenishment_qty ?? wasteQty,
            a.work_order_code,
            `NG waste compensation: ${a.ng_count} NG units at ${a.station_code ?? a.line_code}`
          );
          log("INFO", `[NG WASTE] Replenishment requisition for ${a.replenishment_qty ?? wasteQty}x ${a.material_code} — sent`);
          results.push({ work_order: a.work_order_code, action: "REQUISITION", result: "ok" });
        } catch (err) {
          log("ERROR", `[NG WASTE] Requisition failed for WO:${a.work_order_code}: ${err.message}`);
          results.push({ work_order: a.work_order_code, action: "REQUISITION", result: "failed", error: err.message });
        }
      }
    } else {
      log("INFO", `[NG WASTE] WO:${a.work_order_code} — auto=false, pending approval`);
      results.push({ work_order: a.work_order_code, action: a.action, result: "manual" });
    }
  }
  return results;
}

// ── Auto-improvement: log every Ornith recommendation to audit DB ──
// cycleId ties all decisions from one patrol cycle together
function generateCycleId() {
  return `wc-${Date.now().toString(36)}`;
}

async function logOrnithDecision(cycleId, decisionType, item, area = "wms") {
  try {
    const lotNo = item.lot_no || null;
    const workOrderCode = item.work_order_code || item.work_order_code || null;
    const autoExecute = item.auto_execute !== false;
    const ornithSummary = JSON.stringify(item);
    await run([
      EXEC_SCRIPT, "audit-log",
      "--decision", decisionType,
      "--lotno", lotNo || "",
      "--wocode", workOrderCode || "",
      "--area", area,
      "--ornith", ornithSummary,
      "--auto", autoExecute ? "true" : "false",
      "--cycle", cycleId,
    ]);
  } catch (err) {
    log("WARN", `[AUDIT] logOrnithDecision failed: ${err.message}`);
  }
}

// ── Auto-improvement: compute Ornith accuracy metrics ───────────────
async function analyzePerformance(days = 7) {
  log("INFO", `Computing Ornith accuracy metrics (last ${days} days)...`);
  try {
    const out = await run([EXEC_SCRIPT, "analyze-performance", "--days", String(days)]);
    const result = JSON.parse(out);
    const s = result.summary;
    const total = Number(s.total_decisions) || 0;
    const rated = Number(s.rated) || 0;
    const correct = Number(s.correct) || 0;
    const incorrect = Number(s.incorrect) || 0;
    const partial = Number(s.partial) || 0;
    const autoDecisions = Number(s.auto_decisions) || 0;
    const overridden = Number(s.overridden) || 0;
    const autoPending = Number(s.auto_pending) || 0;

    const overallAccuracy = rated > 0 ? Math.round(100 * correct / rated) : null;
    const precision = rated > 0 ? Math.round(100 * correct / (correct + incorrect + partial)) : null;

    log("INFO", `Accuracy: ${overallAccuracy ?? "N/A"}% (${rated} rated, ${correct} correct, ${incorrect} incorrect, ${partial} partial)`);
    log("INFO", `Auto decisions: ${autoDecisions} | Overridden by human: ${overridden} | Auto-pending: ${autoPending}`);

    // LINE digest of performance
    if (overallAccuracy !== null) {
      const msg = [
        `📊 Ornith AI 准确率报告 (近${days}天)`,
        `━━━━━━━━━━━━━━━━━━`,
        `总决策: ${total} | 自动: ${autoDecisions} | 人工: ${Number(s.manual_decisions) || 0}`,
        `准确率: ${overallAccuracy}% (${rated}条反馈)`,
        correct > 0 ? `✅ 正确: ${correct}` : null,
        incorrect > 0 ? `❌ 错误: ${incorrect}` : null,
        partial > 0 ? `⚠️ 部分正确: ${partial}` : null,
        `🔄 人工override: ${overridden}`,
        autoPending > 0 ? `⏳ 自动执行中: ${autoPending}` : null,
        "━━━━━━━━━━━━━━━━━━",
      ].filter(Boolean).join("\n");
      await sendLINE(msg);
    }
    return result;
  } catch (err) {
    log("ERROR", `analyzePerformance failed: ${err.message}`);
    return null;
  }
}

// ── Log Ornith's decisions summary ─────────────────────────────────
function logDecisions(analysis) {
  const sections = [
    ["IQC decisions", analysis.iqc_decisions],
    ["Issue to line", analysis.issue_to_line],
    ["Pick", analysis.pick],
    ["Put-away", analysis.put_away],
    ["Line return", analysis.return_to_line],
    ["Scrap", analysis.scrap],
    ["MSD alerts", analysis.msd_alerts],
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

// ── Agent Bus — Inbound Message Handlers ──────────────────────────────────────

// MES → WMS
async function handleMaterialNeeded(payload) {
  const { work_order_code, material_code, required_qty, line_code, urgency } = payload;
  log("INFO", `[MES→WMS] material_needed: ${material_code} ×${required_qty} for WO:${work_order_code} (${urgency})`);
}

async function handleLineFinished(payload) {
  const { work_order_code, line_code, completed_qty, unused_materials } = payload;
  log("INFO", `[MES→WMS] line_finished: WO:${work_order_code} on ${line_code} — ${completed_qty} completed`);
  if (unused_materials?.length > 0) {
    log("INFO", `[MES→WMS] unused materials to return: ${JSON.stringify(unused_materials)}`);
  }
}

async function handleFeederMismatch(payload) {
  const { station_code, expected_material, actual_material, feeder_slot, line_code } = payload;
  log("WARN", `[MES→WMS] feeder_mismatch: ${station_code} expected ${expected_material} but found ${actual_material}`);
  await sendLINE(`🔴 [WMS] feeder错料: ${station_code} (slot ${feeder_slot}) 期望${expected_material}实际${actual_material}`);
}

async function handleScrapAtLine(payload) {
  const { lot_no, quantity, reason_code, work_order_code } = payload;
  log("INFO", `[MES→WMS] scrap_at_line: ${lot_no} ×${quantity} reason=${reason_code} WO=${work_order_code}`);
}

async function handleRequestIssue(payload) {
  const { work_order_code, line_code, items } = payload;
  log("INFO", `[MES→WMS] request_issue: WO:${work_order_code} → ${line_code} (${items?.length ?? 0} materials)`);
}

// BOM → WMS
async function handleBomUpdated(payload) {
  const { product_code, old_version, new_version } = payload;
  log("INFO", `[BOM→WMS] bom_updated: ${product_code} v${old_version}→v${new_version}`);
}

async function handleAlternativeAvailable(payload) {
  const { original_material, alternative_material, substitution_reason } = payload;
  log("INFO", `[BOM→WMS] alternative_available: ${original_material} → ${alternative_material} (${substitution_reason})`);
}

async function handleBomAccuracyAlert(payload) {
  const { product_code, expected_material, actual_on_line, description } = payload;
  log("WARN", `[BOM→WMS] bom_accuracy_alert: ${product_code} — ${description}`);
  await sendLINE(`🔴 [WMS BOM警报] ${product_code}: ${description}`);
}

// HR → WMS
async function handleOperatorLeaveCoverage(payload) {
  const { line_code, operator_employee_no, leave_dates } = payload;
  log("INFO", `[HR→WMS] operator_leave_coverage: ${operator_employee_no} on ${line_code}`);
}

// RDA → WMS
async function handleDefectPatternQuery(payload) {
  const { request_id, material_code, station_type, defect_code, period_days } = payload;
  log("INFO", `[RDA→WMS] defect_pattern_query: ${material_code} @ ${station_type}`);
}

// ── Plant Manager directive handler ───────────────────────────────────────
async function handlePlantDirective(payload) {
  const { source, severity, title, detail, material_code, action } = payload;
  log("WARN", `[PLANT→WMS] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🏭 [工厂指令-WMS] ${title}\n物料: ${material_code ?? "N/A"}\n详情: ${detail}`);
  }
}

// ── Plant Manager status request handler ──────────────────────────────────
async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  log("INFO", `[PLANT→WMS] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    const raw = await run([QUERY_SCRIPT, "all"]);
    const data = JSON.parse(raw);
    const kpis = {
      pending_iqc:    (data.iqcNg ?? []).filter(l => l.iqc_status === "pending").length,
      hold_lots:      (data.iqcNg ?? []).filter(l => l.iqc_status === "hold").length,
      low_stock:      (data.wmsHealth?.lowStock ?? []).length,
      running_wos:    (data.workOrders ?? []).filter(w => w.status === "running").length,
      released_wos:   (data.workOrders ?? []).filter(w => w.status === "released").length,
    };
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "wms-ai",
      kpis,
    }, { correlationId: request_id });
  } catch (err) {
    log("ERR", `[PLANT→WMS] plant_status_request failed: ${err.message}`);
    await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "wms-ai",
      error: err.message,
    }, { correlationId: request_id });
  }
}

const MESSAGE_HANDLERS = {
  "material_needed":        handleMaterialNeeded,
  "line_finished":          handleLineFinished,
  "feeder_mismatch":        handleFeederMismatch,
  "scrap_at_line":          handleScrapAtLine,
  "request_issue":          handleRequestIssue,
  "bom_updated":           handleBomUpdated,
  "alternative_available":  handleAlternativeAvailable,
  "bom_accuracy_alert":    handleBomAccuracyAlert,
  "operator_leave_coverage": handleOperatorLeaveCoverage,
  "defect_pattern_query":   handleDefectPatternQuery,
  // Plant Manager
  "plant_directive":        handlePlantDirective,
  "plant_status_request":   handlePlantStatusRequest,
};

// ── Manager Bus (after MESSAGE_HANDLERS) ─────────────────────────────────
bus = createManagerBus({
  agentId: "wms-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: MESSAGE_HANDLERS,
});

// ── Agent Bus — process inbound messages ──────────────────────────────────────
async function processAgentMessages() {
  if (!bus) return;
  await bus.init();
  // bus.poll() dispatches internally — no manual loop needed
  await bus.poll(20);
}

// ── Agent Bus — Outbound Senders ───────────────────────────────────────────────

async function informMesMaterialIssued(lotNo, materialCode, qty, workOrderCode, lineCode, stationCode) {
  await bus.send("mes-ai", "material_issued", {
    lot_no: lotNo, material_code: materialCode, qty,
    work_order_code: workOrderCode, line_code: lineCode, station_code: stationCode,
  });
}

async function informMesIqcReleased(lotNo, materialCode, qty, releasedAt) {
  await bus.send("mes-ai", "iqc_released", {
    lot_no: lotNo, material_code: materialCode, qty, released_at: releasedAt,
  });
}

async function informMesIqcHold(lotNo, materialCode, qty, reason) {
  await bus.send("mes-ai", "iqc_hold", {
    lot_no: lotNo, material_code: materialCode, qty, reason,
  });
}

async function informMesScrapCreated(lotNo, materialCode, qty, reasonCode) {
  await bus.send("mes-ai", "scrap_created", {
    lot_no: lotNo, material_code: materialCode, qty, reason_code: reasonCode,
  });
}

async function informMesLineReturn(lotNo, qty, workOrderCode, reason) {
  await bus.send("mes-ai", "line_return", {
    lot_no: lotNo, qty, work_order_code: workOrderCode, reason,
  });
}

async function informMesLowStockWarning(materialCode, daysRemaining, threshold, critical) {
  await bus.send("mes-ai", "low_stock_warning", {
    material_code: materialCode, days_remaining: daysRemaining, threshold, critical,
  });
}

async function informMesMsdAlert(lotNo, materialCode, exposedHours, limitHours, lineCode) {
  await bus.send("mes-ai", "msd_alert", {
    lot_no: lotNo, material_code: materialCode, exposed_hours: exposedHours,
    limit_hours: limitHours, line_code: lineCode,
  });
}

async function informMesExpiryAlert(lotNo, materialCode, expiryDate, daysRemaining, alertLevel, action) {
  await bus.send("mes-ai", "expiry_alert", {
    lot_no: lotNo, material_code: materialCode, expiry_date: expiryDate,
    days_remaining: daysRemaining, alert_level: alertLevel, action,
  });
}

async function informBomComponentFailureRate(materialCode, defectRatePct, stationType, defectCode, periodDays) {
  await bus.send("bom-ai", "component_failure_rate", {
    material_code: materialCode, defect_rate_pct: defectRatePct,
    station_type: stationType, defect_code: defectCode, period_days: periodDays,
  });
}

async function informHrWorkOrderCritical(workOrderCode, lineCode, priority, reason) {
  await bus.send("hr-ai", "work_order_critical", {
    work_order_code: workOrderCode, line_code: lineCode, priority, reason,
  });
}

async function informRdaMaterialConsumptionData(workOrderCode, materialCode, bomQtyPer, actualAvgConsumption, sampleSize) {
  await bus.send("rda-ai", "bom_usage_feedback", {
    work_order_code: workOrderCode, material_code: materialCode,
    bom_qty_per: bomQtyPer, actual_avg_consumption: actualAvgConsumption, sample_size: sampleSize,
  });
}

async function informProcurementReplenishment(materialCode, qty, workOrderCode, reason) {
  // Notify PMC (via MES or directly to PMC agent) to trigger emergency procurement
  await bus.send("mes-ai", "material_needed", {
    work_order_code: workOrderCode,
    material_code: materialCode,
    required_qty: qty,
    line_code: "",
    urgency: "immediate",
    reason: reason,
  });
  log("INFO", `[REPLENISH] Sent material_needed to MES for ${materialCode} x${qty} — ${reason}`);
}

// ── Agent Bus — send outbound messages after Ornith analysis ─────────────────
async function sendOutboundMessages(analysis, wmsData) {
  const results = [];

  // IQC released/hold → MES
  for (const d of (analysis.iqc_decisions ?? [])) {
    const lot = wmsData.iqcNg?.find(l => l.lot_no === d.lot_no);
    if (d.action === "release_to_stock" && d.auto_execute !== false && lot) {
      await informMesIqcReleased(d.lot_no, lot.material_code, lot.received_qty, new Date().toISOString());
      results.push({ type: "iqc_released", lot_no: d.lot_no });
    } else if (d.action === "place_on_hold" && d.auto_execute !== false && lot) {
      await informMesIqcHold(d.lot_no, lot.material_code, lot.received_qty, d.reason ?? "IQC hold");
      results.push({ type: "iqc_hold", lot_no: d.lot_no });
    }
  }

  // Issue to line → MES
  for (const d of (analysis.issue_to_line ?? [])) {
    if (d.auto_execute !== false) {
      await informMesMaterialIssued(d.lot_no, d.material_code, d.qty, d.work_order_code, d.line_code, d.station_code);
      results.push({ type: "material_issued", lot_no: d.lot_no });
    }
  }

  // Scrap → MES
  for (const d of (analysis.scrap ?? [])) {
    if (d.auto_execute !== false) {
      await informMesScrapCreated(d.lot_no, d.material_code, d.quantity, d.reason_code);
      results.push({ type: "scrap_created", lot_no: d.lot_no });
    }
  }

  // Return to line → MES
  for (const d of (analysis.return_to_line ?? [])) {
    await informMesLineReturn(d.lot_no, d.qty, d.work_order_code, d.reason);
    results.push({ type: "line_return", lot_no: d.lot_no });
  }

  // Low stock → MES
  const lowStock = (wmsData.wmsHealth?.lowStock ?? []).filter(l => l.days_remaining <= 3);
  for (const l of lowStock) {
    await informMesLowStockWarning(l.material_code, l.days_remaining, l.threshold, l.days_remaining <= 1);
    results.push({ type: "low_stock_warning", material: l.material_code });
  }

  // MSD alerts → MES
  for (const a of (analysis.msd_alerts ?? [])) {
    if (a.severity === "critical" || a.severity === "warning") {
      await informMesMsdAlert(a.lot_no, a.material_code, a.exposed_hours, a.limit_hours, a.line_code);
      results.push({ type: "msd_alert", lot_no: a.lot_no });
    }
  }

  // Expiry alerts → MES
  for (const a of (analysis.expiry_alerts ?? [])) {
    if (a.alert_level === "expired" || a.alert_level === "critical") {
      await informMesExpiryAlert(a.lot_no, a.material_code, a.expiry_date, a.days_remaining, a.alert_level, a.action);
      results.push({ type: "expiry_alert", lot_no: a.lot_no });
    }
  }

  return results;
}

// ── Send alerts to LINE ──────────────────────────────────────────────
async function sendAlertsToLINE(analysis) {
  const criticalAlerts = (analysis.alerts ?? []).filter(a => a.severity === "critical");
  const warningAlerts  = (analysis.alerts ?? []).filter(a => a.severity === "warning");

  if (criticalAlerts.length > 0) {
    let msg = "🔴 WMS紧急告警\n━━━━━━━━━━━━━━━━━━";
    for (const a of criticalAlerts) {
      msg += `\n[${String(a.area).toUpperCase()}] ${a.title}`;
      msg += `\n详情: ${a.detail}`;
      msg += `\n行动: ${a.action}`;
      if (a.lot_no) msg += `\n批次: ${a.lot_no}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }

  if (warningAlerts.length > 0) {
    let msg = "🟡 WMS预警\n━━━━━━━━━━━━━━━━━━";
    for (const a of warningAlerts) {
      msg += `\n[${String(a.area).toUpperCase()}] ${a.title}`;
      msg += `\n行动: ${a.action}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }

  // Expiry alerts — critical and warning only
  const expiryCritical = (analysis.expiry_alerts ?? []).filter(a => a.alert_level === "expired" || a.alert_level === "critical");
  const expiryWarning  = (analysis.expiry_alerts ?? []).filter(a => a.alert_level === "warning");
  if (expiryCritical.length > 0) {
    let msg = "🔴 WMS有效期告警\n━━━━━━━━━━━━━━━━━━";
    for (const a of expiryCritical) {
      msg += `\n[EXPIRY] ${a.lot_no} (${a.material_name_zh ?? a.material_code})`;
      msg += `\n到期: ${a.expiry_date} 剩余${a.days_remaining}天`;
      msg += `\n行动: ${a.action} — ${a.reason ?? ""}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  } else if (expiryWarning.length > 0) {
    let msg = "🟡 WMS有效期预警\n━━━━━━━━━━━━━━━━━━";
    for (const a of expiryWarning) {
      msg += `\n[EXPIRY] ${a.lot_no} (${a.material_name_zh ?? a.material_code}) — ${a.days_remaining}天后到期`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }
}

// ── Main patrol cycle ────────────────────────────────────────────────
async function patrolCycle() {
  const cycleId = generateCycleId();
  log("INFO", `=== WMS Manager patrol starting === [cycle ${cycleId}]`);

  // 1. Query all data
  log("INFO", "Querying database...");
  let raw;
  try {
    raw = await run([QUERY_SCRIPT, "all"]);
  } catch (err) {
    log("ERROR", `DB query failed: ${err.message}`);
    return;
  }
  const data = JSON.parse(raw);

  // 1b. Process inbound messages from other agents
  try { await processAgentMessages(); } catch (err) { log("WARN", `Agent message processing: ${err.message}`); }

  // 2. Delta detection
  const newNgLots = await detectNewNg(data.iqcNg ?? []);
  const newWo     = await detectNewWo(data.workOrders ?? []);
  const prevState  = await loadState();
  const elapsed    = prevState.lastCycle
    ? ((Date.now() - new Date(prevState.lastCycle).getTime()) / 3600000).toFixed(1)
    : "0";

  if (newNgLots.length > 0) {
    log("WARN", `New NG lots: ${newNgLots.map(l => `${l.lot_no}(${l.iqc_status})`).join(", ")}`);
  }
  if (newWo.length > 0) {
    log("INFO", `New released WOs: ${newWo.map(w => w.code).join(", ")}`);
  }

  // 3. Build Ornith prompt
  const prompt = buildPrompt(data, newNgLots, newWo, Number(elapsed));

  // 4. Multi-model analysis
  log("INFO", "Sending to LLM for analysis...");
  let ornithOut;
  try {
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    ornithOut = multi.text;
    log("INFO", `Primary model ${multi.model} responded (${ornithOut.length} chars)`);
    if (scoreResponse(ornithOut) < 4) {
      const fb = await askLLM("validator", prompt, { temperature: 0.1 });
      if (scoreResponse(fb) > scoreResponse(ornithOut)) { ornithOut = fb; log("INFO", "Using validator output"); }
    }
  } catch (err) {
    log("ERROR", `Multi-model analysis failed: ${err.message}`);
    return;
  }

  // 5. Parse output
  const analysis = parseOrnithOutput(ornithOut);
  if (!analysis) {
    log("WARN", "Could not parse Ornith output");
    console.log("Raw output:", ornithOut?.slice(0, 500));
    return;
  }

  logDecisions(analysis);

  // 6. Execute all decision types
  if (analysis.iqc_decisions?.length > 0) await executeIqcDecisions(analysis.iqc_decisions, cycleId);
  if (analysis.issue_to_line?.length > 0) await executeIssueToLine(analysis.issue_to_line);
  if (analysis.pick?.length > 0)           await executePick(analysis.pick);
  if (analysis.put_away?.length > 0)       await executePutAway(analysis.put_away);
  if (analysis.return_to_line?.length > 0) await executeReturnLine(analysis.return_to_line);
  if (analysis.scrap?.length > 0)          await executeScrap(analysis.scrap);
  if (analysis.msd_alerts?.length > 0)     await handleMsdAlerts(analysis.msd_alerts);
  if (analysis.expiry_alerts?.length > 0)  await executeExpiryAlerts(analysis.expiry_alerts, cycleId);
  if (analysis.quality_check_actions?.length > 0) await executeQualityCheckActions(analysis.quality_check_actions, cycleId);
  if (analysis.damage_alerts?.length > 0)        await executeDamageAlerts(analysis.damage_alerts, cycleId);
  if (analysis.ng_waste_actions?.length > 0)     await executeNgWasteActions(analysis.ng_waste_actions, cycleId);

  // 7. Evaluate recent unevaluated Ornith decisions with judge LLM
  try {
    await run([EVAL_SCRIPT, "score-recent", "--limit", "5"]);
  } catch (err) {
    log("WARN", `Evaluator call failed: ${err.message}`);
  }

  // 7b. Send outbound messages to other agents based on Ornith analysis
  try { await sendOutboundMessages(analysis, data); } catch (err) { log("WARN", `sendOutboundMessages: ${err.message}`); }

  // 8. Save manual decisions for dashboard approval queue
  savePendingApprovals(analysis);

  // 9. Send LINE alerts
  await sendAlertsToLINE(analysis);

  // 9. Save state
  await saveState({
    iqcNg:      data.iqcNg,
    workOrders: data.workOrders,
    lastCycle:  new Date().toISOString(),
  });

  log("INFO", "=== Patrol cycle complete ===");
}

// ── Morning Digest ───────────────────────────────────────────────────
async function morningDigest() {
  log("INFO", "Generating morning digest...");
  await bus.init();
  try { await processAgentMessages(); } catch (_) {}

  let raw;
  try {
    raw = await run([QUERY_SCRIPT, "all"]);
  } catch (err) {
    log("ERROR", `DB query failed: ${err.message}`);
    return;
  }
  const data = JSON.parse(raw);
  const lots = data.iqcNg ?? [];
  const wos   = data.wmsHealth ?? {};
  const low   = data.wmsHealth?.lowStock ?? [];

  const pending = lots.filter(l => l.iqc_status === "pending").length;
  const hold    = lots.filter(l => l.iqc_status === "hold").length;
  const reject  = lots.filter(l => l.iqc_status === "rejected").length;
  const running = (data.workOrders ?? []).filter(w => w.status === "running").length;
  const released= (data.workOrders ?? []).filter(w => w.status === "released").length;

  // ── Mini performance summary for morning digest ─────────────────────
  let perfLine = "";
  try {
    const repOut = await run([EVAL_SCRIPT, "report", "--days", "7"]);
    const rep = JSON.parse(repOut);
    const o = rep.overall;
    const total = Number(o.total_decisions) || 0;
    const rated = Number(o.rated) || 0;
    const correct = Number(o.correct) || 0;
    const accuracy = rated > 0 ? Math.round(100 * correct / rated) : null;
    if (total > 0) {
      perfLine = `🤖 AI准确率: ${accuracy !== null ? `${accuracy}%` : "N/A"} (${rated}条评分/共${total}决策)`;
    }
  } catch (_) {}

  const msg = [
    `🌅 WMS晨报 ${new Date().toLocaleDateString("zh-CN")}`,
    "━━━━━━━━━━━━━━━━━━",
    `📦 库存: 待检${pending} | Hold${hold} | 拒绝${reject} | 已检验${wos.lots?.find(l => l.iqc_status === "released")?.count ?? 0}批`,
    `⚙️ 工单: 进行中${running} | 已下达${released}`,
    low.length > 0 ? `⚠️ 低库存: ${low.map(l => l.material_name_zh).join(", ")}` : null,
    hold + reject > 0 ? `🔴 需关注: ${lots.filter(l => l.iqc_status !== "pending").map(l => `${l.lot_no}(${l.iqc_status})`).join(", ")}` : null,
    perfLine || null,
    "━━━━━━━━━━━━━━━━━━",
    "📋 详细分析见 OpenCode WMS Manager",
  ].filter(Boolean).join("\n");

  await sendLINE(msg);
  console.log(msg);
}

// ── Watch loop ──────────────────────────────────────────────────────
async function watch(intervalMin = 30) {
  log("INFO", `Starting WMS Manager watch loop (every ${intervalMin}min)`);
  const ms = intervalMin * 60 * 1000;
  while (true) {
    await patrolCycle();
    await new Promise(r => setTimeout(r, ms));
  }
}

// ── Continuous message listener ───────────────────────────────────────────────
async function busWatchLoop(intervalMs = 30 * 1000) {
  log("INFO", `WMS bus-watch started (poll every ${intervalMs / 1000}s)`);
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

// ── Interactive Q&A prompt builder ─────────────────────────────────────────
function buildAskPrompt(question, data) {
  const ts = new Date().toLocaleString("zh-CN");
  return `工厂WMS AI管理员问答 — ${ts}

你是一个SMT电子工厂的WMS AI管理员。请根据以下当前数据，回答用户的问题。

<WORK_ORDERS>
${JSON.stringify(data.workOrders ?? [], null, 2)}
</WORK_ORDERS>

<IQC_LOTS>
${JSON.stringify(data.iqcNg ?? [], null, 2)}
</IQC_LOTS>

<INVENTORY_HEALTH>
${JSON.stringify(data.wmsHealth ?? {}, null, 2)}
</INVENTORY_HEALTH>

<EXPIRY_WARNING>
${JSON.stringify(data.expiryWarning ?? [], null, 2)}
</EXPIRY_WARNING>

<DAMAGE_CLAIMS>
${JSON.stringify(data.damageClaims ?? {}, null, 2)}
</DAMAGE_CLAIMS>

用户问题: ${question}

请用中文回答，直接回复，不要返回JSON格式。
如果数据不足以回答，请明确说明需要哪些补充信息。`;
}

// ── CLI ─────────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "patrol":
    patrolCycle().catch(e => { console.error(e); process.exit(1); });
    break;
  case "morning":
    morningDigest().catch(e => { console.error(e); process.exit(1); });
    break;
  case "watch":
    watch(Number(args[0] ?? 30)).catch(e => { console.error(e); process.exit(1); });
    break;
  case "bus-watch":
    busWatchLoop().catch(e => { log("FATAL", e.message); process.exit(1); });
    break;
  case "iqc-cycle":
    patrolCycle().catch(e => { console.error(e); process.exit(1); });
    break;
    case "eval": {
      // Score recent unevaluated Ornith decisions with judge LLM
      const limit = Number(args[0] ?? 20);
      log("INFO", `Scoring up to ${limit} recent decisions...`);
      const out = await run([EVAL_SCRIPT, "score-recent", "--limit", String(limit)]);
      log("INFO", `Evaluation complete: ${out.trim()}`);
      break;
    }
    case "report": {
      // Generate performance report for last N days
      const days = Number(args[0] ?? 7);
      log("INFO", `Generating performance report (last ${days} days)...`);
      const out = await run([EVAL_SCRIPT, "report", "--days", String(days)]);
      const report = JSON.parse(out);
      const o = report.overall;
      const total = Number(o.total_decisions) || 0;
      const rated = Number(o.rated) || 0;
      const correct = Number(o.correct) || 0;
      const accuracy = rated > 0 ? Math.round(100 * correct / rated) : null;
      const msg = [
        `📊 Ornith AI 准确率报告 (近${days}天)`,
        `━━━━━━━━━━━━━━━━━━`,
        `总决策: ${total} | 自动: ${Number(o.auto_decisions)||0}`,
        `已评分: ${rated}${accuracy !== null ? ` | 准确率: ${accuracy}%` : ' | N/A'}`,
        correct > 0 ? `✅ 正确: ${correct}` : null,
        Number(o.incorrect) > 0 ? `❌ 错误: ${o.incorrect}` : null,
        Number(o.partial) > 0 ? `⚠️ 部分正确: ${o.partial}` : null,
        `━━━━━━━━━━━━━━━━━━`,
      ].filter(Boolean).join("\n");
      await sendLINE(msg);
      log("INFO", msg);
      break;
    }
    case "ask": {
      // Interactive Q&A: node wms-manager.js ask "What is the IQC status?"
      const question = args.join(" ");
      if (!question) {
        console.error("Usage: node wms-manager.js ask \"<question>\"");
        process.exit(1);
      }
      log("INFO", `Q: ${question}`);
      try {
        // Fetch fresh context data
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
    console.log(`WMS AI Manager
Usage: node wms-manager.js <command>

Commands:
  patrol     — Run one patrol analysis cycle
  morning    — Send morning digest to LINE
  watch      — Continuous patrol loop (default 30min)
  bus-watch  — Continuous message listener (poll every 30s)
  iqc-cycle  — Same as patrol
  eval [N]   — Score recent Ornith decisions (default: 20)
  report [N] — Show performance report (default: 7 days)
  ask "Q"    — Ask a question (enclosed in quotes)
`);
}
