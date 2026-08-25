/**
 * mes-query.js — MES AI Manager DB query tool
 * Direct PostgreSQL queries for the SMT factory MES.
 *
 * Usage: node mes-query.js [scope]
 *   scope: lines | runs | events | stagnation | scraps | downtimes | feeders | pcb-serials | fool-proof | first-article | material-verify | oee | all
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── Argument parsing ──────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}
const scope = args.scope ?? process.argv[2] ?? "all";

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Query functions ───────────────────────────────────────────────────────

async function getLines() {
  return query(`
    SELECT pl.id, pl.internal_code AS line_code, pl.name_zh AS line_name_zh, pl.name_en AS line_name_en, pl.name_vi AS line_name_vi, pl.status,
      (SELECT COUNT(*) FROM stations s WHERE s.line_id = pl.id) AS station_count,
      (SELECT COUNT(*) FROM mes_runs mr WHERE mr.line_id = pl.id AND mr.status = 'running') AS active_runs
    FROM production_lines pl
    ORDER BY pl.internal_code
  `);
}

async function getRuns() {
  return query(`
    SELECT mr.id, mr.work_order_code, mr.status, mr.planned_qty, mr.completed_qty, mr.created_at,
      wo.code AS wo_code, wo.work_order_type,
      pl.internal_code AS line_code, pl.name_zh AS line_name_zh,
      p.code AS product_code, p.name_zh AS product_name_zh
    FROM mes_runs mr
    JOIN work_orders wo ON wo.code = mr.work_order_code
    JOIN production_lines pl ON pl.id = mr.line_id
    LEFT JOIN products p ON p.id = wo.product_id
    ORDER BY mr.created_at DESC
    LIMIT 50
  `);
}

async function getEvents() {
  return query(`
    SELECT se.id, se.event_type, se.result, se.occurred_at, se.traceability_key,
      s.code AS station_code, st.code AS station_type, s.name_zh AS station_name_zh,
      pl.internal_code AS line_code, ps.serial_no AS pcb_serial, u.display_name AS operator_name,
      m.code AS machine_code
    FROM station_events_2026 se
    JOIN stations s ON s.id = se.station_id
    JOIN station_types st ON st.id = s.station_type_id
    LEFT JOIN production_lines pl ON pl.id = s.line_id
    LEFT JOIN pcb_serials ps ON ps.id = se.pcb_serial_id
    LEFT JOIN machines m ON m.id = se.machine_id
    LEFT JOIN users u ON u.id = se.operator_id
    ORDER BY se.occurred_at DESC
    LIMIT 100
  `);
}

async function getStagnation() {
  return query(`
    SELECT sl.id, sl.sn, sl.pcb_no, sl.station_code, sl.line_code,
      sl.stagnation_minutes, sl.stagnation_level, sl.status,
      sl.work_order_code, sl.product_model, sl.po_number,
      sl.customer_code, sl.wh_location, sl.overdue_months,
      sl.created_at, sl.resolved_at, sl.notes
    FROM stagnation_log sl
    WHERE sl.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY sl.stagnation_minutes DESC
    LIMIT 50
  `);
}

async function getScraps() {
  return query(`
    SELECT sr.id, sr.sn, sr.pcb_no, sr.product_model,
      sr.scrap_station, sr.line_code, sr.scrap_reason_code,
      src.name_zh AS scrap_reason_name, sr.scrap_reason_detail,
      sr.responsible_person, sr.quantity, sr.status,
      sr.po_number, sr.work_order_code, sr.created_at, sr.approved_at,
      sr.notes
    FROM scrap_records sr
    LEFT JOIN scrap_reason_codes src ON src.code = sr.scrap_reason_code
    ORDER BY sr.created_at DESC
    LIMIT 50
  `);
}

async function getDowntimes() {
  return query(`
    SELECT dr.id, dr.downtime_no, dr.line_code, dr.station_code,
      dr.reason_code, dr.reason_detail, dr.start_at, dr.end_at,
      dr.status, dr.operator,
      pl.name_zh AS line_name_zh
    FROM downtime_records dr
    LEFT JOIN production_lines pl ON pl.internal_code = dr.line_code
    WHERE dr.status = 'open'
    ORDER BY dr.start_at DESC
    LIMIT 50
  `);
}

async function getFeeders() {
  return query(`
    SELECT fb.id, fb.feeder_no, fb.reel_code, fb.bound_at, fb.unbound_at,
      wo.code AS work_order_code,
      pl.internal_code AS line_code,
      mc.code AS machine_code,
      ml.lot_no,
      mat.code AS material_code,
      u.display_name AS operator_name,
      s.code AS station_code, s.name_zh AS station_name_zh,
      mat.name_zh AS material_name_zh
    FROM feeder_bindings fb
    JOIN work_orders wo ON wo.id = fb.work_order_id
    JOIN production_lines pl ON pl.id = fb.line_id
    JOIN machines mc ON mc.id = fb.machine_id
    JOIN stations s ON s.id = mc.station_id
    JOIN material_lots ml ON ml.id = fb.material_lot_id
    JOIN materials mat ON mat.id = ml.material_id
    LEFT JOIN users u ON u.id = fb.operator_id
    WHERE fb.unbound_at IS NULL
    ORDER BY fb.bound_at DESC
    LIMIT 100
  `);
}

async function getPcbSerials() {
  const statusFilter = args.status ?? "wip";
  return query(`
    SELECT ps.id, ps.serial_no, ps.status, ps.created_at,
      wo.code AS work_order_code,
      pl.internal_code AS line_code,
      p.code AS product_code
    FROM pcb_serials ps
    JOIN work_orders wo ON wo.id = ps.work_order_id
    LEFT JOIN production_lines pl ON pl.id = wo.line_id
    LEFT JOIN products p ON p.id = wo.product_id
    WHERE ps.status = $1
    ORDER BY ps.created_at DESC
    LIMIT 100
  `, [statusFilter]);
}

// ── Duplicate serial numbers (quality alert) ─────────────────────────────────
async function getDuplicateSerials() {
  // Finds serial_no values that appear more than once in pcb_serials
  return query(`
    WITH dup AS (
      SELECT serial_no, COUNT(*) AS appearances
      FROM pcb_serials
      WHERE serial_no IS NOT NULL AND serial_no != ''
      GROUP BY serial_no
      HAVING COUNT(*) > 1
    )
    SELECT
      ps.serial_no,
      wo.code            AS work_order_code,
      p.code             AS product_code,
      pl.internal_code   AS line_code,
      ps.status,
      ps.created_at,
      d.appearances
    FROM dup d
    JOIN pcb_serials ps ON ps.serial_no = d.serial_no
    LEFT JOIN work_orders wo ON wo.id = ps.work_order_id
    LEFT JOIN products p ON p.id = wo.product_id
    LEFT JOIN production_lines pl ON pl.id = wo.line_id
    ORDER BY d.appearances DESC, ps.created_at DESC
    LIMIT 50
  `);
}

// ── NG/FAIL events from all stations (last 24h) ───────────────────────────
async function getNgEvents() {
  return query(`
    SELECT se.id, se.event_type, se.result, se.occurred_at,
      s.code             AS station_code,
      st.code            AS station_type,
      s.name_zh          AS station_name,
      pl.internal_code   AS line_code,
      pcs.serial_no      AS pcb_serial,
      u.display_name     AS operator_name,
      mc.code            AS machine_code,
      wo.code            AS wo_code,
      wo.work_order_type,
      p.code             AS product_code,
      p.name_zh          AS product_name
    FROM station_events_2026 se
    JOIN stations        s   ON s.id           = se.station_id
    JOIN station_types    st  ON st.id          = s.station_type_id
    LEFT JOIN production_lines pl ON pl.id     = s.line_id
    LEFT JOIN pcb_serials    pcs ON pcs.id     = se.pcb_serial_id
    LEFT JOIN work_orders     wo  ON wo.id      = pcs.work_order_id
    LEFT JOIN products        p  ON p.id        = wo.product_id
    LEFT JOIN users           u  ON u.id       = se.operator_id
    LEFT JOIN machines        mc  ON mc.id       = se.machine_id
    WHERE se.result IN ('fail', 'reject')
      AND se.occurred_at >= NOW() - INTERVAL '24 hours'
    ORDER BY se.occurred_at DESC
    LIMIT 200
  `);
}

async function getFoolProof() {
  return query(`
    SELECT fpr.id,
      s.code AS station_code, s.name_zh AS station_name,
      pl.internal_code AS line_code, pl.name_zh AS line_name,
      fpr.feeder_slot,
      prod.code AS material_code, prod.name_zh AS material_name,
      fpr.material_reel_code, fpr.rule_type, fpr.status,
      fpr.notes, fpr.created_at, fpr.updated_at
    FROM fool_proof_rules fpr
    JOIN stations s ON s.id = fpr.station_id
    LEFT JOIN production_lines pl ON pl.id = fpr.line_id
    LEFT JOIN products prod ON prod.id = fpr.material_id
    WHERE fpr.status = 'active'
    ORDER BY pl.internal_code, s.code, fpr.feeder_slot
  `);
}

async function getFirstArticle() {
  return query(`
    SELECT fai.id,
      wo.code AS work_order_code,
      s.code AS station_code, s.name_zh AS station_name,
      pl.internal_code AS line_code,
      fai.result,
      fai.checked_by, fai.checked_at, fai.lot_no, fai.remarks,
      fai.created_at
    FROM first_article_inspections fai
    JOIN stations s ON s.id = fai.station_id
    LEFT JOIN work_orders wo ON wo.id = fai.work_order_id
    LEFT JOIN production_lines pl ON pl.id = fai.line_id
    WHERE fai.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY fai.created_at DESC
    LIMIT 50
  `);
}

async function getMaterialVerify() {
  return query(`
    SELECT mv.id,
      wo.code AS work_order_code,
      s.code AS station_code, s.name_zh AS station_name,
      pl.internal_code AS line_code,
      mv.feeder_slot,
      prod.code AS material_code, mv.expected_reel, mv.actual_reel,
      mv.match_result, mv.verified_by, mv.verified_at, mv.created_at
    FROM material_verifications mv
    JOIN stations s ON s.id = mv.station_id
    LEFT JOIN work_orders wo ON wo.id = mv.work_order_id
    LEFT JOIN production_lines pl ON pl.id = mv.line_id
    LEFT JOIN products prod ON prod.id = mv.material_id
    WHERE mv.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY mv.created_at DESC
    LIMIT 50
  `);
}

// ── AGV scopes ─────────────────────────────────────────────────────────

async function getAgvFleet() {
  const fleet = await query(`
    SELECT f.id, f.code, f.name_zh, f.agv_type, f.model, f.serial_no,
           f.status, f.battery_pct, f.max_load_kg, f.max_lift_height_mm,
           f.navigation_type, f.x_coord, f.y_coord, f.heading, f.speed_mps,
           f.total_distance_m, f.total_tasks, f.last_maintenance_at, f.next_maintenance_at,
           f.last_heartbeat_at,
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
    idle: fleet.filter(r => r.status === 'idle').length,
    busy: fleet.filter(r => r.status === 'busy').length,
    charging: fleet.filter(r => r.status === 'charging').length,
    maintenance: fleet.filter(r => r.status === 'maintenance').length,
    error: fleet.filter(r => r.status === 'error').length,
    offline: fleet.filter(r => r.status === 'offline').length,
    low_battery: fleet.filter(r => r.is_low_battery).length,
    shuttle_count: fleet.filter(r => r.agv_type === 'shuttle').length,
    forklift_count: fleet.filter(r => r.agv_type === 'forklift').length,
  };

  return { summary, fleet };
}

async function getAgvTasks() {
  const tasks = await query(`
    SELECT t.id, t.task_code, t.task_type, t.priority, t.status,
           t.load_type, t.load_kg, t.created_at, t.started_at, t.completed_at,
           t.actual_distance_m, t.actual_duration_s, t.failure_reason,
           t.due_at,
           a.code AS agv_code, a.name_zh AS agv_name, a.agv_type,
           fz.code AS from_zone, fz.name_zh AS from_zone_name,
           tz.code AS to_zone, tz.name_zh AS to_zone_name,
           fs.code AS from_station, ts.code AS to_station,
           wo.code AS work_order_code, pl.internal_code AS line_code
    FROM agv_tasks t
    LEFT JOIN agv_fleet a ON a.id = t.agv_id
    LEFT JOIN agv_zones fz ON fz.id = t.from_zone_id
    LEFT JOIN agv_zones tz ON tz.id = t.to_zone_id
    LEFT JOIN agv_stations fs ON fs.id = t.from_station_id
    LEFT JOIN agv_stations ts ON ts.id = t.to_station_id
    LEFT JOIN work_orders wo ON wo.id = t.work_order_id
    LEFT JOIN production_lines pl ON pl.id = t.line_id
    ORDER BY t.priority ASC, t.created_at ASC
    LIMIT 100
  `);

  const summary = {
    total: tasks.length,
    pending: tasks.filter(r => r.status === 'pending').length,
    assigned: tasks.filter(r => r.status === 'assigned').length,
    dispatched: tasks.filter(r => r.status === 'dispatched').length,
    en_route: tasks.filter(r => r.status === 'en_route').length,
    in_progress: tasks.filter(r => r.status === 'in_progress').length,
    completed: tasks.filter(r => r.status === 'completed').length,
    failed: tasks.filter(r => r.status === 'failed').length,
    cancelled: tasks.filter(r => r.status === 'cancelled').length,
  };

  return { summary, tasks };
}

async function getAgvPositions() {
  return query(`
    SELECT p.id, p.agv_id, p.agv_code, p.zone_code,
           p.x_coord, p.y_coord, p.heading, p.speed_mps, p.battery_pct,
           p.task_id, p.occurred_at
    FROM agv_positions p
    WHERE p.occurred_at >= NOW() - INTERVAL '1 hour'
    ORDER BY p.agv_id, p.occurred_at DESC
    LIMIT 500
  `);
}

async function getAgvStations() {
  return query(`
    SELECT s.id, s.code, s.name_zh, s.station_type,
           s.supports_forklift, s.supports_shuttle, s.max_load_kg,
           s.status, s.created_at,
           z.code AS zone_code, z.name_zh AS zone_name,
           z.x_coord, z.y_coord
    FROM agv_stations s
    JOIN agv_zones z ON z.id = s.zone_id
    ORDER BY s.code
  `);
}

async function getAgvKpi() {
  const [fleetSummary, taskStats, alertStats, chargeStats] = await Promise.all([
    getAgvFleet(),
    query(`
      SELECT
        COUNT(*)::int AS total_tasks_30d,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::int AS completed_30d,
        COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed_30d,
        AVG(CASE WHEN duration_s > 0 THEN duration_s END)::int AS avg_duration_s,
        AVG(CASE WHEN distance_m > 0 THEN distance_m END)::numeric AS avg_distance_m,
        AVG(battery_end_pct - battery_start_pct)::numeric AS avg_battery_drop_pct
      FROM agv_task_history
      WHERE completed_at >= NOW() - INTERVAL '30 days'
    `),
    query(`
      SELECT alert_type, severity, COUNT(*)::int AS cnt
      FROM agv_alerts
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY alert_type, severity
      ORDER BY COUNT(*) DESC
    `),
    query(`
      SELECT COUNT(*)::int AS total_sessions,
             AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::int AS avg_charge_duration_s,
             AVG(end_battery_pct - start_battery_pct)::numeric AS avg_charge_pct
      FROM agv_charging_log
      WHERE ended_at >= NOW() - INTERVAL '30 days'
    `),
  ]);

  const ts = taskStats[0] || {};
  const cs = chargeStats[0] || {};

  return {
    fleet: fleetSummary.summary,
    task_kpi: {
      total_30d: ts.total_tasks_30d || 0,
      completed_30d: ts.completed_30d || 0,
      failed_30d: ts.failed_30d || 0,
      completion_rate: ts.total_tasks_30d > 0
        ? ((ts.completed_30d / ts.total_tasks_30d) * 100).toFixed(1) + '%' : '0.0%',
      avg_duration_min: ts.avg_duration_s ? (ts.avg_duration_s / 60).toFixed(1) : '0.0',
      avg_distance_m: ts.avg_distance_m || 0,
      avg_battery_drop_pct: ts.avg_battery_drop_pct || 0,
    },
    alert_summary: alertStats,
    charging: {
      total_sessions_30d: cs.total_sessions || 0,
      avg_charge_duration_min: cs.avg_charge_duration_s ? (cs.avg_charge_duration_s / 60).toFixed(1) : '0.0',
      avg_charge_pct: cs.avg_charge_pct || 0,
    },
    generated_at: new Date().toISOString(),
  };
}

async function getOee() {
  // OEE per line: availability × performance × quality
  // Using station_events to calculate quality rate per line
  return query(`
    WITH line_events AS (
      SELECT pl.internal_code AS line_code,
        COUNT(*) AS total_events,
        COUNT(*) FILTER (WHERE se.result = 'PASS') AS pass_events,
        COUNT(*) FILTER (WHERE se.result = 'FAIL') AS fail_events,
        COUNT(*) FILTER (WHERE se.occurred_at >= NOW() - INTERVAL '1 hour') AS recent_events
      FROM station_events se
      JOIN stations s ON s.id = se.station_id
      JOIN production_lines pl ON pl.id = s.line_id
      WHERE se.occurred_at >= NOW() - INTERVAL '24 hours'
      GROUP BY pl.internal_code
    ),
    line_downtime AS (
      SELECT dr.line_code,
        COALESCE(EXTRACT(EPOCH FROM SUM(
          COALESCE(dr.end_at, NOW()) - dr.start_at
        )) / 3600.0, 0) AS total_downtime_hours
      FROM downtime_records dr
      WHERE dr.start_at >= NOW() - INTERVAL '24 hours'
      GROUP BY dr.line_code
    )
    SELECT le.line_code,
      GREATEST(0, 1.0 - COALESCE(ld.total_downtime_hours / 24.0, 0)) AS availability,
      CASE WHEN le.total_events > 0
        THEN LEAST(1.0, le.recent_events * 3600.0 / GREATEST(le.total_events, 1))
        ELSE 0 END AS performance,
      CASE WHEN le.total_events > 0
        THEN le.pass_events::float / le.total_events
        ELSE 0 END AS quality,
      CASE WHEN le.total_events > 0
        THEN (1.0 - COALESCE(ld.total_downtime_hours / 24.0, 0)) *
             LEAST(1.0, le.recent_events * 3600.0 / GREATEST(le.total_events, 1)) *
             (le.pass_events::float / le.total_events)
        ELSE 0 END AS oee
    FROM line_events le
    LEFT JOIN line_downtime ld ON ld.line_code = le.line_code
    ORDER BY le.line_code
  `);
}

// ── Main dispatcher ───────────────────────────────────────────────────────

async function main() {
  try {
    let result = {};

    switch (scope) {
      case "lines":
        result = { scope: "lines", data: await getLines() };
        break;
      case "runs":
        result = { scope: "runs", data: await getRuns() };
        break;
      case "events":
        result = { scope: "events", data: await getEvents() };
        break;
      case "stagnation":
        result = { scope: "stagnation", data: await getStagnation() };
        break;
      case "scraps":
        result = { scope: "scraps", data: await getScraps() };
        break;
      case "downtimes":
        result = { scope: "downtimes", data: await getDowntimes() };
        break;
      case "feeders":
        result = { scope: "feeders", data: await getFeeders() };
        break;
      case "pcb-serials":
        result = { scope: "pcb-serials", data: await getPcbSerials() };
        break;
      case "fool-proof":
        result = { scope: "fool-proof", data: await getFoolProof() };
        break;
      case "first-article":
        result = { scope: "first-article", data: await getFirstArticle() };
        break;
      case "material-verify":
        result = { scope: "material-verify", data: await getMaterialVerify() };
        break;
      case "oee":
        result = { scope: "oee", data: await getOee() };
        break;
      case "duplicate-serials":
        result = { scope: "duplicate-serials", data: await getDuplicateSerials() };
        break;
      case "ng-events":
        result = { scope: "ng-events", data: await getNgEvents() };
        break;
      case "agv-fleet":
        result = await getAgvFleet();
        break;
      case "agv-tasks":
        result = await getAgvTasks();
        break;
      case "agv-positions":
        result = { scope: "agv-positions", data: await getAgvPositions() };
        break;
      case "agv-stations":
        result = { scope: "agv-stations", data: await getAgvStations() };
        break;
      case "agv-kpi":
        result = await getAgvKpi();
        break;
      case "agv-all":
        const [agvFleet, agvTasks, agvPositions, agvStations, agvKpi] = await Promise.all([
          getAgvFleet(), getAgvTasks(), getAgvPositions(),
          getAgvStations(), getAgvKpi(),
        ]);
        result = { scope: "agv-all", timestamp: new Date().toISOString(),
                   fleet: agvFleet, tasks: agvTasks, positions: agvPositions,
                   stations: agvStations, kpi: agvKpi };
        break;
      case "all":
        const [
          lines, runs, events, stagnation, scraps, downtimes,
          feeders, pcbSerials, foolProof, firstArticle, materialVerify, oee,
          duplicateSerials, ngEvents, agvFleetData, agvTasksData,
        ] = await Promise.all([
          getLines(), getRuns(), getEvents(), getStagnation(), getScraps(),
          getDowntimes(), getFeeders(), getPcbSerials(), getFoolProof(),
          getFirstArticle(), getMaterialVerify(), getOee(),
          getDuplicateSerials(), getNgEvents(),
          getAgvFleet(), getAgvTasks(),
        ]);
        result = {
          scope: "all",
          timestamp: new Date().toISOString(),
          lines, runs, events, stagnation, scraps, downtimes,
          feeders, pcb_serials: pcbSerials, fool_proof: foolProof,
          first_article: firstArticle, material_verify: materialVerify, oee,
          duplicate_serials: duplicateSerials, ng_events: ngEvents,
          agv_fleet: agvFleetData, agv_tasks: agvTasksData,
        };
        break;
      default:
        console.error(`Unknown scope: ${scope}`);
        console.error(`Usage: node mes-query.js [lines|runs|events|stagnation|scraps|downtimes|feeders|pcb-serials|fool-proof|first-article|material-verify|oee|duplicate-serials|ng-events|agv-fleet|agv-tasks|agv-positions|agv-stations|agv-kpi|agv-all|all]`);
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
