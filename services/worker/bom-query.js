/**
 * bom-query.js — BOM Database Queries
 * 
 * Direct PostgreSQL queries for the BOM AI Manager.
 * 
 * Usage: node bom-query.js [query-name]
 *   query-name: phantom-materials | duplicate-lines | zero-qty | 
 *               material-readiness | cost-anomaly | orphan-inventory | all
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

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Checks ─────────────────────────────────────────────────────────────

/** Scenario 1: BOM lines referencing inactive/deleted materials (phantom references) */
async function getPhantomMaterials() {
  return query(`
    SELECT bl.id AS line_id, b.id AS bom_id, p.code AS product_code,
           bl.material_id, m.code AS material_code, m.status AS material_status
    FROM bom_lines bl
    JOIN boms b ON b.id = bl.bom_id
    JOIN products p ON p.id = b.product_id
    JOIN materials m ON m.id = bl.material_id
    WHERE m.status != 'active'
      AND b.status = 'active'
    LIMIT 50
  `);
}

/** Scenario 2: Same material appears >1 on same BOM */
async function getDuplicateLines() {
  return query(`
    SELECT b.id AS bom_id, p.code AS product_code,
           bl.material_id, m.code AS material_code, m.name_zh AS material_name,
           COUNT(*) AS occurrences
    FROM bom_lines bl
    JOIN boms b ON b.id = bl.bom_id
    JOIN products p ON p.id = b.product_id
    JOIN materials m ON m.id = bl.material_id
    GROUP BY b.id, p.code, bl.material_id, m.code, m.name_zh
    HAVING COUNT(*) > 1
    ORDER BY occurrences DESC
    LIMIT 50
  `);
}

/** Scenario 3: Zero or negative qty_per */
async function getZeroQtyLines() {
  return query(`
    SELECT bl.id AS line_id, b.id AS bom_id, p.code AS product_code,
           m.code AS material_code, m.name_zh AS material_name,
           bl.qty_per
    FROM bom_lines bl
    JOIN boms b ON b.id = bl.bom_id
    JOIN products p ON p.id = b.product_id
    JOIN materials m ON m.id = bl.material_id
    WHERE bl.qty_per <= 0
    ORDER BY bl.qty_per
    LIMIT 50
  `);
}

/** Scenario 4: Active materials with inventory but NOT on any active BOM */
async function getOrphanInventory() {
  return query(`
    SELECT m.id, m.code, m.name_zh, m.material_type, m.uom,
           COALESCE(SUM(ml.received_qty), 0) AS total_stock
    FROM materials m
    JOIN material_lots ml ON ml.material_id = m.id
    WHERE m.status = 'active'
      AND ml.iqc_status IN ('released', 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM bom_lines bl
        JOIN boms b ON b.id = bl.bom_id
        WHERE bl.material_id = m.id AND b.status = 'active'
      )
    GROUP BY m.id, m.code, m.name_zh, m.material_type, m.uom
    HAVING COALESCE(SUM(ml.received_qty), 0) > 0
    ORDER BY total_stock DESC
    LIMIT 50
  `);
}

/** Scenario 5: Materials with cost jump >20% between latest two prices */
async function getCostAnomalies() {
  return query(`
    WITH ranked AS (
      SELECT mp.material_id, mp.unit_price, mp.effective_date,
             ROW_NUMBER() OVER (PARTITION BY mp.material_id ORDER BY mp.effective_date DESC) AS rn
      FROM material_prices mp
      WHERE mp.unit_price > 0
    )
    SELECT rp1.material_id, m.code AS material_code, m.name_zh AS material_name,
           rp1.unit_price AS current_price,
           rp2.unit_price AS previous_price,
           ROUND((rp1.unit_price - rp2.unit_price) / rp2.unit_price * 100, 2) AS pct_change,
           rp1.effective_date AS current_date,
           rp2.effective_date AS previous_date
    FROM ranked rp1
    JOIN ranked rp2 ON rp2.material_id = rp1.material_id AND rp2.rn = 2
    JOIN materials m ON m.id = rp1.material_id
    WHERE rp1.rn = 1
      AND rp1.unit_price > rp2.unit_price * 1.2
    ORDER BY pct_change DESC
    LIMIT 50
  `);
}

/** BOM completeness: materials with no BOM reference at all */
async function getMaterialsWithoutBom() {
  return query(`
    SELECT m.id, m.code, m.name_zh, m.material_type, m.uom
    FROM materials m
    WHERE m.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM bom_lines bl WHERE bl.material_id = m.id)
    ORDER BY m.code
    LIMIT 50
  `);
}

// ── Dispatch ───────────────────────────────────────────────────────────

async function main() {
  const queryName = process.argv[2] ?? "all";

  const queries = {
    "phantom-materials":    { fn: getPhantomMaterials,     label: "Phantom BOM references" },
    "duplicate-lines":      { fn: getDuplicateLines,       label: "Duplicate BOM lines" },
    "zero-qty":             { fn: getZeroQtyLines,         label: "Zero-quantity BOM lines" },
    "orphan-inventory":     { fn: getOrphanInventory,      label: "Orphan inventory (stock but no BOM)" },
    "cost-anomaly":         { fn: getCostAnomalies,        label: "Cost anomalies >20%" },
    "materials-no-bom":     { fn: getMaterialsWithoutBom,  label: "Materials without BOM" },
  };

  if (queryName === "all") {
    const allResults = {};
    for (const [key, q] of Object.entries(queries)) {
      try {
        allResults[key] = await q.fn();
      } catch (e) {
        allResults[key] = { error: e.message };
      }
    }
    console.log(JSON.stringify(allResults, null, 2));
  } else if (queries[queryName]) {
    const q = queries[queryName];
    const rows = await q.fn();
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.error(`Unknown query: ${queryName}`);
    console.error(`Available: ${Object.keys(queries).join(", ")}, all`);
    process.exit(1);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
