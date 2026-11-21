-- 260: WMS-side acceptance of a fully-picked collect order (发料单).
-- Production finishes picking on the PDA (lines → COLLECTED, announcement READY);
-- WMS then confirms acceptance on the slips page, which finishes the WO flow.
-- accepted_by/at record WHO closed it and WHEN (real-name audit, no hard delete).
-- NOTE: wms_collect_orders.status has no CHECK constraint, so 'ACCEPTED'
-- needs no constraint change (see 255: OPEN | PARTIAL | COLLECTED | CANCELLED + ISSUED in use).

ALTER TABLE wms_collect_orders
  ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(64),
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
