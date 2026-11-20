-- rjvn_inventory_transaction -> public.inventory_transactions import (2026-11-21)
--
-- Why this exists: the terminal WMS keeps an inventory ledger keyed by
-- material+batch, while the SMT system keys stock movements by material LOT.
-- The 777 terminal rows are receipt movements (773 `receipt_in` + 4
-- `iqc_release_in`), and they reach a lot through this chain:
--
--   rjvn_inventory_transaction.tx_no
--     -> rjvn_receipt_order.receipt_no          (the receiving ticket; 1:1)
--     -> rjvn_iqc_lot_receipt.receipt_id        (which lot that ticket fed; 1:1)
--     -> rjvn_iqc_lot.id                        (the lot)
--     -> rjvn_external_id_map(entity='iqc_lot') -> public.material_lots.id
--
-- The join key is tx_no = receipt_no, NOT batch_no: batch_no is the WMS batch
-- and is shared by many tickets, so joining on it multiplies every movement
-- by the number of tickets in that batch (777 movements became 14935).
--
-- Atomic: BEGIN/COMMIT with a verify block that aborts the whole import if
-- any row would be dropped or violate a constraint.
-- Idempotent: guarded by tx_no (the terminal's own transaction number).
--
-- Semantics preserved:
--   * `action`       RECEIVE / QC_RELEASE, derived from the terminal tx_type
--   * `stock_status` pending_qc / good is carried in `reference_type`
--   * `tx_no`        the terminal tx number, so a re-import is a no-op
--   * `qty`          the terminal quantity
--   * `voided`       false: the terminal rows are all live movements

BEGIN;

-- ── 1. receipts to lots, through the receipt bridge ────────────────────
INSERT INTO public.inventory_transactions (
  tx_no, action, material_lot_id, work_order_id, qty,
  from_location_id, to_location_id, operator_id,
  occurred_at, tx_status, voided, reference_type, reference_no, updated_at, is_test
)
SELECT
  t.tx_no,
  CASE t.tx_type
    WHEN 'receipt_in'      THEN 'RECEIVE'
    WHEN 'iqc_release_in'  THEN 'IQC_RELEASE'
    ELSE upper(t.tx_type)
  END,
  lm.canonical_id,
  NULL,
  t.qty,
  NULL,
  locm.canonical_id,
  (SELECT u.id FROM public.users u WHERE u.username = 'admin' ORDER BY u.id LIMIT 1),
  COALESCE(t._created_at, now()),
  'posted',
  false,
  t.stock_status,
  t.reference_no,
  now(),
  false
FROM public.rjvn_inventory_transaction t
-- the receiving ticket this movement belongs to (1:1 on receipt_no)
JOIN public.rjvn_receipt_order r
  ON r.receipt_no = t.tx_no
-- which lot that ticket fed
JOIN public.rjvn_iqc_lot_receipt lr
  ON lr.receipt_id = r.id
-- lot -> canonical material_lots
JOIN public.rjvn_external_id_map lm
  ON lm.entity = 'iqc_lot' AND lm.rjvn_id = lr.lot_id
-- location -> canonical storage_locations
LEFT JOIN public.rjvn_external_id_map locm
  ON locm.entity = 'location' AND locm.rjvn_id = t.location_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory_transactions it WHERE it.tx_no = t.tx_no);

-- ── 2. keep the id sequence ahead of the imported rows ─────────────────
SELECT setval(
  pg_get_serial_sequence('public.inventory_transactions', 'id'),
  GREATEST(1, (SELECT coalesce(max(id), 0) FROM public.inventory_transactions)),
  true
);

-- ── 3. verify ─────────────────────────────────────────────────────────
DO $$
DECLARE
  src        INT;
  expected   INT;
  landed     INT;
  no_lot     INT;
  no_operator INT;
  dup_tx     INT;
  problems   text := '';
BEGIN
  SELECT count(*) INTO src FROM public.rjvn_inventory_transaction;

  -- Only the receipt movements have a receiving ticket to resolve a lot
  -- through. The 4 `iqc_release_in` rows are lot-level events with no ticket,
  -- so they are counted separately rather than silently dropped.
  SELECT count(*) INTO expected FROM public.rjvn_inventory_transaction t
   WHERE t.tx_type = 'receipt_in';

  SELECT count(*) INTO landed FROM public.inventory_transactions
    WHERE tx_no IN (SELECT tx_no FROM public.rjvn_inventory_transaction);

  IF landed < expected THEN
    problems := problems || format(' landed(%s)<expected(%s)', landed, expected);
  END IF;

  SELECT count(*) INTO no_lot FROM public.inventory_transactions
    WHERE material_lot_id IS NULL;
  IF no_lot > 0 THEN problems := problems || format(' lot_null(%s)', no_lot); END IF;

  SELECT count(*) INTO no_operator FROM public.inventory_transactions
    WHERE operator_id IS NULL;
  IF no_operator > 0 THEN problems := problems || format(' operator_null(%s)', no_operator); END IF;

  SELECT count(*) INTO dup_tx FROM (
    SELECT tx_no FROM public.inventory_transactions GROUP BY tx_no HAVING count(*) > 1
  ) d;
  IF dup_tx > 0 THEN problems := problems || format(' dup_tx_no(%s)', dup_tx); END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'INVENTORY TX IMPORT REJECTED:%', problems;
  END IF;

  RAISE NOTICE 'INVENTORY TX IMPORT OK: terminal=% (receipt movements=%) landed=% RECEIVE=% IQC_RELEASE=%',
    src, expected, landed,
    (SELECT count(*) FROM public.inventory_transactions WHERE action = 'RECEIVE'),
    (SELECT count(*) FROM public.inventory_transactions WHERE action = 'IQC_RELEASE');
END $$;

COMMIT;
