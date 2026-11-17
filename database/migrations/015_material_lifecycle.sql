-- 015_material_lifecycle.sql
-- Add manufacturing_date to material_lots for shelf-life tracking
-- Formulas from 仓库电子元器件寿命管参考:
--   到期日期 = 生产日期 + 封存有效期(月)
--   已使用时间(月) = DATEDIF(生产日期, TODAY(), "m")
--   剩余寿命(月) = 封存有效期 - 已使用时间
--   剩余天数 = 到期日期 - TODAY()

ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS manufacturing_date DATE,
  ADD COLUMN IF NOT EXISTS opened_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_shelf_life_days INTEGER,
  ADD COLUMN IF NOT EXISTS notes              TEXT;

COMMENT ON COLUMN material_lots.manufacturing_date IS '生产日期 — component manufacture date (F column in Excel)';
COMMENT ON COLUMN material_lots.opened_at IS '开封日期 — when the sealed package was opened (Sheet4)';
COMMENT ON COLUMN material_lots.opened_shelf_life_days IS '开封后有效期(天) — remaining shelf life after opening (Sheet4 H column)';
COMMENT ON COLUMN material_lots.notes IS '备注 — notes (Sheet1 Q column)';

-- Backfill manufacturing_date from received_at as a reasonable default
-- (real production data would set this at receiving)
UPDATE material_lots
SET manufacturing_date = received_at::DATE
WHERE manufacturing_date IS NULL;

-- Compute expiry info from manufacturing_date + materials.shelf_life_days
-- This is a view so it always stays current — no need to update manually
CREATE OR REPLACE VIEW v_material_lifecycle AS
SELECT
  ml.id,
  ml.lot_no,
  m.code        AS material_code,
  m.name_zh     AS material_name_zh,
  m.name_en     AS material_name_en,
  m.name_vi     AS material_name_vi,
  m.uom,
  m.material_type,
  ml.manufacturing_date,
  ml.received_at,
  FLOOR(EXTRACT(EPOCH FROM (ml.received_at - ml.manufacturing_date)) / 86400 / 30.44)::int
                AS used_days,       -- rough days since mfg (not exact DATEDIF)
  FLOOR(m.shelf_life_days / 30.44)::int
                AS shelf_life_months,
  (ml.manufacturing_date + (m.shelf_life_days || ' days')::interval)::date
                AS expiry_date,
  (DATE((ml.manufacturing_date + (m.shelf_life_days || ' days')::interval)::date) - CURRENT_DATE)::int
                AS remaining_days,
  ml.iqc_status,
  ml.received_qty  AS qty,
  ml.reserved_qty,
  sl.code       AS location_code,
  s.name_zh     AS supplier_name
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
LEFT JOIN suppliers s ON s.id = ml.supplier_id;

-- Index for alert queries
CREATE INDEX IF NOT EXISTS idx_material_lots_mfg_date ON material_lots(manufacturing_date);
