BEGIN;

CREATE TABLE IF NOT EXISTS station_sqlite_databases (
  database_id bigserial PRIMARY KEY,
  station_code varchar(64) NOT NULL,
  logical_name varchar(128) NOT NULL,
  relative_path text NOT NULL UNIQUE,
  purpose varchar(64) NOT NULL DEFAULT 'station_local',
  sync_enabled boolean NOT NULL DEFAULT true,
  status varchar(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled','missing','error')),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (station_code, logical_name)
);

CREATE TABLE IF NOT EXISTS station_sqlite_table_mappings (
  mapping_id bigserial PRIMARY KEY,
  database_id bigint NOT NULL REFERENCES station_sqlite_databases(database_id),
  sqlite_table varchar(128) NOT NULL,
  pg_schema varchar(64),
  pg_table varchar(128),
  sync_direction varchar(24) NOT NULL DEFAULT 'local_to_pg'
    CHECK (sync_direction IN ('local_to_pg','pg_to_local','bidirectional','local_only')),
  sqlite_key_columns text[] NOT NULL DEFAULT ARRAY[]::text[],
  pg_key_columns text[] NOT NULL DEFAULT ARRAY[]::text[],
  conflict_policy varchar(32) NOT NULL DEFAULT 'investigate'
    CHECK (conflict_policy IN ('investigate','pg_authoritative','local_authoritative','append_only')),
  enabled boolean NOT NULL DEFAULT true,
  column_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (database_id, sqlite_table)
);

CREATE TABLE IF NOT EXISTS station_sqlite_sync_state (
  mapping_id bigint PRIMARY KEY REFERENCES station_sqlite_table_mappings(mapping_id),
  local_count bigint NOT NULL DEFAULT 0,
  pg_count bigint NOT NULL DEFAULT 0,
  local_version bigint NOT NULL DEFAULT 0,
  pg_version bigint NOT NULL DEFAULT 0,
  local_hash varchar(64),
  pg_hash varchar(64),
  sync_status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending','matched','mismatch','syncing','error','local_only')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS station_sqlite_sync_audit (
  audit_id bigserial PRIMARY KEY,
  mapping_id bigint NOT NULL REFERENCES station_sqlite_table_mappings(mapping_id),
  action varchar(48) NOT NULL,
  actor varchar(128) NOT NULL DEFAULT 'SYSTEM',
  before_state jsonb,
  after_state jsonb,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sqlite_database_station
  ON station_sqlite_databases(station_code, status);
CREATE INDEX IF NOT EXISTS idx_sqlite_mapping_pg_target
  ON station_sqlite_table_mappings(pg_schema, pg_table) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_sqlite_sync_state_status
  ON station_sqlite_sync_state(sync_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sqlite_sync_audit_mapping
  ON station_sqlite_sync_audit(mapping_id, created_at DESC);

COMMIT;
