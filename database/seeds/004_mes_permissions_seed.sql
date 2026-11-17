-- Add MES and WMS permissions for SMT operator role

do $$
declare
  v_perm_mes_view     int;
  v_perm_mes_execute  int;
  v_perm_wms_execute  int;
  v_role_smt_op       int;
  v_role_admin        int;
begin
  -- Create MES permissions if they don't exist
  insert into permissions (code, name_zh, name_en, name_vi, module, status)
  values ('mes.view', 'MES查看', 'MES View', 'Xem MES', 'mes', 'active')
  on conflict (code) do nothing
  returning id into v_perm_mes_view;

  if v_perm_mes_view is null then
    select id into v_perm_mes_view from permissions where code = 'mes.view';
  end if;

  insert into permissions (code, name_zh, name_en, name_vi, module, status)
  values ('mes.execute', 'MES执行', 'MES Execute', 'Thực thi MES', 'mes', 'active')
  on conflict (code) do nothing
  returning id into v_perm_mes_execute;

  if v_perm_mes_execute is null then
    select id into v_perm_mes_execute from permissions where code = 'mes.execute';
  end if;

  -- Create WMS execute permission if it doesn't exist
  insert into permissions (code, name_zh, name_en, name_vi, module, status)
  values ('wms.execute', '仓库执行', 'WMS Execute', 'Thực thi WMS', 'wms', 'active')
  on conflict (code) do nothing
  returning id into v_perm_wms_execute;

  if v_perm_wms_execute is null then
    select id into v_perm_wms_execute from permissions where code = 'wms.execute';
  end if;

  -- Assign to roles
  select id into v_role_smt_op from roles where code = 'smt_operator';
  select id into v_role_admin  from roles where code = 'admin';

  -- smt_operator: mes.view + mes.execute + wms.execute (needed for issue-to-line from PDA)
  insert into role_permissions (role_id, permission_id) values (v_role_smt_op, v_perm_mes_view)
    on conflict (role_id, permission_id) do nothing;
  insert into role_permissions (role_id, permission_id) values (v_role_smt_op, v_perm_mes_execute)
    on conflict (role_id, permission_id) do nothing;
  insert into role_permissions (role_id, permission_id) values (v_role_smt_op, v_perm_wms_execute)
    on conflict (role_id, permission_id) do nothing;

  -- admin: mes.view + mes.execute + wms.execute
  insert into role_permissions (role_id, permission_id) values (v_role_admin, v_perm_mes_view)
    on conflict (role_id, permission_id) do nothing;
  insert into role_permissions (role_id, permission_id) values (v_role_admin, v_perm_mes_execute)
    on conflict (role_id, permission_id) do nothing;
  insert into role_permissions (role_id, permission_id) values (v_role_admin, v_perm_wms_execute)
    on conflict (role_id, permission_id) do nothing;

  raise notice 'Added MES + WMS permissions and assigned to roles';
end $$;
