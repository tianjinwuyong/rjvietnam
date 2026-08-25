/**
 * agv-manager.js — AGV AI Manager Brain
 *
 * Receives kit_delivery_request, task_cancel, station_block from MES.
 * Manages AGV task dispatch, monitors battery/position, handles alerts.
 *
 * Usage:
 *   node agv-manager.js patrol              # One-shot AGV status check
 *   node agv-manager.js fleet-watch         # Monitor fleet status + alerts
 *   node agv-manager.js task-dispatch       # Process pending task queue
 *   node agv-manager.js battery-watch       # Monitor battery and route to charging
 *   node agv-manager.js eval [limit]        # Score recent dispatch decisions
 *   node agv-manager.js watch [intervalMin] # Continuous loop (default 5 min)
 */

import { spawn } from "child_process";
import { existsSync, appendFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const EXEC_SCRIPT  = join(PROJECT_ROOT, "services/worker/agv-execute.js");
const QUERY_SCRIPT = join(PROJECT_ROOT, "services/worker/agv-query.js");
const EVAL_SCRIPT  = join(PROJECT_ROOT, "services/worker/agv-evaluator.js");
const ORNITH_MODEL = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const LINE_TOKEN   = join(PROJECT_ROOT, "services/worker/line_token.txt");
const LOG_FILE     = join(PROJECT_ROOT, "services/worker/agv-manager.log");

// ── Agent Bus ───────────────────────────────────────────────────────────
import { completeAgentMessage, failAgentMessage } from "../_shared/agent-bus.js";
import { createManagerBus } from "../_shared/manager-bus.js";

// ── Logging ───────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Manager Bus ────────────────────────────────────────────────────────
let bus = null;

// ── Run external script ───────────────────────────────────────────────
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

// ── LINE notification ─────────────────────────────────────────────────
async function sendLINE(msg) {
  if (!existsSync(LINE_TOKEN)) { log("WARN", "LINE token not found"); return; }
  try {
    const token = require("fs").readFileSync(LINE_TOKEN, "utf8").trim();
    if (!token) return;
    const { default: fetch } = await import("node:fetch");
    await fetch("https://notify-api.line.me/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      body: new URLSearchParams({ message: msg }),
    });
  } catch (e) { log("ERR", `LINE send failed: ${e.message}`); }
}

// ── Query helper ─────────────────────────────────────────────────────
async function queryAgv(args) {
  const raw = await run([QUERY_SCRIPT, ...args]);
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── Execute helper ────────────────────────────────────────────────────
async function execAgv(args) {
  const raw = await run([EXEC_SCRIPT, ...args]);
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── Handlers for inbound bus messages ────────────────────────────────

/**
 * MES → AGV: request material kit delivery to a line station.
 * Payload: { task_code, task_type, from_zone, to_zone, from_station, to_station,
 *            work_order_code, line_code, load_type, load_kg, priority, requested_by }
 */
async function handleKitDeliveryRequest(payload) {
  const {
    task_code, task_type = "material_delivery", from_zone, to_zone,
    from_station, to_station, work_order_code, line_code,
    load_type = "reel_trolley", load_kg = 100, priority = 5, requested_by = "mes-ai",
  } = payload;

  log("INFO", `[MES→AGV] kit_delivery_request: ${task_code} ${from_zone}→${to_zone} priority=${priority}`);

  try {
    // Create the AGV task in DB
    const result = await execAgv([
      "create-task",
      "--task-code", task_code,
      "--task-type", task_type,
      "--from-zone", from_zone,
      "--to-zone", to_zone,
      "--from-station", from_station || "",
      "--to-station", to_station || "",
      "--work-order", work_order_code || "",
      "--line", line_code || "",
      "--load-type", load_type,
      "--load-kg", String(load_kg),
      "--priority", String(priority),
    ]);

    if (result.ok) {
      log("INFO", `[AGV] task created: ${result.task?.task_code ?? task_code}`);
      await sendLINE(`[AGV] 任务已创建: ${result.task?.task_code ?? task_code} (${from_zone}→${to_zone})`);
    } else {
      log("ERR", `[AGV] task create failed: ${JSON.stringify(result)}`);
      await sendLINE(`⚠️ [AGV] 任务创建失败: ${task_code}`);
    }
  } catch (err) {
    log("ERR", `[AGV] handleKitDeliveryRequest error: ${err.message}`);
  }
}

/**
 * MES → AGV: cancel an assigned task.
 * Payload: { task_code, reason, cancelled_by }
 */
async function handleTaskCancel(payload) {
  const { task_code, reason = "", cancelled_by = "mes-ai" } = payload;
  log("INFO", `[MES→AGV] task_cancel: ${task_code} reason="${reason}"`);

  try {
    const result = await execAgv(["cancel-task", "--task-code", task_code, "--reason", reason]);
    log("INFO", `[AGV] cancel result: ${JSON.stringify(result)}`);
  } catch (err) {
    log("ERR", `[AGV] handleTaskCancel error: ${err.message}`);
  }
}

/**
 * MES → AGV: block/unblock a station zone (maintenance or obstruction).
 * Payload: { zone_code, station_code, blocked, reason, blocked_by }
 * blocked: true = block, false = unblock
 */
async function handleStationBlock(payload) {
  const {
    zone_code, station_code, blocked = true,
    reason = "", blocked_by = "mes-ai",
  } = payload;

  const action = blocked ? "block" : "unblock";
  log("INFO", `[MES→AGV] station_${action}: ${zone_code}/${station_code} reason="${reason}"`);

  try {
    const result = await execAgv([
      blocked ? "block-zone" : "unblock-zone",
      "--zone", zone_code,
      "--station", station_code || "",
      "--reason", reason,
    ]);
    log("INFO", `[AGV] ${action} result: ${JSON.stringify(result)}`);
  } catch (err) {
    log("ERR", `[AGV] handleStationBlock error: ${err.message}`);
  }
}

/**
 * WMS → AGV: material kit delivered, request AGV to transport empty trolley back.
 * Payload: { task_code, from_zone, to_zone, work_order_code }
 */
async function handleReturnRequest(payload) {
  const { task_code, from_zone, to_zone, work_order_code } = payload;
  log("INFO", `[WMS→AGV] return_request: ${task_code} ${from_zone}→${to_zone}`);

  try {
    const result = await execAgv([
      "create-task",
      "--task-code", task_code,
      "--task-type", "empty_trolley_return",
      "--from-zone", from_zone,
      "--to-zone", to_zone,
      "--work-order", work_order_code || "",
      "--priority", "7",
    ]);
    log("INFO", `[AGV] return task created: ${JSON.stringify(result)}`);
  } catch (err) {
    log("ERR", `[AGV] handleReturnRequest error: ${err.message}`);
  }
}

// ── Patrol: fleet + task status check ───────────────────────────────
async function patrolFleet() {
  log("INFO", "[AGV] Fleet patrol starting...");

  const fleet = await queryAgv(["agv-fleet"]);
  const tasks = await queryAgv(["agv-tasks"]);

  const summary = fleet.summary ?? {};
  const taskSummary = tasks.summary ?? {};

  log("INFO",
    `[AGV] Fleet — idle:${summary.idle ?? 0} busy:${summary.busy ?? 0} charging:${summary.charging ?? 0} ` +
    `lowBattery:${summary.low_battery ?? 0} | Tasks — pending:${taskSummary.pending ?? 0} ` +
    `inProgress:${(taskSummary.en_route ?? 0) + (taskSummary.in_progress ?? 0)} ` +
    `completed:${taskSummary.completed ?? 0}`
  );

  // Alert on low battery AGVs
  if (fleet.fleet) {
    for (const agv of fleet.fleet) {
      if (agv.is_low_battery) {
        await sendLINE(`🔋 [AGV低电量] ${agv.code} 电量${agv.battery_pct}% — 低于阈值${agv.low_battery_threshold}%`);
      }
    }
  }

  // Alert on stuck AGVs
  if (fleet.fleet) {
    for (const agv of fleet.fleet) {
      if (agv.status === "error" || agv.status === "offline") {
        await sendLINE(`🚨 [AGV异常] ${agv.code} 状态: ${agv.status}`);
      }
    }
  }

  return { fleet, tasks };
}

// ── Task dispatch: assign pending tasks to available AGVs ─────────────
async function dispatchPendingTasks() {
  log("INFO", "[AGV] Checking pending tasks...");

  const tasks = await queryAgv(["agv-tasks"]);
  const fleet = await queryAgv(["agv-fleet"]);

  if (!tasks.tasks?.length) {
    log("INFO", "[AGV] No pending tasks");
    return;
  }

  const pending = tasks.tasks.filter(t => t.status === "pending");
  log("INFO", `[AGV] ${pending.length} pending task(s)`);

  for (const task of pending) {
    // Find best AGV
    const available = (fleet.fleet ?? []).filter(a =>
      (a.status === "idle" || a.status === "charging") &&
      a.battery_pct > (a.low_battery_threshold + 10)
    );

    if (!available.length) {
      log("INFO", `[AGV] No available AGV for task ${task.task_code}`);
      continue;
    }

    // Pick AGV with highest battery
    const best = available.sort((a, b) => b.battery_pct - a.battery_pct)[0];

    try {
      const result = await execAgv([
        "assign-task",
        "--task-id", String(task.id),
        "--agv-code", best.code,
      ]);
      log("INFO", `[AGV] assigned ${task.task_code} → ${best.code}: ${JSON.stringify(result)}`);
      await sendLINE(`[AGV] 任务分配: ${task.task_code} → ${best.code}`);
    } catch (err) {
      log("ERR", `[AGV] assign failed for ${task.task_code}: ${err.message}`);
    }
  }
}

// ── Battery watch: route low-battery AGVs to charging ────────────────
async function batteryWatch() {
  const fleet = await queryAgv(["agv-fleet"]);

  for (const agv of (fleet.fleet ?? [])) {
    if (agv.status === "idle" && agv.battery_pct <= agv.low_battery_threshold) {
      log("WARN", `[AGV] ${agv.code} battery ${agv.battery_pct}% ≤ threshold — routing to charging`);
      try {
        await execAgv(["route-to-charging", "--agv", agv.code]);
        await sendLINE(`🔋 [AGV充电] ${agv.code} 电量${agv.battery_pct}%，已安排回桩`);
      } catch (err) {
        log("ERR", `[AGV] route-to-charging failed for ${agv.code}: ${err.message}`);
      }
    }
  }
}

// ── Main CLI ─────────────────────────────────────────────────────────
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

  // Init bus
  bus = createManagerBus({
    agentId: "agv-ai",
    log,
    logPrefix: "[BUS] ",
    handlers: {
      "kit_delivery_request": handleKitDeliveryRequest,
      "task_cancel":          handleTaskCancel,
      "station_block":         handleStationBlock,
      "return_request":        handleReturnRequest,
    },
  });
  await bus.init();

  switch (command) {
    case "patrol": {
      await patrolFleet();
      await bus.poll();
      break;
    }
    case "fleet-watch": {
      await patrolFleet();
      await bus.poll();
      break;
    }
    case "task-dispatch": {
      await dispatchPendingTasks();
      await bus.poll();
      break;
    }
    case "battery-watch": {
      await batteryWatch();
      await bus.poll();
      break;
    }
    case "eval": {
      const limit = parseInt(opts.limit) || 5;
      const result = await run([EVAL_SCRIPT, "score-recent", "--limit", String(limit)]);
      console.log(result);
      break;
    }
    case "watch": {
      const intervalMin = parseInt(opts.interval) || parseInt(command) || 5;
      log("INFO", `[AGV] Watch mode — interval ${intervalMin} min`);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await patrolFleet();
        await dispatchPendingTasks();
        await batteryWatch();
        await bus.poll();
        await new Promise(r => setTimeout(r, intervalMin * 60 * 1000));
      }
    }
    default: {
      // Default: patrol + poll
      await patrolFleet();
      await dispatchPendingTasks();
      await batteryWatch();
      await bus.poll();
    }
  }

  log("INFO", "[AGV] Cycle complete");
}

main().catch(err => {
  log("ERR", `[AGV] Fatal: ${err.message}`);
  process.exit(1);
});
