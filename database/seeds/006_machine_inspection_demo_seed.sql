-- Machine Inspection Demo Seed Data
-- Creates sample assignments, records, and OEE data for SMT Line 1
-- Depends on: migrations 040 (tables) and 041 (machine_types lookup)
-- Depends on: seeds 001 (production_lines, machines, users)

begin;

-- ============================================================
-- Helper: Get user IDs by username
-- ============================================================
do $$
declare
    v_op1 bigint;
    v_op2 bigint;
    v_line_id bigint;
    v_mach_mounter bigint;
    v_mach_printer bigint;
    v_mach_reflow bigint;
    v_mach_aoi bigint;
    v_tpl_pnp_daily bigint;
    v_tpl_prt_daily bigint;
    v_tpl_rfl_daily bigint;
    v_tpl_aoi_daily bigint;
    v_assign1 bigint;
    v_assign2 bigint;
    v_assign3 bigint;
    v_assign4 bigint;
    v_rec1 bigint;
    v_rec2 bigint;
begin
    -- Get user references
    select id into v_op1 from users where username = 'VN_OP_001';
    select id into v_op2 from users where username = 'VN_OP_002';
    if v_op1 is null or v_op2 is null then
        raise notice 'Skipping demo inspection seed: required users not found';
        return;
    end if;

    -- Get Line 1
    select id into v_line_id from production_lines where internal_code = 'L001';
    if v_line_id is null then
        raise notice 'Skipping: L001 not found';
        return;
    end if;

    -- Get machines
    select id into v_mach_mounter from machines where code = 'NXT-01' and line_id = v_line_id;
    select id into v_mach_printer from machines where code = 'PRINT-01' and line_id = v_line_id;
    select id into v_mach_reflow from machines where code = 'REFLOW-01' and line_id = v_line_id;
    select id into v_mach_aoi from machines where code = 'AOI-01' and line_id = v_line_id;

    -- Get templates
    select id into v_tpl_pnp_daily from inspection_templates where template_code = 'TPL-PNP-001';
    select id into v_tpl_prt_daily from inspection_templates where template_code = 'TPL-PRT-001';
    select id into v_tpl_rfl_daily from inspection_templates where template_code = 'TPL-RFL-001';
    select id into v_tpl_aoi_daily from inspection_templates where template_code = 'TPL-AOI-001';

    -- ============================================================
    -- INSPECTION ASSIGNMENTS (today's shift for each core machine)
    -- ============================================================

    -- Mounter daily inspection
    insert into inspection_assignments (
        assignment_no, machine_id, template_id, shift_date, shift_type,
        assigned_to, status, scheduled_start, scheduled_end, created_by
    )
    select 'IA-' || to_char(current_date, 'YYYYMMDD') || '-001', v_mach_mounter, v_tpl_pnp_daily,
           current_date, 'day', v_op1, 'completed',
           current_date::timestamptz + interval '7 hours',
           current_date::timestamptz + interval '7 hours 30 minutes',
           v_op1
    where v_mach_mounter is not null and v_tpl_pnp_daily is not null
    on conflict (machine_id, shift_date, shift_type) do nothing
    returning id into v_assign1;

    -- Printer daily inspection
    insert into inspection_assignments (
        assignment_no, machine_id, template_id, shift_date, shift_type,
        assigned_to, status, created_by
    )
    select 'IA-' || to_char(current_date, 'YYYYMMDD') || '-002', v_mach_printer, v_tpl_prt_daily,
           current_date, 'day', v_op1, 'in_progress', v_op1
    where v_mach_printer is not null and v_tpl_prt_daily is not null
    on conflict (machine_id, shift_date, shift_type) do nothing
    returning id into v_assign2;

    -- Reflow daily inspection
    insert into inspection_assignments (
        assignment_no, machine_id, template_id, shift_date, shift_type,
        assigned_to, status, created_by
    )
    select 'IA-' || to_char(current_date, 'YYYYMMDD') || '-003', v_mach_reflow, v_tpl_rfl_daily,
           current_date, 'day', v_op2, 'pending', v_op2
    where v_mach_reflow is not null and v_tpl_rfl_daily is not null
    on conflict (machine_id, shift_date, shift_type) do nothing
    returning id into v_assign3;

    -- AOI daily inspection
    insert into inspection_assignments (
        assignment_no, machine_id, template_id, shift_date, shift_type,
        assigned_to, status, created_by
    )
    select 'IA-' || to_char(current_date, 'YYYYMMDD') || '-004', v_mach_aoi, v_tpl_aoi_daily,
           current_date, 'day', v_op2, 'pending', v_op2
    where v_mach_aoi is not null and v_tpl_aoi_daily is not null
    on conflict (machine_id, shift_date, shift_type) do nothing
    returning id into v_assign4;

    -- ============================================================
    -- INSPECTION RECORD (Mounter - completed with all items pass)
    -- ============================================================

    if v_assign1 is not null and v_mach_mounter is not null and v_tpl_pnp_daily is not null then
        -- Get the actual item count from template
    declare
        v_item_count integer;
    begin
        select count(*) into v_item_count
        from inspection_template_items
        where template_id = v_tpl_pnp_daily;

        insert into inspection_records (
            record_no, assignment_id, machine_id, line_id, template_id,
            shift_date, shift_type, inspector_id,
            started_at, completed_at, overall_result,
            total_items, passed_items, failed_items, skipped_items,
            has_critical_fail, notes
        )
        select 'IR-' || to_char(current_date, 'YYYYMMDD') || '-001',
               v_assign1, v_mach_mounter, v_line_id, v_tpl_pnp_daily,
               current_date, 'day', v_op1,
               current_date::timestamptz + interval '7 hours 5 minutes',
               current_date::timestamptz + interval '7 hours 25 minutes',
               'pass',
               v_item_count, v_item_count, 0, 0,
               false, '日常点检全部通过'
        on conflict (record_no) do nothing
        returning id into v_rec1;

            -- Insert per-item results (all pass)
            if v_rec1 is not null then
                insert into inspection_record_items (
                    record_id, item_no, template_item_id, result, checked_at
                )
                select v_rec1, t.item_no, t.id, 'pass',
                       current_date::timestamptz + interval '7 hours 5 minutes' + (t.item_no * interval '2 minutes')
                from inspection_template_items t
                where t.template_id = v_tpl_pnp_daily
                on conflict (record_id, item_no) do nothing;
            end if;
        end;
    end if;

    -- ============================================================
    -- INSPECTION RECORD (Printer - partial with one conditional item)
    -- ============================================================

    if v_assign2 is not null and v_mach_printer is not null and v_tpl_prt_daily is not null then
    declare
        v_item_count integer;
    begin
        select count(*) into v_item_count
        from inspection_template_items
        where template_id = v_tpl_prt_daily;

        insert into inspection_records (
            record_no, assignment_id, machine_id, line_id, template_id,
            shift_date, shift_type, inspector_id,
            started_at, overall_result,
            total_items, passed_items, failed_items, skipped_items,
            has_critical_fail, notes
        )
        select 'IR-' || to_char(current_date, 'YYYYMMDD') || '-002',
               v_assign2, v_mach_printer, v_line_id, v_tpl_prt_daily,
               current_date, 'day', v_op1,
               current_date::timestamptz + interval '8 hours',
               'conditional',
               v_item_count, v_item_count - 1, 0, 1,
               false, '刮刀压力需微调'
        on conflict (record_no) do nothing
        returning id into v_rec2;

            if v_rec2 is not null then
                insert into inspection_record_items (
                    record_id, item_no, template_item_id, result, notes, checked_at
                )
                select v_rec2, t.item_no, t.id,
                       case when t.check_point like '%刮刀压力%' then 'na'
                            else 'pass'
                       end,
                       case when t.check_point like '%刮刀压力%' then '已记录，待工程师确认设定值'
                            else null
                       end,
                       current_date::timestamptz + interval '8 hours' + (t.item_no * interval '1 minute')
                from inspection_template_items t
                where t.template_id = v_tpl_prt_daily
                on conflict (record_id, item_no) do nothing;
            end if;
        end;
    end if;

    -- ============================================================
    -- MACHINE OEE LOGS (today's demo data)
    -- ============================================================

    -- Mounter OEE
    insert into machine_oee_logs (
        log_date, machine_id, line_id, shift_type,
        planned_prod_hours, actual_prod_hours, downtime_minutes,
        output_qty, defect_qty, notes
    )
    select current_date, v_mach_mounter, v_line_id, 'day',
           10.0, 9.5, 15, 8500, 25, 'Normal production day'
    where v_mach_mounter is not null
    on conflict (log_date, machine_id, shift_type) do nothing;

    -- Printer OEE
    insert into machine_oee_logs (
        log_date, machine_id, line_id, shift_type,
        planned_prod_hours, actual_prod_hours, downtime_minutes,
        output_qty, defect_qty, notes
    )
    select current_date, v_mach_printer, v_line_id, 'day',
           10.0, 9.8, 8, 8600, 18, 'Good run'
    where v_mach_printer is not null
    on conflict (log_date, machine_id, shift_type) do nothing;

    -- Reflow OEE
    insert into machine_oee_logs (
        log_date, machine_id, line_id, shift_type,
        planned_prod_hours, actual_prod_hours, downtime_minutes,
        output_qty, defect_qty, notes
    )
    select current_date, v_mach_reflow, v_line_id, 'day',
           10.0, 10.0, 0, 8600, 32, 'Continuous run, minor defects'
    where v_mach_reflow is not null
    on conflict (log_date, machine_id, shift_type) do nothing;

    -- AOI OEE
    insert into machine_oee_logs (
        log_date, machine_id, line_id, shift_type,
        planned_prod_hours, actual_prod_hours, downtime_minutes,
        output_qty, defect_qty, notes
    )
    select current_date, v_mach_aoi, v_line_id, 'day',
           10.0, 9.2, 20, 8500, 0, 'AOI detection only, no defects generated'
    where v_mach_aoi is not null
    on conflict (log_date, machine_id, shift_type) do nothing;

    -- ============================================================
    -- MACHINE STATUS SNAPSHOTS (current real-time status)
    -- ============================================================

    insert into machine_status_snapshots (
        machine_id, status, current_product, current_work_order,
        output_counter, defect_counter, running_hours,
        idle_minutes_today, maintenance_minutes_today, breakdown_minutes_today
    )
    select v_mach_mounter, 'running', 'PCBA-A123', '2606M0100001',
           8500, 25, 1250.5, 15, 0, 0
    where v_mach_mounter is not null
    on conflict (machine_id) do update set
        status = excluded.status,
        output_counter = excluded.output_counter,
        defect_counter = excluded.defect_counter,
        last_updated = now();

    insert into machine_status_snapshots (
        machine_id, status, current_product, current_work_order,
        output_counter, defect_counter, running_hours,
        idle_minutes_today, maintenance_minutes_today, breakdown_minutes_today
    )
    select v_mach_printer, 'running', 'PCBA-A123', '2606M0100001',
           8600, 18, 1280.0, 8, 0, 0
    where v_mach_printer is not null
    on conflict (machine_id) do update set
        status = excluded.status,
        last_updated = now();

    insert into machine_status_snapshots (
        machine_id, status, current_product, current_work_order,
        output_counter, defect_counter, running_hours,
        idle_minutes_today, maintenance_minutes_today, breakdown_minutes_today
    )
    select v_mach_reflow, 'running', 'PCBA-A123', '2606M0100001',
           8600, 32, 2500.0, 0, 0, 0
    where v_mach_reflow is not null
    on conflict (machine_id) do update set
        status = excluded.status,
        last_updated = now();

    insert into machine_status_snapshots (
        machine_id, status, current_product, current_work_order,
        output_counter, defect_counter, running_hours,
        idle_minutes_today, maintenance_minutes_today, breakdown_minutes_today
    )
    select v_mach_aoi, 'idle', 'PCBA-A123', '2606M0100001',
           8500, 0, 980.0, 20, 0, 0
    where v_mach_aoi is not null
    on conflict (machine_id) do update set
        status = excluded.status,
        last_updated = now();

    raise notice 'Demo inspection seed completed successfully';
end $$;

commit;
