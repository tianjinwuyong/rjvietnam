// Material lifecycle routes (/api/lifecycle/*), moved out of services/api/server.js.
//
// 17 registrations: lot lifecycle view, summary, alerts with actions, MSD openings and
// sealing, baking, reinspection, scrapping, exempt lots/materials and destruction
// records.
//
// The block held one module-level declaration -- `lifecycleOpeningCloseReady`, an
// eagerly created DDL promise. It is referenced only inside this block (4 uses, 0
// outside), so it moves with the routes; because registerLifecycleRoutes is invoked at
// the line the block used to occupy, the ALTER TABLE still starts at the same point in
// startup and the handlers that await it see the same ordering as before.
export function registerLifecycleRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, authenticateJWT } = deps;

  // The whole block moved verbatim, section comments included; it now ends the function.
// ── Material Lifecycle Endpoints ──────────────────────────────────────────
// (tables: material_lifecycle view + material_reinspection + material_scrapping + v_exempt_iqc_materials)

// GET /api/lifecycle/lots — all lots with lifecycle info
app.get("/api/lifecycle/lots", requirePermission("wms.read"), async (req, res) => {
  try {
    const { status, alertLevel, limit = 100, offset = 0 } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) { params.push(status); where += ` AND ml.lot_status = $${params.length}`; }
    if (alertLevel) { params.push(alertLevel); where += ` AND alert_level = $${params.length}`; }
    params.push(Number(limit), Number(offset));
    const r = await query(`
      SELECT ml.id, ml.lot_no, ml.received_qty, ml.reserved_qty,
             ml.iqc_status, ml.lot_status, ml.manufacturing_date,
             ml.received_at, ml.expiry_date,
             m.code AS material_code, m.name_zh, m.shelf_life_days,
             s.name_zh AS supplier_name, sl.code AS location_code,
             CASE
               WHEN ml.expiry_date < CURRENT_DATE THEN 'EXPIRED'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'RED_L3'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN 'BLUE_L2'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'YELLOW_L1'
               ELSE 'NORMAL'
             END AS alert_level,
             FLOOR(EXTRACT(EPOCH FROM (ml.expiry_date - CURRENT_DATE))/86400)::int AS remaining_days
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN suppliers s ON s.id = ml.supplier_id
      LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
      ${where}
      ORDER BY ml.expiry_date ASC NULLS LAST
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const cnt = await query(`SELECT count(*) AS total FROM material_lots ml JOIN materials m ON m.id = ml.material_id ${where}`, params.slice(0,-2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /api/lifecycle/lots:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/summary — lifecycle dashboard summary
app.get("/api/lifecycle/summary", requirePermission("wms.read"), async (req, res) => {
  try {
    const byAlert = await query(`
      SELECT
        CASE
          WHEN ml.expiry_date < CURRENT_DATE THEN 'EXPIRED'
          WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'RED_L3'
          WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN 'BLUE_L2'
          WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'YELLOW_L1'
          ELSE 'NORMAL'
        END AS alert_level,
        count(*) AS lot_count,
        sum(ml.received_qty) AS total_qty
      FROM material_lots ml
      WHERE ml.lot_status = 'open'
      GROUP BY alert_level
    `);
    const pendingReinspection = await query(`SELECT count(*) AS cnt FROM material_reinspection WHERE updated_at IS NULL OR updated_at < NOW() - INTERVAL '90 days'`);
    const pendingScrapping = await query(`SELECT count(*) AS cnt FROM material_scrapping WHERE status NOT IN ('closed','executed')`);
    res.json({
      byAlert: byAlert.rows,
      pendingReinspection: Number(pendingReinspection.rows[0]?.cnt ?? 0),
      pendingScrapping: Number(pendingScrapping.rows[0]?.cnt ?? 0),
    });
  } catch (err) {
    console.error("GET /api/lifecycle/summary:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/alerts-with-actions — lots needing lifecycle action
app.get("/api/lifecycle/alerts-with-actions", requirePermission("wms.read"), async (req, res) => {
  try {
    const { level, limit = 50 } = req.query;
    let where = "WHERE ml.lot_status = 'open' AND (ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days' OR ml.expiry_date IS NULL)";
    const params = [Number(limit)];
    if (level) { params.push(level); where += ` AND alert_level = $${params.length}`; }
    const r = await query(`
      SELECT ml.id, ml.lot_no, ml.received_qty, ml.expiry_date,
             m.code AS material_code, m.name_zh, m.shelf_life_days,
             sl.code AS location_code,
             CASE
               WHEN ml.expiry_date < CURRENT_DATE THEN 'EXPIRED'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'RED_L3'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN 'BLUE_L2'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'YELLOW_L1'
               ELSE 'NORMAL'
             END AS alert_level,
             FLOOR(EXTRACT(EPOCH FROM (ml.expiry_date - CURRENT_DATE))/86400)::int AS remaining_days,
             CASE
               WHEN ml.expiry_date < CURRENT_DATE THEN 'SCRAP'
               WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'REINSPECT'
               ELSE 'MONITOR'
             END AS recommended_action
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
      ${where}
      ORDER BY ml.expiry_date ASC NULLS LAST
      LIMIT $1
    `, params);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /api/lifecycle/alerts-with-actions:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /api/lifecycle/alert-status/:id — update lifecycle alert action
app.patch("/api/lifecycle/alert-status/:id", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json(errorEnvelope("VALIDATION", "status required"));
    // No dedicated alert-status table; update lot_status on material_lots
    const r = await query(
      `UPDATE material_lots SET lot_status = $1 WHERE id = $2 RETURNING id, lot_no, lot_status`,
      [status, id]
    );
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PATCH /api/lifecycle/alert-status/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

const lifecycleOpeningCloseReady = query(`ALTER TABLE material_lifecycle_openings
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by VARCHAR(120),
  ADD COLUMN IF NOT EXISTS work_order_codes TEXT[] NOT NULL DEFAULT '{}'`);

// GET /api/lifecycle/openings —开封后物料列表
app.get("/api/lifecycle/openings", requirePermission("wms.read"), async (req, res) => {
  try {
    await lifecycleOpeningCloseReady;
    const r = await query(`
      SELECT COALESCE(o.id, ml.id) AS id, ml.lot_no, ml.opened_at, o.closed_at, o.closed_by,
             ml.opened_shelf_life_days,
             ml.received_qty, GREATEST(ml.received_qty - COALESCE(ml.reserved_qty, 0), 0) AS remaining_qty, ml.received_at, m.code AS material_code, m.name_zh,
             sl.code AS location_code, o.id AS life_tracking_id, o.work_order_codes,
             (1 + (SELECT COUNT(*) FROM material_lots older WHERE older.material_id = ml.material_id AND older.received_at < ml.received_at AND older.lot_status = 'open' AND older.iqc_status = 'released' AND older.received_qty - COALESCE(older.reserved_qty, 0) > 0))::int AS fifo_rank,
             FLOOR(EXTRACT(EPOCH FROM (ml.opened_at + (ml.opened_shelf_life_days||' days')::interval - COALESCE(o.closed_at,NOW())))/86400)::int AS remaining_days_after_opened
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
      LEFT JOIN LATERAL (SELECT id,closed_at,closed_by,opened_qty,work_order_codes FROM material_lifecycle_openings WHERE material_lot_id=ml.id ORDER BY opened_at DESC LIMIT 1) o ON true
      WHERE ml.opened_at IS NOT NULL AND ml.lot_status = 'open'
      ORDER BY ml.received_at ASC NULLS LAST, ml.opened_at ASC
    `);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /api/lifecycle/openings:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /api/lifecycle/openings —开封一个批次
app.post("/api/lifecycle/openings", requirePermission("wms.execute"), async (req, res) => {
  try {
    await lifecycleOpeningCloseReady;
    const { lotNo, openedShelfLifeDays, openedQty, department, operator } = req.body;
    const workOrderCodes = Array.from(new Set((Array.isArray(req.body?.workOrderCodes) ? req.body.workOrderCodes : String(req.body?.workOrderCodes ?? req.body?.workOrderCode ?? "").split(/[,，\s]+/)).map((v) => String(v).trim()).filter(Boolean)));
    if (!lotNo) return res.status(400).json(errorEnvelope("VALIDATION", "lotNo required"));
    const fifoBlock = await query(`
      SELECT older.lot_no
      FROM material_lots current_lot
      JOIN material_lots older ON older.material_id = current_lot.material_id AND older.received_at < current_lot.received_at
      WHERE current_lot.lot_no = $1 AND older.lot_status = 'open' AND older.iqc_status = 'released'
        AND GREATEST(older.received_qty - COALESCE(older.reserved_qty, 0), 0) > 0
      ORDER BY older.received_at ASC LIMIT 1
    `, [lotNo]);
    if (fifoBlock.rows.length) return res.status(409).json(errorEnvelope("FIFO_BLOCKED", `请先使用更早批次 ${fifoBlock.rows[0].lot_no}，当前批次不能拆箱`));
    const r = await query(`
      UPDATE material_lots SET opened_at = NOW(), opened_shelf_life_days = $1
      WHERE lot_no = $2 RETURNING id, lot_no, opened_at, opened_shelf_life_days, received_qty
    `, [openedShelfLifeDays ?? 30, lotNo]);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    const opening = await query(`INSERT INTO material_lifecycle_openings(material_lot_id,opened_at,opened_shelf_life_days,opened_qty,department,operator,work_order_codes)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,opened_at,opened_shelf_life_days,opened_qty,operator,work_order_codes`, [r.rows[0].id, r.rows[0].opened_at, openedShelfLifeDays ?? 30, openedQty ?? r.rows[0].received_qty, department ?? "WMS", operator ?? req.user?.username ?? "WMS_OPERATOR", workOrderCodes]);
    res.status(201).json({ data: { ...r.rows[0], openingId: opening.rows[0].id, operator: opening.rows[0].operator, workOrderCodes: opening.rows[0].work_order_codes } });
  } catch (err) {
    console.error("POST /api/lifecycle/openings:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.post("/api/lifecycle/openings/:id/seal", requirePermission("wms.execute"), async (req, res) => {
  try {
    await lifecycleOpeningCloseReady;
    const operator = req.body?.operator ?? req.user?.username ?? "WMS_OPERATOR";
    const r = await query(`UPDATE material_lifecycle_openings SET closed_at=NOW(),closed_by=$2
      WHERE id=$1 AND closed_at IS NULL RETURNING id,material_lot_id,opened_at,closed_at,closed_by`, [req.params.id, operator]);
    if (!r.rows.length) return res.status(409).json(errorEnvelope("INVALID_STATE", "Opening record not found or already sealed"));
    res.status(201).json({ data: r.rows[0] });
  } catch (err) { res.status(500).json(errorEnvelope("SEAL_FAILED", err.message)); }
});


// ── MSD Baking Endpoints ───────────────────────────────────────────────

// GET /api/lifecycle/baking — 烘烤记录列表
app.get("/api/lifecycle/baking", requirePermission("wms.read"), async (req, res) => {
  try {
    const { lotNo, result, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;
    if (lotNo)     { conditions.push(`mbr.lot_no = $${i++}`); params.push(lotNo); }
    if (result)    { conditions.push(`mbr.result = $${i++}`); params.push(result); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    params.push(Number(limit), Number(offset));
    const r = await query(`
      SELECT mbr.id, mbr.lot_no, mbr.operator_name, mbr.started_at,
             mbr.completed_at, mbr.temperature, mbr.humidity,
             mbr.oven_no, mbr.result, mbr.notes,
             ml.id AS lot_id, ml.received_qty,
             m.code AS material_code, m.name_zh
      FROM material_baking_records mbr
      JOIN material_lots ml ON ml.id = mbr.material_lot_id
      JOIN materials m ON m.id = ml.material_id
      ${where}
      ORDER BY mbr.started_at DESC
      LIMIT $${i++} OFFSET $${i}
    `, params);
    const cnt = await query(`SELECT count(*)::int FROM material_baking_records mbr ${where}`, params.slice(0, -2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /api/lifecycle/baking:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /api/lifecycle/baking — 开始烘烤（触发）
app.post("/api/lifecycle/baking", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { lotNo, temperature, humidity, ovenNo, operatorName, notes } = req.body;
    if (!lotNo) return res.status(400).json(errorEnvelope("VALIDATION", "lotNo required"));
    const lotR = await query("SELECT id, lot_no FROM material_lots WHERE lot_no = $1", [lotNo]);
    if (!lotR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    const lotId = lotR.rows[0].id;
    const opR = operatorName
      ? await query("SELECT id FROM hr_employees WHERE name = $1 LIMIT 1", [operatorName])
      : { rows: [] };
    const opId = opR.rows[0]?.id ?? null;
    const r = await query(`
      INSERT INTO material_baking_records
        (material_lot_id, lot_no, operator_id, operator_name, temperature, humidity, oven_no, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, lot_no, operator_name, started_at, temperature, humidity, oven_no, notes
    `, [lotId, lotNo, opId, operatorName || null, temperature || null, humidity || null, ovenNo || null, notes || null]);
    await query(`
      UPDATE material_lots SET
        baking_required = true,
        baking_started_at = NOW(),
        baking_result = 'pending'
      WHERE id = $1
    `, [lotId]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /api/lifecycle/baking:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /api/lifecycle/baking/:id — 完成烘烤（填结果）
app.patch("/api/lifecycle/baking/:id", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { result, completedAt, notes } = req.body;
    if (!result) return res.status(400).json(errorEnvelope("VALIDATION", "result required (pass|fail)"));
    const recR = await query("SELECT material_lot_id FROM material_baking_records WHERE id = $1", [id]);
    if (!recR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Baking record not found"));
    const lotId = recR.rows[0].material_lot_id;
    const r = await query(`
      UPDATE material_baking_records
      SET result = $1, completed_at = $2, notes = COALESCE($3, notes)
      WHERE id = $4
      RETURNING id, lot_no, result, completed_at
    `, [result, completedAt || new Date().toISOString(), notes, id]);
    if (result === "pass") {
      await query(`
        UPDATE material_lots SET
          opened_at = NULL, opened_shelf_life_days = NULL,
          baking_required = false,
          baking_completed_at = NOW(),
          baking_result = 'pass'
        WHERE id = $1
      `, [lotId]);
    } else {
      await query(`
        UPDATE material_lots SET
          baking_result = $1,
          baking_completed_at = NOW()
        WHERE id = $2
      `, [result, lotId]);
    }
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PATCH /api/lifecycle/baking/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/baking/lot/:lotNo — 某批次的所有烘烤记录
app.get("/api/lifecycle/baking/lot/:lotNo", requirePermission("wms.read"), async (req, res) => {
  try {
    const { lotNo } = req.params;
    const r = await query(`
      SELECT mbr.id, mbr.lot_no, mbr.operator_name, mbr.started_at,
             mbr.completed_at, mbr.temperature, mbr.oven_no, mbr.result, mbr.notes
      FROM material_baking_records mbr
      JOIN material_lots ml ON ml.id = mbr.material_lot_id
      WHERE ml.lot_no = $1
      ORDER BY mbr.started_at DESC
    `, [lotNo]);
    res.json({ items: r.rows });
  } catch (err) {
    console.error("GET /api/lifecycle/baking/lot/:lotNo:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/reinspection —复检报告列表
app.get("/api/lifecycle/reinspection", requirePermission("wms.read"), async (req, res) => {
  try {
    const { pass, limit = 50, offset = 0 } = req.query;
    let where = "";
    const params = [Number(limit), Number(offset)];
    if (pass !== undefined) { params.unshift(pass); where = `WHERE pass = $1`; }
    const r = await query(`
      SELECT mr.id, mr.report_no, mr.inspected_at, mr.pass, mr.disposal_advice,
             mr.sample_qty, mr.test_results, mr.overdue_days,
             ml.lot_no, m.code AS material_code, m.name_zh,
             u1.name AS inspector_name, u2.name AS quality_approver
      FROM material_reinspection mr
      JOIN material_lots ml ON ml.id = mr.material_lot_id
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN hr_employees u1 ON u1.id = mr.inspector_id
      LEFT JOIN hr_employees u2 ON u2.id = mr.quality_approved_by
      ${where}
      ORDER BY mr.inspected_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const cnt = await query(`SELECT count(*) AS total FROM material_reinspection ${where}`, params.slice(0,-2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /api/lifecycle/reinspection:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /api/lifecycle/reinspection —创建复检报告
app.post("/api/lifecycle/reinspection", authenticateJWT, requirePermission("wms.execute"), async (req, res) => {
  try {
    const { lotNo, overdueDays, sampleQty, testItems, testStandards, testResults, pass, disposalAdvice, inspectorName } = req.body;
    if (!lotNo || !testItems || !testResults) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo, testItems, testResults required"));
    }
    const lotR = await query(`SELECT id FROM material_lots WHERE lot_no = $1`, [lotNo]);
    if (!lotR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    const inspectorR = inspectorName
      ? await query(`SELECT id FROM hr_employees WHERE name_zh = $1 OR employee_no = $1 LIMIT 1`, [inspectorName])
      : { rows: [] };
    const reportNo = `REP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}${String(Math.floor(Math.random()*999)).padStart(3,'0')}`;
    const r = await query(`
      INSERT INTO material_reinspection (report_no, material_lot_id, overdue_days, sample_qty, test_items, test_standards, test_results, pass, disposal_advice, inspector_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, report_no, pass, disposal_advice
    `, [reportNo, lotR.rows[0].id, overdueDays ?? 0, sampleQty ?? 0, testItems, testStandards ?? '', testResults, pass ?? false, disposalAdvice ?? '', inspectorR.rows[0]?.id ?? null]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /api/lifecycle/reinspection:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/scrapping —报废申请列表
app.get("/api/lifecycle/scrapping", requirePermission("wms.read"), async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const params = [Number(limit), Number(offset)];
    let where = "";
    if (status) { params.unshift(status); where = `WHERE ms.status = $1`; }
    const r = await query(`
      SELECT ms.id, ms.request_no, ms.department, ms.scrap_qty, ms.destroyed_qty,
             ms.overdue_days, ms.scrap_reason, ms.isolation_status, ms.disposal_method, ms.status,
             ms.destruction_at, ms.created_at,
             ml.lot_no, m.code AS material_code, m.name_zh,
             a.name AS applicant_name
      FROM material_scrapping ms
      JOIN material_lots ml ON ml.id = ms.material_lot_id
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN users a ON a.id = ms.applicant_id
      ${where}
      ORDER BY ms.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const cnt = await query(`SELECT count(*) AS total FROM material_scrapping ms ${where}`, params.slice(0,-2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /api/lifecycle/scrapping:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /api/lifecycle/scrapping —创建报废申请
app.post("/api/lifecycle/scrapping", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { lotNo, department, scrapQty, unit, overdueDays, scrapReason, disposalMethod, applicantName } = req.body;
    if (!lotNo || !scrapQty || !scrapReason || !disposalMethod) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo, scrapQty, scrapReason, disposalMethod required"));
    }
    const lotR = await query(`SELECT id FROM material_lots WHERE lot_no = $1`, [lotNo]);
    if (!lotR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    const userR = await query(`SELECT id FROM users WHERE name = $1 LIMIT 1`, [applicantName ?? "PMC"]);
    const requestNo = `REQ-${new Date().toISOString().slice(0,10).replace(/-/g,'')}${String(Math.floor(Math.random()*999)).padStart(3,'0')}`;
    const r = await query(`
      INSERT INTO material_scrapping (request_no, department, material_lot_id, scrap_qty, unit, overdue_days, scrap_reason, disposal_method, isolation_status, status, applicant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'pending', $9)
      RETURNING id, request_no, status
    `, [requestNo, department ?? "SMT", lotR.rows[0].id, scrapQty, unit ?? "PCS", overdueDays ?? 0, scrapReason, disposalMethod, userR.rows[0]?.id ?? null]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /api/lifecycle/scrapping:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /api/lifecycle/scrapping/:id —更新报废状态（含销毁执行）
app.patch("/api/lifecycle/scrapping/:id", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, destroyedQty, destructionSupervisorId, destructionDocUrl } = req.body;
    const sets = [], params = [];
    if (status) { params.push(status); sets.push(`status = $${params.length}`); }
    if (destroyedQty !== undefined) { params.push(destroyedQty); sets.push(`destroyed_qty = $${params.length}`); }
    if (destructionSupervisorId) { params.push(destructionSupervisorId); sets.push(`destruction_supervisor_id = $${params.length}`); }
    if (destructionDocUrl) { params.push(destructionDocUrl); sets.push(`destruction_doc_url = $${params.length}`); }
    if (status === 'executed') { sets.push(`destruction_at = NOW()`); }
    if (!sets.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    params.push(id);
    const r = await query(`UPDATE material_scrapping SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id, request_no, status, destroyed_qty, destruction_at`, params);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PATCH /api/lifecycle/scrapping/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/exempt-lots —免检批次
app.get("/api/lifecycle/exempt-lots", requirePermission("wms.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM v_material_lots_exempt ORDER BY expiry_date ASC LIMIT 200`);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /api/lifecycle/exempt-lots:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/exempt-materials —免检物料清单
app.get("/api/lifecycle/exempt-materials", requirePermission("wms.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM v_exempt_iqc_materials ORDER BY code ASC`);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /api/lifecycle/exempt-materials:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /api/lifecycle/destruction-records —销毁执行记录
app.get("/api/lifecycle/destruction-records", requirePermission("wms.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM v_material_destruction_records ORDER BY created_at DESC LIMIT 200`);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /api/lifecycle/destruction-records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}
