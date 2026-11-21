-- 316 — Rebuild v_report_aoi_yield against the AOI schema that 072 left behind.
--
-- WHY THIS EXISTS. 040 (R13) created v_report_aoi_yield from
-- aoi_inspection_records(station_id, occurred_at) — the shape 001 defined. 072
-- then ran `DROP TABLE IF EXISTS aoi_inspection_records CASCADE` and recreated the
-- table as (station_code, line_code, inspected_at, result), which CASCADE-dropped
-- every dependent view, v_report_aoi_yield among them. Two consumers were left
-- querying a view that does not exist:
--   * GET /reports/aoi-yield            (server.js, "SELECT ... FROM v_report_aoi_yield")
--   * GET /api/reports/... aoi-yield     (report registry, case "v_report_aoi_yield")
-- Verified live 2026-11-20: /reports/aoi-yield answered 500 while every neighbouring
-- v_report_* view answered 200.
--
-- 040 itself cannot be replayed (it reads ai.station_id / ai.occurred_at, both gone),
-- so the view is rebuilt here instead of patching an applied migration in place.
-- Column list is deliberately identical to 040 so both consumers keep working.
--
-- Joins are LEFT: an inspection whose station_code has no row in stations must still
-- count towards the yield, otherwise a mis-configured station silently improves the
-- reported number.

CREATE OR REPLACE VIEW v_report_aoi_yield AS
SELECT
  DATE(ai.inspected_at)                     AS inspection_date,
  DATE_TRUNC('week', ai.inspected_at)::date AS week_start,
  DATE_TRUNC('month', ai.inspected_at)::date AS month_start,
  pl.numeric_line_code                      AS line_code,
  pl.name_zh                                AS line_name_zh,
  pl.name_en                                AS line_name_en,
  pl.name_vi                                AS line_name_vi,
  st.code                                   AS station_type,
  COUNT(*)                                  AS total_inspected,
  COUNT(*) FILTER (WHERE ai.result = 'pass') AS pass_count,
  COUNT(*) FILTER (WHERE ai.result = 'fail') AS fail_count,
  ROUND(COUNT(*) FILTER (WHERE ai.result = 'pass')::numeric
    / NULLIF(COUNT(*), 0) * 100, 1)         AS yield_pct
FROM aoi_inspection_records ai
LEFT JOIN stations s        ON s.code = ai.station_code
LEFT JOIN station_types st  ON st.id = s.station_type_id
LEFT JOIN production_lines pl ON pl.id = s.line_id
WHERE ai.inspected_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(ai.inspected_at),
         DATE_TRUNC('week', ai.inspected_at)::date,
         DATE_TRUNC('month', ai.inspected_at)::date,
         pl.numeric_line_code, pl.name_zh, pl.name_en, pl.name_vi, st.code
ORDER BY inspection_date DESC, pl.numeric_line_code;
