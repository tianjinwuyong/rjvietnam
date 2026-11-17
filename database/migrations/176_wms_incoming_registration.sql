-- Migration 176: WMS 来料原始档案
BEGIN;
CREATE TABLE IF NOT EXISTS wms_incoming_records (
  id                    BIGSERIAL PRIMARY KEY,
  lot_no                VARCHAR(120) NOT NULL,
  material_code         VARCHAR(120) NOT NULL,
  material_name         VARCHAR(240),
  supplier_code         VARCHAR(80),
  supplier_name         VARCHAR(240),
  incoming_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity_received     DECIMAL(12,3) NOT NULL DEFAULT 0,
  quantity_unit         VARCHAR(24) DEFAULT 'PCS',
  batch_code            VARCHAR(80),
  production_date       DATE,
  expiry_date           DATE,
  msd_level             VARCHAR(8),
  msd_floor_life_hours  INTEGER,
  opened_at             TIMESTAMPTZ,
  sealed_at             TIMESTAMPTZ,
  msd_status            VARCHAR(24) DEFAULT 'sealed',
  inspection_status     VARCHAR(24) DEFAULT 'pending',
  iqc_result            VARCHAR(16),
  inspector_id          VARCHAR(80),
  inspected_at          TIMESTAMPTZ,
  received_by           VARCHAR(80),
  warehouse_operator    VARCHAR(80),
  receiving_note        TEXT,
  attachment_urls       JSONB DEFAULT '[]',
  original_cert_urls    JSONB DEFAULT '[]',
  photos_urls           JSONB DEFAULT '[]',
  videos_urls           JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incoming_lot ON wms_incoming_records(lot_no);
CREATE INDEX IF NOT EXISTS idx_incoming_material ON wms_incoming_records(material_code);
CREATE INDEX IF NOT EXISTS idx_incoming_date ON wms_incoming_records(incoming_date DESC);
CREATE INDEX IF NOT EXISTS idx_incoming_insp_status ON wms_incoming_records(inspection_status);
INSERT INTO _migrations(filename, hash)
VALUES ('176_wms_incoming_registration.sql', 'wms-incoming-v1')
ON CONFLICT (filename) DO NOTHING;
COMMIT;
