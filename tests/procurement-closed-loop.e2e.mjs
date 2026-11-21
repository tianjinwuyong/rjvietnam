import assert from "node:assert/strict";
import dotenv from "dotenv";
import pg from "pg";
dotenv.config({ path: new URL("../services/api/.env", import.meta.url) });

const base = process.env.TEST_API_BASE || "http://127.0.0.1:8080";
const tag = `E2E-${Date.now()}`;
let token = "";
let prId = null;
let rfqId = null;
let poId = null;

async function api(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(body)}`);
  return body.data;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const stale = await pool.query("SELECT id FROM purchase_requisitions WHERE reason LIKE 'E2E-%'");
  for (const row of stale.rows) {
    const stalePos = await pool.query("SELECT id FROM purchase_order_headers WHERE requisition_id=$1", [row.id]);
    const staleRfqs = await pool.query("SELECT id FROM rfq_headers WHERE requisition_id=$1", [row.id]);
    for (const po of stalePos.rows) {
      await pool.query("DELETE FROM purchase_order_closure_reviews WHERE po_header_id=$1", [po.id]);
      await pool.query("DELETE FROM procurement_action_history WHERE entity_type='PO' AND entity_id=$1", [po.id]);
    }
    for (const rfq of staleRfqs.rows) {
      await pool.query("DELETE FROM supplier_quote_lines WHERE quote_header_id IN (SELECT id FROM supplier_quote_headers WHERE rfq_header_id=$1)", [rfq.id]);
      await pool.query("DELETE FROM supplier_quote_headers WHERE rfq_header_id=$1", [rfq.id]);
      await pool.query("DELETE FROM procurement_action_history WHERE entity_type='RFQ' AND entity_id=$1", [rfq.id]);
    }
    await pool.query("DELETE FROM procurement_action_history WHERE entity_type='PR' AND entity_id=$1", [row.id]);
    await pool.query("DELETE FROM purchase_order_headers WHERE requisition_id=$1", [row.id]);
    await pool.query("DELETE FROM rfq_headers WHERE requisition_id=$1", [row.id]);
    await pool.query("DELETE FROM purchase_requisitions WHERE id=$1", [row.id]);
  }
  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: "MENG_YING", password: "my" }) });
  token = login.token;
  assert(login.user.permissions.includes("procurement.manage"));

  const pr = await api("/api/procurement/requisitions", {
    method: "POST",
    body: JSON.stringify({
      department: "PMC", reason: tag, urgency: "normal",
      lines: [{ material_code: "MAT-01001", qty_requested: 10, unit: "PCS", target_unit_cost: 1 }]
    })
  });
  prId = pr.id;
  await api(`/api/procurement/requisitions/${prId}/submit`, { method: "PUT", body: "{}" });
  const rfq = await api(`/api/procurement/requisitions/${prId}/rfq`, { method: "POST", body: JSON.stringify({ title: tag }) });
  rfqId = rfq.id;

  const rfqLine = await pool.query("SELECT id FROM rfq_lines WHERE rfq_header_id=$1 ORDER BY line_no LIMIT 1", [rfqId]);
  const quote = await api(`/api/procurement/rfqs/${rfqId}/quotes`, {
    method: "POST",
    body: JSON.stringify({
      supplier_id: 200, quote_no: tag, currency_code: "USD", lead_time_days: 3,
      lines: [{ rfq_line_id: rfqLine.rows[0].id, qty_quoted: 10, unit_price: 1 }]
    })
  });
  const po = await api(`/api/procurement/rfqs/${rfqId}/award`, { method: "POST", body: JSON.stringify({ quote_id: quote.id, rationale: "E2E lowest compliant quote" }) });
  poId = po.id;
  await api(`/api/procurement/pos/${poId}/send`, { method: "PUT", body: "{}" });
  await api(`/api/procurement/pos/${poId}/acknowledge`, { method: "PUT", body: "{}" });
  const closure = await api(`/api/procurement/pos/${poId}/closure`);
  assert.equal(closure.gates.supplierAcknowledged, true);
  assert.equal(closure.gates.receiptComplete, false);
  assert.equal(closure.canClose, false);
  console.log(JSON.stringify({ ok: true, pr: pr.requisitionNo, rfq: rfq.rfqNo, po: po.poNo, blockedUntilWmsIqcFinance: true }));
} finally {
  if (prId) {
    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM purchase_order_closure_reviews WHERE po_header_id=$1", [poId]);
      await pool.query("DELETE FROM procurement_action_history WHERE (entity_type='PO' AND entity_id=$1) OR (entity_type='RFQ' AND entity_id=$2) OR (entity_type='PR' AND entity_id=$3)", [poId, rfqId, prId]);
      await pool.query("DELETE FROM purchase_order_headers WHERE id=$1", [poId]);
      await pool.query("DELETE FROM supplier_quote_lines WHERE quote_header_id IN (SELECT id FROM supplier_quote_headers WHERE rfq_header_id=$1)", [rfqId]);
      await pool.query("DELETE FROM supplier_quote_headers WHERE rfq_header_id=$1", [rfqId]);
      await pool.query("DELETE FROM rfq_headers WHERE id=$1", [rfqId]);
      await pool.query("DELETE FROM purchase_requisitions WHERE id=$1", [prId]);
      await pool.query("COMMIT");
      const remaining = await pool.query("SELECT count(*)::int AS count FROM purchase_requisitions WHERE reason LIKE 'E2E-%'");
      assert.equal(remaining.rows[0].count, 0, "E2E procurement data must be cleaned");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
  await pool.end();
}
