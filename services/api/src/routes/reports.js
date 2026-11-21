// Cross-domain reports (/reports/*), moved out of services/api/server.js.
//
// 19 registrations: work-order progress, inventory ledger and material movement,
// IQC/OQC summaries, OEE by line, defect analysis, material balance, delivery risk,
// AOI/SPI yield, attendance, equipment downtime and maintenance, AR/AP aging, plus the
// generic `/reports/:reportKey` lookup and its CSV export.
//
// None of them carry requirePermission -- they were registered above the auth wrapper and
// are reached through the gate like the rest of the reporting surface. The move keeps that
// position, so nothing about their reachability changes; flagging it here because these are
// the widest-read endpoints in the system and the omission is easy to miss when the block
// is read in isolation.
export function registerReportsRoutes(app, deps) {
  const { query, envelope, errorEnvelope } = deps;

app.get("/reports/work-order-progress", async (req, res) => {
  try {
    const { lineCode, status, workOrderCode } = req.query;
    const rows = (await query(
      `SELECT work_order_code, product_code, line_code, type,
              planned_qty, completed_qty, progress_pct, status,
              released_at, closed_at,
              CONCAT(customer_name_zh, ' / ', customer_name_en) AS customer_name,
              due_date
       FROM mv_report_work_order_progress
       WHERE ($1::text IS NULL OR line_code = $1)
         AND ($2::text IS NULL OR status     = $2)
         AND ($3::text IS NULL OR work_order_code = $3)
       ORDER BY work_order_code DESC LIMIT 500`,
      [lineCode || null, status || null, workOrderCode || null],
    )).rows;
    res.json(envelope({ key: "work-order-progress", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/inventory-ledger
app.get("/reports/inventory-ledger", async (req, res) => {
  try {
    const { materialCode, supplierCode, iqcStatus } = req.query;
    const rows = (await query(
      `SELECT material_code,
              CONCAT(material_name_zh, ' / ', material_name_en) AS material_name,
              supplier_code,
              CONCAT(supplier_name_zh, ' / ', supplier_name_en) AS supplier_name,
              lot_no, iqc_status, initial_qty, current_qty, location_code,
              received_at, last_movement_at, msd_level, shelf_life_days, reserved_qty
       FROM v_report_inventory_ledger
       WHERE ($1::text IS NULL OR material_code = $1)
         AND ($2::text IS NULL OR supplier_code = $2)
         AND ($3::text IS NULL OR iqc_status    = $3)
       ORDER BY received_at DESC LIMIT 500`,
      [materialCode || null, supplierCode || null, iqcStatus || null],
    )).rows;
    res.json(envelope({ key: "inventory-ledger", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/material-movement
app.get("/reports/material-movement", async (req, res) => {
  try {
    const { fromDate, toDate, dateFrom, dateTo, materialCode, workOrderCode } = req.query;
    const effectiveFromDate = fromDate || dateFrom;
    const effectiveToDate   = toDate   || dateTo;
    // Default to last 30 days if no date range provided — avoids full-table scan
    const DEFAULT_FROM = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const DEFAULT_TO   = new Date().toISOString();
    const rows = (await query(
      `SELECT tx_no, action, material_code, material_name, lot_no,
              work_order_code, qty, from_location_code, to_location_code,
              operator_name, occurred_at
       FROM v_report_material_movement
       WHERE ($1::timestamptz IS NULL OR occurred_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR occurred_at <= $2::timestamptz)
         AND ($3::text IS NULL OR material_code    = $3)
         AND ($4::text IS NULL OR work_order_code  = $4)
       ORDER BY occurred_at DESC LIMIT 500`,
      [effectiveFromDate || DEFAULT_FROM, effectiveToDate || DEFAULT_TO, materialCode || null, workOrderCode || null],
    )).rows;
    res.json(envelope({ key: "material-movement", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/iqc-summary
app.get("/reports/iqc-summary", async (req, res) => {
  try {
    const { supplierCode, fromDate, toDate } = req.query;
    // Default to last 90 days if no date range — IQC is monthly review
    const DEFAULT_FROM = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const DEFAULT_TO   = new Date().toISOString().slice(0, 10);
    const rows = (await query(
      `SELECT material_code,
              ROW(name_zh, name_en, name_vi) AS material_name,
              supplier_code,
              ROW(supplier_name_zh, supplier_name_en, supplier_name_vi) AS supplier_name,
              total_lots, pending_lots, released_lots, hold_lots, rejected_lots,
              total_qty, pending_qty, last_received_at
       FROM mv_report_iqc_summary
       WHERE ($1::text IS NULL OR supplier_code = $1)
         AND ($2::text IS NULL OR last_received_at >= $2::date)
         AND ($3::text IS NULL OR last_received_at <= $3::date)
       ORDER BY material_code LIMIT 200`,
      [supplierCode || null, fromDate || DEFAULT_FROM, toDate || DEFAULT_TO],
    )).rows;
    res.json(envelope({ key: "iqc-summary", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/oee-by-line
app.get("/reports/oee-by-line", async (req, res) => {
  try {
    const { lineCode, fromDate, toDate, dateFrom, dateTo } = req.query;
    const effectiveFromDate = fromDate || dateFrom;
    const effectiveToDate   = toDate   || dateTo;
    // Default to last 30 days if no date range provided
    const DEFAULT_FROM = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const DEFAULT_TO   = new Date().toISOString().slice(0, 10);
    const rows = (await query(
      `SELECT line_code,
              CONCAT(line_name_zh, ' / ', line_name_en) AS line_name,
              date,
              planned_minutes, downtime_minutes, available_minutes,
              total_output, defect_count,
              availability, performance, quality, oee
       FROM v_report_oee_by_line
       WHERE ($1::text IS NULL OR line_code = $1)
         AND ($2::timestamptz IS NULL OR date >= $2::timestamptz::date)
         AND ($3::timestamptz IS NULL OR date <= $3::timestamptz::date)
       ORDER BY date DESC, line_code LIMIT 200`,
      [lineCode || null, effectiveFromDate || DEFAULT_FROM, effectiveToDate || DEFAULT_TO],
    )).rows;
    res.json(envelope({ key: "oee-by-line", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/defect-analysis
app.get("/reports/defect-analysis", async (req, res) => {
  try {
    const { stationType } = req.query;
    const rows = (await query(
      `SELECT defect_code, defect_name, severity, station_type,
              count, percentage, avg_repair_minutes, top_work_order_code
       FROM v_report_defect_analysis
       WHERE ($1::text IS NULL OR station_type = $1)
       ORDER BY count DESC LIMIT 200`,
      [stationType || null],
    )).rows;
    res.json(envelope({ key: "defect-analysis", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/material-balance
app.get("/reports/material-balance", async (req, res) => {
  try {
    const { materialCode } = req.query;
    const rows = (await query(
      `SELECT material_code,
              ROW(name_zh, name_en, name_vi) AS material_name,
              uom,
              total_received, total_issued, total_scrapped, total_returned,
              current_balance
       FROM mv_report_material_balance
       WHERE ($1::text IS NULL OR material_code = $1)
       ORDER BY material_code LIMIT 200`,
      [materialCode || null],
    )).rows;
    res.json(envelope({ key: "material-balance", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/delivery-risk
app.get("/reports/delivery-risk", async (req, res) => {
  try {
    const { riskLevel } = req.query;
    const rows = (await query(
      `SELECT po_number, customer_name, product_code,
              order_qty, delivered_qty, balance_qty,
              due_date, risk_level, work_order_codes, line_code, days_remaining
       FROM v_report_delivery_risk
       WHERE ($1::text IS NULL OR risk_level = $1)
       ORDER BY due_date ASC LIMIT 200`,
      [riskLevel || null],
    )).rows;
    res.json(envelope({ key: "delivery-risk", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/aoi-yield
app.get("/reports/aoi-yield", async (req, res) => {
  try {
    const { dateFrom, dateTo, lineCode, stationType } = req.query;
    const rows = (await query(
      `SELECT inspection_date, week_start, month_start,
              line_code, line_name_zh, line_name_en, line_name_vi,
              station_type, total_inspected, pass_count, fail_count, yield_pct
       FROM v_report_aoi_yield
       WHERE ($1::timestamptz IS NULL OR inspection_date >= $1::date)
         AND ($2::timestamptz IS NULL OR inspection_date <= $2::date)
         AND ($3::text IS NULL OR line_code = $3)
         AND ($4::text IS NULL OR station_type = $4)
       ORDER BY inspection_date DESC, line_code LIMIT 500`,
      [dateFrom || null, dateTo || null, lineCode || null, stationType || null],
    )).rows;
    res.json(envelope({ key: "aoi-yield", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/spi-yield
app.get("/reports/spi-yield", async (req, res) => {
  try {
    const { dateFrom, dateTo, lineCode, stationType } = req.query;
    const rows = (await query(
      `SELECT inspection_date, week_start, month_start,
              line_code, line_name_zh, line_name_en, line_name_vi,
              station_type, total_inspected, pass_count, fail_count, yield_pct
       FROM v_report_spi_yield
       WHERE ($1::timestamptz IS NULL OR inspection_date >= $1::date)
         AND ($2::timestamptz IS NULL OR inspection_date <= $2::date)
         AND ($3::text IS NULL OR line_code = $3)
         AND ($4::text IS NULL OR station_type = $4)
       ORDER BY inspection_date DESC, line_code LIMIT 500`,
      [dateFrom || null, dateTo || null, lineCode || null, stationType || null],
    )).rows;
    res.json(envelope({ key: "spi-yield", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/oqc-summary
app.get("/reports/oqc-summary", async (req, res) => {
  try {
    const { dateFrom, dateTo, workOrderCode, productCode } = req.query;
    const rows = (await query(
      `SELECT inspection_date, week_start, month_start,
              work_order_code, product_code,
              product_name_zh, product_name_en, product_name_vi,
              inspection_type, result, operator_name, occurred_at
       FROM v_report_oqc_summary
       WHERE ($1::timestamptz IS NULL OR inspection_date >= $1::date)
         AND ($2::timestamptz IS NULL OR inspection_date <= $2::date)
         AND ($3::text IS NULL OR work_order_code = $3)
         AND ($4::text IS NULL OR product_code = $4)
       ORDER BY inspection_date DESC LIMIT 500`,
      [dateFrom || null, dateTo || null, workOrderCode || null, productCode || null],
    )).rows;
    res.json(envelope({ key: "oqc-summary", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/attendance-summary
app.get("/reports/attendance-summary", async (req, res) => {
  try {
    const { dateFrom, dateTo, employeeCode, departmentCode } = req.query;
    const rows = (await query(
      `SELECT date, week_start, month_start,
              employee_code, employee_name_zh, employee_name_en, employee_name_vi,
              department_code, department_name_zh, department_name_en, department_name_vi,
              clock_in, clock_out, status, is_late, is_early, is_absent, is_leave
       FROM v_report_attendance_summary
       WHERE ($1::date IS NULL OR date >= $1::date)
         AND ($2::date IS NULL OR date <= $2::date)
         AND ($3::text IS NULL OR employee_code = $3)
         AND ($4::text IS NULL OR department_code = $4)
       ORDER BY date DESC, employee_code LIMIT 500`,
      [dateFrom || null, dateTo || null, employeeCode || null, departmentCode || null],
    )).rows;
    res.json(envelope({ key: "attendance-summary", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/equipment-downtime
app.get("/reports/equipment-downtime", async (req, res) => {
  try {
    const { dateFrom, dateTo, lineCode, status } = req.query;
    const rows = (await query(
      `SELECT downtime_no, reason_code, reason_detail,
              start_at, end_at, downtime_minutes, status,
              asset_code, category_name_zh, category_name_en, category_name_vi,
              line_code, line_name_zh, line_name_en, line_name_vi,
              operator_name, created_at
       FROM v_report_equipment_downtime
       WHERE ($1::timestamptz IS NULL OR start_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR start_at <= $2::timestamptz)
         AND ($3::text IS NULL OR line_code = $3)
         AND ($4::text IS NULL OR status = $4)
       ORDER BY start_at DESC LIMIT 500`,
      [dateFrom || null, dateTo || null, lineCode || null, status || null],
    )).rows;
    res.json(envelope({ key: "equipment-downtime", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/maintenance-summary
app.get("/reports/maintenance-summary", async (req, res) => {
  try {
    const { dateFrom, dateTo, orderType, priority, status } = req.query;
    const rows = (await query(
      `SELECT order_no, order_type, priority, status,
              asset_code, category_name_zh, category_name_en, category_name_vi,
              line_code, planned_start, planned_end,
              actual_start, actual_end, operator_name, created_at, closed_at
       FROM v_report_maintenance_summary
       WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR created_at <= $2::timestamptz)
         AND ($3::text IS NULL OR order_type = $3)
         AND ($4::text IS NULL OR priority = $4)
         AND ($5::text IS NULL OR status = $5)
       ORDER BY created_at DESC LIMIT 500`,
      [dateFrom || null, dateTo || null, orderType || null, priority || null, status || null],
    )).rows;
    res.json(envelope({ key: "maintenance-summary", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/ar-aging
app.get("/reports/ar-aging", async (req, res) => {
  try {
    const { customerCode, agingBucket } = req.query;
    const rows = (await query(
      `SELECT invoice_no, invoice_date, due_date,
              customer_code, customer_name_zh, customer_name_en, customer_name_vi,
              currency_code, total_amount, paid_amount, outstanding_amount,
              days_overdue, aging_bucket, payment_status, created_at
       FROM v_report_ar_aging
       WHERE ($1::text IS NULL OR customer_code = $1)
         AND ($2::text IS NULL OR aging_bucket = $2)
       ORDER BY days_overdue DESC LIMIT 500`,
      [customerCode || null, agingBucket || null],
    )).rows;
    res.json(envelope({ key: "ar-aging", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/ap-aging
app.get("/reports/ap-aging", async (req, res) => {
  try {
    const { supplierCode, agingBucket } = req.query;
    const rows = (await query(
      `SELECT invoice_no, invoice_date, due_date,
              supplier_code, supplier_name_zh, supplier_name_en, supplier_name_vi,
              currency_code, total_amount, paid_amount, outstanding_amount,
              days_overdue, aging_bucket, payment_status, created_at
       FROM v_report_ap_aging
       WHERE ($1::text IS NULL OR supplier_code = $1)
         AND ($2::text IS NULL OR aging_bucket = $2)
       ORDER BY days_overdue DESC LIMIT 500`,
      [supplierCode || null, agingBucket || null],
    )).rows;
    res.json(envelope({ key: "ap-aging", rows,
      generatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/:reportKey  (generic fallback)
app.get("/reports/:reportKey", async (req, res) => {
  try {
    const validKeys = [
      "work-order-progress","inventory-ledger","material-movement",
      "iqc-summary","oee-by-line","defect-analysis","material-balance","delivery-risk",
      "aoi-yield","spi-yield","oqc-summary","attendance-summary",
      "equipment-downtime","maintenance-summary","ar-aging","ap-aging",
      "production","quality","inventory","finance",
    ];
    const { reportKey } = req.params;
    if (!validKeys.includes(reportKey))
      return res.status(404).json(errorEnvelope("NOT_FOUND", `Report '${reportKey}' not found`));
    // delegate to the specific handler
    const sub = req.path.replace(`/reports/${reportKey}`, `/reports/${reportKey.replace(/-/g,'-')}`);
    // re-call by re-matching (simple redirect via handler map)
    const handlerMap = {
      "work-order-progress": "/reports/work-order-progress",
      "inventory-ledger":    "/reports/inventory-ledger",
      "material-movement":   "/reports/material-movement",
      "iqc-summary":         "/reports/iqc-summary",
      "oee-by-line":         "/reports/oee-by-line",
      "defect-analysis":     "/reports/defect-analysis",
      "material-balance":    "/reports/material-balance",
      "delivery-risk":       "/reports/delivery-risk",
      "production":          "/reports/work-order-progress",
      "quality":             "/reports/iqc-summary",
      "inventory":           "/reports/inventory-ledger",
      "finance":             "/reports/ar-aging",
    };
    // Use same query params
    const h = handlerMap[reportKey];
    if (!h) return res.status(404).json(errorEnvelope("NOT_FOUND", "Unknown"));
    // Rebuild URL and proxy (avoid circular)
    const url = new URL(req.protocol + "://" + req.get("host") + h);
    Object.entries(req.query).forEach(([k,v]) => url.searchParams.set(k, String(v)));
    // Fetch internally
    const http = await import("node:http");
    const result = await new Promise((resolve, reject) => {
      const authHeader = req.headers.authorization;
      http.get(url.toString(), { headers: { "x-forwarded-for": "internal", ...(authHeader ? { authorization: authHeader } : {}) } }, (r) => {
        let data = "";
        r.on("data", c => data += c);
        r.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); } });
      }).on("error", reject);
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /reports/:reportKey/export  (CSV download)
app.get("/reports/:reportKey/export", async (req, res) => {
  try {
    const { reportKey } = req.params;
    const validKeys = [
      "work-order-progress","inventory-ledger","material-movement",
      "iqc-summary","oee-by-line","defect-analysis","material-balance","delivery-risk",
    ];
    if (!validKeys.includes(reportKey))
      return res.status(404).json(errorEnvelope("NOT_FOUND", `Report '${reportKey}' not found`));
    const rows = (await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'v_report_${reportKey.replace(/-/g,'_')}' ORDER BY ordinal_position`,
    )).rows;
    const cols = rows.map(r => r.column_name);
    const http = await import("node:http");
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const reportUrl = `${baseUrl}/reports/${reportKey}`;
    const result = await new Promise((resolve, reject) => {
      http.get(reportUrl, (r) => {
        let d = "";
        r.on("data", c => d += c);
        r.on("end", () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); } });
      }).on("error", reject);
    });
    const reportRows = result?.data?.rows || result?.rows || [];
    const headers = reportRows.length > 0 ? Object.keys(reportRows[0]) : cols;
    const csv = [
      headers.join(","),
      ...reportRows.map(r => headers.map(h => {
        const v = r[h] ?? "";
        return `"${String(v).replace(/"/g,'""')}"`;
      }).join(",")),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportKey}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}
