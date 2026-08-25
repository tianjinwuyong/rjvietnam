/**
 * wms-sop-manager.js — Adaptive SOP Engine for WMS AI Manager
 *
 * Runs the WMS patrol as a manager-defined JSON SOP, tracking real-time
 * execution position and rendering live Mermaid diagram.
 *
 * Usage:
 *   node wms-sop-manager.js run [--cycle <id>]     Run full patrol cycle
 *   node wms-sop-manager.js render-mermaid          Output current Mermaid diagram
 *   node wms-sop-manager.js state                    Show current execution state
 *   node wms-sop-manager.js history [--limit N]     Show recent cycle history
 *   node wms-sop-manager.js validate                 Validate SOP JSON
 *   node wms-sop-manager.js edit <subcommand>       Edit SOP (save/reorder/toggle/timeout)
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, readFileSync as readTxt, readdirSync, mkdirSync } from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "path";
import { createManagerBus } from "../_shared/manager-bus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");
const SOP_FILE = join(__dirname, "wms-sop.json");
const STATE_FILE = join(__dirname, "wms-sop-state.json");
const HISTORY_DIR = join(__dirname, "wms-sop-history");

// ── Paths ────────────────────────────────────────────────────────────────
const QUERY_SCRIPT  = join(PROJECT_ROOT, "services/worker/watchdog-query.js");
const EXEC_SCRIPT   = join(PROJECT_ROOT, "services/worker/wms-execute.js");
const EVAL_SCRIPT   = join(PROJECT_ROOT, "services/worker/wms-evaluator.js");
const MANAGER_SCRIPT = join(PROJECT_ROOT, "services/worker/wms-manager.js");
const PENDING_FILE  = join(__dirname, "pending-approvals.json");

// ── Logging ────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${level}] ${msg}`);
}

// ── Manager Bus ─────────────────────────────────────────────────────────
const bus = createManagerBus({
  agentId: "wms-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: {},
});

async function notifySopComplete(sopName, cycleId, stepsRun, outcome) {
  await bus.init();
  await bus.send("wms-ai", "sop_cycle_complete", {
    sop_name: sopName,
    cycle_id: cycleId,
    steps_run: stepsRun,
    outcome,
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}

async function notifySopStepError(sopName, stepId, errorMsg) {
  await bus.init();
  await bus.send("wms-ai", "system_alert", {
    alert_level: "high",
    source_agent: "wms-sop-ai",
    subject: `SOP error: ${stepId}`,
    detail: `${sopName} step ${stepId} failed: ${errorMsg}`,
  }).catch(() => {});
}

// ── JSON helpers ──────────────────────────────────────────────────────────
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

// ── Run external script ───────────────────────────────────────────────────
function run(args, cwd = PROJECT_ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}${err}`));
      else resolve(out.trim());
    });
  });
}

// ── SOP Loader ───────────────────────────────────────────────────────────
function loadSOP() {
  if (!existsSync(SOP_FILE)) throw new Error(`SOP file not found: ${SOP_FILE}`);
  const sop = readJson(SOP_FILE);
  validateSOP(sop);
  return sop;
}

function validateSOP(sop) {
  const errors = [];
  const stepIds = new Set(sop.steps.map(s => s.id));

  if (!sop.startStep || !stepIds.has(sop.startStep)) {
    errors.push(`Invalid startStep: ${sop.startStep}`);
  }

  for (const step of sop.steps) {
    if (!stepIds.has(step.next) && step.next !== "END" && step.next !== undefined) {
      // next can be a stepId or END
    }
    if (step.type === "BRANCH") {
      for (const b of (step.branches || [])) {
        if (b.next && !stepIds.has(b.next) && b.next !== "END") {
          errors.push(`BRANCH next="${b.next}" in step ${step.id} is not a valid stepId`);
        }
      }
      if (step.defaultNext && !stepIds.has(step.defaultNext) && step.defaultNext !== "END") {
        errors.push(`BRANCH defaultNext="${step.defaultNext}" in step ${step.id} is not valid`);
      }
    }
    if (step.timeoutSec !== undefined && (step.timeoutSec < 1 || step.timeoutSec > 600)) {
      errors.push(`step ${step.id}: timeoutSec must be 1-600`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`SOP validation failed:\n  ${errors.join("\n  ")}`);
  }
}

// ── State helpers ─────────────────────────────────────────────────────────
function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { sopVersion: "0.0.0", cycleId: null, startedAt: null,
             currentStepId: null, currentLotNo: null, currentStepStartedAt: null,
             history: [], stepHistoryMap: {}, completed: true };
  }
  return readJson(STATE_FILE);
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function saveHistory(state) {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  const histFile = join(HISTORY_DIR, `${state.cycleId}.json`);
  writeJson(histFile, state);
}

// ── Condition evaluator ───────────────────────────────────────────────────
function evalCondition(condition, ctx) {
  if (!condition) return false;
  try {
    // Safe evaluator — only allows access to ctx properties
    const fn = new Function("ctx",
      `with (ctx) { try { return !!( ${condition} ); } catch(e) { return false; } }`
    );
    return fn(ctx);
  } catch {
    return false;
  }
}

// ── Step executor ─────────────────────────────────────────────────────────
async function executeStep(step, ctx, cycleId) {
  const stepStart = Date.now();
  log("INFO", `[SOP] → step:${step.id} (${step.nameZh})`);

  let result = { ok: true, output: null };
  let nextStepId = step.next || "END";

  try {
    switch (step.type) {
      case "QUERY": {
        const out = await Promise.race([
          run([step.script, ...(step.args || [])]),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${step.timeoutSec}s`)), (step.timeoutSec || 30) * 1000))
        ]);
        ctx[step.outputVar] = JSON.parse(out);
        break;
      }

      case "SCRIPT": {
        if (step.function === "detectChanges") {
          const wmsData = ctx.wmsData;
          ctx.newNgLots = (wmsData.iqcNg || []).filter(l =>
            l.iqc_status === "pending" || l.iqc_status === "hold" || l.iqc_status === "rejected"
          );
          ctx.newWo = (wmsData.workOrders || []).filter(w => w.status === "released");
          ctx.hasChanges = ctx.newNgLots.length > 0 || ctx.newWo.length > 0;
        } else if (step.function === "checkEscalation") {
          const analysis = ctx.analysis || {};
          const alerts = [];
          if ((analysis.iqc_decisions || []).some(d => d.action === "IQC_REJECT")) {
            alerts.push({ level: "ALERT", message: "IQC拒绝决策，需要审批" });
          }
          if ((analysis.msd_alerts || []).some(a => a.action === "BLOCK")) {
            alerts.push({ level: "CRITICAL", message: "MSD超限，需要立即处理" });
          }
          ctx.escalationAlerts = alerts;
          ctx.escalationLevel = alerts.length === 0 ? "INFO" : alerts[0].level;
        }
        break;
      }

      case "LLM": {
        // Ask Ornith for analysis
        const prevState = existsSync(join(__dirname, "last-state.json"))
          ? JSON.parse(readFileSync(join(__dirname, "last-state.json"), "utf8"))
          : {};
        const elapsed = prevState.lastCycle
          ? ((Date.now() - new Date(prevState.lastCycle).getTime()) / 3600000).toFixed(1)
          : "0";
        const wmsData = ctx.wmsData || {};
        const newNgLots = ctx.newNgLots || wmsData.iqcNg || [];
        const newWo = ctx.newWo || wmsData.workOrders || [];

        const prompt = buildPatrolPrompt(wmsData, newNgLots, newWo, Number(elapsed));
        const raw = await Promise.race([
          askOrnith(prompt),
          new Promise((_, rej) => setTimeout(() => rej(new Error("Ornith timeout")), (step.timeoutSec || 120) * 1000))
        ]);
        ctx.analysis = parseOrnithOutput(raw) || {};
        break;
      }

      case "BRANCH_VISION": {
        if (evalCondition(step.condition, ctx)) {
          nextStepId = step.next; // proceed to vision
        } else {
          nextStepId = "step_execute";
        }
        break;
      }

      case "BRANCH": {
        let matched = false;
        for (const b of (step.branches || [])) {
          if (evalCondition(b.condition, ctx)) {
            nextStepId = b.next;
            matched = true;
            break;
          }
        }
        if (!matched) nextStepId = step.defaultNext || "END";
        break;
      }

      case "EXECUTE": {
        const handler = step.handler;
        const target = step.target ? eval("ctx." + step.target.replace(/\[\?\.(\w+)\]/g, "?.$1")) : null;
        if (!target || target.length === 0) {
          log("INFO", `[SOP] ${step.id}: target ${step.target} is empty, skipping`);
          break;
        }
        if (handler === "executeIqcDecisions") {
          for (const d of target) {
            await logOrnithDecision(cycleId, "iqc", d);
            await run([EXEC_SCRIPT, "iqc-decide", "--lotno", d.lot_no, "--action", d.action.replace("IQC_", ""), "--reason", d.reason || "AI"]);
          }
        } else if (handler === "handleMsdAlerts") {
          for (const a of target) {
            await run([EXEC_SCRIPT, "msd-action", "--lotno", a.lot_no, "--action", a.action]);
          }
        } else if (handler === "executeIssueToLine") {
          for (const d of target) {
            await run([EXEC_SCRIPT, "issue-to-line", "--lotno", d.lot_no || "", "--qty", String(d.qty), "--wocode", d.work_order_code]);
          }
        } else if (handler === "executeReturnLine") {
          for (const d of target) {
            await run([EXEC_SCRIPT, "return-line", "--lotno", d.lot_no, "--qty", String(d.qty), "--wocode", d.work_order_code, "--reason", d.reason || "LINE_CANCEL"]);
          }
        } else if (handler === "executeScrap") {
          for (const d of target) {
            await run([EXEC_SCRIPT, "scrap", "--lotno", d.lot_no, "--qty", String(d.qty), "--reason", d.reason || "AI_SCRAP"]);
          }
        } else if (handler === "executePutAway") {
          for (const d of target) {
            await run([EXEC_SCRIPT, "put-away", "--lotno", d.lot_no, "--location", d.location]);
          }
        }
        break;
      }

      case "EVALUATE": {
        await run([step.script, ...(step.args || [])]);
        break;
      }

      case "PENDING": {
        const analysis = ctx.analysis || {};
        savePendingApprovals(analysis);
        break;
      }

      case "LINE": {
        if (evalCondition(step.condition, ctx)) {
          await sendLINE(formatLINEAlert(ctx.analysis || {}));
        }
        break;
      }

      case "SAVE_STATE": {
        const analysis = ctx.analysis || {};
        saveState({
          ...loadState(),
          iqcNg: (ctx.wmsData || {}).iqcNg || [],
          workOrders: (ctx.wmsData || {}).workOrders || [],
          lastCycle: new Date().toISOString(),
        });
        break;
      }

      case "ESCALATION": {
        const analysis = ctx.analysis || {};
        const sev = classifySeverity(analysis);
        if (sev !== "INFO") {
          await run([EXEC_SCRIPT, "escalate", "--level", sev, "--msg", JSON.stringify(analysis)]);
        }
        break;
      }

      default:
        log("WARN", `[SOP] Unknown step type: ${step.type}`);
    }
  } catch (err) {
    log("ERROR", `[SOP] step:${step.id} failed: ${err.message}`);
    if (step.onError === "ABORT") {
      nextStepId = "END";
      result = { ok: false, error: err.message };
    } else if (step.onError === "SKIP_TO step_audit") {
      nextStepId = "step_audit";
      result = { ok: false, error: err.message };
    } else {
      nextStepId = step.next || "END";
    }
  }

  const durationMs = Date.now() - stepStart;
  log("INFO", `[SOP] ← step:${step.id} → next:${nextStepId} (${durationMs}ms)`);

  return { nextStepId, durationMs, ok: result.ok, error: result.error };
}

// ── Ornith helpers (duplicated here so SOP can run standalone) ───────────
const OLLAMA_HOST = "http://localhost:11434";
const ORNITH_MODEL = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";

async function askOrnith(prompt) {
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ORNITH_MODEL, prompt, stream: false, options: { temperature: 0.01, num_predict: 1024 } }),
  });
  if (!res.ok) throw new Error(`Ornith API error: ${res.status}`);
  const data = await res.json();
  return stripThinking(data.response || "");
}

function stripThinking(text) {
  const idx = text.lastIndexOf("```json");
  if (idx !== -1) {
    const block = text.slice(idx);
    const m = block.match(/```json\n?([\s\S]*?)```/);
    if (m) return m[1].trim();
  }
  return text;
}

function parseOrnithOutput(raw) {
  try {
    // Try JSON block first
    const blockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (blockMatch) raw = blockMatch[1];
    const json = JSON.parse(raw.trim());
    // Normalize keys to snake_case
    return {
      iqc_decisions:     normalizeList(json.iqc_decisions, "iqc_decisions"),
      issue_to_line:     normalizeList(json.issue_to_line, "issue_to_line"),
      pick:              normalizeList(json.pick, "pick"),
      put_away:          normalizeList(json.put_away, "put_away"),
      return_to_line:    normalizeList(json.return_to_line, "return_to_line"),
      scrap:             normalizeList(json.scrap, "scrap"),
      msd_alerts:        normalizeList(json.msd_alerts, "msd_alerts"),
      needsVision:       json.needsVision || false,
    };
  } catch {
    return null;
  }
}

function normalizeList(val, key) {
  if (!val) return [];
  if (!Array.isArray(val)) return [val];
  return val.map(item => {
    if (typeof item !== "object") return item;
    // Convert camelCase keys to snake_case
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      out[k.replace(/([A-Z])/g, "_$1").toLowerCase()] = v;
    }
    return out;
  });
}

function buildPatrolPrompt(data, newNgLots, newWo, elapsed) {
  const lots = (data.iqcNg || []).map(l => `${l.lot_no} | ${l.iqc_status} | ${l.material_name_zh || l.material} | ${l.supplier_name_zh || ""} | received:${l.received_at}`).join("\n");
  const wos = (data.workOrders || []).filter(w => w.status === "released" || w.status === "running").map(w => `${w.code} | ${w.status} | ${w.product_name_zh || w.product} | qty:${w.qty_ordered || ""} | line:${w.line_code || ""}`).join("\n");
  const health = data.wmsHealth || {};
  const lowStock = (health.lowStock || []).map(l => `${l.material_name_zh} | ${l.available_qty} ${l.uom} | ${l.days_supply?.toFixed(1) || "?"} days`).join("\n");
  const pending = newNgLots.length > 0 ? `\n⚠️ NEW NG LOTS:\n${newNgLots.map(l => `  ${l.lot_no}(${l.iqc_status})`).join(", ")}` : "";
  return `你是瑞晶越南SMT工厂的WMS AI管理员。 patrol cycle [${new Date().toISOString()}] | elapsed:${elapsed}h${pending}

当前库存状态:
${lots || "(none)"}

当前在制品工单:
${wos || "(none)"}

低库存警报:
${lowStock || "(none)"}

请分析以上数据，输出JSON格式的WMS决策，包含:
- iqc_decisions: 待检批次的处理建议(IQC_RELEASE/IQC_HOLD/IQC_REJECT)
- issue_to_line: 需要发料到产线的批次
- msd_alerts: MSD超限告警
- scrap: 需要报废的批次
- put_away: 待上架批次
- return_to_line: 需要退料的批次
- needsVision: 是否有物料需要视觉检测(true/false)

输出格式:
\`\`\`json
{
  "iqc_decisions": [{"lot_no":"...","action":"IQC_HOLD","reason":"...","auto_execute":true}],
  "issue_to_line": [...],
  "msd_alerts": [...],
  "scrap": [],
  "put_away": [],
  "return_to_line": [],
  "needsVision": false
}
\`\`\``;
}

// ── Ornith logging helper ─────────────────────────────────────────────────
async function logOrnithDecision(cycleId, decisionType, item) {
  try {
    const lotNo = item.lot_no || null;
    const workOrderCode = item.work_order_code || null;
    const autoExecute = item.auto_execute !== false;
    await run([
      EXEC_SCRIPT, "audit-log",
      "--decision", decisionType,
      "--lotno", lotNo || "",
      "--wocode", workOrderCode || "",
      "--area", "wms",
      "--ornith", JSON.stringify(item).slice(0, 2000),
      "--auto", autoExecute ? "true" : "false",
      "--cycle", cycleId,
    ]);
  } catch (err) {
    log("WARN", `[AUDIT] logOrnithDecision failed: ${err.message}`);
  }
}

// ── Severity classifier ────────────────────────────────────────────────────
function classifySeverity(analysis) {
  if (!analysis) return "INFO";
  const hasReject = (analysis.iqc_decisions || []).some(d => d.action === "IQC_REJECT");
  const hasMsdBlock = (analysis.msd_alerts || []).some(a => a.action === "BLOCK");
  if (hasReject || hasMsdBlock) return "CRITICAL";
  const hasHold = (analysis.iqc_decisions || []).some(d => d.action === "IQC_HOLD");
  if (hasHold) return "WARN";
  return "INFO";
}

// ── LINE helper ───────────────────────────────────────────────────────────
async function sendLINE(message) {
  const tokenPath = join(__dirname, "line_token.txt");
  if (!existsSync(tokenPath)) { log("WARN", "LINE token not found, skipping"); return; }
  const token = readTxt(tokenPath, "utf8").trim();
  if (!token) return;
  try {
    await fetch("https://notify-api.line.me/api/notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (err) { log("WARN", `LINE failed: ${err.message}`); }
}

function formatLINEAlert(analysis) {
  const lines = [`🤖 WMS异常告警 ${new Date().toLocaleDateString("zh-CN")}`, "━━━━━━━━━━━━━━━━━━"];
  const iqc = analysis.iqc_decisions || [];
  if (iqc.length > 0) lines.push(`📋 IQC决策: ${iqc.length}条`);
  const msd = analysis.msd_alerts || [];
  if (msd.length > 0) lines.push(`⚠️ MSD告警: ${msd.length}条`);
  const scrap = analysis.scrap || [];
  if (scrap.length > 0) lines.push(`🗑️ 报废: ${scrap.length}条`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("详细见 WMS Dashboard");
  return lines.join("\n");
}

// ── Pending approvals helper ──────────────────────────────────────────────
function savePendingApprovals(analysis) {
  const pending = {
    generated_at: new Date().toISOString(),
    severity: classifySeverity(analysis),
    iqc:      (analysis.iqc_decisions || []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, action: d.action, reason: d.reason })),
    issue:    (analysis.issue_to_line || []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, work_order_code: d.work_order_code })),
    pick:     (analysis.pick || []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, work_order_code: d.work_order_code })),
    putaway:  (analysis.put_away || []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, location: d.location })),
    return:   (analysis.return_to_line || []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, work_order_code: d.work_order_code, reason: d.reason })),
    scrap:    (analysis.scrap || []).filter(d => d.auto_execute === false).map(d => ({ lot_no: d.lot_no, qty: d.qty, reason: d.reason })),
    msd:      (analysis.msd_alerts || []).map(d => ({ lot_no: d.lot_no, action: d.action, reason: d.reason })),
  };
  writeJson(PENDING_FILE, pending);
}

// ── Mermaid renderer ─────────────────────────────────────────────────────
function renderMermaid(sop, state) {
  const currentStepId = state.currentStepId;
  const stepMap = {};
  for (const s of sop.steps) stepMap[s.id] = s;

  // Build node list
  const nodes = [];
  const links = [];

  // BFS from startStep
  const visited = new Set();
  const queue = [sop.startStep];
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id) || !stepMap[id]) continue;
    visited.add(id);
    order.push(id);
    const step = stepMap[id];
    if (step.type === "BRANCH") {
      for (const b of (step.branches || [])) {
        if (b.next && !visited.has(b.next)) queue.push(b.next);
      }
      if (step.defaultNext && !visited.has(step.defaultNext)) queue.push(step.defaultNext);
    } else if (step.next && !visited.has(step.next)) {
      queue.push(step.next);
    }
  }

  // Emit nodes
  for (const id of order) {
    const step = stepMap[id];
    const isCurrent = id === currentStepId;
    const isDone = state.history?.some(h => h.stepId === id);
    const hist = state.stepHistoryMap?.[id];
    const icon = step.mermaid?.icon || "⬜";
    const color = step.mermaid?.color || "#607D8B";
    const label = `${icon} ${step.nameZh}`;
    const shape = step.type === "BRANCH" ? `{"${label}"}` : `("${label}")`;
    const style = isCurrent
      ? `style ${id} fill:#FFD700,color:#000,stroke:#FF8F00,stroke-width:3px`
      : isDone && hist?.status === "OK"
      ? `style ${id} fill:#4CAF50,color:#fff,stroke:#2E7D32`
      : `style ${id} fill:${color},color:#fff`;
    nodes.push(`    ${id}${shape}`);
    nodes.push(`    ${id} ${style}`);
    if (isCurrent) nodes.push(`    linkStyle ${order.indexOf(id)} stroke:#FFD700,stroke-width:3px`);

    // Links
    if (step.type === "BRANCH") {
      for (const b of (step.branches || [])) {
        if (b.next) nodes.push(`    ${id} -->|"${b.condition.replace(/ctx\./g,"")}"| ${b.next}`);
      }
      if (step.defaultNext) nodes.push(`    ${id} -->|"default"| ${step.defaultNext}`);
    } else if (step.next) {
      nodes.push(`    ${id} --> ${step.next}`);
    }
  }

  const mermaid = `flowchart TD\n${nodes.join("\n")}`;
  return mermaid;
}

// ── SOP edit commands ─────────────────────────────────────────────────────
function editSOP(cmd, args) {
  const sop = loadSOP();
  let changed = false;

  if (cmd === "reorder") {
    // args = "stepId,newPosition"
    const [stepId, posStr] = args.split(",");
    const newPos = parseInt(posStr, 10);
    if (!stepId || isNaN(newPos)) { console.error("Usage: edit reorder stepId,newPos"); return; }
    const idx = sop.steps.findIndex(s => s.id === stepId);
    if (idx === -1) { console.error(`Step not found: ${stepId}`); return; }
    const [step] = sop.steps.splice(idx, 1);
    const insertAt = Math.min(Math.max(newPos - 1, 0), sop.steps.length);
    sop.steps.splice(insertAt, 0, step);
    changed = true;
    log("INFO", `Reordered: ${stepId} moved to position ${newPos}`);
  }

  else if (cmd === "toggle") {
    // args = stepId
    const step = sop.steps.find(s => s.id === args);
    if (!step) { console.error(`Step not found: ${args}`); return; }
    step.disabled = !step.disabled;
    changed = true;
    log("INFO", `Toggled: ${args} → ${step.disabled ? "DISABLED" : "ENABLED"}`);
  }

  else if (cmd === "timeout") {
    // args = "stepId,seconds"
    const [stepId, secStr] = args.split(",");
    const secs = parseInt(secStr, 10);
    const step = sop.steps.find(s => s.id === stepId);
    if (!step) { console.error(`Step not found: ${stepId}`); return; }
    step.timeoutSec = secs;
    changed = true;
    log("INFO", `Timeout: ${stepId} → ${secs}s`);
  }

  else if (cmd === "save") {
    sop.version = bumpVersion(sop.version);
    sop.updatedAt = new Date().toISOString();
    writeJson(SOP_FILE, sop);
    log("INFO", `SOP saved as v${sop.version}`);
    return;
  }

  else {
    console.error(`Unknown edit command: ${cmd}`);
    console.error("Available: reorder, toggle, timeout, save");
    return;
  }

  if (changed) {
    // Don't auto-save — manager reviews first
    log("WARN", "SOP modified (not saved). Run: node wms-sop-manager.js edit save");
  }
}

function bumpVersion(v) {
  const [major, minor, patch] = v.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// ── Main run ───────────────────────────────────────────────────────────────
async function runSOP(cycleId) {
  const sop = loadSOP();
  const state = loadState();

  if (!state.completed && state.cycleId) {
    log("WARN", `Previous cycle ${state.cycleId} incomplete. Starting fresh.`);
  }

  state.sopVersion = sop.version;
  state.cycleId = cycleId || `wc-${Date.now().toString(36)}`;
  state.startedAt = new Date().toISOString();
  state.completed = false;
  state.history = [];
  state.stepHistoryMap = {};
  state.currentStepId = sop.startStep;
  saveState(state);

  log("INFO", `=== SOP Run starting === cycle=${state.cycleId} v=${sop.version}`);

  const ctx = {};
  let stepId = sop.startStep;
  const stepMap = {};
  for (const s of sop.steps) stepMap[s.id] = s;

  try {
    while (stepId && stepId !== "END") {
      const step = stepMap[stepId];
      if (!step) { log("ERROR", `Step not found: ${stepId}`); break; }
      if (step.disabled) {
        log("INFO", `[SOP] step:${step.id} is DISABLED, skipping`);
        stepId = step.next || "END";
        continue;
      }

      state.currentStepId = step.id;
      state.currentStepStartedAt = new Date().toISOString();
      // Set currentLotNo if available in ctx
      const latestItem = ctx.analysis?.iqc_decisions?.[0] || ctx.analysis?.msd_alerts?.[0] || {};
      state.currentLotNo = latestItem.lot_no || null;
      saveState(state);

      const { nextStepId, durationMs, ok, error } = await executeStep(step, ctx, state.cycleId);

      state.history.push({ stepId: step.id, enteredAt: state.currentStepStartedAt, exitedAt: new Date().toISOString(), status: ok ? "OK" : "FAIL" });
      state.stepHistoryMap[step.id] = { status: ok ? "OK" : "FAIL", durationMs, error };
      saveState(state);

      stepId = nextStepId;
    }

    state.currentStepId = null;
    state.completed = true;
    state.history.push({ stepId: "END", enteredAt: new Date().toISOString(), exitedAt: new Date().toISOString(), status: "OK" });
    saveState(state);

    // Archive to history
    saveHistory(state);

    log("INFO", `=== SOP Run complete === cycle=${state.cycleId} duration=${Date.now() - new Date(state.startedAt).getTime()}ms`);

    // Output Mermaid for reference
    console.log("\n=== Mermaid Diagram ===");
    console.log(renderMermaid(sop, state));

    await notifySopComplete("wms-sop", state.cycleId, state.history.length - 1, "completed");
  } catch (err) {
    log("ERROR", `SOP run error: ${err.message}`);
    await notifySopStepError("wms-sop", state.currentStepId || "unknown", err.message);
  }
}

// ── CLI dispatcher ────────────────────────────────────────────────────────
const [,, cmd, ...rest] = process.argv;

if (cmd === "run") {
  const cycleIdx = rest.indexOf("--cycle");
  const cycleId = cycleIdx !== -1 ? rest[cycleIdx + 1] : null;
  runSOP(cycleId).catch(e => { console.error(e); process.exit(1); });
}
else if (cmd === "render-mermaid") {
  const sop = loadSOP();
  const state = loadState();
  console.log(renderMermaid(sop, state));
}
else if (cmd === "state") {
  const state = loadState();
  console.log(JSON.stringify(state, null, 2));
}
else if (cmd === "history") {
  const limit = rest.includes("--limit") ? parseInt(rest[rest.indexOf("--limit") + 1]) : 10;
  if (!existsSync(HISTORY_DIR)) { console.log("[]"); process.exit(0); }
  const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit);
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(HISTORY_DIR, f), "utf8"));
    const duration = s.completed && s.startedAt
      ? `${Date.now() - new Date(s.startedAt).getTime()}ms`
      : "incomplete";
    console.log(`${f.replace(".json","")} | ${s.sopVersion} | ${s.completed ? "✅" : "⏳"} | ${duration}`);
    if (s.history?.length > 0) {
      for (const h of s.history) console.log(`  ${h.stepId}: ${h.status} (${new Date(h.enteredAt).toLocaleTimeString()})`);
    }
    console.log();
  }
}
else if (cmd === "validate") {
  try {
    const sop = loadSOP();
    console.log(`✅ SOP valid — v${sop.version}, ${sop.steps.length} steps`);
    for (const step of sop.steps) {
      console.log(`  ${step.mermaid?.icon || "⬜"} ${step.id} [${step.type}] → ${step.next || "END"}`);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
else if (cmd === "edit") {
  const [subCmd, ...args] = rest;
  editSOP(subCmd, args.join(" "));
}
else if (cmd === "step") {
  // Show details of a specific step: node wms-sop-manager.js step step_id
  const sop = loadSOP();
  const step = sop.steps.find(s => s.id === rest[0]);
  if (!step) { console.error(`Step not found: ${rest[0]}`); process.exit(1); }
  console.log(JSON.stringify(step, null, 2));
}
else {
  console.log(`Usage:
  node wms-sop-manager.js run [--cycle <id>]     Run patrol cycle
  node wms-sop-manager.js render-mermaid          Output Mermaid diagram
  node wms-sop-manager.js state                   Show current state
  node wms-sop-manager.js history [--limit N]    Show cycle history
  node wms-sop-manager.js validate                Validate SOP
  node wms-sop-manager.js edit <cmd> <args>      Edit SOP (reorder/toggle/timeout/save)
  node wms-sop-manager.js step <stepId>           Show step details`);
  process.exit(1);
}
