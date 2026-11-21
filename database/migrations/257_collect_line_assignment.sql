-- 257: per-employee allocation on material collect lines.
-- A line may be assigned to a specific collector (username); only that employee
-- (or a warehouse-wide user) may confirm it. Unassigned lines remain open for
-- anyone in the same process domain. WMS can auto-distribute pending lines
-- across collectors (grouped by location so each person walks one area).

ALTER TABLE wms_collect_order_lines
  ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(80),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_wms_collect_lines_assigned
  ON wms_collect_order_lines(collect_order_id, assigned_to, status);
