ALTER TABLE wms_canvas_layout_objects
  ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS wms_canvas_layout_config (
  layout_code VARCHAR(80) PRIMARY KEY,
  layout_name VARCHAR(200) NOT NULL,
  config_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_canvas_position_qrs (
  id BIGSERIAL PRIMARY KEY,
  layout_code VARCHAR(80) NOT NULL,
  object_id VARCHAR(160) NOT NULL,
  position_key VARCHAR(200) NOT NULL,
  position_name VARCHAR(200) NOT NULL,
  qr_code VARCHAR(240) NOT NULL,
  position_type VARCHAR(40) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (layout_code, position_key),
  UNIQUE (qr_code)
);

CREATE INDEX IF NOT EXISTS idx_wms_canvas_position_qrs_object
  ON wms_canvas_position_qrs(object_id, status);

