// ============================================================================
// 客户订单关闭门 + 出货 —— 从 server.js 整段搬迁（阶段3轮4）。
// 原 server.js 15661-15973（PO_CLOSURE_GATES + getPmcPoClosure 两个模块私有
// 声明 + 6 路由：customer-pos/:id/closure(+decisions)/close、shipments 列表/创建、
// shipments/:id/post）。
// pmcPoClosureReady(DDL promise)留在 server.js 经 deps 注入,建表时机与搬迁前一致。
// 挂载在 app 级鉴权闸门之后（原行号）,wrapper 鉴权语义不变。
// ============================================================================
import { query } from "../db.js";
import { envelope, listEnvelope, mutateEnvelope, errorEnvelope } from "../shared/helpers.js";

export function registerPmcClosureRoutes(app, deps) {
  const { pgPool, requirePermission, pmcPoClosureReady } = deps;

const PO_CLOSURE_GATES = [
  "WO_LINKED",
  "PRODUCTION_COMPLETE",
  "QUALITY_RELEASED",
  "SHIPMENT_COMPLETE",
  "FINANCE_SETTLED",
  "CUSTOMER_ACCEPTED",
];

async function getPmcPoClosure(poId, client = { query }) {
  await pmcPoClosureReady;
  const po = (await client.query(
    `SELECT po.id,po.po_number,po.order_qty,po.status,po.due_date,po.closed_at,
            c.name_zh AS customer_name,p.code AS product_code
     FROM customer_pos po JOIN customers c ON c.id=po.customer_id
     LEFT JOIN products p ON p.id=po.product_id WHERE po.id=$1`,
    [poId],
  )).rows[0];
  if (!po) return null;
  const wo = (await client.query(
    `SELECT COUNT(*)::int count,
            COALESCE(SUM(planned_qty),0)::int planned,
            COALESCE(SUM(completed_qty),0)::int completed,
            COUNT(*) FILTER(WHERE status NOT IN('closed','completed','voided'))::int open_count
     FROM work_orders WHERE customer_po_id=$1`,
    [poId],
  )).rows[0];
  const quality = (await client.query(
    `SELECT COUNT(*)::int count,
            COUNT(*) FILTER(WHERE UPPER(status) IN('PASSED','PASS','RELEASED','CLOSED'))::int passed,
            COUNT(*) FILTER(WHERE UPPER(status) IN('FAILED','FAIL','REJECTED','HOLD','PENDING','INSPECTING'))::int blocked
     FROM qms_oqc_batches WHERE customer_po_no=$1`,
    [po.po_number],
  )).rows[0];
  const shipment = (await client.query(
    `SELECT COUNT(DISTINCT s.id)::int count,COALESCE(SUM(sl.shipped_qty),0)::numeric shipped,
            COUNT(DISTINCT s.id) FILTER(WHERE UPPER(s.posting_status) NOT IN('POSTED','CLOSED')
              AND UPPER(s.status) NOT IN('SHIPPED','DELIVERED','CLOSED'))::int unposted
     FROM shipments s LEFT JOIN shipment_lines sl ON sl.shipment_id=s.id
     WHERE s.customer_po_id=$1`,
    [poId],
  )).rows[0];
  const finance = (await client.query(
    `SELECT COUNT(*)::int count,COALESCE(SUM(outstanding_amount),0)::numeric outstanding,
            COUNT(*) FILTER(WHERE UPPER(payment_status) NOT IN('PAID','CLOSED'))::int unpaid
     FROM ar_invoices WHERE customer_po_id=$1`,
    [poId],
  )).rows[0];
  const decisions = (await client.query(
    `SELECT DISTINCT ON(gate_code) gate_code,result,reason,evidence_ref,actor,created_at
     FROM pmc_po_closure_decisions WHERE customer_po_id=$1
     ORDER BY gate_code,created_at DESC,id DESC`,
    [poId],
  )).rows;
  const latest = Object.fromEntries(decisions.map((row) => [row.gate_code, row]));
  const auto = {
    WO_LINKED: { pass: wo.count > 0, detail: `${wo.count} WO` },
    PRODUCTION_COMPLETE: {
      pass: wo.count > 0 && wo.open_count === 0 && Number(wo.completed) >= Number(po.order_qty),
      detail: `${wo.completed}/${po.order_qty}; open WO ${wo.open_count}`,
    },
    QUALITY_RELEASED: {
      pass: quality.count > 0 && quality.passed > 0 && quality.blocked === 0,
      detail: `OQC ${quality.passed}/${quality.count}; blocked ${quality.blocked}`,
    },
    SHIPMENT_COMPLETE: {
      pass: shipment.count > 0 && shipment.unposted === 0 && Number(shipment.shipped) >= Number(po.order_qty),
      detail: `shipped ${shipment.shipped}/${po.order_qty}; unposted ${shipment.unposted}`,
    },
    FINANCE_SETTLED: {
      pass: finance.count > 0 && finance.unpaid === 0 && Number(finance.outstanding) <= 0,
      detail: `invoice ${finance.count}; unpaid ${finance.unpaid}; outstanding ${finance.outstanding}`,
    },
    CUSTOMER_ACCEPTED: { pass: false, detail: "customer acceptance evidence required" },
  };
  const gates = PO_CLOSURE_GATES.map((gateCode) => {
    const decision = latest[gateCode];
    const autoGate = auto[gateCode];
    const isCustomerAcceptance = gateCode === "CUSTOMER_ACCEPTED";
    const passed = isCustomerAcceptance
      ? decision?.result === "PASS"
      : autoGate.pass && decision?.result !== "FAIL";
    return {
      gateCode,
      status: passed ? "PASS" : "BLOCKED",
      source: isCustomerAcceptance ? "MANUAL_EVIDENCE" : decision?.result === "FAIL" ? "MANUAL_HOLD" : "SYSTEM",
      detail: autoGate.detail,
      decision: decision ?? null,
    };
  });
  return {
    po: {
      id: po.id, poNumber: po.po_number, orderQty: po.order_qty, status: po.status,
      dueDate: po.due_date, closedAt: po.closed_at, customerName: po.customer_name,
      productCode: po.product_code,
    },
    metrics: { workOrders: wo, quality, shipment, finance },
    gates,
    readyToClose: gates.every((gate) => gate.status === "PASS"),
  };
}

app.get("/pmc/customer-pos/:id/closure", requirePermission("pmc.view"), async (req, res) => {
  try {
    const closure = await getPmcPoClosure(req.params.id);
    if (!closure) return res.status(404).json(errorEnvelope("NOT_FOUND", "Customer PO not found"));
    res.json(envelope(closure));
  } catch (error) {
    res.status(500).json(errorEnvelope("PMC_PO_CLOSURE_READ_FAILED", error.message));
  }
});

app.post("/pmc/customer-pos/:id/closure/decisions", requirePermission("pmc.edit"), async (req, res) => {
  try {
    await pmcPoClosureReady;
    const gateCode = String(req.body?.gateCode ?? "").toUpperCase();
    const result = String(req.body?.result ?? "").toUpperCase();
    const reason = String(req.body?.reason ?? "").trim();
    const evidenceRef = String(req.body?.evidenceRef ?? "").trim();
    if (!PO_CLOSURE_GATES.includes(gateCode) || !["PASS", "FAIL"].includes(result)) {
      return res.status(400).json(errorEnvelope("VALIDATION", "valid gateCode and result required"));
    }
    if (result === "PASS" && gateCode !== "CUSTOMER_ACCEPTED") {
      return res.status(409).json(errorEnvelope(
        "SYSTEM_GATE_OVERRIDE_FORBIDDEN",
        "System-computed closure gates cannot be manually forced to PASS",
      ));
    }
    if (!reason || !evidenceRef) {
      return res.status(400).json(errorEnvelope("VALIDATION", "reason and evidenceRef required"));
    }
    const actor = String(req.user?.username ?? "PMC");
    const row = (await query(
      `INSERT INTO pmc_po_closure_decisions(customer_po_id,gate_code,result,reason,evidence_ref,actor)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, gateCode, result, reason, evidenceRef, actor],
    )).rows[0];
    await query(
      `INSERT INTO pmc_po_closure_audit(customer_po_id,event_type,actor,detail)
       VALUES($1,'GATE_DECISION',$2,$3)`,
      [req.params.id, actor, JSON.stringify({ gateCode, result, reason, evidenceRef })],
    );
    res.status(201).json(mutateEnvelope(row));
  } catch (error) {
    res.status(500).json(errorEnvelope("PMC_PO_DECISION_FAILED", error.message));
  }
});

app.post("/pmc/customer-pos/:id/close", requirePermission("pmc.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const closure = await getPmcPoClosure(req.params.id, client);
    if (!closure) throw new Error("Customer PO not found");
    if (closure.po.status === "closed") throw new Error("Customer PO already closed");
    const blocked = closure.gates.filter((gate) => gate.status !== "PASS").map((gate) => gate.gateCode);
    if (blocked.length) throw new Error(`Closure blocked: ${blocked.join(", ")}`);
    const actor = String(req.user?.username ?? "PMC");
    const row = (await client.query(
      `UPDATE customer_pos SET status='closed',closed_at=NOW(),updated_at=NOW()
       WHERE id=$1 RETURNING id,po_number,status,closed_at`,
      [req.params.id],
    )).rows[0];
    await client.query(
      `INSERT INTO pmc_po_closure_audit(customer_po_id,event_type,actor,detail)
       VALUES($1,'PO_CLOSED',$2,$3)`,
      [req.params.id, actor, JSON.stringify({ gates: closure.gates })],
    );
    await client.query("COMMIT");
    res.json(mutateEnvelope(row));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(409).json(errorEnvelope("PMC_PO_CLOSE_BLOCKED", error.message));
  } finally {
    client.release();
  }
});

app.get("/pmc/customer-pos/:id/shipments", requirePermission("pmc.view"), async (req, res) => {
  try {
    const rows = await query(
      `SELECT s.id,s.shipment_no AS "shipmentNo",s.ship_date AS "shipDate",
              s.carrier_name AS "carrierName",s.tracking_no AS "trackingNo",
              s.status,s.posting_status AS "postingStatus",
              COALESCE(SUM(sl.shipped_qty),0)::numeric AS "shippedQty"
       FROM shipments s LEFT JOIN shipment_lines sl ON sl.shipment_id=s.id
       WHERE s.customer_po_id=$1 GROUP BY s.id ORDER BY s.created_at`,
      [req.params.id],
    );
    res.json(listEnvelope(rows.rows));
  } catch (error) {
    res.status(500).json(errorEnvelope("PMC_PO_SHIPMENTS_READ_FAILED", error.message));
  }
});

app.post("/pmc/customer-pos/:id/shipments", requirePermission("pmc.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const payload = req.body ?? {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!lines.length) return res.status(400).json(errorEnvelope("VALIDATION", "shipment lines required"));
    await client.query("BEGIN");
    const po = (await client.query(
      `SELECT * FROM customer_pos WHERE id=$1 AND status NOT IN('closed','voided','cancelled') FOR UPDATE`,
      [req.params.id],
    )).rows[0];
    if (!po) throw new Error("Open customer PO not found");
    const production = (await client.query(
      `SELECT COUNT(*)::int count,
              COUNT(*) FILTER(WHERE status NOT IN('closed','completed','voided'))::int open_count
       FROM work_orders WHERE customer_po_id=$1`,
      [po.id],
    )).rows[0];
    if (!production.count || production.open_count) throw new Error("All linked work orders must be complete before shipment");
    const already = Number((await client.query(
      `SELECT COALESCE(SUM(sl.shipped_qty),0) qty FROM shipment_lines sl
       JOIN shipments s ON s.id=sl.shipment_id WHERE s.customer_po_id=$1 AND s.status<>'voided'`,
      [po.id],
    )).rows[0].qty);
    const requested = lines.reduce((sum, line) => sum + Number(line.shippedQty ?? 0), 0);
    if (!(requested > 0) || already + requested > Number(po.order_qty)) {
      throw new Error(`Shipment quantity exceeds PO balance ${po.order_qty - already}`);
    }
    const shipmentNo = String(payload.shipmentNo ?? `SHP-${po.po_number}-${Date.now()}`);
    const shipment = (await client.query(
      `INSERT INTO shipments(shipment_no,customer_id,customer_po_id,ship_date,ship_to_name,
         ship_to_address,carrier_name,tracking_no,status,posting_status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft','draft',$9) RETURNING *`,
      [shipmentNo, po.customer_id, po.id, payload.shipDate ?? new Date().toISOString().slice(0, 10),
       payload.shipToName ?? null, payload.shipToAddress ?? null, payload.carrierName ?? null,
       payload.trackingNo ?? null, req.user?.userId ?? null],
    )).rows[0];
    const requestedByWorkOrder = new Map();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const wo = (await client.query(
        `SELECT wo.id,wo.product_id,wo.completed_qty,
                COALESCE(SUM(sl.shipped_qty) FILTER(WHERE s.status<>'voided'),0)::numeric shipped_qty
         FROM work_orders wo
         LEFT JOIN shipment_lines sl ON sl.work_order_id=wo.id
         LEFT JOIN shipments s ON s.id=sl.shipment_id
         WHERE wo.id=$1 AND wo.customer_po_id=$2
         GROUP BY wo.id,wo.product_id,wo.completed_qty`,
        [line.workOrderId, po.id],
      )).rows[0];
      if (!wo) throw new Error("Shipment work order does not belong to PO");
      const lineQty = Number(line.shippedQty);
      if (!(lineQty > 0)) throw new Error("Shipment line quantity must be greater than zero");
      const workOrderKey = String(wo.id);
      const requestedForWorkOrder = (requestedByWorkOrder.get(workOrderKey) ?? 0) + lineQty;
      requestedByWorkOrder.set(workOrderKey, requestedForWorkOrder);
      const availableCompletedQty = Number(wo.completed_qty) - Number(wo.shipped_qty);
      if (requestedForWorkOrder > availableCompletedQty) {
        throw new Error(`Shipment exceeds work-order completed balance ${availableCompletedQty}`);
      }
      await client.query(
        `INSERT INTO shipment_lines(shipment_id,line_no,work_order_id,product_id,shipped_qty)
         VALUES($1,$2,$3,$4,$5)`,
        [shipment.id, index + 1, wo.id, wo.product_id, lineQty],
      );
    }
    await client.query(
      `INSERT INTO pmc_po_closure_audit(customer_po_id,event_type,actor,detail)
       VALUES($1,'SHIPMENT_CREATED',$2,$3)`,
      [po.id, String(req.user?.username ?? "PMC"), JSON.stringify({ shipmentNo, requested })],
    );
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope({ id: shipment.id, shipmentNo, status: shipment.status }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(409).json(errorEnvelope("PMC_PO_SHIPMENT_CREATE_BLOCKED", error.message));
  } finally {
    client.release();
  }
});

app.post("/pmc/shipments/:id/post", requirePermission("pmc.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const shipment = (await client.query(
      `SELECT s.*,po.po_number FROM shipments s JOIN customer_pos po ON po.id=s.customer_po_id
       WHERE s.id=$1 AND s.posting_status='draft' AND po.status NOT IN('closed','voided','cancelled') FOR UPDATE`,
      [req.params.id],
    )).rows[0];
    if (!shipment) throw new Error("Open draft shipment not found");
    const quality = (await client.query(
      `SELECT COUNT(*)::int count,
              COUNT(*) FILTER(WHERE UPPER(status) IN('PASSED','PASS','RELEASED','CLOSED'))::int passed,
              COUNT(*) FILTER(WHERE UPPER(status) IN('FAILED','FAIL','REJECTED','HOLD','PENDING','INSPECTING'))::int blocked
       FROM qms_oqc_batches WHERE customer_po_no=$1`,
      [shipment.po_number],
    )).rows[0];
    if (!quality.count || !quality.passed || quality.blocked) throw new Error("OQC release required before shipment posting");
    const updated = (await client.query(
      `UPDATE shipments SET status='shipped',posting_status='posted',posted_by=$1,posted_at=NOW(),updated_at=NOW()
       WHERE id=$2 RETURNING id,shipment_no,status,posting_status,posted_at`,
      [req.user?.userId ?? null, shipment.id],
    )).rows[0];
    await client.query(
      `INSERT INTO pmc_po_closure_audit(customer_po_id,event_type,actor,detail)
       VALUES($1,'SHIPMENT_POSTED',$2,$3)`,
      [shipment.customer_po_id, String(req.user?.username ?? "PMC"), JSON.stringify({ shipmentId: shipment.id })],
    );
    await client.query("COMMIT");
    res.json(mutateEnvelope(updated));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(409).json(errorEnvelope("PMC_PO_SHIPMENT_POST_BLOCKED", error.message));
  } finally {
    client.release();
  }
});
}

