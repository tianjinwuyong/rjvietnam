-- NPM -> MES material-consumption observation.
-- Raw machine events are immutable and idempotent; binding totals are projections.

ALTER TABLE feeder_binding_events
  ADD COLUMN IF NOT EXISTS consumed_qty bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS placed_qty bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_qty bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_npm_at timestamptz;

CREATE TABLE IF NOT EXISTS npm_material_consumption_events (
  id bigserial PRIMARY KEY,
  source_event_id varchar(128) NOT NULL UNIQUE,
  source_system varchar(32) NOT NULL DEFAULT 'NPM',
  work_order_code varchar(32) NOT NULL,
  machine_code varchar(64) NOT NULL,
  slot_no varchar(32) NOT NULL,
  feeder_code varchar(64) NOT NULL,
  material_sn varchar(128) NOT NULL,
  pickup_qty integer NOT NULL CHECK (pickup_qty >= 0),
  placed_qty integer NOT NULL CHECK (placed_qty >= 0),
  rejected_qty integer NOT NULL CHECK (rejected_qty >= 0),
  source_occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  binding_id bigint REFERENCES feeder_binding_events(id),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status varchar(24) NOT NULL DEFAULT 'MATCHED',
  reconciliation_message text
);

CREATE INDEX IF NOT EXISTS idx_npm_consumption_binding_time
  ON npm_material_consumption_events(binding_id, source_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_npm_consumption_machine_time
  ON npm_material_consumption_events(machine_code, source_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_npm_consumption_material_sn
  ON npm_material_consumption_events(material_sn, source_occurred_at DESC);

