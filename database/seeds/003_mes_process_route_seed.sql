-- Full SMT process route — maps the 自动补料流程 flow from MES流程 document
-- 3 logical sections: SMT → Wave → Assembly → Final Test → Pack

do $$
declare
  v_route_id int;
  v_product_id int;
  v_step_no int := 10;
begin
  select id into v_product_id from products where code = 'PCBA-AURORA-CTRL';

  -- Deactivate old route
  update process_routes set status = 'superseded' where product_id = v_product_id;

  -- Create new route
  insert into process_routes (code, product_id, revision, status, created_by)
  values ('PR-AURORA-SMT-FULL', v_product_id, 'A2', 'active', 3)
  returning id into v_route_id;

  -- ======== 1. SMT Section ========
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
  values
    (v_route_id, v_step_no, 'RECEIVING', true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'IQC',       true,  true,  'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'MAT_PREP',  true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'LASER',     true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'AI',        true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'GLUE_PRINT',true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'PLACEMENT', true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'REFLOW',    true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'AOI',       true,  true,  'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'VI',        true,  true,  'pass_through'); v_step_no := v_step_no + 10;

  -- ======== 2. Wave Soldering Section ========
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'PCBA_LOAD', true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'ODD_FORM',  true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'DISPENSE',  true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'INSERT',    true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'WAVE',      true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'HEIGHT',    true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'ICT',       true,  true,  'route_fail_to_repair'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'FCT',       true,  true,  'route_fail_to_repair'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'CURE',      true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'DEPANEL',   true,  false, 'pass_through'); v_step_no := v_step_no + 10;

  -- ======== 3. Assembly Section ========
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'MOS_FORM',  true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'SCREW',     true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'CABLE',     true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'SOLDER',    true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'TOUCHUP',   true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'ASSY',      true,  false, 'pass_through'); v_step_no := v_step_no + 10;

  -- ======== 4. Test & Pack Section ========
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'ATE',       true,  true,  'route_fail_to_repair'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'ULTRASONIC',true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'BI',        true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'HI_POT',    true,  true,  'route_fail_to_repair'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'LOAD_TEST', true,  true,  'route_fail_to_repair'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'LABEL',     true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'PACK',      true,  false, 'pass_through'); v_step_no := v_step_no + 10;
  insert into process_route_steps (route_id, step_no, station_type, required_scan, required_inspection, output_rule)
    values
    (v_route_id, v_step_no, 'OQC',       true,  true,  'close_work_order');

  -- Set default route for product
  update products set default_route_id = v_route_id where id = v_product_id;

  raise notice 'Created full SMT route % with % steps', v_route_id, (v_step_no / 10)::int;
end $$;
