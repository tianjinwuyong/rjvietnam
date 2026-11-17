-- Allow MSD floor life to be entered as days plus hours (stored as fractional days).
-- The existing view depends on these columns, so rebuild it around the type change.
DROP VIEW IF EXISTS v_material_opening_lifetime;
DROP VIEW IF EXISTS v_msd_openings;

ALTER TABLE material_lots
  ALTER COLUMN opened_shelf_life_days TYPE NUMERIC(10,4)
  USING opened_shelf_life_days::numeric;

ALTER TABLE material_lifecycle_openings
  ALTER COLUMN opened_shelf_life_days TYPE NUMERIC(10,4)
  USING opened_shelf_life_days::numeric;

CREATE OR REPLACE VIEW v_msd_openings AS
SELECT ml.id, ml.lot_no, ml.opened_at, ml.opened_shelf_life_days,
       ml.received_qty, ml.baking_required, ml.baking_started_at,
       ml.baking_completed_at, ml.baking_temperature, ml.baking_result,
       m.code AS material_code, m.name_zh, sl.code AS location_code,
       floor(EXTRACT(epoch FROM ((ml.opened_at + (ml.opened_shelf_life_days || ' days')::interval) - now())) / 3600)::numeric(10,1) AS remaining_hours,
       ((ml.opened_at + (ml.opened_shelf_life_days || ' days')::interval) < now()) AS is_expired,
       floor(EXTRACT(epoch FROM ((ml.opened_at + (ml.opened_shelf_life_days || ' days')::interval) - now())) / 86400)::integer AS remaining_days_after_opened
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
WHERE ml.opened_at IS NOT NULL AND ml.lot_status = 'open';

CREATE OR REPLACE VIEW v_material_opening_lifetime AS
SELECT o.id AS opening_id, o.material_lot_id,
       m.code AS material_code, m.name_zh AS material_name, m.specification,
       o.opened_at, o.opened_shelf_life_days,
       COALESCE(o.opened_expiry_at, o.opened_at + o.opened_shelf_life_days * interval '1 day') AS opened_expiry_at,
       o.opened_qty, o.remaining_qty, m.uom, o.department, o.operator,
       CASE
         WHEN o.status = 'CLOSED' THEN 'CLOSED'
         WHEN COALESCE(o.opened_expiry_at, o.opened_at + o.opened_shelf_life_days * interval '1 day') < now() THEN 'EXPIRED_ISOLATE'
         WHEN COALESCE(o.opened_expiry_at, o.opened_at + o.opened_shelf_life_days * interval '1 day') < now() + interval '7 days' THEN 'NEAR_EXPIRY'
         ELSE 'ACTIVE'
       END AS lifecycle_status
FROM material_lifecycle_openings o
JOIN material_lots ml ON ml.id = o.material_lot_id
JOIN materials m ON m.id = ml.material_id;
