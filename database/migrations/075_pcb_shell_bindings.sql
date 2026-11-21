-- Migration: 075_pcb_shell_bindings
-- Purpose: PCBA-to-Shell SN binding table for downstream NG propagation
-- When PCBA fails at any station after SHELL-BIND-01, the NG is propagated to the Shell SN
-- so the entire shell (containing the bad PCBA) is flagged.

BEGIN;

CREATE TABLE IF NOT EXISTS pcb_shell_bindings (
  id              BIGSERIAL PRIMARY KEY,
  pcb_sn         VARCHAR(64)  NOT NULL,
  shell_sn       VARCHAR(64)  NOT NULL UNIQUE,
  operator       VARCHAR(64)  DEFAULT 'system',
  station_code   VARCHAR(32)  NOT NULL DEFAULT 'SHELL-BIND-01',
  line_name      VARCHAR(32)  DEFAULT 'L004',
  bound_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  synced         BOOLEAN      NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pcb_shell_bindings IS 'PCBA SN → Shell SN binding for NG traceability';
COMMENT ON COLUMN pcb_shell_bindings.pcb_sn    IS 'PCBA circuit board serial number';
COMMENT ON COLUMN pcb_shell_bindings.shell_sn  IS 'Outer shell/产品外壳 serial number';
COMMENT ON COLUMN pcb_shell_bindings.synced    IS 'Whether this record has been synced to daily CSV archive';

CREATE INDEX IF NOT EXISTS idx_psb_pcb_sn   ON pcb_shell_bindings(pcb_sn);
CREATE INDEX IF NOT EXISTS idx_psb_shell_sn  ON pcb_shell_bindings(shell_sn);
CREATE INDEX IF NOT EXISTS idx_psb_bound_at  ON pcb_shell_bindings(bound_at);

COMMIT;
