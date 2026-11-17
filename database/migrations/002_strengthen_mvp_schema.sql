-- Additive MVP schema strengthening for the SMT factory baseline.
-- Keep the original schema intact and extend it with the missing operational tables,
-- history fields, and indexes needed for master data, WMS, traceability, and auditability.

begin;

-- Handle case where permissions table already exists without module/description columns
-- (created by 002_station_integration.sql which uses 'category' instead of 'module')
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS module varchar(40) NOT NULL DEFAULT 'general';
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS description text;

-- Sync category -> module for existing rows so later INSERT...ON CONFLICT works
UPDATE permissions SET module = category WHERE module IS NULL OR module = 'general';
-- Migrate 'category' values to 'module' for known categories
UPDATE permissions SET module = category
  WHERE category IN ('auth','pmc','wms','mes','quality','admin','hr','finance','equipment','traceability','reports','dashboard','erp','oqc','rework');

create table if not exists permissions (
  id bigserial primary key,
  code varchar(80) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  module varchar(40) not null,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  description text,
  updated_at timestamptz not null default now()
);

create table if not exists role_permissions (
  id bigserial primary key,
  role_id bigint not null references roles(id),
  permission_id bigint not null references permissions(id),
  granted_at timestamptz not null default now(),
  unique(role_id, permission_id)
);

create table if not exists process_routes (
  id bigserial primary key,
  code varchar(80) not null unique,
  product_id bigint not null references products(id),
  revision varchar(30) not null,
  status varchar(20) not null default 'draft',
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, revision)
);

create table if not exists process_route_steps (
  id bigserial primary key,
  route_id bigint not null references process_routes(id) on delete cascade,
  step_no integer not null check (step_no > 0),
  station_id bigint references stations(id),
  station_type varchar(40) not null,
  required_scan boolean not null default true,
  required_inspection boolean not null default false,
  output_rule varchar(40) not null default 'pass_through',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(route_id, step_no)
);

create table if not exists customer_po_lines (
  id bigserial primary key,
  customer_po_id bigint not null references customer_pos(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  product_id bigint not null references products(id),
  ordered_qty integer not null check (ordered_qty > 0),
  promised_date date,
  unit_price numeric(18, 4),
  status varchar(20) not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_po_id, line_no)
);

alter table customers
  add column if not exists short_name varchar(80),
  add column if not exists contact_name varchar(120),
  add column if not exists contact_phone varchar(40),
  add column if not exists delivery_address text,
  add column if not exists updated_at timestamptz not null default now();

alter table suppliers
  add column if not exists short_name varchar(80),
  add column if not exists contact_name varchar(120),
  add column if not exists contact_phone varchar(40),
  add column if not exists updated_at timestamptz not null default now();

alter table products
  add column if not exists short_name varchar(120),
  add column if not exists product_type varchar(40),
  add column if not exists default_route_id bigint references process_routes(id),
  add column if not exists updated_at timestamptz not null default now();

alter table materials
  add column if not exists specification text,
  add column if not exists package_type varchar(40),
  add column if not exists msl_level varchar(20),
  add column if not exists shelf_life_days integer,
  add column if not exists updated_at timestamptz not null default now();

alter table boms
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists updated_at timestamptz not null default now();

alter table bom_lines
  add column if not exists substitute_group varchar(80),
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists updated_at timestamptz not null default now();

alter table production_lines
  add column if not exists line_type varchar(40),
  add column if not exists updated_at timestamptz not null default now();

alter table stations
  add column if not exists required_scan boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table machines
  add column if not exists vendor varchar(80),
  add column if not exists model varchar(80),
  add column if not exists updated_at timestamptz not null default now();

alter table storage_locations
  add column if not exists location_type varchar(40),
  add column if not exists updated_at timestamptz not null default now();

alter table customer_pos
  add column if not exists short_name varchar(80),
  add column if not exists created_by bigint references users(id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists closed_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_reason text;

alter table work_order_serial_counters
  add constraint work_order_serial_counters_next_serial_check check (next_serial > 0);

alter table work_orders
  add column if not exists released_by bigint references users(id),
  add column if not exists closed_by bigint references users(id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table material_lots
  add column if not exists lot_status varchar(20) not null default 'open',
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists received_by bigint references users(id),
  add column if not exists storage_location_id bigint references storage_locations(id),
  add column if not exists closed_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table inventory_transactions
  add column if not exists tx_status varchar(20) not null default 'posted',
  add column if not exists voided boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_reason text,
  add column if not exists reference_type varchar(40),
  add column if not exists reference_no varchar(80),
  add column if not exists updated_at timestamptz not null default now();

alter table feeder_bindings
  add column if not exists updated_at timestamptz not null default now();

alter table pcb_serials
  add column if not exists source_work_order_code varchar(80),
  add column if not exists updated_at timestamptz not null default now();

alter table station_events
  add column if not exists traceability_key varchar(120),
  add column if not exists updated_at timestamptz not null default now();

alter table quality_inspections
  add column if not exists inspection_type varchar(40),
  add column if not exists lot_id bigint references material_lots(id),
  add column if not exists updated_at timestamptz not null default now();

alter table repair_records
  add column if not exists reinspection_required boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table defect_codes
  add column if not exists defect_category varchar(40),
  add column if not exists updated_at timestamptz not null default now();

alter table traceability_events
  add column if not exists entity_type varchar(40),
  add column if not exists entity_id bigint,
  add column if not exists actor_id bigint references users(id),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists receiving_orders (
  id bigserial primary key,
  receipt_no varchar(80) not null unique,
  supplier_id bigint not null references suppliers(id),
  document_no varchar(80),
  status varchar(20) not null default 'draft',
  received_at timestamptz,
  operator_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists receiving_order_lines (
  id bigserial primary key,
  receiving_order_id bigint not null references receiving_orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  material_id bigint not null references materials(id),
  material_lot_id bigint references material_lots(id),
  lot_no varchar(80) not null,
  received_qty numeric(18, 4) not null check (received_qty > 0),
  to_location_id bigint references storage_locations(id),
  status varchar(20) not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(receiving_order_id, line_no),
  unique(material_lot_id)
);

create table if not exists iqc_inspections (
  id bigserial primary key,
  inspection_no varchar(80) not null unique,
  receiving_order_line_id bigint references receiving_order_lines(id),
  material_lot_id bigint not null references material_lots(id),
  defect_code_id bigint references defect_codes(id),
  inspection_type varchar(40) not null default 'incoming',
  result varchar(20) not null,
  sampled_qty numeric(18, 4),
  inspected_qty numeric(18, 4),
  operator_id bigint not null references users(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pick_orders (
  id bigserial primary key,
  pick_no varchar(80) not null unique,
  work_order_id bigint not null references work_orders(id),
  source_location_id bigint references storage_locations(id),
  status varchar(20) not null default 'draft',
  required_qty numeric(18, 4) not null check (required_qty > 0),
  picked_qty numeric(18, 4) not null default 0,
  operator_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pick_order_lines (
  id bigserial primary key,
  pick_order_id bigint not null references pick_orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  material_lot_id bigint not null references material_lots(id),
  requested_qty numeric(18, 4) not null check (requested_qty > 0),
  picked_qty numeric(18, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(pick_order_id, line_no)
);

create table if not exists line_issue_orders (
  id bigserial primary key,
  issue_no varchar(80) not null unique,
  work_order_id bigint not null references work_orders(id),
  line_id bigint not null references production_lines(id),
  source_location_id bigint references storage_locations(id),
  target_location_id bigint references storage_locations(id),
  status varchar(20) not null default 'draft',
  issued_qty numeric(18, 4) not null check (issued_qty > 0),
  operator_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists line_issue_order_lines (
  id bigserial primary key,
  line_issue_order_id bigint not null references line_issue_orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  material_lot_id bigint not null references material_lots(id),
  issued_qty numeric(18, 4) not null check (issued_qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(line_issue_order_id, line_no)
);

create table if not exists line_return_orders (
  id bigserial primary key,
  return_no varchar(80) not null unique,
  work_order_id bigint not null references work_orders(id),
  line_id bigint not null references production_lines(id),
  from_location_id bigint references storage_locations(id),
  to_location_id bigint references storage_locations(id),
  status varchar(20) not null default 'draft',
  returned_qty numeric(18, 4) not null check (returned_qty > 0),
  reason_code varchar(40),
  operator_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists line_return_order_lines (
  id bigserial primary key,
  line_return_order_id bigint not null references line_return_orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  material_lot_id bigint not null references material_lots(id),
  returned_qty numeric(18, 4) not null check (returned_qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(line_return_order_id, line_no)
);

create table if not exists audit_logs (
  id bigserial primary key,
  actor_id bigint references users(id),
  action varchar(80) not null,
  entity_type varchar(80) not null,
  entity_id bigint,
  before_data jsonb,
  after_data jsonb,
  reference_no varchar(80),
  ip_address inet,
  user_agent text,
  occurred_at timestamptz not null default now()
);

alter table customers
  add constraint customers_status_check check (status in ('active', 'inactive', 'suspended', 'voided'));

alter table suppliers
  add constraint suppliers_status_check check (status in ('active', 'inactive', 'suspended', 'voided'));

alter table products
  add constraint products_status_check check (status in ('active', 'inactive', 'suspended', 'voided'));

alter table materials
  add constraint materials_status_check check (status in ('active', 'inactive', 'suspended', 'voided'));

alter table boms
  add constraint boms_status_check check (status in ('draft', 'active', 'obsolete', 'voided'));

alter table production_lines
  add constraint production_lines_status_check check (status in ('idle', 'running', 'paused', 'maintenance', 'blocked', 'offline'));

alter table machines
  add constraint machines_status_check check (status in ('ready', 'running', 'down', 'maintenance', 'blocked', 'offline'));

alter table storage_locations
  add constraint storage_locations_status_check check (status in ('active', 'inactive', 'hold', 'quarantine', 'blocked', 'voided'));

alter table customer_pos
  add constraint customer_pos_status_check check (status in ('draft', 'confirmed', 'released', 'closed', 'voided'));

alter table work_orders
  add constraint work_orders_status_check check (status in ('draft', 'released', 'running', 'paused', 'closed', 'cancelled', 'voided')),
  add constraint work_orders_completed_qty_check check (completed_qty >= 0 and completed_qty <= planned_qty);

alter table material_lots
  add constraint material_lots_iqc_status_check check (iqc_status in ('pending', 'hold', 'released', 'rejected', 'voided')),
  add constraint material_lots_lot_status_check check (lot_status in ('open', 'reserved', 'consumed', 'closed', 'voided'));

alter table inventory_transactions
  add constraint inventory_transactions_action_check check (action in ('RECEIVE', 'IQC_RELEASE', 'PUT_AWAY', 'RESERVE', 'PICK', 'ISSUE_TO_LINE', 'RETURN', 'SCRAP', 'ADJUST')),
  add constraint inventory_transactions_status_check check (tx_status in ('posted', 'draft', 'voided'));

alter table feeder_bindings
  add constraint feeder_bindings_unbound_check check (unbound_at is null or unbound_at >= bound_at);

alter table pcb_serials
  add constraint pcb_serials_status_check check (status in ('wip', 'hold', 'passed', 'failed', 'scrapped', 'shipped', 'voided'));

alter table station_events
  add constraint station_events_result_check check (result in ('pass', 'fail', 'hold', 'rework', 'reject', 'skip'));

alter table quality_inspections
  add constraint quality_inspections_result_check check (result in ('pass', 'fail', 'hold', 'reject', 'conditional'));

alter table repair_records
  add constraint repair_records_result_check check (result in ('open', 'closed', 'repaired', 'scrapped', 'rejected'));

alter table traceability_events
  add constraint traceability_events_status_check check (status in ('active', 'voided', 'posted', 'frozen'));

alter table receiving_orders
  add constraint receiving_orders_status_check check (status in ('draft', 'received', 'closed', 'voided'));

alter table receiving_order_lines
  add constraint receiving_order_lines_status_check check (status in ('pending', 'matched', 'closed', 'voided'));

alter table iqc_inspections
  add constraint iqc_inspections_result_check check (result in ('pass', 'fail', 'hold', 'reject', 'conditional'));

alter table pick_orders
  add constraint pick_orders_status_check check (status in ('draft', 'released', 'picked', 'closed', 'voided'));

alter table line_issue_orders
  add constraint line_issue_orders_status_check check (status in ('draft', 'released', 'issued', 'closed', 'voided'));

alter table line_return_orders
  add constraint line_return_orders_status_check check (status in ('draft', 'received', 'closed', 'voided'));

create index if not exists idx_permissions_module on permissions(module, status);
create index if not exists idx_role_permissions_role on role_permissions(role_id);
create index if not exists idx_role_permissions_permission on role_permissions(permission_id);
create index if not exists idx_process_routes_product on process_routes(product_id, revision);
create index if not exists idx_process_route_steps_route on process_route_steps(route_id, step_no);
create index if not exists idx_customer_po_lines_po on customer_po_lines(customer_po_id, line_no);
create index if not exists idx_customer_po_lines_product on customer_po_lines(product_id);
create index if not exists idx_customers_status on customers(status);
create index if not exists idx_suppliers_status on suppliers(status);
create index if not exists idx_products_status on products(status);
create index if not exists idx_materials_status on materials(status);
create index if not exists idx_boms_product_revision on boms(product_id, revision);
create index if not exists idx_bom_lines_bom on bom_lines(bom_id, material_id);
create index if not exists idx_production_lines_status on production_lines(status);
create index if not exists idx_stations_line on stations(line_id, code);
create index if not exists idx_machines_line on machines(line_id, status);
create index if not exists idx_storage_locations_area on storage_locations(area, status);
create index if not exists idx_customer_pos_customer on customer_pos(customer_id, status);
create index if not exists idx_work_orders_line_status on work_orders(line_id, status, created_at desc);
create index if not exists idx_work_orders_po on work_orders(customer_po_id, created_at desc);
create index if not exists idx_material_lots_material_status on material_lots(material_id, iqc_status, received_at desc);
create index if not exists idx_material_lots_supplier on material_lots(supplier_id, received_at desc);
create index if not exists idx_inventory_transactions_lot_occurred on inventory_transactions(material_lot_id, occurred_at desc);
create index if not exists idx_inventory_transactions_work_order on inventory_transactions(work_order_id, occurred_at desc);
create index if not exists idx_inventory_transactions_action on inventory_transactions(action, occurred_at desc);
create index if not exists idx_feeder_bindings_work_order on feeder_bindings(work_order_id, bound_at desc);
create index if not exists idx_feeder_bindings_lot on feeder_bindings(material_lot_id, bound_at desc);
create index if not exists idx_pcb_serials_work_order on pcb_serials(work_order_id, created_at desc);
create index if not exists idx_station_events_pcb on station_events(pcb_serial_id, occurred_at desc);
create index if not exists idx_station_events_station on station_events(station_id, occurred_at desc);
create index if not exists idx_quality_inspections_work_order on quality_inspections(work_order_id, occurred_at desc);
create index if not exists idx_quality_inspections_pcb on quality_inspections(pcb_serial_id, occurred_at desc);
create index if not exists idx_traceability_events_key on traceability_events(trace_key, occurred_at desc);
create index if not exists idx_traceability_events_ref on traceability_events(reference_no, occurred_at desc);
create index if not exists idx_receiving_orders_supplier on receiving_orders(supplier_id, received_at desc);
create index if not exists idx_receiving_order_lines_order on receiving_order_lines(receiving_order_id, line_no);
create index if not exists idx_iqc_inspections_lot on iqc_inspections(material_lot_id, occurred_at desc);
create index if not exists idx_pick_orders_work_order on pick_orders(work_order_id, created_at desc);
create index if not exists idx_line_issue_orders_work_order on line_issue_orders(work_order_id, created_at desc);
create index if not exists idx_line_return_orders_work_order on line_return_orders(work_order_id, created_at desc);
create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id, occurred_at desc);
create index if not exists idx_audit_logs_actor on audit_logs(actor_id, occurred_at desc);

commit;
