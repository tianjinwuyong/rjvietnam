-- 259: link acceptance slips (收料单) to the material collect order (发料单)
-- they fulfil. Each line acceptance is stamped with the WO's collect order at
-- the moment of signing, so 发料单 ↔ 收料单 are traceable in both directions.

ALTER TABLE wms_pick_acceptance
  ADD COLUMN IF NOT EXISTS collect_no VARCHAR(40),
  ADD COLUMN IF NOT EXISTS collect_order_id BIGINT;

-- Backfill existing acceptances to their WO's latest non-cancelled collect order.
UPDATE wms_pick_acceptance a
   SET collect_no = c.collect_no,
       collect_order_id = c.id
  FROM wms_collect_orders c
 WHERE c.work_order_code = a.wo_code
   AND c.status <> 'CANCELLED'
   AND a.collect_no IS NULL
   AND c.id = (SELECT c2.id FROM wms_collect_orders c2
                WHERE c2.work_order_code = a.wo_code AND c2.status <> 'CANCELLED'
                ORDER BY c2.id DESC LIMIT 1);

CREATE INDEX IF NOT EXISTS idx_wms_pick_acceptance_collect
  ON wms_pick_acceptance(collect_order_id);
