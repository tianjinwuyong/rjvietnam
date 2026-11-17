-- WMS closed-loop governance: discrepancy, approvals, custody handovers and audit.
BEGIN;

CREATE TABLE IF NOT EXISTS wms_closure_cases (
  id BIGSERIAL PRIMARY KEY,
  case_no VARCHAR(48) NOT NULL UNIQUE,
  case_type VARCHAR(40) NOT NULL CHECK (case_type IN (
    'INVENTORY_DIFFERENCE','RECEIVING_DIFFERENCE','LINE_RETURN',
    'SUPPLIER_RETURN','SPECIAL_RELEASE','SCRAP','MASTER_DATA_CHANGE'
  )),
  entity_type VARCHAR(40) NOT NULL,
  entity_key VARCHAR(160) NOT NULL,
  warehouse_code VARCHAR(40),
  location_code VARCHAR(40),
  material_lot_id BIGINT REFERENCES material_lots(id),
  work_order_id BIGINT REFERENCES work_orders(id),
  expected_qty NUMERIC(18,4),
  actual_qty NUMERIC(18,4),
  difference_qty NUMERIC(18,4) GENERATED ALWAYS AS (
    COALESCE(actual_qty,0)-COALESCE(expected_qty,0)
  ) STORED,
  reason_code VARCHAR(48) NOT NULL,
  reason_detail TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
    CHECK (risk_level IN ('NORMAL','HIGH','CRITICAL')),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','PENDING_APPROVAL','APPROVED','REJECTED',
      'IN_TRANSIT','RECEIVED','EXECUTED','CLOSED','CANCELLED'
    )),
  required_approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by VARCHAR(80) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_closure_approvals (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES wms_closure_cases(id) ON DELETE RESTRICT,
  approval_role VARCHAR(32) NOT NULL CHECK (approval_role IN (
    'WAREHOUSE_SUPERVISOR','QUALITY_MANAGER','FINANCE','BUSINESS_OWNER','SYSTEM_ADMIN'
  )),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  actor_badge VARCHAR(80) NOT NULL,
  comment TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id,approval_role)
);

CREATE TABLE IF NOT EXISTS wms_custody_handovers (
  id BIGSERIAL PRIMARY KEY,
  handover_no VARCHAR(48) NOT NULL UNIQUE,
  case_id BIGINT REFERENCES wms_closure_cases(id) ON DELETE RESTRICT,
  entity_type VARCHAR(40) NOT NULL,
  entity_key VARCHAR(160) NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  from_domain VARCHAR(40) NOT NULL,
  from_location VARCHAR(80),
  to_domain VARCHAR(40) NOT NULL,
  to_location VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','IN_TRANSIT','RECEIVED','REJECTED','CANCELLED')),
  sender_badge VARCHAR(80) NOT NULL,
  sent_at TIMESTAMPTZ,
  receiver_badge VARCHAR(80),
  received_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms_inventory_freezes (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES wms_closure_cases(id) ON DELETE RESTRICT,
  material_lot_id BIGINT REFERENCES material_lots(id),
  location_code VARCHAR(80),
  freeze_scope VARCHAR(16) NOT NULL CHECK (freeze_scope IN ('LOT','LOCATION','BOTH')),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED')),
  reason TEXT NOT NULL,
  frozen_by VARCHAR(80) NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_by VARCHAR(80),
  released_at TIMESTAMPTZ,
  UNIQUE(case_id,freeze_scope)
);

CREATE TABLE IF NOT EXISTS wms_closed_loop_audit (
  id BIGSERIAL PRIMARY KEY,
  event_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  case_id BIGINT REFERENCES wms_closure_cases(id) ON DELETE RESTRICT,
  handover_id BIGINT REFERENCES wms_custody_handovers(id) ON DELETE RESTRICT,
  action VARCHAR(48) NOT NULL,
  actor_badge VARCHAR(80) NOT NULL,
  old_state VARCHAR(24),
  new_state VARCHAR(24),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash VARCHAR(64),
  event_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_closure_status ON wms_closure_cases(status,case_type);
CREATE INDEX IF NOT EXISTS idx_wms_closure_entity ON wms_closure_cases(entity_type,entity_key);
CREATE INDEX IF NOT EXISTS idx_wms_handover_status ON wms_custody_handovers(status,due_at);
CREATE INDEX IF NOT EXISTS idx_wms_freeze_lot ON wms_inventory_freezes(material_lot_id,status);
CREATE INDEX IF NOT EXISTS idx_wms_audit_case ON wms_closed_loop_audit(case_id,id);

CREATE OR REPLACE VIEW v_wms_closed_loop_dashboard AS
SELECT
  COUNT(*) FILTER (WHERE status='PENDING_APPROVAL')::int AS pending_approval,
  COUNT(*) FILTER (WHERE status='IN_TRANSIT')::int AS in_transit,
  COUNT(*) FILTER (WHERE status NOT IN ('CLOSED','CANCELLED','REJECTED')
                    AND requested_at < NOW()-INTERVAL '30 minutes')::int AS overdue_cases,
  (SELECT COUNT(*)::int FROM wms_custody_handovers
    WHERE status='IN_TRANSIT' AND due_at<NOW()) AS overdue_handovers,
  (SELECT COUNT(*)::int FROM wms_inventory_freezes WHERE status='ACTIVE') AS active_freezes,
  COUNT(*) FILTER (WHERE status='CLOSED' AND closed_at>=CURRENT_DATE)::int AS closed_today
FROM wms_closure_cases;

INSERT INTO _migrations(filename,hash)
VALUES ('182_wms_closed_loop_governance.sql','wms-closed-loop-governance-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
