BEGIN;
ALTER TABLE station_events ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(128);
CREATE TABLE IF NOT EXISTS station_event_idempotency (
  source_event_id VARCHAR(128) PRIMARY KEY,
  station_event_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
INSERT INTO _migrations(filename,hash)
VALUES('200_station_event_idempotency.sql','station-event-idempotency-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
