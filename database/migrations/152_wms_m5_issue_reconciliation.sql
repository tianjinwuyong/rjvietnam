-- M5 controlled reservation, line receipt acknowledgement and material differences.

CREATE TABLE IF NOT EXISTS line_issue_acknowledgements (
  id bigserial PRIMARY KEY,
  issue_transaction_id bigint NOT NULL UNIQUE,
  work_order_id bigint NOT NULL REFERENCES work_orders(id),
  material_lot_id bigint NOT NULL REFERENCES material_lots(id),
  acknowledged_qty numeric(18,6) NOT NULL CHECK(acknowledged_qty>0),
  acknowledged_by bigint REFERENCES users(id),
  receiver_name varchar(120) NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE TABLE IF NOT EXISTS work_order_material_differences (
  id bigserial PRIMARY KEY,
  work_order_id bigint NOT NULL REFERENCES work_orders(id),
  material_id bigint NOT NULL REFERENCES materials(id),
  difference_qty numeric(18,6) NOT NULL CHECK(difference_qty<>0),
  reason_code varchar(50),
  reason_detail text,
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','EXPLAINED','APPROVED','REJECTED')),
  reported_by bigint REFERENCES users(id),
  approved_by bigint REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_issue_ack_wo ON line_issue_acknowledgements(work_order_id,acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_material_difference ON work_order_material_differences(work_order_id,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_lot_wo_reservation
  ON material_lot_reservations(material_lot_id,work_order_id) WHERE status='active';

INSERT INTO _migrations(filename,hash)
VALUES('152_wms_m5_issue_reconciliation.sql','m5-issue-reconciliation-v1')
ON CONFLICT(filename) DO NOTHING;
