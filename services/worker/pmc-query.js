#!/usr/bin/env node
/**
 * pmc-query.js — PMC AI Manager Database Query Script
 * Usage: node pmc-query.js <scope> [options]
 *
 * Scopes:
 *   wo-list             All work orders with status summary
 *   wo-detail <code>    Single WO with full detail, BOM, material lines
 *   wo-progress         WIP tracking: completed vs planned per station
 *   mps-view            Master schedule: demand vs capacity per line/week
 *   mrp-result          MRP explosion: material requirements vs availability
 *   capacity-analysis   Line utilization, OEE, bottleneck analysis
 *   kit-readiness       Kit completeness check per WO before release
 *   shortage-list       Materials with insufficient qty for open WOs
 *   delivery-status     PO vs WO progress, OTIF calculation
 *   inventory-health    WIP, excess, obsolete, turnover metrics
 *   supplier-tracking   In-transit and on-order material ETAs
 *   pmc-kpi             OTD, schedule attainment, inventory turnover
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

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

// ── wo-list ──────────────────────────────────────────────────────────────
async function woList() {
  const rows = await query(`
    SELECT
      wo.id, wo.code, wo.status, wo.work_order_type,
      wo.planned_qty, wo.completed_qty,
      wo.released_at, wo.closed_at,
      p.code AS product_code, p.name_zh AS product_name,
      pl.internal_code AS line_code, pl.name_zh AS line_name,
      cpo.po_number, cpo.short_name AS customer_name,
      wo.created_at::text
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN production_lines pl ON pl.id = wo.line_id
    JOIN customer_pos cpo ON cpo.id = wo.customer_po_id
    ORDER BY
      CASE wo.status
        WHEN 'running' THEN 1 WHEN 'released' THEN 2 WHEN 'draft' THEN 3
        WHEN 'closed' THEN 4 WHEN 'cancelled' THEN 5 ELSE 6
      END,
      wo.released_at DESC NULLS LAST
    LIMIT 200
  `);

  const summary = {
    total: rows.length,
    running: rows.filter(r => r.status === 'running').length,
    released: rows.filter(r => r.status === 'released').length,
    draft: rows.filter(r => r.status === 'draft').length,
    closed: rows.filter(r => r.status === 'closed').length,
  };

  const data = rows.map(r => ({
    id: r.id,
    code: r.code,
    status: r.status,
    type: ['mass', 'sample/trial', 'rework'][r.work_order_type - 1] || 'unknown',
    planned_qty: parseInt(r.planned_qty),
    completed_qty: parseInt(r.completed_qty),
    completion_pct: r.planned_qty > 0
      ? ((r.completed_qty / r.planned_qty) * 100).toFixed(1) + '%'
      : '0.0%',
    product: `${r.product_code} / ${r.product_name || ''}`,
    line: `${r.line_code} / ${r.line_name || ''}`,
    po: r.po_number,
    customer: r.customer_name,
    released_at: r.released_at,
    closed_at: r.closed_at,
    created_at: r.created_at,
  }));

  return { summary, data };
}

// ── wo-detail <code> ──────────────────────────────────────────────────
async function woDetail(code) {
  const wo = await query(`
    SELECT
      wo.*,
      p.code AS product_code, p.name_zh AS product_name,
      pl.internal_code AS line_code, pl.name_zh AS line_name,
      cpo.po_number, cpo.customer_name, cpo.due_date,
      created_by_user.display_name AS created_by_name
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN production_lines pl ON pl.id = wo.line_id
    JOIN customer_pos cpo ON cpo.id = wo.customer_po_id
    LEFT JOIN users created_by_user ON created_by_user.id = wo.created_by
    WHERE wo.code = $1
  `, [code]);

  if (!wo.length) return { error: `WO ${code} not found` };

  // BOM lines
  const bomRows = await query(`
    SELECT bl.*, m.code AS material_code, m.name_zh AS material_name,
           m.uom AS unit
     FROM boms b
    JOIN bom_lines bl ON bl.bom_id = b.id
    JOIN materials m ON m.id = bl.material_id
    WHERE b.product_id = $1 AND b.status = 'released'
    ORDER BY bl.id
  `, [wo[0].product_id]);

  // Material availability
  const lotRows = await query(`
    SELECT ml.material_id, ml.iqc_status,
           COALESCE(SUM(
             CASE WHEN ml.iqc_status = 'released' THEN ml.received_qty ELSE 0 END
           ), 0)::numeric AS available_qty
    FROM material_lots ml
    GROUP BY ml.material_id, ml.iqc_status
  `);

  const lotMap = {};
  for (const row of lotRows) {
    if (!lotMap[row.material_id]) lotMap[row.material_id] = {};
    lotMap[row.material_id][row.iqc_status] = parseFloat(row.available_qty);
  }

  // Inventory transactions for this WO
  const txRows = await query(`
    SELECT it.action, it.qty, it.occurred_at::text,
           sl_from.code AS from_loc, sl_to.code AS to_loc
    FROM inventory_transactions it
    LEFT JOIN storage_locations sl_from ON sl_from.id = it.from_location_id
    LEFT JOIN storage_locations sl_to ON sl_to.id = it.to_location_id
    WHERE it.work_order_id = $1
    ORDER BY it.occurred_at DESC
    LIMIT 50
  `, [wo[0].id]);

  const bomData = bomRows.map(b => {
    const mats = lotMap[b.material_id] || {};
    const available = parseFloat(mats['released'] || 0);
    const hold = parseFloat(mats['hold'] || 0);
    const pending = parseFloat(mats['pending'] || 0);
    const rejected = parseFloat(mats['rejected'] || 0);
    const required = b.qty_per * wo[0].planned_qty * (1 + b.loss_rate);
    return {
      material: `${b.material_code} / ${b.material_name || ''}`,
      supplier: `${b.supplier_code || ''} / ${b.supplier_name || ''}`,
      qty_per: parseFloat(b.qty_per),
      loss_rate: parseFloat(b.loss_rate),
      required_qty: required.toFixed(2),
      available_qty: available.toFixed(2),
      hold_qty: hold.toFixed(2),
      pending_qty: pending.toFixed(2),
      shortage: Math.max(0, required - available).toFixed(2),
      shortage_pct: required > 0 ? Math.min(100, ((Math.max(0, required - available) / required) * 100)).toFixed(1) + '%' : '0.0%',
    };
  });

  return {
    wo: {
      code: wo[0].code,
      status: wo[0].status,
      type: ['mass', 'sample/trial', 'rework'][wo[0].work_order_type - 1],
      planned_qty: parseInt(wo[0].planned_qty),
      completed_qty: parseInt(wo[0].completed_qty),
      completion_pct: wo[0].planned_qty > 0
        ? ((wo[0].completed_qty / wo[0].planned_qty) * 100).toFixed(1) + '%' : '0.0%',
      product: `${wo[0].product_code} / ${wo[0].product_name || ''}`,
      line: `${wo[0].line_code} / ${wo[0].line_name || ''}`,
      po: wo[0].po_number,
      customer: wo[0].customer_name,
      due_date: wo[0].due_date,
      released_at: wo[0].released_at,
      closed_at: wo[0].closed_at,
      created_by: wo[0].created_by_name,
    },
    bom_lines: bomData,
    transactions: txRows.map(t => ({
      action: t.action,
      qty: parseFloat(t.qty),
      at: t.occurred_at,
      from: t.from_loc,
      to: t.to_loc,
    })),
  };
}

// ── wo-progress ──────────────────────────────────────────────────────
async function woProgress() {
  // WO-level progress — station_events table has no work_order_id in this schema
  const rows = await query(`
    SELECT
      wo.code, wo.status, wo.planned_qty, wo.completed_qty,
      wo.released_at,
      wo.due_date,
      p.code AS product_code, p.name_zh AS product_name,
      pl.internal_code AS line_code, pl.name_zh AS line_name,
      CASE WHEN wo.planned_qty > 0
        THEN ROUND((wo.completed_qty::numeric / wo.planned_qty) * 100, 1)
        ELSE 0 END AS completion_pct
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN production_lines pl ON pl.id = wo.line_id
    WHERE wo.status IN ('running', 'released', 'closed')
    ORDER BY wo.released_at DESC NULLS LAST
    LIMIT 100
  `);

  return { data: rows, count: rows.length };
}

// ── mps-view ──────────────────────────────────────────────────────────
async function mpsView() {
  // Weekly demand per line
  const demand = await query(`
    SELECT
      pl.internal_code AS line_code,
      date_trunc('week', wo.released_at)::date AS week,
      COUNT(*) AS wo_count,
      SUM(wo.planned_qty) AS planned_qty,
      SUM(wo.completed_qty) AS completed_qty
    FROM work_orders wo
    JOIN production_lines pl ON pl.id = wo.line_id
    WHERE wo.status IN ('running', 'released')
      AND wo.released_at >= date_trunc('week', now())
    GROUP BY pl.internal_code, date_trunc('week', wo.released_at)
    ORDER BY pl.internal_code, week
  `);

  // Capacity per line (from machines)
  const capacity = await query(`
    SELECT pl.internal_code AS line_code,
           COUNT(m.id)::int AS machine_count,
           string_agg(DISTINCT m.machine_type, ', ') AS machine_types
    FROM production_lines pl
    LEFT JOIN machines m ON m.line_id = pl.id AND m.status = 'ready'
    GROUP BY pl.internal_code
  `);

  // Weekly WIP (inventory transactions summary — no area join available)
  const wip = await query(`
    SELECT
      date_trunc('week', it.occurred_at)::date AS week,
      it.action,
      COUNT(*)::int AS tx_count,
      SUM(it.qty)::numeric AS total_qty
    FROM inventory_transactions it
    WHERE it.action IN ('ISSUE_TO_LINE', 'PICK', 'RETURN')
      AND it.occurred_at >= date_trunc('week', now()) - interval '4 weeks'
    GROUP BY date_trunc('week', it.occurred_at), it.action
    ORDER BY week DESC
  `);

  return {
    weekly_demand: demand.map(r => ({
      line: r.line_code,
      week: r.week,
      wo_count: parseInt(r.wo_count),
      planned_qty: parseInt(r.planned_qty),
      completed_qty: parseInt(r.completed_qty),
    })),
    line_capacity: capacity.map(r => ({
      line: r.line_code,
      machine_count: r.machine_count,
      machine_types: r.machine_types,
    })),
    weekly_wip: wip.map(r => ({
      week: r.week,
      action: r.action,
      tx_count: parseInt(r.tx_count),
      total_qty: parseFloat(r.total_qty),
    })),
  };
}

// ── mrp-result ────────────────────────────────────────────────────────
async function mrpResult() {
  // For all released/running WOs, explode BOM and calculate requirements
  const wos = await query(`
    SELECT wo.id, wo.code, wo.planned_qty, wo.completed_qty, wo.status,
           p.id AS product_id, p.code AS product_code
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    WHERE wo.status IN ('released', 'running')
  `);

  if (!wos.length) return { summary: { wo_count: 0, material_count: 0 }, items: [] };

  const woIds = wos.map(w => w.id);
  const productIds = [...new Set(wos.map(w => w.product_id))];

  if (!productIds.length) return { summary: { wo_count: wos.length, material_count: 0 }, items: [] };

  // BOM lines for active products — use int cast on column to handle string IDs from join
  const bomLines = await query(`
    SELECT b.product_id, bl.*, m.code AS material_code, m.name_zh AS material_name,
           m.uom AS unit
    FROM boms b
    JOIN bom_lines bl ON bl.bom_id = b.id
    JOIN materials m ON m.id = bl.material_id
    WHERE b.product_id = ANY($1) AND b.status = 'released'
  `, [productIds]);

  // Available inventory
  const materialIds = [...new Set(bomLines.map(b => b.material_id))];
  const inventory = materialIds.length ? await query(`
    SELECT material_id,
           SUM(CASE WHEN iqc_status = 'released' THEN received_qty ELSE 0 END)::numeric AS available,
           SUM(CASE WHEN iqc_status != 'released' THEN received_qty ELSE 0 END)::numeric AS unavailable
    FROM material_lots
    WHERE material_id = ANY($1)
    GROUP BY material_id
  `, [materialIds]) : [];

  const invMap = {};
  for (const row of inventory) {
    invMap[row.material_id] = {
      available: parseFloat(row.available),
      unavailable: parseFloat(row.unavailable),
    };
  }

  // Material requirements
  const reqMap = {};
  for (const wo of wos) {
    const remaining = wo.planned_qty - wo.completed_qty;
    if (remaining <= 0) continue;
    const lines = bomLines.filter(l => l.product_id === wo.product_id);
    for (const line of lines) {
      const key = line.material_id;
      if (!reqMap[key]) {
        reqMap[key] = { material: `${line.material_code} / ${line.material_name || ''}`, required: 0, available: 0 };
      }
      reqMap[key].required += remaining * line.qty_per * (1 + line.loss_rate);
      if (invMap[key]) reqMap[key].available += invMap[key].available;
    }
  }

  const items = Object.entries(reqMap).map(([matId, data]) => ({
    material_id: parseInt(matId),
    material: data.material,
    required_qty: data.required_qty.toFixed(2),
    available_qty: data.available.toFixed(2),
    shortage_qty: Math.max(0, data.required_qty - data.available).toFixed(2),
    shortage_pct: (function() {
      const pct = data.required_qty > 0
        ? ((Math.max(0, data.required_qty - data.available) / data.required_qty) * 100).toFixed(1) + '%'
        : '0.0%';
      return pct;
    })(),
  }));

  return {
    summary: { wo_count: wos.length, material_count: items.length },
    items: items.sort((a, b) => parseFloat(b.shortage_qty) - parseFloat(a.shortage_qty)),
  };
}

// ── capacity-analysis ─────────────────────────────────────────────────
async function capacityAnalysis() {
  const lines = await query(`
    SELECT pl.*,
           COUNT(m.id)::int AS machine_count
    FROM production_lines pl
    LEFT JOIN machines m ON m.line_id = pl.id
    GROUP BY pl.id
    ORDER BY pl.internal_code
  `);

  // Machine status breakdown
  const machineStatus = await query(`
    SELECT line_id, status, COUNT(*)::int AS cnt
    FROM machines GROUP BY line_id, status
  `);

  // Station events for OEE calculation (last 7 days)
  // station_events has station_id but no line_id/work_order_id directly;
  // join through stations to get line — but station_events also lacks qty/station-level agg cols
  const oeeData = await query(`
    SELECT
      s.line_id,
      pl.internal_code,
      se.event_type,
      COUNT(*)::int AS event_count
    FROM station_events se
    JOIN stations s ON s.id = se.station_id
    JOIN production_lines pl ON pl.id = s.line_id
    WHERE se.occurred_at >= now() - interval '7 days'
    GROUP BY s.line_id, pl.internal_code, se.event_type
  `);

  // Calculate utilization
  const lineCapacity = {};
  for (const line of lines) {
    const runningMachines = machineStatus
      .filter(s => s.line_id === line.id && s.status === 'ready').reduce((a, s) => a + s.cnt, 0);
    lineCapacity[line.id] = {
      line: line.internal_code,
      name: line.name_zh,
      status: line.status,
      total_machines: line.machine_count,
      running_machines: runningMachines,
      utilization_pct: line.machine_count > 0 ? ((runningMachines / line.machine_count) * 100).toFixed(1) + '%' : '0.0%',
    };
  }

  return {
    lines: Object.values(lineCapacity),
    machine_breakdown: machineStatus.map(s => ({
      line_id: s.line_id, status: s.status, count: s.cnt,
    })),
    oee_snapshot: oeeData.map(e => ({
      line: e.internal_code,
      event_type: e.event_type,
      event_count: parseInt(e.event_count),
    })),
  };
}

// ── kit-readiness ─────────────────────────────────────────────────────
async function kitReadiness() {
  const wos = await query(`
    SELECT wo.id, wo.code, wo.planned_qty, wo.completed_qty, wo.status, wo.released_at,
           p.code AS product_code, p.name_zh AS product_name
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    WHERE wo.status IN ('released', 'running')
    ORDER BY wo.released_at ASC NULLS LAST
    LIMIT 50
  `);

  if (!wos.length) return { data: [] };

  const productIds = wos.map(w => w.product_id);
  if (!productIds.length) return { data: [] };

  const bomLines = await query(`
    SELECT b.product_id, bl.material_id, m.code AS material_code,
           m.name_zh AS material_name, bl.qty_per, bl.loss_rate
    FROM boms b
    JOIN bom_lines bl ON bl.bom_id = b.id
    JOIN materials m ON m.id = bl.material_id
    WHERE b.product_id = ANY($1) AND b.status = 'released'
  `, [productIds]);

  const bomMap = {};
  for (const bl of bomLines) {
    if (!bomMap[bl.product_id]) bomMap[bl.product_id] = [];
    bomMap[bl.product_id].push(bl);
  }

  const materialIds = [...new Set(bomLines.map(b => b.material_id))];
  const inventory = materialIds.length ? await query(`
    SELECT material_id,
           SUM(CASE WHEN iqc_status = 'released' THEN received_qty ELSE 0 END)::numeric AS available
    FROM material_lots
    WHERE iqc_status = 'released' AND material_id = ANY($1)
    GROUP BY material_id
  `, [materialIds]) : [];

  const invMap = {};
  for (const row of inventory) {
    invMap[row.material_id] = parseFloat(row.available);
  }

  const result = [];
  for (const wo of wos) {
    const lines = bomMap[wo.product_id] || [];
    const remaining = wo.planned_qty - wo.completed_qty;
    if (remaining <= 0) continue;

    let totalRequired = 0, totalAvailable = 0;
    const shortages = [];

    for (const line of lines) {
      const required = remaining * line.qty_per * (1 + line.loss_rate);
      const available = invMap[line.material_id] || 0;
      totalRequired += required;
      totalAvailable += available;
      if (available < required) {
        shortages.push({
          material: `${line.material_code} / ${line.material_name || ''}`,
          required: required.toFixed(2),
          available: available.toFixed(2),
          shortage: (required - available).toFixed(2),
        });
      }
    }

    const readyPct = totalRequired > 0 ? ((totalAvailable / totalRequired) * 100).toFixed(1) : '100.0';
    result.push({
      wo_code: wo.code,
      product: `${wo.product_code} / ${wo.product_name || ''}`,
      remaining_qty: remaining,
      kit_ready_pct: readyPct + '%',
      status: readyPct >= 100 ? 'READY' : readyPct >= 80 ? 'PARTIAL' : 'SHORTAGE',
      shortages: shortages.slice(0, 5),
    });
  }

  return {
    summary: {
      total: result.length,
      ready: result.filter(r => r.status === 'READY').length,
      partial: result.filter(r => r.status === 'PARTIAL').length,
      shortage: result.filter(r => r.status === 'SHORTAGE').length,
    },
    data: result,
  };
}

// ── shortage-list ──────────────────────────────────────────────────────
async function shortageList() {
  const mr = await mrpResult();
  return {
    summary: { total_shortage_items: mr.items.filter(i => parseFloat(i.shortage_qty) > 0).length },
    shortages: mr.items.filter(i => parseFloat(i.shortage_qty) > 0),
  };
}

// ── delivery-status ──────────────────────────────────────────────────
async function deliveryStatus() {
  const rows = await query(`
    SELECT wo.code, wo.status, wo.planned_qty, wo.completed_qty,
           p.code AS product_code, p.name_zh AS product_name,
      cpo.po_number, cpo.short_name AS customer_name, wo.due_date,
           (COALESCE(cpo.due_date, now()) < now() AND wo.status NOT IN ('closed','cancelled')) AS overdue
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN customer_pos cpo ON cpo.id = wo.customer_po_id
    WHERE wo.status NOT IN ('cancelled')
    ORDER BY cpo.due_date ASC NULLS LAST
    LIMIT 100
  `);

  const now = new Date();
  return {
    summary: {
      total: rows.length,
      running: rows.filter(r => r.status === 'running').length,
      released: rows.filter(r => r.status === 'released').length,
      closed: rows.filter(r => r.status === 'closed').length,
      overdue: rows.filter(r => r.overdue).length,
    },
    data: rows.map(r => ({
      wo_code: r.code,
      status: r.status,
      product: `${r.product_code} / ${r.product_name || ''}`,
      po: r.po_number,
      customer: r.customer_name,
      due_date: r.due_date,
      overdue: r.overdue,
      completed_qty: parseInt(r.completed_qty),
      planned_qty: parseInt(r.planned_qty),
      completion_pct: r.planned_qty > 0
        ? ((r.completed_qty / r.planned_qty) * 100).toFixed(1) + '%' : '0.0%',
      days_until_due: r.due_date
        ? Math.ceil((new Date(r.due_date) - now) / (1000 * 60 * 60 * 24)) : null,
    })),
  };
}

// ── inventory-health ─────────────────────────────────────────────────
async function inventoryHealth() {
  const lots = await query(`
    SELECT iqc_status, COUNT(*)::int AS count,
           SUM(received_qty)::numeric AS total_qty
    FROM material_lots GROUP BY iqc_status
  `);

  const tx = await query(`
    SELECT action,
           date_trunc('month', occurred_at) AS month,
           COUNT(*)::int AS tx_count,
           SUM(qty)::numeric AS total_qty
    FROM inventory_transactions
    WHERE occurred_at >= now() - interval '6 months'
    GROUP BY action, date_trunc('month', occurred_at)
    ORDER BY month DESC
  `);

  const turnover = await query(`
    SELECT
      date_trunc('month', occurred_at) AS month,
      SUM(CASE WHEN action IN ('ISSUE_TO_LINE','PICK') THEN qty ELSE 0 END)::numeric AS issued,
      SUM(CASE WHEN action = 'RECEIVE' THEN qty ELSE 0 END)::numeric AS received
    FROM inventory_transactions
    WHERE occurred_at >= now() - interval '6 months'
    GROUP BY month ORDER BY month DESC
  `);

  return {
    lot_status: lots.map(l => ({
      status: l.iqc_status,
      count: parseInt(l.count),
      total_qty: parseFloat(l.total_qty).toFixed(0),
    })),
    monthly_transactions: tx.map(t => ({
      month: t.month, action: t.action,
      tx_count: parseInt(t.tx_count), total_qty: parseFloat(t.total_qty).toFixed(0),
    })),
    inventory_turnover: turnover.map(r => ({
      month: r.month,
      issued: parseFloat(r.issued).toFixed(0),
      received: parseFloat(r.received).toFixed(0),
      turnover_ratio: parseFloat(r.received) > 0
        ? (parseFloat(r.issued) / parseFloat(r.received)).toFixed(2) : '0.00',
    })),
  };
}

// ── supplier-tracking ────────────────────────────────────────────────
async function supplierTracking() {
  // In-transit: materials received but not yet released
  const inTransit = await query(`
    SELECT s.code AS supplier_code, s.name_zh AS supplier_name,
           COUNT(ml.id)::int AS lot_count,
           SUM(ml.received_qty)::numeric AS total_qty,
           MAX(ml.created_at)::text AS last_received
    FROM material_lots ml
    JOIN suppliers s ON s.id = ml.supplier_id
    WHERE ml.iqc_status NOT IN ('released')
    GROUP BY s.code, s.name_zh
    ORDER BY SUM(ml.received_qty) DESC
    LIMIT 20
  `);

  const supplierStatus = await query(`
    SELECT s.code, s.name_zh, s.status,
           COUNT(ml.id)::int AS lot_count,
           SUM(ml.received_qty)::numeric AS total_qty
    FROM suppliers s
    LEFT JOIN material_lots ml ON ml.supplier_id = s.id
    GROUP BY s.code, s.name_zh, s.status
    ORDER BY s.code
  `);

  return {
    in_transit: inTransit.map(r => ({
      supplier: `${r.supplier_code} / ${r.supplier_name || ''}`,
      lot_count: parseInt(r.lot_count),
      total_qty: parseFloat(r.total_qty).toFixed(0),
      last_received: r.last_received,
    })),
    supplier_summary: supplierStatus.map(r => ({
      code: r.code, name: r.name_zh, status: r.status,
      lot_count: parseInt(r.lot_count), total_qty: parseFloat(r.total_qty).toFixed(0),
    })),
  };
}

// ── pmc-kpi ──────────────────────────────────────────────────────────
async function pmcKpi() {
  // WO completion rate
  const woStats = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'closed' THEN 1 END)::int AS closed,
      COUNT(CASE WHEN status IN ('running','released') THEN 1 END)::int AS active,
      SUM(completed_qty)::numeric AS total_completed,
      SUM(planned_qty)::numeric AS total_planned
    FROM work_orders WHERE created_at >= now() - interval '30 days'
  `);

  // On-time delivery (WO closed on or before due date)
  const otd = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN wo.closed_at <= wo.due_date THEN 1 END)::int AS on_time
    FROM work_orders wo
    WHERE wo.status = 'closed'
      AND wo.closed_at >= now() - interval '30 days'
  `);

  // Schedule attainment
  const attainment = await query(`
    SELECT
      COUNT(*)::int AS wo_count,
      AVG(
        CASE WHEN planned_qty > 0
          THEN LEAST(100, (completed_qty::numeric / planned_qty * 100))
          ELSE 0 END
      )::numeric AS avg_attainment
    FROM work_orders
    WHERE status IN ('running', 'released', 'closed')
      AND created_at >= now() - interval '30 days'
  `);

  // WO cycle time variance
  const cycleTime = await query(`
    SELECT
      AVG(
        CASE WHEN wo.closed_at IS NOT NULL AND wo.released_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (wo.closed_at - wo.released_at)) / 86400
          ELSE NULL END
      )::numeric AS avg_cycle_days
    FROM work_orders wo
    WHERE wo.status = 'closed'
      AND wo.closed_at >= now() - interval '30 days'
  `);

  const wo = woStats[0];
  const o = otd[0];
  const a = attainment[0];
  const ct = cycleTime[0];

  return {
    wo_summary: {
      total_wos_30d: parseInt(wo.total),
      closed_wos_30d: parseInt(wo.closed),
      active_wos: parseInt(wo.active),
      overall_completion_pct: wo.total_planned > 0
        ? ((wo.total_completed / wo.total_planned) * 100).toFixed(1) + '%' : '0.0%',
    },
    on_time_delivery: {
      total_closed: parseInt(o.total),
      on_time: parseInt(o.on_time),
      otd_rate: o.total > 0 ? ((o.on_time / o.total) * 100).toFixed(1) + '%' : '0.0%',
    },
    schedule_attainment: {
      wo_count: parseInt(a.wo_count),
      avg_attainment: parseFloat(a.avg_attainment).toFixed(1) + '%',
    },
    cycle_time: {
      avg_days: ct.avg_cycle_days ? parseFloat(ct.avg_cycle_days).toFixed(1) : '0.0',
    },
    period: 'last 30 days',
    generated_at: new Date().toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const scope = process.argv[2] || 'help';
  const arg = process.argv[3] || '';

  try {
    let result;
    switch (scope) {
      case 'wo-list':          result = await woList(); break;
      case 'wo-detail':         result = await woDetail(arg); break;
      case 'wo-progress':      result = await woProgress(); break;
      case 'mps-view':         result = await mpsView(); break;
      case 'mrp-result':        result = await mrpResult(); break;
      case 'capacity-analysis': result = await capacityAnalysis(); break;
      case 'kit-readiness':     result = await kitReadiness(); break;
      case 'shortage-list':     result = await shortageList(); break;
      case 'delivery-status':   result = await deliveryStatus(); break;
      case 'inventory-health':  result = await inventoryHealth(); break;
      case 'supplier-tracking':result = await supplierTracking(); break;
      case 'pmc-kpi':          result = await pmcKpi(); break;
      case 'all': {
        const woResult = await woList().catch(() => ({ summary: {} }));
        const kitResult = await kitReadiness().catch(() => ({ summary: {} }));
        const delResult = await deliveryStatus().catch(() => ({ summary: {} }));
        const capResult = await capacityAnalysis().catch(() => ({ summary: {}, lines: [] }));
        const shortResult = await shortageList().catch(() => ({ summary: {} }));
        const kpiResult = await pmcKpi().catch(() => ({}));
        result = {
          workOrders: woResult.data || [],
          woSummary: woResult.summary || {},
          kitSummary: kitResult.summary || {},
          deliverySummary: delResult.summary || {},
          capacityAnalysis: capResult,
          shortageList: shortResult.summary || {},
          kpi: kpiResult,
        };
        break;
      }
      case 'help':
        console.log('pmc-query.js <scope>');
        console.log('Scopes: wo-list, wo-detail <code>, wo-progress, mps-view, mrp-result,');
        console.log('         capacity-analysis, kit-readiness, shortage-list, delivery-status,');
        console.log('         inventory-health, supplier-tracking, pmc-kpi, all');
        await pool.end(); return;
      default:
        console.error(`Unknown scope: ${scope}`); await pool.end(); process.exit(1);
    }
    printJson(result);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
