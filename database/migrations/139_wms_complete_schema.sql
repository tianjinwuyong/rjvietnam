-- Complete WMS operational schema. Additive only: existing production tables
-- remain authoritative and no inventory or document data is rewritten.

CREATE TABLE IF NOT EXISTS wms_warehouses (
  id bigserial PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120), name_vi varchar(120),
  warehouse_type varchar(30) NOT NULL DEFAULT 'RAW_MATERIAL',
  site_code varchar(40) NOT NULL DEFAULT 'VN-01',
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  manager_id bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('ACTIVE','INACTIVE','LOCKED'))
);

CREATE TABLE IF NOT EXISTS wms_zones (
  id bigserial PRIMARY KEY,
  warehouse_id bigint NOT NULL REFERENCES wms_warehouses(id),
  code varchar(50) NOT NULL,
  name_zh varchar(120) NOT NULL, name_en varchar(120), name_vi varchar(120),
  zone_type varchar(30) NOT NULL,
  temperature_min numeric(8,2), temperature_max numeric(8,2),
  humidity_min numeric(8,2), humidity_max numeric(8,2),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);

ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS warehouse_id bigint REFERENCES wms_warehouses(id);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS zone_id bigint REFERENCES wms_zones(id);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS capacity_qty numeric(18,4);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS locked_reason text;

CREATE TABLE IF NOT EXISTS wms_material_categories (
  id bigserial PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  name_zh varchar(120) NOT NULL, name_en varchar(120), name_vi varchar(120),
  parent_id bigint REFERENCES wms_material_categories(id),
  iqc_required boolean NOT NULL DEFAULT true,
  fifo_method varchar(10) NOT NULL DEFAULT 'FIFO' CHECK (fifo_method IN ('FIFO','FEFO')),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_units_of_measure (
  code varchar(20) PRIMARY KEY,
  name_zh varchar(80) NOT NULL, name_en varchar(80), name_vi varchar(80),
  decimal_places smallint NOT NULL DEFAULT 4,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
);

ALTER TABLE materials ADD COLUMN IF NOT EXISTS category_id bigint REFERENCES wms_material_categories(id);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS min_stock_qty numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS max_stock_qty numeric(18,4);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS safety_stock_qty numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS storage_condition varchar(120);

CREATE TABLE IF NOT EXISTS wms_supplier_materials (
  id bigserial PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES suppliers(id),
  material_id bigint NOT NULL REFERENCES materials(id),
  supplier_material_code varchar(100),
  approved boolean NOT NULL DEFAULT false,
  lead_time_days integer, minimum_order_qty numeric(18,4),
  effective_from date, effective_to date,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, material_id)
);

CREATE TABLE IF NOT EXISTS wms_inspection_plans (
  id bigserial PRIMARY KEY,
  plan_code varchar(60) NOT NULL UNIQUE,
  material_id bigint REFERENCES materials(id),
  category_id bigint REFERENCES wms_material_categories(id),
  revision varchar(30) NOT NULL DEFAULT 'A',
  sampling_standard varchar(80), aql_level varchar(30),
  effective_from date NOT NULL DEFAULT current_date, effective_to date,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  approved_by bigint REFERENCES users(id), approved_at timestamptz,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_inspection_characteristics (
  id bigserial PRIMARY KEY,
  inspection_plan_id bigint NOT NULL REFERENCES wms_inspection_plans(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL,
  characteristic_code varchar(60) NOT NULL,
  name_zh varchar(160) NOT NULL, name_en varchar(160), name_vi varchar(160),
  data_type varchar(20) NOT NULL DEFAULT 'BOOLEAN',
  unit varchar(20), lower_limit numeric(18,6), upper_limit numeric(18,6),
  required boolean NOT NULL DEFAULT true,
  UNIQUE (inspection_plan_id, sequence_no),
  UNIQUE (inspection_plan_id, characteristic_code)
);

CREATE TABLE IF NOT EXISTS wms_inspection_results (
  id bigserial PRIMARY KEY,
  inspection_id bigint NOT NULL REFERENCES iqc_inspections(id) ON DELETE CASCADE,
  characteristic_id bigint NOT NULL REFERENCES wms_inspection_characteristics(id),
  sample_no integer NOT NULL DEFAULT 1,
  measured_value varchar(200), numeric_value numeric(18,6),
  result varchar(20) NOT NULL CHECK (result IN ('PASS','FAIL','NA')),
  defect_description text, attachment_url text,
  inspected_by bigint REFERENCES users(id), inspected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, characteristic_id, sample_no)
);

CREATE TABLE IF NOT EXISTS wms_nonconformances (
  id bigserial PRIMARY KEY,
  ncr_no varchar(80) NOT NULL UNIQUE,
  material_lot_id bigint NOT NULL REFERENCES material_lots(id),
  inspection_id bigint REFERENCES iqc_inspections(id),
  severity varchar(20) NOT NULL DEFAULT 'MAJOR',
  defect_code varchar(60), defect_description text NOT NULL,
  disposition varchar(30) NOT NULL DEFAULT 'PENDING',
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  responsible_party varchar(30), supplier_id bigint REFERENCES suppliers(id),
  decided_by bigint REFERENCES users(id), decided_at timestamptz,
  created_by bigint REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_lot_status_history (
  id bigserial PRIMARY KEY,
  material_lot_id bigint NOT NULL REFERENCES material_lots(id),
  old_status varchar(30), new_status varchar(30) NOT NULL,
  reason_code varchar(60), reason text,
  source_type varchar(40), source_id varchar(120),
  changed_by bigint REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_fifo_exceptions (
  id bigserial PRIMARY KEY,
  material_id bigint NOT NULL REFERENCES materials(id),
  selected_lot_id bigint NOT NULL REFERENCES material_lots(id),
  expected_lot_id bigint REFERENCES material_lots(id),
  work_order_id bigint REFERENCES work_orders(id),
  reason_code varchar(60) NOT NULL, reason text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  requested_by bigint REFERENCES users(id), approved_by bigint REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
  CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS wms_containers (
  id bigserial PRIMARY KEY,
  container_code varchar(100) NOT NULL UNIQUE,
  container_type varchar(30) NOT NULL CHECK (container_type IN ('TRAY','CARTON','TOTE','PALLET','REEL','OTHER')),
  parent_container_id bigint REFERENCES wms_containers(id),
  location_id bigint REFERENCES storage_locations(id),
  work_order_id bigint REFERENCES work_orders(id),
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  sealed_at timestamptz, sealed_by bigint REFERENCES users(id),
  created_by bigint REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_container_items (
  id bigserial PRIMARY KEY,
  container_id bigint NOT NULL REFERENCES wms_containers(id) ON DELETE CASCADE,
  material_lot_id bigint REFERENCES material_lots(id),
  serial_no varchar(160), qty numeric(18,4) NOT NULL DEFAULT 1,
  added_by bigint REFERENCES users(id), added_at timestamptz NOT NULL DEFAULT now(),
  removed_by bigint REFERENCES users(id), removed_at timestamptz,
  CHECK (material_lot_id IS NOT NULL OR serial_no IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_active_container_serial
  ON wms_container_items(serial_no) WHERE serial_no IS NOT NULL AND removed_at IS NULL;

CREATE TABLE IF NOT EXISTS wms_labels (
  id bigserial PRIMARY KEY,
  label_code varchar(120) NOT NULL UNIQUE,
  label_type varchar(30) NOT NULL,
  entity_type varchar(40) NOT NULL, entity_id varchar(120) NOT NULL,
  template_code varchar(60), print_count integer NOT NULL DEFAULT 0,
  last_printed_at timestamptz, last_printed_by bigint REFERENCES users(id),
  voided_at timestamptz, voided_by bigint REFERENCES users(id), void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_document_approvals (
  id bigserial PRIMARY KEY,
  document_type varchar(40) NOT NULL, document_id varchar(120) NOT NULL,
  approval_step integer NOT NULL DEFAULT 1,
  role_code varchar(50) NOT NULL, approver_id bigint REFERENCES users(id),
  decision varchar(20) NOT NULL DEFAULT 'PENDING', comments text,
  decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, document_id, approval_step, role_code)
);

CREATE TABLE IF NOT EXISTS wms_offline_operations (
  operation_id varchar(120) PRIMARY KEY,
  station_code varchar(80) NOT NULL,
  operation_type varchar(60) NOT NULL,
  entity_type varchar(40) NOT NULL, entity_key varchar(160) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_created_at timestamptz NOT NULL,
  sync_state varchar(20) NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0, last_error text,
  server_received_at timestamptz, applied_at timestamptz,
  CHECK (sync_state IN ('PENDING','SYNCING','APPLIED','CONFLICT','REJECTED'))
);

CREATE TABLE IF NOT EXISTS wms_audit_events (
  id bigserial PRIMARY KEY,
  event_id varchar(120) NOT NULL UNIQUE,
  actor_id bigint REFERENCES users(id), actor_name varchar(120),
  action varchar(80) NOT NULL,
  entity_type varchar(50) NOT NULL, entity_key varchar(160) NOT NULL,
  before_data jsonb, after_data jsonb,
  source_node varchar(80), correlation_id varchar(120),
  ip_address inet, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_zones_warehouse ON wms_zones(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_supplier_materials_material ON wms_supplier_materials(material_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_inspection_plans_material ON wms_inspection_plans(material_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_inspection_results_inspection ON wms_inspection_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_wms_ncr_lot_status ON wms_nonconformances(material_lot_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_lot_status_history_lot ON wms_lot_status_history(material_lot_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wms_fifo_exceptions_status ON wms_fifo_exceptions(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_wms_containers_parent ON wms_containers(parent_container_id);
CREATE INDEX IF NOT EXISTS idx_wms_containers_location ON wms_containers(location_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_container_items_container ON wms_container_items(container_id, removed_at);
CREATE INDEX IF NOT EXISTS idx_wms_labels_entity ON wms_labels(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_wms_document_approvals_pending ON wms_document_approvals(decision, created_at);
CREATE INDEX IF NOT EXISTS idx_wms_offline_sync ON wms_offline_operations(sync_state, client_created_at);
CREATE INDEX IF NOT EXISTS idx_wms_audit_entity ON wms_audit_events(entity_type, entity_key, created_at DESC);

COMMENT ON TABLE inventory_transactions IS 'Canonical immutable WMS inventory ledger; balances must be derived from posted non-voided transactions.';
COMMENT ON TABLE mes_wms_exchange_events IS 'Acknowledged idempotent MES/WMS integration outbox and inbox contract.';
COMMENT ON TABLE wms_offline_operations IS 'Station-side operations queued during network interruption and reconciled after reconnect.';
