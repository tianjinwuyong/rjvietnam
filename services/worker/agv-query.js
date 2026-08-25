/**
 * agv-query.js — AGV AI Manager DB query tool
 * Direct PostgreSQL queries for the AGV fleet and task system.
 *
 * Usage: node agv-query.js [scope]
 *   scope: fleet | tasks | positions | stations | alerts | kpi | zones | all
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

const scope = process.argv[2] ?? "all";

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Fleet ─────────────────────────────────────────────────────────
async function getFleet() {
  const fleet = await query(`
    SELECT f.id, f.code, f.name_zh, f.agv_type, f.model, f.serial_no,
           f.status, f.battery_pct, f.max_load_kg,
           f.x_coord, f.y_coord, f.heading, f.speed_mps,
           f.total_distance_m, f.total_tasks,
           f.low_battery_threshold, f.battery_cycle_count,
           f.last_heartbeat_at, f.last_maintenance_at,
           z.code AS zone_code, z.name_zh AS zone_name,
           t.task_code AS current_task_code, t.task_type AS current_task_type,
           CASE WHEN f.battery_pct <= f.low_battery_threshold THEN true ELSE false END AS is_low_battery
    FROM agv_fleet f
    LEFT JOIN agv_zones z ON z.id = f.current_zone_id
    LEFT JOIN agv_tasks t ON t.id = f.current_task_id
    ORDER BY f.code
  `);

  const summary = {
    total: fleet.length,
    idle:        fleet.filter(r => r.status === "idle").length,
    busy:        fleet.filter(r => r.status === "busy").length,
    charging:    fleet.filter(r => r.status === "charging").length,
    maintenance: fleet.filter(r => r.status === "maintenance").length,
    error:       fleet.filter(r => r.status === "error").length,
    offline:     fleet.filter(r => r.status === "offline").length,
    low_battery: fleet.filter(r => r.is_low_battery).length,
    shuttle:     fleet.filter(r => r.agv_type === "shuttle").length,
    forklift:    fleet.filter(r => r.agv_type === "forklift").length,
  };

  return { summary, fleet };
}

// ── Tasks ─────────────────────────────────────────────────────────
async function getTasks(statusFilter) {
  let sql = `
    SELECT t.id, t.task_code, t.task_type, t.priority, t.status,
           t.load_type, t.load_kg,
           t.created_at, t.dispatched_at, t.started_at, t.completed_at,
           t.actual_distance_m, t.actual_duration_s,
           a.code AS agv_code, a.name_zh AS agv_name, a.agv_type,
           fz.code AS from_zone, fz.name_zh AS from_zone_name,
           tz.code AS to_zone,   tz.name_zh AS to_zone_name,
           fs.code AS from_station, ts.code AS to_station,
           wo.code AS work_order_code, pl.internal_code AS line_code,
           CASE WHEN t.status IN ('en_route','in_progress','dispatched')
                AND NOW() - t.dispatched_at > INTERVAL '1 minute' * 30
                THEN true ELSE false END AS is_stuck
    FROM agv_tasks t
    LEFT JOIN agv_fleet a  ON a.id = t.agv_id
    LEFT JOIN agv_zones fz ON fz.id = t.from_zone_id
    LEFT JOIN agv_zones tz ON tz.id = t.to_zone_id
    LEFT JOIN agv_stations fs ON fs.id = t.from_station_id
    LEFT JOIN agv_stations ts ON ts.id = t.to_station_id
    LEFT JOIN work_orders wo ON wo.id = t.work_order_id
    LEFT JOIN production_lines pl ON pl.id = t.line_id
  `;
  const params = [];
  if (statusFilter && statusFilter !== "all") {
    const statuses = statusFilter.split(",");
    sql += ` WHERE t.status IN (${statuses.map((_, i) => `$${i + 1}`).join(",")})`;
    params.push(...statuses);
  }
  sql += " ORDER BY t.priority ASC, t.created_at ASC LIMIT 100";

  const tasks = await query(sql, params);

  const summary = {
    total:       tasks.length,
    pending:     tasks.filter(r => r.status === "pending").length,
    assigned:    tasks.filter(r => r.status === "assigned").length,
    dispatched:  tasks.filter(r => r.status === "dispatched").length,
    en_route:    tasks.filter(r => r.status === "en_route").length,
    in_progress: tasks.filter(r => r.status === "in_progress").length,
    completed:   tasks.filter(r => r.status === "completed").length,
    failed:      tasks.filter(r => r.status === "failed").length,
    cancelled:   tasks.filter(r => r.status === "cancelled").length,
    stuck:       tasks.filter(r => r.is_stuck).length,
  };

  return { summary, tasks };
}

// ── Positions ─────────────────────────────────────────────────────
async function getPositions() {
  return query(`
    SELECT p.id, p.agv_code, p.zone_code,
           p.x_coord, p.y_coord, p.heading, p.speed_mps, p.battery_pct,
           p.task_id, p.occurred_at
    FROM agv_positions p
    WHERE p.occurred_at >= NOW() - INTERVAL '1 hour'
    ORDER BY p.agv_code, p.occurred_at DESC
    LIMIT 500
  `);
}

// ── Stations ──────────────────────────────────────────────────────
async function getStations() {
  return query(`
    SELECT s.id, s.code, s.name_zh, s.station_type, s.status,
           s.supports_forklift, s.supports_shuttle, s.max_load_kg,
           z.code AS zone_code, z.name_zh AS zone_name, z.x_coord, z.y_coord
    FROM agv_stations s
    JOIN agv_zones z ON z.id = s.zone_id
    ORDER BY s.code
  `);
}

// ── Zones ─────────────────────────────────────────────────────────
async function getZones() {
  return query(`
    SELECT id, code, name_zh, zone_type, area, x_coord, y_coord,
           is_charging, is_parking, status
    FROM agv_zones
    ORDER BY code
  `);
}

// ── Alerts ────────────────────────────────────────────────────────
async function getAlerts() {
  const alerts = await query(`
    SELECT a.id, a.agv_code, a.alert_type, a.severity, a.message,
           a.resolved, a.resolved_at, a.resolved_by, a.created_at,
           f.agv_type
    FROM agv_alerts a
    LEFT JOIN agv_fleet f ON f.id = a.agv_id
    ORDER BY a.created_at DESC
    LIMIT 100
  `);

  const summary = {
    total:         alerts.length,
    unresolved:     alerts.filter(r => !r.resolved).length,
    critical:      alerts.filter(r => r.severity === "critical" && !r.resolved).length,
    warning:       alerts.filter(r => r.severity === "warning" && !r.resolved).length,
    info:          alerts.filter(r => r.severity === "info" && !r.resolved).length,
  };

  return { summary, alerts };
}

// ── KPI ───────────────────────────────────────────────────────────
async function getKpi() {
  const [taskStats, chargeStats, alertStats] = await Promise.all([
    query(`
      SELECT
        COUNT(*)::int                                            AS total_30d,
        COUNT(*) FILTER (WHERE status = 'completed')::int        AS completed_30d,
        COUNT(*) FILTER (WHERE status = 'failed')::int           AS failed_30d,
        AVG(duration_s) FILTER (WHERE duration_s > 0)::int       AS avg_duration_s,
        AVG(distance_m) FILTER (WHERE distance_m > 0)::numeric   AS avg_distance_m,
        AVG(battery_start_pct - battery_end_pct)::numeric         AS avg_battery_drop_pct
      FROM agv_task_history
      WHERE completed_at >= NOW() - INTERVAL '30 days'
    `),
    query(`
      SELECT COUNT(*)::int                                  AS total_sessions,
             AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::int AS avg_charge_min,
             AVG(end_battery_pct - start_battery_pct)::numeric     AS avg_charge_pct
      FROM agv_charging_log
      WHERE ended_at >= NOW() - INTERVAL '30 days'
    `),
    query(`
      SELECT alert_type, severity, COUNT(*)::int AS cnt
      FROM agv_alerts
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY alert_type, severity
      ORDER BY COUNT(*) DESC
    `),
  ]);

  const ts = taskStats[0] || {};
  const cs = chargeStats[0] || {};

  return {
    task_kpi: {
      total_30d:          ts.total_30d || 0,
      completed_30d:     ts.completed_30d || 0,
      failed_30d:        ts.failed_30d || 0,
      completion_rate:   ts.total_30d > 0
        ? ((ts.completed_30d / ts.total_30d) * 100).toFixed(1) + "%" : "0.0%",
      avg_duration_min:   ts.avg_duration_s ? (ts.avg_duration_s / 60).toFixed(1) : "0.0",
      avg_distance_m:     Number(ts.avg_distance_m) || 0,
      avg_battery_drop:   Number(ts.avg_battery_drop_pct) || 0,
    },
    charging: {
      total_sessions_30d: cs.total_sessions || 0,
      avg_charge_min:     cs.avg_charge_min ? (cs.avg_charge_min / 60).toFixed(1) : "0.0",
      avg_charge_pct:     Number(cs.avg_charge_pct) || 0,
    },
    alert_summary_30d: alertStats,
    generated_at: new Date().toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  try {
    let result = {};

    switch (scope) {
      case "fleet":
        result = await getFleet();
        break;
      case "tasks":
        result = await getTasks(process.argv[3] ?? null);
        break;
      case "positions":
        result = { scope: "positions", data: await getPositions() };
        break;
      case "stations":
        result = { scope: "stations", data: await getStations() };
        break;
      case "zones":
        result = { scope: "zones", data: await getZones() };
        break;
      case "alerts":
        result = await getAlerts();
        break;
      case "kpi":
        result = await getKpi();
        break;
      case "all": {
        const [fleet, tasks, positions, stations, zones, alerts, kpi] = await Promise.all([
          getFleet(), getTasks(null), getPositions(), getStations(), getZones(), getAlerts(), getKpi(),
        ]);
        result = { scope: "all", timestamp: new Date().toISOString(),
                   fleet, tasks, positions, stations, zones, alerts, kpi };
        break;
      }
      default:
        console.error(`Unknown scope: ${scope}`);
        console.error("Usage: node agv-query.js [fleet|tasks|positions|stations|zones|alerts|kpi|all]");
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
    await pool.end();
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }));
    await pool.end();
    process.exit(1);
  }
}

main();
