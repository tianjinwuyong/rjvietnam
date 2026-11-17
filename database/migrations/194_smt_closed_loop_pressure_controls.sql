BEGIN;

ALTER TABLE npm_material_consumption_events
  ADD COLUMN IF NOT EXISTS duplicate_delivery_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_duplicate_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS smt_material_return_handovers(
  id BIGSERIAL PRIMARY KEY,
  handover_no VARCHAR(48) NOT NULL UNIQUE,
  binding_id BIGINT NOT NULL REFERENCES feeder_binding_events(id),
  work_order_code VARCHAR(50) NOT NULL,
  material_code VARCHAR(80) NOT NULL,
  material_sn VARCHAR(128),
  lot_no VARCHAR(80) NOT NULL,
  theoretical_qty NUMERIC(18,4) NOT NULL,
  actual_qty NUMERIC(18,4),
  quality_verdict VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'WAITING_WMS_RECEIPT' CHECK(status IN(
    'WAITING_WMS_RECEIPT','RECEIVED','VARIANCE_REVIEW','QUARANTINED','CANCELLED'
  )),
  sent_by VARCHAR(80) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by VARCHAR(80),
  received_at TIMESTAMPTZ,
  variance_reason TEXT
);

CREATE TABLE IF NOT EXISTS material_classification_change_requests(
  id BIGSERIAL PRIMARY KEY,
  request_no VARCHAR(48) NOT NULL UNIQUE,
  material_id BIGINT NOT NULL REFERENCES materials(id),
  from_domain VARCHAR(24),
  to_domain VARCHAR(24) NOT NULL CHECK(to_domain IN('SMT_MATERIAL','NON_SMT_MATERIAL')),
  proposed_tracking_level VARCHAR(24) NOT NULL,
  proposed_consumption_source VARCHAR(24) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  effective_from TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN('PENDING_APPROVAL','APPROVED','REJECTED','APPLIED')),
  requested_by VARCHAR(80) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_classification_change_approvals(
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES material_classification_change_requests(id),
  approval_role VARCHAR(24) NOT NULL CHECK(approval_role IN('WMS_MANAGER','ENGINEERING','PMC_MANAGER')),
  decision VARCHAR(12) NOT NULL CHECK(decision IN('APPROVE','REJECT')),
  actor VARCHAR(80) NOT NULL,
  comment TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(request_id,approval_role)
);

CREATE TABLE IF NOT EXISTS smt_exceptional_closure_requests(
  id BIGSERIAL PRIMARY KEY,
  request_no VARCHAR(48) NOT NULL UNIQUE,
  work_order_code VARCHAR(50) NOT NULL,
  unresolved_snapshot JSONB NOT NULL,
  cost_impact NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN('PENDING_APPROVAL','APPROVED','REJECTED','CLOSED')),
  required_roles JSONB NOT NULL DEFAULT '["PMC_MANAGER","WMS_MANAGER","QUALITY","FINANCE"]',
  approvals JSONB NOT NULL DEFAULT '[]',
  requested_by VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS data_fact_authority_rules(
  fact_type VARCHAR(40) PRIMARY KEY,
  authority_domain VARCHAR(24) NOT NULL,
  evidence_domains JSONB NOT NULL DEFAULT '[]',
  conflict_action VARCHAR(24) NOT NULL DEFAULT 'FREEZE_AND_INVESTIGATE',
  description TEXT NOT NULL
);

INSERT INTO data_fact_authority_rules(fact_type,authority_domain,evidence_domains,description) VALUES
('PHYSICAL_INVENTORY','WMS','["PDA","MES","NPM"]','WMS owns posted physical inventory; scans are evidence'),
('FIELD_SCAN_ACTION','PDA','["WMS","MES"]','PDA owns the original scan action, not inventory quantity'),
('WORK_ORDER_EXECUTION','MES','["PDA","NPM","WMS"]','MES owns work-order and execution state'),
('MACHINE_CONSUMPTION','NPM','["MES","PDA","WMS"]','NPM owns immutable machine consumption facts'),
('QUALITY_RELEASE','QUALITY','["MES","WMS","PDA"]','Quality owns freeze and release decisions')
ON CONFLICT(fact_type) DO UPDATE SET authority_domain=EXCLUDED.authority_domain,
evidence_domains=EXCLUDED.evidence_domains,description=EXCLUDED.description;

CREATE INDEX IF NOT EXISTS idx_smt_return_waiting ON smt_material_return_handovers(status,sent_at);
CREATE INDEX IF NOT EXISTS idx_material_class_change_status ON material_classification_change_requests(status,created_at);

INSERT INTO _migrations(filename,hash)
VALUES('194_smt_closed_loop_pressure_controls.sql','smt-pressure-controls-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
