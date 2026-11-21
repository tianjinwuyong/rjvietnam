// WMS production surface (/api/wms/material-loading, feeder-changes, line-stops,
// sn-material-lot, finished-goods, outbound-orders), moved out of services/api/server.js.
//
// 16 registrations: the shop-floor write path around a running line -- releasing a
// material-loaded batch to production, recording feeder changes and line stops with their
// end, binding an SN to the material lots it consumed, finished-goods intake with its OQC
// patch, and outbound orders with item lines and shipment.
//
// Pure registrations, no module-level statements in the block.
export function registerWmsProductionRoutes(app, deps) {
  const { pgPool, getClient, requirePermission, errorEnvelope } = deps;

app.patch("/api/wms/material-loading/:id/release", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { line_leader_id } = req.body;
    const r=await client.query(`UPDATE wms_material_loading SET loading_status='released',released_at=NOW(),line_leader_id=$1
      WHERE id=$2 AND loading_status='confirmed' AND quality_gate_passed=true RETURNING id`,[line_leader_id,req.params.id]);
    if(!r.rowCount)return res.status(409).json(errorEnvelope("QUALITY_GATE_BLOCKED","Only confirmed records with all quality gates passed may be released"));
    res.json({affected:r.rowCount});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// Feeder change / 换料
app.post("/api/wms/feeder-changes", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { work_order_no, station_code, feeder_no, slot_no, old_lot_no, new_lot_no,
            old_material_code, new_material_code, change_reason, operator_id, change_type } = req.body;
    const [r] = await client.query(
      `INSERT INTO wms_feeder_changes (work_order_no,station_code,feeder_no,slot_no,old_lot_no,new_lot_no,old_material_code,new_material_code,change_reason,operator_id,change_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [work_order_no,station_code,feeder_no,slot_no,old_lot_no,new_lot_no,old_material_code,new_material_code,change_reason,operator_id,change_type||"lot_change"]);
    res.json({ id: r.insertId });
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.get("/api/wms/feeder-changes", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const { work_order_no, station_code, limit=200, offset=0 } = req.query;
    let where = ["1=1"]; let p = [];
    if (work_order_no) { where.push("work_order_no=?"); p.push(work_order_no); }
    if (station_code)  { where.push("station_code=?");  p.push(station_code); }
    const [rows] = await client.query(
      `SELECT * FROM wms_feeder_changes WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...p, Number(limit), Number(offset)]);
    res.json({ items: rows });
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// Line stop / 停线
app.post("/api/wms/line-stops", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { work_order_no, station_code, stop_reason, stop_reason_code, start_time, operator_id } = req.body;
    const [r] = await client.query(
      `INSERT INTO wms_line_stops (work_order_no,station_code,stop_reason,stop_reason_code,start_time,operator_id)
       VALUES (?,?,?,?,?,?)`,
      [work_order_no,station_code,stop_reason,stop_reason_code||"other",start_time||new Date().toISOString(),operator_id]);
    res.json({ id: r.insertId });
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.patch("/api/wms/line-stops/:id/end", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { resolution, production_loss } = req.body;
    const [r] = await client.query(
      `UPDATE wms_line_stops SET end_time=NOW(),
       duration_minutes=TIMESTAMPDIFF(MINUTE,start_time,NOW()),
       resolution=?, production_loss=? WHERE id=? AND end_time IS NULL`,
      [resolution, production_loss||0, req.params.id]);
    res.json({ affected: r.affectedRows });
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.get("/api/wms/line-stops", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const { station_code, start_date, end_date, limit=200, offset=0 } = req.query;
    let where = ["1=1"]; let p = [];
    if (station_code) { where.push("station_code=?"); p.push(station_code); }
    if (start_date)   { where.push("start_time>=?"); p.push(start_date); }
    if (end_date)     { where.push("start_time<=?"); p.push(end_date); }
    const [rows] = await client.query(
      `SELECT * FROM wms_line_stops WHERE ${where.join(" AND ")} ORDER BY start_time DESC LIMIT ? OFFSET ?`,
      [...p, Number(limit), Number(offset)]);
    res.json({ items: rows });
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── SN Traceability / SN追溯 ─────────────────────────────────────────────────
app.post("/api/wms/sn-material-lot", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { sn_no, material_lot_no, material_code, material_name, work_order_no, station_code, loaded_at, operator_id, qty_per_unit } = req.body;
    if(!sn_no||!material_lot_no||!material_code)return res.status(400).json(errorEnvelope("VALIDATION","sn_no, material_lot_no and material_code required"));
    const lot=await client.query(`SELECT ml.id FROM material_lots ml JOIN materials m ON m.id=ml.material_id
      WHERE ml.lot_no=$1 AND UPPER(m.code)=UPPER($2)`,[material_lot_no,material_code]);
    if(!lot.rows[0])return res.status(409).json(errorEnvelope("LOT_MATERIAL_MISMATCH","Lot and material do not match canonical inventory"));
    const r=await client.query(`INSERT INTO wms_sn_material_lots
      (sn_no,material_lot_no,material_code,material_name,work_order_no,station_code,loaded_at,operator_id,qty_per_unit)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [sn_no,material_lot_no,material_code,material_name||"",work_order_no||null,station_code||null,loaded_at||new Date(),operator_id||null,qty_per_unit||1]);
    res.status(201).json({id:r.rows[0].id});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.get("/api/wms/sn-material-lot/:sn", requirePermission("wms.view"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const rows=await client.query(`SELECT * FROM wms_sn_material_lots WHERE sn_no=$1 ORDER BY loaded_at`,[req.params.sn]);
    res.json(rows.rows);
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── Finished Goods / 成品入库 ────────────────────────────────────────────────
app.post("/api/wms/finished-goods", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { sn_no, work_order_no, material_code, material_name, batch_code, production_date,
            qty, location_code, warehouse_zone, customer_code, customer_order_no } = req.body;
    const route=await client.query(`SELECT ps.status,wo.code FROM pcb_serials ps JOIN work_orders wo ON wo.id=ps.work_order_id
      WHERE ps.serial_no=$1 AND wo.code=$2`,[sn_no,work_order_no]);
    if(!route.rows[0])return res.status(404).json(errorEnvelope("SN_NOT_FOUND","SN/work-order binding not found"));
    if(!["completed","packed","finished"].includes(String(route.rows[0].status).toLowerCase()))
      return res.status(409).json(errorEnvelope("ROUTE_INCOMPLETE","SN has not completed every required station"));
    const r=await client.query(
      `INSERT INTO wms_finished_goods (sn_no,work_order_no,material_code,material_name,batch_code,production_date,qty,location_code,warehouse_zone,customer_code,customer_order_no,stored_at,stored_by,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,'pending_oqc') RETURNING id`,
      [sn_no,work_order_no,material_code,material_name||"",batch_code||"",production_date,qty||1,location_code||"",warehouse_zone||"",customer_code||"",customer_order_no||"",req.body.operator_id||""]);
    res.status(201).json({id:r.rows[0].id});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.get("/api/wms/finished-goods", requirePermission("wms.view"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { status, material_code, customer_order_no, limit=200, offset=0 } = req.query;
    const p=[status||null,material_code||null,customer_order_no||null];
    const rows=await client.query(`SELECT * FROM wms_finished_goods WHERE
      ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR material_code=$2)
      AND ($3::text IS NULL OR customer_order_no=$3) ORDER BY created_at DESC LIMIT $4 OFFSET $5`,[...p,Number(limit),Number(offset)]);
    const count=await client.query(`SELECT COUNT(*)::int total FROM wms_finished_goods WHERE
      ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR material_code=$2)
      AND ($3::text IS NULL OR customer_order_no=$3)`,p);
    res.json({items:rows.rows,total:count.rows[0].total,limit:Number(limit),offset:Number(offset)});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.patch("/api/wms/finished-goods/:id/oqc", requirePermission("quality.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { iqc_status, oqc_inspector } = req.body;
    if(!["passed","failed"].includes(iqc_status))return res.status(400).json(errorEnvelope("VALIDATION","OQC status must be passed or failed"));
    const r=await client.query(`UPDATE wms_finished_goods SET iqc_status=$1,oqc_inspector=$2,oqc_inspected_at=NOW(),
      stored_at=CASE WHEN $1='passed' THEN NOW() ELSE NULL END,status=CASE WHEN $1='passed' THEN 'in_stock' ELSE 'oqc_failed' END
      WHERE id=$3 AND status='pending_oqc' RETURNING id`,[iqc_status,oqc_inspector,req.params.id]);
    if(!r.rowCount)return res.status(409).json(errorEnvelope("INVALID_STATE","Only pending OQC goods may be decided"));
    res.json({affected:r.rowCount});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

// ── Outbound / 出货管理 ──────────────────────────────────────────────────────
app.post("/api/wms/outbound-orders", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { outbound_no, customer_code, customer_name, customer_order_no, outbound_type,
            planned_date, operator_id, destination, notes } = req.body;
    const r=await client.query(
      `INSERT INTO wms_outbound_orders (outbound_no,customer_code,customer_name,customer_order_no,outbound_type,planned_date,operator_id,destination)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [outbound_no, customer_code, customer_name||"", customer_order_no||"", outbound_type||"sales",
       planned_date||null, operator_id||"", destination||""]);
    res.status(201).json({id:r.rows[0].id});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.post("/api/wms/outbound-orders/:id/items", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { sn_list, material_code, batch_code } = req.body;
    // sn_list: array of {sn_no, qty}
    if(!Array.isArray(sn_list)||!sn_list.length)return res.status(400).json(errorEnvelope("VALIDATION","sn_list required"));
    await client.query("BEGIN");
    for(const sn of sn_list){
      const fg=await client.query("SELECT status FROM wms_finished_goods WHERE sn_no=$1 FOR UPDATE",[sn.sn_no]);
      if(fg.rows[0]?.status!=="in_stock")throw new Error(`SN_NOT_AVAILABLE:${sn.sn_no}`);
      await client.query(`INSERT INTO wms_outbound_items(outbound_order_id,sn_no,material_code,batch_code,qty)
        VALUES($1,$2,$3,$4,$5)`,[req.params.id,sn.sn_no,material_code||null,batch_code||null,sn.qty||1]);
      await client.query("UPDATE wms_finished_goods SET status='reserved',updated_at=NOW() WHERE sn_no=$1",[sn.sn_no]);
    }
    await client.query(`UPDATE wms_outbound_orders SET total_qty=(SELECT COALESCE(SUM(qty),0) FROM wms_outbound_items WHERE outbound_order_id=$1),
      status='picking',updated_at=NOW() WHERE id=$1`,[req.params.id]);
    await client.query("COMMIT");
    res.json({added:sn_list.length});
  } catch(e) { await client.query("ROLLBACK").catch(()=>{}); console.error(e); res.status(409).json({error:e.message}); }
  finally { client.release(); }
});

app.patch("/api/wms/outbound-orders/:id/ship", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { logistics_no, shipping_method } = req.body;
    if(!logistics_no)return res.status(400).json(errorEnvelope("LOAD_CONFIRMATION_REQUIRED","Logistics/load scan reference required"));
    await client.query("BEGIN");
    const items=await client.query("SELECT sn_no FROM wms_outbound_items WHERE outbound_order_id=$1 FOR UPDATE",[req.params.id]);
    if(!items.rowCount)throw new Error("OUTBOUND_EMPTY");
    const r=await client.query(`UPDATE wms_outbound_orders SET status='shipped',actual_date=CURRENT_DATE,logistics_no=$1,
      shipping_method=$2,updated_at=NOW() WHERE id=$3 AND status IN('picking','packed') RETURNING id`,[logistics_no,shipping_method||"",req.params.id]);
    if(!r.rowCount)throw new Error("INVALID_OUTBOUND_STATE");
    await client.query(`UPDATE wms_finished_goods fg SET status='shipped',updated_at=NOW()
      FROM wms_outbound_items oi WHERE oi.sn_no=fg.sn_no AND oi.outbound_order_id=$1`,[req.params.id]);
    await client.query("COMMIT");
    res.json({affected:r.rowCount});
  } catch(e) { await client.query("ROLLBACK").catch(()=>{}); console.error(e); res.status(409).json({error:e.message}); }
  finally { client.release(); }
});

app.get("/api/wms/outbound-orders", requirePermission("wms.view"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { status, customer_code, limit=200, offset=0 } = req.query;
    const rows=await client.query(`SELECT * FROM wms_outbound_orders
      WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR customer_code=$2)
      ORDER BY created_at DESC LIMIT $3 OFFSET $4`,[status||null,customer_code||null,Number(limit),Number(offset)]);
    res.json({items:rows.rows});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});

app.get("/api/wms/outbound-orders/:id", requirePermission("wms.view"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const order=await client.query("SELECT * FROM wms_outbound_orders WHERE id=$1",[req.params.id]);
    if(!order.rows[0])return res.status(404).json(errorEnvelope("NOT_FOUND","Outbound order not found"));
    const items=await client.query("SELECT * FROM wms_outbound_items WHERE outbound_order_id=$1 ORDER BY id",[req.params.id]);
    res.json({...order.rows[0],items:items.rows});
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
  finally { client.release(); }
});
}
