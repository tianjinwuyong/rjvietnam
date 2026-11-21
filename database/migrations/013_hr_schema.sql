-- ============================================================
-- HR & Organization Structure
-- Additive migration: extends departments/positions from 004_enterprise_support_schema.sql
-- ============================================================

-- Add columns that 013 needs but 004 doesn't provide
ALTER TABLE departments ADD COLUMN IF NOT EXISTS dept_type varchar(30) NOT NULL DEFAULT 'general';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS headcount_target int DEFAULT 0;

ALTER TABLE positions ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS is_shift_leader boolean NOT NULL DEFAULT false;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ============================================================
-- Employees (004 already creates this table; 013 adds extra columns)
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS code varchar(30) NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS display_name varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS name_zh varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS name_en varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS name_vi varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender varchar(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone varchar(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_card_no varchar(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address varchar(200);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reports_to_id bigint;

-- 004's employees table doesn't have manager_emp_id yet; add it
-- Note: FK constraint to employees(id) is deferred to end-of-migration
-- because employees is created by 004 AFTER departments, and 013 runs after 004.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS manager_emp_id bigint;

-- ============================================================
-- Employee Work History
-- ============================================================

CREATE TABLE employee_work_history (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type        varchar(30) NOT NULL,
  from_department_id bigint REFERENCES departments(id),
  to_department_id  bigint REFERENCES departments(id),
  from_position_id  bigint REFERENCES positions(id),
  to_position_id    bigint REFERENCES positions(id),
  effective_date    date NOT NULL,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Leave Requests (004 creates base table; 013 adds extra columns)
-- ============================================================
-- 004's leave_requests has: id, leave_no, employee_id, leave_type, start_date,
-- end_date, reason, status, approver_user_id, approved_at, created_at, updated_at
-- 013 adds: approved_by (employee who approved — FK to employees)
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by bigint;

-- ============================================================
-- Attendance Records (PG12: use table inheritance for yearly partitions)
-- ============================================================

CREATE TABLE attendance_records (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES employees(id),
  date            date NOT NULL,
  clock_in        time,
  clock_out       time,
  status          varchar(20) NOT NULL DEFAULT 'normal',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance_records_2026 ( CHECK (date >= '2026-01-01' AND date < '2027-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2027 ( CHECK (date >= '2027-01-01' AND date < '2028-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2028 ( CHECK (date >= '2028-01-01' AND date < '2029-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2029 ( CHECK (date >= '2029-01-01' AND date < '2030-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2030 ( CHECK (date >= '2030-01-01' AND date < '2031-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2031 ( CHECK (date >= '2031-01-01' AND date < '2032-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2032 ( CHECK (date >= '2032-01-01' AND date < '2033-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2033 ( CHECK (date >= '2033-01-01' AND date < '2034-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2034 ( CHECK (date >= '2034-01-01' AND date < '2035-01-01') ) INHERITS (attendance_records);
CREATE TABLE attendance_records_2035 ( CHECK (date >= '2035-01-01' AND date < '2036-01-01') ) INHERITS (attendance_records);

-- ============================================================
-- Indexes (use IF NOT EXISTS since 004 may have already created some)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employees_reports_to ON employees(reports_to_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_work_history_employee ON employee_work_history(employee_id);

CREATE INDEX idx_att2026_date ON attendance_records_2026(date);
CREATE INDEX idx_att2027_date ON attendance_records_2027(date);
CREATE INDEX idx_att2028_date ON attendance_records_2028(date);
CREATE INDEX idx_att2029_date ON attendance_records_2029(date);
CREATE INDEX idx_att2030_date ON attendance_records_2030(date);
CREATE INDEX idx_att2031_date ON attendance_records_2031(date);
CREATE INDEX idx_att2032_date ON attendance_records_2032(date);
CREATE INDEX idx_att2033_date ON attendance_records_2033(date);
CREATE INDEX idx_att2034_date ON attendance_records_2034(date);
CREATE INDEX idx_att2035_date ON attendance_records_2035(date);

-- ============================================================
-- FK Constraints (deferred to end so all referenced tables exist)
-- employees table is created by 004; reports_to_id and manager_emp_id are added by 013
-- ============================================================
ALTER TABLE employees ADD CONSTRAINT fk_employees_reports_to
  FOREIGN KEY (reports_to_id) REFERENCES employees(id);
ALTER TABLE departments ADD CONSTRAINT fk_departments_manager
  FOREIGN KEY (manager_emp_id) REFERENCES employees(id);
ALTER TABLE leave_requests ADD CONSTRAINT fk_leave_requests_approved_by
  FOREIGN KEY (approved_by) REFERENCES employees(id);
