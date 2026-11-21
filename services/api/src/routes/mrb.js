// ============================================================================
// MRB (Material Review Board) — grafted from reference WMS-20261019
// Reference: server/modules/mrb/mrb.controller.ts + mrb.service.ts
// Tables: mrb_review, mrb_reviewer, mrb_disposition, mrb_disposition_label,
//         mrb_cc, sys_notices (migration 298)
// Mount: app.use("/api/mrb", createMrbRouter({ authenticateJWT })) —— 必须在 OA 之前（OA 有 /api/mrb/:id 单段 catch-all）
// ============================================================================
import { Router } from "express";
import { query } from "../db.js";
import { successEnvelope, listEnvelope, errorEnvelope } from "../shared/helpers.js";

const WRITE_ROLES = ["sqe", "iqc_manager", "quality_manager", "admin"];
const PRE_APPROVE_ROLES = ["iqc_manager", "admin"];
const FINAL_ROLES = ["quality_manager", "admin"];

function requireRoles(...roles) {
  return (req, res, next) => {
    const role = String(req.user?.roleKey || "").toLowerCase();
    if (!roles.includes(role)) {
      return res.status(403).json(errorEnvelope("FORBIDDEN", `Requires one of: ${roles.join(", ")}`));
    }
    next();
  };
}

function datePart() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function nextMrbNo() {
  const seq = Number((await query(`SELECT nextval('seq_mrb_no') AS n`)).rows[0]?.n || 1);
  return `MRB${datePart()}${String(seq).padStart(4, "0")}`;
}

// Map a document prefix to its reference sequence (migration 307).
const SEQ_BY_PREFIX = { RW: "seq_rework_no", DM: "seq_defective_move_no", SD: "seq_supplier_debt_no", SR: "seq_supplier_return_no" };
async function nextDocNo(table, column, prefix) {
  const seqName = SEQ_BY_PREFIX[prefix.slice(0, 2)];
  if (seqName) {
    const seq = Number((await query(`SELECT nextval('${seqName}') AS n`)).rows[0]?.n || 1);
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }
  const { rows } = await query(
    `SELECT ${column} FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const last = rows[0]?.[column];
  const seq = last ? Number(String(last).slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function operatorOf(req) {
  return {
    id: req.user?.userId || null,
    name: req.user?.username || "",
    role: String(req.user?.roleKey || "").toLowerCase(),
  };
}

async function getDetail(id) {
  const review = (await query(`SELECT * FROM mrb_review WHERE id=$1`, [id])).rows[0];
  if (!review) return null;
  const [reviewers, dispositions, labels, cc] = await Promise.all([
    query(`SELECT * FROM mrb_reviewer WHERE mrb_id=$1 ORDER BY sort_order, id`, [id]),
    query(`SELECT * FROM mrb_disposition WHERE mrb_id=$1 ORDER BY sort_order, id`, [id]),
    query(`SELECT * FROM mrb_disposition_label WHERE mrb_id=$1 ORDER BY id`, [id]),
    query(`SELECT * FROM mrb_cc WHERE mrb_id=$1 ORDER BY id`, [id]),
  ]);
  return { ...review, reviewers: reviewers.rows, dispositions: dispositions.rows, labels: labels.rows, cc: cc.rows };
}

export function createMrbRouter({ authenticateJWT }) {
  const router = Router();
  router.use(authenticateJWT);

  // ── Reviewer candidates ──────────────────────────────────────────────────
  router.get("/reviewer-candidates", requireRoles(...WRITE_ROLES), async (_req, res) => {
    try {
      const { rows } = await query(
        `SELECT u.id, u.username, u.display_name AS "displayName"
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
          WHERE ur.role_key IN ('sqe','iqc_manager','quality_manager','admin')
          ORDER BY u.username LIMIT 200`
      );
      res.json(successEnvelope({ items: rows }));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_REVIEWERS_FAILED", e.message)); }
  });

  // ── List ─────────────────────────────────────────────────────────────────
  router.get("/list", async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 200);
      const offset = (page - 1) * pageSize;
      const p = [];
      const where = [];
      if (req.query.mrbNo) { where.push(`mrb_no ILIKE $${p.push(`%${req.query.mrbNo}%`)}`); }
      if (req.query.materialCode) { where.push(`material_code ILIKE $${p.push(`%${req.query.materialCode}%`)}`); }
      if (req.query.batchNo) { where.push(`batch_no ILIKE $${p.push(`%${req.query.batchNo}%`)}`); }
      if (req.query.status) { where.push(`status = $${p.push(req.query.status)}`); }
      if (req.query.startDate) { where.push(`created_at >= $${p.push(req.query.startDate)}`); }
      if (req.query.endDate) { where.push(`created_at <= $${p.push(req.query.endDate)}`); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [rows, total] = await Promise.all([
        query(`SELECT * FROM mrb_review ${clause} ORDER BY created_at DESC LIMIT $${p.push(pageSize)} OFFSET $${p.push(offset)}`, p),
        query(`SELECT count(*)::int AS n FROM mrb_review ${clause}`, p.slice(0, where.length)),
      ]);
      res.json(listEnvelope(rows.rows, total.rows[0]?.n || 0));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_LIST_FAILED", e.message)); }
  });

  // ── Overdue / SLA summary ────────────────────────────────────────────────
  router.get("/overdue-summary", async (_req, res) => {
    try {
      const { rows } = await query(
        `SELECT
           count(*) FILTER (WHERE status IN ('pending_review','reviewing','pending_approval','pending_final')
             AND status_since < now() - interval '24 hours')::int AS overdue,
           count(*) FILTER (WHERE status IN ('pending_review','reviewing','pending_approval','pending_final'))::int AS warn,
           count(*) FILTER (WHERE is_urgent)::int AS urgent
         FROM mrb_review`
      );
      res.json(successEnvelope(rows[0]));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_SUMMARY_FAILED", e.message)); }
  });

  // ── Pending IQC lots eligible for MRB ────────────────────────────────────
  router.get("/pending-lots", async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 200);
      const { rows } = await query(
        // iqc_inspections 没有 decision 列：结果在 result（pass/fail/hold/reject/conditional），
        // 参考实现里「待发起 MRB 的批次」= 检验不合格且还没有 MRB 的批次。
        `SELECT i.id, i.inspection_no AS "inspectionNo", i.material_code AS "materialCode",
                i.material_name AS "materialName", i.lot_no AS "lotNo",
                i.rejected_qty AS "rejectedQty", i.result, i.created_at AS "createdAt"
           FROM iqc_inspections i
          WHERE i.result IN ('fail','reject')
            AND NOT EXISTS (SELECT 1 FROM mrb_review m WHERE m.source_inspection_no = i.inspection_no)
          ORDER BY i.created_at DESC LIMIT $1 OFFSET $2`,
        [pageSize, (page - 1) * pageSize]
      );
      res.json(listEnvelope(rows, rows.length));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_PENDING_LOTS_FAILED", e.message)); }
  });

  // ── My review tasks ──────────────────────────────────────────────────────
  router.get("/my-tasks", async (req, res) => {
    try {
      const userId = operatorOf(req).id;
      const { rows } = await query(
        `SELECT m.* FROM mrb_review m
          WHERE m.status IN ('reviewing','pending_approval','pending_final')
            AND EXISTS (SELECT 1 FROM mrb_reviewer r WHERE r.mrb_id=m.id AND r.reviewer_id=$1)
          ORDER BY m.is_urgent DESC, m.created_at DESC LIMIT 200`,
        [userId]
      );
      res.json(listEnvelope(rows, rows.length));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_MY_TASKS_FAILED", e.message)); }
  });

  // ── Initiate ─────────────────────────────────────────────────────────────
  router.post("/initiate", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { sourceInspectionNo, lotId, materialCode, materialName, supplierCode, supplierName,
              batchNo, quantity, unit, failReason, reviewers, submit, isUrgent, urgentReason, remark } = req.body || {};
      if (!materialCode || !quantity || Number(quantity) <= 0) {
        return res.status(400).json(errorEnvelope("VALIDATION", "materialCode and positive quantity are required"));
      }
      const mrbNo = await nextMrbNo();
      const status = submit ? "pending_review" : "draft";
      const { rows } = await query(
        `INSERT INTO mrb_review
           (mrb_no,source_inspection_no,lot_id,material_code,material_name,supplier_code,supplier_name,
            batch_no,quantity,unit,fail_reason,status,is_urgent,urgent_reason,remark,
            created_by,created_at,updated_at,status_since)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now(),now())
         RETURNING id`,
        [mrbNo, sourceInspectionNo || null, lotId || null, materialCode, materialName || null,
         supplierCode || null, supplierName || null, batchNo || null, Number(quantity), unit || "PCS",
         failReason || null, status, Boolean(isUrgent), urgentReason || null, remark || null, op.id]
      );
      const id = rows[0].id;
      if (Array.isArray(reviewers)) {
        for (let i = 0; i < reviewers.length; i++) {
          const rid = typeof reviewers[i] === "object" ? reviewers[i].id : reviewers[i];
          if (!rid) continue;
          await query(
            `INSERT INTO mrb_reviewer (mrb_id,reviewer_id,sort_order,created_at,updated_at) VALUES ($1,$2,$3,now(),now())`,
            [id, rid, i]
          );
        }
      }
      res.json(successEnvelope(await getDetail(id)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_INITIATE_FAILED", e.message)); }
  });

  // ── Save / submit disposition plan ───────────────────────────────────────
  router.post("/plan", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, reviewers, dispositions, failReason, submit } = req.body || {};
      if (!mrbId) return res.status(400).json(errorEnvelope("VALIDATION", "mrbId is required"));
      const review = (await query(`SELECT id,status FROM mrb_review WHERE id=$1`, [mrbId])).rows[0];
      if (!review) return res.status(404).json(errorEnvelope("MRB_NOT_FOUND", "MRB not found"));

      if (Array.isArray(dispositions)) {
        await query(`DELETE FROM mrb_disposition WHERE mrb_id=$1`, [mrbId]);
        for (let i = 0; i < dispositions.length; i++) {
          const d = dispositions[i];
          await query(
            `INSERT INTO mrb_disposition
              (mrb_id,disposition_type,other_type,ref_no,quantity,unit,from_location_id,to_location_id,
               exec_status,remark,sort_order,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,now(),now())`,
            [mrbId, d.dispositionType || d.disposition_type, d.otherType || d.otherType || null,
             d.refNo || null, Number(d.quantity) || 0, d.unit || "PCS", d.fromLocationId || null,
             d.toLocationId || null, d.remark || null, i]
          );
        }
      }
      if (Array.isArray(reviewers)) {
        await query(`DELETE FROM mrb_reviewer WHERE mrb_id=$1 AND review_time IS NULL`, [mrbId]);
        for (let i = 0; i < reviewers.length; i++) {
          const rid = typeof reviewers[i] === "object" ? reviewers[i].id : reviewers[i];
          if (!rid) continue;
          await query(
            `INSERT INTO mrb_reviewer (mrb_id,reviewer_id,sort_order,created_at,updated_at) VALUES ($1,$2,$3,now(),now())`,
            [mrbId, rid, i]
          );
        }
      }
      const nextStatus = submit ? "reviewing" : "pending_review";
      await query(
        `UPDATE mrb_review SET status=$2,fail_reason=COALESCE($3,fail_reason),plan_by=$4,plan_time=now(),
           status_since=now(),updated_at=now() WHERE id=$1`,
        [mrbId, nextStatus, failReason || null, op.id]
      );
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_PLAN_FAILED", e.message)); }
  });

  // ── Assign reviewers ─────────────────────────────────────────────────────
  router.post("/assign-reviewers", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const { mrbId, reviewers } = req.body || {};
      if (!mrbId) return res.status(400).json(errorEnvelope("VALIDATION", "mrbId is required"));
      await query(`DELETE FROM mrb_reviewer WHERE mrb_id=$1 AND review_time IS NULL`, [mrbId]);
      for (let i = 0; i < (reviewers || []).length; i++) {
        const rid = typeof reviewers[i] === "object" ? reviewers[i].id : reviewers[i];
        if (rid) await query(
          `INSERT INTO mrb_reviewer (mrb_id,reviewer_id,sort_order,created_at,updated_at) VALUES ($1,$2,$3,now(),now())`,
          [mrbId, rid, i]
        );
      }
      await query(`UPDATE mrb_review SET status='reviewing',status_since=now(),updated_at=now() WHERE id=$1`, [mrbId]);
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_ASSIGN_FAILED", e.message)); }
  });

  // ── Submit draft ─────────────────────────────────────────────────────────
  router.post("/submit", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const { mrbId } = req.body || {};
      const row = (await query(`SELECT status FROM mrb_review WHERE id=$1`, [mrbId])).rows[0];
      if (!row) return res.status(404).json(errorEnvelope("MRB_NOT_FOUND", "MRB not found"));
      if (row.status !== "draft") return res.status(409).json(errorEnvelope("MRB_INVALID_STATE", "Only drafts can be submitted"));
      await query(`UPDATE mrb_review SET status='pending_review',status_since=now(),updated_at=now() WHERE id=$1`, [mrbId]);
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_SUBMIT_FAILED", e.message)); }
  });

  // ── Submit individual review ─────────────────────────────────────────────
  router.post("/submit-review", async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, reviewOpinion, reviewResult } = req.body || {};
      if (!mrbId || !reviewResult) return res.status(400).json(errorEnvelope("VALIDATION", "mrbId and reviewResult are required"));
      const result = (await query(
        `UPDATE mrb_reviewer
            SET review_opinion=$3,review_result=$4,review_time=now(),updated_at=now()
          WHERE mrb_id=$1 AND reviewer_id=$2 RETURNING id`,
        [mrbId, op.id, reviewOpinion || null, reviewResult]
      )).rows[0];
      if (!result) return res.status(404).json(errorEnvelope("MRB_REVIEWER_NOT_FOUND", "You are not a reviewer of this MRB"));
      const remaining = (await query(
        `SELECT count(*)::int AS n FROM mrb_reviewer WHERE mrb_id=$1 AND review_time IS NULL`, [mrbId]
      )).rows[0].n;
      if (remaining === 0) {
        await query(`UPDATE mrb_review SET status='pending_approval',status_since=now(),updated_at=now() WHERE id=$1`, [mrbId]);
      }
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_REVIEW_FAILED", e.message)); }
  });

  // ── Completeness pre-approval ────────────────────────────────────────────
  router.post("/pre-approve", requireRoles(...PRE_APPROVE_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, result, remark, separationRemark } = req.body || {};
      const next = result === "pass" ? "pending_final" : "pending_review";
      await query(
        `UPDATE mrb_review SET completeness_result=$2,completeness_by=$3,completeness_time=now(),
           completeness_remark=$4,separation_remark=COALESCE($5,separation_remark),
           status=$6,status_since=now(),updated_at=now() WHERE id=$1`,
        [mrbId, result, op.id, remark || null, separationRemark || null, next]
      );
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_PRE_APPROVE_FAILED", e.message)); }
  });

  // ── Final approval — creates downstream documents ────────────────────────
  router.post("/final-approve", requireRoles(...FINAL_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, finalResult, finalRemark, separationRemark, dispositions } = req.body || {};
      if (!mrbId || !finalResult) return res.status(400).json(errorEnvelope("VALIDATION", "mrbId and finalResult are required"));
      const review = (await query(`SELECT * FROM mrb_review WHERE id=$1`, [mrbId])).rows[0];
      if (!review) return res.status(404).json(errorEnvelope("MRB_NOT_FOUND", "MRB not found"));

      if (Array.isArray(dispositions) && dispositions.length) {
        await query(`DELETE FROM mrb_disposition WHERE mrb_id=$1`, [mrbId]);
        for (let i = 0; i < dispositions.length; i++) {
          const d = dispositions[i];
          const dtype = String(d.dispositionType || d.disposition_type || "").toLowerCase();
          const otype = String(d.otherType || d.other_type || "").toLowerCase() || null;
          // 报废与「其他-退回客户」是仓库动作，终审只冻结不核销（参考 mrb.service v3：
          // 终审后 pending_execute，仓管点「销毁 / 确认提走」才减账）。
          // 返工 / 退货 / 拒收已在下面生成下游单据，明细视为已交付下游。
          const needsExecution = dtype === "scrap" || (dtype === "other" && otype === "customer_return");
          await query(
            `INSERT INTO mrb_disposition
              (mrb_id,disposition_type,other_type,ref_no,quantity,unit,from_location_id,to_location_id,
               exec_status,remark,sort_order,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())`,
            [mrbId, dtype || null, otype, d.refNo || d.ref_no || null,
             Number(d.quantity) || 0, d.unit || "PCS", d.fromLocationId || null, d.toLocationId || null,
             needsExecution ? "pending" : "done", d.remark || null, i]
          );
        }
      }

      const lines = (await query(`SELECT * FROM mrb_disposition WHERE mrb_id=$1 ORDER BY sort_order,id`, [mrbId])).rows;
      const created = { rework: [], defectiveMove: [], supplierDebt: [] };
      for (const d of lines) {
        const type = String(d.disposition_type || "").toLowerCase();
        if (type === "rework") {
          const reworkNo = await nextDocNo("rework_orders", "rework_no", `RW${datePart()}`);
          const r = (await query(
            `INSERT INTO rework_orders
              (rework_no,mrb_no,mrb_id,disposition_id,material_id,material_lot_id,material_code,material_name,
               supplier_code,supplier_name,batch_no,quantity,unit,status,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',now(),now()) RETURNING id`,
            [reworkNo, review.mrb_no, mrbId, d.id, review.material_id || null, review.lot_id || null,
             review.material_code, review.material_name, review.supplier_code, review.supplier_name,
             review.batch_no, d.quantity, d.unit]
          )).rows[0];
          created.rework.push({ id: r.id, reworkNo });
        } else if (["return", "scrap", "reject"].includes(type)) {
          const moveNo = await nextDocNo("defective_move_tasks", "move_no", `DM${datePart()}`);
          const source = type === "return" ? "mrb_return" : type === "scrap" ? "mrb_scrap" : "mrb_reject";
          const r = (await query(
            `INSERT INTO defective_move_tasks
              (move_no,inventory_id,from_stock_status,material_code,material_name,quantity,unit,reason,
               status,created_by,created_by_name,created_at,updated_at)
             VALUES ($1,NULL,'good',$2,$3,$4,$5,$6,'pending',$7,$8,now(),now()) RETURNING id`,
            [moveNo, review.material_code, review.material_name, d.quantity, d.unit,
             `MRB ${review.mrb_no} ${type}`, op.id, op.name]
          )).rows[0];
          created.defectiveMove.push({ id: r.id, moveNo });

          if (type === "return") {
            const srNo = await nextDocNo("supplier_return_order", "return_no", `SR${datePart()}`);
            const sr = (await query(
              `INSERT INTO supplier_return_order
                (return_no,mrb_id,disposition_id,supplier_code,supplier_name,batch_no,status,total_qty,unit,created_by,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,'pending_out',$7,$8,$9,now(),now()) RETURNING id`,
              [srNo, mrbId, d.id, review.supplier_code, review.supplier_name, review.batch_no,
               d.quantity, d.unit, op.id]
            )).rows[0];
            await query(
              `INSERT INTO supplier_return_item
                (order_id,material_code,material_name,batch_no,quantity,unit,disposition_id,sort_order,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,0,now(),now())`,
              [sr.id, review.material_code, review.material_name, review.batch_no, d.quantity, d.unit, d.id]
            );
            created.supplierReturn = created.supplierReturn || [];
            created.supplierReturn.push({ id: sr.id, returnNo: srNo });
          }

          if (review.supplier_code && Number(d.quantity) > 0) {
            const debtNo = await nextDocNo("supplier_debt", "debt_no", `SD${datePart()}`);
            const debt = (await query(
              `INSERT INTO supplier_debt
                (debt_no,supplier_code,supplier_name,material_code,material_name,origin_qty,
                 settled_qty,source_type,source_id,source_no,status,mrb_id,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,0,'mrb_$7',$8,$9,'pending',$10,now(),now()) RETURNING id`,
              [debtNo, review.supplier_code, review.supplier_name, review.material_code,
               review.material_name, d.quantity, type, mrbId, review.mrb_no, mrbId]
            )).rows[0];
            created.supplierDebt.push({ id: debt.id, debtNo });
          }
        }
      }

      // 还有待执行的处置明细 → 单据进 pending_execute（全部执行完由 MRB 移植接口置 closed）
      const pendingLines = (await query(
        `SELECT count(*)::int AS n FROM mrb_disposition WHERE mrb_id=$1 AND exec_status='pending'`, [mrbId]
      )).rows[0]?.n || 0;
      await query(
        `UPDATE mrb_review SET final_decision=$2,final_remark=$3,separation_remark=COALESCE($4,separation_remark),
           quality_manager_id=$5,final_approval_time=now(),status=$6,status_since=now(),updated_at=now()
         WHERE id=$1`,
        [mrbId, finalResult, finalRemark || null, separationRemark || null, op.id,
         pendingLines > 0 ? "pending_execute" : "approved"]
      );
      res.json(successEnvelope({ ...(await getDetail(mrbId)), created }));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_FINAL_APPROVE_FAILED", e.message)); }
  });

  // ── Cancel / reject / withdraw / return-back ─────────────────────────────
  router.post("/cancel", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, reason } = req.body || {};
      await query(
        `UPDATE mrb_review SET status='cancelled',cancel_reason=$2,cancel_by=$3,cancel_time=now(),status_since=now(),updated_at=now() WHERE id=$1`,
        [mrbId, reason || "", op.id]
      );
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_CANCEL_FAILED", e.message)); }
  });

  router.post("/reject", requireRoles(...FINAL_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, reason, separationRemark } = req.body || {};
      await query(
        `UPDATE mrb_review SET status='rejected',return_reason=$2,return_by=$3,return_time=now(),
           return_from='pending_final',separation_remark=COALESCE($4,separation_remark),
           status_since=now(),updated_at=now() WHERE id=$1`,
        [mrbId, reason || "", op.id, separationRemark || null]
      );
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_REJECT_FAILED", e.message)); }
  });

  router.post("/withdraw", requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, reason } = req.body || {};
      await query(
        `UPDATE mrb_review SET status='pending_review',withdraw_reason=$2,withdraw_by=$3,withdraw_time=now(),status_since=now(),updated_at=now() WHERE id=$1`,
        [mrbId, reason || "", op.id]
      );
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_WITHDRAW_FAILED", e.message)); }
  });

  router.post("/return-back", requireRoles(...PRE_APPROVE_ROLES), async (req, res) => {
    try {
      const op = operatorOf(req);
      const { mrbId, reason } = req.body || {};
      await query(
        `UPDATE mrb_review SET status='pending_review',return_reason=$2,return_by=$3,return_time=now(),status_since=now(),updated_at=now() WHERE id=$1`,
        [mrbId, reason || "", op.id]
      );
      res.json(successEnvelope(await getDetail(mrbId)));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_RETURN_FAILED", e.message)); }
  });

  // ── Detail (last: avoids capturing /list etc.) ───────────────────────────
  router.get("/detail/:id", async (req, res) => {
    try {
      const detail = await getDetail(req.params.id);
      if (!detail) return res.status(404).json(errorEnvelope("MRB_NOT_FOUND", "MRB not found"));
      res.json(successEnvelope(detail));
    } catch (e) { res.status(500).json(errorEnvelope("MRB_DETAIL_FAILED", e.message)); }
  });

  return router;
}
