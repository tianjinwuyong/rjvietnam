BEGIN;

CREATE TABLE IF NOT EXISTS pmc_work_order_change_requests(
  id BIGSERIAL PRIMARY KEY,
  request_no VARCHAR(48) NOT NULL UNIQUE,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  change_type VARCHAR(24) NOT NULL CHECK(change_type IN(
    'QUANTITY','SCHEDULE','LINE','BOM','PRIORITY','CANCEL'
  )),
  before_snapshot JSONB NOT NULL,
  proposed_change JSONB NOT NULL,
  reason TEXT NOT NULL,
  required_approvals JSONB NOT NULL DEFAULT '["PMC_MANAGER","PRODUCTION_MANAGER"]',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN(
    'PENDING_APPROVAL','APPROVED','REJECTED','APPLIED','CANCELLED'
  )),
  requested_by VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pmc_work_order_change_approvals(
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES pmc_work_order_change_requests(id) ON DELETE RESTRICT,
  approval_role VARCHAR(32) NOT NULL,
  decision VARCHAR(16) NOT NULL CHECK(decision IN('APPROVE','REJECT')),
  actor VARCHAR(80) NOT NULL,
  comment TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(request_id,approval_role)
);

CREATE INDEX IF NOT EXISTS idx_pmc_wo_change_status
  ON pmc_work_order_change_requests(status,created_at);
CREATE INDEX IF NOT EXISTS idx_pmc_transfer_status
  ON pmc_work_order_transfers(status,created_at);

INSERT INTO _migrations(filename,hash)
VALUES('191_pmc_work_order_control.sql','pmc-work-order-control-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
