/**
 * plant-query.js — Plant AI Manager DB query tool
 * Top-level consolidated queries across all factory domains.
 *
 * Usage: node plant-query.js [scope]
 *   scope: kpi | health | all | mes | wms | bom | pmc | hr | rda
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 5,
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

async function getPlantHealth() {
  const [mes, wms, bom, pmc, hr, rda] = await Promise.all([
    query(`SELECT COUNT(*)::int as active_runs,
                  SUM(CASE WHEN defect_rate > 0.03 THEN 1 ELSE 0 END)::int as yield_warnings
           FROM mes_line_status WHERE last_event_at >= NOW() - INTERVAL '2 hours'`),
    query(`SELECT COUNT(CASE WHEN iqc_status = 'pending' THEN 1 END)::int as iqc_pending,
                  COUNT(CASE WHEN iqc_status = 'hold' THEN 1 END)::int as iqc_hold,
                  SUM(CASE WHEN iqc_status = 'pending' AND received_at < NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END)::int as overdue_iqc
           FROM material_lots WHERE status = 'open'`),
    query(`SELECT COUNT(*)::int as active_boms,
                  COUNT(CASE WHEN status = 'draft' THEN 1 END)::int as draft_boms
           FROM boms WHERE status IN ('released', 'draft')`),
    query(`SELECT COUNT(*)::int as active_wos,
                  COUNT(CASE WHEN wo_status = 'released' THEN 1 END)::int as released_wos,
                  COUNT(CASE WHEN wo_status = 'on_hold' THEN 1 END)::int as held_wos
           FROM work_orders WHERE wo_status IN ('released', 'on_hold', 'planned')`),
    query(`SELECT COUNT(CASE WHEN attendance_status = 'absent' THEN 1 END)::int as absent_today,
                  COUNT(CASE WHEN ot_hours > 20 THEN 1 END)::int as ot_excess
           FROM hr_daily_attendance WHERE attendance_date = CURRENT_DATE`),
    query(`SELECT COUNT(*)::int as archive_tables,
                  MAX(last_archive_at) as last_archive
           FROM rda_archive_status`),
  ]);

  return {
    mes: { active_runs: mes[0]?.active_runs ?? 0, yield_warnings: mes[0]?.yield_warnings ?? 0 },
    wms: { iqc_pending: wms[0]?.iqc_pending ?? 0, iqc_hold: wms[0]?.iqc_hold ?? 0, overdue_iqc: wms[0]?.overdue_iqc ?? 0 },
    bom: { active_boms: bom[0]?.active_boms ?? 0, draft_boms: bom[0]?.draft_boms ?? 0 },
    pmc: { active_wos: pmc[0]?.active_wos ?? 0, released_wos: pmc[0]?.released_wos ?? 0, held_wos: pmc[0]?.held_wos ?? 0 },
    hr: { absent_today: hr[0]?.absent_today ?? 0, ot_excess: hr[0]?.ot_excess ?? 0 },
    rda: { archive_tables: rda[0]?.archive_tables ?? 0, last_archive: rda[0]?.last_archive ?? null },
  };
}

async function getConsolidatedKPI() {
  const [oee, inventory, schedule, workforce] = await Promise.all([
    query(`SELECT AVG(oee_score)::numeric(5,2)::float as avg_oee,
                  AVG(availability_score)::numeric(5,2)::float as avg_availability,
                  AVG(performance_score)::numeric(5,2)::float as avg_performance,
                  AVG(quality_score)::numeric(5,2)::float as avg_quality
           FROM mes_line_oee WHERE measured_at >= NOW() - INTERVAL '8 hours'`),
    query(`SELECT COUNT(DISTINCT material_id)::int as material_types,
                  SUM(received_qty)::numeric(10,2)::float as total_stock,
                  SUM(CASE WHEN iqc_status = 'released' THEN received_qty ELSE 0 END)::numeric(10,2)::float as released_stock,
                  SUM(CASE WHEN iqc_status = 'pending' THEN received_qty ELSE 0 END)::numeric(10,2)::float as pending_stock
           FROM material_lots WHERE status = 'open'`),
    query(`SELECT COUNT(*)::int as total_wos,
                  SUM(CASE WHEN wo_status = 'released' THEN 1 ELSE 0 END)::int as released,
                  SUM(CASE WHEN wo_status = 'on_hold' THEN 1 ELSE 0 END)::int as on_hold,
                  SUM(CASE WHEN planned_qty = completed_qty THEN 1 ELSE 0 END)::int as completed
           FROM work_orders WHERE created_at >= NOW() - INTERVAL '7 days'`),
    query(`SELECT COUNT(DISTINCT employee_id)::int as total_headcount,
                  SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END)::int as present,
                  SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END)::int as absent,
                  ROUND(AVG(CASE WHEN attendance_status = 'present' THEN ot_hours END)::numeric, 1)::float as avg_ot_hours
           FROM hr_daily_attendance WHERE attendance_date = CURRENT_DATE`),
  ]);

  return {
    oee: { avg_oee: oee[0]?.avg_oee ?? null, avg_availability: oee[0]?.avg_availability ?? null, avg_performance: oee[0]?.avg_performance ?? null, avg_quality: oee[0]?.avg_quality ?? null },
    inventory: { material_types: inventory[0]?.material_types ?? 0, total_stock: Number(inventory[0]?.total_stock ?? 0), released_stock: Number(inventory[0]?.released_stock ?? 0), pending_stock: Number(inventory[0]?.pending_stock ?? 0) },
    schedule: { total_wos: schedule[0]?.total_wos ?? 0, released: schedule[0]?.released ?? 0, on_hold: schedule[0]?.on_hold ?? 0, completed: schedule[0]?.completed ?? 0 },
    workforce: { total_headcount: workforce[0]?.total_headcount ?? 0, present: workforce[0]?.present ?? 0, absent: workforce[0]?.absent ?? 0, avg_ot_hours: workforce[0]?.avg_ot_hours ?? 0 },
  };
}

async function getInterManagerStatus() {
  const [mesLines, wmsLots, bomCount, pmcWos, hrToday, archiveStatus] = await Promise.all([
    query(`SELECT line_code, status, defect_rate, last_event_at FROM mes_line_status WHERE last_event_at >= NOW() - INTERVAL '1 hour' LIMIT 20`),
    query(`SELECT iqc_status, COUNT(*)::int as count, SUM(received_qty)::numeric(10,2)::float as qty FROM material_lots WHERE status = 'open' GROUP BY iqc_status`),
    query(`SELECT status, COUNT(*)::int as count FROM boms GROUP BY status LIMIT 10`),
    query(`SELECT wo_status, COUNT(*)::int as count FROM work_orders GROUP BY wo_status LIMIT 10`),
    query(`SELECT attendance_status, COUNT(*)::int as count FROM hr_daily_attendance WHERE attendance_date = CURRENT_DATE GROUP BY attendance_status`),
    query(`SELECT table_name, last_archive_at, row_count FROM rda_archive_status LIMIT 20`),
  ]);
  return { mes_lines: mesLines, wms_lots_by_status: wmsLots, bom_status: bomCount, pmc_wo_status: pmcWos, hr_today: hrToday, archive_status: archiveStatus };
}

async function main() {
  try {
    let result = {};
    switch (scope) {
      case "kpi": result = { scope: "kpi", data: await getConsolidatedKPI() }; break;
      case "health": result = { scope: "health", data: await getPlantHealth() }; break;
      case "mes": result = { scope: "mes", data: (await getInterManagerStatus()).mes_lines }; break;
      case "wms": result = { scope: "wms", data: (await getInterManagerStatus()).wms_lots_by_status }; break;
      case "bom": result = { scope: "bom", data: (await getInterManagerStatus()).bom_status }; break;
      case "pmc": result = { scope: "pmc", data: (await getInterManagerStatus()).pmc_wo_status }; break;
      case "hr": result = { scope: "hr", data: (await getInterManagerStatus()).hr_today }; break;
      case "rda": result = { scope: "rda", data: (await getInterManagerStatus()).archive_status }; break;
      case "all": {
        const [health, kpi, inter] = await Promise.all([getPlantHealth(), getConsolidatedKPI(), getInterManagerStatus()]);
        result = { scope: "all", timestamp: new Date().toISOString(), health, kpi, inter };
        break;
      }
      default: console.error(`Unknown scope: ${scope}\nUsage: node plant-query.js [kpi|health|mes|wms|bom|pmc|hr|rda|all]`); process.exit(1);
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
