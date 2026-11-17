BEGIN;

CREATE TABLE IF NOT EXISTS smt_loading_sessions (
  id                  bigserial PRIMARY KEY,
  work_order_code     varchar(50) NOT NULL,
  line_code           varchar(20) NOT NULL DEFAULT 'L001',
  station_code        varchar(64) NOT NULL DEFAULT 'smt_pda_loading',
  machine_code        varchar(50) NOT NULL,
  status              varchar(24) NOT NULL DEFAULT 'LOADING'
                      CHECK (status IN ('LOADING','READY','RELEASED','BLOCKED','CANCELLED')),
  operator_badge      varchar(64) NOT NULL,
  line_leader_badge   varchar(64),
  started_at          timestamptz NOT NULL DEFAULT now(),
  ready_at            timestamptz,
  released_at         timestamptz,
  blocked_reason      text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_smt_loading_active_wo_machine
  ON smt_loading_sessions(work_order_code, machine_code)
  WHERE status IN ('LOADING','READY','RELEASED');
CREATE INDEX IF NOT EXISTS idx_smt_loading_session_status
  ON smt_loading_sessions(line_code, status, started_at DESC);

CREATE TABLE IF NOT EXISTS smt_loading_audit (
  id              bigserial PRIMARY KEY,
  session_id      bigint REFERENCES smt_loading_sessions(id) ON DELETE CASCADE,
  event_type      varchar(64) NOT NULL,
  actor_badge     varchar(64),
  slot_no         varchar(20),
  feeder_code     varchar(50),
  lot_no          varchar(50),
  material_code   varchar(50),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smt_loading_audit_session
  ON smt_loading_audit(session_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS smt_loading_roll_changes (
  id                  bigserial PRIMARY KEY,
  session_id          bigint NOT NULL REFERENCES smt_loading_sessions(id) ON DELETE CASCADE,
  machine_code        varchar(50) NOT NULL,
  slot_no             varchar(20) NOT NULL,
  old_binding_id      bigint REFERENCES feeder_binding_events(id),
  old_lot_no          varchar(50) NOT NULL,
  old_remaining_qty   numeric(18,4) NOT NULL DEFAULT 0,
  new_binding_id      bigint REFERENCES feeder_binding_events(id),
  new_lot_no          varchar(50) NOT NULL,
  new_material_code   varchar(50) NOT NULL,
  operator_badge      varchar(64) NOT NULL,
  changed_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO _migrations(filename, hash)
VALUES ('164_smt_pda_material_loading.sql', 'smt-pda-loading-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
