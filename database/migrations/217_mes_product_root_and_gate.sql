CREATE TABLE IF NOT EXISTS mes_product_units (
  product_id varchar(80) PRIMARY KEY,
  work_order_code varchar(160) NOT NULL,
  product_code varchar(160) NOT NULL,
  line_code varchar(64) NOT NULL,
  lifecycle_state varchar(32) NOT NULL DEFAULT 'IDENTITY_INCOMPLETE'
    CHECK (lifecycle_state IN ('IDENTITY_INCOMPLETE','IN_PRODUCTION','HOLD','COMPLETED','SCRAPPED','DESTROYED','CANCELLED')),
  current_station_code varchar(64),
  expected_station_code varchar(64),
  route_revision varchar(80) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS mes_product_identifiers (
  identity_id varchar(80) PRIMARY KEY,
  product_id varchar(80) NOT NULL REFERENCES mes_product_units(product_id),
  identity_type varchar(32) NOT NULL CHECK (identity_type IN ('PCBA_SN','SHELL_SN','OTHER')),
  identity_value varchar(200) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REPLACED','REVOKED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by varchar(120) NOT NULL,
  reason text,
  authorization_id varchar(120),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_product_identity_active_value
  ON mes_product_identifiers(upper(identity_value)) WHERE status='ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_product_identity_active_type
  ON mes_product_identifiers(product_id,identity_type) WHERE status='ACTIVE' AND identity_type<>'OTHER';

CREATE TABLE IF NOT EXISTS mes_product_attendance (
  attendance_id varchar(80) PRIMARY KEY,
  product_id varchar(80) NOT NULL REFERENCES mes_product_units(product_id),
  route_revision varchar(80) NOT NULL,
  route_snapshot jsonb NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE','HOLD','COMPLETED','CANCELLED')),
  current_step_id varchar(120) NOT NULL,
  cycle_no integer NOT NULL DEFAULT 1 CHECK (cycle_no > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_product_attendance_active
  ON mes_product_attendance(product_id) WHERE state IN ('ACTIVE','HOLD');

CREATE TABLE IF NOT EXISTS mes_product_station_visits (
  visit_id varchar(80) PRIMARY KEY,
  attendance_id varchar(80) NOT NULL REFERENCES mes_product_attendance(attendance_id),
  product_id varchar(80) NOT NULL REFERENCES mes_product_units(product_id),
  station_code varchar(64) NOT NULL,
  route_step_id varchar(120) NOT NULL,
  visit_no integer NOT NULL CHECK (visit_no > 0),
  state varchar(32) NOT NULL CHECK (state IN ('EXPECTED','IN_STATION','COMPLETED','CHECKED_OUT','HOLD','REJECTED','CLOSED')),
  arrived_at timestamptz,
  completed_at timestamptz,
  checked_out_at timestamptz,
  source_event_id varchar(160),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(attendance_id,route_step_id,visit_no)
);

CREATE TABLE IF NOT EXISTS mes_product_gate_decisions (
  decision_id varchar(80) PRIMARY KEY,
  idempotency_key varchar(200) NOT NULL UNIQUE,
  product_id varchar(80) REFERENCES mes_product_units(product_id),
  identity_value varchar(200) NOT NULL,
  station_code varchar(64) NOT NULL,
  gate_state varchar(24) NOT NULL CHECK (gate_state IN ('ALLOW','HOLD','REJECT','REPAIR_ROUTE','COMPLETED')),
  reason_code varchar(80) NOT NULL,
  next_action varchar(80) NOT NULL,
  destination_station_code varchar(64),
  missing_station_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_identity_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  authorization_id varchar(120),
  operator_id varchar(120) NOT NULL,
  agent_id varchar(160) NOT NULL,
  host_ip varchar(64) NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mes_product_gate_product_time
  ON mes_product_gate_decisions(product_id,decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_product_gate_station_time
  ON mes_product_gate_decisions(station_code,decided_at DESC);

CREATE TABLE IF NOT EXISTS mes_product_dependent_sequences (
  sequence_id varchar(80) PRIMARY KEY,
  product_id varchar(80) NOT NULL REFERENCES mes_product_units(product_id),
  attendance_id varchar(80) NOT NULL REFERENCES mes_product_attendance(attendance_id),
  sequence_type varchar(32) NOT NULL CHECK (sequence_type IN ('NG','REPAIR','RETEST','MISSING_STATION','SCRAP','DESTROY')),
  reason_code varchar(80) NOT NULL,
  parent_step_id varchar(120) NOT NULL,
  ordered_steps jsonb NOT NULL,
  current_step_index integer NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
  state varchar(24) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','COMPLETED','CANCELLED')),
  authorization_id varchar(120),
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS mes_binding_relationships (
  binding_id varchar(80) PRIMARY KEY,
  source_type varchar(32) NOT NULL,
  source_id varchar(200) NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id varchar(200) NOT NULL,
  binding_type varchar(64) NOT NULL,
  quantity numeric(18,6) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status varchar(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('REQUESTED','RESERVED','ACTIVE','REPLACED','UNBOUND','REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  work_order_code varchar(160),
  station_code varchar(64),
  authorization_id varchar(120),
  reason text,
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  replaced_binding_id varchar(80) REFERENCES mes_binding_relationships(binding_id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_binding_active_pair
  ON mes_binding_relationships(source_type,source_id,target_type,target_id,binding_type)
  WHERE status='ACTIVE';
