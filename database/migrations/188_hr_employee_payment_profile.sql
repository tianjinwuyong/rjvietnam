BEGIN;

CREATE TABLE IF NOT EXISTS hr_employee_payment_profiles (
  employee_id BIGINT PRIMARY KEY REFERENCES employees(id) ON DELETE RESTRICT,
  preferred_method VARCHAR(16) NOT NULL DEFAULT 'CASH' CHECK(preferred_method IN('BANK','CASH')),
  bank_name VARCHAR(120),
  bank_account_token VARCHAR(180),
  bank_account_last4 VARCHAR(4),
  account_holder_name VARCHAR(160),
  verified_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(verified_status IN('PENDING','VERIFIED','REJECTED','SUSPENDED')),
  verified_by VARCHAR(80),
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(preferred_method='CASH' OR bank_account_token IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS hr_payroll_source_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES hr_payroll_batches(id) ON DELETE RESTRICT,
  check_type VARCHAR(40) NOT NULL,
  result VARCHAR(16) NOT NULL CHECK(result IN('PASS','WARNING','FAIL')),
  expected_value JSONB NOT NULL DEFAULT '{}',
  actual_value JSONB NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id,check_type)
);

CREATE INDEX IF NOT EXISTS idx_payroll_reconciliation
  ON hr_payroll_source_reconciliations(batch_id,result);

INSERT INTO _migrations(filename,hash)
VALUES('188_hr_employee_payment_profile.sql','hr-employee-payment-profile-v1')
ON CONFLICT(filename) DO NOTHING;

COMMIT;
