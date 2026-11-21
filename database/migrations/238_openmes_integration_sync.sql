-- OpenMES integration outbox/idempotency ledger.
CREATE TABLE IF NOT EXISTS openmes_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  entity_type VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS openmes_sync_objects (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  source_key VARCHAR(160) NOT NULL,
  target_key VARCHAR(160),
  payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_openmes_sync_objects_status
  ON openmes_sync_objects(entity_type, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS openmes_inbound_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  source_key VARCHAR(160) NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_type, source_key)
);
