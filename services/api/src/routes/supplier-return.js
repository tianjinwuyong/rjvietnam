// ============================================================================
// Supplier return — grafted from reference WMS-20261019
// Reference: server/modules/supplier-return/supplier-return.controller.ts
// Tables: supplier_return_order, supplier_return_item (migration 304)
// Mount: api.use("/supplier-return", createSupplierReturnRouter({ authenticateJWT }))
// ============================================================================
import { Router } from "express";
import { query } from "../db.js";
import { successEnvelope, errorEnvelope } from "../shared/helpers.js";

function datePart() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function nextReturnNo() {
  const seq = Number((await query(`SELECT nextval('seq_supplier_return_no') AS n`)).rows[0]?.n || 1);
  return `SR${datePart()}${String(seq).padStart(4, "0")}`;
}

async function getDetail(id) {
  const order = (await query(`SELECT * FROM supplier_return_order WHERE id=$1`, [id])).rows[0];
  if (!order) return null;
  const items = (await query(`SELECT * FROM supplier_return_item WHERE order_id=$1 ORDER BY sort_order,id`, [id])).rows;
  return { ...order, items };
}

export function createSupplierReturnRouter({ authenticateJWT }) {
  const router = Router();
  router.use(authenticateJWT);

  router.get("/list", async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 200);
      const p = [];
      const where = [];
      if (req.query.returnNo) where.push(`return_no ILIKE $${p.push(`%${req.query.returnNo}%`)}`);
      if (req.query.status) where.push(`status = $${p.push(req.query.status)}`);
      if (req.query.supplierCode) where.push(`supplier_code ILIKE $${p.push(`%${req.query.supplierCode}%`)}`);
      if (req.query.startDate) where.push(`created_at >= $${p.push(req.query.startDate)}`);
      if (req.query.endDate) where.push(`created_at <= $${p.push(req.query.endDate)}`);
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [rows, total] = await Promise.all([
        query(`SELECT * FROM supplier_return_order ${clause} ORDER BY created_at DESC LIMIT $${p.push(pageSize)} OFFSET $${p.push((page - 1) * pageSize)}`, p),
        query(`SELECT count(*)::int AS n FROM supplier_return_order ${clause}`, p.slice(0, where.length)),
      ]);
      res.json(successEnvelope({ items: rows.rows, total: total.rows[0]?.n || 0, page, pageSize }));
    } catch (e) { res.status(500).json(errorEnvelope("SUPPLIER_RETURN_LIST_FAILED", e.message)); }
  });

  router.get("/pending-count", async (_req, res) => {
    try {
      const { rows } = await query(
        `SELECT count(*)::int AS pending FROM supplier_return_order WHERE status='pending_out'`
      );
      res.json(successEnvelope(rows[0]));
    } catch (e) { res.status(500).json(errorEnvelope("SUPPLIER_RETURN_COUNT_FAILED", e.message)); }
  });

  // Create from an MRB 'return' disposition (used by MRB final-approve).
  router.post("/create", async (req, res) => {
    try {
      const { mrbId, dispositionId, supplierCode, supplierName, batchNo, materialCode,
               materialName, materialId, quantity, unit, locationId, inventoryId, remark } = req.body || {};
      const returnNo = await nextReturnNo();
      const qty = Number(quantity) || 0;
      const { rows } = await query(
        `INSERT INTO supplier_return_order
          (return_no,mrb_id,disposition_id,supplier_code,supplier_name,batch_no,status,total_qty,unit,remark,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending_out',$7,$8,$9,$10,now(),now()) RETURNING id`,
        [returnNo, mrbId || null, dispositionId || null, supplierCode || null, supplierName || null,
         batchNo || null, qty, unit || "PCS", remark || null, req.user?.userId || null]
      );
      const id = rows[0].id;
      if (materialCode && qty > 0) {
        await query(
          `INSERT INTO supplier_return_item
            (order_id,material_id,material_code,material_name,batch_no,location_id,inventory_id,quantity,unit,disposition_id,sort_order,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,now(),now())`,
          [id, materialId || null, materialCode, materialName || null, batchNo || null,
           locationId || null, inventoryId || null, qty, unit || "PCS", dispositionId || null]
        );
      }
      res.json(successEnvelope(await getDetail(id)));
    } catch (e) { res.status(500).json(errorEnvelope("SUPPLIER_RETURN_CREATE_FAILED", e.message)); }
  });

  router.post("/outbound", async (req, res) => {
    try {
      const { orderId, remark } = req.body || {};
      const operator = req.user?.userId || "";
      const order = (await query(`SELECT status,total_qty FROM supplier_return_order WHERE id=$1`, [orderId])).rows[0];
      if (!order) return res.status(404).json(errorEnvelope("SUPPLIER_RETURN_NOT_FOUND", "Order not found"));
      if (order.status !== "pending_out") return res.status(409).json(errorEnvelope("SUPPLIER_RETURN_INVALID_STATE", "Only pending_out orders can be shipped"));
      await query(`UPDATE supplier_return_order SET status='out',out_qty=total_qty,out_time=now(),out_by=$2,remark=COALESCE($3,remark),updated_at=now() WHERE id=$1`, [orderId, operator, remark || null]);
      await query(`UPDATE supplier_return_item SET out_qty=quantity,updated_at=now() WHERE order_id=$1`, [orderId]);
      res.json(successEnvelope(await getDetail(orderId)));
    } catch (e) { res.status(500).json(errorEnvelope("SUPPLIER_RETURN_OUTBOUND_FAILED", e.message)); }
  });

  router.post("/cancel", async (req, res) => {
    try {
      const { orderId, remark } = req.body || {};
      await query(`UPDATE supplier_return_order SET status='cancelled',remark=COALESCE($2,remark),updated_at=now() WHERE id=$1`, [orderId, remark || null]);
      res.json(successEnvelope(await getDetail(orderId)));
    } catch (e) { res.status(500).json(errorEnvelope("SUPPLIER_RETURN_CANCEL_FAILED", e.message)); }
  });

  router.get("/detail/:id", async (req, res) => {
    try {
      const detail = await getDetail(req.params.id);
      if (!detail) return res.status(404).json(errorEnvelope("SUPPLIER_RETURN_NOT_FOUND", "Order not found"));
      res.json(successEnvelope(detail));
    } catch (e) { res.status(500).json(errorEnvelope("SUPPLIER_RETURN_DETAIL_FAILED", e.message)); }
  });

  return router;
}
