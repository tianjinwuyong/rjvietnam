// ============================================================================
// MRB 遗留接口（补齐参考 WMS-20261019 里剩余 4 个动作 + 1 个查询）
// Reference: server/modules/mrb/mrb.controller.ts
//   GET  /mrb/lot-groups            已处理 MRB 按 IQC 批次折叠
//   GET  /mrb/lot-labels            该批次的一箱一码 + 已分摊量
//   GET  /mrb/plan/:mrbId           读方案（处置明细 + 二维码分摊 + 评审员）
//   POST /mrb/disposition/:id/confirm-out   「其他-退回客户」确认已提走（核销库存）
//   POST /mrb/disposition/:id/destroy       报废销毁（货已进不良品仓后核销）
// Tables: mrb_review / mrb_disposition / mrb_disposition_label / mrb_reviewer,
//         rjvn_iqc_lot(_receipt) / rjvn_receipt_order（309 镜像）, iqc_inspections,
//         material_lots / inventory_transactions / storage_locations / users
// Mount: api.use("/mrb", createMrbExtrasRouter({ authenticateJWT }))  在 mrb.js 之后
// ============================================================================
import { Router } from "express";
import { query, getClient } from "../db.js";
import { successEnvelope, listEnvelope, errorEnvelope } from "../shared/helpers.js";

const WRITE_ROLES = ["sqe", "iqc_manager", "quality_manager", "admin"];
const CONFIRM_OUT_ROLES = ["wh_keeper", "wh_manager", "admin"];
const DESTROY_ROLES = ["wh_keeper", "wh_manager", "quality_manager", "admin"];

// mrb.status.ts：终态 / 阻塞再次发起的状态
const DONE_STATUSES = ["closed", "approved", "rejected", "cancelled"];
const BLOCKING_STATUSES = ["draft", "pending_review", "reviewing", "pending_approval", "pending_final"];

function requireRoles(...roles) {
  return (req, res, next) => {
    const role = String(req.user?.roleKey || "").toLowerCase();
    if (!roles.includes(role)) {
      return res.status(403).json(errorEnvelope("FORBIDDEN", `Requires one of: ${roles.join(", ")}`));
    }
    next();
  };
}

const operatorOf = (req) => ({
  id: Number(req.user?.userId) || null,
  name: req.user?.username || "",
  role: String(req.user?.roleKey || "").toLowerCase(),
});

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const text = (v) => String(v ?? "").trim();

/**
 * 批次的可核销/可评审量：SMT 无 inventory 表，库存由 inventory_transactions 派生。
 * 口径与 defective-move 的来源库存一致（posted 且未作废）。
 */
/**
 * 批次余额。SMT 没有 inventory 表：库存由 inventory_transactions 派生。
 * 约束 inventory_transactions_action_check 只允许
 * RECEIVE/IQC_RELEASE/IQC_HOLD/IQC_REJECT/PUT_AWAY/RESERVE/PICK/ISSUE_TO_LINE/
 * RETURN_FROM_LINE/TRANSFER/SCRAP/ADJUST —— 方向由 qty 符号与库位归属决定，
 * 库内移库（TRANSFER）不改批次总量。
 */
const LOT_QTY_SQL = `
  COALESCE(SUM(CASE WHEN it.action = 'TRANSFER' THEN 0 ELSE it.qty END), 0)
`;

/** 某批次在「不良品仓」的余量（参考实现：stock_status='scrapped' 且 warehouse.wh_type='defective'） */
const DEFECTIVE_QTY_SQL = `
  COALESCE(SUM(CASE
    WHEN it.action = 'TRANSFER' THEN
      CASE WHEN sl_t.location_type = 'defective' THEN it.qty
           WHEN sl_f.location_type = 'defective' THEN -it.qty ELSE 0 END
    WHEN sl_f.location_type = 'defective' AND sl_t.location_type IS DISTINCT FROM 'defective' THEN it.qty
    WHEN sl_t.location_type = 'defective' AND sl_f.location_type IS DISTINCT FROM 'defective' THEN it.qty
    ELSE 0 END), 0)
`;

/** mrb_review.lot_id → iqc_inspections → lot_no → material_lots.id（SMT 库存域） */
async function resolveMaterialLot(db, mrb) {
  const insp = (await db.query(
    `SELECT id, lot_no FROM iqc_inspections
      WHERE ($1::text IS NOT NULL AND inspection_no = $1) OR ($2::bigint IS NOT NULL AND id = $2)
      ORDER BY (inspection_no = $1) DESC NULLS LAST LIMIT 1`,
    [mrb.source_inspection_no || null, mrb.lot_id ?? null]
  )).rows[0];
  if (!insp?.lot_no) return null;
  const lot = (await db.query(
    `SELECT ml.id, ml.lot_no, ml.material_id, ml.received_qty, ml.storage_location_id
       FROM material_lots ml WHERE ml.lot_no = $1 AND COALESCE(ml.lot_status,'') NOT IN ('closed','voided')
       ORDER BY ml.id DESC LIMIT 1`, [insp.lot_no]
  )).rows[0];
  return lot ? { ...lot, lotNo: insp.lot_no } : null;
}

async function lotAvailableQty(db, lotId) {
  const r = (await db.query(
    `SELECT ${LOT_QTY_SQL} AS qty FROM inventory_transactions it
      WHERE it.material_lot_id = $1 AND it.tx_status = 'posted' AND COALESCE(it.voided,false) = false`,
    [lotId]
  )).rows[0];
  return num(r?.qty);
}

/** 全部处置明细执行完毕 → 单子结案（参考 syncExecutionStatus 的 pending_execute → closed） */
async function syncExecutionStatus(db, mrbId) {
  const left = (await db.query(
    `SELECT count(*)::int AS n FROM mrb_disposition WHERE mrb_id=$1 AND exec_status='pending'`, [mrbId]
  )).rows[0]?.n || 0;
  if (left > 0) return null;
  const r = (await db.query(
    `UPDATE mrb_review SET status='closed', status_since=now(), updated_at=now()
      WHERE id=$1 AND status IN ('pending_execute','approved') RETURNING status`, [mrbId]
  )).rows[0];
  return r?.status ?? null;
}

async function detailOf(db, id) {
  const review = (await db.query(`SELECT * FROM mrb_review WHERE id=$1`, [id])).rows[0];
  if (!review) return null;
  const [reviewers, dispositions, labels] = await Promise.all([
    db.query(`SELECT * FROM mrb_reviewer WHERE mrb_id=$1 ORDER BY sort_order, id`, [id]),
    db.query(`SELECT * FROM mrb_disposition WHERE mrb_id=$1 ORDER BY sort_order, id`, [id]),
    db.query(`SELECT * FROM mrb_disposition_label WHERE mrb_id=$1 ORDER BY id`, [id]),
  ]);
  return { ...review, reviewers: reviewers.rows, dispositions: dispositions.rows, labels: labels.rows };
}

export function createMrbExtrasRouter({ authenticateJWT }) {
  const router = Router();
  router.use(authenticateJWT);

  // ── 已处理 MRB —— 按 IQC 批次折叠 ────────────────────────────────────────
  router.get("/lot-groups", async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 200);
      /** @type {any[]} */ const p = [DONE_STATUSES];
      const where = ["status = ANY($1::text[])", "lot_id IS NOT NULL"];
      if (req.query.mrbNo) {
        const kw = `%${text(req.query.mrbNo)}%`;
        p.push(kw);
        where.push(`(mrb_no ILIKE $${p.length} OR source_inspection_no ILIKE $${p.length})`);
      }
      if (req.query.materialCode) { p.push(`%${text(req.query.materialCode)}%`); where.push(`material_code ILIKE $${p.length}`); }
      if (req.query.batchNo) { p.push(`%${text(req.query.batchNo)}%`); where.push(`batch_no ILIKE $${p.length}`); }
      if (req.query.status) { p.push(req.query.status); where.push(`status = $${p.length}`); }
      if (req.query.startDate) { p.push(req.query.startDate); where.push(`created_at >= $${p.length}`); }
      if (req.query.endDate) { p.push(req.query.endDate); where.push(`created_at < $${p.length}`); }
      const clause = where.join(" AND ");

      const groups = (await query(
        `SELECT lot_id, count(*) FILTER (WHERE status IN ('approved','closed'))::int AS review_count,
                count(*)::int AS total_count, max(created_at) AS last_at
           FROM mrb_review WHERE ${clause}
          GROUP BY lot_id ORDER BY last_at DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`,
        [...p, pageSize, (page - 1) * pageSize]
      )).rows;
      const total = (await query(
        `SELECT count(DISTINCT lot_id)::int AS n FROM mrb_review WHERE ${clause}`, p
      )).rows[0]?.n || 0;
      if (!groups.length) return res.json(listEnvelope([], total));

      const lotIds = groups.map((g) => g.lot_id);
      const rows = (await query(
        `SELECT * FROM mrb_review WHERE lot_id = ANY($1::bigint[]) AND status = ANY($2::text[])
          ORDER BY created_at DESC`, [lotIds, DONE_STATUSES]
      )).rows;
      const byLot = new Map();
      for (const r of rows) {
        if (!byLot.has(r.lot_id)) byLot.set(r.lot_id, []);
        byLot.get(r.lot_id).push(r);
      }

      // 剩余不良品量 = 该批次检验不合格量 − 未作废 MRB 已占用量
      const inspNos = rows.map((r) => r.source_inspection_no).filter(Boolean);
      const rejected = new Map(
        (await query(
          `SELECT inspection_no, COALESCE(SUM(rejected_qty),0) AS qty FROM iqc_inspections
            WHERE inspection_no = ANY($1::text[]) GROUP BY inspection_no`, [inspNos]
        )).rows.map((r) => [r.inspection_no, num(r.qty)])
      );
      const claimed = new Map(
        (await query(
          `SELECT lot_id, COALESCE(SUM(quantity),0) AS qty FROM mrb_review
            WHERE lot_id = ANY($1::bigint[]) AND status NOT IN ('cancelled','rejected') GROUP BY lot_id`, [lotIds]
        )).rows.map((r) => [r.lot_id, num(r.qty)])
      );
      const active = new Set((await query(
        `SELECT DISTINCT lot_id FROM mrb_review WHERE lot_id = ANY($1::bigint[]) AND status = ANY($2::text[])`,
        [lotIds, BLOCKING_STATUSES]
      )).rows.map((r) => r.lot_id));

      const items = [];
      for (const g of groups) {
        const list = byLot.get(g.lot_id) || [];
        if (!list.length) continue;
        const [latest, ...history] = list;
        const defectiveQty = rejected.get(latest.source_inspection_no) ?? 0;
        const remaining = Math.max(0, defectiveQty - (claimed.get(g.lot_id) ?? 0));
        items.push({
          lotId: Number(g.lot_id),
          batchNo: latest.batch_no,
          materialId: latest.material_id,
          materialCode: latest.material_code,
          materialName: latest.material_name,
          supplierId: latest.supplier_id,
          supplierCode: latest.supplier_code,
          supplierName: latest.supplier_name,
          unit: latest.unit,
          reviewCount: g.review_count,
          totalCount: g.total_count,
          remainingDefectiveQty: remaining,
          canReinitiate: !active.has(g.lot_id) && remaining > 0,
          latest,
          history,
        });
      }
      res.json(listEnvelope(items, total));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_LOT_GROUPS_FAILED", e.message)); }
  });

  // ── 该批次的一箱一码 + 已分摊量 ──────────────────────────────────────────
  router.get("/lot-labels", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const mrbId = req.query.mrbId ? Number(req.query.mrbId) : null;
      let lotNo = text(req.query.lotNo || req.query.lotId);

      if (mrbId) {
        const mrb = (await query(
          `SELECT id, lot_id, source_inspection_no FROM mrb_review WHERE id=$1`, [mrbId]
        )).rows[0];
        if (!mrb) return res.status(404).json(errorEnvelope("MRB_NOT_FOUND", "MRB 评审单不存在"));
        const insp = (await query(
          `SELECT lot_no FROM iqc_inspections
            WHERE ($1::text IS NOT NULL AND inspection_no=$1) OR ($2::bigint IS NOT NULL AND id=$2)
            ORDER BY (inspection_no = $1) DESC NULLS LAST LIMIT 1`,
          [mrb.source_inspection_no, mrb.lot_id]
        )).rows[0];
        lotNo = insp?.lot_no ?? "";
      }
      if (!lotNo) return res.status(400).json(errorEnvelope("VALIDATION", "请提供 lotNo / lotId / mrbId"));
      if (/^\d+$/.test(lotNo)) {
        // 传了 iqc_inspections.id 时换算成 lot_no
        const insp = (await query(`SELECT lot_no FROM iqc_inspections WHERE id=$1`, [Number(lotNo)])).rows[0];
        if (insp?.lot_no) lotNo = insp.lot_no;
      }

      const rows = (await query(
        `SELECT ro.id AS "receiptId", ro.receipt_no AS "receiptNo", ro.qr_content AS "qrContent",
                ro.quantity, ro.production_date AS "productionDate", ro.batch_no AS "batchNo",
                ro.serial_no AS "serialNo", COALESCE(alloc.allocated, 0) AS allocated
           FROM rjvn_iqc_lot il
           JOIN rjvn_iqc_lot_receipt ilr ON ilr.lot_id = il.id
           JOIN rjvn_receipt_order ro ON ro.id = ilr.receipt_id
           LEFT JOIN (
             SELECT mdl.receipt_no, SUM(mdl.quantity) AS allocated
               FROM mrb_disposition_label mdl WHERE mdl.mrb_id = $1 GROUP BY mdl.receipt_no
           ) alloc ON alloc.receipt_no = ro.receipt_no
          WHERE il.lot_no = $2
          ORDER BY ro.receipt_no`,
        [mrbId, lotNo]
      )).rows;

      const items = rows.map((r) => {
        const qty = num(r.quantity);
        const allocated = num(r.allocated);
        return {
          receiptId: r.receiptId, receiptNo: r.receiptNo, qrContent: r.qrContent,
          quantity: qty, allocated, remaining: Math.round((qty - allocated) * 10000) / 10000,
          productionDate: r.productionDate, batchNo: r.batchNo, serialNo: r.serialNo,
        };
      });
      res.json({ code: 0, message: "success", data: { items, lotNo } });
    } catch (e) { res.status(500).json(errorEnvelope("MRB_LOT_LABELS_FAILED", e.message)); }
  });

  // ── 读方案（处置明细 + 二维码分摊 + 评审员）─────────────────────────────
  router.get("/plan/:mrbId", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const mrbId = Number(req.params.mrbId);
      if (!Number.isFinite(mrbId)) return res.status(400).json(errorEnvelope("VALIDATION", "mrbId is invalid"));
      const mrb = (await query(
        `SELECT id, mrb_no, status, quantity, plan_by, plan_time, fail_reason FROM mrb_review WHERE id=$1`, [mrbId]
      )).rows[0];
      if (!mrb) return res.status(404).json(errorEnvelope("MRB_NOT_FOUND", "MRB 评审单不存在"));

      const [disp, labels, reviewers] = await Promise.all([
        query(`SELECT id, disposition_type, other_type, ref_no, hold_until, quantity, unit,
                      exec_status, remark, sort_order
                 FROM mrb_disposition WHERE mrb_id=$1 ORDER BY sort_order, id`, [mrbId]),
        query(`SELECT disposition_id, receipt_id, receipt_no, qr_content, quantity
                 FROM mrb_disposition_label WHERE mrb_id=$1 ORDER BY receipt_no`, [mrbId]),
        query(`SELECT r.id, r.reviewer_id, r.reviewer_role, r.review_result, r.review_opinion,
                      r.review_time, u.username AS reviewer_name, u.display_name AS reviewer_display_name
                 FROM mrb_reviewer r LEFT JOIN users u ON u.id = r.reviewer_id
                WHERE r.mrb_id=$1 ORDER BY r.sort_order, r.id`, [mrbId]),
      ]);

      const labelMap = new Map();
      for (const l of labels.rows) {
        if (!labelMap.has(l.disposition_id)) labelMap.set(l.disposition_id, []);
        labelMap.get(l.disposition_id).push({
          receiptId: l.receipt_id, receiptNo: l.receipt_no,
          qrContent: l.qr_content, quantity: num(l.quantity),
        });
      }

      res.json({
        code: 0, message: "success",
        data: {
          mrbId, mrbNo: mrb.mrb_no, status: mrb.status, quantity: mrb.quantity,
          planBy: mrb.plan_by, planTime: mrb.plan_time, failReason: mrb.fail_reason,
          dispositions: disp.rows.map((d) => ({
            id: d.id, dispositionType: d.disposition_type, otherType: d.other_type,
            refNo: d.ref_no, holdUntil: d.hold_until, quantity: num(d.quantity), unit: d.unit,
            execStatus: d.exec_status, remark: d.remark, labels: labelMap.get(d.id) || [],
          })),
          reviewers: reviewers.rows.map((r) => ({
            id: r.id, reviewerId: r.reviewer_id,
            reviewerName: r.reviewer_display_name || r.reviewer_name,
            reviewerRole: r.reviewer_role, reviewResult: r.review_result,
            reviewOpinion: r.review_opinion, reviewTime: r.review_time,
          })),
        },
      });
    } catch (e) { res.status(500).json(errorEnvelope("MRB_PLAN_READ_FAILED", e.message)); }
  });

  // ── 「其他-退回客户」确认已提走：核销库存 + 明细 done ─────────────────────
  router.post("/disposition/:id/confirm-out", requireRoles(...CONFIRM_OUT_ROLES), async (req, res) => {
    const client = await getClient();
    try {
      const dispositionId = Number(req.params.id);
      if (!Number.isFinite(dispositionId)) return res.status(400).json(errorEnvelope("VALIDATION", "id is invalid"));
      const op = operatorOf(req);
      await client.query("BEGIN");

      const disp = (await client.query(
        `SELECT id, mrb_id, disposition_type, other_type, exec_status, quantity, unit
           FROM mrb_disposition WHERE id=$1 FOR UPDATE`, [dispositionId]
      )).rows[0];
      if (!disp) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("MRB_DISPOSITION_NOT_FOUND", "处置明细不存在")); }
      if (disp.disposition_type !== "other" || disp.other_type !== "customer_return") {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "仅「其他-退回客户」的处置明细需要确认提走"));
      }
      if (disp.exec_status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "该处置明细已完成或已取消，无需重复确认"));
      }
      const need = num(disp.quantity);
      if (need <= 0) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "处置数量异常，无法核销")); }

      const mrb = (await client.query(
        `SELECT * FROM mrb_review WHERE id=$1`, [disp.mrb_id]
      )).rows[0];
      const matLot = await resolveMaterialLot(client, mrb);
      let available = matLot ? await lotAvailableQty(client, matLot.id) : 0;
      if (matLot && available + 1e-9 < need) {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope("MRB_RESERVE_INSUFFICIENT",
          `保留库存不足：本明细需核销 ${need}，实际可核销 ${available}（批次 ${mrb.batch_no || "-"}）。请核对保留库存后再确认提走`));
      }

      if (matLot) {
        // FIFO 语义在 SMT 由批次行的派生余额承担，这里落一条负向流水，余额记在流水里
        const next = Math.round((available - need) * 10000) / 10000;
        await client.query(
          `INSERT INTO inventory_transactions
             (tx_no, action, material_lot_id, qty, from_location_id, to_location_id, operator_id,
              tx_status, reference_type, reference_no, occurred_at, updated_at)
           VALUES ($1,'ADJUST',$2,$3,$4,NULL,$5,'posted','mrb_customer_return',$6,now(),now())`,
          [`MRB-OUT-${mrb.mrb_no}-${disp.id}`, matLot.id, -need, matLot.storage_location_id, op.id, mrb.mrb_no]
        );
        available = next;
      }

      await client.query(
        `UPDATE mrb_disposition SET exec_status='done', exec_time=now(), updated_at=now() WHERE id=$1`,
        [dispositionId]
      );
      // 客户提货即供应商退货单出库（SMT 的 SRO 用 out/out_qty/out_time 记实际出库）
      await client.query(
        `UPDATE supplier_return_order
            SET status='out', out_qty=COALESCE(out_qty,0)+$2::numeric, out_time=now(), out_by=$3, updated_at=now()
          WHERE disposition_id=$1 AND status NOT IN ('out','closed','cancelled')`,
        [dispositionId, need, op.id]
      );
      await client.query("COMMIT");

      const closed = await syncExecutionStatus({ query }, disp.mrb_id);
      res.json(successEnvelope({ ...(await detailOf({ query }, disp.mrb_id)), closed }));
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
      res.status(500).json(errorEnvelope("MRB_CONFIRM_OUT_FAILED", e.message));
    } finally {
      client.release?.();
    }
  });

  // ── 报废销毁：货已在不良品仓后核销 ──────────────────────────────────────
  router.post("/disposition/:id/destroy", requireRoles(...DESTROY_ROLES), async (req, res) => {
    const client = await getClient();
    try {
      const dispositionId = Number(req.params.id);
      if (!Number.isFinite(dispositionId)) return res.status(400).json(errorEnvelope("VALIDATION", "id is invalid"));
      const op = operatorOf(req);
      await client.query("BEGIN");

      const disp = (await client.query(
        `SELECT id, mrb_id, disposition_type, exec_status, quantity FROM mrb_disposition
          WHERE id=$1 FOR UPDATE`, [dispositionId]
      )).rows[0];
      if (!disp) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("MRB_DISPOSITION_NOT_FOUND", "处置明细不存在")); }
      if (disp.disposition_type !== "scrap") {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "仅「报废」的处置明细需要确认销毁"));
      }
      if (disp.exec_status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "该处置明细已完成或已取消，无需重复销毁"));
      }
      const need = num(disp.quantity);
      if (need <= 0) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "处置数量异常，无法销毁")); }

      const mrb = (await client.query(`SELECT * FROM mrb_review WHERE id=$1`, [disp.mrb_id])).rows[0];
      // 参考实现只允许 pending_execute；SMT 的 final-approve 目前落到 approved，两者都算可执行
      if (!["pending_execute", "approved"].includes(mrb.status)) {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", `当前状态（${mrb.status}）不可执行报废销毁`));
      }

      const matLot = await resolveMaterialLot(client, mrb);
      // 只认「不良品仓」里的量：参考实现的 w.wh_type='defective'
      const inDefective = matLot ? num((await client.query(
        `SELECT ${DEFECTIVE_QTY_SQL} AS qty
           FROM inventory_transactions it
           LEFT JOIN storage_locations sl_t ON sl_t.id = it.to_location_id
           LEFT JOIN storage_locations sl_f ON sl_f.id = it.from_location_id
          WHERE it.material_lot_id=$1 AND it.tx_status='posted' AND COALESCE(it.voided,false)=false`,
        [matLot.id]
      )).rows[0]?.qty) : 0;
      if (!matLot || inDefective + 1e-9 < need) {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope("MRB_SCRAP_NOT_IN_DEFECTIVE",
          `报废库存尚未调入不良品仓：本明细需销毁 ${need}，不良品仓现有 ${inDefective}（批次 ${mrb.batch_no || "-"}）。请先完成不良品调拨任务`));
      }

      const defectiveLoc = (await client.query(
        `SELECT id FROM storage_locations WHERE location_type='defective' AND status='active'
          ORDER BY id LIMIT 1`
      )).rows[0];
      const remark = text(req.body?.remark);
      await client.query(
        `INSERT INTO inventory_transactions
           (tx_no, action, material_lot_id, qty, from_location_id, to_location_id, operator_id,
            tx_status, reference_type, reference_no, occurred_at, updated_at)
         VALUES ($1,'SCRAP',$2,$3,$4,NULL,$5,'posted','mrb_scrap',$6,now(),now())`,
        [`MRB-SCRAP-${mrb.mrb_no}-${disp.id}`, matLot.id, -need, defectiveLoc?.id ?? null, op.id, mrb.mrb_no]
      );
      await client.query(
        `UPDATE mrb_disposition SET exec_status='done', exec_time=now(),
                remark=COALESCE($2, remark), updated_at=now() WHERE id=$1`,
        [dispositionId, remark || null]
      );
      await client.query("COMMIT");

      const closed = await syncExecutionStatus({ query }, disp.mrb_id);
      res.json(successEnvelope({ ...(await detailOf({ query }, disp.mrb_id)), closed }));
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
      res.status(500).json(errorEnvelope("MRB_DESTROY_FAILED", e.message));
    } finally {
      client.release?.();
    }
  });

  return router;
}
