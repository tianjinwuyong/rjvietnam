// WMS receiving and incoming IQC (/api/wms/incoming, /api/wms/iqc/*), moved out of
// services/api/server.js.
//
// 14 registrations: the receiving transaction (create, list, detail, amend) and the
// inspection that follows it -- rule and sampling-plan lookups, inspection creation with
// the derived sample size, defect capture, completion with the AQL verdict and the
// supplier-debt settlement, and the two-stage special-approval chain.
//
// NOTE, unfixed here: these handlers were written against a MySQL client and run on a
// node-postgres pool. `const [rows] = await client.query(...)` destructures a pg Result
// (not iterable), `?` placeholders are taken literally by pg, and `rows.insertId` does not
// exist in pg. /api/wms/incoming and /api/wms/iqc/rules answer 404-shaped errors at
// runtime for that reason -- the routes register and dispatch, the SQL never runs.
export function registerWmsReceivingIqcRoutes(app, deps) {
  const { getClient, requirePermission, query, settleDebtOnReceipt, publishSupplierIqcResult } = deps;

app.post("/api/wms/incoming", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const {
      lot_no, material_code, material_name, supplier_code, supplier_name,
      po_no, delivery_note_no, invoice_no, received_qty, uom_code,
      received_at, packaging_status, msd_level, expiry_date, operator_id, attachments
    } = req.body;
    if (!lot_no || !material_code || !supplier_code) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "lot_no, material_code, supplier_code required" });
    }
    const [rows] = await client.query(
      `INSERT INTO wms_incoming_records
        (lot_no,material_code,material_name,supplier_code,supplier_name,po_no,delivery_note_no,invoice_no,
         received_qty,uom_code,received_at,packaging_status,msd_level,expiry_date,operator_id,attachments)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [lot_no,material_code,material_name||null,supplier_code,supplier_name||null,po_no||null,delivery_note_no||null,
       invoice_no||null,received_qty||0,uom_code||'PCS',received_at||null,packaging_status||'good',msd_level||null,
       expiry_date||null,operator_id||null,attachments?JSON.stringify(attachments):null]
    );
    const [rec] = await client.query("SELECT * FROM wms_incoming_records WHERE id=?", [rows.insertId]);
    res.status(201).json(rec[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.get("/api/wms/incoming", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const { limit=50, offset=0, lot_no, material_code, supplier_code, iqc_status, packaging_status,
            date_from, date_to } = req.query;
    let where = [];
    let params = [];
    if (lot_no) { where.push("lot_no LIKE ?"); params.push("%"+lot_no+"%"); }
    if (material_code) { where.push("material_code LIKE ?"); params.push("%"+material_code+"%"); }
    if (supplier_code) { where.push("supplier_code LIKE ?"); params.push("%"+supplier_code+"%"); }
    if (iqc_status) { where.push("iqc_status=?"); params.push(iqc_status); }
    if (packaging_status) { where.push("packaging_status=?"); params.push(packaging_status); }
    if (date_from) { where.push("received_at >= ?"); params.push(date_from); }
    if (date_to) { where.push("received_at <= ?"); params.push(date_to); }
    const whereStr = where.length ? "WHERE " + where.join(" AND ") : "";
    const [countRows] = await client.query(`SELECT COUNT(*) as total FROM wms_incoming_records ${whereStr}`, params);
    const [rows] = await client.query(
      `SELECT * FROM wms_incoming_records ${whereStr} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json({ items: rows, total: countRows[0].total, offset: parseInt(offset), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.get("/api/wms/incoming/:id", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const [rows] = await client.query("SELECT * FROM wms_incoming_records WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.put("/api/wms/incoming/:id", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const fields = [];
    const vals = [];
    const allowed = ['lot_no','material_code','material_name','supplier_code','supplier_name','po_no',
      'delivery_note_no','invoice_no','received_qty','uom_code','received_at','packaging_status',
      'msd_level','expiry_date','operator_id','iqc_status','attachments'];
    for (const k of allowed) {
      if (k in req.body) {
        fields.push(k+"=?");
        vals.push(k==='attachments'?JSON.stringify(req.body[k]):req.body[k]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: "NO_FIELDS" });
    vals.push(req.params.id);
    await client.query(`UPDATE wms_incoming_records SET ${fields.join(',')} WHERE id=?`, vals);
    const [rows] = await client.query("SELECT * FROM wms_incoming_records WHERE id=?", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

// ── WMS IQC 来料检验 ─────────────────────────────────────────────────────────

app.get("/api/wms/iqc/rules", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const [rows] = await client.query("SELECT * FROM iqc_aql_rules WHERE active=1 ORDER BY material_category, supplier_grade");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "SERVER_ERROR", message: err.message }); }
  finally { client.release(); }
});

app.get("/api/wms/iqc/sampling-plans", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const { aql_level } = req.query;
    let sql = "SELECT * FROM iqc_sampling_plans";
    let params = [];
    if (aql_level) { sql += " WHERE aql_level=?"; params.push(aql_level); }
    sql += " ORDER BY batch_size_min";
    const [rows] = await client.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "SERVER_ERROR", message: err.message }); }
  finally { client.release(); }
});

app.post("/api/wms/iqc/inspections", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { incoming_record_id, lot_no, material_code, supplier_code, batch_size, inspector_id, inspection_types } = req.body;
    if (!incoming_record_id || !lot_no || !batch_size) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "incoming_record_id, lot_no, batch_size required" });
    }
    // 查 AQL 规则（默认 1.0）
    const [rules] = await client.query("SELECT * FROM iqc_aql_rules WHERE active=1 LIMIT 1");
    const aqlLevel = rules.length ? rules[0].aql_critical || '1.0' : '1.0';
    // 查抽样计划
    const [plans] = await client.query(
      "SELECT * FROM iqc_sampling_plans WHERE batch_size_min<=? AND batch_size_max>=? AND aql_level=? LIMIT 1",
      [batch_size, batch_size, aqlLevel]
    );
    let sample_size = 0, ac_c=1, re_c=2, ac_m=2, re_m=3, ac_min=3, re_min=4;
    if (plans.length) {
      sample_size = plans[0].sample_size;
      ac_c = plans[0].ac_critical; re_c = plans[0].re_critical;
      ac_m = plans[0].ac_major; re_m = plans[0].re_major;
      ac_min = plans[0].ac_minor; re_min = plans[0].re_minor;
    }
    const [rows] = await client.query(
      `INSERT INTO iqc_inspections
        (incoming_record_id,lot_no,material_code,supplier_code,batch_size,sample_size,aql_level,
         ac_critical,re_critical,ac_major,re_major,ac_minor,re_minor,inspector_id,inspection_types,submitted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [incoming_record_id,lot_no,material_code||'',supplier_code||'',batch_size,sample_size,aqlLevel,
       ac_c,re_c,ac_m,re_m,ac_min,re_min,inspector_id||null,inspection_types?JSON.stringify(inspection_types):null]
    );
    // 更新来料记录状态为已送检
    await client.query("UPDATE wms_incoming_records SET iqc_status='submitted' WHERE id=?", [incoming_record_id]);
    const [rec] = await client.query("SELECT * FROM iqc_inspections WHERE id=?", [rows.insertId]);
    res.status(201).json(rec[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.get("/api/wms/iqc/inspections", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const { limit=50, offset=0, result, date_from, date_to, supplier_code } = req.query;
    let where = [];
    let params = [];
    if (result) { where.push("result=?"); params.push(result); }
    if (date_from) { where.push("submitted_at >= ?"); params.push(date_from); }
    if (date_to) { where.push("submitted_at <= ?"); params.push(date_to); }
    if (supplier_code) { where.push("supplier_code LIKE ?"); params.push("%"+supplier_code+"%"); }
    const whereStr = where.length ? "WHERE " + where.join(" AND ") : "";
    const [countRows] = await client.query(`SELECT COUNT(*) as total FROM iqc_inspections ${whereStr}`, params);
    const [rows] = await client.query(
      `SELECT * FROM iqc_inspections ${whereStr} ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json({ items: rows, total: countRows[0].total, offset: parseInt(offset), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.get("/api/wms/iqc/inspections/:id", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const [rows] = await client.query("SELECT * FROM iqc_inspections WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
    const [defects] = await client.query("SELECT * FROM iqc_defect_records WHERE inspection_id=?", [req.params.id]);
    const inspection = rows[0];
    inspection.defects = defects;
    res.json(inspection);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.post("/api/wms/iqc/inspections/:id/defects", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { defect_type, defect_location, defect_count, severity, photo_url } = req.body;
    if (!defect_type || !defect_count) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "defect_type and defect_count required" });
    }
    const [rows] = await client.query(
      `INSERT INTO iqc_defect_records (inspection_id,defect_type,defect_location,defect_count,severity,photo_url)
       VALUES (?,?,?,?,?,?)`,
      [req.params.id, defect_type, defect_location||null, defect_count, severity||'major', photo_url||null]
    );
    const [rec] = await client.query("SELECT * FROM iqc_defect_records WHERE id=?", [rows.insertId]);
    res.status(201).json(rec[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.post("/api/wms/iqc/inspections/:id/complete", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    // 查送检记录
    const [insp] = await client.query("SELECT * FROM iqc_inspections WHERE id=?", [req.params.id]);
    if (!insp.length) return res.status(404).json({ error: "NOT_FOUND" });
    const i = insp[0];
    // 汇总不良数
    const [defects] = await client.query(
      "SELECT severity, SUM(defect_count) as total FROM iqc_defect_records WHERE inspection_id=? GROUP BY severity",
      [req.params.id]
    );
    const [defectDetails] = await client.query(
      "SELECT defect_type,defect_location,defect_count,severity,photo_url FROM iqc_defect_records WHERE inspection_id=? ORDER BY id",
      [req.params.id]
    );
    let dc = { critical: 0, major: 0, minor: 0 };
    for (const d of defects) dc[d.severity] = parseInt(d.total) || 0;
    // AQL 判定
    let result = 'pass';
    if (dc.critical > i.re_critical || dc.major > i.re_major || dc.minor > i.re_minor) result = 'fail';
    else if ((dc.critical >= i.ac_critical && dc.critical < i.re_critical) ||
             (dc.major >= i.ac_major && dc.major < i.re_major) ||
             (dc.minor >= i.ac_minor && dc.minor < i.re_minor)) result = 'conditional_pass';
    // 更新送检记录
    await client.query(
      "UPDATE iqc_inspections SET result=?, completed_at=NOW() WHERE id=?",
      [result, req.params.id]
    );
    // 更新来料记录状态
    const incoming_status = result === 'pass' ? 'approved' : (result === 'conditional_pass' ? 'pending' : 'pending');
    await client.query("UPDATE wms_incoming_records SET iqc_status=? WHERE id=?", [incoming_status, i.incoming_record_id]);
    // Reference WMS: an IQC pass on a receipt clears any pending supplier debt
    // for this supplier+material (idempotent per debt/receipt pair).
    if (result === 'pass' && i.supplier_code && i.material_code) {
      try {
        const sup = (await query(`SELECT id FROM suppliers WHERE code=$1 LIMIT 1`, [i.supplier_code])).rows[0]?.id;
        const mat = (await query(`SELECT id FROM materials WHERE code=$1 LIMIT 1`, [i.material_code])).rows[0]?.id;
        if (sup && mat) {
          await settleDebtOnReceipt({
            supplierId: sup, materialId: mat, qty: i.batch_size || i.quantity || 0,
            receiptId: i.incoming_record_id, receiptNo: `IQC-${req.params.id}`,
            result: 'pass', userId: req.user?.userId,
          });
        }
      } catch (debtErr) { console.error('settleDebtOnReceipt failed:', debtErr.message); }
    }
    const [updated] = await client.query("SELECT * FROM iqc_inspections WHERE id=?", [req.params.id]);
    const ngQuantity=defectDetails.reduce((sum,row)=>sum+Number(row.defect_count||0),0);
    const supplierCommunication=await publishSupplierIqcResult({
      lotNo:i.lot_no,materialCode:i.material_code,supplierCode:i.supplier_code,
      quantity:Number(i.batch_size||0),expectedQuantity:Number(i.batch_size||0),receivedQuantity:Number(i.batch_size||0),
      passedQuantity:Math.max(0,Number(i.batch_size||0)-ngQuantity),ngQuantity,
      result:result==='pass'?'PASS':result==='conditional_pass'?'HOLD':'FAIL',
      reason:defectDetails.map(row=>[row.defect_type,row.defect_location,row.severity].filter(Boolean).join(" / ")).join("; "),
      evidenceImages:defectDetails.map(row=>row.photo_url).filter(Boolean),
      documentNo:"IQC-"+req.params.id,inspector:i.inspector_id||req.user?.username||'iqc'
    },req).catch(error=>({synced:false,error:error.message}));
    res.json({ ...updated[0], defects_summary: dc, supplierCommunication });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

// 特采审批
app.post("/api/wms/iqc/special-approvals", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { inspection_id, applicant_id, reason } = req.body;
    if (!inspection_id || !applicant_id) return res.status(400).json({ error: "MISSING_FIELDS" });
    const [rows] = await client.query(
      `INSERT INTO iqc_special_approvals (inspection_id,applicant_id,reason,submitted_at)
       VALUES (?,?,?,NOW())`,
      [inspection_id, applicant_id, reason||null]
    );
    const [rec] = await client.query("SELECT * FROM iqc_special_approvals WHERE id=?", [rows.insertId]);
    res.status(201).json(rec[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.patch("/api/wms/iqc/special-approvals/:id", requirePermission("wms.write"), async (req, res) => {
  const client = await getClient();
  try {
    const { status, approver_iqc_id, approver_engineering_id, notes } = req.body;
    const [rows] = await client.query("SELECT * FROM iqc_special_approvals WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
    const current = rows[0];
    let updates = [];
    let params = [];
    if (status) {
      if (status === 'approved' && current.status === 'pending_iqc') {
        updates.push("status='pending_engineering'"); updates.push("approver_iqc_id=?"); params.push(approver_iqc_id||null);
        updates.push("iqc_approved_at=NOW()");
      } else if (status === 'approved' && current.status === 'pending_engineering') {
        updates.push("status='approved'"); updates.push("approver_engineering_id=?"); params.push(approver_engineering_id||null);
        updates.push("engineering_approved_at=NOW()");
        // 特采通过，同步更新来料记录
        await client.query("UPDATE wms_incoming_records SET iqc_status='approved' WHERE id=(SELECT incoming_record_id FROM iqc_inspections WHERE id=(SELECT inspection_id FROM iqc_special_approvals WHERE id=?))", [req.params.id]);
      } else if (status === 'rejected') {
        updates.push("status='rejected'");
      }
    }
    if (notes !== undefined) { updates.push("notes=?"); params.push(notes); }
    if (!updates.length) return res.status(400).json({ error: "NO_UPDATES" });
    params.push(req.params.id);
    await client.query(`UPDATE iqc_special_approvals SET ${updates.join(',')} WHERE id=?`, params);
    const [updated] = await client.query("SELECT * FROM iqc_special_approvals WHERE id=?", [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});

app.get("/api/wms/iqc/special-approvals", requirePermission("wms.read"), async (req, res) => {
  const client = await getClient();
  try {
    const { status } = req.query;
    let sql = `SELECT sa.*, i.lot_no, i.material_code, i.supplier_code
               FROM iqc_special_approvals sa
               JOIN iqc_inspections i ON i.id=sa.inspection_id`;
    let params = [];
    if (status) { sql += " WHERE sa.status=?"; params.push(status); }
    sql += " ORDER BY sa.submitted_at DESC";
    const [rows] = await client.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  } finally { client.release(); }
});
}
