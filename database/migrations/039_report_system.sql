-- ============================================================
-- 039: Report System — Views + SQL Functions
-- 8 reports backed by existing schema tables
-- No new tables — all derived from existing partitioned tables
-- ============================================================

-- ── R1: Work Order Progress ───────────────────────────────────
CREATE OR REPLACE VIEW v_report_work_order_progress AS
SELECT
  wo.code                              AS work_order_code,
  p.code                              AS product_code,
  pl.internal_code                    AS line_code,
  wo.work_order_type                  AS type,
  wo.planned_qty,
  wo.completed_qty,
  ROUND(wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0) * 100, 1) AS progress_pct,
  wo.status,
  wo.released_at,
  wo.closed_at,
  jsonb_build_object('zh',c.name_zh,'en',c.name_en,'vi',c.name_vi) AS customer_name,
  cpo.due_date
FROM work_orders wo
JOIN customer_pos cpo ON cpo.id = wo.customer_po_id
JOIN customers c ON c.id = cpo.customer_id
JOIN products p ON p.id = wo.product_id
JOIN production_lines pl ON pl.id = wo.line_id
WHERE wo.status != 'voided'
ORDER BY wo.created_at DESC;

-- ── R2: Inventory Ledger (current stock per lot) ──────────────
CREATE OR REPLACE VIEW v_report_inventory_ledger AS
SELECT
  m.code                              AS material_code,
  jsonb_build_object('zh',m.name_zh,'en',m.name_en,'vi',m.name_vi) AS material_name,
  su.code                             AS supplier_code,
  jsonb_build_object('zh',su.name_zh,'en',su.name_en,'vi',su.name_vi) AS supplier_name,
  ml.lot_no,
  ml.iqc_status,
  ml.received_qty                     AS initial_qty,
  ml.received_qty
    + COALESCE((SELECT SUM(
        CASE WHEN it.action IN ('RECEIVE','RETURN_FROM_LINE','ADJUST') THEN it.qty
             WHEN it.action IN ('ISSUE_TO_LINE','PICK','SCRAP','RETURN') THEN -it.qty
             ELSE 0 END)
        FROM inventory_transactions it
        WHERE it.material_lot_id = ml.id AND it.voided = FALSE), 0) AS current_qty,
  COALESCE((SELECT tl.code FROM inventory_transactions it
    LEFT JOIN storage_locations tl ON tl.id = it.to_location_id
    WHERE it.material_lot_id = ml.id AND it.voided = FALSE
    ORDER BY it.occurred_at DESC LIMIT 1), 'N/A') AS location_code,
  ml.received_at,
  (SELECT MAX(it.occurred_at) FROM inventory_transactions it
   WHERE it.material_lot_id = ml.id AND it.voided = FALSE) AS last_movement_at,
  m.msd_level,
  m.shelf_life_days,
  0                                   AS reserved_qty
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
JOIN suppliers su ON su.id = ml.supplier_id
WHERE ml.received_qty > 0;

-- ── R3: Material Movement (full transaction log) ──────────────
CREATE OR REPLACE VIEW v_report_material_movement AS
SELECT
  it.tx_no,
  it.action,
  m.code                              AS material_code,
  jsonb_build_object('zh',m.name_zh,'en',m.name_en,'vi',m.name_vi) AS material_name,
  ml.lot_no,
  wo.code                             AS work_order_code,
  it.qty,
  fl.code                             AS from_location_code,
  tl.code                             AS to_location_code,
  u.display_name                      AS operator_name,
  it.occurred_at
FROM inventory_transactions it
JOIN material_lots ml ON ml.id = it.material_lot_id
JOIN materials m ON m.id = ml.material_id
LEFT JOIN work_orders wo ON wo.id = it.work_order_id
LEFT JOIN storage_locations fl ON fl.id = it.from_location_id
LEFT JOIN storage_locations tl ON tl.id = it.to_location_id
LEFT JOIN users u ON u.id = it.operator_id
WHERE it.voided = FALSE
ORDER BY it.occurred_at DESC;

-- ── R4: IQC Summary (by material + supplier) ──────────────────
CREATE OR REPLACE VIEW v_report_iqc_summary AS
SELECT
  m.code                              AS material_code,
  jsonb_build_object('zh',m.name_zh,'en',m.name_en,'vi',m.name_vi) AS material_name,
  su.code                             AS supplier_code,
  jsonb_build_object('zh',su.name_zh,'en',su.name_en,'vi',su.name_vi) AS supplier_name,
  COUNT(*)                            AS total_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'pending') AS pending_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'released') AS released_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'hold')     AS hold_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'rejected') AS rejected_lots,
  SUM(ml.received_qty)::numeric       AS total_qty,
  SUM(ml.received_qty) FILTER (WHERE ml.iqc_status = 'pending') AS pending_qty,
  MAX(ml.received_at)                 AS last_received_at
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
JOIN suppliers su ON su.id = ml.supplier_id
GROUP BY m.code, m.name_zh, m.name_en, m.name_vi,
         su.code, su.name_zh, su.name_en, su.name_vi;

-- ── R5: OEE by Line (daily, from station_events) ──────────────
-- OEE = Availability × Performance × Quality
-- Availability = (Planned - Downtime) / Planned
-- Performance  = ActualOutput / IdealOutput  (ideal = 60 units/min placeholder)
-- Quality      = GoodOutput / TotalOutput
CREATE OR REPLACE VIEW v_report_oee_by_line AS
WITH daily_stats AS (
  SELECT
    pl.numeric_line_code               AS line_code,
    DATE(se.occurred_at)               AS run_date,
    COUNT(DISTINCT s.id)               AS station_count,
    -- planned minutes = 8h × station_count (each station = 1 operator)
    COUNT(DISTINCT DATE(se.occurred_at)) * 480 AS planned_minutes,
    -- downtime: events with result = 'downtime'
    COUNT(*) FILTER (WHERE se.result = 'downtime'
      AND se.event_type = 'scan_in')   AS downtime_events,
    -- total scans (proxy for output)
    COUNT(*) FILTER (WHERE se.event_type = 'scan_in') AS total_scans,
    -- pass scans
    COUNT(*) FILTER (WHERE se.event_type = 'scan_in' AND se.result = 'pass') AS pass_scans,
    -- fail scans
    COUNT(*) FILTER (WHERE se.event_type = 'scan_in' AND se.result = 'fail') AS fail_scans
  FROM station_events se
  JOIN stations s ON s.id = se.station_id
  JOIN production_lines pl ON pl.id = s.line_id
  WHERE se.occurred_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY pl.numeric_line_code, DATE(se.occurred_at)
)
SELECT
  ds.line_code,
  jsonb_build_object('zh',pl.name_zh,'en',pl.name_en,'vi',pl.name_vi) AS line_name,
  ds.run_date                             AS date,
  ds.planned_minutes,
  (ds.downtime_events * 5)                AS downtime_minutes,  -- 5 min per downtime event
  GREATEST(0, ds.planned_minutes - ds.downtime_events * 5) AS available_minutes,
  ds.pass_scans                           AS total_output,
  ds.fail_scans                           AS defect_count,
  ROUND(
    GREATEST(0, ds.planned_minutes - ds.downtime_events * 5)::numeric
    / NULLIF(ds.planned_minutes, 0) * 100, 1
  )                                       AS availability,
  -- performance: placeholder ideal = 1 scan/min per station
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

-- ── R6: Defect Analysis ────────────────────────────────────────
-- Counts defects via quality_inspections (fail) joined through
-- repair_records → defect_codes
CREATE OR REPLACE VIEW v_report_defect_analysis AS
SELECT
  dc.code                              AS defect_code,
  jsonb_build_object('zh',dc.name_zh,'en',dc.name_en,'vi',dc.name_vi) AS defect_name,
  COALESCE(dc.severity, 'major')       AS severity,
  qi.station_type,
  COUNT(*)                             AS count,
  ROUND(COUNT(*)::numeric /
    NULLIF((SELECT COUNT(*) FROM quality_inspections WHERE result = 'fail'), 0) * 100, 1
  )                                    AS percentage,
  NULL                                 AS avg_repair_minutes,
  (
    SELECT wo.code
    FROM repair_records rr
    JOIN quality_inspections qi2 ON qi2.id = rr.inspection_id
    JOIN work_orders wo ON wo.id = qi2.work_order_id
    WHERE qi2.station_type = qi.station_type
    GROUP BY wo.code
    ORDER BY COUNT(*) DESC
    LIMIT 1
  )                                    AS top_work_order_code
FROM quality_inspections qi
JOIN repair_records rr ON rr.inspection_id = qi.id
JOIN defect_codes dc ON dc.id = rr.defect_code_id
WHERE qi.result = 'fail'
  AND qi.occurred_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY dc.code, dc.name_zh, dc.name_en, dc.name_vi, dc.severity, qi.station_type
ORDER BY count DESC;

-- ── R7: Material Balance (summary by material) ────────────────
CREATE OR REPLACE VIEW v_report_material_balance AS
SELECT
  m.code                              AS material_code,
  jsonb_build_object('zh',m.name_zh,'en',m.name_en,'vi',m.name_vi) AS material_name,
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

-- ── R8: Delivery Risk ──────────────────────────────────────────
CREATE OR REPLACE VIEW v_report_delivery_risk AS
SELECT
  cpo.po_number,
  jsonb_build_object('zh',c.name_zh,'en',c.name_en,'vi',c.name_vi) AS customer_name,
  p.code                              AS product_code,
  cpo.order_qty,
  COALESCE((SELECT SUM(wo.completed_qty)
    FROM work_orders wo WHERE wo.customer_po_id = cpo.id), 0) AS delivered_qty,
  cpo.order_qty - COALESCE((SELECT SUM(wo.completed_qty)
    FROM work_orders wo WHERE wo.customer_po_id = cpo.id), 0) AS balance_qty,
  cpo.due_date,
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

-- ── Report roles ( Upsert — idempotent) ───────────────────────
INSERT INTO roles (code, name_zh, name_en, name_vi)
VALUES ('reports_viewer', '报表查看员', 'Report Viewer', 'Người xem báo cáo')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name_zh, name_en, name_vi)
VALUES ('reports_admin', '报表管理员', 'Report Admin', 'Quản trị báo cáo')
ON CONFLICT (code) DO NOTHING;
