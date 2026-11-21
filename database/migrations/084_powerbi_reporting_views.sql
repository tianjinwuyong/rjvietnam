-- ============================================================
-- Migration 084: Power BI Reporting Views
-- Star-schema dimension + fact views for DirectQuery
-- Power BI connects via: postgresql://postgres:postgres@127.0.0.1:5432/smt_factory
-- ============================================================

-- ============================================================
-- 1. DIMENSION VIEWS
-- ============================================================

-- ── Dim: Date ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_date AS
WITH dates AS (
  SELECT d::date AS date
  FROM generate_series('2026-01-01'::date, '2035-12-31'::date, '1 day'::interval) d
)
SELECT
  date,
  EXTRACT(YEAR  FROM date)::int        AS year,
  EXTRACT(MONTH FROM date)::int        AS month,
  EXTRACT(DAY   FROM date)::int        AS day,
  EXTRACT(QUARTER FROM date)::int      AS quarter,
  EXTRACT(DOW FROM date)::int          AS day_of_week,
  EXTRACT(DOY FROM date)::int          AS day_of_year,
  TO_CHAR(date, 'YYYY-MM')            AS year_month,
  TO_CHAR(date, 'YYYY-Q"Q"')          AS year_quarter,
  CASE WHEN EXTRACT(DOW FROM date) IN (0,6) THEN true ELSE false END AS is_weekend,
  date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE AS is_last_7_days,
  date BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE AS is_last_30_days,
  date BETWEEN date_trunc('month', CURRENT_DATE) AND CURRENT_DATE AS is_current_month
FROM dates;

-- ── Dim: Production Line ──────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_line AS
SELECT
  id            AS line_id,
  internal_code AS line_code,
  numeric_line_code,
  name_zh       AS line_name_zh,
  name_en       AS line_name_en,
  name_vi       AS line_name_vi,
  status        AS line_status,
  created_at
FROM production_lines
WHERE status != 'voided';

-- ── Dim: Station ───────────────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_station AS
SELECT
  s.id              AS station_id,
  s.code            AS station_code,
  s.name_zh         AS station_name_zh,
  s.name_en         AS station_name_en,
  s.name_vi         AS station_name_vi,
  s.line_id,
  pl.internal_code  AS line_code,
  st.code           AS station_type_code,
  st.category       AS station_category,
  s.sequence_order,
  s.equipment_code,
  s.ip_address,
  s.status          AS station_status,
  ss.parent_line_code
FROM stations s
JOIN production_lines pl ON pl.id = s.line_id
LEFT JOIN station_types st ON st.id = s.station_type_id
LEFT JOIN station_sequences ss ON ss.station_code = s.code AND ss.line_code = pl.internal_code
WHERE s.status != 'voided';

-- ── Dim: Product ───────────────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_product AS
SELECT
  id          AS product_id,
  code        AS product_code,
  name_zh     AS product_name_zh,
  name_en     AS product_name_en,
  name_vi     AS product_name_vi,
  revision    AS product_revision,
  status      AS product_status
FROM products
WHERE status != 'voided';

-- ── Dim: Customer ──────────────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_customer AS
SELECT
  id          AS customer_id,
  code        AS customer_code,
  name_zh     AS customer_name_zh,
  name_en     AS customer_name_en,
  name_vi     AS customer_name_vi,
  status      AS customer_status
FROM customers
WHERE status != 'voided';

-- ── Dim: Employee (Operator) ──────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_employee AS
SELECT
  e.id              AS employee_id,
  e.employee_no,
  e.full_name       AS employee_name,
  e.name_zh         AS employee_name_zh,
  e.name_en         AS employee_name_en,
  e.name_vi         AS employee_name_vi,
  d.code            AS department_code,
  d.name_zh         AS department_name_zh,
  d.name_en         AS department_name_en,
  d.name_vi         AS department_name_vi,
  p.code            AS position_code,
  p.name_zh         AS position_name_zh,
  e.employment_type,
  e.hire_date,
  e.status          AS employee_status,
  u.username        AS user_username,
  u.locale          AS user_locale
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN positions p ON p.id = e.position_id
LEFT JOIN users u ON u.id = e.user_id
WHERE e.status != 'voided';

-- ── Dim: Work Order ────────────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_work_order AS
SELECT
  wo.id               AS work_order_id,
  wo.code             AS work_order_code,
  wo.work_order_type,
  CASE wo.work_order_type
    WHEN 1 THEN '正常工单'
    WHEN 2 THEN '返修工单'
    WHEN 3 THEN '样品工单'
  END                 AS work_order_type_name,
  wo.planned_qty,
  wo.completed_qty,
  ROUND(wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0) * 100, 1) AS progress_pct,
  wo.status           AS work_order_status,
  wo.released_at,
  wo.closed_at,
  wo.product_id,
  wo.line_id,
  wo.customer_po_id,
  wo.created_by       AS created_by_user_id,
  wo.created_at       AS work_order_created_at
FROM work_orders wo
WHERE wo.status != 'voided';

-- ── Dim: Defect Code ──────────────────────────────────────────
CREATE OR REPLACE VIEW powerbi_dim_defect_code AS
SELECT
  id          AS defect_code_id,
  code        AS defect_code,
  name_zh     AS defect_name_zh,
  name_en     AS defect_name_en,
  name_vi     AS defect_name_vi,
  severity    AS defect_severity
FROM defect_codes
ORDER BY code;

-- ============================================================
-- 2. FACT VIEWS (aggregated for performance)
-- ============================================================

-- ── Fact: Station Events Daily (核心生产事实表) ────────────────
-- Grain: 1 row per (line, station, date)
-- Covers: throughput, pass/fail, OEE components
CREATE OR REPLACE VIEW powerbi_fact_station_events_daily AS
SELECT
  pl.internal_code                                        AS line_code,
  s.code                                                  AS station_code,
  s.name_zh                                               AS station_name_zh,
  DATE(se.occurred_at)                                    AS event_date,
  COUNT(*)                                                AS total_events,
  COUNT(*) FILTER (WHERE se.event_type = 'scan_in')      AS scan_in_events,
  COUNT(*) FILTER (WHERE se.event_type = 'scan_in'
    AND se.result = 'pass')                               AS pass_count,
  COUNT(*) FILTER (WHERE se.event_type = 'scan_in'
    AND se.result = 'fail')                               AS fail_count,
  COUNT(*) FILTER (WHERE se.result = 'downtime')          AS downtime_events,
  COUNT(DISTINCT se.pcb_serial_id)                        AS distinct_pcb_count,
  COUNT(DISTINCT se.operator_id)                          AS distinct_operator_count,
  MIN(se.occurred_at)                                     AS first_event_at,
  MAX(se.occurred_at)                                     AS last_event_at,
  EXTRACT(EPOCH FROM MAX(se.occurred_at) - MIN(se.occurred_at)) / 60 AS active_minutes
FROM station_events se
JOIN stations s ON s.id = se.station_id
JOIN production_lines pl ON pl.id = s.line_id
GROUP BY pl.internal_code, s.code, s.name_zh, DATE(se.occurred_at);

COMMENT ON VIEW powerbi_fact_station_events_daily IS
  'Grain: (line_code, station_code, date). Aggregated from station_events for Power BI throughput/OEE reporting. ~300K rows expected/month.';

-- ── Fact: Work Order Progress (工单进度事实表) ─────────────────
-- Grain: 1 row per work_order
CREATE OR REPLACE VIEW powerbi_fact_work_order AS
SELECT
  wo.code                     AS work_order_code,
  wo.work_order_type,
  pl.internal_code            AS line_code,
  p.code                      AS product_code,
  c.code                      AS customer_code,
  cpo.po_number,
  wo.planned_qty,
  wo.completed_qty,
  ROUND(wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0) * 100, 1) AS progress_pct,
  wo.planned_qty - wo.completed_qty                      AS remaining_qty,
  wo.status                   AS work_order_status,
  cpo.due_date,
  wo.released_at,
  wo.closed_at,
  CASE
    WHEN wo.status IN ('closed','cancelled','voided') THEN 'closed'
    WHEN wo.released_at IS NULL THEN 'pending_release'
    WHEN wo.completed_qty >= wo.planned_qty THEN 'completed'
    ELSE 'in_progress'
  END                         AS progress_status,
  CASE
    WHEN cpo.due_date < CURRENT_DATE AND wo.status NOT IN ('closed','cancelled','voided') THEN true
    ELSE false
  END                         AS is_overdue,
  (CURRENT_DATE - cpo.due_date) AS overdue_days,
  wo.created_at               AS work_order_created_at
FROM work_orders wo
JOIN production_lines pl ON pl.id = wo.line_id
JOIN products p ON p.id = wo.product_id
JOIN customer_pos cpo ON cpo.id = wo.customer_po_id
JOIN customers c ON c.id = cpo.customer_id
WHERE wo.status != 'voided';

-- ── Fact: Quality Defects (质量缺陷事实表) ─────────────────────
-- Grain: 1 row per defect occurrence
CREATE OR REPLACE VIEW powerbi_fact_quality_defects AS
SELECT
  qi.id                       AS inspection_id,
  qi.inspection_no,
  qi.work_order_id,
  wo.code                     AS work_order_code,
  qi.pcb_serial_id,
  ps.serial_no                AS pcb_serial_no,
  qi.station_type,
  qi.result                   AS inspection_result,
  qi.operator_id              AS inspector_id,
  qi.occurred_at              AS inspection_date,
  rr.id                       AS repair_id,
  rr.repair_no,
  rr.defect_code_id,
  dc.code                     AS defect_code,
  dc.name_zh                  AS defect_name_zh,
  dc.severity                 AS defect_severity,
  rr.action_taken,
  rr.result                   AS repair_result,
  rr.closed_at                AS repair_closed_at
FROM quality_inspections qi
LEFT JOIN work_orders wo ON wo.id = qi.work_order_id
LEFT JOIN pcb_serials ps ON ps.id = qi.pcb_serial_id
LEFT JOIN repair_records rr ON rr.inspection_id = qi.id
LEFT JOIN defect_codes dc ON dc.id = rr.defect_code_id;

-- ── Fact: Material Inventory Balance (物料库存事实表) ──────────
-- Grain: 1 row per material at current snapshot
CREATE OR REPLACE VIEW powerbi_fact_inventory_current AS
SELECT
  m.code                      AS material_code,
  m.name_zh                   AS material_name_zh,
  m.material_type,
  m.uom,
  m.msd_level,
  m.shelf_life_days,
  COUNT(DISTINCT ml.id)       AS lot_count,
  SUM(ml.received_qty)        AS total_received_qty,
  COALESCE(SUM(
    CASE WHEN it.action IN ('RECEIVE','RETURN_FROM_LINE','ADJUST') THEN it.qty
         WHEN it.action IN ('ISSUE_TO_LINE','PICK','SCRAP','RETURN') THEN -it.qty
         ELSE 0 END
  ), 0)                       AS current_balance,
  MAX(ml.received_at)         AS last_received_at,
  MAX(it.occurred_at)         AS last_movement_at
FROM materials m
LEFT JOIN material_lots ml ON ml.material_id = m.id AND ml.iqc_status NOT IN ('rejected','voided')
LEFT JOIN inventory_transactions it ON it.material_lot_id = ml.id AND it.voided = false
WHERE m.status = 'active'
GROUP BY m.id, m.code, m.name_zh, m.material_type, m.uom, m.msd_level, m.shelf_life_days;

-- ── Fact: Daily Line OEE (产线每日OEE事实表) ──────────────────
-- Pre-computed from station_events for fast Power BI queries
CREATE OR REPLACE VIEW powerbi_fact_oee_daily AS
SELECT
  v.line_code,
  v.date,
  v.availability,
  v.performance,
  v.quality,
  v.oee,
  v.planned_minutes,
  v.available_minutes,
  v.total_output,
  v.defect_count
FROM v_report_oee_by_line v;

-- ── Fact: Attendance Daily (出勤事实表) ────────────────────────
CREATE OR REPLACE VIEW powerbi_fact_attendance_daily AS
SELECT
  ar.employee_id,
  e.employee_no,
  e.full_name                 AS employee_name,
  d.code                      AS department_code,
  d.name_zh                   AS department_name_zh,
  ar.date                     AS attendance_date,
  ar.clock_in,
  ar.clock_out,
  ar.status                   AS attendance_status,
  CASE
    WHEN ar.clock_in IS NOT NULL AND ar.clock_out IS NOT NULL
      THEN EXTRACT(EPOCH FROM ar.clock_out - ar.clock_in) / 3600
    ELSE 0
  END                         AS work_hours
FROM attendance_records ar
JOIN employees e ON e.id = ar.employee_id
LEFT JOIN departments d ON d.id = e.department_id;

-- ── Fact: Delivery Risk (交期风险事实表) ──────────────────────
CREATE OR REPLACE VIEW powerbi_fact_delivery_risk AS
SELECT
  v.*
FROM v_report_delivery_risk v;

-- ============================================================
-- 3. Metadata: register views for auto-discovery
-- ============================================================
COMMENT ON VIEW powerbi_dim_date IS 'PBI: Date dimension (2026-2035)';
COMMENT ON VIEW powerbi_dim_line IS 'PBI: Production line dimension';
COMMENT ON VIEW powerbi_dim_station IS 'PBI: Station dimension with type and line';
COMMENT ON VIEW powerbi_dim_product IS 'PBI: Product dimension';
COMMENT ON VIEW powerbi_dim_customer IS 'PBI: Customer dimension';
COMMENT ON VIEW powerbi_dim_employee IS 'PBI: Employee/operator dimension with department';
COMMENT ON VIEW powerbi_dim_work_order IS 'PBI: Work order dimension';
COMMENT ON VIEW powerbi_dim_defect_code IS 'PBI: Defect code dimension';
COMMENT ON VIEW powerbi_fact_station_events_daily IS 'PBI: Daily station event aggregation (core fact)';
COMMENT ON VIEW powerbi_fact_work_order IS 'PBI: Work order progress fact';
COMMENT ON VIEW powerbi_fact_quality_defects IS 'PBI: Quality defect fact';
COMMENT ON VIEW powerbi_fact_inventory_current IS 'PBI: Current inventory balance fact';
COMMENT ON VIEW powerbi_fact_oee_daily IS 'PBI: Daily OEE fact (from v_report_oee_by_line)';
COMMENT ON VIEW powerbi_fact_attendance_daily IS 'PBI: Daily attendance fact';
COMMENT ON VIEW powerbi_fact_delivery_risk IS 'PBI: Delivery risk fact (from v_report_delivery_risk)';
