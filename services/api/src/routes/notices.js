// Notifications — grafted from reference WMS-20261019 sys_notice module.
// Table: sys_notices (migration 298). Mount: api.use("/notices", createNoticesRouter({ authenticateJWT }))
import { Router } from "express";
import { query } from "../db.js";
import { successEnvelope, errorEnvelope } from "../shared/helpers.js";

export function createNoticesRouter({ authenticateJWT }) {
  const router = Router();
  router.use(authenticateJWT);

  router.get("/list", async (req, res) => {
    try {
      const userId = req.user?.userId || "";
      const limit = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
      const { rows } = await query(
        `SELECT id,title,content,biz_type AS "bizType",biz_id AS "bizId",biz_no AS "bizNo",
                is_read AS "isRead",read_at AS "readAt",created_at AS "createdAt"
           FROM sys_notices WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit]
      );
      res.json(successEnvelope({ items: rows }));
    } catch (e) { res.status(500).json(errorEnvelope("NOTICE_LIST_FAILED", e.message)); }
  });

  router.get("/unread-count", async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT count(*)::int AS count FROM sys_notices WHERE user_id=$1 AND is_read=false`,
        [req.user?.userId || ""]
      );
      res.json(successEnvelope(rows[0]));
    } catch (e) { res.status(500).json(errorEnvelope("NOTICE_COUNT_FAILED", e.message)); }
  });

  router.post("/:id/read", async (req, res) => {
    try {
      await query(`UPDATE sys_notices SET is_read=true,read_at=now() WHERE id=$1 AND user_id=$2`,
        [req.params.id, req.user?.userId || ""]);
      res.json(successEnvelope({ success: true }));
    } catch (e) { res.status(500).json(errorEnvelope("NOTICE_READ_FAILED", e.message)); }
  });

  router.post("/read-all", async (req, res) => {
    try {
      await query(`UPDATE sys_notices SET is_read=true,read_at=now() WHERE user_id=$1 AND is_read=false`, [req.user?.userId || ""]);
      res.json(successEnvelope({ success: true }));
    } catch (e) { res.status(500).json(errorEnvelope("NOTICE_READ_ALL_FAILED", e.message)); }
  });

  return router;
}
