-- 252: Work-order handover (warehouse → line operator) signature table.
-- Pure metadata, never mutates inventory_transactions or material_lots.
-- Append-only; one row per line-issue transaction signed off by the receiver.
-- FKs are intentionally dropped: inventory_transactions has a composite PK
-- (id, occurred_at), so a plain REFERENCES would fail. This table is audit
-- metadata; referential integrity is enforced at the API layer.

CREATE TABLE IF NOT EXISTS wms_wo_handover (
  id                 BIGSERIAL PRIMARY KEY,
  wo_code            VARCHAR(80) NOT NULL,
  work_order_id      BIGINT,
  issue_tx_id        BIGINT,
  reservation_id     BIGINT,
  material_lot_id    BIGINT,
  lot_no             VARCHAR(80) NOT NULL,
  material_code      VARCHAR(80),
  qty                NUMERIC(18, 6) NOT NULL,
  uom                VARCHAR(20),
  operator_from_id   BIGINT,
  operator_from      VARCHAR(80) NOT NULL,
  operator_to_id     BIGINT,
  operator_to        VARCHAR(80) NOT NULL,
  operator_to_ack_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_hash     VARCHAR(128) NOT NULL,
  evidence_qr        VARCHAR(240),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issue_tx_id)
);
CREATE INDEX IF NOT EXISTS idx_wms_wo_handover_wo          ON wms_wo_handover(wo_code);
CREATE INDEX IF NOT EXISTS idx_wms_wo_handover_operator_to ON wms_wo_handover(operator_to);
CREATE INDEX IF NOT EXISTS idx_wms_wo_handover_lot         ON wms_wo_handover(lot_no);
