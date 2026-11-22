/**
 * WMS 功能移植（graft）—— **只剩 IQC 批次这一块镜像债**。
 *
 * 目标是一个 WMS，不是两套。2026-11-21 起本文件被收窄成唯一还读 309 镜像表的地方：
 *
 *  · IQC 批次（iqc/pending、lot/:id、draft、judge、exempt、template）—— 仍在镜像
 *    （rjvn_iqc_lot / rjvn_iqc_inspection_record / rjvn_iqc_inspection_draft /
 *      rjvn_iqc_template_material）。卡住它的是语义而不是列名：canonical 侧
 *    没有「批次聚合 + 逐项检验记录 + 草稿」这个形状，而且模板↔物料绑定
 *    还是未决的产品决策（docs/WMS-ONE-PARITY.md §7 / slice 3b）。
 *  · 领料 4 条 —— 已在 slice 1/2 迁到 wms_picking_orders / wms_picking_order_items
 *    （迁移 327 补列），迁移对账数据见 docs/WMS-GRAFT-LOG 对应条目。
 *  · 盘点 10 / 库存汇总 2 / 调拨校验 2 / 有效期 2 —— 本来就写 SMT 自己的
 *    count_sessions / count_items / material_lots / storage_locations / materials，
 *    只是当年一次移植时混在这个文件里。2026-11-21 已整体搬到
 *    `routes/wms-ops.js`（registerWmsOpsRoutes），所以删掉本文件不会再连带删功能。
 *    搬走时注册顺序与路由字节完全保持不变，先用 route-census + 实调验证过。
 *
 * 类型约定：镜像主键是 uuid（用 uuid() 校验），时间戳列名是 _created_at/_updated_at
 * （canonical 的 bigint/id64 与 created_at/updated_at 约定见 wms-ops.js）。
 * 路径同时注册 /wms/... 与 /api/wms/...（前端 apiClient 走 /api 前缀）。
 */
import crypto from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerWmsGraftRoutes(app, deps) {
  const { query, requirePermission, authenticateJWT, errorEnvelope, listEnvelope } = deps;

  // authenticateJWT is MANDATORY here, not belt-and-braces. This module is
  // registered at server.js:8996, ABOVE both the app-level wrapper (~15684) and
  // the bare app.use(authenticateJWT) (~29476). A guarded route declared up there
  // never gets `req.user`, so requirePermission() answers UNAUTHORIZED.
  // Measured: all 24 bare `/wms/*` aliases returned 401 "Not authenticated" to an
  // admin token. The `/api/wms/*` twins did NOT — the `api` router's own gate
  // (server.js:164, the first registration on that router) authenticated them —
  // which is why the web UI (apiClient prefixes /api) never saw this. The aliases
  // are still part of the surface (nginx, PDA and upstream WMS clients call them),
  // so the fix belongs here rather than in a "nobody uses them" judgement.
  // `check:auth-order` cannot see this class: it scans literal `app.*` lines in
  // server.js, and these registrations live inside this function.
  // Authenticating in the helper (not by moving the mount) keeps registration
  // order byte-identical, so nothing starts shadowing anything else; the routes
  // stay permission-gated (verified: no token -> 401, token without wms.view -> 403).
  const on = (method, path, perm, handler) => {
    for (const p of [path, `/api${path}`]) app[method](p, authenticateJWT, requirePermission(perm), handler);
  };
  const bad = (res, msg) => res.status(400).json(errorEnvelope("BAD_REQUEST", msg));
  const num = (v, d = null) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const text = (v) => String(v ?? "").trim();
  const uuid = (v) => (UUID_RE.test(text(v)) ? text(v) : null);
  const orNull = (v) => text(v) || null;

  // ── IQC：待检清单（源 /api/iqc/pending）──
  on("get", "/wms/iqc/pending", "wms.view", async (req, res) => {
    try {
      const limit = Math.min(num(req.query.limit, 200) || 200, 500);
      const r = await query(
        `SELECT l.id, l.lot_no AS "lotNo", l.inspection_no AS "inspectionNo",
                l.material_id AS "materialId", m.material_code AS "materialCode",
                COALESCE(m.material_name, '') AS "materialName", m.unit,
                l.supplier_id AS "supplierId", l.total_qty AS "totalQty",
                l.batch_no AS "batchNo", l.box_count AS "boxCount",
                l.receipt_date AS "receiptDate", l.status, l.inspection_result AS "inspectionResult",
                l.template_id AS "templateId"
           FROM rjvn_iqc_lot l
           LEFT JOIN rjvn_material m ON m.id = l.material_id
          WHERE l.status = $1
          ORDER BY l.receipt_date NULLS LAST, l.lot_no LIMIT $2`,
        [text(req.query.status) || "pending", limit]);
      res.json(listEnvelope(r.rows, r.rows.length));
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── IQC：单批检验单（表头 + 逐项 + 草稿）──
  on("get", "/wms/iqc/lot/:id", "wms.view", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const lot = await query(
        `SELECT l.*, m.material_code AS "materialCode", COALESCE(m.material_name, '') AS "materialName"
           FROM rjvn_iqc_lot l LEFT JOIN rjvn_material m ON m.id = l.material_id WHERE l.id=$1`, [id]);
      if (!lot.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "检验批不存在"));
      const items = await query(
        `SELECT id, lot_id AS "lotId", item_id AS "itemId", item_name AS "itemName", standard, spec,
                spec_min AS "specMin", spec_max AS "specMax", unit, measured_value AS "measuredValue",
                defect_description AS "defectDescription", defect_qty AS "defectQty",
                is_pass AS "isPass", sort_order AS "sortOrder", section_type AS "sectionType",
                aql, sample_size AS "sampleSize", ac, re
           FROM rjvn_iqc_inspection_record WHERE lot_id=$1 ORDER BY sort_order, item_name`, [id]);
      const draft = await query(
        `SELECT payload FROM rjvn_iqc_inspection_draft WHERE lot_id=$1 ORDER BY _updated_at DESC LIMIT 1`, [id]);
      res.json({ data: { ...lot.rows[0], items: items.rows, draft: draft.rows[0]?.payload ?? null } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── IQC：检验录入草稿（源 /api/iqc/lot/:id/draft）──
  on("post", "/wms/iqc/lot/:id/draft", "wms.execute", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const p = req.body ?? {};
      if (!p.payload) return bad(res, "缺少 payload");
      await query("DELETE FROM rjvn_iqc_inspection_draft WHERE lot_id=$1", [id]);
      await query(
        "INSERT INTO rjvn_iqc_inspection_draft (lot_id, payload, inspector_id) VALUES ($1,$2,$3)",
        [id, typeof p.payload === "string" ? p.payload : JSON.stringify(p.payload), uuid(p.inspectorId)]);
      res.json({ data: { lotId: id, saved: true } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── IQC：判定（源 /api/iqc/lot/:id/judge）──
  on("post", "/wms/iqc/lot/:id/judge", "wms.execute", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const p = req.body ?? {};
      const result = text(p.result || p.inspectionResult).toLowerCase();
      if (!["pass", "fail", "exempt"].includes(result)) {
        return bad(res, "result 必须是 pass / fail / exempt");
      }
      const lot = await query("SELECT id, lot_no FROM rjvn_iqc_lot WHERE id=$1", [id]);
      if (!lot.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "检验批不存在"));
      const items = Array.isArray(p.items) ? p.items : [];
      for (const it of items) {
        const itemId = uuid(it.id ?? it.itemId);
        if (!itemId) continue;
        const verdict = text(it.verdict ?? it.result).toUpperCase();
        const isPass = it.isPass === false || verdict === "NG" ? false : true;
        await query(
          `UPDATE rjvn_iqc_inspection_record
              SET measured_value=COALESCE($1, measured_value), is_pass=$2,
                  defect_description=COALESCE($3, defect_description),
                  defect_qty=COALESCE($4, defect_qty), _updated_at=now()
            WHERE id=$5 AND lot_id=$6`,
          [orNull(it.measuredValue ?? it.measured_value), isPass,
           orNull(it.defectDescription ?? it.defect_description),
           num(it.defectQty ?? it.defect_qty), itemId, id]);
      }
      await query(
        `UPDATE rjvn_iqc_lot
            SET status=$1, inspection_result=$1, inspector_id=COALESCE($2, inspector_id),
                approver_id=COALESCE($3, approver_id), inspection_time=now(),
                defect_type=COALESCE($4, defect_type), remark=COALESCE($5, remark), _updated_at=now()
          WHERE id=$6`,
        [result, uuid(p.inspectorId), uuid(p.approverId), orNull(p.defectType), orNull(p.remark), id]);
      await query("DELETE FROM rjvn_iqc_inspection_draft WHERE lot_id=$1", [id]);
      res.json({ data: { lotId: id, lotNo: lot.rows[0].lot_no, result, itemsSaved: items.length } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── IQC：免检确认（源 /api/iqc/lot/:id/exempt-confirm）──
  on("post", "/wms/iqc/lot/:id/exempt-confirm", "wms.execute", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const r = await query(
        `UPDATE rjvn_iqc_lot SET status='exempt', inspection_result='exempt',
                remark=COALESCE($1, remark), inspection_time=now(), _updated_at=now()
          WHERE id=$2 RETURNING lot_no AS "lotNo"`,
        [orNull(req.body?.reason), id]);
      if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "检验批不存在"));
      res.json({ data: { lotId: id, ...r.rows[0], result: "exempt" } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── IQC：这批该用哪套模板（源 /api/iqc/lot/:id/template）──
  on("get", "/wms/iqc/lot/:id/template", "wms.view", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const lot = await query("SELECT material_id, template_id FROM rjvn_iqc_lot WHERE id=$1", [id]);
      if (!lot.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "检验批不存在"));
      const mid = lot.rows[0].material_id;
      const tpl = await query(
        `SELECT t.id, t.template_code AS "templateCode", t.template_name AS "templateName",
                t.version, t.packaging_aql AS "packagingAql", t.appearance_aql AS "appearanceAql",
                t.dimension_aql AS "dimensionAql"
           FROM rjvn_iqc_template_material rel
           JOIN rjvn_iqc_template t ON t.id = rel.template_id
          WHERE rel.material_id=$1 AND COALESCE(t.is_active, true)
          ORDER BY t.version DESC NULLS LAST LIMIT 5`, [mid]);
      let items = [];
      if (tpl.rows.length) {
        items = (await query(
          `SELECT id, section_type AS "sectionType", item_name AS "itemName", standard, spec,
                  lsl, usl, unit, aql, sample_size AS "sampleSize", ac, re, sort_order AS "sortOrder"
             FROM rjvn_iqc_template_item WHERE template_id=$1 ORDER BY sort_order, item_name`,
          [tpl.rows[0].id])).rows;
      }
      res.json({ data: { materialId: mid, lotTemplateId: lot.rows[0].template_id, templates: tpl.rows, items } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── IQC 判定分歧：报告 + 隔离（不翻转任何判定）─────────────────────────────
  // 背景（docs/WMS_GRAFT_LOG.md 2026-11-21 slice 3b）：canonical
  // material_lots.iqc_status 与镜像 rjvn_iqc_lot.status 曾在 16 个批次上互相
  // 矛盾（15 批 mirror=rejected 但 canonical=released，1 批反向）。两边都是
  // 「这批料能不能用」的判断，合并工程师无权替检验现场拍板翻转。本surface只做
  // 两件事：① 把分歧摆出来（report）；② 提供保守的隔离动作（quarantine→hold），
  // hold 在发料口径里本就不可领（391 视图 / server.js 发料门禁按 released 判定），
  // 所以隔离是「拦下待人工复核」，不是改判 released/rejected。释放/拒收仍走既有
  // IQC_RELEASE / IQC_REJECT 事务（server.js），由质量人署名决定。
  const DIVERGENCE_SQL = `
    SELECT ml.id AS "lotId", ml.lot_no AS "lotNo", ml.iqc_status AS "canonicalStatus",
           il.status AS "mirrorStatus", il.inspection_no AS "inspectionNo",
           m.code AS "materialCode", COALESCE(m.name_zh, m.code) AS "materialName",
           ml.received_qty AS "receivedQty", ml.reserved_qty AS "reservedQty",
           ml.locked, ml.lifecycle_status AS "lifecycleStatus",
           CASE WHEN ml.iqc_status='released' AND il.status IN ('rejected','review_pending')
                THEN 'CANONICAL_RELEASED_MIRROR_BLOCKED'
                WHEN ml.iqc_status='rejected' AND il.status IN ('pending','pass','review_pending')
                THEN 'CANONICAL_BLOCKED_MIRROR_OPEN'
                ELSE 'OTHER' END AS "divergenceType"
      FROM material_lots ml
      JOIN rjvn_iqc_lot il ON il.lot_no = ml.lot_no
      LEFT JOIN materials m ON m.id = ml.material_id
     WHERE ml.iqc_status <> CASE il.status
             WHEN 'pass' THEN 'released'
             WHEN 'rejected' THEN 'rejected'
             WHEN 'pending' THEN 'pending'
             WHEN 'review_pending' THEN 'pending'
             ELSE il.status END`;

  on("get", "/wms/iqc/divergence", "wms.view", async (req, res) => {
    try {
      const r = await query(`${DIVERGENCE_SQL} ORDER BY "divergenceType", ml.lot_no`);
      const byType = {};
      for (const row of r.rows) byType[row.divergenceType] = (byType[row.divergenceType] || 0) + 1;
      res.json({ data: {
        total: r.rows.length,
        byType,
        note: "canonical=material_lots.iqc_status, mirror=rjvn_iqc_lot.status。"
          + "分歧不自动翻转；quarantine 置 hold（不可领），释放/拒收走 IQC_RELEASE/IQC_REJECT 由质量人决定。",
        items: r.rows,
      } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // 隔离单批：released→hold（保守拦截）。已是 hold/pending/rejected 的不动判定，
  // 只记录。镜像状态原样保留作为分歧证据。写 wms_audit_events 留痕。
  on("post", "/wms/iqc/divergence/:lotId/quarantine", "wms.execute", async (req, res) => {
    try {
      const lotId = num(req.params.lotId);
      if (!lotId) return bad(res, "lotId 不是数字");
      const reason = text(req.body?.reason) || "IQC divergence quarantine (mirror blocks, canonical released)";
      const cur = (await query(
        `SELECT ml.id, ml.lot_no, ml.iqc_status, il.status AS mirror_status
           FROM material_lots ml LEFT JOIN rjvn_iqc_lot il ON il.lot_no=ml.lot_no
          WHERE ml.id=$1`, [lotId])).rows[0];
      if (!cur) return res.status(404).json(errorEnvelope("NOT_FOUND", "批次不存在"));
      const before = { iqcStatus: cur.iqc_status, mirrorStatus: cur.mirror_status };
      // 只把 released 拦成 hold；其余状态保持（不翻转 rejected/pending 的判定）。
      const newStatus = cur.iqc_status === "released" ? "hold" : cur.iqc_status;
      if (newStatus !== cur.iqc_status) {
        await query("UPDATE material_lots SET iqc_status='hold' WHERE id=$1", [lotId]);
      }
      await query(
        `INSERT INTO wms_audit_events
          (event_id,actor_id,actor_name,action,entity_type,entity_key,before_data,after_data,source_node,ip_address)
         VALUES($1,$2,$3,'IQC_DIVERGENCE_QUARANTINE','material_lot',$4,$5,$6,'MES-WMS-API',$7)`,
        [crypto.randomUUID(), req.user?.userId ?? null, req.user?.username ?? null,
         String(cur.lot_no), JSON.stringify(before),
         JSON.stringify({ iqcStatus: newStatus, mirrorStatus: cur.mirror_status, reason }),
         req.ip || null]);
      res.json({ data: {
        lotId, lotNo: cur.lot_no, beforeStatus: cur.iqc_status, afterStatus: newStatus,
        mirrorStatus: cur.mirror_status, quarantined: newStatus !== cur.iqc_status, reason,
      } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });
}
