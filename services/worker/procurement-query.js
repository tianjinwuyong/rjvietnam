/**
 * procurement-query.js
 * Direct PostgreSQL queries for the Procurement AI Manager.
 *
 * Usage: node procurement-query.js [scope]
 *   requisitions              — all purchase requisitions
 *   rfq-list                  — all RFQ headers
 *   rfq-detail --rfqno <no>  — RFQ lines + quote headers
 *   quote-comparison --rfqno <no>  — comparison matrix for one RFQ
 *   po-list                  — all PO headers
 *   po-detail --pono <no>    — PO lines
 *   contract-list            — all contracts
 *   pending-approvals        — contracts awaiting approval
 *   supplier-scorecard       — latest scorecard per supplier
 *   price-history --mat <code>  — price history for material
 *   delivery-status          — PO lines with late/pending status
 *   all                     — full patrol data dump
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

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Purchase Requisitions ─────────────────────────────────────────────────────

async function getRequisitions() {
  return query(`
    SELECT
      pr.id, pr.requisition_no, pr.department, pr.urgency, pr.status,
      pr.reason, pr.target_date,
      pr.created_at, pr.submitted_at,
      u.display_name AS requester_name,
      COUNT(prl.id) AS line_count,
      SUM(prl.qty_requested) AS total_qty
    FROM purchase_requisitions pr
    JOIN users u ON u.id = pr.requester_id
    LEFT JOIN purchase_requisition_lines prl ON prl.requisition_id = pr.id
    WHERE pr.status NOT IN ('cancelled')
    GROUP BY pr.id, u.display_name
    ORDER BY
      CASE pr.urgency WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      pr.created_at DESC
    LIMIT 100
  `);
}

// ── RFQ ─────────────────────────────────────────────────────────────────────

async function getRfqList() {
  return query(`
    SELECT
      rh.id, rh.rfq_no, rh.title, rh.priority, rh.status,
      rh.response_deadline, rh.sent_at, rh.awarded_supplier_id,
      rh.created_at,
      u.display_name AS requested_by_name,
      COUNT(rfl.id) AS line_count,
      COUNT(sqh.id)  AS quote_count,
      s.name_zh AS awarded_supplier_name
    FROM rfq_headers rh
    JOIN users u ON u.id = rh.requested_by
    LEFT JOIN rfq_lines rfl ON rfl.rfq_header_id = rh.id
    LEFT JOIN supplier_quote_headers sqh ON sqh.rfq_header_id = rh.id
    LEFT JOIN suppliers s ON s.id = rh.awarded_supplier_id
    WHERE rh.status NOT IN ('cancelled')
    GROUP BY rh.id, u.display_name, s.name_zh
    ORDER BY rh.created_at DESC
    LIMIT 100
  `);
}

async function getRfqDetail(rfqNo) {
  const header = await query(`
    SELECT rh.*, u.display_name AS requested_by_name
    FROM rfq_headers rh
    JOIN users u ON u.id = rh.requested_by
    WHERE rh.rfq_no = $1
  `, [rfqNo]);

  if (!header.length) return null;

  const lines = await query(`
    SELECT rfl.*, m.name_zh AS material_name_zh
    FROM rfq_lines rfl
    LEFT JOIN materials m ON m.id = rfl.material_id
    WHERE rfl.rfq_header_id = $1
    ORDER BY rfl.line_no
  `, [header[0].id]);

  const quotes = await query(`
    SELECT sqh.*, s.name_zh AS supplier_name_zh, s.code AS supplier_code
    FROM supplier_quote_headers sqh
    JOIN suppliers s ON s.id = sqh.supplier_id
    WHERE sqh.rfq_header_id = $1
    ORDER BY sqh.grand_total ASC
  `, [header[0].id]);

  const comparisons = await query(`
    SELECT qc.*, s.name_zh AS supplier_name_zh
    FROM quote_comparisons qc
    JOIN suppliers s ON s.id = qc.supplier_id
    WHERE qc.rfq_header_id = $1
    ORDER BY qc.rank_position ASC NULLS LAST
  `, [header[0].id]);

  return { header: header[0], lines, quotes, comparisons };
}

// ── Quote Comparison ──────────────────────────────────────────────────────────

async function getQuoteComparison(rfqNo) {
  const rfq = await query(`SELECT id FROM rfq_headers WHERE rfq_no = $1`, [rfqNo]);
  if (!rfq.length) return null;

  return query(`
    SELECT
      qc.id, qc.supplier_id, qc.total_amount, qc.lead_time_days,
      qc.payment_terms, qc.delivery_terms,
      qc.quality_score, qc.price_score, qc.overall_score,
      qc.rank_position, qc.recommendation, qc.rationale,
      s.name_zh AS supplier_name_zh, s.code AS supplier_code
    FROM quote_comparisons qc
    JOIN suppliers s ON s.id = qc.supplier_id
    WHERE qc.rfq_header_id = $1
    ORDER BY qc.rank_position ASC NULLS LAST
  `, [rfq[0].id]);
}

// ── PO List ──────────────────────────────────────────────────────────────────

async function getPoList() {
  return query(`
    SELECT
      poh.id, poh.po_no, poh.status, poh.order_date, poh.promised_date,
      poh.total_amount, poh.currency_code,
      poh.sent_at, poh.acknowledged_at, poh.closed_at,
      s.name_zh AS supplier_name_zh, s.code AS supplier_code,
      u.display_name AS created_by_name,
      COUNT(pol.id) AS line_count,
      SUM(pol.qty_ordered) AS total_ordered,
      SUM(pol.qty_received) AS total_received
    FROM purchase_order_headers poh
    JOIN suppliers s ON s.id = poh.supplier_id
    JOIN users u ON u.id = poh.created_by
    LEFT JOIN purchase_order_lines pol ON pol.po_header_id = poh.id
    WHERE poh.status NOT IN ('cancelled')
    GROUP BY poh.id, s.name_zh, s.code, u.display_name
    ORDER BY poh.order_date DESC
    LIMIT 100
  `);
}

async function getPoDetail(poNo) {
  const header = await query(`
    SELECT poh.*, s.name_zh AS supplier_name_zh, s.code AS supplier_code,
           u.display_name AS created_by_name
    FROM purchase_order_headers poh
    JOIN suppliers s ON s.id = poh.supplier_id
    JOIN users u ON u.id = poh.created_by
    WHERE poh.po_no = $1
  `, [poNo]);

  if (!header.length) return null;

  const lines = await query(`
    SELECT pol.*, m.name_zh AS material_name_zh
    FROM purchase_order_lines pol
    LEFT JOIN materials m ON m.id = pol.material_id
    WHERE pol.po_header_id = $1
    ORDER BY pol.line_no
  `, [header[0].id]);

  return { header: header[0], lines };
}

// ── Delivery Status ───────────────────────────────────────────────────────────

async function getDeliveryStatus() {
  return query(`
    SELECT
      poh.id, poh.po_no, poh.status AS po_status,
      s.name_zh AS supplier_name_zh, s.code AS supplier_code,
      pol.line_no, pol.material_code,
      pol.qty_ordered, pol.qty_received,
      pol.unit_price, pol.promised_date,
      pol.status AS line_status,
      ROUND((pol.qty_received::numeric / NULLIF(pol.qty_ordered, 0)) * 100, 1) AS received_pct,
      CASE
        WHEN pol.promised_date < CURRENT_DATE AND pol.qty_received < pol.qty_ordered
          THEN 'OVERDUE'
        WHEN pol.promised_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND pol.qty_received < pol.qty_ordered
          THEN 'DUE_SOON'
        ELSE 'ON_TRACK'
      END AS delivery_flag,
      AGE(pol.promised_date, CURRENT_DATE) AS days_past_due
    FROM purchase_order_headers poh
    JOIN purchase_order_lines pol ON pol.po_header_id = poh.id
    JOIN suppliers s ON s.id = poh.supplier_id
    WHERE poh.status NOT IN ('cancelled', 'draft')
      AND pol.qty_received < pol.qty_ordered
    ORDER BY
      CASE WHEN pol.promised_date < CURRENT_DATE THEN 0 ELSE 1 END,
      pol.promised_date ASC
    LIMIT 100
  `);
}

// ── Contracts ─────────────────────────────────────────────────────────────────

async function getContractList() {
  return query(`
    SELECT
      pc.id, pc.contract_no, pc.title, pc.contract_type,
      pc.total_value, pc.currency_code, pc.status,
      pc.effective_date, pc.expiry_date,
      pc.created_at, pc.approved_at,
      s.name_zh AS supplier_name_zh,
      u.display_name AS created_by_name,
      cat.approver_role AS current_step_role,
      cat.status AS approval_status
    FROM procurement_contracts pc
    JOIN suppliers s ON s.id = pc.supplier_id
    JOIN users u ON u.id = pc.created_by
    LEFT JOIN LATERAL (
      SELECT approver_role, status
      FROM contract_approval_tasks
      WHERE contract_id = pc.id AND status = 'pending'
      ORDER BY step ASC LIMIT 1
    ) cat ON true
    WHERE pc.status NOT IN ('voided')
    ORDER BY pc.created_at DESC
    LIMIT 100
  `);
}

async function getPendingApprovals() {
  return query(`
    SELECT
      pc.id, pc.contract_no, pc.title, pc.contract_type,
      pc.total_value, pc.currency_code,
      s.name_zh AS supplier_name_zh,
      cat.id AS task_id, cat.step, cat.approver_role, cat.approver_id,
      u.display_name AS approver_name,
      cat.submitted_at,
      poh.po_no
    FROM contract_approval_tasks cat
    JOIN procurement_contracts pc ON pc.id = cat.contract_id
    JOIN suppliers s ON s.id = pc.supplier_id
    LEFT JOIN users u ON u.id = cat.approver_id
    LEFT JOIN purchase_order_headers poh ON poh.id = pc.po_header_id
    WHERE cat.status = 'pending'
      AND pc.status = 'pending_approval'
    ORDER BY cat.submitted_at ASC
    LIMIT 50
  `);
}

// ── Supplier Scorecard ────────────────────────────────────────────────────────

async function getSupplierScorecards() {
  return query(`
    SELECT
      ssc.*,
      s.name_zh AS supplier_name_zh, s.code AS supplier_code,
      s.status AS supplier_status,
      u.display_name AS evaluated_by_name
    FROM supplier_scorecards ssc
    JOIN suppliers s ON s.id = ssc.supplier_id
    LEFT JOIN users u ON u.id = ssc.evaluated_by
    WHERE (ssc.supplier_id, ssc.period_end) IN (
      SELECT supplier_id, MAX(period_end)
      FROM supplier_scorecards
      GROUP BY supplier_id
    )
    ORDER BY ssc.overall_score DESC NULLS LAST
    LIMIT 100
  `);
}

// ── Price History ─────────────────────────────────────────────────────────────

async function getPriceHistory(materialCode) {
  return query(`
    SELECT
      ph.id, ph.material_code, ph.unit_price, ph.currency_code,
      ph.qty_min, ph.qty_max,
      ph.effective_from, ph.effective_to, ph.source_doc,
      s.name_zh AS supplier_name_zh,
      poh.po_no
    FROM price_history ph
    LEFT JOIN suppliers s ON s.id = ph.supplier_id
    LEFT JOIN purchase_order_headers poh ON poh.id = ph.source_id
    WHERE ph.material_code = $1
    ORDER BY ph.effective_from DESC
    LIMIT 50
  `, [materialCode]);
}

// ── Supplier Performance Summary ─────────────────────────────────────────────

async function getSupplierPerformance() {
  return query(`
    SELECT
      s.id AS supplier_id, s.code, s.name_zh, s.status,
      COUNT(DISTINCT poh.id) AS po_count,
      SUM(poh.total_amount) AS total_po_value,
      COUNT(DISTINCT CASE WHEN poh.status = 'received' THEN poh.id END) AS completed_pos,
      COUNT(DISTINCT CASE
        WHEN pol.promised_date < CURRENT_DATE
          AND pol.qty_received < pol.qty_ordered
        THEN pol.id END) AS overdue_lines,
      ROUND(
        COUNT(DISTINCT CASE WHEN pol.qty_received >= pol.qty_ordered THEN pol.id END)::numeric
        / NULLIF(COUNT(DISTINCT pol.id), 0) * 100, 1
      ) AS delivery_completion_pct
    FROM suppliers s
    LEFT JOIN purchase_order_headers poh ON poh.supplier_id = s.id
    LEFT JOIN purchase_order_lines pol ON pol.po_header_id = poh.id
    WHERE s.status = 'active'
    GROUP BY s.id, s.code, s.name_zh, s.status
    ORDER BY total_po_value DESC NULLS LAST
    LIMIT 100
  `);
}

// ── All (patrol dump) ─────────────────────────────────────────────────────────

async function getAll() {
  const [requisitions, rfqList, poList, contracts, pendingApprovals,
         scorecards, deliveryStatus, supplierPerf] = await Promise.all([
    getRequisitions(),
    getRfqList(),
    getPoList(),
    getContractList(),
    getPendingApprovals(),
    getSupplierScorecards(),
    getDeliveryStatus(),
    getSupplierPerformance(),
  ]);

  return {
    requisitions,
    rfqList,
    poList,
    contracts,
    pendingApprovals,
    scorecards,
    deliveryStatus,
    supplierPerformance: supplierPerf,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const argv = process.argv[2] ?? "all";

try {
  switch (argv) {
    case "requisitions":
      console.log(JSON.stringify(await getRequisitions(), null, 2));
      break;
    case "rfq-list":
      console.log(JSON.stringify(await getRfqList(), null, 2));
      break;
    case "rfq-detail": {
      const d = await getRfqDetail(args.rfqno);
      console.log(JSON.stringify(d, null, 2));
      break;
    }
    case "quote-comparison": {
      const d = await getQuoteComparison(args.rfqno);
      console.log(JSON.stringify(d, null, 2));
      break;
    }
    case "po-list":
      console.log(JSON.stringify(await getPoList(), null, 2));
      break;
    case "po-detail": {
      const d = await getPoDetail(args.pono);
      console.log(JSON.stringify(d, null, 2));
      break;
    }
    case "contract-list":
      console.log(JSON.stringify(await getContractList(), null, 2));
      break;
    case "pending-approvals":
      console.log(JSON.stringify(await getPendingApprovals(), null, 2));
      break;
    case "supplier-scorecard":
      console.log(JSON.stringify(await getSupplierScorecards(), null, 2));
      break;
    case "price-history":
      if (!args.mat) { console.error("Usage: --mat <material_code>"); process.exit(1); }
      console.log(JSON.stringify(await getPriceHistory(args.mat), null, 2));
      break;
    case "delivery-status":
      console.log(JSON.stringify(await getDeliveryStatus(), null, 2));
      break;
    case "supplier-performance":
      console.log(JSON.stringify(await getSupplierPerformance(), null, 2));
      break;
    case "all":
    default:
      console.log(JSON.stringify(await getAll(), null, 2));
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
} finally {
  await pool.end();
}
