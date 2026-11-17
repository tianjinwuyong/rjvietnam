BEGIN;

-- A station owns the facts created by its local equipment. PostgreSQL receives
-- those facts as the central ledger; it must not write the same business rows
-- back into SQLite. Commands and approvals use dedicated downlink tables.
UPDATE station_sqlite_table_mappings
SET sync_direction = 'local_to_pg',
    conflict_policy = 'investigate',
    notes = concat_ws(E'\n', notes,
      '087: changed from bidirectional to station-owned local_to_pg; central commands use a separate downlink.'),
    updated_at = now()
WHERE sync_direction = 'bidirectional';

-- Correct the repair mapping to the actual central work-order table.
UPDATE station_sqlite_table_mappings m
SET pg_table = 'station_repair_work_orders',
    sync_direction = 'pg_to_local',
    conflict_policy = 'pg_authoritative',
    notes = concat_ws(E'\n', notes,
      '087: normalized repair target to station_repair_work_orders.'),
    updated_at = now()
FROM station_sqlite_databases d
WHERE d.database_id = m.database_id
  AND d.station_code = 'manu_rework'
  AND m.sqlite_table = 'repair_work_orders';

-- MES NG caches are read models downloaded by stations. They never upload into
-- the bucket ledger, so a cache cannot overwrite confirmed NG facts.
UPDATE station_sqlite_table_mappings
SET sync_direction = 'pg_to_local',
    conflict_policy = 'pg_authoritative',
    notes = concat_ws(E'\n', notes,
      '087: MES cache is a replaceable downlink read model, not an upstream fact.'),
    updated_at = now()
WHERE sqlite_table = 'mes_confirmed_ng_cache';

-- all_sns is an event-shaped local table, but its central registry identity is
-- station_code + sn. The station code is supplied by the database registry.
UPDATE station_sqlite_table_mappings m
SET sqlite_key_columns = ARRAY['sn']::text[],
    pg_key_columns = ARRAY['station_code', 'sn']::text[],
    conflict_policy = 'investigate',
    notes = concat_ws(E'\n', notes,
      '087: business identity is local sn -> central (station_code, sn).'),
    updated_at = now()
FROM station_sqlite_databases d
WHERE d.database_id = m.database_id
  AND m.sqlite_table = 'all_sns'
  AND m.pg_table = 'station_sn_registry'
  AND m.sync_direction = 'local_to_pg';

-- Declare the central identity explicitly. The station_code/bucket_name values
-- that are not SQLite columns are supplied by registry context during sync.
UPDATE station_sqlite_table_mappings
SET pg_key_columns = CASE pg_table
  WHEN 'station_sn_registry' THEN ARRAY['station_code', 'sn']::text[]
  WHEN 'station_bucket_snapshots' THEN ARRAY['station_code', 'bucket_name']::text[]
  WHEN 'station_production_events' THEN ARRAY['event_id']::text[]
  WHEN 'station_scrap_requests' THEN ARRAY['request_id']::text[]
  WHEN 'station_qr_workorder_bindings' THEN ARRAY['qr_code']::text[]
  WHEN 'station_repair_work_orders' THEN ARRAY['repair_work_order_id']::text[]
  ELSE pg_key_columns
END,
conflict_policy = CASE
  WHEN pg_table = 'station_production_events' THEN 'append_only'
  ELSE conflict_policy
END,
updated_at = now()
WHERE enabled;

ALTER TABLE station_sqlite_table_mappings
  DROP CONSTRAINT IF EXISTS station_sqlite_table_mappings_sync_direction_check;

ALTER TABLE station_sqlite_table_mappings
  ADD CONSTRAINT station_sqlite_table_mappings_sync_direction_check
  CHECK (sync_direction IN ('local_to_pg', 'pg_to_local', 'local_only'));

ALTER TABLE station_sqlite_table_mappings
  DROP CONSTRAINT IF EXISTS station_sqlite_mapping_keys_required_check;

ALTER TABLE station_sqlite_table_mappings
  ADD CONSTRAINT station_sqlite_mapping_keys_required_check
  CHECK (
    sync_direction = 'local_only'
    OR conflict_policy = 'append_only'
    OR (cardinality(sqlite_key_columns) > 0 AND cardinality(pg_key_columns) > 0)
  );

CREATE INDEX IF NOT EXISTS idx_sqlite_mapping_direction
  ON station_sqlite_table_mappings(sync_direction, enabled)
  WHERE enabled;

INSERT INTO station_sqlite_sync_audit(mapping_id, action, actor, after_state, detail)
SELECT mapping_id,
       'ownership_normalized',
       'SYSTEM_MIGRATION_087',
       jsonb_build_object(
         'sync_direction', sync_direction,
         'conflict_policy', conflict_policy,
         'sqlite_key_columns', sqlite_key_columns,
         'pg_key_columns', pg_key_columns,
         'pg_table', pg_table
       ),
       jsonb_build_object(
         'policy', 'station facts flow to PG; PG commands flow through dedicated downlink',
         'migration', '087_decouple_sqlite_pg_sync.sql'
       )
FROM station_sqlite_table_mappings
WHERE enabled;

COMMIT;
