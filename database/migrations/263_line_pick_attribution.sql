-- 263: pick attribution on collect lines (who staged vs who took).
-- collected_by stays the stager; picked_by records the line-side takeaway.

ALTER TABLE wms_collect_order_lines
  ADD COLUMN IF NOT EXISTS picked_by VARCHAR(64),
  ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;
