-- Unified MES operating model: route operations, quality gates, WIP and an
-- idempotent event ledger. Existing SMT-specific tables remain authoritative.
CREATE TABLE IF NOT EXISTS mes_operating_work_order_operations (
  id BIGSERIAL PRIMARY KEY,
  work_order_code VARCHAR(160) NOT NULL,
  operation_code VARCHAR(120) NOT NULL,
  operation_name VARCHAR(200) NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  station_code VARCHAR(64),
  state VARCHAR(24) NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','READY','IN_PROGRESS','HOLD','COMPLETED','REJECTED','CANCELLED')),
  planned_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  input_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  pass_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  ng_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  sla_due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(work_order_code, operation_code, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_mes_operating_ops_queue ON mes_operating_work_order_operations(state, sla_due_at, sequence_no);

CREATE TABLE IF NOT EXISTS mes_operating_quality_gates (
  id BIGSERIAL PRIMARY KEY,
  gate_key VARCHAR(200) NOT NULL UNIQUE,
  entity_type VARCHAR(64) NOT NULL,
  entity_key VARCHAR(200) NOT NULL,
  gate_type VARCHAR(64) NOT NULL,
  decision VARCHAR(24) NOT NULL CHECK (decision IN ('PENDING','PASS','HOLD','FAIL','REWORK','SCRAP')),
  reason_code VARCHAR(80),
  decided_by VARCHAR(120),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mes_operating_quality_gates_pending ON mes_operating_quality_gates(decision, created_at DESC);

CREATE TABLE IF NOT EXISTS mes_operating_event_ledger (
  event_id VARCHAR(200) PRIMARY KEY,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_key VARCHAR(200) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  source_system VARCHAR(64) NOT NULL DEFAULT 'SMT_MES',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mes_operating_events_aggregate ON mes_operating_event_ledger(aggregate_type, aggregate_key, occurred_at DESC);

CREATE OR REPLACE VIEW mes_operating_wip_queue AS
SELECT station_code,
       state,
       COUNT(*)::INTEGER AS operation_count,
       COALESCE(SUM(input_qty - pass_qty - ng_qty), 0) AS open_qty,
       MIN(sla_due_at) AS nearest_sla_due_at,
       COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND sla_due_at < NOW() AND state NOT IN ('COMPLETED','CANCELLED'))::INTEGER AS overdue_count
FROM mes_operating_work_order_operations
WHERE state NOT IN ('COMPLETED','CANCELLED')
GROUP BY station_code, state;
