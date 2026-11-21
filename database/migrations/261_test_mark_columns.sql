-- 261: test-mark flag on material-flow tables.
-- Demo/test rows (TEST lots, test WOs, test sheets) are flagged is_test=true
-- so test data is always distinguishable from production data.
-- Nullable-safe: BOOLEAN NOT NULL DEFAULT false (no existing-row impact).

ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wms_collect_orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wms_collect_order_lines
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wms_pick_acceptance
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wms_issue_announcements
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Backfill already-created test rows.
UPDATE material_lots SET is_test = true WHERE lot_no LIKE 'TEST-%';
UPDATE work_orders SET is_test = true WHERE code = '26091010004';
