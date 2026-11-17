-- ============================================================
-- 040: Report Categories Expansion
-- Adds domain-grouped report views across HR, Equipment, Finance, Quality
-- Extends existing 8 reports with time-period awareness
-- ============================================================

begin;

-- ── R9: Attendance Summary ───────────────────────────────────────
-- Daily/weekly/monthly headcount, late, early, absent by employee + department
CREATE OR REPLACE VIEW v_report_attendance_summary AS
SELECT
  ar.date,
  DATE_TRUNC('week', ar.date)::date AS week_start,
  DATE_TRUNC('month', ar.date)::date AS month_start,
  e.code                              AS employee_code,
  e.name_zh                            AS employee_name_zh,
  e.name_en                            AS employee_name_en,
  e.name_vi                            AS employee_name_vi,
  d.code                              AS department_code,
  d.name_zh                            AS department_name_zh,
  d.name_en                            AS department_name_en,
  d.name_vi                            AS department_name_vi,
  ar.clock_in,
  ar.clock_out,
  ar.status,
  CASE
    WHEN ar.clock_in > '08:00:00'::time THEN true ELSE false
  END                                 AS is_late,
  CASE
    WHEN ar.clock_out < '17:00:00'::time THEN true ELSE false
  END                                 AS is_early,
  CASE WHEN ar.status = 'absent' THEN true ELSE false END AS is_absent,
  CASE WHEN ar.status = 'leave' THEN true ELSE false END  AS is_leave
FROM attendance_records ar
JOIN employees e ON e.id = ar.employee_id
LEFT JOIN departments d ON d.id = e.department_id
WHERE ar.date >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY ar.date DESC, e.code;

-- ── R10: Equipment Downtime ───────────────────────────────────────
-- Downtime events grouped by asset, line, reason with total minutes
CREATE OR REPLACE VIEW v_report_equipment_downtime AS
SELECT
  de.downtime_no,
  de.reason_code,
  de.reason_detail,
  de.start_at,
  de.end_at,
  de.downtime_minutes,
  de.status,
  ea.asset_code,
  ec.name_zh                            AS category_name_zh,
  ec.name_en                            AS category_name_en,
  ec.name_vi                            AS category_name_vi,
  pl.numeric_line_code               AS line_code,
  pl.name_zh                            AS line_name_zh,
  pl.name_en                            AS line_name_en,
  pl.name_vi                            AS line_name_vi,
  u.display_name                     AS operator_name,
  de.created_at
FROM downtime_events de
JOIN equipment_assets ea ON ea.id = de.asset_id
JOIN equipment_categories ec ON ec.id = ea.category_id
LEFT JOIN production_lines pl ON pl.id = de.line_id
LEFT JOIN users u ON u.id = de.operator_id
WHERE de.start_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY de.start_at DESC;

-- ── R11: AR Aging (Accounts Receivable) ──────────────────────────
-- Outstanding invoices aged into buckets per customer
CREATE OR REPLACE VIEW v_report_ar_aging AS
SELECT
  ari.invoice_no,
  ari.invoice_date,
  ari.due_date,
  c.name_zh                              AS customer_name_zh,
  c.name_en                              AS customer_name_en,
  c.name_vi                              AS customer_name_vi,
  c.code                              AS customer_code,
  ari.currency_code,
  ari.total_amount,
  ari.paid_amount,
  ari.outstanding_amount,
  CURRENT_DATE - ari.due_date         AS days_overdue,
  CASE
    WHEN CURRENT_DATE - ari.due_date <= 0   THEN 'current'
    WHEN CURRENT_DATE - ari.due_date <= 30  THEN 'bucket_0_30'
    WHEN CURRENT_DATE - ari.due_date <= 60  THEN 'bucket_31_60'
    WHEN CURRENT_DATE - ari.due_date <= 90  THEN 'bucket_61_90'
    ELSE 'bucket_over_90'
  END                                 AS aging_bucket,
  ari.payment_status,
  ari.created_at
FROM ar_invoices ari
JOIN customers c ON c.id = ari.customer_id
WHERE ari.payment_status IN ('open', 'partial')
ORDER BY days_overdue DESC;

-- ── R12: AP Aging (Accounts Payable) ─────────────────────────────
-- Outstanding invoices aged into buckets per supplier
CREATE OR REPLACE VIEW v_report_ap_aging AS
SELECT
  api.invoice_no,
  api.invoice_date,
  api.due_date,
  s.name_zh                              AS supplier_name_zh,
  s.name_en                              AS supplier_name_en,
  s.name_vi                              AS supplier_name_vi,
  s.code                              AS supplier_code,
  api.currency_code,
  api.total_amount,
  api.paid_amount,
  api.outstanding_amount,
  CURRENT_DATE - api.due_date         AS days_overdue,
  CASE
    WHEN CURRENT_DATE - api.due_date <= 0   THEN 'current'
    WHEN CURRENT_DATE - api.due_date <= 30  THEN 'bucket_0_30'
    WHEN CURRENT_DATE - api.due_date <= 60  THEN 'bucket_31_60'
    WHEN CURRENT_DATE - api.due_date <= 90  THEN 'bucket_61_90'
    ELSE 'bucket_over_90'
  END                                 AS aging_bucket,
  api.payment_status,
  api.created_at
FROM ap_invoices api
JOIN suppliers s ON s.id = api.supplier_id
WHERE api.payment_status IN ('open', 'partial')
ORDER BY days_overdue DESC;

-- ── R13: AOI Yield ─────────────────────────────────────────────────
-- AOI inspection pass/fail rate by line, station_type, date
CREATE OR REPLACE VIEW v_report_aoi_yield AS
SELECT
  DATE(ai.occurred_at)               AS inspection_date,
  DATE_TRUNC('week', ai.occurred_at)::date AS week_start,
  DATE_TRUNC('month', ai.occurred_at)::date AS month_start,
  pl.numeric_line_code               AS line_code,
  pl.name_zh                            AS line_name_zh,
  pl.name_en                            AS line_name_en,
  pl.name_vi                            AS line_name_vi,
  st.code                            AS station_type,
  COUNT(*)                           AS total_inspected,
  COUNT(*) FILTER (WHERE ai.result = 'pass') AS pass_count,
  COUNT(*) FILTER (WHERE ai.result = 'fail') AS fail_count,
  ROUND(COUNT(*) FILTER (WHERE ai.result = 'pass')::numeric
    / NULLIF(COUNT(*), 0) * 100, 1) AS yield_pct
FROM aoi_inspection_records ai
JOIN stations s ON s.id = ai.station_id
JOIN station_types st ON st.id = s.station_type_id
JOIN production_lines pl ON pl.id = s.line_id
WHERE ai.occurred_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY ai.occurred_at, pl.numeric_line_code, pl.name_zh, pl.name_en, pl.name_vi, st.code
ORDER BY inspection_date DESC, pl.numeric_line_code;

-- ── R14: SPI Yield ─────────────────────────────────────────────────
-- SPI (Solder Paste Inspection) pass/fail rate by line, station_type, date
CREATE OR REPLACE VIEW v_report_spi_yield AS
SELECT
  DATE(si.occurred_at)               AS inspection_date,
  DATE_TRUNC('week', si.occurred_at)::date AS week_start,
  DATE_TRUNC('month', si.occurred_at)::date AS month_start,
  pl.numeric_line_code               AS line_code,
  pl.name_zh                            AS line_name_zh,
  pl.name_en                            AS line_name_en,
  pl.name_vi                            AS line_name_vi,
  st.code                            AS station_type,
  COUNT(*)                           AS total_inspected,
  COUNT(*) FILTER (WHERE si.result = 'pass') AS pass_count,
  COUNT(*) FILTER (WHERE si.result = 'fail') AS fail_count,
  ROUND(COUNT(*) FILTER (WHERE si.result = 'pass')::numeric
    / NULLIF(COUNT(*), 0) * 100, 1) AS yield_pct
FROM spire_inspection_records si
JOIN stations s ON s.id = si.station_id
JOIN station_types st ON st.id = s.station_type_id
JOIN production_lines pl ON pl.id = s.line_id
WHERE si.occurred_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY si.occurred_at, pl.numeric_line_code, pl.name_zh, pl.name_en, pl.name_vi, st.code
ORDER BY inspection_date DESC, pl.numeric_line_code;

-- ── R15: OQC Summary ───────────────────────────────────────────────
-- OQC (Outgoing Quality Control) pass/fail by date, work order
CREATE OR REPLACE VIEW v_report_oqc_summary AS
SELECT
  DATE(oi.occurred_at)               AS inspection_date,
  DATE_TRUNC('week', oi.occurred_at)::date AS week_start,
  DATE_TRUNC('month', oi.occurred_at)::date AS month_start,
  wo.code                            AS work_order_code,
  p.name_zh                             AS product_name_zh,
  p.name_en                             AS product_name_en,
  p.name_vi                             AS product_name_vi,
  p.code                             AS product_code,
  oi.inspection_type,
  oi.result,
  u.display_name                     AS operator_name,
  oi.occurred_at
FROM oqc_inspection_records oi
LEFT JOIN work_orders wo ON wo.id = oi.work_order_id
LEFT JOIN products p ON p.id = wo.product_id
LEFT JOIN users u ON u.id = oi.operator_id
WHERE oi.occurred_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY oi.occurred_at DESC;

-- ── R16: Maintenance Order Summary ────────────────────────────────
-- Open/completed maintenance orders by asset and type
CREATE OR REPLACE VIEW v_report_maintenance_summary AS
SELECT
  mo.order_no,
  mo.order_type,
  mo.priority,
  mo.status,
  ea.asset_code,
  ec.name_zh                            AS category_name_zh,
  ec.name_en                            AS category_name_en,
  ec.name_vi                            AS category_name_vi,
  pl.numeric_line_code               AS line_code,
  mo.planned_start,
  mo.planned_end,
  mo.actual_start,
  mo.actual_end,
  u.display_name                     AS operator_name,
  mo.created_at,
  mo.closed_at
FROM maintenance_orders mo
JOIN equipment_assets ea ON ea.id = mo.asset_id
JOIN equipment_categories ec ON ec.id = ea.category_id
LEFT JOIN production_lines pl ON pl.id = ea.line_id
LEFT JOIN users u ON u.id = mo.operator_id
WHERE mo.created_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY mo.created_at DESC;

-- ── Patch existing R6: Defect Analysis — add date column for filter ──
-- R6 now uses occurred_at for flexible date filtering instead of hardcoded 30 days
DROP VIEW IF EXISTS v_report_defect_analysis;
CREATE OR REPLACE VIEW v_report_defect_analysis AS
SELECT
  dc.code                              AS defect_code,
  dc.name_zh                            AS defect_name_zh,
  dc.name_en                            AS defect_name_en,
  dc.name_vi                            AS defect_name_vi,
  COALESCE(dc.severity, 'major')       AS severity,
  qi.station_type,
  DATE(qi.occurred_at)                 AS run_date,
  DATE_TRUNC('week', qi.occurred_at)::date AS week_start,
  DATE_TRUNC('month', qi.occurred_at)::date AS month_start,
  COUNT(*)                             AS count,
  ROUND(COUNT(*)::numeric /
    NULLIF((SELECT COUNT(*) FROM quality_inspections WHERE result = 'fail' AND DATE(occurred_at) >= CURRENT_DATE - INTERVAL '90 days'), 0) * 100, 1
  )                                    AS percentage,
  NULL                                 AS avg_repair_minutes
FROM quality_inspections qi
JOIN repair_records rr ON rr.inspection_id = qi.id
JOIN defect_codes dc ON dc.id = rr.defect_code_id
WHERE qi.result = 'fail'
  AND qi.occurred_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY dc.code, dc.name_zh, dc.name_en, dc.name_vi, dc.severity, qi.station_type, qi.occurred_at
ORDER BY count DESC;

-- ── Patch existing R5: OEE by Line — add week/month columns ──────
DROP VIEW IF EXISTS v_report_oee_by_line;
CREATE OR REPLACE VIEW v_report_oee_by_line AS
WITH daily_stats AS (
  SELECT
    pl.numeric_line_code               AS line_code,
    DATE(se.occurred_at)               AS run_date,
    DATE_TRUNC('week', se.occurred_at)::date AS week_start,
    DATE_TRUNC('month', se.occurred_at)::date AS month_start,
    COUNT(DISTINCT s.id)               AS station_count,
    COUNT(DISTINCT DATE(se.occurred_at)) * 480 AS planned_minutes,
    COUNT(*) FILTER (WHERE se.result = 'downtime'
      AND se.event_type = 'scan_in')   AS downtime_events,
    COUNT(*) FILTER (WHERE se.event_type = 'scan_in') AS total_scans,
    COUNT(*) FILTER (WHERE se.event_type = 'scan_in' AND se.result = 'pass') AS pass_scans,
    COUNT(*) FILTER (WHERE se.event_type = 'scan_in' AND se.result = 'fail') AS fail_scans
  FROM station_events se
  JOIN stations s ON s.id = se.station_id
  JOIN production_lines pl ON pl.id = s.line_id
  WHERE se.occurred_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY pl.numeric_line_code, se.occurred_at
)
SELECT
  ds.line_code,
  pl.name_zh                            AS line_name_zh,
  pl.name_en                            AS line_name_en,
  pl.name_vi                            AS line_name_vi,
  ds.run_date                             AS date,
  ds.week_start,
  ds.month_start,
  ds.planned_minutes,
  (ds.downtime_events * 5)                AS downtime_minutes,
  GREATEST(0, ds.planned_minutes - ds.downtime_events * 5) AS available_minutes,
  ds.pass_scans                           AS total_output,
  ds.fail_scans                           AS defect_count,
  ROUND(
    GREATEST(0, ds.planned_minutes - ds.downtime_events * 5)::numeric
    / NULLIF(ds.planned_minutes, 0) * 100, 1
  )                                       AS availability,
  LEAST(100, ROUND(
    ds.total_scans::numeric
    / NULLIF(GREATEST(0, ds.planned_minutes - ds.downtime_events * 5), 0)
    * 100, 1
  ))                                     AS performance,
  ROUND(
    ds.pass_scans::numeric / NULLIF(ds.total_scans, 0) * 100, 1
  )                                       AS quality,
  ROUND(
    ROUND(GREATEST(0, ds.planned_minutes - ds.downtime_events * 5)::numeric
      / NULLIF(ds.planned_minutes, 0) * 100, 1)
    * LEAST(100, ROUND(ds.total_scans::numeric
      / NULLIF(GREATEST(0, ds.planned_minutes - ds.downtime_events * 5), 0) * 100, 1))
    / 100 * ROUND(ds.pass_scans::numeric / NULLIF(ds.total_scans, 0) * 100, 1)
  , 1)                                    AS oee
FROM daily_stats ds
JOIN production_lines pl ON pl.numeric_line_code = ds.line_code;

-- ── Patch existing R4: IQC Summary — add week/month columns ──────
DROP VIEW IF EXISTS v_report_iqc_summary;
CREATE OR REPLACE VIEW v_report_iqc_summary AS
SELECT
  m.code                              AS material_code,
  m.name_zh                            AS material_name_zh,
  m.name_en                            AS material_name_en,
  m.name_vi                            AS material_name_vi,
  su.code                             AS supplier_code,
  su.name_zh                            AS supplier_name_zh,
  su.name_en                            AS supplier_name_en,
  su.name_vi                            AS supplier_name_vi,
  MAX(ml.received_at)                      AS last_received_at,
  DATE_TRUNC('week', ml.received_at)::date AS week_start,
  DATE_TRUNC('month', ml.received_at)::date AS month_start,
  COUNT(*)                            AS total_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'pending') AS pending_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'released') AS released_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'hold')     AS hold_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'rejected') AS rejected_lots,
  SUM(ml.received_qty)::numeric       AS total_qty,
  SUM(ml.received_qty) FILTER (WHERE ml.iqc_status = 'pending') AS pending_qty
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
JOIN suppliers su ON su.id = ml.supplier_id
WHERE ml.received_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY m.code, m.name_zh, m.name_en, m.name_vi,
         su.code, su.name_zh, su.name_en, su.name_vi,
         DATE_TRUNC('week', ml.received_at), DATE_TRUNC('month', ml.received_at);

-- ── Patch existing R3: Material Movement — add date columns ──────
DROP VIEW IF EXISTS v_report_material_movement;
CREATE OR REPLACE VIEW v_report_material_movement AS
SELECT
  it.tx_no,
  it.action,
  m.code                              AS material_code,
  m.name_zh                            AS material_name_zh,
  m.name_en                            AS material_name_en,
  m.name_vi                            AS material_name_vi,
  ml.lot_no,
  wo.code                             AS work_order_code,
  it.qty,
  fl.code                             AS from_location_code,
  tl.code                             AS to_location_code,
  u.display_name                      AS operator_name,
  it.occurred_at,
  DATE(it.occurred_at)                AS run_date,
  DATE_TRUNC('week', it.occurred_at)::date AS week_start,
  DATE_TRUNC('month', it.occurred_at)::date AS month_start
FROM inventory_transactions it
JOIN material_lots ml ON ml.id = it.material_lot_id
JOIN materials m ON m.id = ml.material_id
LEFT JOIN work_orders wo ON wo.id = it.work_order_id
LEFT JOIN storage_locations fl ON fl.id = it.from_location_id
LEFT JOIN storage_locations tl ON tl.id = it.to_location_id
LEFT JOIN users u ON u.id = it.operator_id
WHERE it.voided = FALSE
  AND it.occurred_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY it.occurred_at DESC;

-- ── Patch existing R7: Material Balance — add week/month columns ─
DROP VIEW IF EXISTS v_report_material_balance;
CREATE OR REPLACE VIEW v_report_material_balance AS
SELECT
  m.code                              AS material_code,
  m.name_zh                            AS material_name_zh,
  m.name_en                            AS material_name_en,
  m.name_vi                            AS material_name_vi,
  m.uom,
  COALESCE((SELECT SUM(it.qty) FROM inventory_transactions it
    JOIN material_lots ml ON ml.id = it.material_lot_id
    WHERE ml.material_id = m.id AND it.action = 'RECEIVE' AND it.voided = FALSE), 0) AS total_received,
  COALESCE((SELECT SUM(it.qty) FROM inventory_transactions it
    JOIN material_lots ml ON ml.id = it.material_lot_id
    WHERE ml.material_id = m.id AND it.action = 'ISSUE_TO_LINE' AND it.voided = FALSE), 0) AS total_issued,
  COALESCE((SELECT SUM(it.qty) FROM inventory_transactions it
    JOIN material_lots ml ON ml.id = it.material_lot_id
    WHERE ml.material_id = m.id AND it.action = 'SCRAP' AND it.voided = FALSE), 0) AS total_scrapped,
  COALESCE((SELECT SUM(it.qty) FROM inventory_transactions it
    JOIN material_lots ml ON ml.id = it.material_lot_id
    WHERE ml.material_id = m.id AND it.action = 'RETURN_FROM_LINE' AND it.voided = FALSE), 0) AS total_returned,
  COALESCE((SELECT SUM(
    CASE WHEN it.action IN ('RECEIVE','RETURN_FROM_LINE') THEN it.qty
         WHEN it.action IN ('ISSUE_TO_LINE','SCRAP','RETURN') THEN -it.qty
         ELSE 0 END
  ) FROM inventory_transactions it
    JOIN material_lots ml ON ml.id = it.material_lot_id
    WHERE ml.material_id = m.id AND it.voided = FALSE), 0) AS current_balance
FROM materials m
WHERE m.status = 'active'
ORDER BY m.code;

-- ── Patch existing R8: Delivery Risk — add week/month columns ────
DROP VIEW IF EXISTS v_report_delivery_risk;
CREATE OR REPLACE VIEW v_report_delivery_risk AS
SELECT
  cpo.po_number,
  c.name_zh                              AS customer_name_zh,
  c.name_en                              AS customer_name_en,
  c.name_vi                              AS customer_name_vi,
  p.code                              AS product_code,
  cpo.order_qty,
  COALESCE((SELECT SUM(wo.completed_qty)
    FROM work_orders wo WHERE wo.customer_po_id = cpo.id), 0) AS delivered_qty,
  cpo.order_qty - COALESCE((SELECT SUM(wo.completed_qty)
    FROM work_orders wo WHERE wo.customer_po_id = cpo.id), 0) AS balance_qty,
  cpo.due_date,
  DATE_TRUNC('week', cpo.due_date)::date AS week_start,
  DATE_TRUNC('month', cpo.due_date)::date AS month_start,
  CASE
    WHEN cpo.due_date < CURRENT_DATE THEN 'critical'
    WHEN cpo.due_date < CURRENT_DATE + INTERVAL '3 days' THEN 'high'
    WHEN cpo.due_date < CURRENT_DATE + INTERVAL '7 days' THEN 'medium'
    ELSE 'low'
  END                                 AS risk_level,
  (SELECT ARRAY_AGG(DISTINCT wo.code ORDER BY wo.code)
   FROM work_orders wo WHERE wo.customer_po_id = cpo.id) AS work_order_codes,
  (SELECT pl.numeric_line_code FROM work_orders wo
   JOIN production_lines pl ON pl.id = wo.line_id
   WHERE wo.customer_po_id = cpo.id AND wo.status IN ('running','released')
   LIMIT 1)                           AS line_code,
  (cpo.due_date - CURRENT_DATE)       AS days_remaining
FROM customer_pos cpo
JOIN customers c ON c.id = cpo.customer_id
JOIN products p ON p.id = cpo.product_id
WHERE cpo.status = 'confirmed'
ORDER BY cpo.due_date ASC;

commit;
