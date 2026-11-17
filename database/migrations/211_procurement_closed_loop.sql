-- Procurement closed-loop governance.
-- Keeps every business action auditable while reusing canonical PR/RFQ/PO/WMS/IQC/AP tables.

CREATE TABLE IF NOT EXISTS procurement_action_history (
  id              bigserial PRIMARY KEY,
  entity_type     varchar(32) NOT NULL,
  entity_id       bigint NOT NULL,
  entity_no       varchar(80),
  action          varchar(48) NOT NULL,
  from_status     varchar(32),
  to_status       varchar(32),
  notes           text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  acted_by        bigint REFERENCES users(id),
  acted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proc_action_entity
  ON procurement_action_history(entity_type, entity_id, acted_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_closure_reviews (
  id              bigserial PRIMARY KEY,
  po_header_id    bigint NOT NULL REFERENCES purchase_order_headers(id) ON DELETE CASCADE,
  review_result   varchar(20) NOT NULL CHECK (review_result IN ('passed', 'blocked')),
  gates           jsonb NOT NULL,
  notes           text,
  reviewed_by     bigint REFERENCES users(id),
  reviewed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_closure_review
  ON purchase_order_closure_reviews(po_header_id, reviewed_at DESC);
