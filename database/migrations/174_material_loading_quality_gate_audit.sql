BEGIN;

CREATE TABLE IF NOT EXISTS material_loading_gate_checks (
  id              bigserial PRIMARY KEY,
  work_order_code varchar(80) NOT NULL,
  line_code       varchar(80),
  machine_code    varchar(80) NOT NULL,
  slot_no         varchar(80) NOT NULL,
  feeder_code     varchar(80),
  lot_no          varchar(120) NOT NULL,
  material_code   varchar(120),
  operator_code   varchar(120),
  passed          boolean NOT NULL,
  checks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_loading_gate_lot_time
  ON material_loading_gate_checks(lot_no, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_loading_gate_wo_time
  ON material_loading_gate_checks(work_order_code, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_loading_gate_failed
  ON material_loading_gate_checks(checked_at DESC) WHERE passed = false;

INSERT INTO _migrations(filename, hash)
VALUES ('174_material_loading_quality_gate_audit.sql', 'material-loading-quality-gate-audit-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
