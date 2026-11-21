// ============================================================================
// Supplier debt hooks — grafted from reference WMS-20261019
// Reference: server/modules/supplier-debt/supplier-debt.service.ts
//   createDebt() called from MRB + production-return IQC
//   settleDebtOnReceipt() called from IQC receipt pass (idempotent per receipt)
// Tables: supplier_debt, supplier_debt_settlement (migration 300)
// ============================================================================
import { Router } from "express";
import { query } from "../db.js";
import { successEnvelope, errorEnvelope } from "../shared/helpers.js";

function datePart() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function nextDebtNo() {
  const seq = Number((await query(`SELECT nextval('seq_supplier_debt_no') AS n`)).rows[0]?.n || 1);
  return `SD${datePart()}${String(seq).padStart(4, "0")}`;
}

export async function createDebt({
  supplierId, supplierCode, supplierName, materialId, materialCode, materialName,
  qty, sourceType = "production_return", sourceId, sourceNo, userId,
}) {
  if (!supplierCode || !materialCode || !(Number(qty) > 0)) {
    throw new Error("supplierCode, materialCode and positive qty are required");
  }
  const debtNo = await nextDebtNo();
  const { rows } = await query(
    `INSERT INTO supplier_debt
      (debt_no,supplier_id,supplier_code,supplier_name,material_id,material_code,material_name,
       origin_qty,settled_qty,source_type,source_id,source_no,status,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,'pending',$12,now(),now())
     RETURNING *`,
    [debtNo, supplierId || null, supplierCode, supplierName || null, materialId || null,
     materialCode, materialName || null, Number(qty), sourceType, sourceId || null,
     sourceNo || null, userId || null]
  );
  return rows[0];
}

export async function hasPendingDebt(supplierId, materialId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM supplier_debt
      WHERE status='pending' AND supplier_id=$1 AND material_id=$2`,
    [supplierId, materialId]
  );
  return Number(rows[0]?.n || 0) > 0;
}

export async function settleDebtOnReceipt({
  supplierId, materialId, supplierCode, materialCode, qty, receiptId, receiptNo, result = "pass", userId,
}) {
  const amount = Number(qty) || 0;
  if (amount <= 0) return [];
  const settled = [];

  // Callers (e.g. IQC) often only know codes; resolve them to ids.
  if (!supplierId && supplierCode) {
    supplierId = (await query(`SELECT id FROM suppliers WHERE code=$1 LIMIT 1`, [supplierCode])).rows[0]?.id || null;
  }
  if (!materialId && materialCode) {
    materialId = (await query(`SELECT id FROM materials WHERE code=$1 LIMIT 1`, [materialCode])).rows[0]?.id || null;
  }
  const useCodes = !supplierId || !materialId;
  if (!useCodes && !supplierId) return [];

  const pending = (await query(
    `SELECT id,origin_qty,settled_qty FROM supplier_debt
      WHERE status='pending'
        AND ($${1}=1 OR supplier_id=$${2})
        AND ($${3}=1 OR material_id=$${4})
        AND ($${5}=0 OR supplier_code=$${6})
        AND ($${7}=0 OR material_code=$${8})
      ORDER BY created_at FOR UPDATE`,
    [useCodes ? 1 : 0, supplierId, useCodes ? 1 : 0, materialId,
     supplierCode ? 1 : 0, supplierCode || null, materialCode ? 1 : 0, materialCode || null]
  )).rows;

  let remaining = amount;
  for (const debt of pending) {
    if (remaining <= 0) break;
    const open = Number(debt.origin_qty) - Number(debt.settled_qty);
    if (open <= 0) continue;
    const take = Math.min(open, remaining);

    const inserted = (await query(
      `INSERT INTO supplier_debt_settlement
        (debt_id,receipt_id,receipt_no,qty,iqc_result,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())
       ON CONFLICT (debt_id, receipt_id) DO NOTHING
       RETURNING id`,
      [debt.id, receiptId || null, receiptNo || null, take, result, userId || null]
    )).rows[0];

    if (inserted) {
      await query(
        `UPDATE supplier_debt
            SET settled_qty=settled_qty+$2,
                status=CASE WHEN settled_qty+$2 >= origin_qty THEN 'settled' ELSE status END,
                updated_at=now()
          WHERE id=$1`,
        [debt.id, take]
      );
      settled.push({ debtId: debt.id, qty: take, settlementId: inserted.id });
      remaining -= take;
    }
  }
  return settled;
}

export function createSupplierDebtRouter({ authenticateJWT }) {
  const router = Router();
  router.use(authenticateJWT);

  router.post("/settle", async (req, res) => {
    try {
      const { supplierId, materialId, supplierCode, materialCode, qty, receiptId, receiptNo, result, userId } = req.body || {};
      const settled = await settleDebtOnReceipt({
        supplierId, materialId, supplierCode, materialCode, qty, receiptId, receiptNo, result,
        userId: userId || req.user?.userId,
      });
      res.json(successEnvelope({ settled, remaining: Math.max(0, Number(qty || 0) - settled.reduce((s, x) => s + Number(x.qty), 0)) }));
    } catch (e) { res.status(500).json(errorEnvelope("DEBT_SETTLE_FAILED", e.message)); }
  });

  router.post("/create", async (req, res) => {
    try {
      const debt = await createDebt({ ...req.body, userId: req.body.userId || req.user?.userId });
      res.json(successEnvelope(debt));
    } catch (e) { res.status(500).json(errorEnvelope("DEBT_CREATE_FAILED", e.message)); }
  });

  return router;
}
