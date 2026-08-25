/**
 * mes-sop-manager.js — Adaptive SOP Engine for MES AI Manager
 *
 * Drives the MES patrol workflow through a state-machine SOP structure.
 * Each step has a type (query, eval, execute, condition, vision, digest) and
 * transitions. Steps can be skipped/adapted based on line state or previous results.
 *
 * Usage:
 *   node mes-sop-manager.js run --sop mes-sop.json --state mes-sop-state.json [--line SMD-01]
 *   node mes-sop-manager.js resume --sop mes-sop.json --state mes-sop-state.json
 *   node mes-sop-manager.js next --sop mes-sop.json --state mes-sop-state.json
 *   node mes-sop-manager.js state-set --sop mes-sop.json --state mes-sop-state.json --key <k> --value <v>
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
  agentId: "mes-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: {},
});

async function notifySopComplete(sopName, cycleId, stepsRun, outcome) {
  await bus.init();
  await bus.send("mes-ai", "sop_cycle_complete", {
    sop_name: sopName,
    cycle_id: cycleId,
    steps_run: stepsRun,
    outcome,
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}

async function notifySopStepError(sopName, stepId, errorMsg) {
  await bus.init();
  await bus.send("mes-ai", "system_alert", {
    alert_level: "high",
    source_agent: "mes-sop-ai",
    subject: `SOP error: ${stepId}`,
    detail: `${sopName} step ${stepId} failed: ${errorMsg}`,
  }).catch(() => {});
}

// ── Run child script helper ──────────────────────────────────────────────
async function runChild(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
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

// ── Load SOP ──────────────────────────────────────────────────────────────
function loadSop(sopPath) {
  const data = readFileSync(sopPath, "utf-8");
  return JSON.parse(data);
}

function loadState(statePath) {
  if (!existsSync(statePath)) {
    // Default initial state
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

// ── Resolve next step ────────────────────────────────────────────────────
function resolveNextStep(sop, state) {
  const allSteps = sop.steps;

  if (!state.current_step_id) {
    // Start at the first step
    return allSteps[0] || null;
  }

  const currentStepIdx = allSteps.findIndex(s => s.id === state.current_step_id);
  if (currentStepIdx === -1) return null;

  const currentStep = allSteps[currentStepIdx];
  const currentResult = state.step_results[currentStep.id];

  // Check for explicit transitions based on result
  if (currentStep.transitions && currentResult) {
    // Match transition conditions against result data
    for (const t of currentStep.transitions) {
      if (t.condition && evaluateCondition(t.condition, currentResult, state)) {
        const nextStep = allSteps.find(s => s.id === t.target);
        return nextStep || null;
      }
    }
  }

  // Default: go to next step in sequence
  if (currentStepIdx + 1 < allSteps.length) {
    return allSteps[currentStepIdx + 1];
  }

  return null; // SOP complete
}

// ── Simple condition evaluator ────────────────────────────────────────────
function evaluateCondition(condition, result, state) {
  // Support: result_defect_found eq true, result_recommendation eq SCRAP
  // format: "<source>_<key> <op> <value>"
  const parts = condition.split(/\s+/);
  if (parts.length < 3) return false;

  const [sourceKey, op, ...valParts] = parts;
  const value = valParts.join(" ");
  const quoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

  // Determine source
  let actualValue;
  if (sourceKey.startsWith("result_")) {
    const key = sourceKey.slice(7); // strip "result_"
    actualValue = result?.[key];
  } else if (sourceKey.startsWith("var_")) {
    const key = sourceKey.slice(4);
    actualValue = state.vars?.[key];
  } else {
    actualValue = result?.[sourceKey];
  }

  if (actualValue === undefined || actualValue === null) return false;

  switch (op) {
    case "eq": return String(actualValue).toLowerCase() === quoted.toLowerCase();
    case "neq": return String(actualValue).toLowerCase() !== quoted.toLowerCase();
    case "gt": return Number(actualValue) > Number(quoted);
    case "gte": return Number(actualValue) >= Number(quoted);
    case "lt": return Number(actualValue) < Number(quoted);
    case "lte": return Number(actualValue) <= Number(quoted);
    case "contains": return String(actualValue).toLowerCase().includes(quoted.toLowerCase());
    default: return false;
  }
}

// ── Execute a step ────────────────────────────────────────────────────────
async function executeStep(sop, step, state) {
  log("INFO", `Executing step: ${step.id} (${step.type})`);

  state.current_step_id = step.id;

  switch (step.type) {
    case "query": {
      // query-line, query-runs, etc.
      const result = await runChild(sop.scripts.query, [step.params?.scope || step.params?.query, ...buildArgs(step.params)]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "execute": {
      // line-alert, resolve-stagnation, etc.
      const cmd = step.params?.action || step.params?.command;
      const args = buildArgs(step.params);
      const result = await runChild(sop.scripts.execute, [cmd, ...args]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "eval": {
      // score-recent, etc.
      const result = await runChild(sop.scripts.evaluator, [step.params?.command || "score-recent", ...buildArgs(step.params)]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "vision": {
      // pcb, solder, feeder, label
      const taskType = step.params?.task || "pcb";
      const result = await runChild(sop.scripts.vision, [taskType, ...buildArgs(step.params)]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "digest": {
      // morning-daily
      const result = await runChild(sop.scripts.manager, ["morning-daily", ...buildArgs(step.params)]);
      state.step_results[step.id] = { success: true, output: result };
      break;
    }
    case "condition": {
      const condition = step.params?.condition;
      if (!condition) {
        state.step_results[step.id] = { success: true, passed: true };
        break;
      }
      const passed = evaluateCondition(condition, state.step_results, state);
      state.step_results[step.id] = { success: true, passed, evaluated: condition };
      log("INFO", `Condition "${condition}": ${passed}`);
      break;
    }
    case "set-variable": {
      const key = step.params?.key;
      const value = step.params?.value;
      if (key) {
        // Support variable interpolation: {{ result_X.Y }}
        const resolvedValue = resolveTemplate(value, state);
        state.vars[key] = resolvedValue;
        state.step_results[step.id] = { success: true, set: key, to: resolvedValue };
      }
      break;
    }
    case "notify": {
      // LINE notification step
      const msg = resolveTemplate(step.params?.message || "MES SOP notification", state);
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

// ── Simple template resolver — {{ var_X }} / {{ result_X_key }} ──────────
function resolveTemplate(template, state) {
  if (!template) return template;
  return template.replace(/\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g, (match, path) => {
    const parts = path.split(".");
    let obj;
    if (parts[0] === "var") {
      obj = state.vars;
      parts.shift();
    } else if (parts[0] === "result") {
      parts.shift();
      const stepId = parts.shift();
      obj = state.step_results[stepId];
    } else {
      return match;
    }

    let val = obj;
    for (const p of parts) {
      if (val && typeof val === "object") val = val[p];
      else return match;
    }
    return val !== undefined && val !== null ? String(val) : match;
  });
}

// ── Build CLI args from params ────────────────────────────────────────────
function buildArgs(params) {
  if (!params) return [];
  const args = [];
  for (const [key, value] of Object.entries(params)) {
    if (["scope", "action", "command", "task", "condition", "key", "value", "message"].includes(key)) continue;
    if (key === "query" || key === "args") continue;
    if (value === true) args.push(`--${key}`);
    else if (value !== undefined && value !== null) args.push(`--${key}`, String(value));
  }
  return args;
}

// ── CLI dispatch ─────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2];
  const opts = {};

  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const key = process.argv[i].slice(2);
      opts[key] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
      if (opts[key] !== true) i++;
    }
  }

  const sopPath = resolve(PROJECT_ROOT, opts.sop || "mes-sop.json");
  const statePath = resolve(PROJECT_ROOT, opts.state || "mes-sop-state.json");

  if (!existsSync(sopPath)) {
    console.error(`SOP file not found: ${sopPath}`);
    process.exit(1);
  }

  const sop = loadSop(sopPath);
  const state = loadState(statePath);

  try {
    switch (command) {
      case "run": {
        // Run until completion or condition
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
          command: "run",
          complete,
          steps_run: state.completed_step_ids.length,
          current_step: state.current_step_id,
          updated_at: state.updated_at,
        }));
        await notifySopComplete("mes-sop", statePath, state.completed_step_ids.length, complete ? "completed" : "stopped");
        break;
      }

      case "resume": {
        // Continue from current step
        if (!state.current_step_id) {
          console.log(JSON.stringify({ command: "resume", error: "No state to resume from" }));
          process.exit(1);
        }

        let step;
        let count = 0;
        do {
          step = resolveNextStep(sop, state);
          if (step) {
            await executeStep(sop, step, state);
            saveState(statePath, state);
            count++;
          }
        } while (step && !opts.once);

        console.log(JSON.stringify({
          command: "resume",
          steps_run: count,
          complete: step === null,
          current_step: state.current_step_id,
        }));
        await notifySopComplete("mes-sop", statePath, state.completed_step_ids.length, step === null ? "completed" : "stopped");
        break;
      }

      case "next": {
        // Execute just the next step
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
        console.error(`Usage: node mes-sop-manager.js [run|resume|next|state-set|state-get] [options]`);
        process.exit(1);
    }
  } catch (err) {
    log("ERROR", err.message);
    saveState(statePath, state);
    await notifySopStepError("mes-sop", state.current_step_id || "unknown", err.message);
    process.exit(1);
  }
}

main();
