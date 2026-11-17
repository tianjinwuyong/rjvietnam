-- Immutable per-SN MES trace ledger. Scanner observations are traceable but
-- remain explicitly separate from formal production facts.
CREATE TABLE IF NOT EXISTS canonical_sn_trace_events(
  event_id VARCHAR(200) NOT NULL,
  sn VARCHAR(200) NOT NULL,
  root_sn VARCHAR(200) NOT NULL,
  station_code VARCHAR(64) NOT NULL,
  line_code VARCHAR(64),
  event_type VARCHAR(64) NOT NULL,
  action VARCHAR(80) NOT NULL,
  result VARCHAR(32),
  formal_production_fact BOOLEAN NOT NULL DEFAULT FALSE,
  actor VARCHAR(120), actor_role VARCHAR(64), work_order_code VARCHAR(160),
  batch_id VARCHAR(200), motherboard_id VARCHAR(200), slot INTEGER,
  source_type VARCHAR(64), source_record VARCHAR(500), source_hash VARCHAR(128),
  device_id VARCHAR(160), agent_name VARCHAR(160), agent_version VARCHAR(64),
  correlation_id VARCHAR(200), causation_id VARCHAR(200),
  schema_version INTEGER NOT NULL DEFAULT 1,
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledgement_id VARCHAR(200) NOT NULL,
  PRIMARY KEY(event_id,sn)
);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_sn_time ON canonical_sn_trace_events(sn,occurred_at,event_id);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_root_time ON canonical_sn_trace_events(root_sn,occurred_at,event_id);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_station_time ON canonical_sn_trace_events(station_code,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_correlation ON canonical_sn_trace_events(correlation_id);
