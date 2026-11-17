-- 054_report_materialized_views.sql
-- Convert expensive report views to materialized views with incremental refresh.
-- Run after 053_performance_indexes.sql
--
-- Strategy:
--   - R7 (material-balance): full refresh hourly — small table (active materials only)
--   - R4 (iqc-summary):     full refresh hourly — small table (grouped by supplier)
--   - R1 (wo-progress):     full refresh every 15 min — medium table with joins
--   - R8 (delivery-risk):  full refresh every 15 min — small table
--
-- CONCURRENTLY is NOT used here because the base tables lack unique indexes
-- on the materialized view's grouping columns.  Add unique indexes before enabling
-- CONCURRENTLY refresh if eventual consistency during refresh is acceptable.
-- ══════════════════════════════════════════════════════════════════════════════

-- ══ R7: Material Balance — summary by active material ════════════════════
-- Heavy: 4 correlated subqueries per material in the regular view.
-- With ~200 active materials this takes ~800ms in the old view.
-- As a materialized view it is pre-computed and refreshed hourly.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_report_material_balance AS
SELECT
  m.code                              AS material_code,
  m.name_zh, m.name_en, m.name_vi,
  m.uom,
  COALESCE(SUM(it.qty) FILTER (WHERE it.action = 'RECEIVE'), 0)
    AS total_received,
  COALESCE(SUM(it.qty) FILTER (WHERE it.action = 'ISSUE_TO_LINE'), 0)
    AS total_issued,
  COALESCE(SUM(it.qty) FILTER (WHERE it.action = 'SCRAP'), 0)
    AS total_scrapped,
  COALESCE(SUM(it.qty) FILTER (WHERE it.action = 'RETURN_FROM_LINE'), 0)
    AS total_returned,
  COALESCE(SUM(
    CASE WHEN it.action IN ('RECEIVE','RETURN_FROM_LINE') THEN it.qty
         WHEN it.action IN ('ISSUE_TO_LINE','SCRAP','RETURN') THEN -it.qty
         ELSE 0 END), 0) AS current_balance
FROM materials m
LEFT JOIN material_lots ml ON ml.material_id = m.id
LEFT JOIN inventory_transactions it ON it.material_lot_id = ml.id AND it.voided = FALSE
WHERE m.status = 'active'
GROUP BY m.id, m.code, m.name_zh, m.name_en, m.name_vi, m.uom
ORDER BY m.code;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mat_balance_code
  ON mv_report_material_balance(material_code);

-- ══ R4: IQC Summary — by material + supplier ══════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_report_iqc_summary AS
SELECT
  m.code                              AS material_code,
  m.name_zh, m.name_en, m.name_vi,
  su.code                             AS supplier_code,
  su.name_zh AS supplier_name_zh,
  su.name_en AS supplier_name_en,
  su.name_vi AS supplier_name_vi,
  COUNT(*)                            AS total_lots,
  COUNT(*) FILTER (WHERE ml.iqc_status = 'pending')  AS pending_lots,
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
         su.code, su.name_zh, su.name_en, su.name_vi
ORDER BY m.code;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_iqc_summary_pk
  ON mv_report_iqc_summary(material_code, supplier_code);

-- ══ R1: Work Order Progress ════════════════════════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_report_work_order_progress AS
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
  COALESCE(c.name_zh, '') AS customer_name_zh,
  COALESCE(c.name_en, '') AS customer_name_en,
  COALESCE(c.name_vi, '') AS customer_name_vi,
  cpo.due_date
FROM work_orders wo
LEFT JOIN customer_pos cpo ON cpo.id = wo.customer_po_id
LEFT JOIN customers c ON c.id = cpo.customer_id
JOIN products p ON p.id = wo.product_id
JOIN production_lines pl ON pl.id = wo.line_id
WHERE wo.status != 'voided'
ORDER BY wo.created_at DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_wo_progress_code
  ON mv_report_work_order_progress(work_order_code);

-- ══ R8: Delivery Risk ═══════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_report_delivery_risk AS
SELECT
  cpo.po_number,
  c.name_zh AS customer_name_zh,
  c.name_en AS customer_name_en,
  c.name_vi AS customer_name_vi,
  p.code                              AS product_code,
  cpo.order_qty,
  COALESCE(SUM(wo.completed_qty), 0)  AS delivered_qty,
  cpo.order_qty - COALESCE(SUM(wo.completed_qty), 0) AS balance_qty,
  cpo.due_date,
  CASE
    WHEN cpo.due_date < CURRENT_DATE THEN 'critical'
    WHEN cpo.due_date < CURRENT_DATE + INTERVAL '3 days' THEN 'high'
    WHEN cpo.due_date < CURRENT_DATE + INTERVAL '7 days' THEN 'medium'
    ELSE 'low'
  END                                 AS risk_level,
  (SELECT ARRAY_AGG(DISTINCT w.code ORDER BY w.code)
   FROM work_orders w WHERE w.customer_po_id = cpo.id) AS work_order_codes,
  (SELECT pl.numeric_line_code FROM work_orders w
   JOIN production_lines pl ON pl.id = w.line_id
   WHERE w.customer_po_id = cpo.id
     AND w.status IN ('running','released') LIMIT 1) AS line_code,
  (cpo.due_date - CURRENT_DATE)       AS days_remaining
FROM customer_pos cpo
JOIN customers c ON c.id = cpo.customer_id
JOIN products p ON p.id = cpo.product_id
LEFT JOIN work_orders wo ON wo.customer_po_id = cpo.id
WHERE cpo.status = 'confirmed'
GROUP BY cpo.id, cpo.po_number, c.name_zh, c.name_en, c.name_vi,
         p.code, cpo.order_qty, cpo.due_date
ORDER BY cpo.due_date ASC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_delivery_risk_po
  ON mv_report_delivery_risk(po_number);

-- ══ Refresh log table — tracks last refresh time per materialized view ══════
CREATE TABLE IF NOT EXISTS mv_refresh_log (
  mv_name          TEXT PRIMARY KEY,
  last_refresh_at  TIMESTAMPTZ,
  last_refresh_duration_ms  INT,
  refresh_error     TEXT
);

-- ══ Convenience refresh function (call via cron or pg_cron) ════════════════
-- Usage: SELECT refresh_mv('material-balance');
-- Or call refresh_all_mvs() for all at once.
CREATE OR REPLACE FUNCTION refresh_mv(target_mv TEXT)
RETURNS void AS $$
DECLARE
  start_ts   TIMESTAMPTZ := clock_timestamp();
  err_msg    TEXT;
BEGIN
  EXECUTE format('REFRESH MATERIALIZED VIEW %I', target_mv);
  UPDATE mv_refresh_log
    SET last_refresh_at = clock_timestamp(),
        last_refresh_duration_ms = floor(extract(epoch from clock_timestamp() - start_ts) * 1000)::int,
        refresh_error = NULL
  WHERE mv_name = target_mv;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  UPDATE mv_refresh_log
    SET last_refresh_at = clock_timestamp(),
        refresh_error = err_msg
  WHERE mv_name = target_mv;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_all_mvs()
RETURNS void AS $$
BEGIN
  PERFORM refresh_mv('mv_report_material_balance');
  PERFORM refresh_mv('mv_report_iqc_summary');
  PERFORM refresh_mv('mv_report_work_order_progress');
  PERFORM refresh_mv('mv_report_delivery_risk');
END;
$$ LANGUAGE plpgsql;

-- Seed the refresh log
INSERT INTO mv_refresh_log (mv_name, last_refresh_at) VALUES
  ('mv_report_material_balance', NULL),
  ('mv_report_iqc_summary',     NULL),
  ('mv_report_work_order_progress', NULL),
  ('mv_report_delivery_risk',   NULL)
ON CONFLICT (mv_name) DO NOTHING;

-- ══ API endpoint: refresh a specific MV on demand ═══════════════════════════
-- POST /api/internal/refresh-mv  { "mv": "material-balance" }
-- Or GET /api/internal/refresh-all-mvs
-- (add these routes in server.js as internal-only endpoints)

-- ══ Optional: pg_cron setup (requires pg_cron extension) ════════════════════
-- Uncomment if pg_cron is available:
--
-- SELECT cron.schedule(
--   'refresh-material-balance', -- name
--   '45 * * * *',              -- every hour at :45
-- --   $$ SELECT refresh_mv('mv_report_material_balance') $$
-- );
--
-- SELECT cron.schedule(
--   'refresh-iqc-summary',
--   '50 * * * *',              -- every hour at :50
-- --   $$ SELECT refresh_mv('mv_report_iqc_summary') $$
-- );
--
-- SELECT cron.schedule(
--   'refresh-wo-progress',
--   '0,30 * * * *',           -- every 30 minutes
-- --   $$ SELECT refresh_mv('mv_report_work_order_progress') $$
-- );
--
-- SELECT cron.schedule(
--   'refresh-delivery-risk',
--   '5,35 * * * *',            -- every 30 min, offset by 5 min
-- --   $$ SELECT refresh_mv('mv_report_delivery_risk') $$
-- );
