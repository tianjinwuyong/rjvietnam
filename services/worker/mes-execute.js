/**
 * mes-execute.js — MES AI Manager executor
 * Bridges Ornith decisions to actual API calls.
 * Generates its own JWT using the shared secret.
 *
 * Usage:
 *   node mes-execute.js <action> [options]
 *
 * Actions:
 *   line-alert        --line <code> --severity <level> --message <text>
 *   yield-warning     --line <code> --station <code> --yield <pct> --baseline <pct>
 *   resolve-stagnation --id <id> [--notes <text>]
 *   approve-scrap     --id <id> [--reject]
 *   flag-downtime     --id <id> --severity <level>
 *   check-feeder      --binding-id <id>
 *   generate-digest   --type <morning|evening>
 *   line-check        --line <code>
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────
const JWT_SECRET     = process.env.JWT_SECRET     ?? "smt-factory-secret-2026";
const API_BASE       = process.env.API_BASE       ?? "http://127.0.0.1:8080";
const LINE_TOKEN_FILE = "services/worker/line_token.txt";

const pgPool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── JWT generation ───────────────────────────────────────────────────────
function getJwt(roleKey = "admin") {
  return jwt.sign(
    {
      userId: 10,
      username: "mes-ai",
      roleKey,
      permissions: ["mes.view", "mes.execute", "mes.bind", "quality.view", "quality.inspect"],
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// ── API helper ──────────────────────────────────────────────────────────
async function apiCall(method, path, body = null) {
  const token = getJwt();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();

  if (!res.ok) {
    throw new Error(`API ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// ── LINE Notify ──────────────────────────────────────────────────────────
async function sendLineNotify(message) {
  const tokenPath = join(process.cwd(), LINE_TOKEN_FILE);
  if (!existsSync(tokenPath)) {
    console.error(JSON.stringify({ error: "LINE token file not found", path: tokenPath }));
    return { sent: false, reason: "no_token" };
  }
  const lineToken = readFileSync(tokenPath, "utf-8").trim();
  if (!lineToken) return { sent: false, reason: "empty_token" };

  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${lineToken}`,
    },
    body: new URLSearchParams({ message }),
  });
  const result = await res.json();
  return { sent: res.ok, status: res.status, result };
}

// ── AGV API helpers ─────────────────────────────────────────────────────

const AGV_API_BASE = process.env.AGV_API_BASE ?? "http://127.0.0.1:8081";

/**
 * Enqueue a command for an AGV device via the AGV REST API.
 * The AGV will poll GET /agv/commands?agv_code=X and pick it up.
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
    if (!res.ok) {
      console.error(`[AGV-API] enqueue failed: ${JSON.stringify(json)}`);
      return { ok: false, error: json.error ?? "unknown" };
    }
    return { ok: true, command: json.command };
  } catch (err) {
    console.error(`[AGV-API] enqueue error: ${err.message}`);
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

// ── Audit log entry ─────────────────────────────────────────────────────
async function logAudit(area, decisionType, inputData, outputDecision, executed = true) {
  try {
    await pgPool.query(
      `INSERT INTO mes_manager_audit_log
       (agent, area, decision_type, input_data, output_decision, executed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      ["mes-ai", area, decisionType, JSON.stringify(inputData), JSON.stringify(outputDecision), executed]
    );
  } catch (err) {
    console.error(`Audit log error: ${err.message}`);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────

async function lineAlert(lineCode, severity, message) {
  const input = { lineCode, severity, message };
  console.error(`[MES] LINE alert [${severity}] ${lineCode}: ${message}`);

  const lineResult = await sendLineNotify(`[MES ${severity.toUpperCase()}] ${lineCode}: ${message}`);
  await logAudit("line", "line_alert", input, { severity, message, line_sent: lineResult.sent });

  return { ok: true, action: "line-alert", line_sent: lineResult.sent, severity, lineCode };
}

async function yieldWarning(lineCode, stationCode, yieldPct, baselinePct) {
  const input = { lineCode, stationCode, yield: yieldPct, baseline: baselinePct };
  const drop = baselinePct - yieldPct;
  const level = drop > 10 ? "critical" : drop > 5 ? "warning" : "info";

  await logAudit("quality", "yield_warning", input, { level, drop });
  console.error(`[MES] Yield [${level}] ${lineCode}/${stationCode}: ${yieldPct}% vs baseline ${baselinePct}% (drop: ${drop}%)`);

  return { ok: true, action: "yield-warning", level, lineCode, stationCode, yield: yieldPct, drop };
}

async function resolveStagnation(id, notes = "") {
  const input = { id, notes };
  try {
    const result = await apiCall("PATCH", `/mes/stagnation/${id}/resolve`, { payload: { notes } });
    await logAudit("stagnation", "resolve_stagnation", input, result);
    return { ok: true, action: "resolve-stagnation", id, status: "resolved" };
  } catch (err) {
    console.error(`[MES] Failed to resolve stagnation ${id}: ${err.message}`);
    // DB fallback
    await pgPool.query(
      "UPDATE stagnation_log SET status = 'resolved', resolved_at = NOW(), notes = COALESCE($1, notes) WHERE id = $2",
      [notes || null, id]
    );
    await logAudit("stagnation", "resolve_stagnation_db", input, { status: "resolved", fallback: true });
    return { ok: true, action: "resolve-stagnation", id, status: "resolved", fallback: true };
  }
}

async function approveScrap(id, reject = false) {
  const newStatus = reject ? "rejected" : "approved";
  const input = { id, status: newStatus };
  try {
    const result = await apiCall("PATCH", `/mes/scraps/${id}`, { payload: { status: newStatus } });
    await logAudit("scrap", "scrap_decision", input, result);
    return { ok: true, action: "approve-scrap", id, status: newStatus };
  } catch (err) {
    console.error(`[MES] Failed to update scrap ${id}: ${err.message}`);
    // DB fallback
    await pgPool.query(
      "UPDATE scrap_records SET status = $1, approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END WHERE id = $2",
      [newStatus, id]
    );
    await logAudit("scrap", "scrap_decision_db", input, { status: newStatus, fallback: true });
    return { ok: true, action: "approve-scrap", id, status: newStatus, fallback: true };
  }
}

async function flagDowntime(id, severity) {
  const input = { id, severity };
  try {
    await pgPool.query(
      "UPDATE downtime_records SET notes = COALESCE(notes || E'\n', '') || $1 WHERE id = $2",
      [`[MES-${severity.toUpperCase()}] Flagged at ${new Date().toISOString()}`, id]
    );
    await logAudit("downtime", "downtime_flag", input, { severity, id });
    // If critical, send LINE alert
    if (severity === "critical") {
      const rows = await pgPool.query(
        "SELECT downtime_no, line_code, reason_detail FROM downtime_records WHERE id = $1", [id]
      );
      if (rows.rows[0]) {
        const d = rows.rows[0];
        await sendLineNotify(`🔴 [MES Critical Downtime] ${d.downtime_no} | ${d.line_code} | ${d.reason_detail || ""}`);
      }
    }
    return { ok: true, action: "flag-downtime", id, severity };
  } catch (err) {
    console.error(`[MES] Failed to flag downtime ${id}: ${err.message}`);
    return { ok: false, action: "flag-downtime", id, error: err.message };
  }
}

async function checkFeeder(bindingId) {
  const binding = await pgPool.query(
    `SELECT fb.*, s.code AS station_code, s.name_zh AS station_name
     FROM feeder_bindings fb
     JOIN stations s ON s.code = fb.station_code
     WHERE fb.id = $1`,
    [bindingId]
  );
  if (!binding.rows[0]) return { ok: false, error: `Binding ${bindingId} not found` };

  const b = binding.rows[0];
  // Find fool-proof rules for this station + feeder slot
  const rules = await pgPool.query(
    `SELECT * FROM fool_proof_rules
     WHERE station_code = $1 AND feeder_slot = $2 AND status = 'active'`,
    [b.station_code, b.feeder_no]
  );

  const result = {
    binding: { id: b.id, feederNo: b.feeder_no, reelCode: b.reel_code, materialCode: b.material_code, stationCode: b.station_code },
    matchingRules: rules.rows.map(r => ({
      id: r.id, stationCode: r.station_code, feederSlot: r.feeder_slot,
      expectedMaterial: r.material_code, ruleType: r.rule_type,
    })),
    match: rules.rows.length === 0 ? "no_rules" : rules.rows.some(r => r.material_code === b.material_code) ? "match" : "mismatch",
  };

  await logAudit("feeder", "feeder_check", { bindingId }, result);
  return { ok: true, action: "check-feeder", ...result };
}

async function generateDigest(type) {
  const isMorning = type === "morning";
  const lines = await pgPool.query(
    "SELECT internal_code, status, name_zh FROM production_lines ORDER BY internal_code"
  );

  const runs = await pgPool.query(
    `SELECT mr.*, pl.internal_code AS line_code, wo.code AS wo_code
     FROM mes_runs mr
     JOIN production_lines pl ON pl.id = mr.line_id
     JOIN work_orders wo ON wo.code = mr.work_order_code
     WHERE mr.status = 'running'
     ORDER BY mr.created_at DESC`
  );

  const events = await pgPool.query(
    `SELECT pl.internal_code AS line_code,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE se.result = 'PASS') AS passes,
       COUNT(*) FILTER (WHERE se.result = 'FAIL') AS fails
     FROM station_events se
     JOIN stations s ON s.id = se.station_id
     JOIN production_lines pl ON pl.id = s.line_id
     WHERE se.occurred_at >= NOW() - INTERVAL '24 hours'
     GROUP BY pl.internal_code`
  );

  const stagnation = await pgPool.query(
    "SELECT COUNT(*) AS count FROM stagnation_log WHERE status IN ('open', 'escalated')"
  );

  const scraps = await pgPool.query(
    "SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS total_qty FROM scrap_records WHERE status = 'pending'"
  );

  const lineStatuses = lines.rows.map(l => `${l.name_zh}: ${l.status === "running" ? "✅ Running" : l.status === "changeover" ? "🟡 Changeover" : l.status === "down" ? "🔴 Down" : "⚪ Idle"}`).join("\n  ");

  const runInfo = runs.rows.map(r => `  ${r.line_code}: ${r.wo_code} (${r.completed_qty}/${r.planned_qty})`).join("\n");

  const yieldInfo = events.rows.map(e => {
    const rate = e.total > 0 ? ((e.passes / e.total) * 100).toFixed(1) : "N/A";
    return `  ${e.line_code}: ${rate}% (${e.passes}/${e.total})`;
  }).join("\n");

  const header = isMorning
    ? `🌅 MES晨报 ${new Date().toLocaleDateString("zh-CN")}`
    : `🌇 MES日报 ${new Date().toLocaleDateString("zh-CN")}`;

  const message = `${header}
━━━━━━━━━━━━━━━━━━
🏭 产线状态
  ${lineStatuses || "  (无数据)"}

📊 24h良率
${yieldInfo || "  (无数据)"}

${runs.rows.length > 0 ? `📋 运行中工单\n${runInfo}\n` : ""}
⚠️ 待处理:
  呆滞PCB: ${stagnation.rows[0]?.count ?? 0}批
  待审批报废: ${scraps.rows[0]?.count ?? 0}批 (${scraps.rows[0]?.total_qty ?? 0}pcs)`;

  return {
    ok: true,
    action: "generate-digest",
    type,
    message,
    stats: {
      lines: lines.rows.length,
      runningRuns: runs.rows.length,
      events24h: events.rows.reduce((s, r) => s + Number(r.total), 0),
      stagnationCount: Number(stagnation.rows[0]?.count ?? 0),
      pendingScraps: Number(scraps.rows[0]?.count ?? 0),
    },
  };
}

async function lineCheck(lineCode) {
  const [line, activeRuns, recentEvents, openDowntimes] = await Promise.all([
    pgPool.query(
      "SELECT internal_code, status, name_zh, name_en FROM production_lines WHERE internal_code = $1",
      [lineCode]
    ),
    pgPool.query(
      `SELECT mr.*, wo.code AS wo_code
       FROM mes_runs mr
       JOIN work_orders wo ON wo.code = mr.work_order_code
       WHERE mr.line_id = (SELECT id FROM production_lines WHERE internal_code = $1)
       AND mr.status = 'running'`,
      [lineCode]
    ),
    pgPool.query(
      `SELECT se.event_type, se.result, se.occurred_at, se.operator,
              st.name_zh AS station_name
       FROM station_events se
       JOIN stations s ON s.id = se.station_id
       JOIN station_types st ON st.code = s.station_type
       WHERE s.line_id = (SELECT id FROM production_lines WHERE internal_code = $1)
       ORDER BY se.occurred_at DESC LIMIT 20`,
      [lineCode]
    ),
    pgPool.query(
      `SELECT * FROM downtime_records
       WHERE line_code = $1 AND status = 'open'
       ORDER BY start_at DESC`,
      [lineCode]
    ),
  ]);

  return {
    ok: true,
    action: "line-check",
    line: line.rows[0] ?? null,
    activeRuns: activeRuns.rows,
    recentEvents: recentEvents.rows,
    openDowntimes: openDowntimes.rows,
  };
}

// ── AGV Actions ─────────────────────────────────────────────────────────

async function agvDispatch(taskId) {
  const taskIdInt = parseInt(taskId, 10);
  const task = await pgPool.query(
    "SELECT * FROM agv_tasks WHERE id = $1", [taskIdInt]
  );
  if (!task.rows.length) throw new Error(`AGV task ${taskId} not found`);

  const t = task.rows[0];
  if (t.status !== 'pending' && t.status !== 'assigned')
    throw new Error(`Task ${t.task_code} is ${t.status}, cannot dispatch`);

  // Find best available AGV based on: correct type, sufficient battery, proximity
  const availableAgvs = await pgPool.query(`
    SELECT id, code, agv_type, battery_pct, current_zone_id, x_coord, y_coord
    FROM agv_fleet
    WHERE status IN ('idle', 'busy')
      AND battery_pct > low_battery_threshold + 10
    ORDER BY battery_pct DESC
    LIMIT 5
  `);

  if (!availableAgvs.rows.length) throw new Error("No available AGVs");

  // Simple proximity dispatch — pick nearest AGV by Euclidean distance
  const destX = t.from_zone_id; // simplified: use zone coord lookup
  let best = null, bestDist = Infinity;
  for (const agv of availableAgvs.rows) {
    const dist = Math.sqrt(
      Math.pow((agv.x_coord || 0) - (destX || 0), 2) +
      Math.pow((agv.y_coord || 0) - (destX || 0), 2)
    );
    if (dist < bestDist) { bestDist = dist; best = agv; }
  }

  await pgPool.query(
    `UPDATE agv_tasks SET status = 'dispatched', agv_id = $1, dispatched_at = NOW()
     WHERE id = $2`,
    [best.id, taskIdInt]
  );
  await pgPool.query(
    `UPDATE agv_fleet SET status = 'busy', current_task_id = $1 WHERE id = $2`,
    [taskIdInt, best.id]
  );

  // Enqueue command via AGV REST API (AGV polls GET /agv/commands)
  const apiResult = await enqueueAgvCommand(best.code, "dispatch", {
    task_id: taskIdInt,
    task_code: t.task_code,
    task_type: t.task_type,
    from_zone_id: t.from_zone_id,
    to_zone_id: t.to_zone_id,
    from_station_id: t.from_station_id,
    to_station_id: t.to_station_id,
    load_type: t.load_type,
    load_kg: t.load_kg,
    priority: t.priority,
  });

  await logAudit("agv", "agv_dispatch", { task_id: taskIdInt, agv_id: best.id }, { agv_code: best.code, task_code: t.task_code, api_enqueued: apiResult.ok });
  await sendLineNotify(`[AGV Dispatch] ${best.code} → ${t.task_code} (${t.task_type})`);

  return { ok: true, action: "agv-dispatch", task_id: taskIdInt, agv_code: best.code, agv_id: best.id, status: "dispatched", command_enqueued: apiResult.ok };
}

async function agvReturn(agvCode) {
  const agv = await pgPool.query("SELECT id FROM agv_fleet WHERE code = $1", [agvCode]);
  if (!agv.rows.length) throw new Error(`AGV ${agvCode} not found`);

  // Find nearest charging station
  const station = await pgPool.query(`
    SELECT s.id, z.x_coord, z.y_coord
    FROM agv_stations s JOIN agv_zones z ON z.id = s.zone_id
    WHERE s.station_type = 'charging'
    ORDER BY z.x_coord ASC
    LIMIT 1
  `);

  const stationId = station.rows[0]?.id;

  // Create return-to-charging task
  const taskCode = `AGV-T${Date.now().toString().slice(-5)}`;
  await pgPool.query(
    `INSERT INTO agv_tasks (task_code, task_type, priority, status, agv_id, to_zone_id, to_station_id, created_at)
     VALUES ($1, 'return_charging', 1, 'dispatched', $2,
              (SELECT zone_id FROM agv_stations WHERE id = $3),
              $3, NOW())`,
    [taskCode, agv.rows[0].id, stationId]
  );

  await pgPool.query(
    `UPDATE agv_fleet SET status = 'charging' WHERE code = $1`,
    [agvCode]
  );

  await enqueueAgvCommand(agvCode, "return_charging", {
    task_code: taskCode,
    station_id: stationId,
  });

  await logAudit("agv", "agv_return", { agv_code: agvCode }, { task_code: taskCode, station_id: stationId });
  await sendLineNotify(`[AGV Return] ${agvCode} → charging station`);

  return { ok: true, action: "agv-return", agv_code: agvCode, status: "charging", task_code: taskCode };
}

async function agvPause(agvCode) {
  const agv = await pgPool.query("SELECT id, current_task_id FROM agv_fleet WHERE code = $1", [agvCode]);
  if (!agv.rows.length) throw new Error(`AGV ${agvCode} not found`);

  await pgPool.query(
    `UPDATE agv_fleet SET status = 'idle' WHERE code = $1`,
    [agvCode]
  );
  if (agv.rows[0].current_task_id) {
    await pgPool.query(
      `UPDATE agv_tasks SET status = 'assigned' WHERE id = $1 AND status IN ('dispatched','en_route','in_progress')`,
      [agv.rows[0].current_task_id]
    );
  }

  await enqueueAgvCommand(agvCode, "pause", { task_id: agv.rows[0].current_task_id });
  await logAudit("agv", "agv_pause", { agv_code: agvCode }, { status: "paused" });
  return { ok: true, action: "agv-pause", agv_code: agvCode, status: "paused" };
}

async function agvResume(agvCode) {
  const agv = await pgPool.query("SELECT id FROM agv_fleet WHERE code = $1", [agvCode]);
  if (!agv.rows.length) throw new Error(`AGV ${agvCode} not found`);

  // Find pending task for this AGV and resume
  const pendingTask = await pgPool.query(
    `SELECT id FROM agv_tasks WHERE agv_id = $1 AND status IN ('assigned','pending')
     ORDER BY priority ASC LIMIT 1`,
    [agv.rows[0].id]
  );

  if (pendingTask.rows.length) {
    await pgPool.query(
      `UPDATE agv_tasks SET status = 'dispatched', dispatched_at = NOW() WHERE id = $1`,
      [pendingTask.rows[0].id]
    );
    await pgPool.query(
      `UPDATE agv_fleet SET status = 'busy' WHERE code = $1`, [agvCode]
    );
    await enqueueAgvCommand(agvCode, "resume", { task_id: pendingTask.rows[0].id });
  }

  await logAudit("agv", "agv_resume", { agv_code: agvCode }, { resumed_task_id: pendingTask.rows[0]?.id });
  return { ok: true, action: "agv-resume", agv_code: agvCode, status: "resumed", task_id: pendingTask.rows[0]?.id || null };
}

async function agvTaskComplete(taskId) {
  const taskIdInt = parseInt(taskId, 10);
  const task = await pgPool.query("SELECT * FROM agv_tasks WHERE id = $1", [taskIdInt]);
  if (!task.rows.length) throw new Error(`AGV task ${taskId} not found`);

  const t = task.rows[0];

  // Update task
  await pgPool.query(
    `UPDATE agv_tasks SET status = 'completed', completed_at = NOW(),
     actual_duration_s = EXTRACT(EPOCH FROM (NOW() - started_at))::int
     WHERE id = $1`,
    [taskIdInt]
  );

  // Update AGV to idle
  if (t.agv_id) {
    await pgPool.query(
      `UPDATE agv_fleet SET status = 'idle', current_task_id = NULL,
       total_tasks = total_tasks + 1 WHERE id = $1`,
      [t.agv_id]
    );

    // If battery low, auto-route to charging
    const agv = await pgPool.query("SELECT battery_pct, low_battery_threshold FROM agv_fleet WHERE id = $1", [t.agv_id]);
    if (agv.rows[0] && agv.rows[0].battery_pct <= agv.rows[0].low_battery_threshold) {
      await agvReturn(await pgPool.query("SELECT code FROM agv_fleet WHERE id = $1", [t.agv_id]).then(r => r.rows[0].code));
    }
  }

  // Archive to history
  await pgPool.query(
    `INSERT INTO agv_task_history
     (task_code, task_type, priority, status, agv_code, agv_type,
      from_zone, to_zone, distance_m, duration_s, outcome, completed_at)
     SELECT $1, $2, $3, 'completed',
            f.code, f.agv_type,
            (SELECT code FROM agv_zones WHERE id = $4),
            (SELECT code FROM agv_zones WHERE id = $5),
            0, EXTRACT(EPOCH FROM (NOW() - started_at))::int,
            'success', NOW()
     FROM agv_fleet f WHERE f.id = $6`,
    [t.task_code, t.task_type, t.priority, t.from_zone_id, t.to_zone_id, t.agv_id]
  );

  await logAudit("agv", "agv_task_complete", { task_id: taskIdInt }, { task_code: t.task_code, outcome: "success" });
  await sendLineNotify(`[AGV Complete] ${t.task_code} done`);

  return { ok: true, action: "agv-task-complete", task_id: taskIdInt, task_code: t.task_code, status: "completed" };
}

async function agvCharge(agvCode) {
  const agv = await pgPool.query("SELECT id, battery_pct FROM agv_fleet WHERE code = $1", [agvCode]);
  if (!agv.rows.length) throw new Error(`AGV ${agvCode} not found`);

  const station = await pgPool.query(`
    SELECT s.id, z.code AS zone_code FROM agv_stations s
    JOIN agv_zones z ON z.id = s.zone_id
    WHERE s.station_type = 'charging' ORDER BY z.code LIMIT 1
  `);

  if (!station.rows.length) throw new Error("No charging station available");

  // Log charging start
  await pgPool.query(
    `INSERT INTO agv_charging_log (agv_id, agv_code, station_id, start_battery_pct)
     VALUES ($1, $2, $3, $4)`,
    [agv.rows[0].id, agvCode, station.rows[0].id, agv.rows[0].battery_pct]
  );

  await pgPool.query(
    `UPDATE agv_fleet SET status = 'charging' WHERE code = $1`,
    [agvCode]
  );

  await enqueueAgvCommand(agvCode, "charge", { station_id: station.rows[0].id });
  await logAudit("agv", "agv_charge", { agv_code: agvCode, station_id: station.rows[0].id }, { started: true });
  return { ok: true, action: "agv-charge", agv_code: agvCode, station_id: station.rows[0].id, status: "charging" };
}

// ── Audit log CLI wrapper ──────────────────────────────────────────────
async function auditLogCli(opts) {
  const area = opts.area || "mes";
  const decisionType = opts.decision || "unknown";
  const ornithSummary = opts.ornith || "{}";
  const autoExecute = opts.auto !== "false";
  const cycleId = opts.cycle || "";

  let inputData = {};
  let outputDecision = {};
  try { outputDecision = JSON.parse(ornithSummary); } catch (_) {}

  await logAudit(area, decisionType, inputData, outputDecision, autoExecute);

  return {
    ok: true,
    action: "audit-log",
    area, decisionType, auto: autoExecute, cycleId,
  };
}

// ── CLI dispatch ─────────────────────────────────────────────────────────

async function main() {
  const action = process.argv[2];
  if (!action) {
    console.error("Usage: node mes-execute.js <action> [options]");
    console.error("Actions: line-alert, yield-warning, resolve-stagnation, approve-scrap, flag-downtime, check-feeder, generate-digest, line-check, notify-line, audit-log");
    process.exit(1);
  }

  // Parse --key value or --key=value arguments
  const opts = {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const eqIdx = process.argv[i].indexOf("=");
      if (eqIdx !== -1) {
        const key = process.argv[i].slice(2, eqIdx);
        opts[key] = process.argv[i].slice(eqIdx + 1);
      } else {
        const key = process.argv[i].slice(2);
        opts[key] = process.argv[i + 1] !== undefined && !process.argv[i + 1]?.startsWith("--")
          ? process.argv[i + 1] : true;
        if (opts[key] !== true) i++;
      }
    }
  }

  try {
    let result;
    switch (action) {
      case "line-alert":
        result = await lineAlert(opts.line, opts.severity, opts.message);
        break;
      case "yield-warning":
        result = await yieldWarning(opts.line, opts.station, parseFloat(opts.yield), parseFloat(opts.baseline));
        break;
      case "resolve-stagnation":
        result = await resolveStagnation(parseInt(opts.id), opts.notes);
        break;
      case "approve-scrap":
        result = await approveScrap(parseInt(opts.id), opts.reject !== undefined);
        break;
      case "flag-downtime":
        result = await flagDowntime(parseInt(opts.id), opts.severity);
        break;
      case "check-feeder":
        result = await checkFeeder(parseInt(opts["binding-id"]));
        break;
      case "generate-digest":
        result = await generateDigest(opts.type);
        break;
      case "line-check":
        result = await lineCheck(opts.line);
        break;
      case "notify-line":
        result = await sendLineNotify(opts.message || opts.msg || "");
        break;
      case "audit-log":
        result = await auditLogCli(opts);
        break;
      case "agv-dispatch":
        result = await agvDispatch(opts["task-id"]);
        break;
      case "agv-return":
        result = await agvReturn(opts.agv);
        break;
      case "agv-pause":
        result = await agvPause(opts.agv);
        break;
      case "agv-resume":
        result = await agvResume(opts.agv);
        break;
      case "agv-task-complete":
        result = await agvTaskComplete(opts["task-id"]);
        break;
      case "agv-charge":
        result = await agvCharge(opts.agv);
        break;
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
