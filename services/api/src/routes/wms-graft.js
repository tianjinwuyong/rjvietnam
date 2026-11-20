/**
 * WMS 功能移植（graft）：把运行中 WMS 的接口能力接进 SMT。
 *
 * 数据不新造：IQC/领料写在 309 镜像过来的原系统表上
 * （rjvn_iqc_lot / rjvn_iqc_inspection_record / rjvn_iqc_inspection_draft /
 *   rjvn_iqc_template_material / rjvn_picking_order / rjvn_picking_order_item），
 * 盘点/库存走 SMT 自己的 count_sessions / count_items / material_lots。
 *
 * 注意镜像表的主键是 uuid（count_* 是 serial），镜像表时间戳列名为 _updated_at。
 * 路径同时注册 /wms/... 与 /api/wms/...（前端 apiClient 走 /api 前缀）。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerWmsGraftRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, listEnvelope } = deps;

  const on = (method, path, perm, handler) => {
    for (const p of [path, `/api${path}`]) app[method](p, requirePermission(perm), handler);
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

  // ── 领料（源 /api/workorder/picking/*）：列表 / 审批 / 拣料 / 接收 ──
  // rjvn_picking_order.work_order_id 是 uuid，与 work_orders(bigint) 不同域，故不做 join。
  on("get", "/wms/picking-orders", "wms.view", async (req, res) => {
    try {
      const status = text(req.query.status);
      const args = [];
      let where = "";
      if (status) { args.push(status); where = `WHERE o.status=$1`; }
      const orders = await query(
        `SELECT o.id, o.picking_no AS "pickingNo", o.work_order_id AS "workOrderId",
                w.work_order_no AS "workOrderNo", w.product_code AS "productCode",
                o.req_id AS "reqId", o.work_section AS "workSection",
                o.is_supplement AS "isSupplement", o.total_qty AS "totalQty", o.status,
                o.applicant_id AS "applicantId", o.approver_id AS "approverId",
                o.approval_time AS "approvalTime", o.approval_remark AS "approvalRemark",
                o.picker_id AS "pickerId", o.pick_time AS "pickTime",
                o.received_by AS "receivedBy", o.received_time AS "receivedTime",
                o.receive_remark AS "receiveRemark", o.source, o.mes_issue_no AS "mesIssueNo",
                o.remark, o._created_at AS "createdAt"
           FROM rjvn_picking_order o
           LEFT JOIN rjvn_work_order w ON w.id = o.work_order_id
           ${where} ORDER BY o.picking_no DESC LIMIT 200`, args);
      const ids = orders.rows.map((x) => x.id);
      const items = ids.length
        ? (await query(
            `SELECT id, picking_id AS "pickingId", material_code AS "materialCode",
                    material_name AS "materialName", unit, pick_qty AS "pickQty",
                    actual_qty AS "actualQty", actual_material_code AS "actualMaterialCode",
                    received_qty AS "receivedQty", receive_remark AS "receiveRemark"
               FROM rjvn_picking_order_item WHERE picking_id = ANY($1::uuid[]) ORDER BY material_code`, [ids])).rows
        : [];
      const by = new Map();
      for (const it of items) {
        if (!by.has(it.pickingId)) by.set(it.pickingId, []);
        by.get(it.pickingId).push(it);
      }
      res.json(listEnvelope(orders.rows.map((o) => ({ ...o, items: by.get(o.id) || [] }))));
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // 审批：approved=false 即驳回（源 /api/workorder/picking/:id/approve）
  on("post", "/wms/picking-orders/:id/approve", "wms.execute", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const p = req.body ?? {};
      const approved = p.approved !== false;
      const status = approved ? "approved" : "rejected";
      const r = await query(
        `UPDATE rjvn_picking_order SET status=$1, approver_id=COALESCE($2, approver_id),
                approval_time=now(), approval_remark=COALESCE($3, approval_remark), _updated_at=now()
          WHERE id=$4 RETURNING picking_no AS "pickingNo"`,
        [status, uuid(p.approverId), orNull(p.remark), id]);
      if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "领料单不存在"));
      res.json({ data: { pickingId: id, ...r.rows[0], status } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // 拣料：写 actual_qty / actual_material_code，单头转 picking
  on("post", "/wms/picking-orders/:id/pick", "wms.execute", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const p = req.body ?? {};
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length) return bad(res, "缺少 items（[{id, actualQty, actualMaterialCode}]）");
      let touched = 0;
      for (const it of items) {
        const itemId = uuid(it.id ?? it.itemId);
        const qty = num(it.actualQty ?? it.actual_qty);
        if (!itemId || qty == null) continue;
        const r = await query(
          `UPDATE rjvn_picking_order_item
              SET actual_qty=$1, actual_material_code=COALESCE($2, actual_material_code), _updated_at=now()
            WHERE id=$3 AND picking_id=$4 RETURNING id`,
          [qty, orNull(it.actualMaterialCode ?? it.actual_material_code), itemId, id]);
        touched += r.rows.length;
      }
      const sum = (await query(
        `SELECT COALESCE(SUM(actual_qty),0) AS picked FROM rjvn_picking_order_item WHERE picking_id=$1`, [id])).rows[0];
      const head = await query(
        `UPDATE rjvn_picking_order SET status='picking', picker_id=COALESCE($1, picker_id),
                pick_time=now(), total_qty=$2, _updated_at=now() WHERE id=$3 RETURNING picking_no AS "pickingNo"`,
        [uuid(p.pickerId), sum.picked, id]);
      if (!head.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "领料单不存在"));
      res.json({ data: { pickingId: id, ...head.rows[0], pickedQty: sum.picked, itemsPicked: touched } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  on("post", "/wms/picking-orders/:id/receive", "wms.execute", async (req, res) => {
    try {
      const id = uuid(req.params.id);
      if (!id) return bad(res, "id 不是 uuid");
      const p = req.body ?? {};
      for (const it of Array.isArray(p.items) ? p.items : []) {
        const itemId = uuid(it.id ?? it.itemId);
        const qty = num(it.receivedQty ?? it.received_qty);
        if (!itemId || qty == null) continue;
        await query(
          `UPDATE rjvn_picking_order_item
              SET received_qty=$1, receive_remark=COALESCE($2, receive_remark), _updated_at=now()
            WHERE id=$3 AND picking_id=$4`,
          [qty, orNull(it.remark), itemId, id]);
      }
      const head = await query(
        `UPDATE rjvn_picking_order SET status='received', received_by=COALESCE($1, received_by),
                received_time=now(), receive_remark=COALESCE($2, receive_remark), _updated_at=now()
          WHERE id=$3 RETURNING picking_no AS "pickingNo"`,
        [uuid(p.receiverId ?? p.receivedBy), orNull(p.remark), id]);
      if (!head.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "领料单不存在"));
      res.json({ data: { pickingId: id, ...head.rows[0], status: "received" } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── 盘点：进行中盘点单清单（/wms/count-sessions 列表在 server.js 里挂 wms.read，权限更细）
  on("get", "/wms/count/open", "wms.view", async (req, res) => {
    try {
      const limit = Math.min(num(req.query.limit, 50) || 50, 200);
      const r = await query(
        `SELECT id, session_code AS "sessionCode", location_code AS "locationCode", status,
                system_qty AS "systemQty", counted_qty AS "countedQty", variance,
                threshold_pct AS "thresholdPct", claimed_at AS "claimedAt", created_at AS "createdAt"
           FROM count_sessions WHERE status='open' ORDER BY id DESC LIMIT $1`, [limit]);
      res.json(listEnvelope(r.rows, r.rows.length));
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── 盘点（源 /api/stock-take/*）：明细 / 调整 / 确认 / 审批 / 取消 / 解锁 / 报表 ──
  on("get", "/wms/count-sessions/:id/items", "wms.view", async (req, res) => {
    try {
      const id = num(req.params.id);
      if (id == null) return bad(res, "id 不是数字");
      const r = await query(
        `SELECT id, count_session_id AS "sessionId", lot_no AS "lotNo",
                material_code AS "materialCode", material_name_zh AS "materialName",
                system_qty AS "systemQty", counted_qty AS "countedQty", variance,
                counted, counted_at AS "countedAt", counted_by AS "countedBy",
                inventory_tx_no AS "inventoryTxNo"
           FROM count_items WHERE count_session_id=$1 ORDER BY material_code`, [id]);
      res.json(listEnvelope(r.rows, r.rows.length));
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  on("post", "/wms/count-sessions/:id/item/:itemId/adjust", "wms.execute", async (req, res) => {
    try {
      const id = num(req.params.id), itemId = num(req.params.itemId);
      if (id == null || itemId == null) return bad(res, "id / itemId 不是数字");
      const qty = num(req.body?.countedQty ?? req.body?.counted_qty);
      if (qty == null || qty < 0) return bad(res, "countedQty 必须是非负数");
      const it = await query(
        `UPDATE count_items SET counted_qty=$1, counted=true, counted_at=now(),
                counted_by=COALESCE($2, counted_by), variance=$1 - system_qty
          WHERE id=$3 AND count_session_id=$4
        RETURNING id, lot_no AS "lotNo", material_code AS "materialCode",
                  system_qty AS "systemQty", counted_qty AS "countedQty", variance`,
        [qty, num(req.body?.operator), itemId, id]);
      if (!it.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "盘点明细不存在"));
      await query(
        `UPDATE count_sessions
            SET counted_qty=(SELECT COALESCE(SUM(counted_qty),0) FROM count_items WHERE count_session_id=$1),
                variance=(SELECT COALESCE(SUM(variance),0) FROM count_items WHERE count_session_id=$1)
          WHERE id=$1`, [id]);
      res.json({ data: it.rows[0] });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  const setCountStatus = (status, extraSql = "") => async (req, res) => {
    try {
      const id = num(req.params.id);
      if (id == null) return bad(res, "id 不是数字");
      const r = await query(
        `UPDATE count_sessions SET status=$1 ${extraSql} WHERE id=$2
        RETURNING session_code AS "sessionCode", status, variance`, [status, id]);
      if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "盘点单不存在"));
      res.json({ data: r.rows[0] });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  };
  on("post", "/wms/count-sessions/:id/confirm-result", "wms.execute", setCountStatus("confirmed", ", completed_at=now()"));
  on("post", "/wms/count-sessions/:id/approve", "wms.execute", setCountStatus("approved", ", completed_at=COALESCE(completed_at, now())"));
  on("post", "/wms/count-sessions/:id/cancel", "wms.execute", setCountStatus("cancelled"));
  on("post", "/wms/count-sessions/:id/unlock", "wms.execute", setCountStatus("open", ", claimed_at=NULL"));

  on("get", "/wms/count-sessions/:id/report", "wms.view", async (req, res) => {
    try {
      const id = num(req.params.id);
      if (id == null) return bad(res, "id 不是数字");
      const s = (await query(
        `SELECT session_code AS "sessionCode", location_code AS "locationCode", status,
                system_qty AS "systemQty", counted_qty AS "countedQty", variance,
                threshold_pct AS "thresholdPct", claimed_at AS "claimedAt", completed_at AS "completedAt"
           FROM count_sessions WHERE id=$1`, [id])).rows[0];
      if (!s) return res.status(404).json(errorEnvelope("NOT_FOUND", "盘点单不存在"));
      const rows = (await query(
        `SELECT material_code AS "materialCode", material_name_zh AS "materialName",
                system_qty AS "systemQty", counted_qty AS "countedQty", variance,
                CASE WHEN system_qty = 0 THEN 0
                     ELSE ROUND(ABS(variance) * 100.0 / system_qty, 2) END AS "variancePct"
           FROM count_items WHERE count_session_id=$1 ORDER BY ABS(variance) DESC`, [id])).rows;
      res.json({ data: { ...s, items: rows,
        overThreshold: rows.filter((r) => Number(r.variancePct) > Number(s.thresholdPct || 0)).length } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── 库存汇总（源 /api/inventory/stock-summary + /export）──
  on("get", "/wms/inventory/stock-summary", "wms.view", async (req, res) => {
    try {
      const q = text(req.query.q);
      const args = [];
      let where = "";
      if (q) { args.push(`%${q}%`); where = "WHERE m.code ILIKE $1 OR COALESCE(m.name_zh, m.name_en) ILIKE $1"; }
      const r = await query(
        `SELECT m.code AS "materialCode", COALESCE(m.name_zh, m.name_en, '') AS "materialName",
                m.uom AS unit, m.material_type AS "materialType", COUNT(*)::int AS "lotCount",
                COALESCE(SUM(ml.received_qty),0) AS "totalQty",
                COALESCE(SUM(ml.reserved_qty),0) AS "reservedQty",
                COUNT(*) FILTER (WHERE ml.iqc_status NOT IN ('pass','exempt'))::int AS "notReleasedLots"
           FROM material_lots ml JOIN materials m ON m.id = ml.material_id
           ${where}
          GROUP BY m.code, m.name_zh, m.name_en, m.uom, m.material_type
          ORDER BY m.code LIMIT 500`, args);
      const totalQty = r.rows.reduce((a, b) => a + Number(b.totalQty || 0), 0);
      res.json({ data: r.rows, meta: { total: r.rows.length, totalQty } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  on("get", "/wms/inventory/stock-summary/export", "wms.view", async (req, res) => {
    try {
      const r = await query(
        `SELECT m.code, COALESCE(m.name_zh, m.name_en, '') AS name, m.uom,
                COUNT(*)::int AS lots, COALESCE(SUM(ml.received_qty),0) AS qty,
                COALESCE(SUM(ml.reserved_qty),0) AS reserved
           FROM material_lots ml JOIN materials m ON m.id = ml.material_id
          GROUP BY m.code, m.name_zh, m.name_en, m.uom ORDER BY m.code`);
      const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const csv = ["物料编码,物料名称,单位,批次数,库存数量,预留数量"]
        .concat(r.rows.map((x) => [esc(x.code), esc(x.name), esc(x.uom), x.lots, x.qty, x.reserved].join(",")))
        .join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="stock-summary.csv"');
      res.send("\uFEFF" + csv);
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── 调拨校验（源 /api/inventory/intra-transfer/verify-source|verify-target）──
  on("get", "/wms/inventory/intra-transfer/verify-source", "wms.view", async (req, res) => {
    try {
      const code = text(req.query.lotNo ?? req.query.lot_no);
      if (!code) return bad(res, "缺少 lotNo");
      const r = await query(
        `SELECT ml.id, ml.lot_no AS "lotNo", m.code AS "materialCode",
                COALESCE(m.name_zh, m.name_en, '') AS "materialName",
                ml.received_qty AS "availableQty", sl.code AS "locationCode",
                COALESCE(sl.name_zh, sl.name_en, '') AS "locationName",
                ml.expiry_date AS "expiryDate", ml.iqc_status AS "iqcStatus"
           FROM material_lots ml
           JOIN materials m ON m.id = ml.material_id
           LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
          WHERE ml.lot_no=$1 AND COALESCE(ml.lot_status,'') NOT IN ('closed','voided')`, [code]);
      if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "批次不存在"));
      res.json({ data: r.rows[0] });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  on("get", "/wms/inventory/intra-transfer/verify-target", "wms.view", async (req, res) => {
    try {
      const code = text(req.query.locationCode ?? req.query.location_code);
      if (!code) return bad(res, "缺少 locationCode");
      const r = await query(
        `SELECT id, code AS "locationCode", COALESCE(name_zh, name_en, '') AS "locationName",
                location_type AS "locationType", area, status, warehouse_id AS "warehouseId",
                capacity_qty AS "capacityQty", allow_transfer AS "allowTransfer"
           FROM storage_locations WHERE code=$1 AND status='active'`, [code]);
      if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "目标库位不存在"));
      res.json({ data: r.rows[0] });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  // ── 有效期延期（源 /api/inventory/expiry/extend-by-batch）：改批 + 记原系统延期流水 ──
  on("post", "/wms/inventory-expiry/extend-by-batch", "wms.execute", async (req, res) => {
    try {
      const p = req.body ?? {};
      const code = text(p.lotNo ?? p.lot_no);
      const newExpiry = text(p.newExpiry ?? p.new_expiry);
      if (!code) return bad(res, "缺少 lotNo");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newExpiry)) return bad(res, "newExpiry 需要 YYYY-MM-DD");
      const lot = await query(
        `SELECT ml.id, ml.lot_no, ml.expiry_date, ml.material_id, m.code AS material_code
           FROM material_lots ml JOIN materials m ON m.id = ml.material_id
          WHERE ml.lot_no=$1`, [code]);
      if (!lot.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "批次不存在"));
      const row = lot.rows[0];
      const upd = await query(
        `UPDATE material_lots SET expiry_date=$1, updated_at=now() WHERE id=$2
        RETURNING id, lot_no AS "lotNo", expiry_date AS "expiryDate"`, [newExpiry, row.id]);
      // 镜像表流水：只有该物料在原系统里也存在时才能记（material_id 是 uuid 域）
      const rmat = await query("SELECT id FROM rjvn_material WHERE material_code=$1 LIMIT 1", [row.material_code]);
      if (rmat.rows.length) {
        const days = row.expiry_date
          ? Math.round((Date.parse(newExpiry) - Date.parse(row.expiry_date)) / 86400000) : null;
        await query(
          `INSERT INTO rjvn_material_expiry_extension
             (material_id, batch_no, original_expiry_date, new_expiry_date, extended_days, operator_id, remark)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [rmat.rows[0].id, row.lot_no, row.expiry_date, newExpiry, days,
           uuid(p.operatorId), orNull(p.reason) || "SMT 有效期延期"]).catch(() => {});
      }
      res.json({ data: { ...upd.rows[0], materialCode: row.material_code,
        originalExpiry: row.expiry_date } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });

  on("get", "/wms/inventory-expiry/by-material", "wms.view", async (req, res) => {
    try {
      const r = await query(
        `SELECT m.code AS "materialCode", COALESCE(m.name_zh, m.name_en, '') AS "materialName",
                COUNT(*)::int AS "lotCount",
                COUNT(*) FILTER (WHERE ml.expiry_date < CURRENT_DATE)::int AS "expiredLots",
                COUNT(*) FILTER (WHERE ml.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS "d7Lots",
                COUNT(*) FILTER (WHERE ml.expiry_date BETWEEN CURRENT_DATE + 8 AND CURRENT_DATE + 30)::int AS "d30Lots",
                MIN(ml.expiry_date) AS "soonestExpiry"
           FROM material_lots ml JOIN materials m ON m.id = ml.material_id
          WHERE ml.expiry_date IS NOT NULL AND COALESCE(ml.lot_status,'') NOT IN ('closed','voided')
          GROUP BY m.code, m.name_zh, m.name_en ORDER BY "soonestExpiry" LIMIT 300`);
      res.json({ data: r.rows, meta: { total: r.rows.length } });
    } catch (err) { res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
  });
}
