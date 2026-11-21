BEGIN;

CREATE TABLE IF NOT EXISTS smt_loading_department_approvals (
  id              bigserial PRIMARY KEY,
  session_id      bigint NOT NULL REFERENCES smt_loading_sessions(id) ON DELETE CASCADE,
  approval_code   varchar(40) NOT NULL,
  decision        varchar(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  approver        varchar(120),
  reason          text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, approval_code)
);

CREATE INDEX IF NOT EXISTS idx_smt_loading_department_approvals_session
  ON smt_loading_department_approvals(session_id, decision);

INSERT INTO _migrations(filename, hash)
VALUES ('216_smt_loading_department_approvals.sql', 'manual-216-smt-loading-department-approvals')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
