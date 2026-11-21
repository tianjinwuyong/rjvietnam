-- 254: PDA pick acceptance — the line operator/manager reviews a WMS pick list
-- (PO), checks each material line, and signs to accept. The acceptance is the
-- WMS outbound posting point: it deducts material_lots.received_qty and writes
-- an ISSUE_TO_LINE inventory transaction per line (see the API handler). This
-- table is the immutable per-PO acceptance audit (one row per signed PO).

CREATE TABLE IF NOT EXISTS wms_pick_acceptance (
  id              BIGSERIAL PRIMARY KEY,
  wo_code         VARCHAR(80) NOT NULL,
  work_order_id   BIGINT,
  operator        VARCHAR(80) NOT NULL,
  operator_id     BIGINT,
  signature_hash  VARCHAR(128) NOT NULL,
  evidence_qr     VARCHAR(240),
  item_count      INT NOT NULL DEFAULT 0,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wms_pick_acceptance_wo       ON wms_pick_acceptance(wo_code);
CREATE INDEX IF NOT EXISTS idx_wms_pick_acceptance_operator ON wms_pick_acceptance(operator);
