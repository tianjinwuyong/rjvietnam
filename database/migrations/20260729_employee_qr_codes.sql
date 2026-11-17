ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS qr_code_hash text,
  ADD COLUMN IF NOT EXISTS qr_code_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS qr_code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS qr_image bytea;

CREATE TABLE IF NOT EXISTS employee_qr_code_audit (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action varchar(32) NOT NULL,
  qr_code_hash text,
  scanned_at timestamptz,
  scanner_device varchar(160),
  ip_address varchar(128),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_qr_audit_employee_created
  ON employee_qr_code_audit(employee_id, created_at DESC);
