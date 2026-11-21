-- 253: PDA material receiving signature.
-- The warehouse operator signs on the PDA when accepting material from the
-- supplier. The signature is stored alongside the receiving inspection record
-- as an audit artifact (drawn PNG + irreversible fingerprint). Does not change
-- inventory math — only records who accepted and when.

ALTER TABLE pda_inspection_records
  ADD COLUMN IF NOT EXISTS signature_url  TEXT,
  ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS signed_by      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS signed_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pda_inspection_records_signed_by ON pda_inspection_records(signed_by);
