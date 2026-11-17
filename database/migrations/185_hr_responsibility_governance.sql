BEGIN;

CREATE TABLE IF NOT EXISTS hr_position_responsibility_versions(
  id BIGSERIAL PRIMARY KEY,
  position_id BIGINT NOT NULL REFERENCES positions(id),
  version_no INTEGER NOT NULL,
  title_zh VARCHAR(160) NOT NULL,title_en VARCHAR(160),title_vi VARCHAR(160),
  purpose TEXT NOT NULL,responsibilities JSONB NOT NULL DEFAULT '[]',
  authority_limits JSONB NOT NULL DEFAULT '[]',kpi_rules JSONB NOT NULL DEFAULT '[]',
  safety_duties JSONB NOT NULL DEFAULT '[]',qualification_rules JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','RETIRED')),
  effective_from DATE,effective_to DATE,approved_by BIGINT REFERENCES employees(id),
  approved_at TIMESTAMPTZ,created_by BIGINT REFERENCES employees(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(position_id,version_no)
);

CREATE TABLE IF NOT EXISTS hr_responsibility_acknowledgements(
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  responsibility_version_id BIGINT NOT NULL REFERENCES hr_position_responsibility_versions(id),
  acknowledgement_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(acknowledgement_status IN('PENDING','ACKNOWLEDGED','REFUSED')),
  acknowledged_at TIMESTAMPTZ,employee_comment TEXT,signature_method VARCHAR(24),
  UNIQUE(employee_id,responsibility_version_id)
);

CREATE TABLE IF NOT EXISTS hr_personnel_actions(
  id BIGSERIAL PRIMARY KEY,action_no VARCHAR(48) NOT NULL UNIQUE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  action_type VARCHAR(32) NOT NULL CHECK(action_type IN(
    'REWARD','WARNING','PERFORMANCE_IMPROVEMENT','PROMOTION','DEMOTION','SALARY_INCREASE',
    'SALARY_DECREASE','TRANSFER','OVERTIME','LEAVE','SUSPENSION','TERMINATION','RESIGNATION')),
  source_type VARCHAR(40),source_id BIGINT,reason_code VARCHAR(48) NOT NULL,reason_detail TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',old_value JSONB NOT NULL DEFAULT '{}',proposed_value JSONB NOT NULL DEFAULT '{}',
  risk_level VARCHAR(16) NOT NULL DEFAULT 'NORMAL' CHECK(risk_level IN('NORMAL','HIGH','CRITICAL')),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK(status IN(
    'DRAFT','PENDING_EMPLOYEE_ACK','PENDING_APPROVAL','APPROVED','REJECTED','APPEALED','EXECUTED','CANCELLED')),
  required_approvals JSONB NOT NULL DEFAULT '[]',requested_by BIGINT REFERENCES employees(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),effective_date DATE,executed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_personnel_action_approvals(
  id BIGSERIAL PRIMARY KEY,action_id BIGINT NOT NULL REFERENCES hr_personnel_actions(id) ON DELETE RESTRICT,
  approval_role VARCHAR(32) NOT NULL CHECK(approval_role IN('LINE_LEADER','DEPARTMENT_MANAGER','HR','FINANCE','GENERAL_MANAGER','LEGAL')),
  decision VARCHAR(16) NOT NULL CHECK(decision IN('APPROVE','REJECT')),actor_employee_id BIGINT REFERENCES employees(id),
  comment TEXT NOT NULL,decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(action_id,approval_role)
);

CREATE TABLE IF NOT EXISTS hr_personnel_action_appeals(
  id BIGSERIAL PRIMARY KEY,action_id BIGINT NOT NULL REFERENCES hr_personnel_actions(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id),reason TEXT NOT NULL,evidence JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','UPHELD','OVERTURNED','WITHDRAWN')),
  decided_by BIGINT REFERENCES employees(id),decision_comment TEXT,submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hr_personnel_action_audit(
  id BIGSERIAL PRIMARY KEY,action_id BIGINT REFERENCES hr_personnel_actions(id) ON DELETE RESTRICT,
  event_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,event_type VARCHAR(48) NOT NULL,actor VARCHAR(80) NOT NULL,
  old_state VARCHAR(24),new_state VARCHAR(24),detail JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_resp_position ON hr_position_responsibility_versions(position_id,status);
CREATE INDEX IF NOT EXISTS idx_hr_action_employee ON hr_personnel_actions(employee_id,status);
CREATE INDEX IF NOT EXISTS idx_hr_action_type ON hr_personnel_actions(action_type,status);
CREATE INDEX IF NOT EXISTS idx_hr_action_audit ON hr_personnel_action_audit(action_id,created_at);

INSERT INTO _migrations(filename,hash) VALUES('185_hr_responsibility_governance.sql','hr-responsibility-governance-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
