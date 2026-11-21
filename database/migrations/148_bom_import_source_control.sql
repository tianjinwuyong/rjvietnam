ALTER TABLE boms ADD COLUMN IF NOT EXISTS source_file_name varchar(300);
ALTER TABLE boms ADD COLUMN IF NOT EXISTS source_fingerprint varchar(64);
ALTER TABLE boms ADD COLUMN IF NOT EXISTS source_imported_at timestamptz;

CREATE TABLE IF NOT EXISTS bom_import_change_requests (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id),
  existing_bom_id bigint NOT NULL REFERENCES boms(id),
  requested_revision varchar(30) NOT NULL,
  source_file_name varchar(300) NOT NULL,
  source_fingerprint varchar(64) NOT NULL,
  proposed_payload jsonb NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING_REVIEW',
  requested_by bigint REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by bigint REFERENCES users(id),reviewed_at timestamptz,review_note text,
  UNIQUE(product_id,requested_revision,source_fingerprint),
  CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','APPLIED'))
);
CREATE INDEX IF NOT EXISTS idx_bom_import_change_pending ON bom_import_change_requests(status,requested_at);
