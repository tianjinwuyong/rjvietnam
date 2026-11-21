-- WMS location master and material suitability rules.
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS qr_code varchar(200);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS length_cm numeric(10,2);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS width_cm numeric(10,2);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS height_cm numeric(10,2);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS allow_receiving boolean NOT NULL DEFAULT true;
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS allow_transfer boolean NOT NULL DEFAULT true;
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS allow_putaway boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_locations_qr_code
  ON storage_locations (qr_code) WHERE qr_code IS NOT NULL;

UPDATE storage_locations
SET qr_code = 'WMS-LOC:' || UPPER(code)
WHERE qr_code IS NULL OR BTRIM(qr_code) = '';

CREATE TABLE IF NOT EXISTS wms_location_material_rules (
  id bigserial PRIMARY KEY,
  location_id bigint NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
  material_id bigint NOT NULL REFERENCES materials(id),
  rule_type varchar(10) NOT NULL CHECK (rule_type IN ('ALLOW','BLOCK')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_wms_location_material_rules_location
  ON wms_location_material_rules(location_id, rule_type);
