-- MES-owned exact material placement assignments.
-- A material may only be loaded when this complete tuple is registered.
BEGIN;

CREATE TABLE IF NOT EXISTS mes_material_feeder_assignments (
  id BIGSERIAL PRIMARY KEY,
  line_code VARCHAR(20) NOT NULL,
  machine_code VARCHAR(50) NOT NULL,
  channel_code VARCHAR(50) NOT NULL,
  slot_no VARCHAR(20) NOT NULL,
  feeder_code VARCHAR(50) NOT NULL,
  material_code VARCHAR(50) NOT NULL,
  work_order_code VARCHAR(50),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mes_material_feeder_assignment_status_ck CHECK (status IN ('active','disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_material_feeder_assignment_active
  ON mes_material_feeder_assignments(line_code, machine_code, channel_code, slot_no, feeder_code, material_code)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_mes_material_feeder_assignment_lookup
  ON mes_material_feeder_assignments(work_order_code, line_code, machine_code, channel_code, slot_no, feeder_code, material_code)
  WHERE status = 'active';

INSERT INTO _migrations (filename, hash)
VALUES ('224_mes_material_feeder_assignments.sql', 'mes-exact-material-feeder-assignment-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
