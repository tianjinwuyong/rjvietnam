/**
 * WMS 补齐接口：原 WMS 有三个菜单在新系统里只有表、没有出口
 *   /iqc/template + /iqc/standard-library → 检验模板库（rjvn_iqc_template/_item，309 镜像）
 *   /material/substitution                → 物料替代关系（rjvn_material_substitution）
 *   /inventory/expiry                    → 有效期管控（material_lots.expiry_date）
 *
 * 单独成模块，避免和 server.js 并行改动撞车；server.js 只加一行 register 调用。
 */
export function registerWmsParityRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, listEnvelope } = deps;
  // 前端 apiClient 走 `${API_BASE}/api/...`，而 server.js 里的 WMS 路由是直接挂在 app 上
  // （/wms/*）。两边都注册，和 /api/wms/pda-devices 的做法一致（server.js:3235）。
  const on = (path, ...handlers) => {
    app.get(path, ...handlers);
    app.get(`/api${path}`, ...handlers);
  };

  // ── IQC 检验模板库 ──
  on("/wms/iqc-templates", requirePermission("wms.view"), async (req, res) => {
    try {
      const { q = "" } = req.query;
      const args = [];
      // 镜像里有软删记录，现场只看没被删的
      let where = "WHERE COALESCE(t.status,'') <> 'deleted'";
      if (String(q).trim()) {
        args.push(`%${String(q).trim()}%`);
        where += ` AND (t.template_name ILIKE $1 OR t.template_code ILIKE $1)`;
      }
      const data = await query(
        `SELECT t.id, t.template_name AS "templateName", t.template_code AS "templateCode",
                t.version, t.status, t.description, t.packaging_aql AS "packagingAql",
                t.appearance_level AS "appearanceLevel", t.appearance_aql AS "appearanceAql",
                t.dimension_level AS "dimensionLevel", t.dimension_aql AS "dimensionAql",
                t.reliability_sample_size AS "reliabilitySampleSize",
                t.environmental_sample_size AS "environmentalSampleSize",
                t.row_count AS "rowCount", t.col_count AS "colCount",
                (SELECT COUNT(*)::int FROM rjvn_iqc_template_item i WHERE i.template_id = t.id) AS "itemCount"
           FROM rjvn_iqc_template t ${where}
          ORDER BY t.template_code, t.version DESC LIMIT 200`, args);
      res.json(listEnvelope(data.rows));
    } catch (err) {
      console.error("GET /wms/iqc-templates:", err.message);
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  on("/wms/iqc-templates/:id", requirePermission("wms.view"), async (req, res) => {
    try {
      // rjvn_iqc_template.id 是 uuid（309 镜像），不是自增 int
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json(errorEnvelope("BAD_REQUEST", "缺少模板 id"));
      const head = await query(
        `SELECT id, template_name AS "templateName", template_code AS "templateCode", version, status,
                description, packaging_aql AS "packagingAql", appearance_aql AS "appearanceAql",
                dimension_aql AS "dimensionAql", reliability_sample_size AS "reliabilitySampleSize",
                environmental_sample_size AS "environmentalSampleSize", selected_sections AS "selectedSections"
           FROM rjvn_iqc_template WHERE id=$1`, [id]);
      if (!head.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "模板不存在"));
      const items = await query(
        `SELECT id, section_type AS "sectionType", item_name AS "itemName", item_name_vi AS "itemNameVi",
                item_name_en AS "itemNameEn", standard, spec, lsl, usl, unit, aql,
                sampling_plan_text AS "samplingPlan", sample_size AS "sampleSize", ac, re,
                sort_order AS "sortOrder", is_required AS "isRequired"
           FROM rjvn_iqc_template_item WHERE template_id=$1 ORDER BY sort_order, id`, [id]);
      res.json({ data: { ...head.rows[0], items: items.rows }, meta: { itemCount: items.rows.length } });
    } catch (err) {
      console.error("GET /wms/iqc-templates/:id:", err.message);
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  // ── 物料替代关系 ──
  on("/wms/material-substitutions", requirePermission("wms.view"), async (req, res) => {
    try {
      const { q = "" } = req.query;
      const args = [];
      let where = "";
      if (String(q).trim()) {
        args.push(`%${String(q).trim()}%`);
        where = `WHERE s.material_code ILIKE $1 OR s.substitute_material_code ILIKE $1`;
      }
      const data = await query(
        `SELECT s.id, s.material_code AS "materialCode", s.substitute_material_code AS "substituteMaterialCode",
                s.substitution_type AS "substitutionType", s.status, s.remark,
                COALESCE(m1.name_zh, m1.name_en, s.material_code) AS "materialName",
                COALESCE(m2.name_zh, m2.name_en, s.substitute_material_code) AS "substituteMaterialName",
                m2.specification AS "substituteSpec", m2.uom AS "substituteUnit"
           FROM rjvn_material_substitution s
           LEFT JOIN materials m1 ON m1.code = s.material_code
           LEFT JOIN materials m2 ON m2.code = s.substitute_material_code
           ${where}
          ORDER BY s.material_code, s.substitute_material_code LIMIT 500`, args);
      res.json(listEnvelope(data.rows));
    } catch (err) {
      console.error("GET /wms/material-substitutions:", err.message);
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  // ── 有效期管控（按剩余天数分级）──
  on("/wms/inventory-expiry", requirePermission("wms.view"), async (req, res) => {
    try {
      const { q = "", bucket = "", days = "" } = req.query;
      const args = [];
      const preds = ["ml.expiry_date IS NOT NULL", "ml.lot_status NOT IN ('closed','voided')"];
      if (String(q).trim()) {
        args.push(`%${String(q).trim()}%`);
        preds.push(`(m.code ILIKE $${args.length} OR m.name_zh ILIKE $${args.length} OR ml.lot_no ILIKE $${args.length})`);
      }
      if (String(days).trim() && Number(days) > 0) {
        args.push(Number(days));
        preds.push(`ml.expiry_date <= (CURRENT_DATE + $${args.length}::int)`);
      }
      const data = await query(
        `SELECT ml.id, ml.lot_no AS "lotNo", m.code AS "materialCode",
                COALESCE(m.name_zh, m.name_en, m.code) AS "materialName",
                m.uom AS unit, ml.received_qty AS "receivedQty", ml.reserved_qty AS "reservedQty",
                ml.iqc_status AS "iqcStatus", ml.lot_status AS "lotStatus",
                ml.expiry_date AS "expiryDate", ml.manufacturing_date AS "manufacturingDate",
                (ml.expiry_date - CURRENT_DATE) AS "daysLeft",
                CASE WHEN ml.expiry_date < CURRENT_DATE THEN 'expired'
                     WHEN ml.expiry_date <= CURRENT_DATE + 7 THEN 'd7'
                     WHEN ml.expiry_date <= CURRENT_DATE + 30 THEN 'd30'
                     ELSE 'ok' END AS bucket
           FROM material_lots ml JOIN materials m ON m.id = ml.material_id
          WHERE ${preds.join(" AND ")}
          ORDER BY ml.expiry_date, m.code LIMIT 500`, args);
      const rows = String(bucket).trim() ? data.rows.filter(r => r.bucket === bucket) : data.rows;
      const counts = data.rows.reduce((acc, r) => { acc[r.bucket] = (acc[r.bucket] || 0) + 1; return acc; },
        { expired: 0, d7: 0, d30: 0, ok: 0 });
      res.json({ data: rows, meta: { total: rows.length, counts } });
    } catch (err) {
      console.error("GET /wms/inventory-expiry:", err.message);
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });
}
