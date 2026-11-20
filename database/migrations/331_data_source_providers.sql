-- 331_data_source_providers.sql
-- Registry for external data sources (other plants, the legacy MES, mirror servers) plus the
-- bookkeeping for copying their tables into this database as `ext_<provider>` staging schemas.
--
-- Why a table and not a config file: an operator adds, tests and syncs a source from the UI,
-- and every sync has to be auditable afterwards. Credentials live in `config` and are never
-- returned by the API (the routes mask `password` on read).

BEGIN;

CREATE TABLE IF NOT EXISTS data_source_provider (
  id                 serial PRIMARY KEY,
  code               varchar(64)  NOT NULL UNIQUE,
  name_zh            varchar(128) NOT NULL,
  kind               varchar(16)  NOT NULL DEFAULT 'postgres',
  config             jsonb        NOT NULL DEFAULT '{}'::jsonb,
  enabled            boolean      NOT NULL DEFAULT true,
  last_test_at       timestamptz,
  last_test_ok       boolean,
  last_test_message  text,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT data_source_provider_kind_check CHECK (kind IN ('postgres', 'mysql')),
  CONSTRAINT data_source_provider_code_check CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$')
);

CREATE TABLE IF NOT EXISTS data_source_sync_run (
  id           serial PRIMARY KEY,
  provider_id  int         NOT NULL REFERENCES data_source_provider(id) ON DELETE CASCADE,
  mode         varchar(16) NOT NULL DEFAULT 'replace',
  status       varchar(16) NOT NULL DEFAULT 'running',
  tables_total int         NOT NULL DEFAULT 0,
  tables_done  int         NOT NULL DEFAULT 0,
  rows_copied  bigint      NOT NULL DEFAULT 0,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  message      text,
  CONSTRAINT data_source_sync_run_mode_check   CHECK (mode   IN ('replace', 'append')),
  CONSTRAINT data_source_sync_run_status_check CHECK (status IN ('running', 'done', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS data_source_sync_table (
  id            serial PRIMARY KEY,
  run_id        int          NOT NULL REFERENCES data_source_sync_run(id) ON DELETE CASCADE,
  table_name    varchar(128) NOT NULL,
  target_schema varchar(64)  NOT NULL,
  rows_copied   bigint       NOT NULL DEFAULT 0,
  status        varchar(16)  NOT NULL DEFAULT 'pending',
  message       text,
  finished_at   timestamptz,
  CONSTRAINT data_source_sync_table_status_check CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_data_source_sync_run_provider ON data_source_sync_run(provider_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_source_sync_table_run ON data_source_sync_table(run_id);

COMMIT;
