// QMS Phase 3 — ISO文件/审核/客诉/供应商评价/质量成本 (Postgres port).
//
// WHY THIS FILE EXISTS. The original block in server.js was carried over
// verbatim from the MySQL reference system: `?` placeholders were fine
// (server.js's query wrapper normalizes them) but the column names, the
// `result.insertId` reads, the `const [row] = await query(...)` destructuring
// (query returns { rows, fields }, not [rows][0]), `res.json(rows)` leaking
// that envelope, `u.name` (users has display_name), and `TIMESTAMPDIFF` were
// all MySQL-only. Every Phase-3 endpoint 500'd. Migration 203 is the schema
// source of truth; migration 396 adds the handful of columns the five pages
// (QmsDocuments/QmsAudits/QmsComplaints/QmsSupplierEval/QmsQualityCosts.tsx)
// need that 203 never defined. The SELECT aliases below map 203's names onto
// the pages' field contract, so the pages work unchanged.
//
// Mounting: registerQmsPhase3Routes(api, deps) is called from server.js at
// the line the extracted block used to occupy — on the `api` router, which
// carries the router-wide authenticateJWT gate (server.js api.use(...)).
// Same auth posture as the original block: JWT required, no per-route
// permission guards.
//
// Route order: literal paths (/stats, /suppliers, /summary) are registered
// BEFORE their /:id siblings — the original block registered them after, so
// GET /qms/complaints/stats was swallowed by /:id with id='stats'.

export function registerQmsPhase3Routes(app, deps) {
  const { query, errorEnvelope } = deps;

  const num = (v) => Number(v) || 0;
  // The five pages all send factory_id=1 (a MySQL-era artifact); the PG rows
  // use the string code 'VN_RUIJING'. Treat numeric/absent as "no filter".
  const normFactory = (v) => {
    const s = String(v ?? "").trim();
    if (!s || /^\d+$/.test(s)) return null;
    return s;
  };
  const factoryFilter = (raw, col, params) => {
    const f = normFactory(raw);
    if (!f) return "";
    params.push(f);
    return ` AND ${col} = ?`;
  };
  const insertFactory = (raw) => (normFactory(raw) ? String(raw) : "VN_RUIJING");

  const one = async (sql, params) => (await query(sql, params)).rows[0] ?? null;
  const all = async (sql, params) => (await query(sql, params)).rows;

  // ─── ISO文档管理 ───────────────────────────────────────────────
  // page contract: title/category/version/file_url/status/uploader_name/approver_name
  const DOC_SELECT = `
    SELECT d.*, d.doc_title AS title, d.doc_type AS category,
           d.revision AS version, d.file_path AS file_url,
           COALESCE(ua.display_name, d.author) AS uploader_name,
           COALESCE(d.approved_by, '') AS approver_name
      FROM qms_documents d
      LEFT JOIN users ua ON ua.id = d.uploaded_by`;

  app.get('/qms/documents', async (req, res) => {
    try {
      const { category, status, factory_id } = req.query;
      let sql = `${DOC_SELECT} WHERE 1=1`;
      const params = [];
      if (category) { sql += ` AND d.doc_type = ?`; params.push(category); }
      if (status) { sql += ` AND d.status = ?`; params.push(status); }
      sql += factoryFilter(factory_id, 'd.factory_id', params);
      sql += ` ORDER BY d.created_at DESC`;
      res.json((await query(sql, params)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/documents/:id', async (req, res) => {
    try {
      const row = await one(`${DOC_SELECT} WHERE d.id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/qms/documents', async (req, res) => {
    try {
      const { title, category, version, file_url, status = 'draft', factory_id } = req.body;
      const docNo = `DOC-${String(await one(`SELECT nextval('qms_doc_seq') AS v`, []).then(r => r.v)).padStart(4, '0')}`;
      const row = await one(
        `INSERT INTO qms_documents (doc_no, doc_title, doc_type, revision, file_path, status, uploaded_by, factory_id)
         VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
        [docNo, title || docNo, category || 'SOP', version || 'A', file_url || null, status, req.user?.userId ?? null, insertFactory(factory_id)]);
      res.json(await one(`${DOC_SELECT} WHERE d.id = ?`, [row.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/documents/:id', async (req, res) => {
    try {
      const { title, category, version, file_url, status } = req.body;
      await query(
        `UPDATE qms_documents
            SET doc_title = COALESCE(?, doc_title), doc_type = COALESCE(?, doc_type),
                revision = COALESCE(?, revision), file_path = COALESCE(?, file_path),
                status = COALESCE(?, status), updated_at = NOW()
          WHERE id = ?`,
        [title ?? null, category ?? null, version ?? null, file_url ?? null, status ?? null, req.params.id]);
      res.json(await one(`${DOC_SELECT} WHERE d.id = ?`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/documents/:id/approve', async (req, res) => {
    try {
      const who = await one(`SELECT display_name FROM users WHERE id = ?`, [req.user?.userId ?? 0]);
      await query(
        `UPDATE qms_documents SET status = 'active', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [who?.display_name || String(req.user?.username ?? ''), req.params.id]);
      res.json(await one(`${DOC_SELECT} WHERE d.id = ?`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/qms/documents/:id', async (req, res) => {
    try {
      await query(`DELETE FROM qms_documents WHERE id = ?`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── 审核管理 ───────────────────────────────────────────────────
  // page contract: title/type/standard/scheduled_date/auditor_name/assignee_name/
  //                 status/planned start·complete timestamps
  const AUDIT_SELECT = `
    SELECT a.*, a.audit_type AS type, a.iso_standard AS standard,
           a.planned_date AS scheduled_date,
           COALESCE(ua.display_name, a.lead_auditor) AS auditor_name,
           usg.display_name AS assignee_name
      FROM qms_audits a
      LEFT JOIN users ua ON ua.id = a.auditor_id
      LEFT JOIN users usg ON usg.id = a.assignee_id`;

  // findings live in qms_audit_nc; page names: description/category/resolution
  const FINDING_SELECT = `
    SELECT f.*, f.finding AS description, f.clause AS category,
           f.corrective_action AS resolution, u.display_name AS raised_by_name
      FROM qms_audit_nc f
      LEFT JOIN users u ON u.id = f.raised_by`;

  app.get('/qms/audits', async (req, res) => {
    try {
      const { type, status, factory_id } = req.query;
      let sql = `${AUDIT_SELECT} WHERE 1=1`;
      const params = [];
      if (type) { sql += ` AND a.audit_type = ?`; params.push(type); }
      if (status) { sql += ` AND a.status = ?`; params.push(status); }
      sql += factoryFilter(factory_id, 'a.factory_id', params);
      sql += ` ORDER BY a.planned_date DESC NULLS LAST`;
      res.json((await query(sql, params)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/audits/:id', async (req, res) => {
    try {
      const row = await one(`${AUDIT_SELECT} WHERE a.id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/qms/audits', async (req, res) => {
    try {
      const { title, type = 'internal', scope, standard, scheduled_date, auditor_id, assignee_id, factory_id } = req.body;
      const auditNo = `AUD-${String((await one(`SELECT nextval('qms_audit_seq') AS v`, [])).v).padStart(4, '0')}`;
      const row = await one(
        `INSERT INTO qms_audits (audit_no, audit_type, iso_standard, title, scope, planned_date, auditor_id, assignee_id, status, factory_id)
         VALUES (?,?,?,?,?,?,?,?, 'planned', ?) RETURNING id`,
        [auditNo, type, standard || null, title || auditNo, scope || null, scheduled_date || null,
         auditor_id ?? null, assignee_id ?? null, insertFactory(factory_id)]);
      res.json(await one(`${AUDIT_SELECT} WHERE a.id = ?`, [row.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/audits/:id', async (req, res) => {
    try {
      const { title, type, scope, standard, scheduled_date, auditor_id, assignee_id } = req.body;
      await query(
        `UPDATE qms_audits
            SET title = COALESCE(?, title), audit_type = COALESCE(?, audit_type),
                scope = COALESCE(?, scope), iso_standard = COALESCE(?, iso_standard),
                planned_date = COALESCE(?, planned_date),
                auditor_id = COALESCE(?, auditor_id), assignee_id = COALESCE(?, assignee_id),
                updated_at = NOW()
          WHERE id = ?`,
        [title ?? null, type ?? null, scope ?? null, standard ?? null, scheduled_date ?? null,
         auditor_id ?? null, assignee_id ?? null, req.params.id]);
      res.json(await one(`${AUDIT_SELECT} WHERE a.id = ?`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/audits/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      await query(
        `UPDATE qms_audits
            SET status = ?,
                started_at   = CASE WHEN ? = 'in_progress' THEN COALESCE(started_at, NOW())   ELSE started_at   END,
                completed_at = CASE WHEN ? = 'completed'   THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
                actual_date  = CASE WHEN ? = 'completed'   THEN CURRENT_DATE ELSE actual_date END,
                updated_at   = NOW()
          WHERE id = ?`,
        [status, status, status, status, req.params.id]);
      res.json(await one(`${AUDIT_SELECT} WHERE a.id = ?`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/audits/:id/findings', async (req, res) => {
    try {
      res.json(await all(`${FINDING_SELECT} WHERE f.audit_id = ? ORDER BY f.created_at DESC`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/qms/audits/:id/findings', async (req, res) => {
    try {
      const { description, severity = 'minor', category, due_date } = req.body;
      const row = await one(
        `INSERT INTO qms_audit_nc (audit_id, severity, clause, finding, due_date, status, raised_by)
         VALUES (?,?,?,?,?, 'open', ?) RETURNING id`,
        [req.params.id, severity, category || null, description || '', due_date || null, req.user?.userId ?? null]);
      res.json(await one(`${FINDING_SELECT} WHERE f.id = ?`, [row.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/audits/findings/:fid/status', async (req, res) => {
    try {
      const { status, resolution } = req.body;
      await query(
        `UPDATE qms_audit_nc
            SET status = ?,
                corrective_action = COALESCE(?, corrective_action),
                verified_by = CASE WHEN ? IN ('closed','verified') THEN COALESCE(verified_by, ?::text) ELSE verified_by END,
                verified_at = CASE WHEN ? IN ('closed','verified') THEN COALESCE(verified_at, NOW()) ELSE verified_at END
          WHERE id = ?`,
        [status, resolution ?? null, status, req.user?.userId ?? null, status, req.params.fid]);
      res.json(await one(`${FINDING_SELECT} WHERE f.id = ?`, [req.params.fid]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── 客户投诉 ───────────────────────────────────────────────────
  // page contract: customer/product/quantity/priority/defect_desc/root_cause/
  //                corrective_action/preventive_action/creator_name
  const COMPLAINT_SELECT = `
    SELECT c.*, c.customer_name AS customer, c.product_name AS product,
           c.defect_qty AS quantity, LOWER(c.severity) AS priority,
           u.display_name AS creator_name
      FROM qms_complaints c
      LEFT JOIN users u ON u.id = c.created_by`;

  // stats before /:id — the original order let /:id swallow /stats
  app.get('/qms/complaints/stats', async (req, res) => {
    try {
      const row = await one(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open,
                COUNT(*) FILTER (WHERE LOWER(severity) IN ('high','critical') AND status NOT IN ('resolved','closed'))::int AS "highPriority",
                COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400)
                  FILTER (WHERE status IN ('resolved','closed') AND resolved_at IS NOT NULL)), 0)::int AS "avgResolutionDays"
           FROM qms_complaints`);
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/complaints', async (req, res) => {
    try {
      const { status, priority, factory_id } = req.query;
      let sql = `${COMPLAINT_SELECT} WHERE 1=1`;
      const params = [];
      if (status) { sql += ` AND c.status = ?`; params.push(status); }
      if (priority) { sql += ` AND LOWER(c.severity) = ?`; params.push(String(priority).toLowerCase()); }
      sql += factoryFilter(factory_id, 'c.factory_id', params);
      sql += ` ORDER BY c.created_at DESC`;
      res.json((await query(sql, params)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/complaints/:id/responses', async (req, res) => {
    try {
      res.json(await all(
        `SELECT r.*, u.display_name AS respondent_name
           FROM qms_complaint_responses r
           LEFT JOIN users u ON u.id = r.respondent_id
          WHERE r.complaint_id = ? ORDER BY r.created_at ASC`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/complaints/:id/respond', async (req, res) => {
    try {
      const { response_text } = req.body;
      const row = await one(
        `INSERT INTO qms_complaint_responses (complaint_id, respondent_id, response_text)
         VALUES (?,?,?) RETURNING id`,
        [req.params.id, req.user?.userId ?? null, response_text || '']);
      res.json(await one(
        `SELECT r.*, u.display_name AS respondent_name
           FROM qms_complaint_responses r LEFT JOIN users u ON u.id = r.respondent_id WHERE r.id = ?`, [row.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/complaints/:id', async (req, res) => {
    try {
      const row = await one(`${COMPLAINT_SELECT} WHERE c.id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/qms/complaints', async (req, res) => {
    try {
      const { complaint_no, customer, product, quantity, defect_desc, priority = 'medium', defect_images, factory_id } = req.body;
      const no = complaint_no || `CMP-${String((await one(`SELECT nextval('qms_complaint_seq') AS v`, [])).v).padStart(4, '0')}`;
      const row = await one(
        `INSERT INTO qms_complaints (complaint_no, customer_name, product_name, defect_qty, defect_desc,
                                     severity, defect_images, status, created_by, factory_id)
         VALUES (?,?,?,?,?,?,?, 'received', ?, ?) RETURNING id`,
        [no, customer || null, product || null, num(quantity), defect_desc || '',
         String(priority).toUpperCase(), defect_images || null, req.user?.userId ?? null, insertFactory(factory_id)]);
      res.json(await one(`${COMPLAINT_SELECT} WHERE c.id = ?`, [row.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/complaints/:id', async (req, res) => {
    try {
      const { root_cause, corrective_action, preventive_action, status } = req.body;
      await query(
        `UPDATE qms_complaints
            SET root_cause = COALESCE(?, root_cause), corrective_action = COALESCE(?, corrective_action),
                preventive_action = COALESCE(?, preventive_action), status = COALESCE(?, status),
                resolved_at = CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
                updated_at = NOW()
          WHERE id = ?`,
        [root_cause ?? null, corrective_action ?? null, preventive_action ?? null, status ?? null, status ?? '', req.params.id]);
      res.json(await one(`${COMPLAINT_SELECT} WHERE c.id = ?`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── 供应商评价 ─────────────────────────────────────────────────
  // page contract: supplier_id/supplier_name/evaluation_date/quality_score/
  //                delivery_score/service_score/communication_score/
  //                overall_score/grade/remarks/evaluator_name
  const EVAL_SELECT = `
    SELECT e.*, u.display_name AS evaluator_name,
           COALESCE(NULLIF(e.supplier_name,''), s.name_zh, e.supplier_code) AS supplier_name_from
      FROM qms_supplier_eval e
      LEFT JOIN users u ON u.id = e.evaluated_by
      LEFT JOIN suppliers s ON s.id = e.supplier_id`;

  // NUMERIC columns arrive as strings (pg keeps precision) and the supplier
  // name lives on the join, not the row; the pages read both as numbers /
  // a single name field, so coerce here. Accepts a row or a row list.
  const mapEval = (rows) => {
    const single = !Array.isArray(rows);
    const mapped = (single ? [rows] : rows).map((row) => row && ({
      ...row,
      supplier_name: row.supplier_name_from ?? row.supplier_name,
      quality_score: num(row.quality_score), delivery_score: num(row.delivery_score),
      service_score: num(row.service_score), communication_score: num(row.communication_score),
      overall_score: num(row.overall_score), total_score: num(row.total_score),
    }));
    return single ? mapped[0] : mapped;
  };

  app.get('/qms/supplier-evaluations/stats', async (req, res) => {
    try {
      const totals = await one(
        `SELECT COUNT(DISTINCT supplier_id)::int AS "totalSuppliers",
                COALESCE(ROUND(AVG(overall_score) * 10) / 10, 0)::float8 AS "avgOverallScore"
           FROM qms_supplier_eval`);
      const gradeDistribution = await all(
        `SELECT grade, COUNT(*)::int AS count FROM qms_supplier_eval
          WHERE grade IS NOT NULL GROUP BY grade ORDER BY count DESC`);
      res.json({ ...totals, gradeDistribution });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/supplier-evaluations/suppliers', async (req, res) => {
    try {
      res.json(await all(`SELECT id, COALESCE(NULLIF(name_zh,''), code) AS name FROM suppliers WHERE status = 'active' ORDER BY 2`));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/supplier-evaluations/history/:supplierId', async (req, res) => {
    try {
      res.json(mapEval(await all(`${EVAL_SELECT} WHERE e.supplier_id = ? ORDER BY e.evaluation_date DESC NULLS LAST LIMIT 12`, [req.params.supplierId])));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/supplier-evaluations', async (req, res) => {
    try {
      const { supplier_id, factory_id } = req.query;
      let sql = `${EVAL_SELECT} WHERE 1=1`;
      const params = [];
      if (supplier_id) { sql += ` AND e.supplier_id = ?`; params.push(supplier_id); }
      sql += factoryFilter(factory_id, 'e.factory_id', params);
      sql += ` ORDER BY e.evaluation_date DESC NULLS LAST, e.created_at DESC`;
      res.json(mapEval((await query(sql, params)).rows));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/supplier-evaluations/:id', async (req, res) => {
    try {
      const row = await one(`${EVAL_SELECT} WHERE e.id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(mapEval(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/qms/supplier-evaluations', async (req, res) => {
    try {
      const { supplier_id, evaluation_date, quality_score, delivery_score, service_score,
              communication_score, overall_score, grade, remarks, factory_id } = req.body;
      // eval_period + supplier_code are the 203 NOT NULL identity columns;
      // derive both from the page's supplier_id/date so the row is also
      // readable by anything built against the original schema.
      const sup = await one(`SELECT code, COALESCE(NULLIF(name_zh,''), code) AS name FROM suppliers WHERE id = ?`, [supplier_id]);
      const d = evaluation_date ? new Date(evaluation_date) : new Date();
      const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = await one(
        `INSERT INTO qms_supplier_eval
           (supplier_code, supplier_name, eval_period, supplier_id, evaluation_date,
            quality_score, delivery_score, service_score, communication_score,
            total_score, overall_score, grade, remarks, evaluated_by, factory_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        [sup?.code || `SUP-${supplier_id}`, sup?.name || null, period, supplier_id ?? null, evaluation_date || null,
         num(quality_score), num(delivery_score), num(service_score), num(communication_score),
         num(overall_score), num(overall_score), grade || null, remarks || null,
         req.user?.userId ?? null, insertFactory(factory_id)]);
      res.json(mapEval(await one(`${EVAL_SELECT} WHERE e.id = ?`, [row.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/supplier-evaluations/:id', async (req, res) => {
    try {
      const { evaluation_date, quality_score, delivery_score, service_score, communication_score, overall_score, grade, remarks } = req.body;
      await query(
        `UPDATE qms_supplier_eval
            SET evaluation_date = COALESCE(?, evaluation_date),
                quality_score = COALESCE(?, quality_score), delivery_score = COALESCE(?, delivery_score),
                service_score = COALESCE(?, service_score), communication_score = COALESCE(?, communication_score),
                overall_score = COALESCE(?, overall_score), total_score = COALESCE(?, overall_score),
                grade = COALESCE(?, grade), remarks = COALESCE(?, remarks), updated_at = NOW()
          WHERE id = ?`,
        [evaluation_date ?? null, quality_score ?? null, delivery_score ?? null, service_score ?? null,
         communication_score ?? null, overall_score ?? null, overall_score ?? null, grade ?? null, remarks ?? null, req.params.id]);
      res.json(mapEval(await one(`${EVAL_SELECT} WHERE e.id = ?`, [req.params.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── 质量成本 ───────────────────────────────────────────────────
  // page contract: cost_type = the four PAF categories (stored in 203's
  // cost_category), category = free-text subcategory (stored in cost_type),
  // related_order_no = wo_code, recorder_name via recorded_by.
  // cost_date/amount are NUMERIC/DATE — pg hands NUMERIC back as strings,
  // and the page's formatCurrency calls amount.toLocaleString(), which only
  // formats real numbers. Cast so the wire shape matches the page.
  const COST_SELECT = `
    SELECT c.*, c.amount::float8 AS amount, c.cost_category AS cost_type, c.cost_type AS category,
           c.wo_code AS related_order_no, u.display_name AS recorder_name
      FROM qms_quality_costs c
      LEFT JOIN users u ON u.id = c.recorded_by`;

  app.get('/qms/quality-costs/summary', async (req, res) => {
    try {
      const { factory_id, start_date, end_date } = req.query;
      let where = `WHERE 1=1`;
      const params = [];
      where += factoryFilter(factory_id, 'factory_id', params);
      if (start_date) { where += ` AND cost_date >= ?`; params.push(start_date); }
      if (end_date) { where += ` AND cost_date <= ?`; params.push(end_date); }
      const byType = await all(
        `SELECT cost_category AS cost_type, COALESCE(SUM(amount),0)::float8 AS total, COUNT(*)::int AS count
           FROM qms_quality_costs ${where} GROUP BY cost_category ORDER BY 2 DESC`, params);
      const totals = await one(
        `SELECT COALESCE(SUM(amount),0)::float8 AS "grandTotal" FROM qms_quality_costs ${where}`, params);
      res.json({ byType, grandTotal: totals.grandTotal });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/quality-costs', async (req, res) => {
    try {
      const { cost_type, factory_id, start_date, end_date } = req.query;
      let sql = `${COST_SELECT} WHERE 1=1`;
      const params = [];
      if (cost_type) { sql += ` AND c.cost_category = ?`; params.push(cost_type); }
      sql += factoryFilter(factory_id, 'c.factory_id', params);
      if (start_date) { sql += ` AND c.cost_date >= ?`; params.push(start_date); }
      if (end_date) { sql += ` AND c.cost_date <= ?`; params.push(end_date); }
      sql += ` ORDER BY c.cost_date DESC NULLS LAST, c.created_at DESC`;
      res.json((await query(sql, params)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/qms/quality-costs/:id', async (req, res) => {
    try {
      const row = await one(`${COST_SELECT} WHERE c.id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/qms/quality-costs', async (req, res) => {
    try {
      const { cost_type, category, amount, currency = 'VND', cost_date, description, related_order_no, factory_id } = req.body;
      const d = cost_date ? new Date(cost_date) : new Date();
      const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = await one(
        `INSERT INTO qms_quality_costs
           (cost_period, cost_category, cost_type, wo_code, amount, currency, cost_date, description, recorded_by, factory_id)
         VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        [period, cost_type || 'internal_failure', category || null, related_order_no || null,
         num(amount), currency, cost_date || null, description || null, req.user?.userId ?? null, insertFactory(factory_id)]);
      res.json(await one(`${COST_SELECT} WHERE c.id = ?`, [row.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/qms/quality-costs/:id', async (req, res) => {
    try {
      const { cost_type, category, amount, currency, cost_date, description, related_order_no } = req.body;
      await query(
        `UPDATE qms_quality_costs
            SET cost_category = COALESCE(?, cost_category), cost_type = COALESCE(?, cost_type),
                amount = COALESCE(?, amount), currency = COALESCE(?, currency),
                cost_date = COALESCE(?, cost_date), description = COALESCE(?, description),
                wo_code = COALESCE(?, wo_code)
          WHERE id = ?`,
        [cost_type ?? null, category ?? null, amount ?? null, currency ?? null, cost_date ?? null,
         description ?? null, related_order_no ?? null, req.params.id]);
      res.json(await one(`${COST_SELECT} WHERE c.id = ?`, [req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
