BEGIN;

CREATE TABLE IF NOT EXISTS non_smt_material_profiles(
  material_id BIGINT PRIMARY KEY REFERENCES materials(id),
  tracking_mode VARCHAR(24) NOT NULL CHECK(tracking_mode IN('DIRECT_SN','DIRECT_LOT','PACKAGING_UNIT','INDIRECT_CONSUMABLE')),
  scan_policy VARCHAR(24) NOT NULL CHECK(scan_policy IN('EACH_UNIT','LOT_CHANGE','EACH_PACKAGE','ISSUE_RETURN')),
  consumption_method VARCHAR(24) NOT NULL CHECK(consumption_method IN('UNIT_SCAN','STATION_COUNT','PACKAGE_BIND','WEIGHT_DELTA')),
  warning_tolerance_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  requires_quality_release BOOLEAN NOT NULL DEFAULT TRUE,
  requires_work_order BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','FROZEN','RETIRED')),
  configured_by VARCHAR(80) NOT NULL,
  reason TEXT NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS non_smt_material_events(
  id BIGSERIAL PRIMARY KEY,
  source_event_id VARCHAR(128) NOT NULL UNIQUE,
  event_type VARCHAR(32) NOT NULL CHECK(event_type IN(
    'ISSUED','STATION_RECEIVED','VALIDATED','BOUND','CONSUMED','REPLACED',
    'RETURN_SENT','RETURN_RECEIVED','SCRAPPED','RECONCILED'
  )),
  tracking_mode VARCHAR(24) NOT NULL,
  work_order_code VARCHAR(50) NOT NULL,
  station_code VARCHAR(64),
  material_id BIGINT REFERENCES materials(id),
  material_code VARCHAR(80) NOT NULL,
  material_sn VARCHAR(128),
  lot_no VARCHAR(80),
  package_code VARCHAR(128),
  product_sn VARCHAR(128),
  qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  uom VARCHAR(24),
  actor VARCHAR(80) NOT NULL,
  source_system VARCHAR(24) NOT NULL DEFAULT 'STATION',
  offline_lease_id VARCHAR(128),
  raw_payload JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duplicate_delivery_count INTEGER NOT NULL DEFAULT 0,
  last_duplicate_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS non_smt_unit_bindings(
  id BIGSERIAL PRIMARY KEY,
  work_order_code VARCHAR(50) NOT NULL,
  material_id BIGINT NOT NULL REFERENCES materials(id),
  material_code VARCHAR(80) NOT NULL,
  material_sn VARCHAR(128) NOT NULL,
  product_sn VARCHAR(128) NOT NULL,
  binding_type VARCHAR(24) NOT NULL CHECK(binding_type IN('COMPONENT','PACKAGING')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','REPLACED','REMOVED','VOIDED')),
  bound_event_id BIGINT NOT NULL REFERENCES non_smt_material_events(id),
  replaced_by_binding_id BIGINT REFERENCES non_smt_unit_bindings(id),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(material_sn,status)
);

CREATE TABLE IF NOT EXISTS non_smt_return_handovers(
  id BIGSERIAL PRIMARY KEY,
  handover_no VARCHAR(48) NOT NULL UNIQUE,
  work_order_code VARCHAR(50) NOT NULL,
  material_id BIGINT REFERENCES materials(id),
  material_code VARCHAR(80) NOT NULL,
  material_sn VARCHAR(128),
  lot_no VARCHAR(80),
  theoretical_qty NUMERIC(18,4) NOT NULL,
  actual_qty NUMERIC(18,4),
  status VARCHAR(24) NOT NULL DEFAULT 'WAITING_WMS_RECEIPT' CHECK(status IN(
    'WAITING_WMS_RECEIPT','RECEIVED','VARIANCE_REVIEW','QUARANTINED','CANCELLED'
  )),
  sent_by VARCHAR(80) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by VARCHAR(80),
  received_at TIMESTAMPTZ,
  variance_reason TEXT
);

CREATE TABLE IF NOT EXISTS non_smt_material_exceptions(
  id BIGSERIAL PRIMARY KEY,
  exception_no VARCHAR(48) NOT NULL UNIQUE,
  exception_type VARCHAR(32) NOT NULL CHECK(exception_type IN(
    'MATERIAL_MISMATCH','DUPLICATE_BINDING','NG_BLOCKED','QUANTITY_VARIANCE',
    'UNMATCHED_EVENT','OFFLINE_VIOLATION','RETURN_OVERDUE','BOM_VARIANCE','DATA_CONFLICT'
  )),
  severity VARCHAR(12) NOT NULL CHECK(severity IN('WARNING','BLOCK','CRITICAL')),
  work_order_code VARCHAR(50),
  station_code VARCHAR(64),
  material_code VARCHAR(80),
  material_sn VARCHAR(128),
  source_ref VARCHAR(128),
  detail JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','INVESTIGATING','RESOLVED','VOIDED')),
  owner_domain VARCHAR(24) NOT NULL DEFAULT 'WMS',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(80),
  resolution TEXT
);

CREATE TABLE IF NOT EXISTS non_smt_work_order_reconciliations(
  id BIGSERIAL PRIMARY KEY,
  work_order_code VARCHAR(50) NOT NULL,
  material_id BIGINT NOT NULL REFERENCES materials(id),
  bom_required_qty NUMERIC(18,4) NOT NULL,
  issued_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  consumed_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  returned_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  scrapped_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  variance_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  result VARCHAR(16) NOT NULL CHECK(result IN('PASS','WARNING','FAIL')),
  detail JSONB NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(work_order_code,material_id)
);

CREATE INDEX IF NOT EXISTS idx_non_smt_event_wo_time ON non_smt_material_events(work_order_code,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_non_smt_event_material_sn ON non_smt_material_events(material_sn,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_non_smt_exception_open ON non_smt_material_exceptions(status,severity,detected_at);
CREATE INDEX IF NOT EXISTS idx_non_smt_return_waiting ON non_smt_return_handovers(status,sent_at);

INSERT INTO _migrations(filename,hash)
VALUES('195_wms_non_smt_material_closed_loop.sql','wms-non-smt-closed-loop-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
