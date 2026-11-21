-- PM Schedule System
-- Structured preventive maintenance by natural frequency (daily/monthly/yearly)
-- Generates maintenance_orders from PM templates assigned to assets
-- Separates PM templates (what to do) from inspection/point-check (operator daily checks)

begin;

-- ============================================================
-- PM FREQUENCY LOOKUP
-- ============================================================

create table if not exists pm_frequencies (
    code varchar(20) primary key,
    name_zh varchar(60) not null,
    name_en varchar(60) not null,
    name_vi varchar(60) not null,
    interval_days integer not null,  -- for auto due-date calculation
    sort_order integer not null default 0,
    status varchar(20) not null default 'active',
    created_at timestamptz not null default now()
);

insert into pm_frequencies (code, name_zh, name_en, name_vi, interval_days, sort_order) values
    ('daily',     '每日',   'Daily',     'Hằng ngày',   1, 10),
    ('weekly',    '每周',   'Weekly',    'Hàng tuần',   7, 20),
    ('monthly',   '每月',   'Monthly',   'Hàng tháng',  30, 30),
    ('quarterly', '每季度', 'Quarterly', 'Hàng quý',    90, 40),
    ('halfyear',  '每半年', 'Half-Year', 'Nửa năm',     180, 50),
    ('yearly',    '每年',   'Yearly',    'Hàng năm',    365, 60)
on conflict (code) do nothing;

-- ============================================================
-- PM TEMPLATES (one per machine_type + frequency combo)
-- e.g. "mounter + monthly" = monthly PM tasks for pick & place
-- ============================================================

create table if not exists pm_templates (
    id bigserial primary key,
    template_code varchar(80) not null unique,
    machine_type varchar(40) not null,          -- matches machines.machine_type
    frequency_code varchar(20) not null references pm_frequencies(code),
    template_name varchar(160) not null,
    est_duration_minutes integer not null default 30,
    requires_shutdown boolean not null default true,  --是否需要停机
    requires_engineer boolean not null default false,  --是否需要工程师
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- PM TEMPLATE TASKS (individual check/action items)
-- ============================================================

create table if not exists pm_template_tasks (
    id bigserial primary key,
    template_id bigint not null references pm_templates(id) on delete cascade,
    task_no integer not null check (task_no > 0),
    task_name varchar(200) not null,
    task_type varchar(40) not null default 'check',  -- check, clean, replace, calibrate, lubricate, test
    description text,
    procedure_ref varchar(200),         -- SOP document reference
    requires_tool varchar(120),         --工具/仪器
    pass_criteria varchar(300),         --验收标准
    is_critical boolean not null default false,
    created_at timestamptz not null default now(),
    unique(template_id, task_no)
);

-- ============================================================
-- PM SCHEDULE ASSIGNMENTS (which machine/asset gets which templates)
-- ============================================================

create table if not exists pm_schedule_assignments (
    id bigserial primary key,
    asset_id bigint not null references equipment_assets(id) on delete cascade,
    template_id bigint not null references pm_templates(id),
    frequency_code varchar(20) not null references pm_frequencies(code),
    next_due_date date not null,                       -- next scheduled date
    last_completed_date date,                          -- last completion
    assigned_team varchar(40) default 'maintenance',   -- maintenance / contractor / production
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(asset_id, template_id)
);

-- ============================================================
-- PM EXECUTION RECORDS (completed PM orders link)
-- ============================================================

create table if not exists pm_execution_logs (
    id bigserial primary key,
    log_no varchar(80) not null unique,
    assignment_id bigint references pm_schedule_assignments(id),
    maintenance_order_id bigint references maintenance_orders(id),
    template_id bigint not null references pm_templates(id),
    asset_id bigint not null references equipment_assets(id),
    scheduled_date date not null,
    completed_date date,
    executed_by bigint references users(id),
    total_tasks integer not null default 0,
    completed_tasks integer not null default 0,
    passed_tasks integer not null default 0,
    failed_tasks integer not null default 0,
    result varchar(20) not null default 'pending',  -- pending, pass, conditional, fail
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- EXTEND maintenance_plans frequency types
-- ============================================================

alter table maintenance_plans
    drop constraint if exists maintenance_plans_frequency_type_check;
alter table maintenance_plans
    add constraint maintenance_plans_frequency_type_check
    check (frequency_type in ('days', 'hours', 'cycles', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'));

-- ============================================================
-- FUNCTION: Generate PM orders for overdue schedules
-- Call daily via cron/scheduler to auto-create maintenance_orders
-- ============================================================

create or replace function generate_pm_orders()
returns table (
    order_no varchar,
    asset_code varchar,
    template_name varchar,
    status text
) language plpgsql as $$
declare
    v_rec record;
    v_order_no varchar;
begin
    for v_rec in
        select
            psa.id as assignment_id,
            psa.asset_id,
            psa.template_id,
            psa.next_due_date,
            ea.asset_code,
            pt.template_name,
            mt.code as machine_code,
            mt.machine_type
        from pm_schedule_assignments psa
        join equipment_assets ea on ea.id = psa.asset_id
        join pm_templates pt on pt.id = psa.template_id
        left join machines mt on mt.id = ea.machine_id
        where psa.is_active = true
          and psa.next_due_date <= current_date
          -- skip if order already generated for this assignment + due date
          and not exists (
              select 1 from pm_execution_logs pel
              where pel.assignment_id = psa.id
                and pel.scheduled_date = psa.next_due_date
          )
        order by psa.next_due_date
    loop
        -- generate order_no: PM + YYMMDD + serial
        v_order_no := 'PM-' || to_char(current_date, 'YYMMDD') || '-'
            || lpad(nextval('pm_order_seq'::regclass)::text, 4, '0');

        -- create maintenance_order
        insert into maintenance_orders (
            order_no, asset_id, order_type, priority,
            planned_start, status, created_by
        ) values (
            v_order_no, v_rec.asset_id, 'preventive', 'normal',
            current_date::timestamptz + interval '8 hours',
            'draft',
            (select id from users where username = 'admin' limit 1)
        );

        -- create pm_execution_log
        insert into pm_execution_logs (
            log_no, assignment_id, maintenance_order_id, template_id, asset_id,
            scheduled_date, result
        ) values (
            'PEL-' || v_order_no,
            v_rec.assignment_id,
            (select id from maintenance_orders where order_no = v_order_no),
            v_rec.template_id,
            v_rec.asset_id,
            v_rec.next_due_date,
            'pending'
        );

        order_no := v_order_no;
        asset_code := v_rec.asset_code;
        template_name := v_rec.template_name;
        status := 'generated';
        return next;
    end loop;

    -- if no overdue, still return empty
    if not found then
        order_no := null;
        asset_code := null;
        template_name := null;
        status := 'no overdue schedules';
        return next;
    end if;
end;
$$;

-- sequence for PM order numbering
create sequence if not exists pm_order_seq start 1;

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_pm_templates_machine on pm_templates(machine_type, frequency_code, is_active);
create index if not exists idx_pm_template_tasks_template on pm_template_tasks(template_id, task_no);
create index if not exists idx_pm_schedule_assignments_asset on pm_schedule_assignments(asset_id, is_active);
create index if not exists idx_pm_schedule_assignments_due on pm_schedule_assignments(next_due_date, is_active);
create index if not exists idx_pm_execution_logs_asset on pm_execution_logs(asset_id, scheduled_date desc);

commit;
