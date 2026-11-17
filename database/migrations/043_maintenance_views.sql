-- =====================================================================
-- Maintenance & Inspection Useful Views
-- Run AFTER migrations 040, 041, 042
-- =====================================================================

begin;

-- =====================================================================
-- VIEW 1: Equipment Asset Overview (设备资产总览)
-- =====================================================================

create or replace view v_equipment_overview as
select
  ea.asset_code,
  m.code                               as machine_code,
  m.machine_type,
  ec.name_zh                           as category_zh,
  em.vendor_name,
  em.model_name,
  pl.internal_code                      as line_code,
  s.code                               as station_code,
  ea.serial_no,
  ea.install_date,
  ea.status                            as asset_status,
  m.status                             as machine_status,
  -- Warranty status
  case
    when ea.warranty_expiry < current_date then '过期/Expired'
    when ea.warranty_expiry <= current_date + 30 then '30天内到期/Due Soon'
    else '有效/Active'
  end                                  as warranty_status,
  ea.warranty_expiry
from equipment_assets ea
join machines m on m.id = ea.machine_id
left join equipment_categories ec on ec.id = ea.category_id
left join equipment_models em on em.id = ea.model_id
left join production_lines pl on pl.id = ea.line_id
left join stations s on s.id = ea.station_id;

-- =====================================================================
-- VIEW 2: Pending Inspections (待执行点检)
-- =====================================================================

create or replace view v_pending_inspections as
select
  ia.assignment_no,
  m.code                               as machine_code,
  m.machine_type,
  pl.internal_code                      as line_code,
  ia.shift_date,
  ia.shift_type,
  u.display_name                        as assigned_to,
  ia.status,
  ia.scheduled_start,
  ia.scheduled_end,
  t.template_name,
  t.frequency_type,
  -- overdue?
  case
    when ia.shift_date < current_date and ia.status = 'pending'
      then '已逾期/Overdue'
    when ia.shift_date = current_date
      then '今日/Today'
    else '未来/Future'
  end                                  as time_status
from inspection_assignments ia
join machines m on m.id = ia.machine_id
join inspection_templates t on t.id = ia.template_id
left join production_lines pl on pl.id = m.line_id
left join users u on u.id = ia.assigned_to
where ia.status in ('pending', 'in_progress')
order by
  case when ia.shift_date < current_date then 0 else 1 end,
  ia.shift_date,
  ia.shift_type;

-- =====================================================================
-- VIEW 3: Overdue Maintenance Plans (逾期维保计划)
-- =====================================================================

create or replace view v_overdue_maintenance as
select
  mp.plan_no,
  ea.asset_code,
  m.code                               as machine_code,
  m.machine_type,
  pl.internal_code                      as line_code,
  mp.plan_type,
  mp.frequency_type,
  mp.frequency_value,
  mp.next_due_date,
  current_date - mp.next_due_date       as overdue_days,
  case
    when mp.next_due_date < current_date - 7  then '严重逾期/>7days'
    when mp.next_due_date < current_date      then '逾期/Overdue'
    when mp.next_due_date = current_date       then '今日到期/Due Today'
    when mp.next_due_date <= current_date + 7 then '7天内到期/Due Soon'
    else '正常/OK'
  end                                  as overdue_status,
  mp.status
from maintenance_plans mp
join equipment_assets ea on ea.id = mp.asset_id
join machines m on m.id = ea.machine_id
left join production_lines pl on pl.id = ea.line_id
where mp.next_due_date <= current_date + 7
  and mp.status = 'active'
order by mp.next_due_date;

-- =====================================================================
-- VIEW 4: Maintenance Order Status Summary (工单状态汇总)
-- =====================================================================

create or replace view v_maintenance_order_summary as
select
  mo.order_no,
  ea.asset_code,
  m.code                               as machine_code,
  m.machine_type,
  pl.internal_code                      as line_code,
  mo.order_type,
  mo.priority,
  mo.status,
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
  -- Is overdue?
  case
    when mo.status in ('draft','released','in_progress')
      and mo.planned_end < now() then '逾期/Overdue'
    else null
  end                                  as overdue_flag
from maintenance_orders mo
join equipment_assets ea on ea.id = mo.asset_id
join machines m on m.id = ea.machine_id
left join production_lines pl on pl.id = ea.line_id
left join users u on u.id = mo.operator_id
left join users cu on cu.id = mo.created_by
order by
  case mo.priority when 'urgent' then 0 when 'high' then 1 else 2 end,
  mo.planned_start desc;

-- =====================================================================
-- VIEW 5: Breakdown Events Summary (故障事件汇总)
-- =====================================================================

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
  -- MTBF contribution (this event's downtime)
  -- Severity
  case
    when be.downtime_minutes > 480  then '重大/Major (>8h)'
    when be.downtime_minutes > 60  then '中等/Medium (>1h)'
    else '轻微/Minor'
  end                                  as severity
from breakdown_events be
join equipment_assets ea on ea.id = be.asset_id
join machines m on m.id = ea.machine_id
left join production_lines pl on pl.id = ea.line_id
left join users u on u.id = be.operator_id
order by be.start_at desc;

-- =====================================================================
-- VIEW 6: Daily OEE Summary by Line (产线每日OEE)
-- =====================================================================

create or replace view v_daily_oee_by_line as
select
  log_date,
  pl.internal_code                      as line_code,
  pl.name_zh                            as line_name,
  count(distinct machine_id)            as machine_count,
  sum(planned_prod_hours)               as total_planned_hours,
  sum(actual_prod_hours)                as total_actual_hours,
  sum(downtime_minutes)                 as total_downtime_minutes,
  sum(output_qty)                       as total_output,
  sum(defect_qty)                       as total_defects,
  round(avg(oee_availability), 2)       as avg_availability_pct,
  round(avg(oee_quality), 2)            as avg_quality_pct,
  round(avg(oee_overall), 2)            as avg_oee_pct
from machine_oee_logs mol
join production_lines pl on pl.id = mol.line_id
group by log_date, pl.internal_code, pl.name_zh
order by log_date desc, pl.internal_code;

-- =====================================================================
-- VIEW 7: Task Library by Machine Type (任务库总览)
-- =====================================================================

create or replace view v_task_library_overview as
select
  mt.machine_type,
  mt.frequency,
  count(*)                              as task_count,
  array_agg(task_name_zh order by task_name_zh) as task_list
from maint_task_library mt
group by mt.machine_type, mt.frequency
order by mt.machine_type,
  case mt.frequency
    when 'shift' then 1
    when 'daily' then 2
    when 'weekly' then 3
    when 'monthly' then 4
    when 'quarterly' then 5
    when '半年度' then 6
    when '年度' then 7
    else 99
  end;

-- =====================================================================
-- VIEW 8: Wear Parts Due Soon (即将到期的备件更换)
-- Note: This is a reference view - actual tracking via equipment_spare_parts
-- =====================================================================

create or replace view v_wear_parts_reference as
select
  wpr.machine_type,
  wpr.part_name_zh,
  wpr.part_name_en,
  wpr.part_code,
  wpr.typical_lifetime_zh,
  wpr.typical_lifetime_en,
  wpr.replacement_frequency,
  wpr.is_safety_critical
from wear_parts_reference wpr
order by wpr.machine_type, wpr.part_name_en;

-- =====================================================================
-- VIEW 9: Facilities Alert Summary (设施告警汇总)
-- =====================================================================

create or replace view v_facilities_alerts as
select
  fa.alert_no,
  fc.name_zh                            as facility_category,
  fa.location_id,
  el.name_zh                            as location_name,
  fa.metric_name,
  fa.measured_value,
  fa.threshold_min,
  fa.threshold_max,
  fa.severity,
  fa.status,
  fa.created_at,
  au.display_name                       as acknowledged_by,
  fa.acknowledged_at,
  ru.display_name                       as resolved_by,
  fa.resolved_at
from fac_alerts fa
join fac_alert_rules far on far.id = fa.rule_id
join facility_categories fc on fc.id = far.category_id
left join equipment_locations el on el.id = fa.location_id
left join users au on au.id = fa.acknowledged_by
left join users ru on ru.id = fa.resolved_by
order by
  case fa.severity when 'critical' then 0 when 'warning' then 1 else 2 end,
  fa.created_at desc;

-- =====================================================================
-- VIEW 10: Maintenance KPI Dashboard (维保KPI仪表板)
-- =====================================================================

create or replace view v_maintenance_kpi as
with monthly_data as (
  select
    date_trunc('month', mo.actual_end) as month,
    count(*)                            as completed_orders,
    sum(
      case
        when mo.actual_end is not null and mo.actual_start is not null
        then extract(epoch from (mo.actual_end - mo.actual_start))/60
        else 0
      end
    )                                   as total_maintenance_minutes,
    count(case when mo.status = 'completed' then 1 end) as completed,
    count(case when mo.status = 'in_progress' then 1 end) as in_progress,
    count(case when mo.priority in ('high','urgent') and mo.status != 'closed' then 1 end) as urgent_pending
  from maintenance_orders mo
  where mo.actual_end >= date_trunc('month', current_date - interval '12 months')
    or mo.actual_end is null
  group by date_trunc('month', mo.actual_end)
),
breakdown_data as (
  select
    date_trunc('month', start_at) as month,
    count(*)                       as breakdown_count,
    sum(downtime_minutes)          as total_downtime_minutes
  from breakdown_events
  where start_at >= current_date - interval '12 months'
  group by date_trunc('month', start_at)
)
select
  md.month,
  md.completed_orders,
  md.total_maintenance_minutes,
  round(md.total_maintenance_minutes / nullif(md.completed_orders, 0), 1) as avg_mttr_minutes,
  md.completed,
  md.in_progress,
  md.urgent_pending,
  bd.breakdown_count,
  bd.total_downtime_minutes,
  round(bd.total_downtime_minutes::numeric / nullif(bd.breakdown_count, 0) / 60, 2) as avg_mtbf_hours,
  -- PM compliance rate
  round(
    (
      select count(*) * 100.0 / nullif(count(*), 0)
      from maintenance_orders mop
      where date_trunc('month', mop.actual_end) = md.month
        and mop.plan_id is not null
        and mop.status = 'completed'
    ), 1
  ) as pm_compliance_pct
from monthly_data md
left join breakdown_data bd on bd.month = md.month
order by md.month desc;

-- =====================================================================
-- FUNCTION: Auto-update next_due_date after maintenance order completion
-- =====================================================================

create or replace function fn_update_next_due_date()
returns trigger as $$
begin
  if new.status = 'completed' and old.status != 'completed' then
    -- Update the linked maintenance plan's next_due_date
    update maintenance_plans
    set next_due_date = next_due_date + (frequency_value || ' days')::interval,
        updated_at = now()
    where id = new.plan_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_maintenance_order_completed on maintenance_orders;
create trigger trg_maintenance_order_completed
  after update of status on maintenance_orders
  for each row
  execute function fn_update_next_due_date();

-- =====================================================================
-- FUNCTION: Generate maintenance order number
-- =====================================================================

create or replace function fn_generate_mo_number()
returns text as $$
declare
  seq int;
begin
  select nextval('maintenance_order_seq') into seq;
  return 'MO-' || to_char(now(), 'YYYYMM') || '-' || lpad(seq::text, 5, '0');
end;
$$ language plpgsql;

-- Fix: maintenance_order_seq may not exist, create it
do $$ begin
  create sequence if not exists maintenance_order_seq;
exception when others then null;
end $$;

-- =====================================================================
-- VIEW 11: Critical Safety Check Items (关键安全点检项)
-- =====================================================================

create or replace view v_critical_safety_items as
select
  ti.check_point,
  ti.check_method,
  ti.pass_criteria,
  ti.fail_action,
  t.machine_type,
  t.template_name,
  t.frequency_type
from inspection_template_items ti
join inspection_templates t on t.id = ti.template_id
where ti.is_critical_safety = true
   or ti.is_key_point = true
order by t.machine_type, t.template_name;

commit;
