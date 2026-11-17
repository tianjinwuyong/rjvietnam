-- Migration 177: WMS IQC (送检+判定+特采审批)
BEGIN;

CREATE TABLE IF NOT EXISTS iqc_inspections (
  id                    BIGSERIAL PRIMARY KEY,
  incoming_record_id    BIGINT REFERENCES wms_incoming_records(id),
  lot_no                VARCHAR(120) NOT NULL,
  material_code         VARCHAR(120) NOT NULL,
  material_name         VARCHAR(240),
  supplier_code         VARCHAR(80),
  supplier_name         VARCHAR(240),
  inspection_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  inspector_id          VARCHAR(80) NOT NULL,
  inspector_name        VARCHAR(120),
  sample_size           INTEGER NOT NULL DEFAULT 0,
  aql_level             VARCHAR(8) DEFAULT 'II',
  inspection_level      VARCHAR(8) DEFAULT 'Normal',
  accepted_qty          INTEGER DEFAULT 0,
  rejected_qty          INTEGER DEFAULT 0,
  inspection_result     VARCHAR(16),
  major_defects         INTEGER DEFAULT 0,
  minor_defects         INTEGER DEFAULT 0,
  critical_defects      INTEGER DEFAULT 0,
  disposition           VARCHAR(24),
  special_approval_id   BIGINT,
  remarks               TEXT,
  finished_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The canonical IQC table may already exist from the receiving workflow.
-- Upgrade it in place instead of assuming this migration created a new table.
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS incoming_record_id BIGINT REFERENCES wms_incoming_records(id);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS lot_no VARCHAR(120);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS material_code VARCHAR(120);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS material_name VARCHAR(240);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(80);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(240);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspection_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspector_id VARCHAR(80);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspector_name VARCHAR(120);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS sample_size INTEGER DEFAULT 0;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspection_result VARCHAR(16);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS accepted_qty INTEGER DEFAULT 0;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS rejected_qty INTEGER DEFAULT 0;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS aql_level VARCHAR(8) DEFAULT 'II';
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspection_level VARCHAR(8) DEFAULT 'Normal';
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS major_defects INTEGER DEFAULT 0;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS minor_defects INTEGER DEFAULT 0;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS critical_defects INTEGER DEFAULT 0;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS disposition VARCHAR(24);
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS special_approval_id BIGINT;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS iqc_defect_records (
  id                    BIGSERIAL PRIMARY KEY,
  inspection_id         BIGINT NOT NULL REFERENCES iqc_inspections(id),
  defect_no             INTEGER NOT NULL,
  defect_type           VARCHAR(24) NOT NULL,
  defect_code           VARCHAR(40),
  defect_description    TEXT,
  defect_location       VARCHAR(80),
  quantity_defect       INTEGER NOT NULL DEFAULT 1,
  severity              VARCHAR(12) DEFAULT 'minor',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iqc_aql_rules (
  id                    BIGSERIAL PRIMARY KEY,
  material_category     VARCHAR(80),
  supplier_grade        VARCHAR(8),
  aql_major             DECIMAL(4,2) DEFAULT 1.0,
  aql_minor             DECIMAL(4,2) DEFAULT 2.5,
  aql_critical          DECIMAL(4,2) DEFAULT 0.1,
  inspection_level      VARCHAR(8) DEFAULT 'Normal',
  sample_size_code      VARCHAR(8),
  active                INTEGER DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iqc_sampling_plans (
  id                    BIGSERIAL PRIMARY KEY,
  aql_level             VARCHAR(8) NOT NULL,
  inspection_level      VARCHAR(16) NOT NULL,
  sample_size           INTEGER NOT NULL,
  accept_point          INTEGER NOT NULL,
  reject_point          INTEGER NOT NULL,
  description           VARCHAR(240),
  active                INTEGER DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iqc_special_approvals (
  id                    BIGSERIAL PRIMARY KEY,
  inspection_id         BIGINT REFERENCES iqc_inspections(id),
  applicant_id          VARCHAR(80) NOT NULL,
  applicant_name        VARCHAR(120),
  approver_id           VARCHAR(80),
  approver_name         VARCHAR(120),
  approval_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  reason                TEXT NOT NULL,
  usage_purpose         VARCHAR(240),
  quantity_approved     DECIMAL(12,3),
  approval_status       VARCHAR(16) DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iqc_lot ON iqc_inspections(lot_no);
CREATE INDEX IF NOT EXISTS idx_iqc_material ON iqc_inspections(material_code);
CREATE INDEX IF NOT EXISTS idx_iqc_date ON iqc_inspections(inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_iqc_result ON iqc_inspections(inspection_result);
CREATE INDEX IF NOT EXISTS idx_defect_insp ON iqc_defect_records(inspection_id);

INSERT INTO _migrations(filename, hash)
VALUES ('177_wms_iqc.sql', 'wms-iqc-v1')
ON CONFLICT (filename) DO NOTHING;
COMMIT;
