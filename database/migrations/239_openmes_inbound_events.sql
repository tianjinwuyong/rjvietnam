CREATE TABLE IF NOT EXISTS openmes_inbound_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  source_key VARCHAR(160) NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_type, source_key)
);
