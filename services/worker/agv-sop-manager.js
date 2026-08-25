/**
 * agv-sop-manager.js — Adaptive SOP Engine for AGV AI Manager
 *
 * Drives the AGV patrol workflow through a state-machine SOP structure.
 * Each step has a type (query, eval, execute, condition, set-variable, notify).
 *
 * Usage:
 *   node agv-sop-manager.js run --sop agv-sop.json --state agv-sop-state.json
 *   node agv-sop-manager.js resume --sop agv-sop.json --state agv-sop-state.json
 *   node agv-sop-manager.js next --sop agv-sop.json --state agv-sop-state.json
 *   node agv-sop-manager.js state-set --sop agv-sop.json --state agv-sop-state.json --key <k> --value <v>
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";
import { createManagerBus } from "../_shared/manager-bus.js";

const PROJECT_ROOT = process.cwd();

// ── Logging ──────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.error(`${ts} [${level}] [SOP] ${msg}`);
}

// ── Manager Bus ─────────────────────────────────────────────────────────
const bus = createManagerBus({
  agentId: "agv-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: {},
});

async function notifySopComplete(sopName, cycleId, stepsRun, outcome) {
  await bus.init();
  await bus.send("agv-ai", "sop_cycle_complete", {
    sop_name: sopName,
    cycle_id: cycleId,
    steps_run: stepsRun,
    outcome,
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}

async function notifySopStepError(sopName, stepId, errorMsg) {
  await bus.init();
  await bus.send("agv-ai", "system_alert", {
    alert_level: "high",
    source_agent: "agv-sop-ai",
    subject: `SOP error: ${stepId}`,
    detail: `${sopName} step ${stepId} failed: ${errorMsg}`,
  }).catch(() => {});
}

// ── Child script runner ─────────────────────────────────────────────────
async function runChild(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${script} exited ${code}: ${err.slice(-300)}`));
      else resolve(out.trim());
    });
    child.on("error", e => reject(e));
  });
}

// ── SOP load/save ───────────────────────────────────────────────────────
function loadSop(sopPath) {
  return JSON.parse(readFileSync(sopPath, "utf-8"));
}

function loadState(statePath) {
  if (!existsSync(statePath)) {
    return {
      current_step_id: null,
      completed_step_ids: [],
      skipped_step_ids: [],
      step_results: {},
      updated_at: new Date().toISOString(),
      vars: {},
    };
  }
  return JSON.parse(readFileSync(statePath, "utf-8"));
}

function saveState(statePath, state) {
  state.updated_at = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

// ── Condition evaluator ─────────────────────────────────────────────────
function evaluateCondition(condition, result, state) {
  // Format: "result_<stepId>_<key> <op> <value>" or "var_<key> <op> <value>"
  const parts = condition.split(/\s+/);
  if (parts.length < 3) return false;
  const [sourceKey, op, ...valParts] = parts;
  const value = valParts.join(" ");
  const quoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

  let actualValue;
  if (sourceKey.startsWith("result_")) {
    const key = sourceKey.slice(7);
    actualValue = result?.[key];
  } else if (sourceKey.startsWith("var_")) {
    const key = sourceKey.slice(4);
    actualValue = state.vars?.[key];
  } else {
    actualValue = result?.[sourceKey];
  }

  if (actualValue === undefined || actualValue === null) return false;
  switch (op) {
    case "eq":      return String(actualValue).toLowerCase() === quoted.toLowerCase();
    case "neq":     return String(actualValue).toLowerCase() !== quoted.toLowerCase();
    case "gt":      return Number(actualValue) > Number(quoted);
    case "gte":     return Number(actualValue) >= Number(quoted);
    case "lt":      return Number(actualValue) < Number(quoted);
    case "lte":     return Number(actualValue) <= Number(quoted);
    case "contains": return String(actualValue).toLowerCase().includes(quoted.toLowerCase());
    default: return false;
  }
}

// ── Next step resolver ──────────────────────────────────────────────────
function resolveNextStep(sop, state) {
  const allSteps = sop.steps;
  if (!state.current_step_id) return allSteps[0] || null;

  const idx = allSteps.findIndex(s => s.id === state.current_step_id);
  if (idx === -1) return null;

  const currentResult = state.step_results[state.current_step_id];
  if (allSteps[idx].transitions && currentResult) {
    for (const t of allSteps[idx].transitions) {
      if (t.condition && evaluateCondition(t.condition, currentResult, state)) {
        const next = allSteps.find(s => s.id === t.target);
        if (next) return next;
      }
    }
  }

  return idx + 1 < allSteps.length ? allSteps[idx + 1] : null;
}

// ── Template resolver ───────────────────────────────────────────────────
function resolveTemplate(template, state) {
  if (!template) return template;
  return template.replace(/\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g, (match, path) => {
    const parts = path.split(".");
    let obj;
    if (parts[0] === "var")      { obj = state.vars;          parts.shift(); }
    else if (parts[0] === "result") { obj = state.step_results; parts.shift(); }
    else { return match; }
    const stepId = parts.shift();
    obj = obj?.[stepId];
    for (const p of parts) { if (obj && typeof obj === "object") obj = obj[p]; else return match; }
    return obj !== undefined && obj !== null ? String(obj) : match;
  });
}

// ── Args builder ────────────────────────────────────────────────────────
function buildArgs(params) {
  if (!params) return [];
  const args = [];
  for (const [key, value] of Object.entries(params)) {
    if (["scope", "action", "command", "task", "condition", "key", "value", "message"].includes(key)) continue;
    if (value === true)          args.push(`--${key}`);
    else if (value !== undefined && value !== null) args.push(`--${key}`, String(value));
  }
  return args;
}

// ── Step executor ────────────────────────────────────────────────────────
async function executeStep(sop, step, state) {
  log("INFO", `Executing step: ${step.id} (${step.type})`);
  state.current_step_id = step.id;

  switch (step.type) {
    case "query": {
      const result = await runChild(sop.scripts.query, [
        step.params?.scope || step.params?.query, ...buildArgs(step.params),
      ]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "execute": {
      const cmd = step.params?.action || step.params?.command;
      const result = await runChild(sop.scripts.execute, [cmd, ...buildArgs(step.params)]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "eval": {
      const result = await runChild(sop.scripts.evaluator, [
        step.params?.command || "score-recent", ...buildArgs(step.params),
      ]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "condition": {
      const passed = step.params?.condition
        ? evaluateCondition(step.params.condition, state.step_results, state)
        : true;
      state.step_results[step.id] = { success: true, passed, evaluated: step.params?.condition };
      log("INFO", `Condition "${step.params?.condition}": ${passed}`);
      break;
    }
    case "set-variable": {
      const key = step.params?.key;
      const value = step.params?.value;
      if (key) {
        state.vars[key] = resolveTemplate(value, state);
        state.step_results[step.id] = { success: true, set: key, to: state.vars[key] };
      }
      break;
    }
    case "notify": {
      const msg = resolveTemplate(step.params?.message || "AGV SOP notification", state);
      try {
        await runChild(sop.scripts.execute, ["notify-line", "--message", msg]);
      } catch (e) {
        log("WARN", `Notify failed for step ${step.id}: ${e.message}`);
      }
      state.step_results[step.id] = { success: true, notified: true, message: msg };
      break;
    }
    default:
      log("WARN", `Unknown step type: ${step.type}`);
      state.step_results[step.id] = { success: false, error: `Unknown step type: ${step.type}` };
  }

  state.completed_step_ids.push(step.id);
  return step;
}

// ── CLI dispatch ─────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2];
  const opts = {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const key = process.argv[i].slice(2);
      opts[key] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
        ? process.argv[i + 1] : true;
      if (opts[key] !== true) i++;
    }
  }

  const sopPath   = resolve(PROJECT_ROOT, opts.sop   || "agv-sop.json");
  const statePath  = resolve(PROJECT_ROOT, opts.state || "agv-sop-state.json");

  if (!existsSync(sopPath)) {
    console.error(`SOP file not found: ${sopPath}`);
    process.exit(1);
  }

  const sop   = loadSop(sopPath);
  const state = loadState(statePath);

  try {
    switch (command) {
      case "run":
      case "resume": {
        let step;
        do {
          step = resolveNextStep(sop, state);
          if (step) {
            await executeStep(sop, step, state);
            saveState(statePath, state);
          }
        } while (step && !opts.once);

        const complete = step === null;
        console.log(JSON.stringify({
          command, complete,
          steps_run: state.completed_step_ids.length,
          current_step: state.current_step_id,
          updated_at: state.updated_at,
        }));
        await notifySopComplete("agv-sop", statePath, state.completed_step_ids.length, complete ? "completed" : "stopped");
        break;
      }
      case "next": {
        const nextStep = resolveNextStep(sop, state);
        if (!nextStep) {
          console.log(JSON.stringify({ command: "next", complete: true }));
          break;
        }
        await executeStep(sop, nextStep, state);
        saveState(statePath, state);
        console.log(JSON.stringify({ command: "next", step: nextStep.id, complete: false }));
        break;
      }
      case "state-set": {
        if (opts.key && opts.value !== undefined) {
          state.vars[opts.key] = opts.value;
          saveState(statePath, state);
          console.log(JSON.stringify({ command: "state-set", key: opts.key, value: opts.value }));
        }
        break;
      }
      case "state-get": {
        console.log(JSON.stringify(state, null, 2));
        break;
      }
      default:
        console.error(`Usage: node agv-sop-manager.js [run|resume|next|state-set|state-get]`);
        process.exit(1);
    }
  } catch (err) {
    log("ERROR", err.message);
    saveState(statePath, state);
    await notifySopStepError("agv-sop", state.current_step_id || "unknown", err.message);
    process.exit(1);
  }
}

main();
