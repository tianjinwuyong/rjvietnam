-- WMS material loading must be traceable to one inventory transaction and safe to retry.
ALTER TABLE wms_material_loading
  -- inventory_transactions is partitioned with a composite primary key
  -- (id, occurred_at); keep the ledger link as an application-validated ID.
  ADD COLUMN IF NOT EXISTS transaction_id bigint,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_material_loading_idempotency
  ON wms_material_loading(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reference_idempotency
  ON inventory_transactions(reference_type, reference_no)
  WHERE reference_type IN ('WMS_MATERIAL_LOADING','SMT_PDA_LOAD')
    AND reference_no IS NOT NULL;
