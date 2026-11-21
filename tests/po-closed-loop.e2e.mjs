import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";

const API = process.env.TEST_API_URL ?? "http://127.0.0.1:8080";
const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});

const ids = {};
const tag = `CL${Date.now().toString().slice(-9)}`;
const poNumber = `TEST-PO-${tag}`;

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

function dataOf(result) {
  const data = result.json?.data ?? result.json?.result ?? result.json;
  return data?.item ?? data;
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ids.paymentId) await client.query("DELETE FROM payment_records WHERE id=$1", [ids.paymentId]);
    if (ids.invoiceId) {
      await client.query("DELETE FROM ar_invoice_lines WHERE ar_invoice_id=$1", [ids.invoiceId]);
      await client.query("DELETE FROM ar_invoices WHERE id=$1", [ids.invoiceId]);
    }
    if (ids.journalId) {
      await client.query("DELETE FROM gl_journal_lines WHERE entry_id=$1", [ids.journalId]);
      await client.query("DELETE FROM gl_journal_entries WHERE id=$1", [ids.journalId]);
    }
    if (ids.poId) {
      await client.query("DELETE FROM pmc_po_closure_audit WHERE customer_po_id=$1", [ids.poId]);
      await client.query("DELETE FROM pmc_po_closure_decisions WHERE customer_po_id=$1", [ids.poId]);
    }
    if (ids.oqcId) await client.query("DELETE FROM qms_oqc_batches WHERE id=$1", [ids.oqcId]);
    if (ids.shipmentId) {
      await client.query("DELETE FROM shipment_lines WHERE shipment_id=$1", [ids.shipmentId]);
      await client.query("DELETE FROM shipments WHERE id=$1", [ids.shipmentId]);
    }
    if (ids.workOrderId) {
      await client.query("DELETE FROM work_order_number_audit WHERE work_order_id=$1", [ids.workOrderId]);
      await client.query("DELETE FROM work_order_code_allocations WHERE work_order_id=$1", [ids.workOrderId]);
    }
    if (ids.poId) {
      await client.query(
        `DELETE FROM shipment_lines WHERE shipment_id IN
         (SELECT id FROM shipments WHERE customer_po_id=$1)`,
        [ids.poId],
      );
      await client.query("DELETE FROM shipments WHERE customer_po_id=$1", [ids.poId]);
      await client.query(
        `DELETE FROM work_order_number_audit WHERE work_order_id IN
         (SELECT id FROM work_orders WHERE customer_po_id=$1)`,
        [ids.poId],
      );
      await client.query(
        `DELETE FROM work_order_code_allocations WHERE work_order_id IN
         (SELECT id FROM work_orders WHERE customer_po_id=$1)`,
        [ids.poId],
      );
      await client.query("DELETE FROM work_orders WHERE customer_po_id=$1", [ids.poId]);
      await client.query("DELETE FROM customer_pos WHERE id=$1", [ids.poId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const stalePoIds = (await pool.query(
    `SELECT id FROM customer_pos WHERE po_number LIKE 'TEST-PO-CL%'`,
  )).rows.map((row) => row.id);
  if (stalePoIds.length) {
    await pool.query("DELETE FROM pmc_po_closure_audit WHERE customer_po_id=ANY($1::bigint[])", [stalePoIds]);
    await pool.query("DELETE FROM pmc_po_closure_decisions WHERE customer_po_id=ANY($1::bigint[])", [stalePoIds]);
    await pool.query(
      `DELETE FROM shipment_lines WHERE shipment_id IN
       (SELECT id FROM shipments WHERE customer_po_id=ANY($1::bigint[]))`,
      [stalePoIds],
    );
    await pool.query("DELETE FROM shipments WHERE customer_po_id=ANY($1::bigint[])", [stalePoIds]);
    await pool.query(
      `DELETE FROM work_order_number_audit WHERE work_order_id IN
       (SELECT id FROM work_orders WHERE customer_po_id=ANY($1::bigint[]))`,
      [stalePoIds],
    );
    await pool.query(
      `DELETE FROM work_order_code_allocations WHERE work_order_id IN
       (SELECT id FROM work_orders WHERE customer_po_id=ANY($1::bigint[]))`,
      [stalePoIds],
    );
    await pool.query("DELETE FROM work_orders WHERE customer_po_id=ANY($1::bigint[])", [stalePoIds]);
    await pool.query("DELETE FROM customer_pos WHERE id=ANY($1::bigint[])", [stalePoIds]);
  }

  const login = await request("/auth/login", {
    method: "POST",
    body: { username: "MENG_YING", password: "my" },
  });
  assert.equal(login.status, 200, "superadmin login must work");
  const session = dataOf(login);
  const token = session.token;
  assert.ok(token, "login must return token");
  assert.ok(session.user.permissions.includes("pmc.execute"));
  assert.ok(session.user.permissions.includes("finance.manage"));

  const fixture = (await pool.query(
    `SELECT c.id customer_id,p.id product_id,p.code product_code,
            pl.id line_id,pl.internal_code line_code,b.id bom_id,u.id user_id
     FROM customers c CROSS JOIN products p CROSS JOIN production_lines pl
     JOIN boms b ON b.product_id=p.id
     CROSS JOIN users u
     WHERE c.status='active' AND p.status='active' AND u.username='MENG_YING'
     ORDER BY b.id LIMIT 1`,
  )).rows[0];
  assert.ok(fixture, "base customer/product/line/BOM fixture required");

  const poCreate = await request("/erp/customer-pos", {
    method: "POST",
    token,
    body: { payload: {
      poNumber,
      customerId: fixture.customer_id,
      productId: fixture.product_id,
      orderQty: 10,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    } },
  });
  assert.equal(poCreate.status, 201, JSON.stringify(poCreate.json));
  ids.poId = dataOf(poCreate).id;
  const duplicatePo = await request("/erp/customer-pos", {
    method: "POST",
    token,
    body: { payload: {
      poNumber,
      customerId: fixture.customer_id,
      productId: fixture.product_id,
      orderQty: 10,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    } },
  });
  assert.equal(duplicatePo.status, 409, "duplicate PO number must be blocked");
  const workOrderCreate = await request("/pmc/work-orders", {
    method: "POST",
    token,
    body: { payload: { workOrder: {
      customerPoId: ids.poId, productCode: fixture.product_code,
      lineCode: fixture.line_code, plannedQty: 5, woType: 1,
      bomId: fixture.bom_id, dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    } } },
  });
  assert.equal(workOrderCreate.status, 201, JSON.stringify(workOrderCreate.json));
  ids.workOrderId = dataOf(workOrderCreate).id;
  const workOrderCode = dataOf(workOrderCreate).code;
  await pool.query(
    `UPDATE work_orders SET completed_qty=planned_qty,status='closed',closed_at=NOW()
     WHERE id=$1`,
    [ids.workOrderId],
  );
  const workOrderCreate2 = await request("/pmc/work-orders", {
    method: "POST",
    token,
    body: { payload: { workOrder: {
      customerPoId: ids.poId, productCode: fixture.product_code,
      lineCode: fixture.line_code, plannedQty: 5, woType: 1,
      bomId: fixture.bom_id, dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    } } },
  });
  assert.equal(workOrderCreate2.status, 201, JSON.stringify(workOrderCreate2.json));
  ids.workOrderId2 = dataOf(workOrderCreate2).id;
  const workOrderCode2 = dataOf(workOrderCreate2).code;
  await pool.query(
    `UPDATE work_orders SET completed_qty=planned_qty,status='closed',closed_at=NOW()
     WHERE id=$1`,
    [ids.workOrderId2],
  );

  const prematureClose = await request(`/pmc/customer-pos/${ids.poId}/close`, { method: "POST", token });
  assert.equal(prematureClose.status, 409, "PO cannot close before quality/shipment/finance/customer acceptance");
  const forbiddenFinanceOverride = await request(`/pmc/customer-pos/${ids.poId}/closure/decisions`, {
    method: "POST",
    token,
    body: {
      gateCode: "FINANCE_SETTLED", result: "PASS",
      reason: "must not override system gate", evidenceRef: `TEST-${tag}`,
    },
  });
  assert.equal(forbiddenFinanceOverride.status, 409, JSON.stringify(forbiddenFinanceOverride.json));

  const excessiveWorkOrderShipment = await request(`/pmc/customer-pos/${ids.poId}/shipments`, {
    method: "POST",
    token,
    body: { lines: [{ workOrderId: ids.workOrderId, shippedQty: 10 }] },
  });
  assert.equal(excessiveWorkOrderShipment.status, 409, "shipment must not exceed completed balance of its work order");

  const shipmentCreate = await request(`/pmc/customer-pos/${ids.poId}/shipments`, {
    method: "POST",
    token,
    body: { lines: [
      { workOrderId: ids.workOrderId, shippedQty: 5 },
      { workOrderId: ids.workOrderId2, shippedQty: 5 },
    ] },
  });
  assert.equal(shipmentCreate.status, 201, JSON.stringify(shipmentCreate.json));
  ids.shipmentId = dataOf(shipmentCreate).id;

  const shipmentBeforeOqc = await request(`/pmc/shipments/${ids.shipmentId}/post`, { method: "POST", token });
  assert.equal(shipmentBeforeOqc.status, 409, "shipment must stop before OQC release");

  ids.oqcId = (await pool.query(
    `INSERT INTO qms_oqc_batches(batch_no,customer_po_no,inspection_type,status,total_qty,
       sample_size,passed_qty,failed_qty,inspector_name,inspection_completed_at)
     VALUES($1,$2,'FINAL','PASS',10,10,10,0,'闭环测试',NOW()) RETURNING id`,
    [`OQC-${tag}`, poNumber],
  )).rows[0].id;
  const shipmentPost = await request(`/pmc/shipments/${ids.shipmentId}/post`, { method: "POST", token });
  assert.equal(shipmentPost.status, 200, JSON.stringify(shipmentPost.json));

  const invoiceCreate = await request("/api/finance/ar-invoices", {
    method: "POST",
    token,
    body: {
      customer_id: fixture.customer_id,
      customer_po_id: ids.poId,
      shipment_id: ids.shipmentId,
      invoice_date: new Date().toISOString().slice(0, 10),
      currency_code: "USD",
      lines: [{ product_id: fixture.product_id, description: poNumber, quantity: 10, unit_price: 1 }],
    },
  });
  assert.equal(invoiceCreate.status, 201, JSON.stringify(invoiceCreate.json));
  const invoice = dataOf(invoiceCreate);
  ids.invoiceId = invoice.id;
  assert.equal(String(invoice.customer_po_id), String(ids.poId));
  assert.equal(String(invoice.shipment_id), String(ids.shipmentId));

  const duplicateInvoice = await request("/api/finance/ar-invoices", {
    method: "POST",
    token,
    body: {
      customer_id: fixture.customer_id,
      customer_po_id: ids.poId,
      shipment_id: ids.shipmentId,
      invoice_date: new Date().toISOString().slice(0, 10),
      currency_code: "USD",
      lines: [{ product_id: fixture.product_id, description: poNumber, quantity: 10, unit_price: 1 }],
    },
  });
  assert.equal(duplicateInvoice.status, 409, "posted shipment quantity must not be invoiced twice");

  const paymentBeforePost = await request("/api/finance/payments", {
    method: "POST",
    token,
    body: {
      direction: "IN", party_type: "customer", party_id: fixture.customer_id,
      invoice_id: ids.invoiceId, amount: Number(invoice.total_amount),
      currency_code: "USD", paid_at: new Date().toISOString(),
    },
  });
  assert.equal(paymentBeforePost.status, 409, "draft invoice must not accept payment");

  const invoicePost = await request(`/api/finance/ar-invoices/${ids.invoiceId}/post`, { method: "PUT", token });
  assert.equal(invoicePost.status, 200, JSON.stringify(invoicePost.json));
  ids.journalId = dataOf(invoicePost).entry_id;

  const overpayment = await request("/api/finance/payments", {
    method: "POST",
    token,
    body: {
      direction: "IN", party_type: "customer", party_id: fixture.customer_id,
      invoice_id: ids.invoiceId, amount: Number(invoice.total_amount) + 1,
      currency_code: "USD", paid_at: new Date().toISOString(),
    },
  });
  assert.equal(overpayment.status, 409, "payment must not exceed invoice outstanding amount");

  const payment = await request("/api/finance/payments", {
    method: "POST",
    token,
    body: {
      direction: "IN", party_type: "customer", party_id: fixture.customer_id,
      invoice_id: ids.invoiceId, amount: Number(invoice.total_amount),
      currency_code: "USD", paid_at: new Date().toISOString(),
      reference_no: `PAY-${tag}`,
    },
  });
  assert.equal(payment.status, 201, JSON.stringify(payment.json));
  ids.paymentId = dataOf(payment).id;

  const acceptance = await request(`/pmc/customer-pos/${ids.poId}/closure/decisions`, {
    method: "POST",
    token,
    body: {
      gateCode: "CUSTOMER_ACCEPTED", result: "PASS",
      reason: "isolated closed-loop acceptance test", evidenceRef: `TEST-${tag}`,
    },
  });
  assert.equal(acceptance.status, 201, JSON.stringify(acceptance.json));

  const ready = await request(`/pmc/customer-pos/${ids.poId}/closure`, { token });
  assert.equal(ready.status, 200);
  assert.equal(dataOf(ready).readyToClose, true, JSON.stringify(dataOf(ready).gates));

  const closed = await request(`/pmc/customer-pos/${ids.poId}/close`, { method: "POST", token });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));

  const blockedWo = await request("/pmc/work-orders", {
    method: "POST",
    token,
    body: { payload: { workOrder: {
      customerPoId: ids.poId, productCode: fixture.product_code,
      lineCode: fixture.line_code, plannedQty: 1, woType: 1,
      bomId: fixture.bom_id, dueDate: new Date(Date.now() + 86400000).toISOString(),
    } } },
  });
  assert.equal(blockedWo.status, 400, "closed PO must not create work order");

  const blockedShipment = await request(`/pmc/customer-pos/${ids.poId}/shipments`, {
    method: "POST",
    token,
    body: { lines: [{ workOrderId: ids.workOrderId, shippedQty: 1 }] },
  });
  assert.equal(blockedShipment.status, 409, "closed PO must not create shipment");

  const blockedInvoice = await request("/api/finance/ar-invoices", {
    method: "POST",
    token,
    body: {
      customer_id: fixture.customer_id, customer_po_id: ids.poId,
      shipment_id: ids.shipmentId, invoice_date: new Date().toISOString().slice(0, 10),
      lines: [{ product_id: fixture.product_id, quantity: 1, unit_price: 1 }],
    },
  });
  assert.equal(blockedInvoice.status, 409, "closed PO must not create invoice");

  const blockedStatusChange = await request(`/pmc/work-orders/${workOrderCode}`, {
    method: "PATCH", token, body: { payload: { status: "running" } },
  });
  assert.equal(blockedStatusChange.status, 409, "closed PO must make linked WO status immutable");

  const blockedCompletion = await request(`/pmc/work-orders/${workOrderCode}/complete`, {
    method: "POST", token, body: { payload: { outputQty: 1, operator: "MENG_YING" } },
  });
  assert.equal(blockedCompletion.status, 409, "closed PO must block additional production output");

  const blockedFreeze = await request(`/pmc/work-orders/${workOrderCode}/freeze`, {
    method: "PATCH", token,
    body: { payload: { status: "released", plannedQty: 99, changeReason: "negative test" } },
  });
  assert.equal(blockedFreeze.status, 409, "closed PO must block direct WO mutation");

  const blockedChangeRequest = await request(`/pmc/work-orders/${workOrderCode}/change-requests`, {
    method: "POST", token,
    body: { payload: { changeType: "QUANTITY", proposedChange: { plannedQty: 99 }, reason: "negative test" } },
  });
  assert.equal(blockedChangeRequest.status, 409, "closed PO must block WO change-request bypass");

  const blockedTransfer = await request(`/pmc/work-orders/${workOrderCode2}/transfers`, {
    method: "POST", token,
    body: { payload: { toLineId: Number(fixture.line_id) + 1, reason: "negative test" } },
  });
  assert.equal(blockedTransfer.status, 409, "closed PO must block WO transfer bypass");

  console.log(JSON.stringify({
    ok: true,
    poNumber,
    gates: dataOf(ready).gates.map((gate) => `${gate.gateCode}:${gate.status}`),
    postClosureGuards: {
      workOrder: blockedWo.status,
      shipment: blockedShipment.status,
      invoice: blockedInvoice.status,
      statusChange: blockedStatusChange.status,
      completion: blockedCompletion.status,
      freeze: blockedFreeze.status,
      changeRequest: blockedChangeRequest.status,
      transfer: blockedTransfer.status,
    },
  }, null, 2));
} finally {
  await cleanup();
  const leftovers = Number((await pool.query(
    `SELECT COUNT(*) count FROM customer_pos WHERE po_number LIKE 'TEST-PO-CL%'`,
  )).rows[0].count);
  assert.equal(leftovers, 0, "closed-loop test data must be removed");
  await pool.end();
}
