// ═══════════════════════════════════════════════════════════════════════════
// AOI STATION API ROUTES — PATCH FOR server.js
// ═══════════════════════════════════════════════════════════════════════════
//
// ADD THESE 3 LINES TO THE TOP OF server.js (with the other imports):
//
//   import { mysqlQuery, mysqlGetOne } from "./src/mysql.js";
//
// THEN ADD ALL ROUTES BELOW JUST BEFORE the "SPA fallback" section in server.js
// (search for "// ── SPA fallback" in server.js line ~16958)
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// AOI STATION API (MySQL)
// ═══════════════════════════════════════════════════════════════════════════

// GET /quality/aoi/records — list AOI inspection records
app.get("/quality/aoi/records", requirePermission("quality.read"), async (req, res) => {
  try {
    const { stationCode, workOrderCode, result, fromDate, toDate, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    if (stationCode) { conditions.push(`station_code = ?`); params.push(stationCode); }
    if (workOrderCode) { conditions.push(`work_order_code = ?`); params.push(workOrderCode); }
    if (result) { conditions.push(`result = ?`); params.push(result); }
    if (fromDate) { conditions.push(`inspected_at >= ?`); params.push(fromDate); }
    if (toDate) { conditions.push(`inspected_at <= ?`); params.push(toDate); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    params.push(Number(limit), Number(offset));
    const rows = await mysqlQuery(
      `SELECT * FROM aoi_inspection_records ${where} ORDER BY inspected_at DESC LIMIT ? OFFSET ?`,
      params
    );
    const [countResult] = await mysqlQuery(
      `SELECT COUNT(*) as total FROM aoi_inspection_records ${where}`,
      params.slice(0, -2)
    );
    const total = countResult?.total ?? 0;
    const items = rows.map(r => ({
      ...r,
      defectCodes: r.defect_codes ? JSON.parse(r.defect_codes) : [],
      defectLocations: r.defect_locations ? JSON.parse(r.defect_locations) : [],
    }));
    res.json({ items, total });
  } catch (err) {
    console.error("GET /quality/aoi/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /quality/aoi/records — create AOI inspection record
app.post("/quality/aoi/records", requirePermission("quality.write"), async (req, res) => {
  try {
    const { payload } = req.body ?? req;
    const {
      pcbSerial, workOrderCode, machineCode, program, result,
      defectCount = 0, defectCodes = [], defectLocations = [],
      boardId, operator, stationCode, lineCode
    } = payload ?? {};
    if (!pcbSerial || !workOrderCode || !result) {
      return res.status(400).json(errorEnvelope("VALIDATION", "pcbSerial, workOrderCode, result required"));
    }
    if (!["PASS", "FAIL"].includes(result)) {
      return res.status(400).json(errorEnvelope("VALIDATION", "result must be PASS or FAIL"));
    }
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const [lastRec] = await mysqlQuery(
      `SELECT record_no FROM aoi_inspection_records WHERE record_no LIKE ? ORDER BY id DESC LIMIT 1`,
      [`AOI-${dateStr}-%`]
    );
    const seq = lastRec ? parseInt(lastRec.record_no.split("-")[2] ?? "0") + 1 : 1;
    const recordNo = `AOI-${dateStr}-${String(seq).padStart(3, "0")}`;
    const defectCodesJson = JSON.stringify(defectCodes);
    const defectLocationsJson = JSON.stringify(defectLocations);
    const [insertResult] = await mysqlQuery(
      `INSERT INTO aoi_inspection_records (record_no, pcb_serial, work_order_code, machine_code, program_name, board_id, result, defect_count, defect_codes, defect_locations, station_code, line_code, operator, inspected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [recordNo, pcbSerial, workOrderCode, machineCode ?? "", program ?? "", boardId ?? null, result, defectCount, defectCodesJson, defectLocationsJson, stationCode ?? "AOI-01", lineCode ?? "LINE-01", operator ?? null]
    );
    res.json({ id: insertResult?.insertId ?? seq, success: true, recordNo });
  } catch (err) {
    console.error("POST /quality/aoi/records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /quality/aoi/defect-codes — list AOI defect codes
app.get("/quality/aoi/defect-codes", requirePermission("quality.read"), async (req, res) => {
  try {
    const { category } = req.query;
    const where = category ? "WHERE category = ? AND status = 'active'" : "WHERE status = 'active'";
    const params = category ? [category] : [];
    const rows = await mysqlQuery(`SELECT * FROM aoi_defect_codes ${where} ORDER BY code ASC`, params);
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    console.error("GET /quality/aoi/defect-codes:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /quality/aoi/stats — get AOI statistics
app.get("/quality/aoi/stats", requirePermission("quality.read"), async (req, res) => {
  try {
    const { stationCode, workOrderCode, fromDate, toDate } = req.query;
    const conditions = [];
    const params = [];
    if (stationCode) { conditions.push(`station_code = ?`); params.push(stationCode); }
    if (workOrderCode) { conditions.push(`work_order_code = ?`); params.push(workOrderCode); }
    if (fromDate) { conditions.push(`inspected_at >= ?`); params.push(fromDate); }
    if (toDate) { conditions.push(`inspected_at <= ?`); params.push(toDate); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const [statRow] = await mysqlQuery(
      `SELECT COUNT(*) as total, SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) as pass_count, SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) as fail_count FROM aoi_inspection_records ${where}`,
      params
    );
    const total = Number(statRow?.total ?? 0);
    const pass = Number(statRow?.pass_count ?? 0);
    const fail = Number(statRow?.fail_count ?? 0);
    const yieldRate = total > 0 ? Math.round((pass / total) * 100) : 0;
    const paretoRows = await mysqlQuery(
      `SELECT defect_codes, defect_count FROM aoi_inspection_records ${where} AND result = 'FAIL' AND defect_codes IS NOT NULL AND defect_codes != '[]'`,
      params
    );
    const defectCounts = {};
    for (const row of paretoRows) {
      try {
        const codes = JSON.parse(row.defect_codes);
        for (const code of codes) { defectCounts[code] = (defectCounts[code] ?? 0) + 1; }
      } catch { /* skip */ }
    }
    const defectPareto = Object.entries(defectCounts)
      .map(([defectCode, count]) => ({ defectCode, count, percentage: fail > 0 ? Math.round((count / fail) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    res.json({ total, pass, fail, yieldRate, defectPareto });
  } catch (err) {
    console.error("GET /quality/aoi/stats:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /quality/aoi/defect-pareto — get defect pareto analysis
app.get("/quality/aoi/defect-pareto", requirePermission("quality.read"), async (req, res) => {
  try {
    const { stationCode, workOrderCode, fromDate, toDate, limit = 10 } = req.query;
    const conditions = [`result = 'FAIL'`, `defect_codes IS NOT NULL`, `defect_codes != '[]'`];
    const params = [];
    if (stationCode) { conditions.push(`station_code = ?`); params.push(stationCode); }
    if (workOrderCode) { conditions.push(`work_order_code = ?`); params.push(workOrderCode); }
    if (fromDate) { conditions.push(`inspected_at >= ?`); params.push(fromDate); }
    if (toDate) { conditions.push(`inspected_at <= ?`); params.push(toDate); }
    const where = "WHERE " + conditions.join(" AND ");
    const rows = await mysqlQuery(`SELECT defect_codes, defect_count FROM aoi_inspection_records ${where}`, params);
    const defectCounts = {};
    for (const row of rows) {
      try {
        const codes = JSON.parse(row.defect_codes);
        for (const code of codes) { defectCounts[code] = (defectCounts[code] ?? 0) + 1; }
      } catch { /* skip */ }
    }
    const total = Object.values(defectCounts).reduce((s, c) => s + c, 0);
    const pareto = Object.entries(defectCounts)
      .map(([defectCode, count]) => ({ defectCode, count, percentage: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, Number(limit));
    res.json(pareto);
  } catch (err) {
    console.error("GET /quality/aoi/defect-pareto:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /quality/aoi/stations — list AOI stations
app.get("/quality/aoi/stations", requirePermission("quality.read"), async (req, res) => {
  try {
    const { lineCode, status } = req.query;
    const conditions = [];
    const params = [];
    if (lineCode) { conditions.push(`line_code = ?`); params.push(lineCode); }
    if (status) { conditions.push(`status = ?`); params.push(status); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const rows = await mysqlQuery(`SELECT * FROM aoi_stations ${where} ORDER BY station_code ASC`, params);
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    console.error("GET /quality/aoi/stations:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
