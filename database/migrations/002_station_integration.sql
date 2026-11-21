-- Migration 002: Station Integration Tables
-- Required by services/api/server.js and integrations/_shared/src/station-adapter.ts
-- Adds: sn_duplicate_attempts, ng_defect_records, audit_logs, traceability_events
--       (note: station_events, pcb_serials already in 001)

-- ============================================================
-- SN DUPLICATE ATTEMPTS LOG
-- Every duplicate SN scan attempt is logged here.
-- Partitioned by attempted_at (yearly).
-- ============================================================

create table if not exists sn_duplicate_attempts (
  id bigserial primary key,
  attempted_sn varchar(80) not null,
  attempted_action varchar(40) not null,
  station_id bigint,  -- references stations(id) — nullable for flexibility
  line_id bigint,
  work_order_id bigint,
  operator_id bigint,
  existing_record_id bigint,
  existing_sn varchar(80),
  existing_status varchar(20),
  decision varchar(20) not null,  -- allowed | blocked | overridden
  override_user_id bigint,
  override_reason text,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_sn_dup_attempts_sn on sn_duplicate_attempts(attempted_sn, attempted_at);
create index if not exists idx_sn_dup_attempts_station on sn_duplicate_attempts(station_id, attempted_at);
create index if not exists idx_sn_dup_attempts_decision on sn_duplicate_attempts(decision, attempted_at);

-- ============================================================
-- NG DEFECT RECORDS
-- All NG/defect events from stations (AOI, ICT, FCT, Hi-Pot, etc.)
-- Partitioned by occurred_at (yearly).
-- ============================================================

create table if not exists ng_defect_records (
  id bigserial primary key,
  pcb_serial_id bigint,        -- references pcb_serials(id)
  work_order_id bigint,
  station_id bigint not null,  -- references stations(id)
  defect_code_id bigint,       -- references defect_codes(id)
  defect_location varchar(80),
  defect_description text,
  defect_images jsonb,         -- array of image URLs/paths
  severity varchar(20),        -- critical | major | minor
  disposition varchar(20),     -- pending | repair | scrap | return | accept
  operator_id bigint,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_ng_defect_pcb on ng_defect_records(pcb_serial_id, occurred_at);
create index if not exists idx_ng_defect_station on ng_defect_records(station_id, occurred_at);
create index if not exists idx_ng_defect_wo on ng_defect_records(work_order_id, occurred_at);
create index if not exists idx_ng_defect_disposition on ng_defect_records(disposition, occurred_at);

-- ============================================================
-- AUDIT LOGS
-- All user/system actions that need non-repudiation.
-- Not partitioned (small table, retention handled differently).
-- ============================================================

create table if not exists audit_logs (
  id bigserial primary key,
  actor_id bigint,
  action varchar(60) not null,
  entity_type varchar(40) not null,
  entity_id bigint,
  reference_no varchar(120),
  ip_address varchar(45),
  user_agent text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_actor on audit_logs(actor_id, occurred_at);
create index if not exists idx_audit_action on audit_logs(action, occurred_at);
create index if not exists idx_audit_entity on audit_logs(entity_type, entity_id, occurred_at);

-- ============================================================
-- PERMISSIONS & ROLES (required by API auth)
-- ============================================================

create table if not exists permissions (
  id bigserial primary key,
  code varchar(60) not null unique,
  name_zh varchar(120),
  name_en varchar(120),
  name_vi varchar(120),
  category varchar(30),  -- auth | pmc | wms | mes | quality | admin
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  role_id bigint not null references roles(id),
  permission_id bigint not null references permissions(id),
  primary key (role_id, permission_id)
);

-- Insert default permissions
insert into permissions (code, name_zh, name_en, name_vi, category) values
  ('auth.login',     '登录',      'Login',       'Đăng nhập',    'auth'),
  ('auth.logout',    '登出',      'Logout',       'Đăng xuất',    'auth'),
  ('pmc.view',       '查看工单',   'View WOs',     'Xem LSX',       'pmc'),
  ('pmc.create',     '创建工单',   'Create WO',    'Tạo LSX',       'pmc'),
  ('pmc.execute',   '执行工单',   'Execute WO',   'Thực thi LSX',  'pmc'),
  ('wms.view',       '查看库存',   'View Inv',      'Xem tồn kho',   'wms'),
  ('wms.execute',   '库存操作',   'Inv Ops',      'TK tồn kho',   'wms'),
  ('mes.view',       '查看产线',   'View MES',     'Xem MES',        'mes'),
  ('mes.execute',   '执行工位',   'Execute Stn', 'Thực thi trạm', 'mes'),
  ('quality.view',   '查看质量',   'View Quality', 'Xem chất lượng', 'quality'),
  ('quality.execute','质量操作',  'Quality Ops',  'QC thao tác',   'quality'),
  ('admin.users',   '管理用户',   'Manage Users', 'Quản lý users', 'admin'),
  ('admin.roles',   '管理角色',   'Manage Roles', 'Quản lý roles', 'admin')
on conflict (code) do nothing;

-- Grant all permissions to admin role
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'admin'
on conflict do nothing;

-- Grant basic permissions to operator role
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r, permissions p
where r.code = 'operator'
  and p.code in ('auth.login', 'auth.logout', 'pmc.view', 'wms.view', 'mes.view', 'mes.execute', 'quality.view')
on conflict do nothing;

-- ============================================================
-- SHIFT SCHEDULES (partitioned by date — follows factory pattern)
-- ============================================================

create table if not exists shift_schedules (
  id bigserial,
  line_id bigint not null references production_lines(id),
  shift_date date not null,
  shift_name varchar(20) not null, -- 'day', 'afternoon', 'night'
  shift_start time not null,
  shift_end time not null,
  operator_ids bigint[],
  status varchar(20) not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now(),
  primary key (id, shift_date)
) partition by range (shift_date);

create table shift_schedules_2026 partition of shift_schedules for values from ('2026-01-01') to ('2027-01-01');
create table shift_schedules_2027 partition of shift_schedules for values from ('2027-01-01') to ('2028-01-01');
create table shift_schedules_2028 partition of shift_schedules for values from ('2028-01-01') to ('2029-01-01');
create table shift_schedules_2029 partition of shift_schedules for values from ('2029-01-01') to ('2030-01-01');
create table shift_schedules_2030 partition of shift_schedules for values from ('2030-01-01') to ('2031-01-01');
create table shift_schedules_2031 partition of shift_schedules for values from ('2031-01-01') to ('2032-01-01');
create table shift_schedules_2032 partition of shift_schedules for values from ('2032-01-01') to ('2033-01-01');
create table shift_schedules_2033 partition of shift_schedules for values from ('2033-01-01') to ('2034-01-01');
create table shift_schedules_2034 partition of shift_schedules for values from ('2034-01-01') to ('2035-01-01');
create table shift_schedules_2035 partition of shift_schedules for values from ('2035-01-01') to ('2036-01-01');
create index if not exists idx_shift_line_date on shift_schedules(line_id, shift_date);

-- ============================================================
-- RECIPES / MACHINE PROGRAMS (not partitioned — small, stable)
-- ============================================================

create table if not exists recipes (
  id bigserial primary key,
  product_id bigint not null references products(id),
  revision varchar(30) not null,
  machine_type varchar(40) not null,
  program_data jsonb not null default '{}',
  feeder_positions jsonb not null default '[]',
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, revision, machine_type)
);

comment on table recipes is 'Machine programs / recipes per product revision. program_data contains the program file reference or inline data; feeder_positions maps slot to material lot.';
comment on column recipes.program_data is 'JSON: { filename, checksum, profile_name, paste_class }';
comment on column recipes.feeder_positions is 'JSON array: [{ feeder_no, material_code, lot_no, slot_position }]';

-- ============================================================
-- PRODUCT CONFIG / LABEL TEMPLATES (not partitioned — small)
-- ============================================================

create table if not exists product_configs (
  id bigserial primary key,
  product_id bigint not null references products(id),
  revision varchar(30) not null,
  label_template jsonb not null default '{}',
  barcode_format varchar(30) not null default 'CODE128',
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, revision)
);

comment on table product_configs is 'Per-product label template and barcode configuration for label printers.';
comment on column product_configs.label_template is 'JSON: { template_name, fields: [{key, label, font_size?, width?}], logo_url? }';
comment on column product_configs.barcode_format is 'CODE128 | QR | DATA_MATRIX — format for PCB serial barcode on label.';
