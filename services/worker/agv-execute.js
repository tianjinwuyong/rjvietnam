/**
 * agv-execute.js — AGV AI Manager executor
 * Bridges Ornith decisions to AGV REST API calls.
 *
 * Usage:
 *   node agv-execute.js <action> [options]
 *
 * Actions:
 *   create-task      --task-code <code> --task-type <type> --from-zone <zone> --to-zone <zone>
 *                      [--from-station <code>] [--to-station <code>] [--work-order <code>]
 *                      [--line <code>] [--load-type <type>] [--load-kg <kg>] [--priority <n>]
 *   assign-task      --task-id <id> --agv-code <code>
 *   cancel-task      --task-code <code> --reason <text>
 *   block-zone       --zone <code> --station <code> --reason <text>
 *   unblock-zone     --zone <code> --station <code>
 *   route-to-charging --agv <code>
 *   alert-stuck-tasks --threshold-min <minutes>
 *   escalate-alerts
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const { Pool } = pg;

const JWT_SECRET  = process.env.JWT_SECRET     ?? "smt-factory-secret-2026";
const AGV_API_BASE = process.env.AGV_API_BASE ?? "http://127.0.0.1:8081";
const LINE_TOKEN_FILE = "services/worker/line_token.txt";

const pgPool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── JWT ───────────────────────────────────────────────────────────────
function getJwt(roleKey = "admin") {
  return jwt.sign(
    {
      userId: 10,
      username: "agv-ai",
      roleKey,
      permissions: ["agv.view", "agv.execute", "agv.dispatch"],
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// ── AGV REST API helpers ─────────────────────────────────────────────

/**
 * POST a command to the AGV command queue via agv-api.js.
 * AGV device will poll GET /agv/commands?agv_code=X.
 */
async function enqueueAgvCommand(agvCode, commandType, payload = {}, priority = 5) {
  const token = getJwt();
  try {
    const res = await fetch(`${AGV_API_BASE}/agv/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ agv_code: agvCode, command_type: commandType, payload, priority }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "unknown" };
    return { ok: true, command: json.command };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Cancel a pending command in the AGV command queue.
 */
async function cancelAgvCommand(commandId) {
  const token = getJwt();
  try {
    const res = await fetch(`${AGV_API_BASE}/agv/commands/${commandId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── LINE Notify ─────────────────────────────────────────────────────
async function sendLineNotify(message) {
  const tokenPath = join(process.cwd(), LINE_TOKEN_FILE);
  if (!existsSync(tokenPath)) return { sent: false, reason: "no_token" };
  const token = readFileSync(tokenPath, "utf-8").trim();
  if (!token) return { sent: false, reason: "empty_token" };
  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    body: new URLSearchParams({ message }),
  });
  return { sent: res.ok, status: res.status };
}

// ── Audit log ────────────────────────────────────────────────────────
async function logAudit(decisionType, inputData, outputDecision, executed = true) {
  try {
    await pgPool.query(
      `INSERT INTO mes_manager_audit_log
       (agent, area, decision_type, input_data, output_decision, executed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      ["agv-ai", "agv", decisionType, JSON.stringify(inputData), JSON.stringify(outputDecision), executed]
    );
  } catch (err) {
    console.error(`Audit log error: ${err.message}`);
  }
}

// ── Actions ──────────────────────────────────────────────────────────

/**
 * Create a new AGV transport task in DB and enqueue dispatch command.
 */
async function createTask(opts) {
  const {
    taskCode, taskType = "material_delivery", fromZone, toZone,
    fromStation = null, toStation = null, workOrder = null, line = null,
    loadType = "reel_trolley", loadKg = 100, priority = 5,
  } = opts;

  if (!taskCode || !fromZone || !toZone) {
    return { ok: false, error: "taskCode, fromZone, and toZone are required" };
  }

  // Resolve zone IDs
  const [fromZoneRow, toZoneRow, fromStationRow, toStationRow] = await Promise.all([
    pgPool.query("SELECT id FROM agv_zones WHERE code = $1", [fromZone]),
    pgPool.query("SELECT id FROM agv_zones WHERE code = $1", [toZone]),
    fromStation ? pgPool.query("SELECT id FROM agv_stations WHERE code = $1", [fromStation]) : Promise.resolve({ rows: [] }),
    toStation   ? pgPool.query("SELECT id FROM agv_stations WHERE code = $1", [toStation])   : Promise.resolve({ rows: [] }),
  ]);

  if (!fromZoneRow.rows.length) return { ok: false, error: `fromZone ${fromZone} not found` };
  if (!toZoneRow.rows.length)   return { ok: false, error: `toZone ${toZone} not found` };

  const taskCodeFinal = taskCode || `AGV-T${Date.now().toString().slice(-5)}`;

  const row = await pgPool.query(
    `INSERT INTO agv_tasks
       (task_code, task_type, priority, status, from_zone_id, to_zone_id,
        from_station_id, to_station_id, work_order_id, line_id, load_type, load_kg, created_at)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,
             (SELECT id FROM work_orders WHERE code=$8 LIMIT 1),
             (SELECT id FROM production_lines WHERE internal_code=$9 LIMIT 1),
             $10, $11, NOW())
     RETURNING id, task_code, task_type, priority, status`,
    [taskCodeFinal, taskType, priority,
     fromZoneRow.rows[0].id, toZoneRow.rows[0].id,
     fromStationRow.rows[0]?.id ?? null, toStationRow.rows[0]?.id ?? null,
     workOrder || null, line || null,
     loadType, loadKg]
  );

  const task = row.rows[0];
  await logAudit("task_create", opts, task);
  return { ok: true, task };
}

/**
 * Assign a pending task to a specific AGV and enqueue dispatch command.
 */
async function assignTask(taskId, agvCode) {
  const agvRow = await pgPool.query("SELECT id, code, status, battery_pct, low_battery_threshold FROM agv_fleet WHERE code = $1", [agvCode]);
  if (!agvRow.rows.length) return { ok: false, error: `AGV ${agvCode} not found` };

  const agv = agvRow.rows[0];
  if (agv.status !== "idle" && agv.status !== "charging") {
    return { ok: false, error: `AGV ${agvCode} is ${agv.status}, cannot assign` };
  }
  if (agv.battery_pct <= agv.low_battery_threshold) {
    return { ok: false, error: `AGV ${agvCode} battery ${agv.battery_pct}% below threshold` };
  }

  const taskRow = await pgPool.query("SELECT * FROM agv_tasks WHERE id = $1", [taskId]);
  if (!taskRow.rows.length) return { ok: false, error: `Task ${taskId} not found` };

  const task = taskRow.rows[0];
  if (task.status !== "pending") {
    return { ok: false, error: `Task ${task.task_code} is ${task.status}, cannot assign` };
  }

  // Update task: assigned + dispatched
  await pgPool.query(
    `UPDATE agv_tasks SET status='dispatched', agv_id=$1, assigned_at=NOW(), dispatched_at=NOW(), updated_at=NOW()
     WHERE id=$2`,
    [agv.id, taskId]
  );

  // Update AGV status
  await pgPool.query(
    `UPDATE agv_fleet SET status='busy', current_task_id=$1, updated_at=NOW() WHERE id=$2`,
    [taskId, agv.id]
  );

  // Enqueue command for AGV device to poll
  const apiResult = await enqueueAgvCommand(agvCode, "dispatch", {
    task_id: taskId,
    task_code: task.task_code,
    task_type: task.task_type,
    from_zone_id: task.from_zone_id,
    to_zone_id: task.to_zone_id,
    from_station_id: task.from_station_id,
    to_station_id: task.to_station_id,
    load_type: task.load_type,
    load_kg: task.load_kg,
    priority: task.priority,
  });

  await logAudit("task_assign", { taskId, agvCode }, { status: "dispatched", api_enqueued: apiResult.ok });
  return { ok: true, task_id: taskId, agv_code: agvCode, status: "dispatched", command_enqueued: apiResult.ok };
}

/**
 * Cancel a pending or assigned task.
 */
async function cancelTask(taskCode, reason = "") {
  const taskRow = await pgPool.query("SELECT id, agv_id, status FROM agv_tasks WHERE task_code = $1", [taskCode]);
  if (!taskRow.rows.length) return { ok: false, error: `Task ${taskCode} not found` };

  const task = taskRow.rows[0];
  const cancellable = ["pending", "assigned", "dispatched"];
  if (!cancellable.includes(task.status)) {
    return { ok: false, error: `Task ${taskCode} is ${task.status}, cannot cancel` };
  }

  await pgPool.query(
    `UPDATE agv_tasks SET status='cancelled', cancelled_at=NOW(), cancelled_reason=$1, updated_at=NOW() WHERE id=$2`,
    [reason, task.id]
  );

  if (task.agv_id) {
    await pgPool.query(
      `UPDATE agv_fleet SET status='idle', current_task_id=NULL, updated_at=NOW() WHERE id=$1`,
      [task.agv_id]
    );
  }

  await logAudit("task_cancel", { taskCode, reason }, { status: "cancelled" });
  return { ok: true, task_code: taskCode, status: "cancelled", reason };
}

/**
 * Block a zone (maintenance/obstruction) — mark all stations in zone as unavailable for routing.
 */
async function blockZone(zoneCode, stationCode, reason = "") {
  const zoneRow = await pgPool.query("SELECT id FROM agv_zones WHERE code = $1", [zoneCode]);
  if (!zoneRow.rows.length) return { ok: false, error: `Zone ${zoneCode} not found` };

  const zoneId = zoneRow.rows[0].id;

  if (stationCode) {
    await pgPool.query(
      `UPDATE agv_stations SET status='blocked', updated_at=NOW() WHERE code=$1 AND zone_id=$2`,
      [stationCode, zoneId]
    );
  } else {
    await pgPool.query(
      `UPDATE agv_stations SET status='blocked', updated_at=NOW() WHERE zone_id=$1`,
      [zoneId]
    );
  }

  await logAudit("zone_block", { zoneCode, stationCode, reason }, { blocked: true });
  await sendLineNotify(`🚧 [AGV区域封锁] ${zoneCode}${stationCode ? "/" + stationCode : ""} — ${reason}`);
  return { ok: true, zone_code: zoneCode, station_code: stationCode, blocked: true };
}

/**
 * Unblock a previously blocked zone.
 */
async function unblockZone(zoneCode, stationCode) {
  const zoneRow = await pgPool.query("SELECT id FROM agv_zones WHERE code = $1", [zoneCode]);
  if (!zoneRow.rows.length) return { ok: false, error: `Zone ${zoneCode} not found` };

  const zoneId = zoneRow.rows[0].id;

  if (stationCode) {
    await pgPool.query(
      `UPDATE agv_stations SET status='active', updated_at=NOW() WHERE code=$1 AND zone_id=$2`,
      [stationCode, zoneId]
    );
  } else {
    await pgPool.query(
      `UPDATE agv_stations SET status='active', updated_at=NOW() WHERE zone_id=$1`,
      [zoneId]
    );
  }

  await logAudit("zone_unblock", { zoneCode, stationCode }, { blocked: false });
  return { ok: true, zone_code: zoneCode, station_code: stationCode, blocked: false };
}

/**
 * Route a specific AGV to the nearest charging station.
 */
async function routeToCharging(agvCode) {
  const agvRow = await pgPool.query(
    "SELECT id, battery_pct FROM agv_fleet WHERE code = $1", [agvCode]
  );
  if (!agvRow.rows.length) return { ok: false, error: `AGV ${agvCode} not found` };

  // Find nearest charging station
  const station = await pgPool.query(`
    SELECT s.id, z.code AS zone_code, z.x_coord, z.y_coord
    FROM agv_stations s JOIN agv_zones z ON z.id = s.zone_id
    WHERE s.station_type = 'charging' AND s.status = 'active'
    ORDER BY z.x_coord ASC
    LIMIT 1
  `);

  if (!station.rows.length) return { ok: false, error: "No charging station available" };

  const st = station.rows[0];

  // Update AGV status
  await pgPool.query(
    `UPDATE agv_fleet SET status='charging', updated_at=NOW() WHERE code=$1`,
    [agvCode]
  );

  // Log charging start
  await pgPool.query(
    `INSERT INTO agv_charging_log (agv_id, agv_code, station_id, start_battery_pct)
     VALUES ($1, $2, $3, $4)`,
    [agvRow.rows[0].id, agvCode, st.id, agvRow.rows[0].battery_pct]
  );

  // Enqueue command
  await enqueueAgvCommand(agvCode, "charge", { station_id: st.id });

  await logAudit("route_charging", { agvCode, station_id: st.id }, { status: "charging" });
  await sendLineNotify(`🔋 [AGV充电] ${agvCode} → ${st.zone_code} 充电站`);
  return { ok: true, agv_code: agvCode, station_id: st.id, status: "charging" };
}

/**
 * Route all idle AGVs with low battery to charging.
 */
async function routeLowBatteryAgvs() {
  const lowBattery = await pgPool.query(`
    SELECT code, battery_pct, low_battery_threshold
    FROM agv_fleet
    WHERE status IN ('idle', 'charging')
      AND battery_pct <= low_battery_threshold
  `);

  const results = [];
  for (const agv of lowBattery.rows) {
    try {
      const r = await routeToCharging(agv.code);
      results.push(r);
    } catch (err) {
      results.push({ ok: false, agv_code: agv.code, error: err.message });
    }
  }

  return { ok: true, action: "route-low-battery", results };
}

/**
 * Assign all pending tasks to best available AGVs.
 */
async function assignPendingTasks() {
  const pending = await pgPool.query(`
    SELECT t.id, t.task_code, t.task_type, t.priority, t.load_type, t.load_kg,
           t.from_zone_id, t.to_zone_id,
           fz.code AS from_zone, fz.x_coord AS from_x, fz.y_coord AS from_y,
           tz.code AS to_zone,   tz.x_coord AS to_x,   tz.y_coord AS to_y
    FROM agv_tasks t
    JOIN agv_zones fz ON fz.id = t.from_zone_id
    JOIN agv_zones tz ON tz.id = t.to_zone_id
    WHERE t.status = 'pending'
    ORDER BY t.priority ASC, t.created_at ASC
  `);

  const available = await pgPool.query(`
    SELECT id, code, agv_type, battery_pct, low_battery_threshold,
           x_coord, y_coord, current_zone_id
    FROM agv_fleet
    WHERE status IN ('idle', 'charging')
      AND battery_pct > low_battery_threshold + 10
    ORDER BY battery_pct DESC
  `);

  const results = [];

  for (const task of pending.rows) {
    if (!available.rows.length) break;

    // Pick AGV with highest battery (simple heuristic)
    const bestIdx = 0;
    const best = available.rows.splice(bestIdx, 1)[0];

    // Assign task
    const r = await assignTask(task.id, best.code);
    results.push({ task_code: task.task_code, agv_code: best.code, ...r });
  }

  return { ok: true, action: "assign-pending-tasks", results };
}

/**
 * Alert operators about stuck tasks (en_route or in_progress > threshold minutes).
 */
async function alertStuckTasks(thresholdMin = 30) {
  const stuck = await pgPool.query(`
    SELECT t.id, t.task_code, t.task_type, t.status, t.agv_id,
           a.code AS agv_code, a.battery_pct,
           EXTRACT(EPOCH FROM (NOW() - t.dispatched_at))/60 AS minutes_in_status
    FROM agv_tasks t
    JOIN agv_fleet a ON a.id = t.agv_id
    WHERE t.status IN ('en_route', 'in_progress', 'dispatched')
      AND NOW() - t.dispatched_at > INTERVAL '1 minute' * $1
    ORDER BY minutes_in_status DESC
  `, [thresholdMin]);

  for (const task of stuck.rows) {
    await sendLineNotify(
      `🚨 [AGV任务卡住] ${task.task_code} (${task.agv_code}) 状态:${task.status} ` +
      `已持续${Math.round(task.minutes_in_status)}分钟`
    );
  }

  await logAudit("alert_stuck", { threshold_min: thresholdMin }, { stuck_count: stuck.rows.length });
  return { ok: true, action: "alert-stuck-tasks", stuck_count: stuck.rows.length };
}

/**
 * Escalate unresolved critical AGV alerts to LINE.
 */
async function escalateAlerts() {
  const critical = await pgPool.query(`
    SELECT a.id, a.agv_code, a.alert_type, a.severity, a.message, a.created_at
    FROM agv_alerts a
    WHERE a.resolved = false AND a.severity = 'critical'
    ORDER BY a.created_at DESC
    LIMIT 10
  `);

  for (const alert of critical.rows) {
    await sendLineNotify(
      `🚨 [AGV紧急告警] ${alert.agv_code} — ${alert.alert_type}: ${alert.message}`
    );
  }

  await logAudit("escalate_alerts", {}, { critical_count: critical.rows.length });
  return { ok: true, action: "escalate-alerts", critical_count: critical.rows.length };
}

// ── CLI dispatch ─────────────────────────────────────────────────────
async function main() {
  const action = process.argv[2];
  if (!action) {
    console.error("Usage: node agv-execute.js <action> [options]");
    console.error("Actions: create-task, assign-task, cancel-task, block-zone, unblock-zone, route-to-charging, route-low-battery, assign-pending-tasks, alert-stuck-tasks, escalate-alerts");
    process.exit(1);
  }

  const opts = {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const key = process.argv[i].slice(2);
      opts[key] = process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith("--")
        ? process.argv[i + 1] : true;
      if (opts[key] !== true) i++;
    }
  }

  try {
    let result;
    switch (action) {
      case "create-task": {
        result = await createTask({
          taskCode:   opts["task-code"],
          taskType:   opts["task-type"],
          fromZone:   opts["from-zone"],
          toZone:     opts["to-zone"],
          fromStation: opts["from-station"],
          toStation:   opts["to-station"],
          workOrder:   opts["work-order"],
          line:        opts["line"],
          loadType:    opts["load-type"],
          loadKg:      opts["load-kg"] ? parseFloat(opts["load-kg"]) : 100,
          priority:    opts["priority"] ? parseInt(opts["priority"]) : 5,
        });
        break;
      }
      case "assign-task": {
        result = await assignTask(
          parseInt(opts["task-id"]),
          opts["agv-code"]
        );
        break;
      }
      case "cancel-task": {
        result = await cancelTask(opts["task-code"], opts["reason"] || "");
        break;
      }
      case "block-zone": {
        result = await blockZone(opts.zone, opts.station || null, opts.reason || "");
        break;
      }
      case "unblock-zone": {
        result = await unblockZone(opts.zone, opts.station || null);
        break;
      }
      case "route-to-charging": {
        result = await routeToCharging(opts.agv);
        break;
      }
      case "route-low-battery": {
        result = await routeLowBatteryAgvs();
        break;
      }
      case "assign-pending-tasks": {
        result = await assignPendingTasks();
        break;
      }
      case "alert-stuck-tasks": {
        result = await alertStuckTasks(
          opts["threshold-min"] ? parseInt(opts["threshold-min"]) : 30
        );
        break;
      }
      case "escalate-alerts": {
        result = await escalateAlerts();
        break;
      }
      default:
        console.error(`Unknown action: ${action}`);
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
    await pgPool.end();
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }));
    await pgPool.end();
    process.exit(1);
  }
}

main();
