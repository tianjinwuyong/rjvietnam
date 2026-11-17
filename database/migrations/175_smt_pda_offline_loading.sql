CREATE TABLE IF NOT EXISTS smt_pda_offline_leases (
  lease_id UUID PRIMARY KEY,
  line_code VARCHAR(32) NOT NULL,
  machine_code VARCHAR(64) NOT NULL,
  work_order_code VARCHAR(32) NOT NULL,
  device_id VARCHAR(160) NOT NULL,
  operator_badge VARCHAR(80) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  CHECK (status IN ('ACTIVE','EXPIRED','RELEASED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_smt_pda_offline_machine_active
  ON smt_pda_offline_leases(machine_code)
  WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS smt_pda_offline_events (
  event_id UUID PRIMARY KEY,
  lease_id UUID NOT NULL REFERENCES smt_pda_offline_leases(lease_id),
  sequence_no BIGINT NOT NULL,
  previous_hash VARCHAR(64),
  record_hash VARCHAR(64) NOT NULL,
  work_order_code VARCHAR(32) NOT NULL,
  line_code VARCHAR(32) NOT NULL,
  machine_code VARCHAR(64) NOT NULL,
  slot_no VARCHAR(64) NOT NULL,
  feeder_code VARCHAR(120) NOT NULL,
  raw_material_scan VARCHAR(240) NOT NULL,
  material_code VARCHAR(120) NOT NULL,
  lot_no VARCHAR(160) NOT NULL,
  qty NUMERIC(18,6) NOT NULL,
  operator_badge VARCHAR(80) NOT NULL,
  device_id VARCHAR(160) NOT NULL,
  app_version VARCHAR(32) NOT NULL,
  rule_version VARCHAR(64) NOT NULL,
  cache_version VARCHAR(64) NOT NULL,
  source_occurred_at TIMESTAMPTZ NOT NULL,
  disconnected_at TIMESTAMPTZ NOT NULL,
  local_checks JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_status VARCHAR(32) NOT NULL,
  review_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  leader_deadline_at TIMESTAMPTZ,
  leader_decision VARCHAR(16),
  leader_badge VARCHAR(80),
  leader_decided_at TIMESTAMPTZ,
  leader_comment TEXT,
  UNIQUE(lease_id, sequence_no),
  CHECK (review_status IN ('COMPLIANT','VIOLATION','PENDING')),
  CHECK (leader_decision IS NULL OR leader_decision IN ('CONTINUE','STOP'))
);

CREATE INDEX IF NOT EXISTS idx_smt_pda_offline_review
  ON smt_pda_offline_events(review_status, leader_deadline_at);
CREATE INDEX IF NOT EXISTS idx_smt_pda_offline_time
  ON smt_pda_offline_events(source_occurred_at, sequence_no);
