-- ICT NG reason ledger. Append-only facts; a later PASS never deletes these rows.
CREATE TABLE IF NOT EXISTS mes_ict_ng_reason_events (
  ict_ng_reason_id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(160) NOT NULL UNIQUE,
  source_event_id VARCHAR(160) NOT NULL UNIQUE,
  product_id VARCHAR(80) REFERENCES mes_product_units(product_id),
  work_order_code VARCHAR(160),
  line_code VARCHAR(64) NOT NULL DEFAULT 'MANUAL_LINE',
  station_code VARCHAR(64) NOT NULL DEFAULT 'manu_ict',
  agent_id VARCHAR(160) NOT NULL,
  host_ip VARCHAR(64) NOT NULL,
  panel_id VARCHAR(160) NOT NULL,
  slot INTEGER NOT NULL CHECK (slot > 0),
  sn VARCHAR(200) NOT NULL,
  test_cycle_no INTEGER NOT NULL CHECK (test_cycle_no > 0),
  test_item_code VARCHAR(160),
  test_item_name VARCHAR(300),
  reason_code VARCHAR(160) NOT NULL,
  reason_text TEXT,
  measured_value TEXT,
  lower_limit TEXT,
  upper_limit TEXT,
  unit VARCHAR(80),
  equipment_code VARCHAR(160),
  equipment_message TEXT,
  result VARCHAR(16) NOT NULL CHECK (result IN ('FAIL','ERROR','ABORT','TIMEOUT')),
  is_confirmed_ng BOOLEAN NOT NULL DEFAULT FALSE,
  retest_remaining INTEGER CHECK (retest_remaining IS NULL OR retest_remaining >= 0),
  route_revision VARCHAR(80),
  raw_file_name TEXT,
  raw_file_hash VARCHAR(128),
  raw_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_offline BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (upper(sn) = sn)
);

CREATE INDEX IF NOT EXISTS idx_mes_ict_ng_reason_sn_time
  ON mes_ict_ng_reason_events(sn, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_ict_ng_reason_panel_slot_cycle
  ON mes_ict_ng_reason_events(panel_id, slot, test_cycle_no, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_ict_ng_reason_item_time
  ON mes_ict_ng_reason_events(test_item_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_ict_ng_reason_product_time
  ON mes_ict_ng_reason_events(product_id, occurred_at DESC)
  WHERE product_id IS NOT NULL;

-- Immutable audit history: facts may be appended, never edited or removed.
CREATE OR REPLACE FUNCTION protect_mes_ict_ng_reason_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ICT NG reason history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_mes_ict_ng_reason_update ON mes_ict_ng_reason_events;
CREATE TRIGGER trg_protect_mes_ict_ng_reason_update
BEFORE UPDATE OR DELETE ON mes_ict_ng_reason_events
FOR EACH ROW EXECUTE FUNCTION protect_mes_ict_ng_reason_history();

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) PRIMARY KEY,
  checksum VARCHAR(120),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations(filename, checksum)
VALUES ('219_mes_ict_ng_reason_details.sql', 'mes-ict-ng-reason-details-v1')
ON CONFLICT (filename) DO NOTHING;
