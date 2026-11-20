-- IQC 严格度自动计数台账
-- 接收批数以「提交到 IQC 后合并成的批次（iqc_lot）」为单位，
-- (lot_id, inspection_type) 唯一 → 同一批次只计一次。

CREATE TABLE IF NOT EXISTS iqc_lot_strictness_count (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  material_id uuid NOT NULL,
  inspection_type varchar(30) NOT NULL,
  accepted boolean NOT NULL,
  strictness_at_count varchar(20) NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS iqc_lot_strictness_count_lot_type_key
  ON iqc_lot_strictness_count (lot_id, inspection_type);

CREATE INDEX IF NOT EXISTS idx_iqc_lot_st_count_material
  ON iqc_lot_strictness_count (material_id);
