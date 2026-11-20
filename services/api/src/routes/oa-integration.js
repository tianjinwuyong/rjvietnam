// ============================================================================
// OA integration — grafted from reference WMS-20261019
// Reference: server/modules/oa-integration/oa-integration.controller.ts
// Mount: api.use("/integration/oa", createOaIntegrationRouter({ authenticateJWT }))
// ============================================================================
import { createHmac } from "node:crypto";
import { Router } from "express";
import { query } from "../db.js";
import { successEnvelope, errorEnvelope } from "../shared/helpers.js";

const OA_SECRET = process.env.OA_CALLBACK_SECRET || "factory-oa-secret";

export function createOaIntegrationRouter({ authenticateJWT }) {
  const router = Router();

  const submit = (bizType) => async (req, res) => {
    try {
      const bizNo = req.params.bizNo;
      const instanceId = `OA-${bizType}-${Date.now()}`;
      const { rows } = await query(
        `INSERT INTO oa_integration_outbox (biz_type,biz_no,payload,oa_instance_id,oa_status,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'running',$5,now(),now()) RETURNING id`,
        [bizType, bizNo, JSON.stringify({ ...req.body, ...req.params }), instanceId, req.user?.userId || null]
      );
      // Reference: over-picking order carries oa_instance_id / oa_status.
      if (bizType === "over_picking") {
        await query(`UPDATE over_picking_orders SET oa_instance_id=$2,oa_status='running',updated_at=now() WHERE order_no=$1`, [bizNo, instanceId]);
      }
      res.json(successEnvelope({ id: rows[0].id, bizType, bizNo, oaInstanceId: instanceId, oaStatus: "running" }));
    } catch (e) { res.status(500).json(errorEnvelope("OA_SUBMIT_FAILED", e.message)); }
  };

  router.post("/submit-over-supplement/:bizNo", authenticateJWT, submit("over_picking"));
  router.post("/submit-mrb/:bizNo", authenticateJWT, submit("mrb"));
  router.post("/submit-picking/:bizNo", authenticateJWT, submit("picking"));
  router.post("/submit-iqc/:bizNo", authenticateJWT, submit("iqc"));
  router.post("/submit-stock-take/:bizNo", authenticateJWT, submit("stock_take"));
  router.post("/submit-over-consume/:bizNo", authenticateJWT, submit("over_consume"));
  router.post("/submit-receive/:bizNo", authenticateJWT, submit("receive"));
  router.post("/submit-confirm/:bizNo", authenticateJWT, submit("confirm"));

  // Public callback with HMAC signature (reference @Public()).
  router.post("/callback", async (req, res) => {
    try {
      const signature = String(req.headers["x-oa-signature"] || "");
      const expected = createHmac("sha256", OA_SECRET).update(JSON.stringify(req.body)).digest("hex");
      if (signature !== expected) return res.status(401).json(errorEnvelope("OA_SIGNATURE_INVALID", "Invalid OA signature"));
      const { bizType, bizNo, status, instanceId, payload } = req.body || {};
      await query(
        `UPDATE oa_integration_outbox SET oa_status=$2,oa_instance_id=COALESCE($3,oa_instance_id),callback_payload=$4,updated_at=now()
          WHERE biz_type=$5 AND biz_no=$6`,
        [status || "approved", instanceId || null, JSON.stringify(payload || {}), bizType, bizNo]
      );
      if (bizType === "over_picking") {
        await query(`UPDATE over_picking_orders SET oa_status=$2,updated_at=now() WHERE order_no=$1`, [bizNo, status || "approved"]);
        if (status === "rejected") {
          await query(`UPDATE over_picking_orders SET status='rejected',updated_at=now() WHERE order_no=$1`, [bizNo]);
        }
      }
      res.json(successEnvelope({ success: true }));
    } catch (e) { res.status(500).json(errorEnvelope("OA_CALLBACK_FAILED", e.message)); }
  });

  return router;
}
