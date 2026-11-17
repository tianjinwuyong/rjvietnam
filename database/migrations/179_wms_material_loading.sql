-- Migration 179: WMS Material Loading + Feeder Changes + Line Stops
BEGIN;

CREATE TABLE IF NOT EXISTS wms_material_loading (
  id                    BIGSERIAL PRIMARY KEY,
  work_order_no         VARCHAR(80) NOT NULL,
  station_code          VARCHAR(40) NOT NULL,
  feeder_no             VARCHAR(40) NOT NULL,
  slot_no               VARCHAR(16) NOT NULL,
  material_lot_no       VARCHAR(120) NOT NULL,
  material_code         VARCHAR(120),
  material_name         VARCHAR(240),
  qty_loaded            DECIMAL(12,3) DEFAULT 0,
  operator_id           VARCHAR(80) NOT NULL,
  line_leader_id        VARCHAR(80),
  loading_status        VARCHAR(24) DEFAULT 'pending',
  released_at           TIMESTAMPTZ,
  msd_verified          BOOLEAN DEFAULT FALSE,
  iqc_verified          BOOLEAN DEFAULT FALSE,
  expiry_verified       BOOLEAN DEFAULT FALSE,
  msd_level             VARCHAR(8),
  baking_required       BOOLEAN DEFAULT FALSE,
  baking_passed         BOOLEAN,
  quality_gate_passed   BOOLEAN DEFAULT FALSE,
  gate_failed_items     JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_feeder_changes (
  id                    BIGSERIAL PRIMARY KEY,
  work_order_no         VARCHAR(80) NOT NULL,
  station_code          VARCHAR(40) NOT NULL,
  feeder_no             VARCHAR(40) NOT NULL,
  slot_no               VARCHAR(16),
  old_lot_no            VARCHAR(120),
  new_lot_no            VARCHAR(120),
  old_material_code     VARCHAR(120),
  new_material_code     VARCHAR(120),
  change_reason         VARCHAR(240),
  change_type           VARCHAR(24) DEFAULT 'manual',
  operator_id           VARCHAR(80) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_line_stops (
  id                    BIGSERIAL PRIMARY KEY,
  work_order_no         VARCHAR(80),
  station_code          VARCHAR(40) NOT NULL,
  stop_reason_code      VARCHAR(40) NOT NULL,
  stop_reason           VARCHAR(240),
  start_time            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time              TIMESTAMPTZ,
  duration_minutes      INTEGER,
  operator_id           VARCHAR(80) NOT NULL,
  resolution            TEXT,
  production_loss       DECIMAL(10,2) DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_wo ON wms_material_loading(work_order_no);
CREATE INDEX IF NOT EXISTS idx_ml_lot ON wms_material_loading(material_lot_no);
CREATE INDEX IF NOT EXISTS idx_ml_station ON wms_material_loading(station_code);
CREATE INDEX IF NOT EXISTS idx_fc_wo ON wms_feeder_changes(work_order_no);
CREATE INDEX IF NOT EXISTS idx_ls_station ON wms_line_stops(station_code);
CREATE INDEX IF NOT EXISTS idx_ls_open ON wms_line_stops(start_time DESC) WHERE end_time IS NULL;

INSERT INTO _migrations(filename, hash)
VALUES ('179_wms_material_loading.sql', 'wms-material-loading-v1')
ON CONFLICT (filename) DO NOTHING;
COMMIT;
