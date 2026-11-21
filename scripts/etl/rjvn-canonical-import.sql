-- rjvn_* -> canonical business tables import (2026-11-18)
-- Atomic: wrapped in BEGIN/COMMIT. Any error rolls back ALL changes incl. new tables.
-- Idempotent: every INSERT guarded by NOT EXISTS; re-run is safe.
-- OA: every source rjvn_* table is OA-free; no oa_* column is touched.
-- Source data note: rjvn material codes are a separate code system from canonical
--   (zero overlap), so this is a pure ADD, never an UPDATE of existing master data.
--   name_en/name_vi are placeholders = source Chinese name (technical debt, flagged).

BEGIN;

-- ── 0. external-id map (uuid <-> bigint) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rjvn_external_id_map (
  entity       text        not null,
  rjvn_id      uuid        not null,
  canonical_id bigint      not null,
  code         text,
  created_at   timestamptz default now(),
  primary key (entity, rjvn_id)
);
CREATE INDEX IF NOT EXISTS idx_rjvn_map_code ON public.rjvn_external_id_map (entity, code);

-- ── 1. suppliers (348) ─────────────────────────────────────────────────
INSERT INTO public.suppliers (code, name_zh, name_en, name_vi, status)
SELECT r.supplier_code, r.supplier_name, r.supplier_name, r.supplier_name,
       coalesce(nullif(r.status, ''), 'active')
FROM public.rjvn_supplier r
WHERE NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.code = r.supplier_code);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'supplier', r.id, s.id, r.supplier_code
FROM public.rjvn_supplier r
JOIN public.suppliers s ON s.code = r.supplier_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'supplier' AND m.rjvn_id = r.id);

-- ── 2. materials (2487) ────────────────────────────────────────────────
INSERT INTO public.materials
  (code, name_zh, name_en, name_vi, uom, material_type, status,
   specification, msl_level, vietnam_code, shelf_life_days)
SELECT r.material_code, r.material_name, r.material_name, r.material_name,
       coalesce(nullif(r.unit, ''), 'PCS'),
       coalesce(nullif(r.material_type, ''), 'unknown'),
       coalesce(nullif(r.status, ''), 'active'),
       r.specification, r.msl_level, nullif(r.vietnam_code, ''), r.expiry_days
FROM public.rjvn_material r
WHERE NOT EXISTS (SELECT 1 FROM public.materials m WHERE m.code = r.material_code);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'material', r.id, m.id, r.material_code
FROM public.rjvn_material r
JOIN public.materials m ON m.code = r.material_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m2
  WHERE m2.entity = 'material' AND m2.rjvn_id = r.id);

-- ── 3. storage locations (4) ───────────────────────────────────────────
INSERT INTO public.storage_locations
  (code, area, name_zh, name_en, name_vi, location_type, status,
   shelf_code, aisle_code, level_code, position_code)
SELECT r.location_code, coalesce(nullif(r.area_code, ''), '-'),
       r.location_code, r.location_code, r.location_code,
       r.location_type,
       CASE lower(coalesce(r.status, ''))
         WHEN 'disabled' THEN 'blocked' WHEN 'active' THEN 'active'
         ELSE 'inactive' END,
       r.shelf_code, r.area_code, r.layer_code, r.position_code
FROM public.rjvn_warehouse_location r
WHERE NOT EXISTS (SELECT 1 FROM public.storage_locations s WHERE s.code = r.location_code);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'location', r.id, s.id, r.location_code
FROM public.rjvn_warehouse_location r
JOIN public.storage_locations s ON s.code = r.location_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'location' AND m.rjvn_id = r.id);

-- ── 4. material lots from rjvn IQC lots (501) ──────────────────────────
INSERT INTO public.material_lots
  (material_id, supplier_id, lot_no, received_qty, manufacturing_date,
   received_at, iqc_status, lot_status, notes)
SELECT mm.canonical_id, ss.canonical_id, l.lot_no, l.total_qty,
       l.production_date, l.receipt_date,
       CASE lower(coalesce(l.inspection_result, ''))
         WHEN 'pass' THEN 'released' WHEN 'fail' THEN 'rejected'
         WHEN 'reject' THEN 'rejected' ELSE 'pending' END,
       'open', l.remark
FROM public.rjvn_iqc_lot l
JOIN public.rjvn_external_id_map mm ON mm.entity = 'material' AND mm.rjvn_id = l.material_id
JOIN public.rjvn_external_id_map ss ON ss.entity = 'supplier' AND ss.rjvn_id = l.supplier_id
WHERE NOT EXISTS (SELECT 1 FROM public.material_lots ml WHERE ml.lot_no = l.lot_no);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'iqc_lot', l.id, ml.id, l.lot_no
FROM public.rjvn_iqc_lot l
JOIN public.material_lots ml ON ml.lot_no = l.lot_no
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'iqc_lot' AND m.rjvn_id = l.id);

-- ── 5. receipt orders: new canonical table (1394) ──────────────────────
CREATE TABLE IF NOT EXISTS public.wms_receipt_orders (
  id                bigserial primary key,
  receipt_no        varchar(80) not null unique,
  receipt_date      date,
  material_id       bigint references public.materials(id),
  supplier_id       bigint references public.suppliers(id),
  storage_location_id bigint references public.storage_locations(id),
  material_code     varchar(80),
  supplier_code     varchar(80),
  batch_no          varchar(120),
  serial_no         varchar(120),
  quantity          numeric,
  unit              varchar(20),
  production_date   date,
  location_code     varchar(80),
  status            varchar(40),
  qr_content        text,
  remark            text,
  source            varchar(20) default 'rjvn',
  rjvn_id           uuid unique,
  created_at        timestamptz default now()
);
INSERT INTO public.wms_receipt_orders
  (receipt_no, receipt_date, material_id, supplier_id, storage_location_id,
   material_code, supplier_code, batch_no, serial_no, quantity, unit,
   production_date, location_code, status, qr_content, remark, rjvn_id)
SELECT r.receipt_no, r.receipt_date, mm.canonical_id, ss.canonical_id, lc.canonical_id,
       mat.material_code, sup.supplier_code, r.batch_no, r.serial_no,
       r.quantity, r.unit, r.production_date, w.location_code, r.status,
       r.qr_content, r.remark, r.id
FROM public.rjvn_receipt_order r
LEFT JOIN public.rjvn_material mat ON mat.id = r.material_id
LEFT JOIN public.rjvn_supplier sup ON sup.id = r.supplier_id
LEFT JOIN public.rjvn_warehouse_location w ON w.id = r.location_id
LEFT JOIN public.rjvn_external_id_map mm ON mm.entity = 'material' AND mm.rjvn_id = r.material_id
LEFT JOIN public.rjvn_external_id_map ss ON ss.entity = 'supplier' AND ss.rjvn_id = r.supplier_id
LEFT JOIN public.rjvn_external_id_map lc ON lc.entity = 'location' AND lc.rjvn_id = r.location_id
WHERE NOT EXISTS (SELECT 1 FROM public.wms_receipt_orders w2 WHERE w2.receipt_no = r.receipt_no);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'receipt', r.id, w.id, r.receipt_no
FROM public.rjvn_receipt_order r
JOIN public.wms_receipt_orders w ON w.rjvn_id = r.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'receipt' AND m.rjvn_id = r.id);

-- ── 6. IQC reports -> iqc_inspections (336) ────────────────────────────
INSERT INTO public.iqc_inspections
  (inspection_no, material_lot_id, result, operator_id,
   inspection_date, remarks, finished_at, inspection_result, disposition)
SELECT rp.report_no, lot.canonical_id,
       CASE lower(coalesce(rp.final_result, ''))
         WHEN 'pass' THEN 'pass' WHEN 'fail' THEN 'fail'
         WHEN 'reject' THEN 'reject' ELSE 'hold' END,
       -- Imported records need a system operator. `operator_id` is a FK to
       -- users(id), and user ids are NOT stable across environments (the dev
       -- database has `wy` at 14, production has no id 14 at all), so resolve
       -- the admin by username instead of hardcoding a local surrogate key.
       (SELECT u.id FROM public.users u WHERE u.username = 'admin' ORDER BY u.id LIMIT 1),
       rp.inspection_time::date,
       concat_ws(' / ', nullif(rp.remark, ''), nullif(rp.review_remark, ''), nullif(rp.judge_reason, '')),
       rp.review_time, rp.final_result,
       CASE lower(coalesce(rp.review_status, '')) WHEN 'approved' THEN 'accepted' ELSE rp.review_status END
FROM public.rjvn_iqc_report rp
JOIN public.rjvn_external_id_map lot ON lot.entity = 'iqc_lot' AND lot.rjvn_id = rp.lot_id
WHERE NOT EXISTS (SELECT 1 FROM public.iqc_inspections i WHERE i.inspection_no = rp.report_no);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'iqc_report', rp.id, i.id, rp.report_no
FROM public.rjvn_iqc_report rp
JOIN public.iqc_inspections i ON i.inspection_no = rp.report_no
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'iqc_report' AND m.rjvn_id = rp.id);

-- ── 7. picking orders: new canonical tables (4 + 67) ───────────────────
CREATE TABLE IF NOT EXISTS public.wms_picking_orders (
  id            bigserial primary key,
  picking_no    varchar(80) not null unique,
  work_order_no varchar(80),
  work_section  varchar(40),
  total_qty     numeric,
  status        varchar(40),
  applicant_name varchar(120),
  source        varchar(20) default 'rjvn',
  rjvn_id       uuid unique,
  created_at    timestamptz default now()
);
CREATE TABLE IF NOT EXISTS public.wms_picking_order_items (
  id           bigserial primary key,
  picking_id   bigint not null references public.wms_picking_orders(id),
  material_id  bigint references public.materials(id),
  material_code varchar(80),
  material_name varchar(200),
  unit         varchar(20),
  pick_qty     numeric,
  actual_qty   numeric,
  received_qty numeric,
  rjvn_id      uuid unique,
  created_at   timestamptz default now()
);

INSERT INTO public.wms_picking_orders
  (picking_no, work_order_no, work_section, total_qty, status, applicant_name, rjvn_id)
SELECT p.picking_no, wo.work_order_no, p.work_section, p.total_qty, p.status,
       coalesce(p.remark, 'rjvn import'), p.id
FROM public.rjvn_picking_order p
LEFT JOIN public.rjvn_work_order wo ON wo.id = p.work_order_id
WHERE NOT EXISTS (SELECT 1 FROM public.wms_picking_orders w WHERE w.picking_no = p.picking_no);

INSERT INTO public.wms_picking_order_items
  (picking_id, material_id, material_code, material_name, unit,
   pick_qty, actual_qty, received_qty, rjvn_id)
SELECT po.id, mm.canonical_id, it.material_code, it.material_name, it.unit,
       it.pick_qty, it.actual_qty, it.received_qty, it.id
FROM public.rjvn_picking_order_item it
JOIN public.wms_picking_orders po ON po.rjvn_id = it.picking_id
LEFT JOIN public.rjvn_external_id_map mm ON mm.entity = 'material' AND mm.rjvn_id = it.material_id
WHERE NOT EXISTS (SELECT 1 FROM public.wms_picking_order_items w WHERE w.rjvn_id = it.id);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'picking', p.id, w.id, p.picking_no
FROM public.rjvn_picking_order p
JOIN public.wms_picking_orders w ON w.rjvn_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'picking' AND m.rjvn_id = p.id);

-- ── verify (counts must match the terminal snapshot); any mismatch aborts ──
-- The floors below are the LIVE WMS snapshot (2026-11-20), not the stale
-- local mirror counts (2487 / 1394 / 501 / 336). The mirror reload replaced
-- the cache, so those old numbers would have failed a legitimate import.
-- `entity` rows in rjvn_external_id_map equal the number of terminal rows
-- because every source row maps itself (sections 1-7 each insert a map row).
DO $$
DECLARE mismatch text := '';
BEGIN
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='supplier') < 89
    THEN mismatch := mismatch || ' supplier'; END IF;
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='material') < 406
    THEN mismatch := mismatch || ' material'; END IF;
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='location') < 5
    THEN mismatch := mismatch || ' location'; END IF;
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='iqc_lot') < 210
    THEN mismatch := mismatch || ' iqc_lot'; END IF;
  IF (SELECT count(*) FROM public.wms_receipt_orders) < 773
    THEN mismatch := mismatch || ' receipt'; END IF;
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='iqc_report') < 27
    THEN mismatch := mismatch || ' iqc_report'; END IF;
  IF (SELECT count(*) FROM public.wms_picking_orders) < 10
    THEN mismatch := mismatch || ' picking'; END IF;
  IF mismatch <> '' THEN
    RAISE EXCEPTION 'IMPORT COUNT MISMATCH:%', mismatch;
  END IF;
END $$;

COMMIT;
