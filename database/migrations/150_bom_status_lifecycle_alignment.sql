-- Align the database lifecycle constraint with the BOM version-control API.
-- `superseded` means a valid historical revision replaced by a newer active
-- revision; `obsolete` remains available for revisions withdrawn for other
-- reasons.
ALTER TABLE boms DROP CONSTRAINT IF EXISTS boms_status_check;
ALTER TABLE boms
  ADD CONSTRAINT boms_status_check
  CHECK (status IN ('draft', 'active', 'obsolete', 'superseded'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_boms_one_active_per_product
  ON boms(product_id)
  WHERE status = 'active';
