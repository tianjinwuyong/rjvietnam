// ============================================================================
// OA integration — grafted from reference WMS-20261019
// Reference: server/modules/oa-integration/oa-integration.controller.ts
// Mount: api.use("/integration/oa", createOaIntegrationRouter({ authenticateJWT }))
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { query, getClient } from "../db.js";
import { successEnvelope, errorEnvelope } from "../shared/helpers.js";
import { ensureIntegrationLoaded, getSystemConfig } from "../oa/services/integration-config.js";

// 回调密钥：失败关闭（参考 oa-integration.service.ts handleCallback —— 没配
// secret 就 401，绝不回退到写死的默认值）。密钥来源与出站发送方同源：
// wms-webhook.js 用 sys_integration_system.webhook_secret_enc（按 bizSystem）
// 或 sys_integration.wms_webhook_secret_enc / WMS_WEBHOOK_SECRET 签名，这里
// 用同一份配置验签，管理员在集成配置页改密钥即双向生效。
async function callbackSecret(bizSystem) {
  await ensureIntegrationLoaded();
  const sys = bizSystem ? await getSystemConfig(String(bizSystem).toUpperCase()).catch(() => null) : null;
  return sys?.webhookSecret || process.env.WMS_WEBHOOK_SECRET || process.env.OA_CALLBACK_SECRET || "";
}

function signatureValid(signature, bodyBuf, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(bodyBuf).digest("hex");
  const a = Buffer.from(String(signature), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  // express.json 的 verify 钩子留存原始字节（server.js）：发送方对「发出的
  // 字节」签名（wms-webhook.js sign(JSON.stringify(payload))），对重新序列化
  // 的 req.body 验签会在键序/空白差异下误拒。
  router.post("/callback", async (req, res) => {
    try {
      const raw = req.body || {};
      const secret = await callbackSecret(raw.bizSystem);
      if (!secret) return res.status(401).json(errorEnvelope("OA_SECRET_UNCONFIGURED", "回调密钥未配置（集成配置 → Webhook 密钥）"));
      const bodyBuf = req.rawBody || Buffer.from(JSON.stringify(raw), "utf8");
      if (!signatureValid(req.headers["x-oa-signature"], bodyBuf, secret)) {
        return res.status(401).json(errorEnvelope("OA_SIGNATURE_INVALID", "Invalid OA signature"));
      }
      // 发送方契约（wms-webhook.js enqueueWmsEvent）：instanceId 数字 + bizKey；
      // 旧本地提交契约：instanceId 字符串 OA-<biz>-<ts> + bizNo。两者都认。
      const instanceId = raw.instanceId != null ? String(raw.instanceId) : null;
      const bizNo = raw.bizKey ?? raw.bizNo;
      const bizType = raw.bizType;
      const event = raw.event || (raw.status === "rejected" ? "rejected" : "completed");
      const nodeIndex = raw.nodeIndex ?? null;
      if (!bizType || !bizNo) return res.status(400).json(errorEnvelope("OA_CALLBACK_FIELDS", "回调缺少必要字段（bizType/bizKey）"));

      // 幂等 + 原子生效：同一 (instance,event,node) 只生效一次（392 的
      // oa_callback_log，UNIQUE NULLS NOT DISTINCT）。占位与状态变更在同一
      // 事务——若生效失败则回滚占位，重投仍可重试，不会把事件永久标成已处理。
      const status = raw.status || (event === "completed" ? "approved" : event === "rejected" ? "rejected" : "running");
      const client = await getClient();
      try {
        await client.query("BEGIN");
        const claim = await client.query(
          `INSERT INTO oa_callback_log (oa_instance_id, event, node_index, biz_type, biz_key, payload)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
          [instanceId || `legacy:${bizType}:${bizNo}`, event, nodeIndex, bizType, bizNo, JSON.stringify(raw)],
        );
        if (!claim.rows.length) {
          await client.query("COMMIT");
          return res.json(successEnvelope({ skipped: true }));
        }
        await client.query(
          `UPDATE oa_integration_outbox SET oa_status=$1,oa_instance_id=COALESCE($2,oa_instance_id),callback_payload=$3,updated_at=now()
            WHERE biz_type=$4 AND biz_no=$5`,
          [status, instanceId, JSON.stringify(raw), bizType, bizNo]
        );
        if (bizType === "over_picking") {
          await client.query(`UPDATE over_picking_orders SET oa_status=$2,updated_at=now() WHERE order_no=$1`, [bizNo, status]);
          if (status === "rejected") {
            await client.query(`UPDATE over_picking_orders SET status='rejected',updated_at=now() WHERE order_no=$1`, [bizNo]);
          }
        }
        await client.query("COMMIT");
        res.json(successEnvelope({ ok: true }));
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) { res.status(500).json(errorEnvelope("OA_CALLBACK_FAILED", e.message)); }
  });

  return router;
}
