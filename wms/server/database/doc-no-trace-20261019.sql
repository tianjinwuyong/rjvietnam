-- =============================================================================
-- 单号追溯：MRB / 不良品调拨单挂靠 IQC 检验单号
-- 2026-10-19
--
-- 规则：
--   MRB            = <检验单号>-MRB          （同一检验单第 2 张起 -MRB-02、-03）
--   不良品调拨单    = <检验单号>-NGDB         （同一 MRB 第 2 张起 -NGDB-02）
--   良品仓手工制单  = NGDB<YYYYMMDD>-<流水>   （无检验来源）
--
-- 单号本身是给人看的；`source_inspection_no` 才是给查询用的权威关联
-- （单号被手工补录、历史数据沿用旧号时，字段仍然指向正确的检验单）。
--
-- 历史单据不重编号（已打印、已归档），只回填来源字段。
-- =============================================================================

BEGIN;

ALTER TABLE mrb_review
  ADD COLUMN IF NOT EXISTS source_inspection_no varchar(50);

ALTER TABLE defective_move_task
  ADD COLUMN IF NOT EXISTS source_inspection_no varchar(50);

COMMENT ON COLUMN mrb_review.source_inspection_no IS '来源 IQC 检验单号（JY...），单号前缀同源，用于追溯';
COMMENT ON COLUMN defective_move_task.source_inspection_no IS '来源 IQC 检验单号（JY...）；手工制单为空';

-- 回填：MRB 从检验批次带出
UPDATE mrb_review m
   SET source_inspection_no = l.inspection_no
  FROM iqc_lot l
 WHERE l.id = m.lot_id
   AND m.source_inspection_no IS NULL
   AND l.inspection_no IS NOT NULL;

-- 回填：MRB 派生调拨单从 MRB 带出
UPDATE defective_move_task t
   SET source_inspection_no = m.source_inspection_no
  FROM mrb_review m
 WHERE m.id = t.mrb_id
   AND t.source_inspection_no IS NULL
   AND m.source_inspection_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mrb_source_inspection_no
  ON mrb_review (source_inspection_no);

CREATE INDEX IF NOT EXISTS idx_dmt_source_inspection_no
  ON defective_move_task (source_inspection_no);

COMMIT;
