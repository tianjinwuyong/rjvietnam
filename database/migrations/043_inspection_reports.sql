-- Inspection System - Common Query Examples
-- NOT a migration (no schema changes). Reference queries for dashboard/reporting.
-- These queries are designed to be used in application code or BI tools.

-- ============================================================
-- 1. PENDING INSPECTIONS (Today's outstanding checks)
-- ============================================================
/*
SELECT
    ia.assignment_no,
    m.code AS machine_code,
    m.machine_type,
    mt.name_zh AS machine_type_name,
    it.template_name,
    ia.shift_type,
    ia.shift_date,
    ia.status AS assignment_status,
    u.display_name AS assigned_to
FROM inspection_assignments ia
JOIN machines m ON m.id = ia.machine_id
LEFT JOIN machine_types mt ON mt.code = m.machine_type
JOIN inspection_templates it ON it.id = ia.template_id
LEFT JOIN users u ON u.id = ia.assigned_to
WHERE ia.shift_date = CURRENT_DATE
  AND ia.status IN ('pending', 'in_progress')
ORDER BY ia.shift_type, m.code;
*/

-- ============================================================
-- 2. INSPECTION COMPLETION RATE (Daily)
-- ============================================================
/*
SELECT
    ia.shift_date,
    COUNT(*) AS total_assignments,
    COUNT(*) FILTER (WHERE ia.status = 'completed') AS completed,
    ROUND(COUNT(*) FILTER (WHERE ia.status = 'completed') * 100.0 / COUNT(*), 1) AS completion_pct
FROM inspection_assignments ia
WHERE ia.shift_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY ia.shift_date
ORDER BY ia.shift_date DESC;
*/

-- ============================================================
-- 3. ABNORMALITY SUMMARY (Open/Unresolved)
-- ============================================================
/*
SELECT
    ia.abnormal_no,
    m.code AS machine_code,
    m.machine_type,
    ia.abnormality_type,
    ia.severity,
    ia.description,
    ia.status,
    ia.reported_at,
    ia.reported_by_name,
    COALESCE(ia.maintenance_order_no, 'Not linked') AS maintenance_order_no
FROM inspection_abnormals ia
JOIN machines m ON m.id = ia.machine_id
WHERE ia.status IN ('reported', 'acknowledged')
ORDER BY ia.severity DESC, ia.reported_at DESC;
*/

-- ============================================================
-- 4. OEE DASHBOARD (Daily trend, last 7 days)
-- ============================================================
/*
SELECT
    ol.log_date,
    m.code AS machine_code,
    m.machine_type,
    ol.shift_type,
    ol.planned_prod_hours,
    ol.actual_prod_hours,
    ol.downtime_minutes,
    ol.output_qty,
    ol.defect_qty,
    ol.oee_availability,
    ol.oee_quality,
    ol.oee_overall
FROM machine_oee_logs ol
JOIN machines m ON m.id = ol.machine_id
WHERE ol.log_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY ol.log_date DESC, m.code;
*/

-- ============================================================
-- 5. MACHINE WITH WORST OEE TODAY
-- ============================================================
/*
SELECT
    m.code AS machine_code,
    m.machine_type,
    ol.oee_overall,
    ol.oee_availability,
    ol.oee_quality,
    ol.downtime_minutes,
    ol.defect_qty
FROM machine_oee_logs ol
JOIN machines m ON m.id = ol.machine_id
WHERE ol.log_date = CURRENT_DATE
ORDER BY ol.oee_overall ASC
LIMIT 5;
*/

-- ============================================================
-- 6. INSPECTION DETAIL WITH ITEMS (Complete check view)
-- ============================================================
/*
SELECT
    ir.record_no,
    m.code AS machine_code,
    ir.shift_date,
    ir.shift_type,
    ir.overall_result,
    ir.total_items,
    ir.passed_items,
    ir.failed_items,
    ir.has_critical_fail,
    ir.inspector_name,
    ir.completed_at,
    iri.item_no,
    iri.result AS item_result,
    iri.measured_value,
    iri.notes AS item_notes,
    iti.check_point,
    iti.pass_criteria,
    iti.fail_action,
    iti.is_critical_safety
FROM inspection_records ir
JOIN machines m ON m.id = ir.machine_id
JOIN inspection_record_items iri ON iri.record_id = ir.id
JOIN inspection_template_items iti ON iti.id = iri.template_item_id
WHERE ir.shift_date = CURRENT_DATE
ORDER BY ir.record_no, iri.item_no;
*/

-- ============================================================
-- 7. MACHINE STATUS OVERVIEW (Real-time dashboard)
-- ============================================================
/*
SELECT
    mss.machine_id,
    m.code AS machine_code,
    m.machine_type,
    mss.status,
    mss.current_product,
    mss.current_work_order,
    mss.output_counter,
    mss.defect_counter,
    mss.running_hours,
    mss.last_updated
FROM machine_status_snapshots mss
JOIN machines m ON m.id = mss.machine_id
ORDER BY m.line_id, m.code;
*/

-- ============================================================
-- 8. WEEKLY INSPECTION FAIL RATE BY MACHINE TYPE
-- ============================================================
/*
SELECT
    m.machine_type,
    COUNT(*) AS total_inspections,
    COUNT(*) FILTER (WHERE ir.overall_result = 'pass') AS passed,
    COUNT(*) FILTER (WHERE ir.overall_result = 'fail') AS failed,
    COUNT(*) FILTER (WHERE ir.has_critical_fail) AS critical_fails,
    ROUND(COUNT(*) FILTER (WHERE ir.overall_result = 'fail') * 100.0 / NULLIF(COUNT(*), 0), 2) AS fail_rate_pct
FROM inspection_records ir
JOIN machines m ON m.id = ir.machine_id
WHERE ir.shift_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY m.machine_type
ORDER BY fail_rate_pct DESC;
*/

-- ============================================================
-- 9. MTBF/MTTR CALCULATION (Last 30 days)
-- ============================================================
/*
SELECT
    m.code AS machine_code,
    m.machine_type,
    COUNT(be.id) AS breakdown_count,
    COALESCE(SUM(be.downtime_minutes), 0) AS total_downtime_min,
    CASE WHEN COUNT(be.id) > 0
         THEN ROUND(COALESCE(SUM(be.downtime_minutes), 0) / COUNT(be.id)::numeric, 1)
         ELSE 0
    END AS mttr_minutes,
    CASE WHEN COUNT(be.id) > 0
         THEN ROUND((30 * 24 * 60 - COALESCE(SUM(be.downtime_minutes), 0)) / COUNT(be.id)::numeric, 0)
         ELSE NULL
    END AS mtbf_minutes
FROM machines m
LEFT JOIN equipment_assets ea ON ea.machine_id = m.id
LEFT JOIN breakdown_events be ON be.asset_id = ea.id
    AND be.start_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY m.id, m.code, m.machine_type
ORDER BY breakdown_count DESC;
*/
