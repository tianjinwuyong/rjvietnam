-- Add repair_status to ng_defect_records for repair workflow tracking
ALTER TABLE ng_defect_records
  ADD COLUMN IF NOT EXISTS repair_status varchar(20) NOT NULL DEFAULT 'pending';

COMMENT ON COLUMN ng_defect_records.repair_status IS 'pending | repaired | scrapped';

CREATE INDEX IF NOT EXISTS idx_ng_repair_status ON ng_defect_records(repair_status, occurred_at DESC);
