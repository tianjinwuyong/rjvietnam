ALTER TABLE supplier_shipments
  ADD COLUMN IF NOT EXISTS logistics_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS ix_supplier_shipments_po_arrival
  ON supplier_shipments(po_no, expected_arrival DESC);

