-- Machine Inspection (点检) Schema
-- Daily/shift-level physical inspection checklists for real SMT line machines
-- Lightweight operator check-offs vs. heavy maintenance work orders

begin;

-- ============================================================
-- MACHINE INSPECTION TEMPLATES (per machine type)
-- ============================================================

-- 点检基准：每种机型一套点检项目模板
create table if not exists inspection_templates (
  id bigserial primary key,
  template_code varchar(80) not null unique,
  machine_type varchar(40) not null, -- links to machines.machine_type
  template_name varchar(160) not null,
  shift_type varchar(20) not null default 'any', -- day/night/any
  frequency_type varchar(20) not null, -- daily/shift/weekly/monthly
  is_active boolean not null default true,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 点检项目明细
create table if not exists inspection_template_items (
  id bigserial primary key,
  template_id bigint not null references inspection_templates(id) on delete cascade,
  item_no integer not null check (item_no > 0),
  check_point varchar(200) not null,       -- e.g. "吸嘴清洁度"
  check_method varchar(200),               -- e.g. "目视检查吸嘴表面"
  pass_criteria varchar(300),              -- e.g. "无锡渣、无变形"
  fail_action varchar(200),                -- e.g. "立即更换吸嘴"
  instrument_required varchar(80),         -- e.g. "40x显微镜"
  is_key_point boolean not null default false, -- 关键点标记
  is_critical_safety boolean not null default false,
  created_at timestamptz not null default now(),
  unique(template_id, item_no)
);

-- ============================================================
-- MACHINE INSPECTION ASSIGNMENTS (scheduled check-out tasks)
-- ============================================================

-- 点检计划：给哪台机器排哪个班次/日期的点检
create table if not exists inspection_assignments (
  id bigserial primary key,
  assignment_no varchar(80) not null unique,
  machine_id bigint not null references machines(id),
  template_id bigint not null references inspection_templates(id),
  shift_date date not null,
  shift_type varchar(20) not null, -- day/night
  assigned_to bigint references users(id),
  status varchar(20) not null default 'pending', -- pending/in_progress/completed/skipped/voided
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(machine_id, shift_date, shift_type)
);

-- ============================================================
-- MACHINE INSPECTION RECORDS (actual check results)
-- ============================================================

-- 点检记录主表
create table if not exists inspection_records (
  id bigserial primary key,
  record_no varchar(80) not null unique,
  assignment_id bigint references inspection_assignments(id),
  machine_id bigint not null references machines(id),
  line_id bigint not null references production_lines(id),
  station_id bigint references stations(id),
  template_id bigint not null references inspection_templates(id),
  shift_date date not null,
  shift_type varchar(20) not null,
  inspector_id bigint not null references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  overall_result varchar(20) not null default 'pass', -- pass/fail/conditional
  total_items integer not null default 0,
  passed_items integer not null default 0,
  failed_items integer not null default 0,
  skipped_items integer not null default 0,
  has_critical_fail boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 点检明细结果（每一项的检查结果）
create table if not exists inspection_record_items (
  id bigserial primary key,
  record_id bigint not null references inspection_records(id) on delete cascade,
  item_no integer not null,
  template_item_id bigint not null references inspection_template_items(id),
  result varchar(20) not null, -- pass/fail/na/skipped
  measured_value varchar(200),
  notes text,
  photo_url text,
  checked_at timestamptz,
  unique(record_id, item_no)
);

-- ============================================================
-- ABNORMALITY ESCALATION (异常升级)
-- ============================================================

-- 点检异常直通维修工单
create table if not exists inspection_abnormals (
  id bigserial primary key,
  abnormal_no varchar(80) not null unique,
  record_id bigint not null references inspection_records(id),
  record_item_id bigint references inspection_record_items(id),
  machine_id bigint not null references machines(id),
  abnormality_type varchar(40) not null, -- defect/hazard/critical_wear
  description text not null,
  severity varchar(20) not null, -- low/medium/high/critical
  status varchar(20) not null default 'reported', -- reported/acknowledged/resolved/closed
  reported_by bigint references users(id),
  reported_at timestamptz not null default now(),
  assigned_to bigint references users(id),
  resolved_at timestamptz,
  resolution text,
  maintenance_order_id bigint references maintenance_orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- OEE TRACKING (linked to inspections)
-- ============================================================

-- 从点检记录汇总设备状态用于OEE计算
create table if not exists machine_oee_logs (
  id bigserial primary key,
  log_date date not null,
  machine_id bigint not null references machines(id),
  line_id bigint not null references production_lines(id),
  shift_type varchar(20) not null, -- day/night
  planned_prod_hours numeric(6,2) not null default 0,    -- 计划生产时间
  actual_prod_hours numeric(6,2) not null default 0,    -- 实际生产时间
  downtime_minutes integer not null default 0,           -- 停机时间（分钟）
  output_qty integer not null default 0,                 -- 产出数量
  defect_qty integer not null default 0,                 -- 不良数量
  oee_availability numeric(5,2) generated always as (
    case when planned_prod_hours > 0
    then round((planned_prod_hours - downtime_minutes::numeric/60) / planned_prod_hours * 100, 2)
    else 0 end) stored,
  oee_quality numeric(5,2) generated always as (
    case when output_qty > 0
    then round((output_qty - defect_qty)::numeric / output_qty * 100, 2)
    else 0 end) stored,
  oee_overall numeric(5,2) generated always as (
    round(
      case when planned_prod_hours > 0
      then round((planned_prod_hours - downtime_minutes::numeric/60) / planned_prod_hours * 100, 2)
      else 0 end
      *
      case when output_qty > 0
      then round((output_qty - defect_qty)::numeric / output_qty * 100, 2)
      else 0 end
      / 100, 2)) stored,
  notes text,
  created_at timestamptz not null default now(),
  unique(log_date, machine_id, shift_type)
);

-- ============================================================
-- MACHINE STATUS SNAPSHOT (real-time)
-- ============================================================

-- 设备当前状态快照（被MES/实时系统更新）
create table if not exists machine_status_snapshots (
  id bigserial primary key,
  machine_id bigint not null references machines(id),
  status varchar(20) not null, -- idle/running/maintenance/breakdown
  current_product varchar(80),
  current_work_order varchar(40),
  output_counter integer,
  defect_counter integer,
  running_hours numeric(10,2),
  idle_minutes_today integer,
  maintenance_minutes_today integer,
  breakdown_minutes_today integer,
  last_updated timestamptz not null default now(),
  unique(machine_id)
);

-- ============================================================
-- CONSTRAINTS
-- ============================================================

alter table inspection_templates add constraint insp_templates_shift_type_check
  check (shift_type in ('day','night','any'));
alter table inspection_templates add constraint insp_templates_freq_type_check
  check (frequency_type in ('shift','daily','weekly','monthly'));
alter table inspection_assignments add constraint insp_assign_status_check
  check (status in ('pending','in_progress','completed','skipped','voided'));
alter table inspection_records add constraint insp_records_result_check
  check (overall_result in ('pass','fail','conditional'));
alter table inspection_record_items add constraint insp_rec_items_result_check
  check (result in ('pass','fail','na','skipped'));
alter table inspection_abnormals add constraint insp_abnormals_severity_check
  check (severity in ('low','medium','high','critical'));
alter table inspection_abnormals add constraint insp_abnormals_status_check
  check (status in ('reported','acknowledged','resolved','closed'));
alter table machine_oee_logs add constraint machine_oee_logs_shift_check
  check (shift_type in ('day','night'));

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_insp_templates_machine_type on inspection_templates(machine_type, is_active);
create index if not exists idx_insp_template_items_template on inspection_template_items(template_id, item_no);
create index if not exists idx_insp_assignments_machine on inspection_assignments(machine_id, shift_date desc, status);
create index if not exists idx_insp_assignments_assignee on inspection_assignments(assigned_to, shift_date desc, status);
create index if not exists idx_insp_records_machine on inspection_records(machine_id, shift_date desc);
create index if not exists idx_insp_records_line on inspection_records(line_id, shift_date desc);
create index if not exists idx_insp_records_inspector on inspection_records(inspector_id, shift_date desc);
create index if not exists idx_insp_record_items_record on inspection_record_items(record_id, item_no);
create index if not exists idx_insp_abnormals_machine on inspection_abnormals(machine_id, status, reported_at desc);
create index if not exists idx_insp_abnormals_record on inspection_abnormals(record_id, status);
create index if not exists idx_machine_oee_logs_machine on machine_oee_logs(machine_id, log_date desc);
create index if not exists idx_machine_oee_logs_line on machine_oee_logs(line_id, log_date desc);
create index if not exists idx_machine_status_snap_machine on machine_status_snapshots(machine_id);

-- ============================================================
-- SEED DATA: Default inspection templates for SMT core machines
-- ============================================================

-- Template: 贴片机 (Pick & Place)
insert into inspection_templates (template_code, machine_type, template_name, shift_type, frequency_type) values
('TPL-PNP-001', 'mounter', '贴片机日常点检表', 'any', 'daily'),
('TPL-PNP-002', 'mounter', '贴片机周点检表', 'any', 'weekly');

insert into inspection_template_items (template_id, item_no, check_point, check_method, pass_criteria, fail_action, is_key_point, is_critical_safety) values
-- 日常点检 (from template 1)
((select id from inspection_templates where template_code='TPL-PNP-001'), 1, '吸嘴清洁度', '目视检查每个吸嘴表面', '无锡渣、无变形、无堵塞', '立即更换吸嘴', true, false),
((select id from inspection_templates where template_code='TPL-PNP-001'), 2, '气压压力', '查看气压表数值', '0.5-0.7 MPa', '停机通知工程师', true, true),
((select id from inspection_templates where template_code='TPL-PNP-001'), 3, '真空度', '查看真空表数值', '符合设备要求', '检查真空泵和管路', true, false),
((select id from inspection_templates where template_code='TPL-PNP-001'), 4, '贴装头运行状态', '听声观察有异响', '无异响、无异常振动', '停机检查', true, true),
((select id from inspection_templates where template_code='TPL-PNP-001'), 5, ' feeders 供料器状态', '检查料带是否正常输送', '料带推进顺畅、无歪斜', '重新调整feeder', false, false),
((select id from inspection_templates where template_code='TPL-PNP-001'), 6, '轨道清洁度', '目视检查轨道', '无杂物、无锡渣残留', '清洁轨道', false, false),
((select id from inspection_templates where template_code='TPL-PNP-001'), 7, '相机光源亮度', '查看光源指示灯', '光源正常、无闪烁', '校准或更换光源', true, false),
((select id from inspection_templates where template_code='TPL-PNP-001'), 8, '安全门联锁', '测试每个安全门开关', '开门停机、关门复位', '立即报修', true, true),
-- 周点检 (from template 2)
((select id from inspection_templates where template_code='TPL-PNP-002'), 1, '丝杠润滑', '检查丝杠润滑状态', '润滑脂充足、无干摩擦', '添加润滑脂', true, false),
((select id from inspection_templates where template_code='TPL-PNP-002'), 2, '皮带张力', '手动按压检查皮带', '张力适中、无明显松弛', '调整或更换皮带', false, false),
((select id from inspection_templates where template_code='TPL-PNP-002'), 3, '贴装精度校验', '运行精度测试程序', '偏移≤0.05mm', '执行校准程序', true, false),
((select id from inspection_templates where template_code='TPL-PNP-002'), 4, '吸取位置校验', '测试吸取教正', '吸取成功率≥99.5%', '调整吸取参数', true, false),
((select id from inspection_templates where template_code='TPL-PNP-002'), 5, '运动模组温度', '手感或测温仪检测', '温度正常、无过热', '停机检查', true, true),
((select id from inspection_templates where template_code='TPL-PNP-002'), 6, '接地电阻', '使用万用表测量', '≤1Ω', '检查接地线', true, true);

-- Template: 回流焊 (Reflow Oven)
insert into inspection_templates (template_code, machine_type, template_name, shift_type, frequency_type) values
('TPL-RFL-001', 'reflow', '回流焊日常点检表', 'any', 'daily'),
('TPL-RFL-002', 'reflow', '回流焊周点检表', 'any', 'weekly');

insert into inspection_template_items (template_id, item_no, check_point, check_method, pass_criteria, fail_action, is_key_point, is_critical_safety) values
((select id from inspection_templates where template_code='TPL-RFL-001'), 1, '炉温曲线记录', '查看今日炉温曲线记录', '曲线在标准范围内', '停机重新校准', true, true),
((select id from inspection_templates where template_code='TPL-RFL-001'), 2, '传送带速度', '查看传送带速度显示', '符合设定速度±5%', '调整传送速度', false, false),
((select id from inspection_templates where template_code='TPL-RFL-001'), 3, '传送带清洁度', '目视检查', '无杂物、无残留锡膏', '停机清洁', false, false),
((select id from inspection_templates where template_code='TPL-RFL-001'), 4, '助焊剂残留', '目视检查炉腔', '无明显助焊剂堆积', '清洁炉腔', false, false),
((select id from inspection_templates where template_code='TPL-RFL-001'), 5, '热电偶温度', '查看各区显示温度', '实际温度与设定±3°C内', '校准热电偶', true, true),
((select id from inspection_templates where template_code='TPL-RFL-001'), 6, '冷却区温度', '查看冷却区显示', '冷却至室温附近', '检查冷却风扇', true, false),
((select id from inspection_templates where template_code='TPL-RFL-001'), 7, '紧急停止按钮', '测试功能', '按下立即停机', '报修', true, true),
((select id from inspection_templates where template_code='TPL-RFL-001'), 8, '氮气压力（氮气炉）', '查看氮气压力表', '符合工艺要求', '停机通知', true, true),
((select id from inspection_templates where template_code='TPL-RFL-002'), 1, '加热管升温速率', '查看升温曲线', '符合设备规格', '更换加热管', true, false),
((select id from inspection_templates where template_code='TPL-RFL-002'), 2, '冷却风扇运转', '听声观察', '无异响、运转正常', '更换风扇', true, false),
((select id from inspection_templates where template_code='TPL-RFL-002'), 3, '炉膛密封性', '检查炉膛门密封', '密封良好、无泄漏', '调整密封条', true, false),
((select id from inspection_templates where template_code='TPL-RFL-002'), 4, '热电偶精度校验', '对比标准温度计', '误差≤±3°C', '更换热电偶', true, false);

-- Template: 锡膏印刷机 (Printer)
insert into inspection_templates (template_code, machine_type, template_name, shift_type, frequency_type) values
('TPL-PRT-001', 'printer', '印刷机日常点检表', 'any', 'daily'),
('TPL-PRT-002', 'printer', '印刷机周点检表', 'any', 'weekly');

insert into inspection_template_items (template_id, item_no, check_point, check_method, pass_criteria, fail_action, is_key_point, is_critical_safety) values
((select id from inspection_templates where template_code='TPL-PRT-001'), 1, '钢网清洁度', '目视检查钢网', '无残留锡膏、网孔通畅', '清洁钢网', true, false),
((select id from inspection_templates where template_code='TPL-PRT-001'), 2, '刮刀压力', '查看压力设定值', '符合工艺要求', '重新设定', true, false),
((select id from inspection_templates where template_code='TPL-PRT-001'), 3, '刮刀速度', '查看速度设定', '符合工艺要求', '重新设定', false, false),
((select id from inspection_templates where template_code='TPL-PRT-001'), 4, 'PCB定位夹具', '检查夹具磨损', '夹具无松动、无过度磨损', '调整或更换夹具', false, false),
((select id from inspection_templates where template_code='TPL-PRT-001'), 5, '锡膏量/新锡膏添加', '检查钢网下锡膏量', '锡膏覆盖≥80%钢网面积', '添加新锡膏', true, false),
((select id from inspection_templates where template_code='TPL-PRT-001'), 6, '印刷偏移', '首件AOI检测或目视', '偏移≤0.1mm', '调整印刷参数', true, false),
((select id from inspection_templates where template_code='TPL-PRT-001'), 7, '轨道清洁', '目视检查', '无杂物', '清洁轨道', false, false),
((select id from inspection_templates where template_code='TPL-PRT-002'), 1, '丝杠润滑', '检查润滑状态', '润滑良好', '润滑丝杠', false, false),
((select id from inspection_templates where template_code='TPL-PRT-002'), 2, '导轨磨损', '检查导轨表面', '无明显磨损/划痕', '更换导轨', true, false),
((select id from inspection_templates where template_code='TPL-PRT-002'), 3, '钢网张力', '使用张力计测量', '符合钢网规格', '更换钢网', true, false),
((select id from inspection_templates where template_code='TPL-PRT-002'), 4, '印刷精度测试', '用标准PCB测试', '偏移≤0.1mm', '重新校准', true, false);

-- Template: AOI
insert into inspection_templates (template_code, machine_type, template_name, shift_type, frequency_type) values
('TPL-AOI-001', 'AOI', 'AOI日常点检表', 'any', 'daily');

insert into inspection_template_items (template_id, item_no, check_point, check_method, pass_criteria, fail_action, is_key_point, is_critical_safety) values
((select id from inspection_templates where template_code='TPL-AOI-001'), 1, '光学镜头清洁', '目视检查镜头', '无灰尘、无污渍', '清洁镜头', true, false),
((select id from inspection_templates where template_code='TPL-AOI-001'), 2, '光源亮度', '查看光源指示/自检', '光源正常、无衰减', '更换光源', true, false),
((select id from inspection_templates where template_code='TPL-AOI-001'), 3, '传送机构', '运行自检', '传送平稳、无卡顿', '检查电机', false, false),
((select id from inspection_templates where template_code='TPL-AOI-001'), 4, '基准板校准', '运行校准程序', '偏差在允许范围内', '重新校准', true, false),
((select id from inspection_templates where template_code='TPL-AOI-001'), 5, '软件系统状态', '查看系统提示', '无报错、正常运行', '重启或报修', true, false),
((select id from inspection_templates where template_code='TPL-AOI-001'), 6, '检测灵敏度设定', '查看当前设定', '符合工艺要求', '调整灵敏度', true, false);

commit;
