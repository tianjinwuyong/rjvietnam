BEGIN;

CREATE TABLE IF NOT EXISTS hr_employee_compensation_terms (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  action_id BIGINT NOT NULL UNIQUE REFERENCES hr_personnel_actions(id) ON DELETE RESTRICT,
  base_salary NUMERIC(14,2) NOT NULL CHECK(base_salary >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'VND',
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','RETIRED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_personnel_action_effects (
  id BIGSERIAL PRIMARY KEY,
  action_id BIGINT NOT NULL REFERENCES hr_personnel_actions(id) ON DELETE RESTRICT,
  effect_type VARCHAR(40) NOT NULL,
  target_table VARCHAR(80),
  target_id BIGINT,
  before_value JSONB NOT NULL DEFAULT '{}',
  after_value JSONB NOT NULL DEFAULT '{}',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(action_id,effect_type)
);

CREATE TABLE IF NOT EXISTS hr_personnel_action_employee_ack (
  id BIGSERIAL PRIMARY KEY,
  action_id BIGINT NOT NULL UNIQUE REFERENCES hr_personnel_actions(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  decision VARCHAR(20) NOT NULL CHECK(decision IN('ACKNOWLEDGED','REFUSED_TO_SIGN')),
  employee_comment TEXT,
  signature_method VARCHAR(24) NOT NULL DEFAULT 'EMPLOYEE_BADGE',
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_compensation_employee
  ON hr_employee_compensation_terms(employee_id,status,effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_hr_action_effects_action
  ON hr_personnel_action_effects(action_id,applied_at);

INSERT INTO _migrations(filename,hash)
VALUES('186_hr_personnel_action_effects.sql','hr-personnel-action-effects-v1')
ON CONFLICT(filename) DO NOTHING;

COMMIT;
