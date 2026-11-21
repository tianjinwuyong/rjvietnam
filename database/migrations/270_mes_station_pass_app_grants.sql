-- 270: hand the station-pass tables to the application role.
--
-- `scripts/migrate.mjs` connects with the *admin* role (PGUSER default postgres)
-- unless PG* env vars are exported. Tables it creates are owned by that role, so
-- the API — which connects as PGUSER (normally `smt_factory`) — gets
-- "permission denied for table mes_station_pass_events" on the first write.
--
-- Transfer ownership to the app role when it exists; no-op elsewhere.

DO $$
DECLARE
  app_role text := coalesce(nullif(current_setting('smt.app_role', true), ''), 'smt_factory');
  tbl      text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'role % not present - skipping station-pass ownership transfer', app_role;
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY ARRAY[
    'mes_station_pass_policies',
    'mes_skip_releases',
    'mes_station_pass_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', tbl, app_role);
  END LOOP;
END $$;
