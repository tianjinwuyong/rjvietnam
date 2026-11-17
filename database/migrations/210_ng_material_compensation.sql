-- Idempotent MES NG/scrap -> PMC supplementary-material linkage.
-- Compensation is created only after an NG item is formally scrapped.

ALTER TABLE supplementary_materials
  ADD COLUMN IF NOT EXISTS source_type varchar(40),
  ADD COLUMN IF NOT EXISTS source_reference varchar(120),
  ADD COLUMN IF NOT EXISTS source_station varchar(50),
  ADD COLUMN IF NOT EXISTS loss_qty numeric(18,4),
  ADD COLUMN IF NOT EXISTS recoverable_qty numeric(18,4) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplementary_materials_source_material
  ON supplementary_materials(source_type, source_reference, material_id)
  WHERE source_type IS NOT NULL AND source_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplementary_materials_source
  ON supplementary_materials(source_type, source_reference);

