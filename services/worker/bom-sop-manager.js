/**
 * bom-sop-manager.js — Adaptive SOP Engine for BOM AI Manager
 *
 * Drives the BOM patrol workflow through a state-machine SOP structure.
 *
 * Usage:
 *   node bom-sop-manager.js run --sop bom-sop.json --state bom-sop-state.json [--start step_id]
 *   node bom-sop-manager.js resume --sop bom-sop.json --state bom-sop-state.json
 *   node bom-sop-manager.js next --sop bom-sop.json --state bom-sop-state.json
 *   node bom-sop-manager.js state-set --sop bom-sop.json --state bom-sop-state.json --key <k> --value <v>
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";
import { createManagerBus } from "../_shared/manager-bus.js";

const PROJECT_ROOT = process.cwd();

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.error(`${ts} [${level}] [BOM-SOP] ${msg}`);
}

// ── Manager Bus ────────────────────────────────────────────────────────────
const bus = createManagerBus({
  agentId: "bom-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: {},
});

async function notifySopComplete(sopName, cycleId, stepsRun, outcome) {
  await bus.init();
  await bus.send("bom-ai", "sop_cycle_complete", {
    sop_name: sopName,
    cycle_id: cycleId,
    steps_run: stepsRun,
    outcome,
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}

async function notifySopStepError(sopName, stepId, errorMsg) {
  await bus.init();
  await bus.send("bom-ai", "system_alert", {
    alert_level: "high",
    source_agent: "bom-sop-ai",
    subject: `SOP error: ${stepId}`,
    detail: `${sopName} step ${stepId} failed: ${errorMsg}`,
  }).catch(() => {});
}

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
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out.trim());
    });
  });
}

function loadState(statePath) {
  if (!existsSync(statePath)) return {};
  try { return JSON.parse(readFileSync(statePath, "utf-8")); }
  catch (_) { return {}; }
}

function saveState(statePath, state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function resolveTransitions(step, results) {
  if (!step.transitions || step.transitions.length === 0) return null;
  for (const t of step.transitions) {
    const parts = t.condition.split(" ");
    if (parts.length < 3) continue;
    const key = parts[0].replace("result_", "");
    const op = parts[1];
    const val = parts.slice(2).join(" ");
    const actual = results[key];
    if (op === "eq" && String(actual) === val) return t.target;
    if (op === "neq" && String(actual) !== val) return t.target;
  }
  return null;
}

async function executeStep(step, results) {
  const extraState = {};

  switch (step.type) {
    case "query": {
      const script = resolve(PROJECT_ROOT, "services/worker", step.script || "bom-query.js");
      const args = step.args || [step.params?.scope || "all"];
      const out = await runChild(script, args);
      const data = JSON.parse(out);
      results[`result_${step.id}`] = data;
      break;
    }
    case "execute": {
      const script = resolve(PROJECT_ROOT, "services/worker", step.script || "bom-execute.js");
      const args = step.args || [step.params?.action];
      const out = await runChild(script, args);
      results[`result_${step.id}`] = out;
      break;
    }
    case "eval": {
      const script = resolve(PROJECT_ROOT, "services/worker", step.script || "bom-evaluator.js");
      const args = step.args || ["score-recent"];
      const out = await runChild(script, args);
      results[`result_${step.id}`] = out;
      break;
    }
    case "notify": {
      const msg = step.params?.message || "BOM SOP cycle complete";
      log("INFO", `Notify: ${msg}`);
      results[`result_${step.id}`] = true;
      break;
    }
    case "condition":
    case "set-variable": {
      if (step.params?.key) {
        const val = (step.params.value || "")
          .replace("{{ var_timestamp }}", new Date().toISOString());
        extraState[step.params.key] = val;
        results[`result_${step.id}`] = true;
      }
      break;
    }
    default:
      results[`result_${step.id}`] = null;
  }

  return extraState;
}

async function runSop(sopPath, statePath, startStepId) {
  const sop = JSON.parse(readFileSync(sopPath, "utf-8"));
  const results = {};
  const stepsRun = [];
  let currentStepId = startStepId || sop.startStep;
  let cycleId = `bom-${Date.now()}`;
  const stepMap = {};
  for (const s of sop.steps) stepMap[s.id] = s;

  let outcome = "completed";

  while (currentStepId && currentStepId !== "END") {
    const step = stepMap[currentStepId];
    if (!step) { outcome = "error"; break; }

    log("INFO", `Running step: ${step.id} (${step.type})`);
    stepsRun.push(step.id);

    try {
      const extraState = await executeStep(step, results);
      if (Object.keys(extraState).length > 0) {
        const cur = loadState(statePath);
        saveState(statePath, { ...cur, ...extraState });
      }
    } catch (err) {
      log("ERROR", `Step ${step.id} failed: ${err.message}`);
      await notifySopStepError(sop.name || "bom-sop", step.id, err.message);
      if (step.onError === "ABORT") { outcome = "error"; break; }
      currentStepId = step.next || null;
      continue;
    }

    const nextId = resolveTransitions(step, results) || step.next;
    currentStepId = nextId === "END" ? null : nextId;
  }

  await notifySopComplete(sop.name || "bom-sop", cycleId, stepsRun, outcome);
  log("INFO", `SOP complete. Outcome: ${outcome}. Steps: ${stepsRun.join(" → ")}`);
}

const [cmd, ...args] = process.argv.slice(2);
const getArg = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i+1] : null; };

async function main() {
  const sopPath = getArg("sop") || "services/worker/bom-sop.json";
  const statePath = getArg("state") || "services/worker/bom-sop-state.json";

  switch (cmd) {
    case "run": {
      const startStep = getArg("start") || null;
      await runSop(sopPath, statePath, startStep);
      break;
    }
    case "resume": {
      const state = loadState(statePath);
      await runSop(sopPath, statePath, state.__next_step || null);
      break;
    }
    case "next": {
      const state = loadState(statePath);
      const sop = JSON.parse(readFileSync(sopPath, "utf-8"));
      const stepMap = {};
      for (const s of sop.steps) stepMap[s.id] = s;
      const nextId = stepMap[state.__current_step || sop.startStep]?.next;
      if (nextId && nextId !== "END") {
        const cur = loadState(statePath);
        saveState(statePath, { ...cur, __next_step: nextId });
        log("INFO", `Next step set to: ${nextId}`);
      }
      break;
    }
    case "state-set": {
      const key = getArg("key");
      const value = getArg("value");
      if (!key) { console.error("--key required"); process.exit(1); }
      const state = loadState(statePath);
      state[key] = value;
      saveState(statePath, state);
      console.log(`Set ${key} = ${value}`);
      break;
    }
    default:
      console.log(`BOM SOP Manager
Usage:
  node bom-sop-manager.js run --sop bom-sop.json --state bom-sop-state.json [--start step_id]
  node bom-sop-manager.js resume --sop bom-sop.json --state bom-sop-state.json
  node bom-sop-manager.js next --sop bom-sop.json --state bom-sop-state.json
  node bom-sop-manager.js state-set --sop bom-sop.json --state bom-sop-state.json --key <k> --value <v>`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
