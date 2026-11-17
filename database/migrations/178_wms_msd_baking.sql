-- Migration 178: WMS MSD Baking Records
BEGIN;

CREATE TABLE IF NOT EXISTS material_baking_records (
  id                    BIGSERIAL PRIMARY KEY,
  lot_no                VARCHAR(120) NOT NULL,
  material_code         VARCHAR(120),
  baking_start          TIMESTAMPTZ NOT NULL,
  baking_end            TIMESTAMPTZ,
  baking_temperature    DECIMAL(5,1) NOT NULL,
  baking_humidity       DECIMAL(5,1),
  oven_no               VARCHAR(40),
  operator_id           VARCHAR(80),
  operator_name         VARCHAR(120),
  result                VARCHAR(16),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_baking_lot ON material_baking_records(lot_no);

INSERT INTO _migrations(filename, hash)
VALUES ('178_wms_msd_baking.sql', 'wms-msd-baking-v1')
ON CONFLICT (filename) DO NOTHING;
COMMIT;
