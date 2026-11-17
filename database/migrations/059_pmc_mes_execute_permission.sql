-- 059_pmc_mes_execute_permission.sql
-- Add mes.execute permission to PMC role so they can approve/dispute compensation requests

do $$
declare
  v_perm_execute int;
  v_role_pmc     int;
begin
  -- Get mes.execute permission
  select id into v_perm_execute from permissions where code = 'mes.execute';
  -- Get PMC role
  select id into v_role_pmc from roles where code = 'pmc';

  if v_perm_execute is null or v_role_pmc is null then
    raise notice 'mes.execute or pmc role not found, skipping';
    return;
  end if;

  insert into role_permissions (role_id, permission_id)
  values (v_role_pmc, v_perm_execute)
  on conflict (role_id, permission_id) do nothing;

  raise notice 'Added mes.execute to PMC role';
end $$;
