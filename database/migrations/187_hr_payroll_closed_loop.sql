BEGIN;

CREATE TABLE IF NOT EXISTS hr_payroll_batches (
  id BIGSERIAL PRIMARY KEY,
  batch_no VARCHAR(48) NOT NULL UNIQUE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  currency VARCHAR(10) NOT NULL DEFAULT 'VND',
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK(status IN(
    'DRAFT','CALCULATED','HR_APPROVED','FINANCE_APPROVED','PAYING','PARTIALLY_PAID','PAID','LOCKED','CANCELLED'
  )),
  employee_count INTEGER NOT NULL DEFAULT 0,
  total_gross NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(18,2) NOT NULL DEFAULT 0,
  source_cutoff_at TIMESTAMPTZ,
  calculated_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  created_by VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year,month)
);

CREATE TABLE IF NOT EXISTS hr_payroll_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES hr_payroll_batches(id) ON DELETE RESTRICT,
  salary_record_id BIGINT NOT NULL REFERENCES salary_records(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  base_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  attendance_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  overtime_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
  bonuses NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  insurance NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(16) NOT NULL DEFAULT 'BANK' CHECK(payment_method IN('BANK','CASH')),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN('UNPAID','PROCESSING','PAID','FAILED','RETURNED','CANCELLED')),
  calculation_snapshot JSONB NOT NULL,
  paid_at TIMESTAMPTZ,
  UNIQUE(batch_id,employee_id),
  UNIQUE(batch_id,salary_record_id)
);

CREATE TABLE IF NOT EXISTS hr_payroll_approvals (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES hr_payroll_batches(id) ON DELETE RESTRICT,
  approval_role VARCHAR(20) NOT NULL CHECK(approval_role IN('HR','FINANCE')),
  decision VARCHAR(16) NOT NULL CHECK(decision IN('APPROVE','REJECT')),
  actor VARCHAR(80) NOT NULL,
  comment TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id,approval_role)
);

CREATE TABLE IF NOT EXISTS hr_payroll_payments (
  id BIGSERIAL PRIMARY KEY,
  payment_no VARCHAR(48) NOT NULL UNIQUE,
  batch_id BIGINT NOT NULL REFERENCES hr_payroll_batches(id) ON DELETE RESTRICT,
  payroll_item_id BIGINT NOT NULL REFERENCES hr_payroll_items(id) ON DELETE RESTRICT,
  payment_method VARCHAR(16) NOT NULL CHECK(payment_method IN('BANK','CASH')),
  amount NUMERIC(14,2) NOT NULL CHECK(amount >= 0),
  bank_reference VARCHAR(100),
  status VARCHAR(20) NOT NULL CHECK(status IN('PROCESSING','PAID','FAILED','RETURNED','CANCELLED')),
  failure_reason TEXT,
  paid_by VARCHAR(80),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_payroll_cash_receipts (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL UNIQUE REFERENCES hr_payroll_payments(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  received_amount NUMERIC(14,2) NOT NULL,
  receiver_badge VARCHAR(48) NOT NULL,
  signature_method VARCHAR(24) NOT NULL DEFAULT 'EMPLOYEE_BADGE',
  witness_badge VARCHAR(48),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_payroll_accounting_exports (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL UNIQUE REFERENCES hr_payroll_batches(id) ON DELETE RESTRICT,
  export_no VARCHAR(48) NOT NULL UNIQUE,
  payroll_expense NUMERIC(18,2) NOT NULL,
  employee_payable NUMERIC(18,2) NOT NULL,
  tax_payable NUMERIC(18,2) NOT NULL,
  insurance_payable NUMERIC(18,2) NOT NULL,
  journal_entry_id BIGINT REFERENCES gl_journal_entries(id),
  status VARCHAR(20) NOT NULL DEFAULT 'READY' CHECK(status IN('READY','POSTED','REVERSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hr_payroll_audit (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES hr_payroll_batches(id) ON DELETE RESTRICT,
  event_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_type VARCHAR(40) NOT NULL,
  actor VARCHAR(80) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_batch_period ON hr_payroll_batches(year,month,status);
CREATE INDEX IF NOT EXISTS idx_payroll_item_employee ON hr_payroll_items(employee_id,batch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_status ON hr_payroll_payments(batch_id,status);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_batch ON hr_payroll_audit(batch_id,created_at);

INSERT INTO _migrations(filename,hash)
VALUES('187_hr_payroll_closed_loop.sql','hr-payroll-closed-loop-v1')
ON CONFLICT(filename) DO NOTHING;

COMMIT;
