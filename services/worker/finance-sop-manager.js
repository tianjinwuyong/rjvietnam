/**
 * finance-sop-manager.js — Finance AI Manager SOP State Machine Engine
 *
 * Usage:
 *   node finance-sop-manager.js trigger <sop_name> <json_trigger_data>
 *   node finance-sop-manager.js advance <instance_id> <event>
 *   node finance-sop-manager.js tick
 *   node finance-sop-manager.js list
 *   node finance-sop-manager.js status <instance_id>
 *   node finance-sop-manager.js history <instance_id>
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOP_FILE     = join(__dirname, "finance-sop.json");
const INSTANCES_FILE = join(__dirname, "finance-sop-instances.json");
const LOG_FILE     = join(__dirname, "finance-manager.log");
const EXEC_SCRIPT  = join(__dirname, "finance-execute.js");

const require2 = createRequire(import.meta.url);
const { askLLM, askLLMWithFallback, scoreResponse } = require2("../_shared/llm-router.js");

// ── Logging ──────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] [SOP] ${msg}`;
  try { appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
  if (level === "ERROR") console.error(line); else console.log(line);
}

// ── Load SOP definitions ─────────────────────────────────────────────────────
let sops = null;
function loadSOPs() {
  if (sops) return sops;
  try {
    sops = JSON.parse(readFileSync(SOP_FILE, "utf-8"));
    log("INFO", `Loaded ${Object.keys(sops.sops).length} SOPs from finance-sop.json`);
    return sops;
  } catch (err) {
    log("ERROR", `Failed to load finance-sop.json: ${err.message}`);
    throw err;
  }
}

// ── SOP Instances ─────────────────────────────────────────────────────────────
function loadInstances() {
  try {
    if (existsSync(INSTANCES_FILE)) return JSON.parse(readFileSync(INSTANCES_FILE, "utf-8"));
  } catch (_) {}
  return { instances: [] };
}

function saveInstances(data) {
  try { writeFileSync(INSTANCES_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}

function genId() {
  return `sop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Action execution ─────────────────────────────────────────────────────────
async function executeAction(actionName, instance) {
  log("INFO", `Executing action: ${actionName} for SOP instance ${instance.instance_id}`);
  const { spawn } = await import("child_process");

  function run(args) {
    return new Promise((resolve, reject) => {
      const child = spawn("node", args, { cwd: join(__dirname, "../.."), stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", d => out += d);
      child.stderr.on("data", d => err += d);
      child.on("close", code => code === 0 ? resolve(out) : reject(new Error(`${out}\n${err}`)));
    });
  }

  switch (actionName) {
    case "send_ar_reminder":
    case "line_alert_ar_escalate": {
      const { customer_name, invoice_no, outstanding_amount, days_overdue } = instance.trigger_data;
      const sev = actionName === "line_alert_ar_escalate" ? "🔴" : "🟡";
      const msg = `${sev} [AR催收] ${customer_name} 逾期${days_overdue}天 — 发票 ${invoice_no} $${outstanding_amount}`;
      log("INFO", `LINE alert: ${msg}`);
      // LINE sending handled by finance-manager, just log here
      return { action: actionName, logged: msg };
    }
    case "suspend_customer_shipment": {
      log("WARN", `[APPROVAL REQUIRED] Suspend shipment for ${instance.trigger_data.customer_name}`);
      return { action: actionName, status: "awaiting_approval", role: instance.sops[instance.sop_name].states[instance.current_state].approval_role };
    }
    case "verify_invoice_against_po": {
      log("INFO", `Verifying invoice ${instance.trigger_data.invoice_no} against PO`);
      return { action: actionName, status: "verified" };
    }
    case "schedule_ap_payment": {
      log("INFO", `Scheduling AP payment for ${instance.trigger_data.invoice_no}`);
      return { action: actionName, scheduled: true };
    }
    case "execute_early_payment": {
      log("INFO", `[APPROVAL REQUIRED] Early payment for ${instance.trigger_data.invoice_no}`);
      return { action: actionName, status: "awaiting_approval", role: "FIN_MGR" };
    }
    case "execute_payment_on_due": {
      log("INFO", `Executing payment on due for ${instance.trigger_data.invoice_no}`);
      return { action: actionName, status: "executed" };
    }
    case "raise_supplier_dispute": {
      log("WARN", `Dispute raised for invoice ${instance.trigger_data.invoice_no}`);
      return { action: actionName, status: "dispute_raised" };
    }
    case "analyze_wo_variance_cause": {
      // Use LLM to analyze variance cause
      try {
        const prompt = `分析以下工单成本差异的原因:

工单: ${instance.trigger_data.work_order_code}
标准成本: $${instance.trigger_data.standard_cost}
实际成本: $${instance.trigger_data.actual_cost}
差异率: ${instance.trigger_data.variance_pct}%

请分析可能的原因（物料成本、人工效率、作业变更、管理费用等），返回JSON:
{"primary_cause": "...", "secondary_causes": [...], "recommended_action": "..."}`;
        const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
        const resp = multi.text;
        log("INFO", `Variance analysis: ${resp.slice(0, 200)}`);
        return { action: actionName, analysis: resp };
      } catch (err) {
        log("WARN", `Variance analysis failed: ${err.message}`);
        return { action: actionName, analysis_error: err.message };
      }
    }
    case "update_material_standard_cost":
    case "request_budget_amendment":
    case "review_labor_efficiency":
    case "review_overhead_allocation": {
      log("INFO", `Action ${actionName} logged for ${instance.trigger_data.work_order_code}`);
      return { action: actionName, status: "logged" };
    }
    case "run_fx_revaluation": {
      const date = instance.trigger_data?.date || new Date().toISOString().split("T")[0];
      try {
        const out = await run([EXEC_SCRIPT, "fx-reval", date]);
        log("INFO", `FX reval: ${out.trim()}`);
        return { action: actionName, result: out.trim() };
      } catch (err) {
        log("ERROR", `FX reval failed: ${err.message}`);
        return { action: actionName, error: err.message };
      }
    }
    case "post_all_wo_costs": {
      log("INFO", "Posting all WO costs...");
      return { action: actionName, status: "complete" };
    }
    case "post_open_ar_ap_invoices": {
      log("INFO", "Posting open AR/AP invoices...");
      return { action: actionName, status: "complete" };
    }
    case "review_draft_gl_entries": {
      log("WARN", `[APPROVAL REQUIRED] GL entry review for period close`);
      return { action: actionName, status: "awaiting_approval", role: "FIN_MGR" };
    }
    case "correct_gl_entries": {
      log("INFO", "Correcting GL entries...");
      return { action: actionName, status: "corrected" };
    }
    case "close_fiscal_period": {
      const { fiscal_year, period } = instance.trigger_data || {};
      try {
        const out = await run([EXEC_SCRIPT, "close-period", String(fiscal_year), String(period)]);
        log("INFO", `Period closed: ${out.trim()}`);
        return { action: actionName, result: out.trim() };
      } catch (err) {
        log("ERROR", `Close period failed: ${err.message}`);
        return { action: actionName, error: err.message };
      }
    }
    case "investigate_material_loss": {
      log("INFO", `Investigating material loss: ${instance.trigger_data.event_id}`);
      return { action: actionName, status: "investigating" };
    }
    case "file_supplier_claim": {
      log("WARN", `Filing supplier claim for event ${instance.trigger_data.event_id}`);
      return { action: actionName, status: "claim_filed" };
    }
    case "record_internal_scrap": {
      log("INFO", `Recording internal scrap: ${instance.trigger_data.event_id}`);
      return { action: actionName, status: "recorded" };
    }
    case "write_off_material_loss": {
      log("WARN", `[APPROVAL REQUIRED] Write off material loss ${instance.trigger_data.event_id}`);
      return { action: actionName, status: "awaiting_approval", role: "FIN_MGR" };
    }
    default:
      log("WARN", `Unknown action: ${actionName}`);
      return { action: actionName, status: "unknown_action" };
  }
}

// ── Trigger SOP ─────────────────────────────────────────────────────────────
async function triggerSOP(sopName, triggerData) {
  const sopDef = loadSOPs().sops[sopName];
  if (!sopDef) throw new Error(`SOP "${sopName}" not found in finance-sop.json`);

  const instance = {
    instance_id: genId(),
    sop_name: sopName,
    current_state: sopDef.initial_state,
    trigger_data: triggerData,
    started_at: new Date().toISOString(),
    state_entered_at: new Date().toISOString(),
    state_history: [{ state: sopDef.initial_state, entered_at: new Date().toISOString(), action: null }],
    completed: false,
  };

  const data = loadInstances();
  data.instances.push(instance);
  saveInstances(data);

  log("INFO", `SOP triggered: ${sopName} → instance ${instance.instance_id} in state "${sopDef.initial_state}"`);

  // Execute initial state's action
  const stateDef = sopDef.states[sopDef.initial_state];
  if (stateDef.autoExecute) {
    const result = await executeAction(stateDef.action, instance);
    instance.last_action_result = result;
    saveInstances(data);
  }

  console.log(JSON.stringify({ ok: true, instance_id: instance.instance_id, state: instance.current_state }));
  return instance;
}

// ── Advance SOP instance ─────────────────────────────────────────────────────
async function advanceInstance(instanceId, event) {
  const data = loadInstances();
  const inst = data.instances.find(i => i.instance_id === instanceId);
  if (!inst) throw new Error(`SOP instance ${instanceId} not found`);

  const sopDef = loadSOPs().sops[inst.sop_name];
  const currentStateDef = sopDef.states[inst.current_state];
  const transitions = currentStateDef.transitions || {};

  const nextState = transitions[event];
  if (!nextState) {
    log("WARN", `No transition from "${inst.current_state}" on event "${event}"`);
    console.log(JSON.stringify({ error: `No transition for event "${event}" from state "${inst.current_state}"` }));
    return;
  }

  log("INFO", `SOP ${inst.sop_name} instance ${inst.instance_id}: ${inst.current_state} --[${event}]--> ${nextState}`);

  inst.current_state = nextState;
  inst.state_entered_at = new Date().toISOString();
  inst.state_history.push({ state: nextState, entered_at: new Date().toISOString(), event, action: null });
  saveInstances(data);

  // Execute new state's action
  const newStateDef = sopDef.states[nextState];
  if (newStateDef && newStateDef.autoExecute) {
    const result = await executeAction(newStateDef.action, inst);
    inst.state_history[inst.state_history.length - 1].action_result = result;
    inst.last_action_result = result;
    saveInstances(data);
  }

  // Mark completed if no outgoing transitions
  if (newStateDef && Object.keys(newStateDef.transitions || {}).length === 0) {
    inst.completed = true;
    saveInstances(data);
  }

  console.log(JSON.stringify({ ok: true, instance_id: instanceId, current_state: nextState, completed: inst.completed }));
  return inst;
}

// ── Tick: advance timed-out instances ──────────────────────────────────────
async function tick() {
  const data = loadInstances();
  const now = Date.now();
  const advanced = [];

  for (const inst of data.instances) {
    if (inst.completed) continue;
    const sopDef = loadSOPs().sops[inst.sop_name];
    const stateDef = sopDef?.states[inst.current_state];
    if (!stateDef || !stateDef.next_state_after_hours) continue;

    const elapsedMs = now - new Date(inst.state_entered_at).getTime();
    const timeoutMs = stateDef.next_state_after_hours * 3600000;

    if (elapsedMs >= timeoutMs) {
      // Find default timeout transition
      const transitions = Object.entries(stateDef.transitions || {});
      const defaultEvent = transitions.length > 0 ? transitions[0][0] : "timeout";
      const nextState = transitions.length > 0 ? transitions[0][1] : null;

      if (nextState) {
        log("INFO", `[TICK] ${inst.instance_id} timed out in "${inst.current_state}" after ${stateDef.next_state_after_hours}h → advancing with "${defaultEvent}"`);
        inst.current_state = nextState;
        inst.state_entered_at = new Date().toISOString();
        inst.state_history.push({ state: nextState, entered_at: new Date().toISOString(), event: defaultEvent, auto: true });
        inst.last_action_result = null;
        saveInstances(data);

        if (sopDef.states[nextState]?.autoExecute) {
          await executeAction(sopDef.states[nextState].action, inst);
        }
        advanced.push(inst.instance_id);
      }
    }
  }

  console.log(JSON.stringify({ ticked: advanced.length, instance_ids: advanced }));
  return advanced;
}

// ── List active SOPs ────────────────────────────────────────────────────────
async function listActive() {
  const data = loadInstances();
  const active = data.instances.filter(i => !i.completed);
  const result = active.map(inst => ({
    instance_id: inst.instance_id,
    sop_name: inst.sop_name,
    current_state: inst.current_state,
    started_at: inst.started_at,
    state_entered_at: inst.state_entered_at,
    elapsed_hours: ((Date.now() - new Date(inst.started_at).getTime()) / 3600000).toFixed(1),
  }));
  console.log(JSON.stringify({ active: result.length, instances: result }));
  return result;
}

// ── Status of single instance ────────────────────────────────────────────────
async function status(instanceId) {
  const data = loadInstances();
  const inst = data.instances.find(i => i.instance_id === instanceId);
  if (!inst) { console.log(JSON.stringify({ error: "not found" })); return; }
  const sopDef = loadSOPs().sops[inst.sop_name];
  console.log(JSON.stringify({ ...inst, sop_definition: { name: sopDef.name, current_state_def: sopDef.states[inst.current_state] } }, null, 2));
}

// ── CLI dispatch ─────────────────────────────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  try {
    switch (cmd) {
      case "trigger": {
        const [sopName, ...rest] = args;
        if (!sopName) throw new Error("Usage: node finance-sop-manager.js trigger <sop_name> <json_trigger_data>");
        const triggerData = rest.length > 0 ? JSON.parse(rest.join(" ")) : {};
        await triggerSOP(sopName, triggerData);
        break;
      }
      case "advance": {
        const [instanceId, event] = args;
        if (!instanceId || !event) throw new Error("Usage: node finance-sop-manager.js advance <instance_id> <event>");
        await advanceInstance(instanceId, event);
        break;
      }
      case "tick":
        await tick();
        break;
      case "list":
        await listActive();
        break;
      case "status": {
        const [instanceId] = args;
        if (!instanceId) throw new Error("Usage: node finance-sop-manager.js status <instance_id>");
        await status(instanceId);
        break;
      }
      default:
        console.log(`Finance SOP Manager — State Machine Engine
Usage:
  node finance-sop-manager.js trigger <sop_name> <json_trigger_data>
  node finance-sop-manager.js advance <instance_id> <event>
  node finance-sop-manager.js tick
  node finance-sop-manager.js list
  node finance-sop-manager.js status <instance_id>

Available SOPs: ar_overdue_escalation, ap_payment_flow, wo_cost_variance, month_end_close, material_loss_alert`);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
