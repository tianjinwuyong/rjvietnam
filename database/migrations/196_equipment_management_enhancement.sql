-- =====================================================================
-- Migration 196: Equipment Management Enhancement (P1)
-- Grill decisions: Q1-Q20 (设备管理GRILLING.md)
-- 1. ALTER equipment_assets: full archive fields
-- 2. ALTER maintenance_work_orders: full repair workflow
-- 3. NEW: fault_codes (3-level)
-- 4. NEW: pm_templates + pm_template_tasks (5-level PM)
-- 5. NEW: pm_execution_records + pm_execution_items
-- 6. NEW: equipment_documents
-- 7. NEW: equipment_components (hierarchy)
-- 8. NEW: equipment_meter_readings
-- 9. NEW: notification_rules
-- 10. Seed: fault codes, PM templates, notification rules
-- =====================================================================

begin;

-- ============================================================
-- 1. ALTER equipment_assets — full archive fields (Q4-D)
-- ============================================================

-- Multilingual name
alter table equipment_assets add column if not exists name_zh varchar(200);
alter table equipment_assets add column if not exists name_en varchar(200);
alter table equipment_assets add column if not exists name_vi varchar(200);

-- Criticality (A=critical/B=important/C=general)
alter table equipment_assets add column if not exists criticality varchar(1) default 'B'
  check (criticality in ('A','B','C'));

-- Financial
alter table equipment_assets add column if not exists purchase_price numeric(18,2);
alter table equipment_assets add column if not exists currency varchar(10) default 'USD';
alter table equipment_assets add column if not exists depreciation_years integer default 10;
alter table equipment_assets add column if not exists depreciation_method varchar(40) default 'straight_line';
alter table equipment_assets add column if not exists current_value numeric(18,2);

-- Technical specs
alter table equipment_assets add column if not exists rated_power_kw numeric(10,2);
alter table equipment_assets add column if not exists rated_voltage varchar(60);
alter table equipment_assets add column if not exists rated_speed varchar(120);
alter table equipment_assets add column if not exists operating_temp_range varchar(60);
alter table equipment_assets add column if not exists dimensions varchar(200);
alter table equipment_assets add column if not exists weight_kg numeric(10,2);
alter table equipment_assets add column if not exists software_version varchar(80);
alter table equipment_assets add column if not exists firmware_version varchar(80);
alter table equipment_assets add column if not exists air_supply_req varchar(120);

-- Manufacturer & dates
alter table equipment_assets add column if not exists manufacturer varchar(200);
alter table equipment_assets add column if not exists manufacture_date date;
alter table equipment_assets add column if not exists commissioned_date date;

-- Hierarchy (parent asset for sub-components)
alter table equipment_assets add column if not exists parent_asset_id bigint references equipment_assets(id);

-- QR code
alter table equipment_assets add column if not exists qr_code varchar(200);

-- Responsible engineer
alter table equipment_assets add column if not exists responsible_engineer_id bigint references users(id);

-- Cumulative tracking
alter table equipment_assets add column if not exists cumulative_runtime_hours numeric(14,2) default 0;
alter table equipment_assets add column if not exists cumulative_output_count bigint default 0;
alter table equipment_assets add column if not exists total_repair_count integer default 0;
alter table equipment_assets add column if not exists total_repair_cost numeric(18,2) default 0;
alter table equipment_assets add column if not exists total_pm_count integer default 0;

-- Vietnam import specifics (Q20)
alter table equipment_assets add column if not exists import_customs_no varchar(120);
alter table equipment_assets add column if not exists origin_certificate_no varchar(120);
alter table equipment_assets add column if not exists vn_inspection_cert_no varchar(120);

-- Lifecycle state machine
-- existing status varchar(20) — extend allowed values via check
-- States: procuring/received/installing/commissioned/active/standby/repair/scrapped/sealed
alter table equipment_assets drop constraint if exists equipment_assets_status_check;
alter table equipment_assets add constraint equipment_assets_status_check
  check (status in ('active','inactive','voided','procuring','received','installing','commissioned','standby','maintenance','repair','scrapped','sealed'));

create index if not exists idx_ea_parent on equipment_assets(parent_asset_id);
create index if not exists idx_ea_criticality on equipment_assets(criticality);
create index if not exists idx_ea_responsible on equipment_assets(responsible_engineer_id);

-- ============================================================
-- 2. CREATE maintenance_work_orders — full repair workflow (Q2-D)
--    (Migration 004 was never applied; create from scratch)
-- ============================================================

create table if not exists maintenance_work_orders (
  id                bigserial primary key,
  wo_no             varchar(40) unique not null,

  -- Equipment
  equipment_id      bigint references equipment_assets(id),
  equipment_code    varchar(60),
  equipment_name_zh varchar(200),
  line_id           bigint references production_lines(id),
  line_name         varchar(120),

  -- Issue info
  issue_time        timestamptz not null default now(),
  issue_person      varchar(120) not null,
  issue_phone       varchar(40),
  fault_description text not null,
  fault_category    varchar(40) default 'other',
  priority          varchar(20) default 'medium',

  -- Urgency level (Q2-D)
  urgency_level     varchar(20) default 'medium'
    check (urgency_level in ('line_down','speed_reduced','can_continue','planned')),

  -- Work order type
  wo_type           varchar(30) default 'corrective'
    check (wo_type in ('corrective','preventive','predictive','emergency','modification','calibration')),

  -- Fault code (3-level, Q16-B)
  fault_code_id     bigint,
  fault_code_path   varchar(300),

  -- Root cause
  root_cause_category varchar(60)
    check (root_cause_category in ('wear','corrosion','misoperation','design_defect','aging','material_defect','other') or root_cause_category is null),

  -- Assignment & auto-dispatch
  assigned_technician varchar(120),
  assigned_at       timestamptz,

  -- Status workflow
  status            varchar(40) not null default 'waiting_to_process',
  received_at       timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  real_cause        text,
  resolution_notes  text,
  hanging_reason    text,
  handover_to       varchar(120),
  handover_at       timestamptz,
  handover_note     text,

  -- Response SLA
  response_deadline timestamptz,
  sla_breached      boolean default false,

  -- Escalation (Q2-D: 30min->supervisor, 2h->manager)
  escalation_level  integer default 1 check (escalation_level between 1 and 4),
  escalated_at      timestamptz,
  escalated_to      varchar(120),

  -- External repair (外修)
  is_external_repair boolean default false,
  external_vendor   varchar(200),
  external_wo_no    varchar(80),
  external_sent_at  timestamptz,
  external_returned_at timestamptz,
  external_cost     numeric(18,2),

  -- Parts & downtime
  parts_used        jsonb default '[]'::jsonb,
  downtime_minutes  integer default 0,
  photo_urls        text[] default '{}',

  -- Cost breakdown (Q2-D)
  repair_cost_labor    numeric(18,2) default 0,
  repair_cost_parts    numeric(18,2) default 0,
  repair_cost_external numeric(18,2) default 0,
  repair_cost_total    numeric(18,2) default 0,

  -- Verification & closure (Q2-D: trial 5-20 pieces + first article)
  verification_result varchar(20)
    check (verification_result in ('pass','fail','pending') or verification_result is null),
  verified_by       varchar(120),
  verified_at       timestamptz,
  first_article_result varchar(20)
    check (first_article_result in ('pass','fail','na') or first_article_result is null),
  trial_pieces      integer default 0,

  -- Approval (cost threshold, Q11-D)
  approval_status   varchar(20) default 'not_required'
    check (approval_status in ('not_required','pending','approved','rejected')),
  approved_by       varchar(120),
  approved_at       timestamptz,

  -- PM link
  pm_execution_id   bigint,

  -- Meta
  created_by        varchar(120),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- In-place upgrade: the canonical maintenance_work_orders table may already
-- exist from migration 004 without the Q2-D/Q11-D columns. Add every column
-- this migration's indexes and later statements expect.
alter table maintenance_work_orders add column if not exists urgency_level varchar(20) default 'medium';
alter table maintenance_work_orders add column if not exists wo_type varchar(30) default 'corrective';
alter table maintenance_work_orders add column if not exists fault_code_id bigint;
alter table maintenance_work_orders add column if not exists fault_code_path varchar(300);
alter table maintenance_work_orders add column if not exists root_cause_category varchar(60);
alter table maintenance_work_orders add column if not exists response_deadline timestamptz;
alter table maintenance_work_orders add column if not exists sla_breached boolean default false;
alter table maintenance_work_orders add column if not exists escalation_level integer default 1;
alter table maintenance_work_orders add column if not exists escalated_at timestamptz;
alter table maintenance_work_orders add column if not exists escalated_to varchar(120);
alter table maintenance_work_orders add column if not exists is_external_repair boolean default false;
alter table maintenance_work_orders add column if not exists external_vendor varchar(200);
alter table maintenance_work_orders add column if not exists external_wo_no varchar(80);
alter table maintenance_work_orders add column if not exists external_sent_at timestamptz;
alter table maintenance_work_orders add column if not exists external_returned_at timestamptz;
alter table maintenance_work_orders add column if not exists external_cost numeric(18,2);
alter table maintenance_work_orders add column if not exists repair_cost_labor numeric(18,2) default 0;
alter table maintenance_work_orders add column if not exists repair_cost_parts numeric(18,2) default 0;
alter table maintenance_work_orders add column if not exists repair_cost_external numeric(18,2) default 0;
alter table maintenance_work_orders add column if not exists repair_cost_total numeric(18,2) default 0;
alter table maintenance_work_orders add column if not exists verification_result varchar(20);
alter table maintenance_work_orders add column if not exists verified_by varchar(120);
alter table maintenance_work_orders add column if not exists verified_at timestamptz;
alter table maintenance_work_orders add column if not exists first_article_result varchar(20);
alter table maintenance_work_orders add column if not exists trial_pieces integer default 0;
alter table maintenance_work_orders add column if not exists approval_status varchar(20) default 'not_required';
alter table maintenance_work_orders add column if not exists approved_by varchar(120);
alter table maintenance_work_orders add column if not exists approved_at timestamptz;
alter table maintenance_work_orders add column if not exists pm_execution_id bigint;

create index if not exists idx_mwo_status on maintenance_work_orders(status);
create index if not exists idx_mwo_equipment on maintenance_work_orders(equipment_id);
create index if not exists idx_mwo_priority on maintenance_work_orders(priority);
create index if not exists idx_mwo_issue_time on maintenance_work_orders(issue_time desc);
create index if not exists idx_mwo_technician on maintenance_work_orders(assigned_technician);
create index if not exists idx_mwo_urgency on maintenance_work_orders(urgency_level);
create index if not exists idx_mwo_fault_code on maintenance_work_orders(fault_code_id);
create index if not exists idx_mwo_wo_type on maintenance_work_orders(wo_type);
create index if not exists idx_mwo_escalation on maintenance_work_orders(escalation_level);

-- ============================================================
-- 3. NEW: fault_codes — 3-level fault code library (Q16-B)
-- ============================================================

create table if not exists fault_code_categories (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  sort_order integer default 0,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists fault_code_subcategories (
  id bigserial primary key,
  category_id bigint not null references fault_code_categories(id),
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  sort_order integer default 0,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  unique(category_id, code)
);

create table if not exists fault_codes (
  id bigserial primary key,
  subcategory_id bigint not null references fault_code_subcategories(id),
  code varchar(60) not null unique,
  name_zh varchar(200) not null,
  name_en varchar(200) not null,
  name_vi varchar(200) not null,
  description text,
  typical_cause text,
  typical_fix text,
  root_cause_category varchar(60) default 'other'
    check (root_cause_category in ('wear','corrosion','misoperation','design_defect','aging','material_defect','other')),
  applicable_equipment_types text[] default '{}',
  severity varchar(20) default 'medium'
    check (severity in ('critical','high','medium','low')),
  sort_order integer default 0,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add FK from work orders to fault codes
alter table maintenance_work_orders
  drop constraint if exists mwo_fault_code_fk;
alter table maintenance_work_orders
  add constraint mwo_fault_code_fk
  foreign key (fault_code_id) references fault_codes(id);

create index if not exists idx_fc_subcategory on fault_codes(subcategory_id);
create index if not exists idx_fc_root_cause on fault_codes(root_cause_category);

-- ============================================================
-- 4. NEW: pm_templates — 5-level PM templates (Q3-D)
-- ============================================================

create table if not exists pm_templates (
  id bigserial primary key,
  template_code varchar(60) not null unique,
  template_name_zh varchar(200) not null,
  template_name_en varchar(200) not null,
  template_name_vi varchar(200) not null,
  pm_level varchar(20) not null
    check (pm_level in ('daily','weekly','monthly','quarterly','annual')),
  equipment_category_id bigint references equipment_categories(id),
  trigger_type varchar(20) not null default 'calendar'
    check (trigger_type in ('calendar','runtime','both')),
  calendar_interval_days integer,
  runtime_interval_hours numeric(10,2),
  runtime_interval_count bigint,
  estimated_minutes integer default 60,
  required_role varchar(60) default 'technician',
  requires_first_article boolean default false,
  description text,
  status varchar(20) not null default 'active',
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pm_template_tasks (
  id bigserial primary key,
  template_id bigint not null references pm_templates(id) on delete cascade,
  task_no integer not null check (task_no > 0),
  task_name_zh varchar(200) not null,
  task_name_en varchar(200) not null,
  task_name_vi varchar(200) not null,
  instruction text,
  standard_value varchar(120),
  measurement_method varchar(200),
  requires_photo boolean default false,
  requires_measurement boolean default false,
  is_critical boolean default false,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  unique(template_id, task_no)
);

-- In-place upgrade: pm_templates may pre-exist from migration 007 with a
-- different shape. Add the columns this migration (and its seed inserts) need.
alter table pm_templates add column if not exists template_name_zh varchar(200);
alter table pm_templates add column if not exists template_name_en varchar(200);
alter table pm_templates add column if not exists template_name_vi varchar(200);
alter table pm_templates add column if not exists pm_level varchar(20) default 'monthly';
alter table pm_templates add column if not exists equipment_category_id bigint references equipment_categories(id);
alter table pm_templates add column if not exists trigger_type varchar(20) default 'calendar';
alter table pm_templates add column if not exists calendar_interval_days integer;
alter table pm_templates add column if not exists runtime_interval_hours numeric(10,2);
alter table pm_templates add column if not exists runtime_interval_count bigint;
alter table pm_templates add column if not exists estimated_minutes integer default 60;
alter table pm_templates add column if not exists required_role varchar(60) default 'technician';
alter table pm_templates add column if not exists requires_first_article boolean default false;
alter table pm_templates add column if not exists description text;
alter table pm_templates add column if not exists status varchar(20) default 'active';
alter table pm_templates add column if not exists created_by bigint;

-- Legacy NOT NULL columns from the 044-era pm_templates shape conflict with
-- the 196-era inserts; relax them (table is empty on fresh installs).
alter table pm_templates alter column machine_type drop not null;
alter table pm_templates alter column frequency_code drop not null;
alter table pm_templates alter column template_name drop not null;
alter table pm_templates alter column est_duration_minutes drop not null;
alter table pm_templates alter column requires_shutdown drop not null;
alter table pm_templates alter column requires_engineer drop not null;
alter table pm_templates alter column is_active drop not null;

-- Legacy-shaped pm_template_tasks rows (seed 007) need these columns.
alter table pm_template_tasks add column if not exists task_name varchar(200);
alter table pm_template_tasks add column if not exists task_type varchar(40);
alter table pm_template_tasks add column if not exists pass_criteria text;
alter table pm_template_tasks add column if not exists description text;
alter table pm_template_tasks alter column task_name_zh drop not null;
alter table pm_template_tasks alter column task_name_en drop not null;
alter table pm_template_tasks alter column task_name_vi drop not null;

create index if not exists idx_pmt_category on pm_templates(equipment_category_id);
create index if not exists idx_pmt_level on pm_templates(pm_level);

-- ============================================================
-- 5. NEW: pm_execution_records (Q3-D)
-- ============================================================

create table if not exists pm_execution_records (
  id bigserial primary key,
  execution_no varchar(80) not null unique,
  template_id bigint references pm_templates(id),
  asset_id bigint not null references equipment_assets(id),
  work_order_id bigint references maintenance_work_orders(id),
  pm_level varchar(20) not null
    check (pm_level in ('daily','weekly','monthly','quarterly','annual')),
  trigger_type varchar(20) not null default 'calendar'
    check (trigger_type in ('calendar','runtime','manual')),
  scheduled_date date,
  actual_start timestamptz,
  actual_end timestamptz,
  executor_id bigint references users(id),
  result varchar(20) default 'pending'
    check (result in ('pending','in_progress','completed','abnormal','overdue')),
  first_article_result varchar(20)
    check (first_article_result in ('pass','fail','na') or first_article_result is null),
  abnormal_description text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pm_execution_items (
  id bigserial primary key,
  execution_id bigint not null references pm_execution_records(id) on delete cascade,
  template_task_id bigint references pm_template_tasks(id),
  task_no integer not null,
  task_name varchar(200) not null,
  result varchar(20) default 'pending'
    check (result in ('pending','ok','ng','skipped')),
  measured_value varchar(120),
  standard_value varchar(120),
  photo_urls text[] default '{}',
  notes text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(execution_id, task_no)
);

create index if not exists idx_pme_asset on pm_execution_records(asset_id);
create index if not exists idx_pme_template on pm_execution_records(template_id);
create index if not exists idx_pme_result on pm_execution_records(result);
create index if not exists idx_pme_scheduled on pm_execution_records(scheduled_date);

-- ============================================================
-- 6. NEW: equipment_documents (Q4-D)
-- ============================================================

create table if not exists equipment_documents (
  id bigserial primary key,
  asset_id bigint not null references equipment_assets(id) on delete cascade,
  doc_type varchar(40) not null
    check (doc_type in ('manual','repair_manual','electrical_drawing','parts_list',
      'calibration_cert','acceptance_report','import_customs','origin_cert',
      'vn_inspection','warranty_cert','photo','other')),
  doc_name varchar(300) not null,
  file_url varchar(500),
  file_size bigint,
  mime_type varchar(100),
  doc_no varchar(120),
  valid_until date,
  uploaded_by bigint references users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_edoc_asset on equipment_documents(asset_id);
create index if not exists idx_edoc_type on equipment_documents(doc_type);

-- ============================================================
-- 7. NEW: equipment_components — sub-component hierarchy (Q4-D)
-- ============================================================

create table if not exists equipment_components (
  id bigserial primary key,
  asset_id bigint not null references equipment_assets(id) on delete cascade,
  parent_component_id bigint references equipment_components(id),
  component_code varchar(80) not null,
  name_zh varchar(200) not null,
  name_en varchar(200) not null,
  name_vi varchar(200) not null,
  component_type varchar(60),
  serial_no varchar(120),
  manufacturer varchar(200),
  model varchar(120),
  install_date date,
  expected_life_hours numeric(10,2),
  cumulative_runtime_hours numeric(14,2) default 0,
  status varchar(20) not null default 'active'
    check (status in ('active','replaced','repair','scrapped')),
  replaced_at timestamptz,
  replacement_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(asset_id, component_code)
);

create index if not exists idx_ecomp_asset on equipment_components(asset_id);
create index if not exists idx_ecomp_parent on equipment_components(parent_component_id);

-- ============================================================
-- 8. NEW: equipment_meter_readings (Q9-C)
-- ============================================================

create table if not exists equipment_meter_readings (
  id bigserial primary key,
  asset_id bigint not null references equipment_assets(id) on delete cascade,
  reading_type varchar(40) not null
    check (reading_type in ('runtime_hours','output_count','pick_count','print_count',
      'test_count','solder_temp','custom')),
  reading_value numeric(18,4) not null,
  reading_unit varchar(40),
  source varchar(20) not null default 'manual'
    check (source in ('manual','auto_plc','auto_api','import')),
  read_at timestamptz not null default now(),
  operator_id bigint references users(id),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_emr_asset on equipment_meter_readings(asset_id);
create index if not exists idx_emr_type on equipment_meter_readings(reading_type);
create index if not exists idx_emr_read_at on equipment_meter_readings(read_at desc);

-- ============================================================
-- 9. NEW: notification_rules (Q12-D)
-- ============================================================

create table if not exists notification_rules (
  id bigserial primary key,
  rule_code varchar(60) not null unique,
  rule_name_zh varchar(200) not null,
  rule_name_en varchar(200) not null,
  rule_name_vi varchar(200) not null,
  event_type varchar(60) not null
    check (event_type in ('wo_created','wo_assigned','wo_escalated','wo_overdue',
      'pm_due','pm_overdue','equipment_down','equipment_repaired',
      'spare_low_stock','consumable_life_warning','fixture_life_warning',
      'calibration_due','cost_threshold')),
  urgency_filter varchar(20)[] default '{}',
  target_roles varchar(60)[] not null default '{}',
  channels varchar(30)[] not null default '{in_app}'
    check (channels <@ array['in_app','andon','zalo','wechat','email','sms']::varchar[]),
  delay_minutes integer default 0,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 10. Seed: fault code categories (L1) — Q16-B
-- ============================================================

insert into fault_code_categories (code, name_zh, name_en, name_vi, sort_order) values
('MECH', '机械故障', 'Mechanical', 'Cơ khí', 1),
('ELEC', '电气故障', 'Electrical', 'Điện', 2),
('PNEU', '气动故障', 'Pneumatic', 'Khí nén', 3),
('SOFT', '软件故障', 'Software', 'Phần mềm', 4),
('OPER', '操作不当', 'Misoperation', 'Vận hành sai', 5),
('MATL', '来料异常', 'Material Defect', 'Lỗi vật liệu', 6)
on conflict (code) do nothing;

-- L2 subcategories
insert into fault_code_subcategories (category_id, code, name_zh, name_en, name_vi, sort_order)
select c.id, v.code, v.zh, v.en, v.vi, v.ord
from (values
  ('MECH','MECH-SCREW','丝杆/导轨','Ball Screw/Rail','Trục vit/Thanh trượt',1),
  ('MECH','MECH-BELT','皮带/链条','Belt/Chain','Dây đai/Xích',2),
  ('MECH','MECH-BEARING','轴承','Bearing','Bạc đạn',3),
  ('MECH','MECH-CYL','气缸','Cylinder','Xi lanh',4),
  ('MECH','MECH-HEAD','贴装头','Placement Head','Đầu gắn',5),
  ('MECH','MECH-FEEDER','供料器','Feeder','Bộ cấp liệu',6),
  ('MECH','MECH-PUMP','泵/叶轮','Pump/Impeller','Bơm/Cánh quạt',7),
  ('ELEC','ELEC-MOTOR','伺服马达','Servo Motor','Động cơ servo',1),
  ('ELEC','ELEC-BOARD','控制板卡','Control Board','Bo mạch điều khiển',2),
  ('ELEC','ELEC-SENSOR','传感器','Sensor','Cảm biến',3),
  ('ELEC','ELEC-POWER','电源','Power Supply','Nguồn điện',4),
  ('ELEC','ELEC-HEATER','加热管/丝','Heater','Thanh nhiệt',5),
  ('ELEC','ELEC-CAMERA','相机/光源','Camera/Light','Camera/Đèn',6),
  ('PNEU','PNEU-VALVE','电磁阀','Solenoid Valve','Van điện từ',1),
  ('PNEU','PNEU-PIPE','气管/接头','Air Pipe/Fitting','Ống khí/Đầu nối',2),
  ('PNEU','PNEU-VAC','真空系统','Vacuum System','Hệ thống chân không',3),
  ('SOFT','SOFT-PARAM','参数异常','Parameter Error','Lỗi tham số',1),
  ('SOFT','SOFT-COMM','通信故障','Communication','Lỗi truyền thông',2),
  ('SOFT','SOFT-LIC','License/授权','License','Bản quyền',3),
  ('OPER','OPER-SETUP','换线/设置错误','Setup Error','Lỗi cài đặt',1),
  ('OPER','OPER-LOAD','上料错误','Loading Error','Lỗi nạp liệu',2),
  ('MATL','MATL-SOLDER','锡膏/焊料异常','Solder Issue','Lỗi kem hàn',1),
  ('MATL','MATL-COMP','元件异常','Component Issue','Lỗi linh kiện',2)
) as v(cat, code, zh, en, vi, ord)
join fault_code_categories c on c.code = v.cat
on conflict (code) do nothing;

-- L3 specific fault codes (sample — key ones)
insert into fault_codes (subcategory_id, code, name_zh, name_en, name_vi, typical_cause, typical_fix, root_cause_category, applicable_equipment_types, severity)
select sc.id, v.code, v.zh, v.en, v.vi, v.cause, v.fix, v.root, v.types::text[], v.sev
from (values
  ('MECH-SCREW','FC-SCREW-WEAR','丝杆磨损','Ball Screw Wear','Mòn trục vit','长期运行润滑不足','更换丝杆组件+重新润滑','wear','{SMT-MOUNT,PRINTER}','high'),
  ('MECH-SCREW','FC-SCREW-BACKLASH','丝杆间隙超标','Ball Screw Backlash','Khe hở trục vit','磨损/预紧力不足','调整预紧或更换','wear','{SMT-MOUNT,PRINTER}','high'),
  ('MECH-BELT','FC-BELT-LOOSE','皮带松动','Belt Loose','Dây đai lỏng','张力衰减','调整张力或更换','aging','{SMT-MOUNT,PRINTER}','medium'),
  ('MECH-BELT','FC-BELT-BREAK','皮带断裂','Belt Break','Đứt dây đai','疲劳/过载','更换皮带','aging','{SMT-MOUNT,PRINTER}','critical'),
  ('MECH-HEAD','FC-HEAD-VAC','贴装头真空不足','Head Vacuum Low','Chân không đầu gắn thấp','吸嘴堵塞/密封老化','清洁吸嘴+更换密封','wear','{SMT-MOUNT}','high'),
  ('MECH-HEAD','FC-HEAD-OFFSET','贴装偏移','Placement Offset','Lệch vị trí gắn','导轨磨损/校准偏差','重新校准+检查导轨','wear','{SMT-MOUNT}','high'),
  ('MECH-FEEDER','FC-FEED-JAM','Feeder卡料','Feeder Jam','Kẹt bộ cấp liệu','料带变形/齿轮磨损','清理+更换齿轮','misoperation','{SMT-MOUNT}','medium'),
  ('ELEC-MOTOR','FC-MOTOR-OVERHEAT','马达过热','Motor Overheat','Động cơ quá nhiệt','散热不良/过载','清洁散热+检查负载','wear','{SMT-MOUNT,REFLOW,WAVE-SOLDER}','high'),
  ('ELEC-MOTOR','FC-MOTOR-ENCODER','编码器报警','Encoder Alarm','Báo lỗi encoder','编码器损坏/接线松','更换编码器/重新接线','aging','{SMT-MOUNT,PRINTER}','critical'),
  ('ELEC-BOARD','FC-BOARD-FAIL','板卡故障','Board Failure','Hỏng bo mạch','元件老化/静电','更换板卡','aging','{SMT-MOUNT,REFLOW,AOI,SPI}','critical'),
  ('ELEC-HEATER','FC-HEATER-BURN','加热管烧毁','Heater Burnout','Cháy thanh nhiệt','寿命到期/局部过热','更换加热管','aging','{REFLOW,WAVE-SOLDER}','high'),
  ('ELEC-CAMERA','FC-CAM-DIRTY','相机脏污','Camera Dirty','Camera bẩn','灰尘/锡膏飞溅','清洁镜头+光源','misoperation','{SMT-MOUNT,AOI,SPI}','medium'),
  ('ELEC-SENSOR','FC-SENSOR-FAIL','传感器失效','Sensor Failure','Hỏng cảm biến','老化/污染','更换传感器','aging','{SMT-MOUNT,REFLOW,PRINTER}','medium'),
  ('PNEU-VALVE','FC-VALVE-LEAK','电磁阀漏气','Solenoid Valve Leak','Rò rỉ van điện từ','密封老化','更换密封/阀体','aging','{SMT-MOUNT,PRINTER}','medium'),
  ('PNEU-VAC','FC-VAC-LOW','真空度不足','Vacuum Low','Chân không yếu','滤芯堵塞/管路漏','更换滤芯+检漏','wear','{SMT-MOUNT}','high'),
  ('SOFT-PARAM','FC-PARAM-ERR','参数异常','Parameter Error','Lỗi tham số','误修改/版本不匹配','恢复正确参数','misoperation','{SMT-MOUNT,REFLOW,PRINTER,AOI,SPI}','medium'),
  ('SOFT-COMM','FC-COMM-FAIL','通信中断','Communication Lost','Mất truyền thông','网线松/交换机故障','检查网络/重启','other','{SMT-MOUNT,REFLOW,AOI,SPI,ICT,FCT}','high'),
  ('OPER-SETUP','FC-SETUP-WRONG','换线设置错误','Setup Error','Lỗi cài đặt đổi line','程序选错/参数未更新','重新加载正确程序','misoperation','{SMT-MOUNT,PRINTER,REFLOW}','medium')
) as v(subcat, code, zh, en, vi, cause, fix, root, types, sev)
join fault_code_subcategories sc on sc.code = v.subcat
on conflict (code) do nothing;

-- ============================================================
-- 11. Seed: PM templates (5-level, key equipment types) — Q3-D
-- ============================================================

-- Daily PM: SMT Mounter
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-DAILY-MOUNT', '贴片机日常保养', 'Mounter Daily PM', 'Bảo trì hàng ngày máy gắn', 'daily', c.id, 'calendar', 1, 30, 'operator', false
from equipment_categories c where c.code = 'SMT-MOUNT'
on conflict (template_code) do nothing;

insert into pm_template_tasks (template_id, task_no, task_name_zh, task_name_en, task_name_vi, instruction, standard_value, requires_photo, is_critical)
select t.id, v.no, v.zh, v.en, v.vi, v.instr, v.std, v.photo, v.crit
from (values
  (1,'清洁吸嘴','Clean nozzles','Vệ sinh đầu hút','用无尘布+酒精清洁所有吸嘴','',true,false),
  (2,'检查真空值','Check vacuum','Kiểm tra chân không','检查各头真空值','-60~-80 kPa',false,true),
  (3,'清洁Feeder表面','Clean feeder surface','Vệ sinh bề mặt feeder','清洁供料器表面+检查料带','',false,false),
  (4,'清洁相机窗口','Clean camera window','Vệ sinh cửa sổ camera','清洁识别相机/激光窗口','',true,false),
  (5,'检查抛料率','Check throw rate','Kiểm tra tỷ lệ ném','检查抛料率','<0.3%',false,true),
  (6,'清洁工作台面','Clean work table','Vệ sinh bàn làm việc','清洁台面+轨道','',false,false)
) as v(no, zh, en, vi, instr, std, photo, crit)
cross join pm_templates t where t.template_code = 'PM-DAILY-MOUNT'
on conflict (template_id, task_no) do nothing;

-- Weekly PM: SMT Mounter
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-WEEKLY-MOUNT', '贴片机周保养', 'Mounter Weekly PM', 'Bảo trì hàng tuần máy gắn', 'weekly', c.id, 'calendar', 7, 60, 'technician', false
from equipment_categories c where c.code = 'SMT-MOUNT'
on conflict (template_code) do nothing;

-- Monthly PM: SMT Mounter
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, runtime_interval_hours, estimated_minutes, required_role, requires_first_article)
select 'PM-MONTHLY-MOUNT', '贴片机月保养', 'Mounter Monthly PM', 'Bảo trì hàng tháng máy gắn', 'monthly', c.id, 'both', 30, 500, 120, 'engineer', true
from equipment_categories c where c.code = 'SMT-MOUNT'
on conflict (template_code) do nothing;

-- Quarterly PM: SMT Mounter
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-QUARTERLY-MOUNT', '贴片机季保养', 'Mounter Quarterly PM', 'Bảo trì hàng quý máy gắn', 'quarterly', c.id, 'calendar', 90, 240, 'engineer', true
from equipment_categories c where c.code = 'SMT-MOUNT'
on conflict (template_code) do nothing;

-- Annual PM: SMT Mounter
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-ANNUAL-MOUNT', '贴片机年保养', 'Mounter Annual PM', 'Bảo trì hàng năm máy gắn', 'annual', c.id, 'calendar', 365, 480, 'vendor', true
from equipment_categories c where c.code = 'SMT-MOUNT'
on conflict (template_code) do nothing;

-- Daily PM: Reflow Oven
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-DAILY-REFLOW', '回流焊日常保养', 'Reflow Daily PM', 'Bảo trì hàng ngày lò reflow', 'daily', c.id, 'calendar', 1, 20, 'operator', false
from equipment_categories c where c.code = 'REFLOW'
on conflict (template_code) do nothing;

-- Daily PM: Printer
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-DAILY-PRINTER', '印刷机日常保养', 'Printer Daily PM', 'Bảo trì hàng ngày máy in', 'daily', c.id, 'calendar', 1, 20, 'operator', false
from equipment_categories c where c.code = 'PRINTER'
on conflict (template_code) do nothing;

-- Daily PM: Wave Solder
insert into pm_templates (template_code, template_name_zh, template_name_en, template_name_vi, pm_level, equipment_category_id, trigger_type, calendar_interval_days, estimated_minutes, required_role, requires_first_article)
select 'PM-DAILY-WAVE', '波峰焊日常保养', 'Wave Solder Daily PM', 'Bảo trì hàng ngày máy hàn sóng', 'daily', c.id, 'calendar', 1, 30, 'operator', false
from equipment_categories c where c.code = 'WAVE-SOLDER'
on conflict (template_code) do nothing;

-- ============================================================
-- 12. Seed: notification rules — Q12-D
-- ============================================================

insert into notification_rules (rule_code, rule_name_zh, rule_name_en, rule_name_vi, event_type, target_roles, channels, delay_minutes) values
('NR-WO-CREATED','新工单通知','New Work Order','Thông báo WO mới','wo_created','{technician,engineer}','{in_app,zalo}',0),
('NR-WO-ESCALATED','工单升级通知','Work Order Escalated','Thông báo WO leo thang','wo_escalated','{engineer,manager}','{in_app,zalo,sms}',0),
('NR-WO-OVERDUE','工单超时通知','Work Order Overdue','Thông báo WO quá hạn','wo_overdue','{engineer,manager}','{in_app,zalo}',0),
('NR-EQ-DOWN','设备停机通知','Equipment Down','Thông báo thiết bị dừng','equipment_down','{engineer,manager}','{in_app,andon,zalo,sms}',0),
('NR-PM-DUE','PM到期提醒','PM Due Reminder','Nhắc nhở PM đến hạn','pm_due','{operator,technician,engineer}','{in_app,zalo}',0),
('NR-PM-OVERDUE','PM逾期警告','PM Overdue Warning','Cảnh báo PM quá hạn','pm_overdue','{engineer,manager}','{in_app,zalo,email}',0),
('NR-SPARE-LOW','备件低库存','Spare Parts Low Stock','Phụ tùng tồn kho thấp','spare_low_stock','{warehouse,engineer}','{in_app,zalo}',0),
('NR-CONS-LIFE','易耗品寿命预警','Consumable Life Warning','Cảnh báo tuổi thọ vật tư','consumable_life_warning','{operator,engineer}','{in_app,zalo}',0),
('NR-FIX-LIFE','治具寿命预警','Fixture Life Warning','Cảnh báo tuổi thọ đồ gá','fixture_life_warning','{operator,engineer}','{in_app,zalo}',0),
('NR-CAL-DUE','校准到期提醒','Calibration Due','Nhắc nhở hiệu chuẩn','calibration_due','{engineer,quality}','{in_app,email}',0),
('NR-COST-THRESH','维修费用超阈值','Repair Cost Threshold','Chi phí sửa chữa vượt ngưỡng','cost_threshold','{manager}','{in_app,zalo,email}',0)
on conflict (rule_code) do nothing;

-- ============================================================
-- 13. Seed: additional equipment categories (Q20)
-- ============================================================

insert into equipment_categories (code, name_zh, name_en, name_vi) values
('SELECTIVE-SOLDER','选择性波峰焊','Selective Soldering','Máy hàn sóng chọn lọc'),
('SCREW-DRIVER','锁螺丝机','Screw Driving Machine','Máy vặn vít'),
('LASER-MARK','激光打标机','Laser Marking Machine','Máy khắc laser'),
('CONFORMAL-COAT','三防漆涂覆机','Conformal Coating Machine','Máy phủ conformal'),
('TRANSFORMER-WIND','变压器绕线机','Transformer Winding Machine','Máy quấn biến áp'),
('POTTING','灌封机','Potting Machine','Máy rót keo')
on conflict (code) do nothing;

-- ============================================================
-- 14. Update views to include new fields
-- ============================================================

create or replace view v_equipment_overview as
select
  ea.asset_code,
  ea.name_zh,
  ea.name_en,
  ea.name_vi,
  m.code                               as machine_code,
  m.machine_type,
  ec.name_zh                           as category_zh,
  em.vendor_name,
  em.model_name,
  pl.internal_code                      as line_code,
  s.code                               as station_code,
  ea.serial_no,
  ea.criticality,
  ea.install_date,
  ea.commissioned_date,
  ea.status                            as asset_status,
  m.status                             as machine_status,
  ea.purchase_price,
  ea.currency,
  ea.current_value,
  ea.cumulative_runtime_hours,
  ea.cumulative_output_count,
  ea.total_repair_count,
  ea.total_repair_cost,
  ea.total_pm_count,
  ea.responsible_engineer_id,
  case
    when ea.warranty_expiry < current_date then 'expired'
    when ea.warranty_expiry <= current_date + 30 then 'due_soon'
    else 'active'
  end                                  as warranty_status,
  ea.warranty_expiry,
  -- RAV: annual repair cost / replacement value
  case
    when ea.purchase_price > 0 and ea.purchase_price is not null
    then round((ea.total_repair_cost / ea.purchase_price * 100)::numeric, 1)
    else null
  end                                  as rav_percent
from equipment_assets ea
left join machines m on m.id = ea.machine_id
left join equipment_categories ec on ec.id = ea.category_id
left join equipment_models em on em.id = ea.model_id
left join production_lines pl on pl.id = ea.line_id
left join stations s on s.id = ea.station_id;

commit;
