-- 318 — Restore the legacy output columns four report views lost.
--
-- WHY THESE EXIST. All four endpoints answer 500 on the live server (probed 2026-11-20
-- with an admin JWT):
--
--   /reports/defect-analysis    字段 "defect_name" 不存在
--   /reports/delivery-risk      字段 "customer_name" 不存在
--   /reports/inventory-ledger   字段 "material_name_zh" 不存在
--   /reports/material-movement  字段 "material_name" 不存在
--
-- The views were rewritten at some point to expose per-locale columns
-- (defect_name_zh/_en/_vi, customer_name_zh/_en/_vi) or a single un-locale column
-- (material_name), and every projection drifted apart. handlers still ask for:
-- defect_name (the jsonb object 039 originally produced), customer_name, and both
-- material_name and material_name_zh. Rather than guess which spelling each screen wants,
-- each view now keeps its current columns and ADDS the legacy names at the end, so no
-- existing consumer breaks and the 500s go away.
--
-- Two choices worth stating: customer_name resolves to name_zh (zh-CN is the primary
-- locale) and defect_name is rebuilt as the zh/en/vi jsonb object so a client can pick
-- its own language; v_report_inventory_ledger only stores one name, so its _en alias is
-- the same value -- a real per-locale column there needs master-data work, not a view.

CREATE OR REPLACE VIEW v_report_defect_analysis AS
SELECT s.*,
  jsonb_build_object('zh', s.defect_name_zh, 'en', s.defect_name_en, 'vi', s.defect_name_vi) AS defect_name,
  (SELECT wo.code FROM quality_inspections qi3 JOIN repair_records rr3 ON rr3.inspection_id = qi3.id JOIN work_orders wo ON wo.id = qi3.work_order_id WHERE qi3.station_type = s.station_type AND qi3.result = 'fail' GROUP BY wo.code ORDER BY COUNT(*) DESC LIMIT 1) AS top_work_order_code
FROM (SELECT dc.code AS defect_code,
    dc.name_zh AS defect_name_zh,
    dc.name_en AS defect_name_en,
    dc.name_vi AS defect_name_vi,
    COALESCE(dc.severity, 'major'::character varying) AS severity,
    qi.station_type,
    date(qi.occurred_at) AS run_date,
    (date_trunc('week'::text, qi.occurred_at))::date AS week_start,
    (date_trunc('month'::text, qi.occurred_at))::date AS month_start,
    count(*) AS count,
    round((((count(*))::numeric / (NULLIF(( SELECT count(*) AS count
           FROM quality_inspections
          WHERE (((quality_inspections.result)::text = 'fail'::text) AND (date(quality_inspections.occurred_at) >= (CURRENT_DATE - '90 days'::interval)))), 0))::numeric) * (100)::numeric), 1) AS percentage,
    NULL::text AS avg_repair_minutes
   FROM ((quality_inspections qi
     JOIN repair_records rr ON ((rr.inspection_id = qi.id)))
     JOIN defect_codes dc ON ((dc.id = rr.defect_code_id)))
  WHERE (((qi.result)::text = 'fail'::text) AND (qi.occurred_at >= (CURRENT_DATE - '90 days'::interval)))
  GROUP BY dc.code, dc.name_zh, dc.name_en, dc.name_vi, dc.severity, qi.station_type, qi.occurred_at
  ORDER BY (count(*)) DESC) s;

CREATE OR REPLACE VIEW v_report_delivery_risk AS
SELECT s.*,
  s.customer_name_zh AS customer_name
FROM (SELECT cpo.po_number,
    c.name_zh AS customer_name_zh,
    c.name_en AS customer_name_en,
    c.name_vi AS customer_name_vi,
    p.code AS product_code,
    cpo.order_qty,
    COALESCE(( SELECT sum(wo.completed_qty) AS sum
           FROM work_orders wo
          WHERE (wo.customer_po_id = cpo.id)), (0)::bigint) AS delivered_qty,
    (cpo.order_qty - COALESCE(( SELECT sum(wo.completed_qty) AS sum
           FROM work_orders wo
          WHERE (wo.customer_po_id = cpo.id)), (0)::bigint)) AS balance_qty,
    cpo.due_date,
    (date_trunc('week'::text, (cpo.due_date)::timestamp with time zone))::date AS week_start,
    (date_trunc('month'::text, (cpo.due_date)::timestamp with time zone))::date AS month_start,
        CASE
            WHEN (cpo.due_date < CURRENT_DATE) THEN 'critical'::text
            WHEN (cpo.due_date < (CURRENT_DATE + '3 days'::interval)) THEN 'high'::text
            WHEN (cpo.due_date < (CURRENT_DATE + '7 days'::interval)) THEN 'medium'::text
            ELSE 'low'::text
        END AS risk_level,
    ( SELECT array_agg(DISTINCT wo.code ORDER BY wo.code) AS array_agg
           FROM work_orders wo
          WHERE (wo.customer_po_id = cpo.id)) AS work_order_codes,
    ( SELECT pl.numeric_line_code
           FROM (work_orders wo
             JOIN production_lines pl ON ((pl.id = wo.line_id)))
          WHERE ((wo.customer_po_id = cpo.id) AND ((wo.status)::text = ANY ((ARRAY['running'::character varying, 'released'::character varying])::text[])))
         LIMIT 1) AS line_code,
    (cpo.due_date - CURRENT_DATE) AS days_remaining
   FROM ((customer_pos cpo
     JOIN customers c ON ((c.id = cpo.customer_id)))
     JOIN products p ON ((p.id = cpo.product_id)))
  WHERE ((cpo.status)::text = 'confirmed'::text)
  ORDER BY cpo.due_date) s;

CREATE OR REPLACE VIEW v_report_inventory_ledger AS
SELECT s.*,
  s.material_name AS material_name_zh,
  s.material_name AS material_name_en,
  s.supplier_name AS supplier_name_zh,
  s.supplier_name AS supplier_name_en
FROM (SELECT m.code AS material_code,
    jsonb_build_object('zh', m.name_zh, 'en', m.name_en, 'vi', m.name_vi) AS material_name,
    su.code AS supplier_code,
    jsonb_build_object('zh', su.name_zh, 'en', su.name_en, 'vi', su.name_vi) AS supplier_name,
    ml.lot_no,
    ml.iqc_status,
    ml.received_qty AS initial_qty,
    (ml.received_qty + COALESCE(( SELECT sum(
                CASE
                    WHEN ((it.action)::text = ANY ((ARRAY['RECEIVE'::character varying, 'RETURN_FROM_LINE'::character varying, 'ADJUST'::character varying])::text[])) THEN it.qty
                    WHEN ((it.action)::text = ANY ((ARRAY['ISSUE_TO_LINE'::character varying, 'PICK'::character varying, 'SCRAP'::character varying, 'RETURN'::character varying])::text[])) THEN (- it.qty)
                    ELSE (0)::numeric
                END) AS sum
           FROM inventory_transactions it
          WHERE ((it.material_lot_id = ml.id) AND (it.voided = false))), (0)::numeric)) AS current_qty,
    COALESCE(( SELECT tl.code
           FROM (inventory_transactions it
             LEFT JOIN storage_locations tl ON ((tl.id = it.to_location_id)))
          WHERE ((it.material_lot_id = ml.id) AND (it.voided = false))
          ORDER BY it.occurred_at DESC
         LIMIT 1), 'N/A'::character varying) AS location_code,
    ml.received_at,
    ( SELECT max(it.occurred_at) AS max
           FROM inventory_transactions it
          WHERE ((it.material_lot_id = ml.id) AND (it.voided = false))) AS last_movement_at,
    m.msd_level,
    m.shelf_life_days,
    0 AS reserved_qty
   FROM ((material_lots ml
     JOIN materials m ON ((m.id = ml.material_id)))
     JOIN suppliers su ON ((su.id = ml.supplier_id)))
  WHERE (ml.received_qty > (0)::numeric)) s;

CREATE OR REPLACE VIEW v_report_material_movement AS
SELECT s.*,
  s.material_name_zh AS material_name
FROM (SELECT it.tx_no,
    it.action,
    m.code AS material_code,
    m.name_zh AS material_name_zh,
    m.name_en AS material_name_en,
    m.name_vi AS material_name_vi,
    ml.lot_no,
    wo.code AS work_order_code,
    it.qty,
    fl.code AS from_location_code,
    tl.code AS to_location_code,
    u.display_name AS operator_name,
    it.occurred_at,
    date(it.occurred_at) AS run_date,
    (date_trunc('week'::text, it.occurred_at))::date AS week_start,
    (date_trunc('month'::text, it.occurred_at))::date AS month_start
   FROM ((((((inventory_transactions it
     JOIN material_lots ml ON ((ml.id = it.material_lot_id)))
     JOIN materials m ON ((m.id = ml.material_id)))
     LEFT JOIN work_orders wo ON ((wo.id = it.work_order_id)))
     LEFT JOIN storage_locations fl ON ((fl.id = it.from_location_id)))
     LEFT JOIN storage_locations tl ON ((tl.id = it.to_location_id)))
     LEFT JOIN users u ON ((u.id = it.operator_id)))
  WHERE ((it.voided = false) AND (it.occurred_at >= (CURRENT_DATE - '90 days'::interval)))
  ORDER BY it.occurred_at DESC) s;

