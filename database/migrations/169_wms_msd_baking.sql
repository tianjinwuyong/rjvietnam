-- 169_wms_msd_baking.sql
-- MSD 烘烤管理：material_lots 加烘烤字段

BEGIN;

-- 1. material_lots 加烘烤字段（幂等）
ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS baking_required    boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS baking_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS baking_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS baking_temperature numeric(5,1),
  ADD COLUMN IF NOT EXISTS baking_result      text;

-- 2. 视图：开封后物料（含烘烤状态）
DROP VIEW IF EXISTS v_msd_openings;
CREATE VIEW v_msd_openings AS
SELECT
  ml.id,
  ml.lot_no,
  ml.opened_at,
  ml.opened_shelf_life_days,
  ml.received_qty,
  ml.baking_required,
  ml.baking_started_at,
  ml.baking_completed_at,
  ml.baking_temperature,
  ml.baking_result,
  m.code  AS material_code,
  m.name_zh,
  sl.code AS location_code,
  FLOOR(EXTRACT(EPOCH FROM (
    ml.opened_at + (ml.opened_shelf_life_days || ' days')::interval - NOW()
  ))/3600)::numeric(10,1) AS remaining_hours,
  (ml.opened_at + (ml.opened_shelf_life_days || ' days')::interval) < NOW() AS is_expired,
  FLOOR(EXTRACT(EPOCH FROM (
    ml.opened_at + (ml.opened_shelf_life_days || ' days')::interval - NOW()
  ))/86400)::int AS remaining_days_after_opened
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
WHERE ml.opened_at IS NOT NULL
  AND ml.lot_status = 'open';

-- 3. 烘烤记录表
DROP TABLE IF EXISTS material_baking_records CASCADE;
CREATE TABLE material_baking_records (
  id                  bigserial PRIMARY KEY,
  material_lot_id     bigint    NOT NULL REFERENCES material_lots(id),
  lot_no              text      NOT NULL,
  operator_id         bigint    REFERENCES hr_employees(id),
  operator_name       text,
  started_at          timestamptz NOT NULL DEFAULT NOW(),
  completed_at        timestamptz,
  temperature         numeric(5,1),
  humidity            numeric(5,2),
  oven_no             text,
  result              text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE material_baking_records IS 'MSD 物料烘烤履历';

COMMIT;
