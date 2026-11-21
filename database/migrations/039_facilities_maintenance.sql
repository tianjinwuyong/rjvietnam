-- Facilities Maintenance Schema
-- Covers ESD, HVAC, compressed air, power, water, and exhaust systems
-- For SMT factory infrastructure monitoring and preventive maintenance

begin;

-- ============================================================
-- FACILITIES INFRASTRUCTURE MASTER DATA
-- ============================================================

create table if not exists facility_categories (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  parent_id bigint references facility_categories(id),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists facility_assets (
  id bigserial primary key,
  asset_code varchar(80) not null unique,
  category_id bigint not null references facility_categories(id),
  location_id bigint references equipment_locations(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  model varchar(80),
  vendor varchar(120),
  serial_no varchar(120),
  install_date date,
  warranty_expiry date,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sensor/device calibration schedule
create table if not exists facility_sensor_calibration (
  id bigserial primary key,
  sensor_code varchar(80) not null unique,
  asset_id bigint references facility_assets(id),
  calibration_type varchar(40) not null,
  standard_value numeric(18,4),
  tolerance_plus numeric(18,4),
  tolerance_minus numeric(18,4),
  last_calibrated_at timestamptz,
  next_calibration_at timestamptz,
  certificate_no varchar(120),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- FACILITIES MONITORING (Daily / Real-time readings)
-- ============================================================

-- ESD monitoring records
create table if not exists fac_esd_records (
  id bigserial primary key,
  record_no varchar(80) not null unique,
  location_id bigint not null references equipment_locations(id),
  tester_name varchar(80),
  test_type varchar(20) not null, -- wrist_strap, footwear, surface, ion_balancer
  measured_value numeric(18,4) not null,
  unit varchar(20) not null, -- ohm, volt, etc.
  result varchar(20) not null, -- pass, fail
  threshold_min numeric(18,4),
  threshold_max numeric(18,4),
  operator_id bigint references users(id),
  tested_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

-- HVAC /温湿度 records
create table if not exists fac_hvac_records (
  id bigserial primary key,
  record_no varchar(80) not null unique,
  location_id bigint not null references equipment_locations(id),
  temperature numeric(8,2), -- Celsius
  humidity numeric(8,2), -- percent RH
  dust_level numeric(10,2), -- optional
  result varchar(20) not null, -- pass, fail, alert
  operator_id bigint references users(id),
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

-- Compressed air system records
create table if not exists fac_air_records (
  id bigserial primary key,
  record_no varchar(80) not null unique,
  pressure_mpa numeric(8,3),
  pressure_psi numeric(8,2),
  dew_point numeric(8,2),
  oil_content_ppm numeric(10,2),
  result varchar(20) not null,
  operator_id bigint references users(id),
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

-- Power quality records
create table if not exists fac_power_records (
  id bigserial primary key,
  record_no varchar(80) not null unique,
  location_id bigint not null references equipment_locations(id),
  voltage_l1 numeric(10,2),
  voltage_l2 numeric(10,2),
  voltage_l3 numeric(10,2),
  current_amps numeric(10,2),
  frequency_hz numeric(6,2),
  power_kw numeric(10,3),
  power_factor numeric(5,3),
  result varchar(20) not null,
  operator_id bigint references users(id),
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

-- Pure water quality records
create table if not exists fac_water_records (
  id bigserial primary key,
  record_no varchar(80) not null unique,
  conductivity numeric(10,3), -- μS/cm
  ph numeric(5,2),
  tds_ppm numeric(10,2),
  result varchar(20) not null,
  operator_id bigint references users(id),
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- FACILITIES MAINTENANCE ORDERS (linked to equipment_orders)
-- ============================================================

-- Reuses maintenance_orders from 005_equipment_management_schema.sql
-- Add facility-specific order type
alter table maintenance_orders drop constraint if exists maintenance_orders_order_type_check;
alter table maintenance_orders add constraint maintenance_orders_order_type_check
  check (order_type in ('preventive', 'corrective', 'inspection', 'calibration', 'overhaul', 'facilities'));

-- ============================================================
-- ALERTS AND THRESHOLDS
-- ============================================================

create table if not exists fac_alert_rules (
  id bigserial primary key,
  rule_code varchar(80) not null unique,
  category_id bigint references facility_categories(id),
  asset_id bigint references facility_assets(id),
  sensor_type varchar(40) not null, -- esd, hvac, air, power, water
  metric_name varchar(80) not null,
  threshold_min numeric(18,4),
  threshold_max numeric(18,4),
  severity varchar(20) not null default 'warning', -- info, warning, critical
  action_required boolean not null default true,
  notify_roles text, -- comma-separated role codes
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fac_alerts (
  id bigserial primary key,
  alert_no varchar(80) not null unique,
  rule_id bigint references fac_alert_rules(id),
  asset_id bigint references facility_assets(id),
  location_id bigint references equipment_locations(id),
  metric_name varchar(80) not null,
  measured_value numeric(18,4),
  threshold_min numeric(18,4),
  threshold_max numeric(18,4),
  severity varchar(20) not null,
  status varchar(20) not null default 'open', -- open, acknowledged, resolved, closed
  acknowledged_by bigint references users(id),
  acknowledged_at timestamptz,
  resolved_by bigint references users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- COMPLIANCE LOGS
-- ============================================================

create table if not exists fac_compliance_logs (
  id bigserial primary key,
  log_no varchar(80) not null unique,
  category_id bigint not null references facility_categories(id),
  standard_name varchar(120), -- e.g. ISO 9001, ESD S20.20
  check_item varchar(200) not null,
  result varchar(20) not null, -- pass, fail, na
  evidence text,
  inspector_id bigint references users(id),
  inspected_at timestamptz not null default now(),
  next_inspection_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CONSTRAINTS
-- ============================================================

alter table facility_categories add constraint fac_category_status_check check (status in ('active','inactive','voided'));
alter table facility_assets add constraint fac_asset_status_check check (status in ('active','maintenance','retired','voided'));
alter table facility_sensor_calibration add constraint fac_sensor_cal_status_check check (status in ('active','expired','voided'));
alter table fac_esd_records add constraint fac_esd_result_check check (result in ('pass','fail'));
alter table fac_hvac_records add constraint fac_hvac_result_check check (result in ('pass','fail','alert'));
alter table fac_air_records add constraint fac_air_result_check check (result in ('pass','fail','alert'));
alter table fac_power_records add constraint fac_power_result_check check (result in ('pass','fail','alert'));
alter table fac_water_records add constraint fac_water_result_check check (result in ('pass','fail','alert'));
alter table fac_alert_rules add constraint fac_alert_rule_severity_check check (severity in ('info','warning','critical'));
alter table fac_alerts add constraint fac_alert_status_check check (status in ('open','acknowledged','resolved','closed','voided'));
alter table fac_compliance_logs add constraint fac_compliance_result_check check (result in ('pass','fail','na'));

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_facility_assets_category on facility_assets(category_id, status);
create index if not exists idx_facility_assets_location on facility_assets(location_id, status);
create index if not exists idx_facility_sensor_cal_asset on facility_sensor_calibration(asset_id, status);
create index if not exists idx_fac_esd_records_location on fac_esd_records(location_id, tested_at desc);
create index if not exists idx_fac_esd_records_tester on fac_esd_records(tester_name, tested_at desc);
create index if not exists idx_fac_hvac_records_location on fac_hvac_records(location_id, recorded_at desc);
create index if not exists idx_fac_air_records_date on fac_air_records(recorded_at desc);
create index if not exists idx_fac_power_records_location on fac_power_records(location_id, recorded_at desc);
create index if not exists idx_fac_water_records_date on fac_water_records(recorded_at desc);
create index if not exists idx_fac_alert_rules_asset on fac_alert_rules(asset_id, status);
create index if not exists idx_fac_alert_rules_category on fac_alert_rules(category_id, status);
create index if not exists idx_fac_alerts_asset on fac_alerts(asset_id, status, created_at desc);
create index if not exists idx_fac_alerts_location on fac_alerts(location_id, status, created_at desc);
create index if not exists idx_fac_compliance_logs_category on fac_compliance_logs(category_id, inspected_at desc);
create index if not exists idx_fac_compliance_logs_standard on fac_compliance_logs(standard_name, inspected_at desc);

commit;
