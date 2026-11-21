BEGIN;

ALTER TABLE smt_loading_sessions
  ADD COLUMN IF NOT EXISTS pcb_sn varchar(120),
  ADD COLUMN IF NOT EXISTS pcb_sn_binding_bypassed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pcb_sn_bypass_reason text,
  ADD COLUMN IF NOT EXISTS pcb_sn_bypass_authorized_by varchar(64);

CREATE INDEX IF NOT EXISTS idx_smt_loading_sessions_pcb_sn
  ON smt_loading_sessions(pcb_sn, started_at DESC)
  WHERE pcb_sn IS NOT NULL;

INSERT INTO _migrations(filename, hash)
VALUES ('209_smt_pcb_sn_loading_gate.sql', 'smt-pcb-sn-loading-gate-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
