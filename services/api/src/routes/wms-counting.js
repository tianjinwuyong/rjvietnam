// WMS cycle-count routes (/wms/count-*), moved out of services/api/server.js.
//
// 11 registrations: count sessions and their claim/submit flow, per-item counting,
// count schedules and manual triggers, count alerts and acknowledgement, and the
// patrol session generator.
//
// Pure registrations -- no module-level declarations in the block -- so this is the
// maintenance/pmc shape rather than the qms one. registerCountRoutes is invoked where
// the block used to sit, so middleware order is unchanged.
export function registerCountRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, getCurrentUser } = deps;

app.get("/wms/count-sessions", requirePermission("wms.read"), async (req, res) => {
  try {
    const { status, location_code, trigger_type, limit = 100, offset = 0 } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) { params.push(status); where += ` AND cs.status = $${params.length}`; }
    if (location_code) { params.push(location_code); where += ` AND cs.location_code = $${params.length}`; }
    if (trigger_type) { params.push(trigger_type); where += ` AND cs.trigger_type = $${params.length}`; }
    params.push(Number(limit), Number(offset));
     const r = await query(`
       SELECT cs.*,
              sl.code AS location_code, sl.name_zh AS location_name,
              u.display_name AS operator_name
       FROM count_sessions cs
       LEFT JOIN storage_locations sl ON sl.id = cs.storage_location_id
       LEFT JOIN users u ON u.id = cs.operator_id
      ${where}
      ORDER BY cs.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const cnt = await query(`SELECT count(*) AS total FROM count_sessions cs ${where}`, params.slice(0,-2));
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /wms/count-sessions:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /wms/count-sessions/:id — single session with items
app.get("/wms/count-sessions/:id", requirePermission("wms.read"), async (req, res) => {
  try {
    const { id } = req.params;
    const sess = await query(`SELECT cs.*, sl.code AS location_code, sl.name_zh AS location_name,
      u.name AS operator_name FROM count_sessions cs
      LEFT JOIN storage_locations sl ON sl.id = cs.storage_location_id
      LEFT JOIN users u ON u.id = cs.operator_id
      WHERE cs.id = $1`, [id]);
    if (!sess.rows[0]) return res.status(404).json(errorEnvelope("NOT_FOUND", "Session not found"));
    const items = await query(`SELECT ci.*, u.name AS counted_by_name
      FROM count_items ci LEFT JOIN users u ON u.id = ci.counted_by
      WHERE ci.count_session_id = $1 ORDER BY ci.id`, [id]);
    res.json({ session: sess.rows[0], items: items.rows });
  } catch (err) {
    console.error("GET /wms/count-sessions/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/count-sessions/:id/claim — operator claims a session
app.post("/wms/count-sessions/:id/claim", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const operator = getCurrentUser(req);
    await query(`UPDATE count_sessions
      SET status='in_progress', operator_id=$1, operator_name=$2, claimed_at=now()
      WHERE id=$3 AND status='open'`,
      [operator.id, operator.name, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /wms/count-sessions/:id/claim:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/count-items/:id/count — record counted qty for an item + variance alert
app.post("/wms/count-items/:id/count", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { counted_qty, operator_id, operator_name } = req.body;
    const item = await query(`SELECT ci.*, cs.threshold_pct, cs.session_code
      FROM count_items ci JOIN count_sessions cs ON cs.id = ci.count_session_id
      WHERE ci.id = $1`, [id]);
    if (!item.rows[0]) return res.status(404).json(errorEnvelope("NOT_FOUND", "Item not found"));
    const row = item.rows[0];
    const variance = (counted_qty ?? 0) - row.system_qty;
    const variance_pct = row.system_qty > 0
      ? Math.round(Math.abs(variance) / row.system_qty * 100)
      : (counted_qty > 0 ? 100 : 0);

    await query(`UPDATE count_items
      SET counted_qty=$1, variance=$2, counted=true, counted_at=now(), counted_by=$3
      WHERE id=$4`,
      [counted_qty, variance, operator_id, id]);

    // Variance alert: if pct > threshold, write count_alerts
    if (variance_pct > row.threshold_pct) {
      const priority = variance_pct > row.threshold_pct * 2 ? 1 : 2;
      await query(`INSERT INTO count_alerts (
        count_session_id, count_item_id, alert_type, priority, title, message,
        variance_pct, threshold_pct, system_qty, counted_qty, location_code, lot_no, material_code
      ) VALUES ($1,$2,'VARIANCE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.count_session_id, id, priority,
       `盘点差异预警: ${row.lot_no}`,
       `物料 ${row.material_code} (批号 ${row.lot_no}) 盘点差异 ${variance > 0 ? '+' : ''}${variance} (${variance_pct}%)，超过阈值 ${row.threshold_pct}%`,
       variance_pct, row.threshold_pct, row.system_qty, counted_qty, row.location_code, row.lot_no, row.material_code]);
    }
    res.json({ success: true, variance, variance_pct });
  } catch (err) {
    console.error("POST /wms/count-items/:id/count:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/count-sessions/:id/submit — submit session (all items counted → close)
app.post("/wms/count-sessions/:id/submit", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    // Sum all items
    const items = await query(`SELECT COALESCE(SUM(counted_qty),0)::int AS total_counted,
      COALESCE(SUM(variance),0)::int AS total_variance
      FROM count_items WHERE count_session_id=$1`, [id]);
    const { total_counted, total_variance } = items.rows[0];
    await query(`UPDATE count_sessions
      SET status='completed', completed_at=now(), counted_qty=$1, variance=$2, notes=COALESCE($3, notes)
      WHERE id=$4`, [total_counted, total_variance, notes, id]);
    res.json({ success: true, total_counted, total_variance });
  } catch (err) {
    console.error("POST /wms/count-sessions/:id/submit:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /wms/count-schedules — list schedules
app.get("/wms/count-schedules", requirePermission("wms.read"), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM count_schedules ORDER BY id`);
    res.json({ items: r.rows });
  } catch (err) {
    console.error("GET /wms/count-schedules:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/count-schedules — create schedule
app.post("/wms/count-schedules", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { schedule_name, schedule_type, scheduled_time, day_of_week, day_of_month,
      storage_location_id, location_code, location_name, scope, threshold_pct, timeout_hours } = req.body;
    const r = await query(`INSERT INTO count_schedules
      (schedule_name, schedule_type, scheduled_time, day_of_week, day_of_month,
       storage_location_id, location_code, location_name, scope, threshold_pct, timeout_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [schedule_name, schedule_type, scheduled_time, day_of_week, day_of_month,
       storage_location_id, location_code, location_name, scope || 'ALL', threshold_pct || 10, timeout_hours || 4]);
    res.json({ success: true, item: r.rows[0] });
  } catch (err) {
    console.error("POST /wms/count-schedules:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /wms/count-alerts — list alerts
app.get("/wms/count-alerts", requirePermission("wms.read"), async (req, res) => {
  try {
    const { acknowledged, alert_type, limit = 50, offset = 0 } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (acknowledged !== undefined) { params.push(acknowledged === 'true'); where += ` AND ca.acknowledged = $${params.length}`; }
    if (alert_type) { params.push(alert_type); where += ` AND ca.alert_type = $${params.length}`; }
    params.push(Number(limit), Number(offset));
    const r = await query(`
      SELECT ca.*, cs.session_code, cs.location_code, u.name AS operator_name
      FROM count_alerts ca
      LEFT JOIN count_sessions cs ON cs.id = ca.count_session_id
      LEFT JOIN users u ON u.id = ca.operator_id
      ${where}
      ORDER BY ca.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    res.json({ items: r.rows });
  } catch (err) {
    console.error("GET /wms/count-alerts:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/count-sessions/patrol — timeout patrol: create TIMEOUT alerts for stale sessions
app.post("/wms/count-sessions/patrol", requirePermission("wms.execute"), async (req, res) => {
  try {
    // Find open sessions past their timeout_hours that don't already have a TIMEOUT alert
    const stale = await query(`
      SELECT cs.* FROM count_sessions cs
      WHERE cs.status = 'open'
        AND cs.created_at < now() - (cs.timeout_hours || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM count_alerts ca
          WHERE ca.count_session_id = cs.id AND ca.alert_type = 'TIMEOUT'
        )
    `);
    let created = 0;
    for (const cs of stale.rows) {
      const hours_elapsed = Math.round(
        (Date.now() - new Date(cs.created_at).getTime()) / 3600000
      );
      await query(`INSERT INTO count_alerts (
        count_session_id, alert_type, priority, title, message,
        location_code, lot_no, material_code,
        operator_id, operator_name
      ) VALUES ($1,'TIMEOUT',2,$2,$3,$4,$5,$6,$7,$8)`,
      [cs.id,
       `盘点超时未处理: ${cs.session_code}`,
       `库位 ${cs.location_code} 的盘点任务 ${cs.session_code} 已超时 ${hours_elapsed} 小时未处理，请立即处理`,
       cs.location_code, cs.lot_no, cs.material_code,
       cs.operator_id, cs.operator_name]);
      created++;
    }
    res.json({ success: true, alerts_created: created });
  } catch (err) {
    console.error("POST /wms/count-sessions/patrol:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/count-schedules/:id/trigger — execute a scheduled count (create sessions for all lots)
// Called by WMS manager at the scheduled time
app.post("/wms/count-schedules/:id/trigger", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await query(`SELECT * FROM count_schedules WHERE id=$1 AND is_active=true`, [id]);
    if (!schedule.rows[0]) return res.status(404).json(errorEnvelope("NOT_FOUND", "Schedule not found"));
    const sch = schedule.rows[0];

    // Build lot query based on scope
    let lotWhere = "WHERE ml.iqc_status = 'released' AND ml.lot_status = 'active'";
    let lotParams = [];
    if (sch.scope === 'LOCATION' && sch.storage_location_id) {
      lotParams.push(sch.storage_location_id);
      lotWhere += ` AND ml.storage_location_id = $${lotParams.length}`;
    }

    const lots = await query(`
      SELECT ml.id AS material_lot_id, ml.lot_no, m.code AS material_code,
             COALESCE(m.name_zh, m.name_en, '') AS material_name_zh,
             COALESCE(sl.id, 0) AS storage_location_id,
             COALESCE(sl.code, '') AS location_code,
             COALESCE(sl.name_zh, sl.name_en, '') AS location_name,
             COALESCE(ml.received_qty, 0) AS system_qty
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
      ${lotWhere}
    `, lotParams);

    let sessions_created = 0;
    for (const lot of lots.rows) {
      const seqVal = await query(`SELECT nextval('count_session_seq')`).then(r => r.rows[0].nextval);
      const sessionCode = `CS-SCH-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(seqVal).padStart(6,'0')}`;
      const sess = await query(`INSERT INTO count_sessions (
        session_code, trigger_type, trigger_action, count_schedule_id,
        storage_location_id, location_code, location_name,
        material_lot_id, lot_no, material_code, material_name_zh,
        system_qty, status
      ) VALUES ($1,'SCHEDULED','SCHEDULED',$2,$3,$4,$5,$6,$7,$8,$9,$10,'open')
      RETURNING id`, [sessionCode, id, lot.storage_location_id, lot.location_code,
        lot.location_name, lot.material_lot_id, lot.lot_no, lot.material_code, lot.material_name_zh, lot.system_qty]);
      await query(`INSERT INTO count_items (
        count_session_id, material_lot_id, lot_no, material_code, material_name_zh,
        system_qty, inventory_tx_id, inventory_tx_no
      ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL)`,
        [sess.rows[0].id, lot.material_lot_id, lot.lot_no, lot.material_code, lot.material_name_zh, lot.system_qty]);
      sessions_created++;
    }

    await query(`UPDATE count_schedules SET last_run_at=now(), next_run_at=now() WHERE id=$1`, [id]);
    res.json({ success: true, sessions_created, schedule_name: sch.schedule_name });
  } catch (err) {
    console.error("POST /wms/count-schedules/:id/trigger:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /wms/count-alerts/:id/acknowledge
app.patch("/wms/count-alerts/:id/acknowledge", requirePermission("wms.execute"), async (req, res) => {
  try {
    const operator = getCurrentUser(req);
    await query(`UPDATE count_alerts SET acknowledged=true, acknowledged_at=now(), acknowledged_by=$1 WHERE id=$2`,
      [operator.id, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /wms/count-alerts/:id/acknowledge:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}
