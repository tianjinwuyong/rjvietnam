BEGIN;

CREATE TABLE IF NOT EXISTS non_iqc_material_profiles (
  material_code VARCHAR(120) PRIMARY KEY,
  material_domain VARCHAR(32) NOT NULL CHECK(material_domain IN(
    'PRODUCTION_AUXILIARY','PACKAGING','SPARE_PART','TOOL_FIXTURE','PPE',
    'OFFICE_ADMIN','CHEMICAL','CLEANING','LOW_VALUE_CONSUMABLE','OTHER'
  )),
  responsible_domain VARCHAR(32) NOT NULL,
  control_mode VARCHAR(20) NOT NULL CHECK(control_mode IN('CONSUMABLE','RETURNABLE','ASSET','HAZARDOUS')),
  requires_expiry_control BOOLEAN NOT NULL DEFAULT FALSE,
  requires_certificate BOOLEAN NOT NULL DEFAULT FALSE,
  min_stock NUMERIC(18,4) NOT NULL DEFAULT 0,
  max_stock NUMERIC(18,4),
  reorder_point NUMERIC(18,4) NOT NULL DEFAULT 0,
  issue_approval_level VARCHAR(24) NOT NULL DEFAULT 'SUPERVISOR',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','FROZEN','RETIRED')),
  configured_by VARCHAR(80) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS non_iqc_receipts (
  id BIGSERIAL PRIMARY KEY,
  receipt_no VARCHAR(64) NOT NULL UNIQUE,
  purchase_order_code VARCHAR(80) NOT NULL,
  supplier_code VARCHAR(80) NOT NULL,
  material_code VARCHAR(120) NOT NULL REFERENCES non_iqc_material_profiles(material_code),
  supplier_lot_no VARCHAR(120),
  production_date DATE,
  expiry_date DATE,
  received_qty NUMERIC(18,4) NOT NULL CHECK(received_qty > 0),
  uom VARCHAR(24) NOT NULL,
  po_match BOOLEAN NOT NULL,
  material_match BOOLEAN NOT NULL,
  quantity_match BOOLEAN NOT NULL,
  visual_pass BOOLEAN NOT NULL,
  date_valid BOOLEAN NOT NULL,
  documents_complete BOOLEAN NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(24) NOT NULL CHECK(status IN('AVAILABLE','QUARANTINED','DISPOSITION','WAITING_CLOSURE','CLOSED','EXCEPTION_CLOSED')),
  received_by VARCHAR(80) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS non_iqc_receipt_dispositions (
  id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES non_iqc_receipts(id),
  disposition_type VARCHAR(24) NOT NULL CHECK(disposition_type IN(
    'ACCEPTED','HOLD','SUPPLIER_REPLENISH','RETURN','EXCHANGE','ACCEPT_VARIANCE','CONCESSION','SCRAP'
  )),
  qty NUMERIC(18,4) NOT NULL CHECK(qty >= 0),
  document_no VARCHAR(80) NOT NULL,
  destination VARCHAR(120),
  approvals JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING_RECEIPT' CHECK(status IN('PENDING_RECEIPT','RECEIVED','COMPLETED','CANCELLED')),
  sent_by VARCHAR(80) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by VARCHAR(80),
  received_at TIMESTAMPTZ,
  UNIQUE(receipt_id,disposition_type,document_no)
);

CREATE TABLE IF NOT EXISTS non_iqc_issue_requests (
  id BIGSERIAL PRIMARY KEY,
  request_no VARCHAR(64) NOT NULL UNIQUE,
  material_code VARCHAR(120) NOT NULL REFERENCES non_iqc_material_profiles(material_code),
  qty NUMERIC(18,4) NOT NULL CHECK(qty > 0),
  uom VARCHAR(24) NOT NULL,
  purpose_type VARCHAR(24) NOT NULL CHECK(purpose_type IN('WORK_ORDER','EQUIPMENT','DEPARTMENT','EMPLOYEE','PROJECT','COST_CENTER')),
  purpose_ref VARCHAR(120) NOT NULL,
  cost_center VARCHAR(80) NOT NULL,
  requester VARCHAR(80) NOT NULL,
  required_approval_level VARCHAR(24) NOT NULL,
  approvals JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN('PENDING_APPROVAL','APPROVED','ISSUED','REJECTED','CANCELLED','CLOSED')),
  issued_by VARCHAR(80),
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS non_iqc_loans (
  id BIGSERIAL PRIMARY KEY,
  loan_no VARCHAR(64) NOT NULL UNIQUE,
  issue_request_id BIGINT NOT NULL REFERENCES non_iqc_issue_requests(id),
  item_identifier VARCHAR(128) NOT NULL,
  borrower VARCHAR(80) NOT NULL,
  expected_return_at TIMESTAMPTZ NOT NULL,
  actual_return_at TIMESTAMPTZ,
  return_condition VARCHAR(24),
  loss_resolution TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'BORROWED' CHECK(status IN('BORROWED','RETURNED','OVERDUE','DAMAGED','LOST','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS non_iqc_inventory_controls (
  material_code VARCHAR(120) PRIMARY KEY REFERENCES non_iqc_material_profiles(material_code),
  on_hand_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  available_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  quarantined_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  frozen_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMPTZ,
  last_count_at TIMESTAMPTZ,
  count_variance_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS non_iqc_closure_checks (
  id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES non_iqc_receipts(id),
  check_type VARCHAR(40) NOT NULL,
  result VARCHAR(12) NOT NULL CHECK(result IN('PASS','FAIL','WARNING')),
  detail JSONB NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(receipt_id,check_type)
);

CREATE TABLE IF NOT EXISTS non_iqc_governance_audit (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id BIGINT,
  event_type VARCHAR(48) NOT NULL,
  actor VARCHAR(80) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_non_iqc_receipt_status ON non_iqc_receipts(status,received_at);
CREATE INDEX IF NOT EXISTS idx_non_iqc_disposition_pending ON non_iqc_receipt_dispositions(status,sent_at);
CREATE INDEX IF NOT EXISTS idx_non_iqc_issue_status ON non_iqc_issue_requests(status,created_at);
CREATE INDEX IF NOT EXISTS idx_non_iqc_loan_due ON non_iqc_loans(status,expected_return_at);

INSERT INTO _migrations(filename,hash)
VALUES('197_non_iqc_material_closed_loop.sql','non-iqc-material-closed-loop-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
