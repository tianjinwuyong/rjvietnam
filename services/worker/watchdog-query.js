/**
 * watchdog-query.js
 * Direct PostgreSQL queries for the SMT factory watchdog.
 * Runs without authentication by hitting the DB directly.
 *
 * Usage: node watchdog-query.js [query-name]
 *   query-name: iqc-ng | work-orders | wms-health | all
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
const argv = process.argv[2] ?? "all";

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function getIqcNg() {
  const rows = await query(`
    SELECT
      ml.id,
      ml.lot_no,
      ml.iqc_status,
      ml.received_qty,
      ml.created_at,
      m.code        AS material_code,
      m.name_zh     AS material_name_zh,
      m.name_en     AS material_name_en,
      s.code        AS supplier_code,
      s.name_zh     AS supplier_name_zh
    FROM material_lots ml
    JOIN materials m  ON m.id = ml.material_id
    JOIN suppliers s  ON s.id = ml.supplier_id
    WHERE ml.iqc_status IN ('pending', 'hold', 'rejected')
    ORDER BY ml.created_at DESC
    LIMIT 50
  `);
  return rows;
}

async function getWorkOrders() {
  const rows = await query(`
    SELECT
      wo.id,
      wo.code,
      wo.status,
      wo.planned_qty,
      wo.completed_qty,
      wo.work_order_type,
      wo.created_at,
      wo.released_at,
      p.code        AS product_code,
      p.name_zh     AS product_name_zh,
      pl.internal_code AS line_code,
      pl.name_zh    AS line_name_zh,
      c.name_zh     AS customer_name
    FROM work_orders wo
    JOIN products p      ON p.id = wo.product_id
    JOIN production_lines pl ON pl.id = wo.line_id
    LEFT JOIN customer_pos  cpo ON cpo.id = wo.customer_po_id
    LEFT JOIN customers c     ON c.id = cpo.customer_id
    ORDER BY wo.created_at DESC
    LIMIT 30
  `);
  return rows;
}

async function getWmsHealth() {
  const [lots, locations, recentTx, lowStock] = await Promise.all([
    query(`
      SELECT iqc_status, COUNT(*) AS count, SUM(received_qty) AS total_qty
      FROM material_lots
      GROUP BY iqc_status
    `),
    query(`
      SELECT area, status, COUNT(*) AS count
      FROM storage_locations
      GROUP BY area, status
    `),
    query(`
      SELECT
        it.action,
        COUNT(*) AS count,
        SUM(it.qty) AS total_qty
      FROM inventory_transactions it
      WHERE it.occurred_at > NOW() - INTERVAL '7 days'
      GROUP BY it.action
      ORDER BY count DESC
    `),
    query(`
      SELECT
        m.code        AS material_code,
        m.name_zh     AS material_name_zh,
        COALESCE(SUM(it.qty), 0) AS total_in,
        ml.received_qty,
        ml.received_qty - COALESCE(SUM(it.qty), 0) AS approx_balance
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN inventory_transactions it ON it.material_lot_id = ml.id
        AND it.action IN ('ISSUE_TO_LINE','PICK')
      WHERE ml.iqc_status = 'released'
      GROUP BY m.code, m.name_zh, ml.received_qty
      HAVING ml.received_qty - COALESCE(SUM(it.qty), 0) < 100
      ORDER BY approx_balance ASC
      LIMIT 20
    `),
  ]);

  return { lots, locations, recentTx, lowStock };
}

async function getQualityStats() {
  const [aoiStats, iqcStats] = await Promise.all([
    query(`
      SELECT
        result,
        COUNT(*) AS count
      FROM aoi_inspection_records
      WHERE occurred_at > NOW() - INTERVAL '7 days'
      GROUP BY result
    `),
    query(`
      SELECT
        qi.result,
        COUNT(*) AS count
      FROM quality_inspections qi
      WHERE qi.occurred_at > NOW() - INTERVAL '7 days'
      GROUP BY qi.result
    `),
  ]);
  return { aoiStats, iqcStats };
}

async function pickCandidate() {
  const woCode = args.wocode;
  const reqQty = Number(args.qty) || 0;
  if (!woCode) return { error: "wocode required" };

  // Find released lots for this WO's product, FIFO by received_at (oldest first)
  const rows = await query(`
    SELECT ml.lot_no, ml.received_qty, m.code AS material_code, m.name_zh,
           ml.received_at::text
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    JOIN work_orders wo ON wo.product_id = m.id
    WHERE wo.code = $1
      AND ml.iqc_status = 'released'
      AND ml.received_qty >= $2
    ORDER BY ml.received_at ASC
    LIMIT 1
  `, [woCode, reqQty]);

  return rows[0] ?? { lot_no: null };
}

// ── Shelf-life expiry warning ───────────────────────────────────────────────
// Computes expiry_date = received_at + shelf_life_days for all released lots.
// Alert tiers: expired (past), critical (≤7d), warning (≤14d), notice (≤30d)
async function expiryWarning() {
  return query(`
    SELECT
      ml.lot_no,
      m.code             AS material_code,
      m.name_zh          AS material_name_zh,
      s.code             AS supplier_code,
      s.name_zh          AS supplier_name_zh,
      ml.received_qty,
      ml.received_at,
      ml.received_at::date + (m.shelf_life_days || ' days')::interval AS expiry_date,
      m.shelf_life_days,
      AGE(ml.received_at::date + (m.shelf_life_days || ' days')::interval) AS days_to_expiry,
      CASE
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval < CURRENT_DATE
          THEN 'expired'
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '7 days'
          THEN 'critical'       -- ≤7 days
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '14 days'
          THEN 'warning'        -- ≤14 days
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '30 days'
          THEN 'notice'         -- ≤30 days
        ELSE 'ok'
      END                AS alert_level,
      CASE
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             < CURRENT_DATE
          THEN FLOOR(EXTRACT(EPOCH FROM (
            CURRENT_DATE - (ml.received_at::date + (m.shelf_life_days || ' days')::interval)
          )) / 86400)
        ELSE FLOOR(EXTRACT(EPOCH FROM (
          (ml.received_at::date + (m.shelf_life_days || ' days')::interval) - CURRENT_DATE
        )) / 86400)
      END                AS days_remaining
    FROM material_lots ml
    JOIN materials m  ON m.id  = ml.material_id
    LEFT JOIN suppliers s ON s.id = ml.supplier_id
    WHERE ml.iqc_status = 'released'
      AND m.shelf_life_days IS NOT NULL
      AND m.shelf_life_days > 0
      AND ml.received_at::date + (m.shelf_life_days || ' days')::interval
          < CURRENT_DATE + INTERVAL '30 days'
    ORDER BY
      CASE
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval < CURRENT_DATE THEN 0
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '7 days' THEN 1
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '14 days' THEN 2
        ELSE 3
      END,
      (ml.received_at::date + (m.shelf_life_days || ' days')::interval) ASC
    LIMIT 100
  `);
}

// ── Periodic quality check — lots due for quality re-inspection before expiry ─
// Triggers quality re-IQC for lots:
//   Type A: expiring within 30 days
//   Type B: past 50% of shelf life without any inspection record
async function periodicQualityCheck() {
  // Type A: lots expiring within 30 days — trigger quality re-inspection
  const expiringLots = await query(`
    SELECT
      ml.lot_no,
      m.code             AS material_code,
      m.name_zh          AS material_name_zh,
      s.code             AS supplier_code,
      ml.received_qty,
      ml.received_at,
      ml.received_at::date + (m.shelf_life_days || ' days')::interval AS expiry_date,
      m.shelf_life_days,
      FLOOR(EXTRACT(EPOCH FROM
        (ml.received_at::date + (m.shelf_life_days || ' days')::interval) - CURRENT_DATE
      ) / 86400) AS days_to_expiry,
      CASE
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '7 days'
          THEN 'critical'
        WHEN ml.received_at::date + (m.shelf_life_days || ' days')::interval
             <= CURRENT_DATE + INTERVAL '14 days'
          THEN 'warning'
        ELSE 'notice'
      END AS urgency
    FROM material_lots ml
    JOIN materials m  ON m.id  = ml.material_id
    LEFT JOIN suppliers s ON s.id = ml.supplier_id
    WHERE ml.iqc_status = 'released'
      AND m.shelf_life_days IS NOT NULL
      AND m.shelf_life_days > 0
      AND ml.received_at::date + (m.shelf_life_days || ' days')::interval
          BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    ORDER BY
      (ml.received_at::date + (m.shelf_life_days || ' days')::interval) ASC
    LIMIT 100
  `);

  // Type B: lots ≥50% through shelf life with no prior quality inspection
  // (simplified — material_lots does not link to quality_inspections,
  //  so we track last_iqc_release as proxy for inspection date)
  const midLifeLots = await query(`
    SELECT
      ml.lot_no,
      m.code             AS material_code,
      m.name_zh          AS material_name_zh,
      s.code             AS supplier_code,
      ml.received_qty,
      ml.received_at,
      ml.received_at::date + (m.shelf_life_days || ' days')::interval AS expiry_date,
      m.shelf_life_days,
      FLOOR(EXTRACT(EPOCH FROM NOW() - ml.received_at) / 86400) AS days_since_received,
      ROUND(
        EXTRACT(EPOCH FROM NOW() - ml.received_at) /
        GREATEST(EXTRACT(EPOCH FROM INTERVAL '1 day' * m.shelf_life_days), 1)
      * 100
      ) AS life_pct_used
    FROM material_lots ml
    JOIN materials m  ON m.id  = ml.material_id
    LEFT JOIN suppliers s ON s.id = ml.supplier_id
    WHERE ml.iqc_status = 'released'
      AND m.shelf_life_days IS NOT NULL
      AND m.shelf_life_days > 0
      AND ROUND(
        EXTRACT(EPOCH FROM NOW() - ml.received_at) /
        GREATEST(EXTRACT(EPOCH FROM INTERVAL '1 day' * m.shelf_life_days), 1)
      * 100
      ) >= 50
    ORDER BY life_pct_used DESC
    LIMIT 50
  `);

  return { expiringLots, midLifeLots };
}

// ── Damage & compensation claims ──────────────────────────────────────────────
// Identifies lots with damage or quality defects that may warrant vendor return
// or scrap-with-claim (compensation) actions.
async function getDamageClaims() {
  // 1. IQC-rejected lots (incoming material damage — primary vendor return candidates)
  const rejectedLots = await query(`
    SELECT
      ml.lot_no,
      m.code             AS material_code,
      m.name_zh          AS material_name_zh,
      s.code             AS supplier_code,
      s.name_zh          AS supplier_name_zh,
      ml.received_qty,
      ml.received_at,
      ml.created_at      AS rejected_at,
      ml.iqc_status,
      CASE
        WHEN ml.created_at >= NOW() - INTERVAL '30 days' THEN 'recent'
        WHEN ml.created_at >= NOW() - INTERVAL '90 days' THEN 'within_3months'
        ELSE 'older'
      END AS claim_age
    FROM material_lots ml
    JOIN materials m  ON m.id = ml.material_id
    LEFT JOIN suppliers s ON s.id = ml.supplier_id
    WHERE ml.iqc_status = 'rejected'
    ORDER BY ml.created_at DESC
    LIMIT 100
  `);

  // 2. Production-line NG events (AOI/ICT failures — production damage)
  // Note: station_events links to pcb_serial, not material_lot directly.
  // We report NG events per station/line for Ornith to correlate with consumption.
  const lineDamage = await query(`
    SELECT
      se.id,
      se.event_type,
      se.result,
      se.occurred_at,
      pcs.serial_no    AS pcb_serial,
      wo.code          AS work_order_code,
      st.code          AS station_type,
      pl.internal_code AS line_code,
      u.display_name   AS operator_name,
      'production_damage' AS claim_type
    FROM station_events se
    JOIN stations        s2  ON s2.id  = se.station_id
    JOIN station_types   st  ON st.id  = s2.station_type_id
    LEFT JOIN production_lines pl ON pl.id = s2.line_id
    LEFT JOIN pcb_serials    pcs ON pcs.id = se.pcb_serial_id
    LEFT JOIN work_orders    wo  ON wo.id = pcs.work_order_id
    LEFT JOIN users           u  ON u.id  = se.operator_id
    WHERE se.result IN ('FAIL', 'NG', 'REJECT', 'ERROR')
      AND se.occurred_at >= NOW() - INTERVAL '30 days'
    ORDER BY se.occurred_at DESC
    LIMIT 100
  `);

  // 3. Appearance defect records with damage severity
  const appearanceDefects = await query(`
    SELECT
      adr.id                  AS record_id,
      pcs.serial_no    AS pcb_serial,
      adr.defect_description,
      adr.defect_severity,
      adr.occurred_at   AS defect_at,
      st.code          AS station_type,
      pl.internal_code AS line_code,
      u.display_name   AS operator_name,
      'appearance_damage' AS claim_type
    FROM appearance_defect_records adr
    LEFT JOIN pcb_serials pcs ON pcs.id = adr.pcb_serial_id
    LEFT JOIN stations s ON s.id = adr.station_id
    LEFT JOIN production_lines pl ON pl.id = s.line_id
    LEFT JOIN users u ON u.id = adr.operator_id
    LEFT JOIN station_types st ON st.id = s.station_type_id
    WHERE adr.defect_severity IN ('critical', 'major', 'minor')
      AND adr.occurred_at >= NOW() - INTERVAL '30 days'
    ORDER BY adr.occurred_at DESC
    LIMIT 50
  `);

  return { rejectedLots, lineDamage, appearanceDefects };
}

async function main() {
  try {
    let data = {};

    if (argv === "iqc-ng" || argv === "all") {
      data.iqcNg = await getIqcNg();
    }
    if (argv === "work-orders" || argv === "all") {
      data.workOrders = await getWorkOrders();
    }
    if (argv === "wms-health" || argv === "all") {
      data.wmsHealth = await getWmsHealth();
    }
    if (argv === "quality" || argv === "all") {
      data.quality = await getQualityStats();
    }
    if (argv === "pick-candidate") {
      console.log(JSON.stringify(await pickCandidate()));
      return;
    }
    if (argv === "expiry-warning" || argv === "all") {
      data.expiryWarning = await expiryWarning();
    }
    if (argv === "periodic-quality" || argv === "all") {
      data.periodicQuality = await periodicQualityCheck();
    }
    if (argv === "damage-claims" || argv === "all") {
      data.damageClaims = await getDamageClaims();
    }

    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
