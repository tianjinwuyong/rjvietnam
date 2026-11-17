BEGIN;

CREATE TABLE IF NOT EXISTS station_activity_logs (
  event_id varchar(160) PRIMARY KEY,
  station_code varchar(64) NOT NULL,
  table_name varchar(64) NOT NULL,
  table_version integer NOT NULL,
  action varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  station_created_at bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Station-generated durable IDs include station code + UUID and may exceed the
-- original 64 characters. Match the production event ledger's 160-char key.
ALTER TABLE station_activity_logs
  ALTER COLUMN event_id TYPE varchar(160);

COMMIT;
