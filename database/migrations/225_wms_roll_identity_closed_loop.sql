-- WMS roll identity contract for MES/PDA material loading.
-- label_id is the physical roll QR/SN printed on the material roll.
ALTER TABLE material_lots
  ALTER COLUMN label_id TYPE VARCHAR(120);

COMMENT ON COLUMN material_lots.label_id IS
  'Physical material-roll QR/SN. Must identify one roll; lot_no remains the supplier/batch identifier.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_lots_roll_qr
  ON material_lots (UPPER(BTRIM(label_id)))
  WHERE label_id IS NOT NULL AND BTRIM(label_id) <> '';

-- Read model consumed by MES/PDA and WMS screens.
CREATE OR REPLACE VIEW v_wms_material_rolls AS
SELECT
  ml.id,
  ml.label_id AS roll_qr,
  ml.lot_no,
  m.code AS material_code,
  m.name_zh AS material_name,
  ml.received_qty,
  COALESCE(ml.reserved_qty, 0) AS reserved_qty,
  GREATEST(ml.received_qty - COALESCE(ml.reserved_qty, 0), 0) AS available_qty,
  ml.iqc_status,
  ml.lot_status,
  ml.lifecycle_status,
  sl.code AS location_code,
  sc.shelf_code,
  sc.cell_number
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
LEFT JOIN shelf_cells sc ON sc.material_lot_id = ml.id AND sc.cell_status = 'occupied';
