/**
 * wms-query.js — WMS AI Manager DB query tool
 * Direct PostgreSQL queries for the SMT factory WMS.
 *
 * Usage: node wms-query.js [scope]
 *   scope: iqc | inventory | lots | locations | movements | health | scraps | returns | all
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

// ── IQC: incoming quality control lots ──────────────────────────────────
async function getIqcLots() {
  return query(`
    SELECT
      ml.id,
      ml.lot_no,
      ml.material_code,
      m.name_zh AS material_name_zh,
      m.name_en AS material_name_en,
      m.name_vi AS material_name_vi,
      m.material_type,
      s.code AS supplier_code,
      s.name_zh AS supplier_name_zh,
      ml.received_qty,
      ml.iqc_status,
      ml.received_at,
      ml.iqc_completed_at,
      ml.iqc_result,
      ml.notes,
      ml.created_at,
      ml.created_by
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    LEFT JOIN suppliers s ON s.id = ml.supplier_id
    ORDER BY
      CASE ml.iqc_status
        WHEN 'pending' THEN 1
        WHEN 'hold'   THEN 2
        WHEN 'rejected' THEN 3
        WHEN 'released' THEN 4
        ELSE 5
      END,
      ml.received_at DESC
    LIMIT 200
  `);
}

// ── Inventory: current stock by material ──────────────────────────────────
async function getInventory() {
  return query(`
    SELECT
      m.id AS material_id,
      m.code AS material_code,
      m.name_zh AS material_name_zh,
      m.material_type,
      COALESCE(SUM(ml.received_qty), 0) AS total_qty,
      COALESCE(SUM(ml.reserved_qty), 0) AS reserved_qty,
      COALESCE(SUM(ml.received_qty) - SUM(ml.reserved_qty), 0) AS available_qty,
      COALESCE(SUM(CASE WHEN ml.iqc_status = 'released' THEN ml.received_qty ELSE 0 END), 0) AS released_qty,
      COALESCE(SUM(CASE WHEN ml.iqc_status = 'pending' THEN ml.received_qty ELSE 0 END), 0) AS pending_qty,
      COALESCE(SUM(CASE WHEN ml.iqc_status = 'hold' THEN ml.received_qty ELSE 0 END), 0) AS hold_qty,
      COALESCE(SUM(CASE WHEN ml.iqc_status = 'rejected' THEN ml.received_qty ELSE 0 END), 0) AS rejected_qty,
      COUNT(ml.id) AS lot_count
    FROM materials m
    LEFT JOIN material_lots ml ON ml.material_id = m.id
    WHERE m.status = 'active'
    GROUP BY m.id, m.code, m.name_zh, m.material_type
    HAVING COALESCE(SUM(ml.received_qty), 0) > 0
    ORDER BY m.code
    LIMIT 200
  `);
}

// ── Material lots: all lots with status ───────────────────────────────────
async function getLots() {
  const statusFilter = args.status ?? null;
  let sql = `
    SELECT
      ml.id,
      ml.lot_no,
      m.code AS material_code,
      m.name_zh AS material_name_zh,
      s.code AS supplier_code,
      s.name_zh AS supplier_name_zh,
      ml.received_qty,
      ml.reserved_qty,
      ml.iqc_status,
      ml.received_at,
      ml.msd_level,
      ml.msd_open_at,
      ml.msd_limit_hours,
      ml.notes,
      ml.status,
      ml.created_at
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    LEFT JOIN suppliers s ON s.id = ml.supplier_id
  `;
  const params = [];
  if (statusFilter) {
    sql += ` WHERE ml.iqc_status = $1`;
    params.push(statusFilter);
  }
  sql += ` ORDER BY ml.received_at DESC LIMIT 200`;
  return query(sql, params);
}

// ── Storage locations ────────────────────────────────────────────────────
async function getLocations() {
  return query(`
    SELECT
      sl.id,
      sl.location_code,
      sl.area,
      sl.zone,
      sl.rack,
      sl.shelf,
      sl.name_zh AS location_name_zh,
      sl.name_en AS location_name_en,
      sl.name_vi AS location_name_vi,
      sl.location_type,
      sl.max_capacity,
      sl.current_qty,
      sl.status,
      sl.created_at
    FROM storage_locations sl
    ORDER BY sl.area, sl.zone, sl.location_code
    LIMIT 200
  `);
}

// ── Inventory movements/transactions ────────────────────────────────────
async function getMovements() {
  const limit = Number(args.limit ?? 100);
  return query(`
    SELECT
      it.id,
      it.action,
      it.qty,
      it.occurred_at,
      ml.lot_no,
      m.code AS material_code,
      m.name_zh AS material_name_zh,
      sl_from.location_code AS from_location,
      sl_to.location_code AS to_location,
      it.work_order_code,
      it.operator_name,
      it.notes,
      it.voided
    FROM inventory_transactions it
    LEFT JOIN material_lots ml ON ml.id = it.material_lot_id
    LEFT JOIN materials m ON m.id = it.material_id
    LEFT JOIN storage_locations sl_from ON sl_from.id = it.from_location_id
    LEFT JOIN storage_locations sl_to ON sl_to.id = it.to_location_id
    WHERE it.voided = false
    ORDER BY it.occurred_at DESC
    LIMIT $1
  `, [limit]);
}

// ── WMS health dashboard ─────────────────────────────────────────────────
async function getHealth() {
  const [lots, lowStock, expiring, recentMoves] = await Promise.all([
    query(`
      SELECT iqc_status, COUNT(*) AS count,
             SUM(received_qty) AS total_qty
      FROM material_lots GROUP BY iqc_status
    `),
    query(`
      SELECT m.code AS material_code, m.name_zh AS material_name_zh,
             SUM(ml.received_qty) AS available_qty
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      WHERE ml.iqc_status = 'released'
      GROUP BY m.id, m.code, m.name_zh
      HAVING SUM(ml.received_qty) < (m.min_stock_level ?? 0)
      ORDER BY (m.min_stock_level - SUM(ml.received_qty)) DESC
      LIMIT 20
    `),
    query(`
      SELECT ml.lot_no, m.code AS material_code, m.name_zh,
             ml.msd_open_at, ml.msd_limit_hours
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      WHERE ml.iqc_status = 'released'
        AND ml.msd_open_at IS NOT NULL
        AND ml.msd_limit_hours IS NOT NULL
        AND EXTRACT(EPOCH FROM (NOW() - ml.msd_open_at)) / 3600.0 > ml.msd_limit_hours * 0.8
      ORDER BY ml.msd_open_at ASC
      LIMIT 20
    `),
    query(`
      SELECT action, COUNT(*) AS count, SUM(qty) AS total_qty
      FROM inventory_transactions
      WHERE occurred_at >= NOW() - INTERVAL '24 hours'
        AND voided = false
      GROUP BY action
      ORDER BY count DESC
    `),
  ]);

  const lotSummary = {};
  for (const r of lots) {
    lotSummary[r.iqc_status] = { count: Number(r.count), total_qty: Number(r.total_qty) };
  }

  return {
    lotSummary,
    lowStock: lowStock.map(r => ({
      material_code: r.material_code,
      material_name_zh: r.material_name_zh,
      available_qty: Number(r.available_qty),
    })),
    expiringMsd: expiring.map(r => ({
      lot_no: r.lot_no,
      material_code: r.material_code,
      material_name_zh: r.name_zh,
      open_hours: r.msd_open_at
        ? Math.round(EXTRACT(EPOCH FROM (NOW() - r.msd_open_at)) / 3600.0 * 10) / 10
        : null,
      limit_hours: r.msd_limit_hours,
    })),
    last24h: recentMoves.map(r => ({
      action: r.action,
      count: Number(r.count),
      total_qty: Number(r.total_qty),
    })),
  };
}

// ── Scraps ────────────────────────────────────────────────────────────────
async function getScraps() {
  return query(`
    SELECT
      sr.id,
      sr.lot_no,
      m.code AS material_code,
      m.name_zh AS material_name_zh,
      sr.quantity,
      sr.scrap_reason_code,
      src.name_zh AS scrap_reason_name,
      sr.status,
      sr.approved_by,
      sr.approved_at,
      sr.notes,
      sr.created_at
    FROM scrap_records sr
    LEFT JOIN materials m ON m.code = sr.material_code
    LEFT JOIN scrap_reason_codes src ON src.code = sr.scrap_reason_code
    WHERE sr.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY sr.created_at DESC
    LIMIT 100
  `);
}

// ── Returns from line ─────────────────────────────────────────────────────
async function getReturns() {
  return query(`
    SELECT
      ir.id,
      ir.lot_no,
      m.code AS material_code,
      m.name_zh AS material_name_zh,
      ir.qty_returned,
      ir.return_reason,
      ir.from_line_code,
      ir.work_order_code,
      ir.operator_name,
      ir.status,
      ir.notes,
      ir.created_at
    FROM inventory_transactions ir
    LEFT JOIN materials m ON m.code = ir.material_code
    WHERE ir.action = 'RETURN'
      AND ir.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY ir.created_at DESC
    LIMIT 100
  `);
}

// ── Pick candidate: FIFO lot for a WO + material ─────────────────────────
async function getPickCandidate() {
  const woCode = args.wocode ?? process.argv[3];
  const qtyNeeded = Number(args.qty ?? 1);

  if (!woCode) return { error: "WO code required" };

  // Get material requirements for this WO
  const woRows = await query(`
    SELECT wo.id, wo.code, wo.planned_qty, p.id AS product_id
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    WHERE wo.code = $1
  `, [woCode]);

  if (!woRows.length) return { error: `WO ${woCode} not found` };

  const wo = woRows[0];

  // Get BOM lines
  const bomRows = await query(`
    SELECT bl.material_id, m.code AS material_code, bl.qty_per
    FROM boms b
    JOIN bom_lines bl ON bl.bom_id = b.id
    JOIN materials m ON m.id = bl.material_id
    WHERE b.product_id = $1 AND b.status = 'released'
  `, [wo.product_id]);

  if (!bomRows.length) return { lots: [] };

  const materialIds = bomRows.map(b => b.material_id);
  const requiredByMaterial = {};
  for (const b of bomRows) {
    requiredByMaterial[b.material_id] = Number(b.qty_per) * wo.planned_qty;
  }

  // Get available lots (FIFO: oldest received first)
  const availableLots = await query(`
    SELECT ml.id, ml.lot_no, ml.material_id, m.code AS material_code,
           ml.received_qty, ml.reserved_qty,
           ml.received_at
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    WHERE ml.iqc_status = 'released'
      AND ml.material_id = ANY($1)
      AND (ml.received_qty - COALESCE(ml.reserved_qty, 0)) > 0
    ORDER BY ml.received_at ASC
  `, [materialIds]);

  const candidates = [];
  for (const lot of availableLots) {
    const needed = requiredByMaterial[lot.material_id] ?? 0;
    const available = Number(lot.received_qty) - Number(lot.reserved_qty ?? 0);
    if (available > 0) {
      candidates.push({
        lot_no: lot.lot_no,
        material_code: lot.material_code,
        available_qty: available,
        needed_qty: needed,
        received_at: lot.received_at,
      });
    }
  }

  return { wo_code: woCode, candidates };
}

// ── Main dispatcher ───────────────────────────────────────────────────────

async function main() {
  try {
    let result = {};

    switch (scope) {
      case "iqc":
        result = { scope: "iqc", data: await getIqcLots() };
        break;
      case "inventory":
        result = { scope: "inventory", data: await getInventory() };
        break;
      case "lots":
        result = { scope: "lots", data: await getLots() };
        break;
      case "locations":
        result = { scope: "locations", data: await getLocations() };
        break;
      case "movements":
        result = { scope: "movements", data: await getMovements() };
        break;
      case "health":
        result = { scope: "health", data: await getHealth() };
        break;
      case "scraps":
        result = { scope: "scraps", data: await getScraps() };
        break;
      case "returns":
        result = { scope: "returns", data: await getReturns() };
        break;
      case "pick-candidate":
        result = await getPickCandidate();
        break;
      case "all":
        const [iqc, inventory, lots, locations, movements, health, scraps, returns] =
          await Promise.all([
            getIqcLots(), getInventory(), getLots(), getLocations(),
            getMovements(), getHealth(), getScraps(), getReturns(),
          ]);
        result = {
          scope: "all",
          timestamp: new Date().toISOString(),
          iqcNg: iqc,
          inventory,
          lots,
          locations,
          movements,
          wmsHealth: health,
          scraps,
          returns,
        };
        break;
      default:
        console.error(`Unknown scope: ${scope}`);
        console.error(`Usage: node wms-query.js [iqc|inventory|lots|locations|movements|health|scraps|returns|pick-candidate|all]`);
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
