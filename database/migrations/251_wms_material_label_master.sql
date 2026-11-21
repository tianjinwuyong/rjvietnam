CREATE TABLE IF NOT EXISTS wms_material_label_master (
  id BIGSERIAL PRIMARY KEY,
  vietnam_material_code VARCHAR(120) NOT NULL UNIQUE,
  ruijing_material_code VARCHAR(120) NOT NULL,
  specification TEXT NOT NULL DEFAULT '',
  supplier_name VARCHAR(200),
  msd_level VARCHAR(40),
  floor_life_hours NUMERIC(10,2),
  source_file VARCHAR(500) NOT NULL,
  source_sheet VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_material_label_master_ruijing
  ON wms_material_label_master (UPPER(ruijing_material_code));
