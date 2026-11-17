-- =====================================================================
-- Migration 044: Maintenance System Fixes & Enhancements
-- Fixes typo, seeds alert rules, populates plan_steps, adds triggers
-- =====================================================================

begin;

-- ============================================================
-- 1. FIX: v_breakdown_summary typo (downdowntime_minutes)
-- ============================================================

create or replace view v_breakdown_summary as
select
  be.event_no,
  ea.asset_code,
  m.code                               as machine_code,
  m.machine_type,
  pl.internal_code                      as line_code,
  be.start_at,
  be.end_at,
  be.downtime_minutes,
  be.fault_reason,
  be.status,
  u.display_name                        as operator,
  case
    when be.downtime_minutes > 480  then '重大/Major (>8h)'
    when be.downtime_minutes > 60   then '中等/Medium (>1h)'
    else '轻微/Minor'
  end                                  as severity
from breakdown_events be
join equipment_assets ea on ea.id = be.asset_id
join machines m on m.id = ea.machine_id
left join production_lines pl on pl.id = ea.line_id
left join users u on u.id = be.operator_id
order by be.start_at desc;

-- ============================================================
-- 2. Seed fac_alert_rules (设施告警规则)
-- ============================================================

insert into fac_alert_rules (rule_code, category_id, sensor_type, metric_name, threshold_min, threshold_max, severity, notify_roles) values
-- ESD
('ALR-ESD-001', (select id from facility_categories where code='ESD'), 'esd', 'wrist_strap_ohm', null, 1000000, 'critical', 'maintenance,quality'),
('ALR-ESD-002', (select id from facility_categories where code='ESD'), 'esd', 'surface_resistance_ohm', 1000000, 1000000000, 'warning', 'maintenance'),
('ALR-ESD-003', (select id from facility_categories where code='ESD'), 'esd', 'ion_balancer_balance_mv', -50, 50, 'warning', 'maintenance'),
-- HVAC
('ALR-HVAC-001', (select id from facility_categories where code='HVAC'), 'hvac', 'temperature_c', 18, 28, 'warning', 'facilities'),
('ALR-HVAC-002', (select id from facility_categories where code='HVAC'), 'hvac', 'temperature_c', 15, 32, 'critical', 'maintenance,management'),
('ALR-HVAC-003', (select id from facility_categories where code='HVAC'), 'hvac', 'humidity_rh', 30, 60, 'warning', 'facilities'),
('ALR-HVAC-004', (select id from facility_categories where code='HVAC'), 'hvac', 'humidity_rh', 20, 70, 'critical', 'maintenance,management'),
-- Compressed Air
('ALR-AIR-001', (select id from facility_categories where code='COMPRESSED_AIR'), 'air', 'pressure_mpa', 0.45, 0.75, 'warning', 'maintenance'),
('ALR-AIR-002', (select id from facility_categories where code='COMPRESSED_AIR'), 'air', 'pressure_mpa', 0.4, 0.8, 'critical', 'maintenance,management'),
('ALR-AIR-003', (select id from facility_categories where code='COMPRESSED_AIR'), 'air', 'dew_point_c', null, -20, 'warning', 'maintenance'),
('ALR-AIR-004', (select id from facility_categories where code='COMPRESSED_AIR'), 'air', 'oil_content_ppm', null, 0.1, 'warning', 'maintenance'),
-- Power
('ALR-PWR-001', (select id from facility_categories where code='POWER'), 'power', 'voltage_l1_v', 342, 418, 'warning', 'maintenance'),
('ALR-PWR-002', (select id from facility_categories where code='POWER'), 'power', 'voltage_l1_v', 323, 437, 'critical', 'maintenance,management'),
('ALR-PWR-003', (select id from facility_categories where code='POWER'), 'power', 'power_factor', 0.9, null, 'warning', 'maintenance'),
-- Water
('ALR-WTR-001', (select id from facility_categories where code='PURE_WATER'), 'water', 'conductivity_us_cm', null, 10, 'warning', 'maintenance'),
('ALR-WTR-002', (select id from facility_categories where code='PURE_WATER'), 'water', 'ph', 6.5, 8.5, 'warning', 'quality'),
('ALR-WTR-003', (select id from facility_categories where code='PURE_WATER'), 'water', 'tds_ppm', null, 50, 'warning', 'quality')
on conflict (rule_code) do nothing;

-- ============================================================
-- 3. Populate maintenance_plan_steps from maint_task_library
-- For all newly created maintenance_plans, create their steps
-- ============================================================

insert into maintenance_plan_steps (
  plan_id, step_no, step_name, instruction,
  required_check, standard_minutes
)
select
  mp.id,
  row_number() over (partition by mp.id order by mt.id),
  mt.task_name_zh,
  coalesce(mt.description_zh, mt.task_name_zh),
  true,
  mt.estimated_minutes
from maintenance_plans mp
join machines m on m.id = mp.asset_id
join maint_task_library mt on mt.machine_type = m.machine_type
  and mt.frequency = (
    case mp.frequency_type
      when 'days' then case mp.frequency_value
        when 1  then 'daily'
        when 7  then 'weekly'
        when 30 then 'monthly'
        when 90 then 'quarterly'
        else 'monthly'
      end
      else 'monthly'
    end
  )
where not exists (
  select 1 from maintenance_plan_steps mps
  where mps.plan_id = mp.id
)
on conflict do nothing;

-- ============================================================
-- 4. Generate maintenance_schedules from overdue maintenance_plans
-- Create schedule + release work order for all overdue PM items
-- ============================================================

insert into maintenance_schedules (
  schedule_no, plan_id, asset_id,
  scheduled_date, planned_start, planned_end,
  status
)
select
  'SCH-' || mp.plan_no || '-' || to_char(current_date, 'YYYYMMDD'),
  mp.id,
  mp.asset_id,
  current_date,
  current_date + interval '8 hours',
  current_date + interval '10 hours',
  'released'
from maintenance_plans mp
where mp.next_due_date <= current_date
  and mp.status = 'active'
  and not exists (
    select 1 from maintenance_schedules ms
    where ms.plan_id = mp.id
      and ms.scheduled_date = current_date
  )
on conflict do nothing;

-- Create maintenance_orders for all released schedules that don't have orders yet
insert into maintenance_orders (
  order_no, schedule_id, plan_id, asset_id,
  order_type, priority,
  planned_start, planned_end, status,
  created_by
)
select
  fn_generate_mo_number(),
  ms.id,
  ms.plan_id,
  ms.asset_id,
  'preventive',
  case
    when mp.next_due_date < current_date - 7 then 'high'
    else 'normal'
  end,
  ms.planned_start,
  ms.planned_end,
  'released',
  (select id from users where role_id = (select id from roles where code='management') limit 1)
from maintenance_schedules ms
join maintenance_plans mp on mp.id = ms.plan_id
where ms.status = 'released'
  and not exists (
    select 1 from maintenance_orders mo
    where mo.schedule_id = ms.id
  )
on conflict do nothing;

-- ============================================================
-- 5. Function: Auto-create fac_alerts from out-of-range readings
-- ============================================================

create or replace function fn_check_fac_alert(
  p_category_id bigint,
  p_location_id bigint,
  p_sensor_type varchar,
  p_metric_name varchar,
  p_measured_value numeric,
  p_severity varchar
) returns void as $$
declare
  v_rule record;
  v_alert_no text;
begin
  -- Find matching rule
  for v_rule in
    select id, rule_code, threshold_min, threshold_max, severity, notify_roles
    from fac_alert_rules
    where category_id = p_category_id
      and sensor_type = p_sensor_type
      and metric_name = p_metric_name
      and status = 'active'
  loop
    -- Check if value is out of range
    if (v_rule.threshold_min is not null and p_measured_value < v_rule.threshold_min)
       or (v_rule.threshold_max is not null and p_measured_value > v_rule.threshold_max)
    then
      -- Check if there's already an open alert for this rule+location today
      if not exists (
        select 1 from fac_alerts
        where rule_id = v_rule.id
          and location_id = p_location_id
          and status in ('open','acknowledged')
          and created_at >= current_date
      ) then
        select 'ALRT-' || to_char(now(),'YYYYMMDD') || '-' ||
               lpad(nextval('fac_alert_seq')::text, 5, '0')
        into v_alert_no;

        insert into fac_alerts (
          alert_no, rule_id, location_id,
          metric_name, measured_value,
          threshold_min, threshold_max,
          severity, status
        ) values (
          v_alert_no, v_rule.id, p_location_id,
          p_metric_name, p_measured_value,
          v_rule.threshold_min, v_rule.threshold_max,
          coalesce(p_severity, v_rule.severity), 'open'
        );
      end if;
    end if;
  end loop;
end;
$$ language plpgsql;

-- Sequence for alert numbers
do $$ begin
  create sequence if not exists fac_alert_seq;
exception when others then null;
end $$;

-- ============================================================
-- 6. Trigger: auto-check fac_esd_records → fac_alerts
-- ============================================================

create or replace function fn_esd_record_after_insert()
returns trigger as $$
begin
  -- Wrist strap test: convert Ω to ohms for comparison
  perform fn_check_fac_alert(
    (select category_id from fac_alert_rules where sensor_type = 'esd' limit 1),
    NEW.location_id,
    'esd',
    'wrist_strap_ohm',
    NEW.measured_value,
    case when NEW.result = 'fail' then 'critical' else 'warning' end
  )
  where NEW.test_type = 'wrist_strap';

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_esd_record_after_insert on fac_esd_records;
create trigger trg_esd_record_after_insert
  after insert on fac_esd_records
  for each row execute function fn_esd_record_after_insert();

-- ============================================================
-- 7. Trigger: auto-check fac_hvac_records → fac_alerts
-- ============================================================

create or replace function fn_hvac_record_after_insert()
returns trigger as $$
begin
  if NEW.temperature is not null then
    perform fn_check_fac_alert(
      (select category_id from fac_alert_rules where sensor_type = 'hvac' and metric_name = 'temperature_c' limit 1),
      NEW.location_id,
      'hvac',
      'temperature_c',
      NEW.temperature,
      case when NEW.result = 'alert' then 'critical' else 'warning' end
    );
  end if;

  if NEW.humidity is not null then
    perform fn_check_fac_alert(
      (select category_id from fac_alert_rules where sensor_type = 'hvac' and metric_name = 'humidity_rh' limit 1),
      NEW.location_id,
      'hvac',
      'humidity_rh',
      NEW.humidity,
      case when NEW.result = 'alert' then 'critical' else 'warning' end
    );
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_hvac_record_after_insert on fac_hvac_records;
create trigger trg_hvac_record_after_insert
  after insert on fac_hvac_records
  for each row execute function fn_hvac_record_after_insert();

-- ============================================================
-- 8. Trigger: auto-check fac_air_records → fac_alerts
-- ============================================================

create or replace function fn_air_record_after_insert()
returns trigger as $$
begin
  if NEW.pressure_mpa is not null then
    perform fn_check_fac_alert(
      (select category_id from fac_alert_rules where sensor_type = 'air' and metric_name = 'pressure_mpa' limit 1),
      (select location_id from facility_assets limit 1),
      'air',
      'pressure_mpa',
      NEW.pressure_mpa,
      case when NEW.result = 'fail' then 'critical' else 'warning' end
    );
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_air_record_after_insert on fac_air_records;
create trigger trg_air_record_after_insert
  after insert on fac_air_records
  for each row execute function fn_air_record_after_insert();

-- ============================================================
-- 9. Trigger: auto-check fac_power_records → fac_alerts
-- ============================================================

create or replace function fn_power_record_after_insert()
returns trigger as $$
begin
  if NEW.voltage_l1 is not null then
    perform fn_check_fac_alert(
      (select category_id from fac_alert_rules where sensor_type = 'power' and metric_name = 'voltage_l1_v' limit 1),
      NEW.location_id,
      'power',
      'voltage_l1_v',
      NEW.voltage_l1,
      case when NEW.result = 'fail' then 'critical' else 'warning' end
    );
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_power_record_after_insert on fac_power_records;
create trigger trg_power_record_after_insert
  after insert on fac_power_records
  for each row execute function fn_power_record_after_insert();

-- ============================================================
-- 10. Create missing indexes
-- ============================================================

create index if not exists idx_maint_task_library_mtype
  on maint_task_library(machine_type, frequency);

create index if not exists idx_wear_parts_mtype
  on wear_parts_reference(machine_type);

create index if not exists idx_facility_assets_category
  on facility_assets(category_id, status);

create index if not exists idx_facility_sensor_cal_asset
  on facility_sensor_calibration(asset_id, status);

create index if not exists idx_inspection_assignments_date
  on inspection_assignments(shift_date, shift_type, status);

create index if not exists idx_machine_oee_logs_date
  on machine_oee_logs(log_date, machine_id);

create index if not exists idx_maint_plan_steps_plan
  on maintenance_plan_steps(plan_id, step_no);

-- ============================================================
-- 11. Sequences (ensure they exist for all serial PKs)
-- ============================================================

do $$
declare
  seqs text[] := array[
    'maintenance_order_seq',
    'fac_alert_seq',
    'equipment_event_seq',
    'breakdown_event_seq',
    'maintenance_sched_seq'
  ];
  seq_name text;
begin
  foreach seq_name in array seqs loop
    execute format('create sequence if not exists %I', seq_name);
  end loop;
end;
$$;

-- ============================================================
-- 12. Update v_maintenance_order_summary to use plan_steps
-- ============================================================

create or replace view v_maintenance_order_detail as
select
  mo.order_no,
  ea.asset_code,
  m.code                               as machine_code,
  m.machine_type,
  pl.internal_code                      as line_code,
  mo.order_type,
  mo.priority,
  mo.status,
  mp.plan_type,
  mp.frequency_type,
  mp.frequency_value,
  mo.planned_start,
  mo.planned_end,
  mo.actual_start,
  mo.actual_end,
  u.display_name                        as operator,
  cu.display_name                       as created_by,
  -- Duration
  case
    when mo.actual_end is not null and mo.actual_start is not null
      then extract(epoch from (mo.actual_end - mo.actual_start))/60
    else null
  end                                  as actual_minutes,
  -- Total standard minutes from plan_steps
  (
    select sum(mps.standard_minutes)
    from maintenance_plan_steps mps
    where mps.plan_id = mo.plan_id
  )                                    as standard_minutes,
  -- Overdue?
  case
    when mo.status in ('draft','released','in_progress')
      and mo.planned_end < now()
      then '逾期/Overdue'
    else null
  end                                  as overdue_flag
from maintenance_orders mo
join equipment_assets ea on ea.id = mo.asset_id
join machines m on m.id = ea.machine_id
left join production_lines pl on pl.id = ea.line_id
left join users u on u.id = mo.operator_id
left join users cu on cu.id = mo.created_by
left join maintenance_plans mp on mp.id = mo.plan_id
order by
  case mo.priority when 'urgent' then 0 when 'high' then 1 else 2 end,
  mo.planned_start desc;

commit;
