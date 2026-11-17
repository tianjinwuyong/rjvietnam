BEGIN;

ALTER TABLE non_iqc_receipts ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS uq_non_iqc_receipt_source_event ON non_iqc_receipts(source_event_id) WHERE source_event_id IS NOT NULL;

ALTER TABLE non_iqc_issue_requests ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS uq_non_iqc_issue_source_event ON non_iqc_issue_requests(source_event_id) WHERE source_event_id IS NOT NULL;

ALTER TABLE non_iqc_material_profiles ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS material_iqc_classification_changes (
  id BIGSERIAL PRIMARY KEY,
  change_no VARCHAR(64) NOT NULL UNIQUE,
  material_code VARCHAR(120) NOT NULL,
  previous_classification VARCHAR(16),
  new_classification VARCHAR(16) NOT NULL CHECK(new_classification IN('IQC','NON_IQC')),
  previous_profile JSONB,
  new_profile JSONB NOT NULL,
  reason TEXT NOT NULL,
  approvals JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_iqc_classification_history
  ON material_iqc_classification_changes(material_code,created_at DESC);

INSERT INTO _migrations(filename,hash)
VALUES('198_iqc_non_iqc_test_controls.sql','iqc-non-iqc-test-controls-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
