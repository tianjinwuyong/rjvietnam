-- A completed receiving registration is immediately available in the IQC queue.
-- The runtime-created table may lack the queue status column; add it first.
ALTER TABLE wms_receiving_qr_registrations ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'CREATED';

UPDATE wms_receiving_qr_registrations
SET status = 'IQC_PENDING', updated_at = NOW()
WHERE status = 'CREATED';

UPDATE material_lots ml
SET iqc_status = 'pending', updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM wms_receiving_qr_registrations q
  WHERE q.material_lot_id = ml.id
    AND q.status = 'IQC_PENDING'
)
AND COALESCE(ml.iqc_status, '') NOT IN ('released', 'passed');

CREATE INDEX IF NOT EXISTS idx_wms_receiving_qr_iqc_pending
  ON wms_receiving_qr_registrations(status, updated_at DESC)
  WHERE status = 'IQC_PENDING';
