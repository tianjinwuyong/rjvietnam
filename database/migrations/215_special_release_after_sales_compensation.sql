BEGIN;

CREATE TABLE IF NOT EXISTS special_release_followups (
  followup_id BIGSERIAL PRIMARY KEY,
  trace_id BIGINT NOT NULL REFERENCES special_release_commercial_trace(trace_id),
  case_no VARCHAR(64) NOT NULL UNIQUE,
  issue_summary TEXT NOT NULL,
  owner_user_id BIGINT REFERENCES users(id),
  owner_name VARCHAR(160) NOT NULL,
  customer_contact_note TEXT,
  promised_action TEXT,
  promised_at TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','INVESTIGATING','CUSTOMER_CONTACTED','ACTION_PENDING','COMPENSATION_PENDING','RESOLVED','CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS special_release_compensations (
  compensation_id BIGSERIAL PRIMARY KEY,
  followup_id BIGINT NOT NULL REFERENCES special_release_followups(followup_id),
  compensation_type VARCHAR(32) NOT NULL
    CHECK (compensation_type IN ('DISCOUNT','CREDIT_NOTE','REFUND','REPLACEMENT','REPAIR','EXTENDED_WARRANTY','OTHER')),
  amount NUMERIC(18,4),
  currency VARCHAR(12),
  description TEXT NOT NULL,
  approval_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING','APPROVED','REJECTED','EXECUTED','CANCELLED')),
  approved_by BIGINT REFERENCES users(id),
  approved_by_name VARCHAR(160),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  finance_reference VARCHAR(120),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_special_release_followups_trace ON special_release_followups(trace_id,status);
CREATE INDEX IF NOT EXISTS idx_special_release_comp_followup ON special_release_compensations(followup_id,approval_status);

COMMIT;
