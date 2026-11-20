// PDA app catalogue and per-user assignments (/pda/*), moved out of
// services/api/server.js.
//
// 10 registrations: the app catalogue CRUD, the per-user app assignment CRUD plus the
// "my apps" lookup, and the employee picker used by the assignment screen. Every route
// authenticates explicitly and then checks a pda.* permission.
//
// Pure registrations, no module-level statements in the block.
export function registerPdaRoutes(app, deps) {
  const { query, authenticateJWT, requirePermission, envelope, errorEnvelope, listEnvelope } = deps;

app.get("/pda/app-catalog", authenticateJWT, requirePermission("pda.view"), async (req, res) => {
  try {
    const { isActive, q, limit = 200, offset = 0 } = req.query;
    const conditions = [], params = [];
    let i = 1;
    if (isActive !== undefined) { conditions.push(`is_active = $${i++}`); params.push(isActive === 'true'); }
    if (q) { conditions.push(`(app_key ILIKE $${i} OR name_zh ILIKE $${i} OR name_en ILIKE $${i})`); i++; params.push(`%${q}%`); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const countR = await query(`SELECT COUNT(*)::int AS cnt FROM pda_app_catalog ${where}`, params);
    const dataR = await query(
      `SELECT id, app_key, name_zh, name_en, name_vi, description, icon, sort_order, is_active, created_at
       FROM pda_app_catalog ${where} ORDER BY sort_order, app_key LIMIT $${i++} OFFSET $${i}`,
      [...params, Number(limit), Number(offset)]
    );
    res.json(listEnvelope(dataR.rows, countR.rows[0].cnt));
  } catch (err) { console.error("GET /pda/app-catalog:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

app.post("/pda/app-catalog", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const { appKey, nameZh, nameEn, nameVi, description, icon, sortOrder } = req.body ?? {};
    if (!appKey || !nameZh) return res.status(400).json(errorEnvelope("VALIDATION", "appKey and nameZh are required"));
    const r = await query(
      `INSERT INTO pda_app_catalog (app_key, name_zh, name_en, name_vi, description, icon, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, app_key, name_zh, name_en, name_vi, description, icon, sort_order, is_active`,
      [appKey, nameZh, nameEn ?? '', nameVi ?? '', description ?? null, icon ?? null, Number(sortOrder ?? 0)]
    );
    res.status(201).json(envelope(r.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(errorEnvelope("DUPLICATE", `app_key '${req.body?.appKey}' already exists`));
    console.error("POST /pda/app-catalog:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.patch("/pda/app-catalog/:id", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const { nameZh, nameEn, nameVi, description, icon, sortOrder, isActive } = req.body ?? {};
    const sets = [], params = []; let i = 1;
    if (nameZh    !== undefined) { sets.push(`name_zh = $${i++}`);     params.push(nameZh); }
    if (nameEn    !== undefined) { sets.push(`name_en = $${i++}`);     params.push(nameEn); }
    if (nameVi    !== undefined) { sets.push(`name_vi = $${i++}`);     params.push(nameVi); }
    if (description !== undefined) { sets.push(`description = $${i++}`); params.push(description); }
    if (icon     !== undefined) { sets.push(`icon = $${i++}`);        params.push(icon); }
    if (sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); params.push(Number(sortOrder)); }
    if (isActive !== undefined)  { sets.push(`is_active = $${i++}`);  params.push(Boolean(isActive)); }
    if (!sets.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    params.push(req.params.id);
    const r = await query(
      `UPDATE pda_app_catalog SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, app_key, name_zh, name_en, name_vi, description, icon, sort_order, is_active`,
      params
    );
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "App not found"));
    res.json(envelope(r.rows[0]));
  } catch (err) { console.error("PATCH /pda/app-catalog/:id:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

app.delete("/pda/app-catalog/:id", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const r = await query(`DELETE FROM pda_app_catalog WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "App not found"));
    res.json(envelope({ deleted: true }));
  } catch (err) { console.error("DELETE /pda/app-catalog/:id:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

// ── PDA User App Assignments (pda_user_apps) ────────────────────────────────────
// GET  /pda/user-apps         — list all assignments (admin view)
// GET  /pda/user-apps/me      — current user's assigned apps (for PDA login)
// POST /pda/user-apps         — grant an app to a user
// PATCH/DELETE               — revoke

app.get("/pda/user-apps", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const { userId, appId, status, q, limit = 200, offset = 0 } = req.query;
    const conditions = [], params = [];
    let i = 1;
    if (userId)  { conditions.push(`ua.user_id = $${i++}`); params.push(Number(userId)); }
    if (appId)   { conditions.push(`ua.app_id = $${i++}`);  params.push(Number(appId)); }
    if (status) { conditions.push(`ua.status = $${i++}`);    params.push(status); }
    if (q) {
      conditions.push(`(e.display_name ILIKE $${i} OR e.code ILIKE $${i} OR ac.app_key ILIKE $${i} OR ac.name_zh ILIKE $${i})`);
      i++; params.push(`%${q}%`);
    }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const countR = await query(`SELECT COUNT(*)::int AS cnt FROM pda_user_apps ua JOIN employees e ON e.id=ua.user_id JOIN pda_app_catalog ac ON ac.id=ua.app_id ${where}`, params);
    const dataR = await query(
      `SELECT ua.id, ua.status, ua.granted_at, ua.expires_at, ua.notes,
              e.id AS user_id, e.code AS user_code, e.display_name AS user_name,
              ac.id AS app_id, ac.app_key, ac.name_zh AS app_name_zh, ac.name_en AS app_name_en
       FROM pda_user_apps ua
       JOIN employees e ON e.id=ua.user_id
       JOIN pda_app_catalog ac ON ac.id=ua.app_id
       ${where} ORDER BY ua.granted_at DESC LIMIT $${i++} OFFSET $${i}`,
      [...params, Number(limit), Number(offset)]
    );
    res.json(listEnvelope(dataR.rows, countR.rows[0].cnt));
  } catch (err) { console.error("GET /pda/user-apps:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

// Returns current user's assigned app keys — used by PDA at login
app.get("/pda/user-apps/me", authenticateJWT, requirePermission("pda.view"), async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Not authenticated"));
    // users has no employee_id column; the link is employees.user_id -> users.id.
    const empR = await query("SELECT id FROM employees WHERE user_id = $1", [userId]);
    const empId = empR.rows[0]?.id;
    if (!empId) return res.json(envelope({ apps: [], roleKey: req.user?.roleKey || "UNKNOWN" }));
    const appsR = await query(
      `SELECT ac.app_key, ac.name_zh, ac.name_en, ac.name_vi, ua.expires_at
       FROM pda_user_apps ua
       JOIN pda_app_catalog ac ON ac.id=ua.app_id
       WHERE ua.user_id=$1 AND ua.status='ACTIVE'
         AND (ua.expires_at IS NULL OR ua.expires_at > NOW())
       ORDER BY ac.sort_order`,
      [empId]
    );
    res.json(envelope({ apps: appsR.rows, roleKey: req.user?.roleKey || "UNKNOWN" }));
  } catch (err) { console.error("GET /pda/user-apps/me:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

app.post("/pda/user-apps", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const { userId, appId, expiresAt, notes } = req.body ?? {};
    if (!userId || !appId) return res.status(400).json(errorEnvelope("VALIDATION", "userId and appId are required"));
    // resolve userId (could be username string or employee id)
    let empId = Number(userId);
    if (isNaN(empId) || empId <= 0) {
      const empR = await query("SELECT id FROM employees WHERE code = $1 OR display_name = $1 LIMIT 1", [String(userId)]);
      if (!empR.rows.length) return res.status(404).json(errorEnvelope("USER_NOT_FOUND", `Employee '${userId}' not found`));
      empId = empR.rows[0].id;
    }
    const appR = await query("SELECT id FROM pda_app_catalog WHERE id = $1", [Number(appId)]);
    if (!appR.rows.length) return res.status(404).json(errorEnvelope("APP_NOT_FOUND", `App '${appId}' not found`));

    // Same resolution as /pda/user-apps/me: employees.user_id -> users.id.
    const grantorR = await query("SELECT id FROM employees WHERE user_id = $1", [req.user?.userId]);
    const grantedBy = grantorR.rows[0]?.id ?? null;

    const r = await query(
      `INSERT INTO pda_user_apps (user_id, app_id, granted_by, expires_at, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, app_id) DO UPDATE SET status='ACTIVE', granted_by=EXCLUDED.granted_by, expires_at=EXCLUDED.expires_at, notes=EXCLUDED.notes, updated_at=NOW()
       RETURNING id, user_id, app_id, status, granted_at, expires_at, notes`,
      [empId, Number(appId), grantedBy, expiresAt || null, notes || null]
    );
    res.status(201).json(envelope(r.rows[0]));
  } catch (err) {
    console.error("POST /pda/user-apps:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.patch("/pda/user-apps/:id", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const { status, expiresAt, notes } = req.body ?? {};
    const sets = [], params = []; let i = 1;
    if (status     !== undefined) { sets.push(`status = $${i++}`);     params.push(status); }
    if (expiresAt  !== undefined) { sets.push(`expires_at = $${i++}`); params.push(expiresAt || null); }
    if (notes      !== undefined) { sets.push(`notes = $${i++}`);     params.push(notes || null); }
    if (!sets.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const r = await query(
      `UPDATE pda_user_apps SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, user_id, app_id, status, granted_at, expires_at, notes`,
      params
    );
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Assignment not found"));
    res.json(envelope(r.rows[0]));
  } catch (err) { console.error("PATCH /pda/user-apps/:id:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

app.delete("/pda/user-apps/:id", authenticateJWT, requirePermission("pda.manage"), async (req, res) => {
  try {
    const r = await query(`UPDATE pda_user_apps SET status='REVOKED', updated_at=NOW() WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Assignment not found"));
    res.json(envelope({ revoked: true }));
  } catch (err) { console.error("DELETE /pda/user-apps/:id:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});

// ── PDA Employees (all employees for assignment dropdown) ────────────────────────
app.get("/pda/employees", authenticateJWT, requirePermission("pda.view"), async (req, res) => {
  try {
    const { q, status, limit = 500, offset = 0 } = req.query;
    const conditions = ['1=1'];
    const params = [];
    let i = 1;
    if (q) {
      conditions.push(`(code ILIKE $${i} OR display_name ILIKE $${i} OR name_zh ILIKE $${i} OR name_vi ILIKE $${i})`);
      params.push(`%${q}%`); i++;
    }
    if (status) { conditions.push(`status = $${i++}`); params.push(status); }
    const where = "WHERE " + conditions.join(" AND ");
    const countR = await query(`SELECT COUNT(*)::int AS cnt FROM employees ${where}`, params);
    params.push(Number(limit), Number(offset));
    const dataR = await query(
      `SELECT id, employee_no AS code, display_name, name_zh, name_vi, status
       FROM employees ${where}
       ORDER BY code LIMIT $${i++} OFFSET $${i}`,
      params
    );
    res.json(listEnvelope(dataR.rows, countR.rows[0].cnt));
  } catch (err) { console.error("GET /pda/employees:", err.message); res.status(500).json(errorEnvelope("SERVER_ERROR", err.message)); }
});
}
