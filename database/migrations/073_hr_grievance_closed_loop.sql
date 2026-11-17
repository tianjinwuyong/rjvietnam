-- Closed loop: HR conclusion -> employee acknowledgement or appeal.
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS employee_ack_decision TEXT CHECK (employee_ack_decision IN ('ACKNOWLEDGED','APPEALED'));
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS employee_ack_at TIMESTAMPTZ;
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS employee_appeal_text TEXT;
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS employee_appealed_at TIMESTAMPTZ;
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS outcome_sent_at TIMESTAMPTZ;
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS hr_closed_by BIGINT REFERENCES employees(id);
ALTER TABLE hr_employee_grievance_cases ADD COLUMN IF NOT EXISTS hr_closed_at TIMESTAMPTZ;
