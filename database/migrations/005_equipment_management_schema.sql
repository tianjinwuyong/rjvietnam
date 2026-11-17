-- Equipment management extension for the SMT factory platform.
-- Adds master data, maintenance planning, execution, downtime, calibration,
-- and event history tables for MES equipment control.

begin;

create table if not exists equipment_categories (
  id bigserial primary key,
  code varchar(60) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_models (
  id bigserial primary key,
  code varchar(80) not null unique,
  category_id bigint not null references equipment_categories(id),
  vendor_name varchar(120) not null,
  model_name varchar(120) not null,
  description text,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id, vendor_name, model_name)
);

create table if not exists equipment_locations (
  id bigserial primary key,
  code varchar(60) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  location_type varchar(40) not null,
  line_id bigint references production_lines(id),
  station_id bigint references stations(id),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_status_codes (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  category varchar(40) not null default 'operational',
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_assets (
  id bigserial primary key,
  asset_code varchar(80) not null unique,
  category_id bigint references equipment_categories(id),
  model_id bigint references equipment_models(id),
  machine_id bigint references machines(id),
  line_id bigint references production_lines(id),
  station_id bigint references stations(id),
  location_id bigint references equipment_locations(id),
  serial_no varchar(120),
  purchase_date date,
  install_date date,
  warranty_expiry date,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(machine_id)
);

create table if not exists equipment_spare_parts (
  id bigserial primary key,
  part_code varchar(80) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  material_id bigint references materials(id),
  uom varchar(20) not null default 'PCS',
  min_stock_qty numeric(18, 4) not null default 0,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_plans (
  id bigserial primary key,
  plan_no varchar(80) not null unique,
  asset_id bigint not null references equipment_assets(id) on delete cascade,
  plan_type varchar(40) not null default 'preventive',
  frequency_type varchar(20) not null default 'days',
  frequency_value integer not null check (frequency_value > 0),
  next_due_date date,
  status varchar(20) not null default 'active',
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_plan_steps (
  id bigserial primary key,
  plan_id bigint not null references maintenance_plans(id) on delete cascade,
  step_no integer not null check (step_no > 0),
  step_name varchar(160) not null,
  instruction text,
  required_scan boolean not null default false,
  required_check boolean not null default true,
  standard_minutes integer,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, step_no)
);

create table if not exists maintenance_plan_assignments (
  id bigserial primary key,
  plan_id bigint not null references maintenance_plans(id) on delete cascade,
  assignee_user_id bigint not null references users(id),
  assignment_role varchar(40) not null default 'owner',
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, assignee_user_id, assignment_role)
);

create table if not exists maintenance_schedules (
  id bigserial primary key,
  schedule_no varchar(80) not null unique,
  plan_id bigint not null references maintenance_plans(id) on delete cascade,
  asset_id bigint not null references equipment_assets(id),
  scheduled_date date not null,
  planned_start timestamptz,
  planned_end timestamptz,
  status varchar(20) not null default 'planned',
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_orders (
  id bigserial primary key,
  order_no varchar(80) not null unique,
  schedule_id bigint references maintenance_schedules(id),
  plan_id bigint references maintenance_plans(id),
  asset_id bigint not null references equipment_assets(id),
  order_type varchar(40) not null default 'preventive',
  priority varchar(20) not null default 'normal',
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  status varchar(20) not null default 'draft',
  operator_id bigint references users(id),
  created_by bigint references users(id),
  closed_by bigint references users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_order_lines (
  id bigserial primary key,
  maintenance_order_id bigint not null references maintenance_orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  task_type varchar(40) not null,
  description text,
  spare_part_id bigint references equipment_spare_parts(id),
  quantity numeric(18, 4) not null default 1,
  result_note text,
  status varchar(20) not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(maintenance_order_id, line_no)
);

create table if not exists maintenance_work_logs (
  id bigserial primary key,
  maintenance_order_id bigint not null references maintenance_orders(id) on delete cascade,
  log_no integer not null check (log_no > 0),
  operator_id bigint not null references users(id),
  work_type varchar(40) not null,
  work_minutes integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(maintenance_order_id, log_no)
);

create table if not exists breakdown_events (
  id bigserial primary key,
  event_no varchar(80) not null unique,
  asset_id bigint not null references equipment_assets(id),
  line_id bigint references production_lines(id),
  station_id bigint references stations(id),
  fault_code varchar(80),
  fault_reason text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  downtime_minutes integer not null default 0,
  operator_id bigint references users(id),
  status varchar(20) not null default 'open',
  traceability_key varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists downtime_events (
  id bigserial primary key,
  downtime_no varchar(80) not null unique,
  asset_id bigint not null references equipment_assets(id),
  line_id bigint references production_lines(id),
  reason_code varchar(80),
  reason_detail text,
  start_at timestamptz not null,
  end_at timestamptz,
  downtime_minutes integer not null default 0,
  status varchar(20) not null default 'open',
  operator_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inspection_tasks (
  id bigserial primary key,
  task_no varchar(80) not null unique,
  asset_id bigint not null references equipment_assets(id) on delete cascade,
  inspection_type varchar(40) not null,
  due_at timestamptz,
  status varchar(20) not null default 'pending',
  assigned_user_id bigint references users(id),
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inspection_results (
  id bigserial primary key,
  result_no varchar(80) not null unique,
  task_id bigint references inspection_tasks(id) on delete set null,
  asset_id bigint not null references equipment_assets(id),
  result varchar(20) not null,
  measured_value numeric(18, 4),
  standard_value numeric(18, 4),
  operator_id bigint not null references users(id),
  occurred_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calibration_records (
  id bigserial primary key,
  calibration_no varchar(80) not null unique,
  asset_id bigint not null references equipment_assets(id),
  calibration_type varchar(40) not null,
  standard_value numeric(18, 4),
  actual_value numeric(18, 4),
  result varchar(20) not null,
  operator_id bigint not null references users(id),
  occurred_at timestamptz not null default now(),
  next_due_at timestamptz,
  certificate_no varchar(120),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_repair_records (
  id bigserial primary key,
  repair_no varchar(80) not null unique,
  breakdown_event_id bigint references breakdown_events(id),
  maintenance_order_id bigint references maintenance_orders(id),
  action_taken text not null,
  result varchar(20) not null default 'closed',
  operator_id bigint not null references users(id),
  closed_at timestamptz,
  reinspection_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_events (
  id bigserial primary key,
  event_no varchar(80) not null unique,
  asset_id bigint not null references equipment_assets(id),
  event_type varchar(40) not null,
  status varchar(20) not null default 'posted',
  actor_id bigint references users(id),
  reference_no varchar(80),
  event_payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_status_history (
  id bigserial primary key,
  asset_id bigint not null references equipment_assets(id) on delete cascade,
  from_status_code varchar(40) references equipment_status_codes(code),
  to_status_code varchar(40) not null references equipment_status_codes(code),
  reason text,
  operator_id bigint references users(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table equipment_categories
  add constraint equipment_categories_status_check check (status in ('active', 'inactive', 'voided'));

alter table equipment_models
  add constraint equipment_models_status_check check (status in ('active', 'inactive', 'voided'));

alter table equipment_locations
  add constraint equipment_locations_status_check check (status in ('active', 'inactive', 'hold', 'blocked', 'voided'));

alter table equipment_status_codes
  add constraint equipment_status_codes_status_check check (status in ('active', 'inactive', 'voided'));

alter table equipment_assets
  add constraint equipment_assets_status_check check (status in ('active', 'idle', 'running', 'maintenance', 'breakdown', 'retired', 'voided'));

alter table equipment_spare_parts
  add constraint equipment_spare_parts_status_check check (status in ('active', 'inactive', 'voided'));

alter table maintenance_plans
  add constraint maintenance_plans_plan_type_check check (plan_type in ('preventive', 'corrective', 'inspection', 'calibration')),
  add constraint maintenance_plans_frequency_type_check check (frequency_type in ('days', 'hours', 'cycles')),
  add constraint maintenance_plans_status_check check (status in ('active', 'inactive', 'voided'));

alter table maintenance_plan_steps
  add constraint maintenance_plan_steps_status_check check (status in ('active', 'inactive', 'voided'));

alter table maintenance_plan_assignments
  add constraint maintenance_plan_assignments_status_check check (status in ('active', 'inactive', 'voided'));

alter table maintenance_schedules
  add constraint maintenance_schedules_status_check check (status in ('planned', 'released', 'completed', 'cancelled', 'voided'));

alter table maintenance_orders
  add constraint maintenance_orders_order_type_check check (order_type in ('preventive', 'corrective', 'inspection', 'calibration', 'overhaul')),
  add constraint maintenance_orders_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint maintenance_orders_status_check check (status in ('draft', 'released', 'in_progress', 'paused', 'completed', 'closed', 'cancelled', 'voided'));

alter table maintenance_order_lines
  add constraint maintenance_order_lines_status_check check (status in ('open', 'done', 'cancelled', 'voided'));

alter table maintenance_work_logs
  add constraint maintenance_work_logs_work_type_check check (work_type in ('inspection', 'repair', 'adjustment', 'replacement', 'cleaning', 'test', 'other'));

alter table breakdown_events
  add constraint breakdown_events_status_check check (status in ('open', 'resolved', 'closed', 'voided'));

alter table downtime_events
  add constraint downtime_events_status_check check (status in ('open', 'closed', 'voided'));

alter table inspection_tasks
  add constraint inspection_tasks_status_check check (status in ('pending', 'assigned', 'done', 'closed', 'voided'));

alter table inspection_results
  add constraint inspection_results_result_check check (result in ('pass', 'fail', 'conditional'));

alter table calibration_records
  add constraint calibration_records_result_check check (result in ('pass', 'fail', 'conditional'));

alter table equipment_repair_records
  add constraint equipment_repair_records_result_check check (result in ('open', 'closed', 'repaired', 'scrapped', 'rejected'));

alter table equipment_events
  add constraint equipment_events_status_check check (status in ('posted', 'draft', 'voided'));

create index if not exists idx_equipment_models_category on equipment_models(category_id, status);
create index if not exists idx_equipment_locations_line on equipment_locations(line_id, station_id, status);
create index if not exists idx_equipment_assets_category on equipment_assets(category_id, status);
create index if not exists idx_equipment_assets_model on equipment_assets(model_id, status);
create index if not exists idx_equipment_assets_line on equipment_assets(line_id, status);
create index if not exists idx_equipment_assets_station on equipment_assets(station_id, status);
create index if not exists idx_equipment_assets_location on equipment_assets(location_id, status);
create index if not exists idx_equipment_spare_parts_material on equipment_spare_parts(material_id, status);
create index if not exists idx_maintenance_plans_asset on maintenance_plans(asset_id, status);
create index if not exists idx_maintenance_plan_steps_plan on maintenance_plan_steps(plan_id, step_no);
create index if not exists idx_maintenance_plan_assignments_plan on maintenance_plan_assignments(plan_id, assignee_user_id);
create index if not exists idx_maintenance_schedules_plan on maintenance_schedules(plan_id, scheduled_date desc);
create index if not exists idx_maintenance_schedules_asset on maintenance_schedules(asset_id, scheduled_date desc);
create index if not exists idx_maintenance_orders_asset on maintenance_orders(asset_id, status, created_at desc);
create index if not exists idx_maintenance_orders_schedule on maintenance_orders(schedule_id, created_at desc);
create index if not exists idx_maintenance_order_lines_order on maintenance_order_lines(maintenance_order_id, line_no);
create index if not exists idx_maintenance_work_logs_order on maintenance_work_logs(maintenance_order_id, log_no);
create index if not exists idx_breakdown_events_asset on breakdown_events(asset_id, start_at desc);
create index if not exists idx_breakdown_events_line on breakdown_events(line_id, start_at desc);
create index if not exists idx_downtime_events_asset on downtime_events(asset_id, start_at desc);
create index if not exists idx_inspection_tasks_asset on inspection_tasks(asset_id, due_at desc);
create index if not exists idx_inspection_results_asset on inspection_results(asset_id, occurred_at desc);
create index if not exists idx_calibration_records_asset on calibration_records(asset_id, occurred_at desc);
create index if not exists idx_equipment_repair_records_breakdown on equipment_repair_records(breakdown_event_id, closed_at desc);
create index if not exists idx_equipment_events_asset on equipment_events(asset_id, occurred_at desc);
-- Add asset_id column to equipment_status_history if it doesn't exist (pre-existing table from 004 may be missing this column)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='equipment_status_history' and column_name='asset_id') then
    alter table equipment_status_history add column asset_id bigint references equipment_assets(id);
  end if;
end $$;

create index if not exists idx_equipment_status_history_asset on equipment_status_history(asset_id, changed_at desc);

commit;
