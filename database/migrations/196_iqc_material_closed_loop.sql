BEGIN;

CREATE TABLE IF NOT EXISTS iqc_control_lots(
  id BIGSERIAL PRIMARY KEY,
  inspection_lot_no VARCHAR(64) NOT NULL UNIQUE,
  incoming_record_id BIGINT NOT NULL REFERENCES wms_incoming_records(id),
  supplier_code VARCHAR(80) NOT NULL,
  material_code VARCHAR(120) NOT NULL,
  supplier_lot_no VARCHAR(120) NOT NULL,
  production_date DATE,
  expiry_date DATE,
  receipt_batch VARCHAR(80) NOT NULL,
  received_qty NUMERIC(18,4) NOT NULL CHECK(received_qty>0),
  uom VARCHAR(24) NOT NULL,
  risk_level VARCHAR(16) NOT NULL CHECK(risk_level IN('LOW','NORMAL','HIGH','CRITICAL')),
  inspection_mode VARCHAR(16) NOT NULL CHECK(inspection_mode IN('EXEMPT','REDUCED','NORMAL','TIGHTENED','FULL')),
  sample_size INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'WAITING_SAMPLE' CHECK(status IN(
    'WAITING_SAMPLE','INSPECTING','WAITING_DECISION','PASS','REJECT','HOLD','SORTING',
    'REWORK','RETEST_PENDING','CONCESSION_PENDING','DISPOSITION','WAITING_CLOSURE','CLOSED','EXCEPTION_CLOSED'
  )),
  due_at TIMESTAMPTZ NOT NULL,
  inspector_id VARCHAR(80),
  decision VARCHAR(24),
  decision_at TIMESTAMPTZ,
  created_by VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(supplier_code,material_code,supplier_lot_no,production_date,expiry_date,receipt_batch)
);

CREATE TABLE IF NOT EXISTS iqc_measurement_results(
  id BIGSERIAL PRIMARY KEY,
  control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  sample_no VARCHAR(40) NOT NULL,
  inspection_item VARCHAR(120) NOT NULL,
  standard_version VARCHAR(40) NOT NULL,
  lower_limit NUMERIC(18,6),
  upper_limit NUMERIC(18,6),
  measured_value NUMERIC(18,6),
  text_result TEXT,
  result VARCHAR(12) NOT NULL CHECK(result IN('PASS','FAIL')),
  equipment_code VARCHAR(80),
  equipment_calibration_valid BOOLEAN NOT NULL,
  inspector_id VARCHAR(80) NOT NULL,
  inspector_qualified BOOLEAN NOT NULL,
  environment JSONB NOT NULL DEFAULT '{}',
  attachments JSONB NOT NULL DEFAULT '[]',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iqc_quantity_dispositions(
  id BIGSERIAL PRIMARY KEY,
  control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  disposition_type VARCHAR(24) NOT NULL CHECK(disposition_type IN(
    'ACCEPTED','HOLD','SORTING','RETURN_TO_SUPPLIER','REWORK','RETEST','SCRAP','CONCESSION'
  )),
  qty NUMERIC(18,4) NOT NULL CHECK(qty>=0),
  internal_lot_no VARCHAR(120),
  document_no VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING_RECEIPT' CHECK(status IN('PENDING_RECEIPT','RECEIVED','COMPLETED','CANCELLED')),
  destination VARCHAR(120),
  sent_by VARCHAR(80) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by VARCHAR(80),
  received_at TIMESTAMPTZ,
  UNIQUE(control_lot_id,disposition_type,document_no)
);

CREATE TABLE IF NOT EXISTS iqc_retest_requests(
  id BIGSERIAL PRIMARY KEY,request_no VARCHAR(64) NOT NULL UNIQUE,control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  reason TEXT NOT NULL,evidence JSONB NOT NULL DEFAULT '[]',status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
  CHECK(status IN('PENDING_APPROVAL','APPROVED','REJECTED','COMPLETED')),requested_by VARCHAR(80) NOT NULL,
  approved_by VARCHAR(80),approved_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iqc_concession_requests(
  id BIGSERIAL PRIMARY KEY,request_no VARCHAR(64) NOT NULL UNIQUE,control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  work_order_code VARCHAR(50) NOT NULL,approved_qty NUMERIC(18,4) NOT NULL,valid_until TIMESTAMPTZ NOT NULL,
  risk_controls JSONB NOT NULL,evidence JSONB NOT NULL DEFAULT '[]',
  required_roles JSONB NOT NULL DEFAULT '["QUALITY_MANAGER","ENGINEERING","PMC","PRODUCTION_MANAGER"]',
  approvals JSONB NOT NULL DEFAULT '[]',status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
  CHECK(status IN('PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED','CONSUMED')),
  requested_by VARCHAR(80) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_quality_capa(
  id BIGSERIAL PRIMARY KEY,capa_no VARCHAR(64) NOT NULL UNIQUE,control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  severity VARCHAR(16) NOT NULL,supplier_code VARCHAR(80) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'NOTIFIED',
  supplier_ack_at TIMESTAMPTZ,containment_due_at TIMESTAMPTZ NOT NULL,full_response_due_at TIMESTAMPTZ NOT NULL,
  containment TEXT,root_cause TEXT,corrective_action TEXT,effectiveness_result TEXT,
  closed_by VARCHAR(80),closed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iqc_closure_checks(
  id BIGSERIAL PRIMARY KEY,control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  check_type VARCHAR(40) NOT NULL,result VARCHAR(12) NOT NULL CHECK(result IN('PASS','FAIL','WARNING')),
  detail JSONB NOT NULL DEFAULT '{}',checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(control_lot_id,check_type)
);

CREATE TABLE IF NOT EXISTS iqc_governance_audit(
  id BIGSERIAL PRIMARY KEY,control_lot_id BIGINT NOT NULL REFERENCES iqc_control_lots(id),
  event_type VARCHAR(48) NOT NULL,actor VARCHAR(80) NOT NULL,detail JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iqc_control_status_due ON iqc_control_lots(status,due_at);
CREATE INDEX IF NOT EXISTS idx_iqc_disposition_pending ON iqc_quantity_dispositions(status,sent_at);
CREATE INDEX IF NOT EXISTS idx_iqc_capa_status_due ON supplier_quality_capa(status,containment_due_at,full_response_due_at);

INSERT INTO _migrations(filename,hash)
VALUES('196_iqc_material_closed_loop.sql','iqc-material-closed-loop-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
