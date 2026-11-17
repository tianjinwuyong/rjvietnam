insert into equipment_categories (code, name_zh, name_en, name_vi, status)
values
('SMT-MOUNTER', 'SMT placement machine', 'SMT placement machine', 'May gan SMT', 'active'),
('SMT-PRINTER', 'Solder paste printer', 'Solder paste printer', 'May in kem han', 'active'),
('SMT-OVEN', 'Reflow oven', 'Reflow oven', 'Lo reflow', 'active'),
('SMT-AOI', 'AOI inspection machine', 'AOI inspection machine', 'May AOI', 'active'),
('SMT-SPI', 'SPI inspection machine', 'SPI inspection machine', 'May SPI', 'active')
on conflict (code) do nothing;

insert into equipment_models (code, category_id, vendor_name, model_name, description, status)
select v.code, c.id, v.vendor_name, v.model_name, v.description, 'active'
from (
  values
    ('MODEL-NXT-01', 'SMT-MOUNTER', 'Panasonic', 'NXT-III', 'Main placement machine'),
    ('MODEL-PR-01', 'SMT-PRINTER', 'DEK', 'DEK Horizon 03i', 'Stencil printer'),
    ('MODEL-OV-01', 'SMT-OVEN', 'Heller', 'Heller 1912MK5', 'Reflow oven'),
    ('MODEL-AOI-01', 'SMT-AOI', 'Omron', 'VT-S530', 'AOI machine'),
    ('MODEL-SPI-01', 'SMT-SPI', 'Koh Young', 'Zenith 2', 'SPI machine')
) as v(code, category_code, vendor_name, model_name, description)
join equipment_categories c on c.code = v.category_code
on conflict (code) do nothing;

insert into equipment_status_codes (code, name_zh, name_en, name_vi, category, status)
values
('READY', 'Ready', 'Ready', 'San sang', 'operational', 'active'),
('IDLE', 'Idle', 'Idle', 'Cho', 'operational', 'active'),
('RUNNING', 'Running', 'Running', 'Dang chay', 'operational', 'active'),
('MAINTENANCE', 'Maintenance', 'Maintenance', 'Bao tri', 'service', 'active'),
('BREAKDOWN', 'Breakdown', 'Breakdown', 'Hu hong', 'service', 'active'),
('RETIRED', 'Retired', 'Retired', 'Ngung su dung', 'lifecycle', 'active')
on conflict (code) do nothing;

insert into equipment_locations (code, name_zh, name_en, name_vi, location_type, line_id, station_id, status)
select v.code, v.name_zh, v.name_en, v.name_vi, v.location_type, l.id, s.id, 'active'
from (
  values
    ('EQ-LINE-01', 'Line 01 equipment area', 'Line 01 equipment area', 'Khu thiet bi line 01', 'line_side', 'L001', 'AOI-01'),
    ('EQ-REPAIR-01', 'Repair room 01', 'Repair room 01', 'Phong sua chua 01', 'repair_room', 'L001', null),
    ('EQ-CAL-01', 'Calibration room 01', 'Calibration room 01', 'Phong calibration 01', 'calibration_room', null, null)
) as v(code, name_zh, name_en, name_vi, location_type, line_code, station_code)
left join production_lines l on l.internal_code = v.line_code
left join stations s on s.code = v.station_code
on conflict (code) do nothing;

insert into equipment_assets (
  asset_code,
  category_id,
  model_id,
  machine_id,
  line_id,
  station_id,
  location_id,
  serial_no,
  purchase_date,
  install_date,
  warranty_expiry,
  status
)
select
  v.asset_code,
  c.id,
  m.id,
  mach.id,
  l.id,
  s.id,
  loc.id,
  v.serial_no,
  v.purchase_date,
  v.install_date,
  v.warranty_expiry,
  v.status
from (
  values
    ('EQ-0001', 'SMT-MOUNTER', 'MODEL-NXT-01', 'NXT-01', 'L001', 'AOI-01', 'EQ-LINE-01', 'SN-NXT-001', date '2025-01-15', date '2025-02-01', date '2028-02-01', 'active'),
    ('EQ-0002', 'SMT-PRINTER', 'MODEL-PR-01', null, 'L001', null, 'EQ-LINE-01', 'SN-PR-001', date '2025-01-20', date '2025-02-03', date '2028-02-03', 'active'),
    ('EQ-0003', 'SMT-OVEN', 'MODEL-OV-01', null, 'L001', null, 'EQ-LINE-01', 'SN-OV-001', date '2025-01-25', date '2025-02-05', date '2028-02-05', 'maintenance')
) as v(asset_code, category_code, model_code, machine_code, line_code, station_code, location_code, serial_no, purchase_date, install_date, warranty_expiry, status)
join equipment_categories c on c.code = v.category_code
join equipment_models m on m.code = v.model_code
left join machines mach on mach.code = v.machine_code
left join production_lines l on l.internal_code = v.line_code
left join stations s on s.code = v.station_code
left join equipment_locations loc on loc.code = v.location_code
on conflict (asset_code) do nothing;

insert into equipment_spare_parts (part_code, name_zh, name_en, name_vi, material_id, uom, min_stock_qty, status)
select v.part_code, v.name_zh, v.name_en, v.name_vi, mat.id, v.uom, v.min_stock_qty, 'active'
from (
  values
    ('SP-001', 'Placement nozzle', 'Placement nozzle', 'Kim hut', 'R-0603-10K-1', 'PCS', 20.0000::numeric),
    ('SP-002', 'Printer blade', 'Printer blade', 'Lau kem han', 'PCB-AURORA-CTRL', 'PCS', 5.0000::numeric)
) as v(part_code, name_zh, name_en, name_vi, material_code, uom, min_stock_qty)
left join materials mat on mat.code = v.material_code
on conflict (part_code) do nothing;

insert into maintenance_plans (plan_no, asset_id, plan_type, frequency_type, frequency_value, next_due_date, status, created_by)
select v.plan_no, a.id, v.plan_type, v.frequency_type, v.frequency_value, v.next_due_date, 'active', u.id
from (
  values
    ('MP-0001', 'EQ-0001', 'preventive', 'days', 30, date '2026-07-15'),
    ('MP-0002', 'EQ-0002', 'inspection', 'days', 14, date '2026-06-30'),
    ('MP-0003', 'EQ-0003', 'calibration', 'days', 60, date '2026-08-01')
) as v(plan_no, asset_code, plan_type, frequency_type, frequency_value, next_due_date)
join equipment_assets a on a.asset_code = v.asset_code
cross join users u
where u.username = 'PMC_CN_01'
on conflict (plan_no) do nothing;

insert into maintenance_plan_steps (plan_id, step_no, step_name, instruction, required_scan, required_check, standard_minutes, status)
select p.id, v.step_no, v.step_name, v.instruction, v.required_scan, v.required_check, v.standard_minutes, 'active'
from maintenance_plans p
join (
  values
    ('MP-0001', 10, 'Power off and lockout', 'Isolate power before maintenance', true, true, 10),
    ('MP-0001', 20, 'Clean and inspect', 'Clean moving parts and check wear', false, true, 20),
    ('MP-0002', 10, 'Visual inspection', 'Check belts, sensors, and covers', false, true, 15),
    ('MP-0003', 10, 'Calibration check', 'Run calibration against standard', true, true, 30)
) as v(plan_no, step_no, step_name, instruction, required_scan, required_check, standard_minutes)
  on p.plan_no = v.plan_no
on conflict (plan_id, step_no) do nothing;

insert into maintenance_plan_assignments (plan_id, assignee_user_id, assignment_role, status)
select p.id, u.id, 'owner', 'active'
from maintenance_plans p
cross join users u
where p.plan_no in ('MP-0001', 'MP-0002', 'MP-0003')
  and u.username in ('PMC_CN_01', 'VN_WH_010', 'VN_OP_013')
on conflict (plan_id, assignee_user_id, assignment_role) do nothing;

insert into maintenance_schedules (schedule_no, plan_id, asset_id, scheduled_date, planned_start, planned_end, status, created_by)
select 'MS-0001', p.id, a.id, date '2026-06-17', timestamptz '2026-06-17 08:00:00+08', timestamptz '2026-06-17 10:00:00+08', 'planned', u.id
from maintenance_plans p
join equipment_assets a on a.asset_code = 'EQ-0001'
cross join users u
where p.plan_no = 'MP-0001'
  and u.username = 'PMC_CN_01'
on conflict (schedule_no) do nothing;

insert into maintenance_orders (
  order_no, schedule_id, plan_id, asset_id, order_type, priority,
  planned_start, planned_end, actual_start, actual_end, status,
  operator_id, created_by, closed_by, closed_at
)
select
  'MO-0001', s.id, p.id, a.id, 'preventive', 'normal',
  s.planned_start, s.planned_end, null, null, 'draft',
  u.id, u.id, null, null
from maintenance_schedules s
join maintenance_plans p on p.id = s.plan_id
join equipment_assets a on a.id = s.asset_id
cross join users u
where s.schedule_no = 'MS-0001'
  and u.username = 'VN_OP_013'
on conflict (order_no) do nothing;

insert into maintenance_order_lines (maintenance_order_id, line_no, task_type, description, spare_part_id, quantity, result_note, status)
select mo.id, 1, 'inspection', 'Check nozzle wear and suction pressure', null, 1.0000, null, 'open'
from maintenance_orders mo
where mo.order_no = 'MO-0001'
on conflict (maintenance_order_id, line_no) do nothing;

insert into maintenance_work_logs (maintenance_order_id, log_no, operator_id, work_type, work_minutes, note)
select mo.id, 1, u.id, 'inspection', 30, 'Initial equipment check completed'
from maintenance_orders mo
cross join users u
where mo.order_no = 'MO-0001'
  and u.username = 'VN_OP_013'
on conflict (maintenance_order_id, log_no) do nothing;

insert into breakdown_events (event_no, asset_id, line_id, station_id, fault_code, fault_reason, start_at, end_at, downtime_minutes, operator_id, status, traceability_key)
select 'BD-0001', a.id, a.line_id, a.station_id, 'POWER-LOSS', 'Machine stopped due to power loss', timestamptz '2026-06-16 13:10:00+08', timestamptz '2026-06-16 13:35:00+08', 25, u.id, 'resolved', 'EQ-0001'
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0001'
  and u.username = 'VN_OP_013'
on conflict (event_no) do nothing;

insert into downtime_events (downtime_no, asset_id, line_id, reason_code, reason_detail, start_at, end_at, downtime_minutes, status, operator_id)
select 'DT-0001', a.id, a.line_id, 'POWER-LOSS', 'Line 01 power interruption', timestamptz '2026-06-16 13:10:00+08', timestamptz '2026-06-16 13:35:00+08', 25, 'closed', u.id
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0001'
  and u.username = 'VN_OP_013'
on conflict (downtime_no) do nothing;

insert into inspection_tasks (task_no, asset_id, inspection_type, due_at, status, assigned_user_id, created_by)
select 'IT-0001', a.id, 'daily', timestamptz '2026-06-16 18:00:00+08', 'assigned', u.id, u.id
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0002'
  and u.username = 'VN_WH_010'
on conflict (task_no) do nothing;

insert into inspection_results (result_no, task_id, asset_id, result, measured_value, standard_value, operator_id, occurred_at, notes)
select 'IR-0001', t.id, a.id, 'pass', 1.0000, 1.0000, u.id, timestamptz '2026-06-16 18:05:00+08', 'Routine daily inspection passed'
from inspection_tasks t
join equipment_assets a on a.id = t.asset_id
cross join users u
where t.task_no = 'IT-0001'
  and u.username = 'VN_WH_010'
on conflict (result_no) do nothing;

insert into calibration_records (
  calibration_no, asset_id, calibration_type, standard_value, actual_value, result,
  operator_id, occurred_at, next_due_at, certificate_no, notes
)
select 'CA-0001', a.id, 'annual', 1.0000, 1.0000, 'pass', u.id, timestamptz '2026-06-16 09:00:00+08', timestamptz '2027-06-16 09:00:00+08', 'CERT-2026-0001', 'Calibration record created'
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0003'
  and u.username = 'PMC_CN_01'
on conflict (calibration_no) do nothing;

insert into equipment_repair_records (repair_no, breakdown_event_id, maintenance_order_id, action_taken, result, operator_id, closed_at, reinspection_required)
select 'ER-0001', b.id, mo.id, 'Reset the controller and verified normal operation.', 'closed', u.id, timestamptz '2026-06-16 13:40:00+08', false
from breakdown_events b
left join maintenance_orders mo on mo.order_no = 'MO-0001'
cross join users u
where b.event_no = 'BD-0001'
  and u.username = 'VN_OP_013'
on conflict (repair_no) do nothing;

insert into equipment_status_history (equipment_id, from_status, to_status, reason, operator_name, changed_at)
select a.id, 'IDLE', 'RUNNING', 'Line start after maintenance', u.username, timestamptz '2026-06-16 08:15:00+08'
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0001'
  and u.username = 'VN_OP_013'
on conflict do nothing;

insert into equipment_status_history (equipment_id, from_status, to_status, reason, operator_name, changed_at)
select a.id, 'RUNNING', 'MAINTENANCE', 'Scheduled preventive maintenance', u.username, timestamptz '2026-06-17 08:00:00+08'
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0001'
  and u.username = 'PMC_CN_01'
on conflict do nothing;

insert into equipment_events (event_no, asset_id, event_type, status, actor_id, reference_no, event_payload, occurred_at)
select 'EE-0001', a.id, 'status_change', 'posted', u.id, 'BD-0001', '{"from":"IDLE","to":"RUNNING"}'::jsonb, timestamptz '2026-06-16 08:15:00+08'
from equipment_assets a
cross join users u
where a.asset_code = 'EQ-0001'
  and u.username = 'VN_OP_013'
on conflict (event_no) do nothing;

