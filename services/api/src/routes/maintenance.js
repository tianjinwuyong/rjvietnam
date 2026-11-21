// Maintenance domains routes, moved out of services/api/server.js.
//
// WHY THIS FILE EXISTS. server.js is ~49k lines in one module; a route group nobody can
// find is a route group nobody reviews. These 28 registrations were chosen as the first
// slice because they share the property that makes a move safe: they are pure
// `app.<verb>(path, middleware, handler)` calls with no module-level declarations of

// their own, so the only thing the move needs is the free identifiers the handlers read
// from server.js.
//
// ORDERING IS THE CONTRACT. `registerMaintenanceRoutes(app, deps)` is invoked from
// server.js at the exact line the block used to occupy, so middleware registered above
// it still runs above it. Mounting a router later would silently change which middleware
// has already run -- scripts/check-auth-order.mjs exists because that mistake has
// already happened 24 times in this file.
//
// The dependency list is not hand-maintained: `tsc --checkJs` on this file reports every
// free identifier as TS2304, and that is where the names below came from.
export function registerMaintenanceRoutes(app, deps) {
  // tsc --checkJs reported exactly these four free identifiers (TS2304) in the block.
  const { query, getClient, requirePermission, errorEnvelope } = deps;


app.get("/maintenance/records", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { status, type, equipmentNo, limit = 100, offset = 0 } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) { params.push(status); where += ` AND mwo.status = $${params.length}`; }
    if (type) { params.push(type); where += ` AND mwo.fault_category = $${params.length}`; }
    if (equipmentNo) { params.push(`%${equipmentNo}%`); where += ` AND mwo.equipment_code LIKE $${params.length}`; }
    params.push(Number(limit), Number(offset));
    const r = await query(`
      SELECT mwo.*, e.name_zh AS equipment_name
      FROM maintenance_work_orders mwo
      LEFT JOIN equipment_assets e ON e.id = mwo.equipment_id
      ${where}
      ORDER BY mwo.issue_time DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const cnt = await query(`SELECT count(*) AS total FROM maintenance_work_orders mwo ${where}`, params.slice(0,-2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /maintenance/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /maintenance/records
app.post("/maintenance/records", requirePermission("maintenance.execute"), async (req, res) => {
  try {
    const { equipmentNo, type, priority, description, scheduledDate, operator } = req.body;
    if (!equipmentNo || !description) return res.status(400).json(errorEnvelope("VALIDATION", "equipmentNo and description required"));
    const eqR = await query(`SELECT id, name_zh FROM equipment_assets WHERE asset_code = $1`, [equipmentNo]);
    const eq = eqR.rows[0];
    const woNo = `WO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*9999)).padStart(4,'0')}`;
    const r = await query(`
      INSERT INTO maintenance_work_orders (wo_no, equipment_id, equipment_code, equipment_name_zh, fault_category, priority, fault_description, issue_person, status, issue_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting_to_process', NOW())
      RETURNING id, wo_no, status, priority, fault_description
    `, [woNo, eq?.id ?? null, equipmentNo, eq?.name_zh ?? '', type ?? 'other', priority ?? 'medium', description, operator ?? 'PMC']);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /maintenance/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /maintenance/records/:id
app.patch("/maintenance/records/:id", requirePermission("maintenance.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedTechnician, realCause, resolutionNotes, hangingReason, handoverTo, downtimeMinutes } = req.body;
    const sets = [], params = [];
    if (status) { params.push(status); sets.push(`status = $${params.length}`); }
    if (assignedTechnician !== undefined) { params.push(assignedTechnician); sets.push(`assigned_technician = $${params.length}`); }
    if (realCause !== undefined) { params.push(realCause); sets.push(`real_cause = $${params.length}`); }
    if (resolutionNotes !== undefined) { params.push(resolutionNotes); sets.push(`resolution_notes = $${params.length}`); }
    if (hangingReason !== undefined) { params.push(hangingReason); sets.push(`hanging_reason = $${params.length}`); }
    if (handoverTo !== undefined) { params.push(handoverTo); sets.push(`handover_to = $${params.length}`); }
    if (downtimeMinutes !== undefined) { params.push(downtimeMinutes); sets.push(`downtime_minutes = $${params.length}`); }
    if (status === 'received') { sets.push(`received_at = NOW()`); }
    if (status === 'in_processing') { sets.push(`started_at = COALESCE(started_at, NOW())`); }
    if (['fixed', 'closed'].includes(status)) { sets.push(`completed_at = NOW()`); }
    if (!sets.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    params.push(id);
    const r = await query(`UPDATE maintenance_work_orders SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING id, wo_no, status`, params);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Work order not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PATCH /maintenance/records/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/checklists/templates
app.get("/maintenance/checklists/templates", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM equipment_checklist_templates WHERE is_active = TRUE ORDER BY template_code ASC`);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/checklists/templates:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/checklists/schedule
app.get("/maintenance/checklists/schedule", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { limit = 200 } = req.query;
    const r = await query(`
      SELECT ecs.*, ect.template_name, ect.equipment_type, ea.asset_code, ea.name_zh AS equipment_name
      FROM equipment_checklist_schedule ecs
      JOIN equipment_checklist_templates ect ON ect.id = ecs.template_id
      LEFT JOIN equipment_assets ea ON ea.id = ecs.equipment_id
      ORDER BY ecs.scheduled_date DESC
      LIMIT $1
    `, [Number(limit)]);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/checklists/schedule:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/checklists/records
app.get("/maintenance/checklists/records", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { equipmentId, limit = 100, offset = 0 } = req.query;
    let where = "";
    const params = [Number(limit), Number(offset)];
    if (equipmentId) { params.unshift(equipmentId); where = `WHERE ecr.equipment_id = $1`; }
    const r = await query(`
      SELECT ecr.*, ect.template_name, ea.asset_code, ea.name_zh AS equipment_name
      FROM equipment_checking_records ecr
      JOIN equipment_checklist_templates ect ON ect.id = ecr.template_id
      LEFT JOIN equipment_assets ea ON ea.id = ecr.equipment_id
      ${where}
      ORDER BY ecr.check_time DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const cnt = await query(`SELECT count(*) AS total FROM equipment_checking_records ecr ${where}`, params.slice(0,-2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /maintenance/checklists/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /maintenance/checklists/records
app.post("/maintenance/checklists/records", requirePermission("maintenance.execute"), async (req, res) => {
  try {
    const { templateId, equipmentId, equipmentCode, shiftType, checkDate, items, inspectorName, overallResult, notes } = req.body;
    if (!templateId) return res.status(400).json(errorEnvelope("VALIDATION", "templateId required"));
    const recordNo = `CR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*999)).padStart(3,'0')}`;
    const passedItems = items?.filter((i) => i.result === 'pass').length ?? 0;
    const failedItems = items?.filter((i) => i.result === 'fail').length ?? 0;
    const r = await query(`
      INSERT INTO equipment_checking_records (record_no, template_id, equipment_id, equipment_code, shift_type, check_date, inspector_name, total_items, passed_items, failed_items, overall_result, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, record_no, overall_result
    `, [recordNo, templateId, equipmentId, equipmentCode, shiftType ?? 'day', checkDate ?? new Date().toISOString().slice(0,10), inspectorName ?? 'PMC', items?.length ?? 0, passedItems, failedItems, overallResult ?? 'pass', notes]);
    const recordId = r.rows[0].id;
    // Insert detail items
    if (items?.length) {
      for (const item of items) {
        await query(`
          INSERT INTO equipment_checking_record_details (record_id, item_id, item_order, check_point, result, numeric_value, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [recordId, item.itemId, item.itemOrder ?? 0, item.checkPoint ?? '', item.result ?? 'pass', item.numericValue ?? null, item.notes ?? '']);
      }
    }
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /maintenance/checklists/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/checklists/compliance/by-equipment
app.get("/maintenance/checklists/compliance/by-equipment", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { equipmentId, period = 30 } = req.query;
    const r = await query(`
      SELECT ea.asset_code, ea.name_zh,
             count(ecr.id) AS checks_done,
             count(CASE WHEN ecr.overall_result = 'pass' THEN 1 END) AS checks_passed,
             count(CASE WHEN ecr.overall_result = 'fail' THEN 1 END) AS checks_failed,
             round(count(CASE WHEN ecr.overall_result = 'pass' THEN 1 END)::numeric / nullif(count(ecr.id),0) * 100, 1) AS compliance_rate
      FROM equipment_assets ea
      LEFT JOIN equipment_checking_records ecr ON ecr.equipment_id = ea.id
        AND ecr.check_date >= NOW() - ($2 || ' days')::interval
      WHERE ea.id = $1 OR $1 IS NULL
      GROUP BY ea.id, ea.asset_code, ea.name_zh
      ORDER BY ea.asset_code
    `, [equipmentId ?? null, period ?? 30]);
    res.json({ items: r.rows });
  } catch (err) {
    console.error("GET /maintenance/checklists/compliance/by-equipment:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/checklists/compliance/daily
app.get("/maintenance/checklists/compliance/daily", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const r = await query(`
      SELECT check_date, count(*) AS total_checks,
             count(CASE WHEN overall_result = 'pass' THEN 1 END) AS passed,
             count(CASE WHEN overall_result = 'fail' THEN 1 END) AS failed,
             round(count(CASE WHEN overall_result = 'pass' THEN 1 END)::numeric / nullif(count(*),0) * 100, 1) AS compliance_rate
      FROM equipment_checking_records
      WHERE check_date >= NOW() - INTERVAL '30 days'
      GROUP BY check_date
      ORDER BY check_date DESC
    `);
    res.json({ items: r.rows });
  } catch (err) {
    console.error("GET /maintenance/checklists/compliance/daily:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/inspection/templates
app.get("/maintenance/inspection/templates", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM inspection_templates WHERE is_active = TRUE ORDER BY template_name ASC`);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/inspection/templates:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/inspection/assignments
app.get("/maintenance/inspection/assignments", requirePermission("maintenance.read"), async (req, res) => {
  try {
    // inspection_assignments keys on machine_id/shift_date. The filter and the LIMIT
    // also shared $1 whenever equipmentId was present, so indices are built from the
    // filter list and the limit is always the last parameter.
    const { equipmentId, status, limit = 200 } = req.query;
    const filterParams = [];
    const filters = [];
    // The console filters by asset code (EQ-0001) while the column is a machines(id) FK,
    // so a bare code never matched and a numeric string used to raise a cast error.
    if (equipmentId) {
      filterParams.push(equipmentId);
      const p = `$${filterParams.length}`;
      filters.push(`ia.machine_id = COALESCE((SELECT ea2.machine_id FROM equipment_assets ea2 WHERE ea2.asset_code = ${p}), CASE WHEN ${p} ~ '^[0-9]+$' THEN ${p}::bigint END)`);
    }
    if (status) { filterParams.push(status); filters.push(`ia.status = $${filterParams.length}`); }
    const params = [...filterParams, Number(limit)];
    const r = await query(`
      SELECT ia.*, it.template_name, ea.asset_code, ea.name_zh AS equipment_name
      FROM inspection_assignments ia
      JOIN inspection_templates it ON it.id = ia.template_id
      LEFT JOIN equipment_assets ea ON ea.machine_id = ia.machine_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY ia.shift_date ASC
      LIMIT $${params.length}
    `, params);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/inspection/assignments:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /maintenance/inspection/assignments
app.post("/maintenance/inspection/assignments", requirePermission("maintenance.execute"), async (req, res) => {
  try {
    const { templateId, equipmentId, dueDate, assignedTo, shiftType } = req.body;
    if (!templateId || !dueDate) return res.status(400).json(errorEnvelope("VALIDATION", "templateId and dueDate required"));
    const r = await query(`
      INSERT INTO inspection_assignments (template_id, equipment_id, due_date, assigned_to, shift_type, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id, status, due_date
    `, [templateId, equipmentId, dueDate, assignedTo ?? 'PMC', shiftType ?? 'day']);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /maintenance/inspection/assignments:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /maintenance/inspection/assignments/:id
app.patch("/maintenance/inspection/assignments/:id", requirePermission("maintenance.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json(errorEnvelope("VALIDATION", "status required"));
    const r = await query(
      `UPDATE inspection_assignments SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Assignment not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PATCH /maintenance/inspection/assignments/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/inspection/records
app.get("/maintenance/inspection/records", requirePermission("maintenance.read"), async (req, res) => {
  try {
    // inspection_records keys on machine_id and records completed_at, not
    // equipment_id/inspected_at; equipment_assets joins by its machine_id.
    const { equipmentId, limit = 100, offset = 0 } = req.query;
    const filterParams = [];
    const filters = [];
    if (equipmentId) {
      filterParams.push(equipmentId);
      const p = `$${filterParams.length}`;
      filters.push(`ir.machine_id = COALESCE((SELECT ea2.machine_id FROM equipment_assets ea2 WHERE ea2.asset_code = ${p}), CASE WHEN ${p} ~ '^[0-9]+$' THEN ${p}::bigint END)`);
    }
    const filterSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const r = await query(`
      SELECT ir.*, it.template_name, ea.asset_code, ea.name_zh AS equipment_name
      FROM inspection_records ir
      JOIN inspection_templates it ON it.id = ir.template_id
      LEFT JOIN equipment_assets ea ON ea.machine_id = ir.machine_id
      ${filterSql}
      ORDER BY ir.completed_at DESC NULLS LAST
      LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
    `, [...filterParams, Number(limit), Number(offset)]);
    const cnt = await query(`SELECT count(*) AS total FROM inspection_records ir ${filterSql}`, filterParams);
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /maintenance/inspection/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /maintenance/inspection/records
app.post("/maintenance/inspection/records", requirePermission("maintenance.execute"), async (req, res) => {
  try {
    const { templateId, equipmentId, equipmentCode, inspectorName, items, overallResult, notes } = req.body;
    if (!templateId) return res.status(400).json(errorEnvelope("VALIDATION", "templateId required"));
    const recordNo = `IR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*999)).padStart(3,'0')}`;
    const r = await query(`
      INSERT INTO inspection_records (record_no, template_id, equipment_id, equipment_code, inspector_name, overall_result, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, record_no, overall_result
    `, [recordNo, templateId, equipmentId, equipmentCode, inspectorName ?? 'PMC', overallResult ?? 'pass', notes]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /maintenance/inspection/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/inspection/abnormals
app.get("/maintenance/inspection/abnormals", requirePermission("maintenance.read"), async (req, res) => {
  try {
    // inspection_abnormals keys on machine_id, not equipment_id.
    const { status, limit = 100 } = req.query;
    const filterParams = [];
    let where = "";
    if (status) { filterParams.push(status); where = `WHERE ia.status = $1`; }
    const params = [...filterParams, Number(limit)];
    const r = await query(`
      SELECT ia.*, ir.record_no, ea.asset_code, ea.name_zh AS equipment_name
      FROM inspection_abnormals ia
      JOIN inspection_records ir ON ir.id = ia.record_id
      LEFT JOIN equipment_assets ea ON ea.machine_id = ia.machine_id
      ${where}
      ORDER BY ia.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/inspection/abnormals:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/pm/templates
app.get("/maintenance/pm/templates", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM pm_task_library WHERE is_active = TRUE ORDER BY machine_type, task_name ASC LIMIT 500`);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    // Fallback: try pm_templates if pm_task_library doesn't exist
    try {
      const r2 = await query(`SELECT * FROM pm_templates ORDER BY template_name ASC LIMIT 500`);
      res.json({ items: r2.rows, total: r2.rows.length });
    } catch {
      res.json({ items: [], total: 0 });
    }
  }
});

// GET /maintenance/pm/schedule
app.get("/maintenance/pm/schedule", requirePermission("maintenance.read"), async (req, res) => {
  try {
    // pm_assignments/pm_plans/pm_task_library are gone: the live model keeps one row
    // per asset+template+frequency in pm_schedule_assignments, with the task text on
    // pm_templates.
    const r = await query(`
      SELECT psa.*, pt.template_name, pt.machine_type, ea.asset_code, ea.name_zh AS equipment_name
      FROM pm_schedule_assignments psa
      LEFT JOIN pm_templates pt ON pt.id = psa.template_id
      LEFT JOIN equipment_assets ea ON ea.id = psa.asset_id
      ORDER BY psa.next_due_date ASC NULLS LAST
      LIMIT 200
    `);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/pm/schedule:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/pm/execution-logs
app.get("/maintenance/pm/execution-logs", requirePermission("maintenance.read"), async (req, res) => {
  try {
    // pm_execution_logs keys on asset_id/template_id and records completed_date, not
    // plan_id/equipment_id/executed_at; pm_plans and pm_task_library no longer exist.
    const { equipmentId, limit = 100 } = req.query;
    const params = [Number(limit)];
    let assetFilter = "";
    if (equipmentId) { params.unshift(equipmentId); assetFilter = `AND mel.asset_id = $1`; }
    const r = await query(`
      SELECT mel.*, pt.template_name, ea.asset_code, ea.name_zh AS equipment_name
      FROM pm_execution_logs mel
      LEFT JOIN pm_templates pt ON pt.id = mel.template_id
      LEFT JOIN equipment_assets ea ON ea.id = mel.asset_id
      WHERE 1=1 ${assetFilter}
      ORDER BY mel.completed_date DESC NULLS LAST, mel.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/pm/execution-logs:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/dashboard
app.get("/maintenance/dashboard", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const openWO = await query(`SELECT count(*) AS cnt FROM maintenance_work_orders WHERE status NOT IN ('fixed','closed')`);
    const criticalWO = await query(`SELECT count(*) AS cnt FROM maintenance_work_orders WHERE priority = 'critical' AND status NOT IN ('fixed','closed')`);
    // inspection_assignments was rebuilt around machine_id/shift_date; due_date is gone.
    const todayInspections = await query(`SELECT count(*) AS cnt FROM inspection_assignments WHERE shift_date = CURRENT_DATE`);
    const overdueInspections = await query(`SELECT count(*) AS cnt FROM inspection_assignments WHERE shift_date < CURRENT_DATE AND status != 'completed'`);
    const avgDowntime = await query(`SELECT round(avg(downtime_minutes))::int AS avg FROM maintenance_work_orders WHERE downtime_minutes > 0`);
    const mtbf = await query(`SELECT round(avg(extract(epoch from (completed_at - issue_time))/60))::int AS mtbf_minutes FROM maintenance_work_orders WHERE status = 'fixed' AND completed_at IS NOT NULL`);
    res.json({
      openWorkOrders: Number(openWO.rows[0]?.cnt ?? 0),
      criticalWorkOrders: Number(criticalWO.rows[0]?.cnt ?? 0),
      todayInspections: Number(todayInspections.rows[0]?.cnt ?? 0),
      overdueInspections: Number(overdueInspections.rows[0]?.cnt ?? 0),
      avgDowntimeMinutes: Number(avgDowntime.rows[0]?.avg ?? 0),
      mtbfMinutes: Number(mtbf.rows[0]?.mtbf_minutes ?? 0),
    });
  } catch (err) {
    console.error("GET /maintenance/dashboard:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/machine-status
app.get("/maintenance/machine-status", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const r = await query(`
      SELECT ea.id, ea.asset_code, ea.name_zh AS equipment_name,
             ea.status AS operational_status,
             (SELECT MAX(wo.completed_at) FROM maintenance_work_orders wo
               WHERE wo.equipment_id = ea.id AND wo.status = 'fixed') AS last_maintenance_date,
             (SELECT MIN(mp.next_due_date) FROM maintenance_plans mp
               WHERE mp.asset_id = ea.id AND mp.status = 'active') AS next_pm_date,
             mss.status AS running_status,
             -- the snapshot table carries one state, not separate power/alarm flags;
             -- the keys stay so clients do not have to special-case the payload
             NULL::text AS power_status,
             NULL::text AS alarm_status,
             mss.last_updated AS snapshot_time
      FROM equipment_assets ea
      LEFT JOIN machine_status_snapshots mss ON mss.machine_id = ea.machine_id
      ORDER BY ea.asset_code
      LIMIT 200
    `);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/machine-status:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/oee
app.get("/maintenance/oee", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { equipmentId, days = 7 } = req.query;
    // machine_oee_logs keys on machine_id; equipment_assets links to it by machine_id,
    // not by its own id. The day window used a hardcoded $2 that only exists when a
    // machine filter is applied, so the parameter index is computed instead.
    const params = [Number(days)];
    let machineFilter = "";
    if (equipmentId) {
      params.unshift(equipmentId);
      machineFilter = `AND mol.machine_id = COALESCE((SELECT ea2.machine_id FROM equipment_assets ea2 WHERE ea2.asset_code = $1), CASE WHEN $1 ~ '^[0-9]+$' THEN $1::bigint END)`;
    }
    const r = await query(`
      SELECT mol.*, ea.asset_code, ea.name_zh AS equipment_name
      FROM machine_oee_logs mol
      LEFT JOIN equipment_assets ea ON ea.machine_id = mol.machine_id
      WHERE mol.log_date >= CURRENT_DATE - ($${params.length} * INTERVAL '1 day')
      ${machineFilter}
      ORDER BY mol.log_date DESC
      LIMIT 200
    `, params);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/oee:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/equipment — list all equipment
app.get("/maintenance/equipment", requirePermission("maintenance.read"), async (req, res) => {
  try {
    // equipment_assets has neither machine_type nor operational_status: the live model
    // keeps the human label on equipment_categories and the running state on `status`.
    const r = await query(`
      SELECT ea.id, ea.asset_code, ea.name_zh,
             ec.name_zh AS machine_type,
             ea.status AS operational_status,
             ea.line_id
      FROM equipment_assets ea
      LEFT JOIN equipment_categories ec ON ec.id = ea.category_id
      ORDER BY ea.asset_code ASC
    `);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /maintenance/equipment:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/equipment/:id
app.get("/maintenance/equipment/:id", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query(`SELECT * FROM equipment_assets WHERE id = $1`, [id]);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Equipment not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("GET /maintenance/equipment/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MAINTENANCE CARD API (Q1-Q20 Grill — 2026-07-25)
// ═══════════════════════════════════════════════════════════════════════════

// GET /maintenance/card/:equipmentId — get maintenance card for equipment
app.get("/maintenance/card/:equipmentId", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const { level } = req.query; // daily|weekly|monthly|quarterly|annual

    // Get equipment info
    const eqResult = await query(`
      SELECT ea.*, pl.internal_code as line_code, pl.name as line_name,
             s.code as station_code, s.name as station_name,
             u1.name as responsible_name, u1.phone as responsible_phone
      FROM equipment_assets ea
      LEFT JOIN production_lines pl on pl.id = ea.line_id
      LEFT JOIN stations s on s.id = ea.station_id
      LEFT JOIN users u1 on u1.id = ea.responsible_engineer_id
      WHERE ea.id = $1
    `, [equipmentId]);

    if (eqResult.rows.length === 0) {
      return res.status(404).json(errorEnvelope("NOT_FOUND", "Equipment not found"));
    }
    const equipment = eqResult.rows[0];

    // Get PM template for this equipment category + level
    let templateQuery = `
      SELECT pt.*, ec.name_zh as category_name
      FROM pm_templates pt
      LEFT JOIN equipment_categories ec on ec.id = pt.equipment_category_id
      WHERE pt.status = 'active'
    `;
    const params = [];
    if (level) {
      templateQuery += ` AND pt.pm_level = $1`;
      params.push(level);
    }
    const tmplResult = await query(templateQuery, params.length ? params : []);
    const template = tmplResult.rows[0] || null;

    // Get PM tasks for the template
    let tasks = [];
    if (template) {
      const taskResult = await query(`
        SELECT * FROM pm_template_tasks
        WHERE template_id = $1 AND status = 'active'
        ORDER BY task_no ASC
      `, [template.id]);
      tasks = taskResult.rows;
    }

    // Get latest execution for each level
    const latestExecResult = await query(`
      SELECT pm_level, actual_start, executor_id, result
      FROM pm_execution_records
      WHERE asset_id = $1
      ORDER BY actual_start DESC
      LIMIT 10
    `, [equipmentId]);
    const recentExecutions = latestExecResult.rows;

    // Get active card info
    const cardResult = await query(`
      SELECT mc.*,
             u.name as last_printed_by_name
      FROM maintenance_cards mc
      LEFT JOIN users u on u.id = mc.last_printed_by
      WHERE mc.asset_id = $1 AND mc.is_active = true
      LIMIT 1
    `, [equipmentId]);
    const card = cardResult.rows[0] || null;

    res.json({
      equipment,
      template,
      tasks,
      recentExecutions,
      card,
    });
  } catch (err) {
    console.error("GET /maintenance/card:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /maintenance/card/:equipmentId/execute — execute a maintenance card
app.post("/maintenance/card/:equipmentId/execute", requirePermission("maintenance.write"), async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const {
      template_id, pm_level, trigger_type, scheduled_date,
      task_results,    // array of {task_no, result, measured_value, notes, photo_urls}
      abnormal_description, notes,
      first_article_result, trial_pieces,
      // Signatures
      executor_id, leader_id, engineer_id,
      executor_sig, leader_sig, engineer_sig,
    } = req.body;

    const client = await getClient();
    try {
      await client.query("begin");

      // Generate execution number
      const seqResult = await client.query(`SELECT nextval('pm_execution_seq')`);
      const seq = seqResult.rows[0].nextval;
      const executionNo = `PM-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

      // Insert execution record
      const execResult = await client.query(`
        INSERT INTO pm_execution_records (
          execution_no, template_id, asset_id, pm_level, trigger_type,
          scheduled_date, actual_start, result, abnormal_description, notes,
          first_article_result, trial_pieces, executor_id
        ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [
        executionNo, template_id, equipmentId, pm_level, trigger_type || 'manual',
        scheduled_date || new Date().toISOString().split('T')[0],
        task_results && task_results.some((t) => t.result === 'ng') ? 'abnormal' : 'completed',
        abnormal_description || null, notes || null,
        first_article_result || 'na', trial_pieces || 0, executor_id
      ]);
      const execution = execResult.rows[0];

      // Insert task results
      for (const tr of (task_results || [])) {
        await client.query(`
          INSERT INTO pm_execution_items (
            execution_id, template_task_id, task_no, task_name,
            result, measured_value, standard_value, photo_urls, notes, checked_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
        `, [
          execution.id, tr.template_task_id || null, tr.task_no,
          tr.task_name || '', tr.result, tr.measured_value || null,
          tr.standard_value || null, tr.photo_urls || [], tr.notes || null
        ]);
      }

      // Update equipment cumulative runtime if runtime trigger
      if (trigger_type === 'runtime') {
        await client.query(`
          UPDATE equipment_assets
          SET total_pm_count = total_pm_count + 1,
              cumulative_runtime_hours = cumulative_runtime_hours + COALESCE($2, 0)
          WHERE id = $1
        `, [equipmentId, 0]); // actual runtime increment would come from meter reading
      } else {
        await client.query(`
          UPDATE equipment_assets SET total_pm_count = total_pm_count + 1 WHERE id = $1
        `, [equipmentId]);
      }

      await client.query("commit");
      res.json({ success: true, execution });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /maintenance/card/execute:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /maintenance/card/:equipmentId/print — log card print
app.post("/maintenance/card/:equipmentId/print", requirePermission("maintenance.write"), async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const { card_version, print_format } = req.body;
    const userId = req.user?.id;

    // Upsert active card record
    await query(`
      INSERT INTO maintenance_cards (asset_id, card_version, is_active, print_count, last_printed_at, last_printed_by)
      VALUES ($1, $2, true, 1, now(), $3)
      ON CONFLICT (asset_id) WHERE is_active = true
      DO UPDATE SET
        card_version = EXCLUDED.card_version,
        print_count = maintenance_cards.print_count + 1,
        last_printed_at = now(),
        last_printed_by = EXCLUDED.last_printed_by
    `, [equipmentId, card_version || 1, userId]);

    res.json({ success: true });
  } catch (err) {
    console.error("POST /maintenance/card/print:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /maintenance/card/:equipmentId/history — get execution history
app.get("/maintenance/card/:equipmentId/history", requirePermission("maintenance.read"), async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const { limit = 20 } = req.query;

    const result = await query(`
      SELECT pm.*,
             u1.name as executor_name,
             pt.template_name_zh
      FROM pm_execution_records pm
      LEFT JOIN users u1 on u1.id = pm.executor_id
      LEFT JOIN pm_templates pt on pt.id = pm.template_id
      WHERE pm.asset_id = $1
      ORDER BY pm.actual_start DESC
      LIMIT $2
    `, [equipmentId, Number(limit)]);

    res.json(result.rows);
  } catch (err) {
    console.error("GET /maintenance/card/history:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

  // Every route above was, until this slice, written directly against the `app`
  // object inside services/api/server.js. Nothing in this module mounts a router or
  // re-registers middleware: the caller owns ordering, and it calls this from the
  // exact line the block used to occupy.
}
