-- Confidential employee grievance and HR investigation workflow.
INSERT INTO permissions(code,name_zh,name_en,name_vi,category)
SELECT 'hr.grievance.submit','提交员工申诉','Submit employee grievance','Gửi khiếu nại nhân viên','hr'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='hr.grievance.submit');
INSERT INTO permissions(code,name_zh,name_en,name_vi,category)
SELECT 'hr.grievance.investigate','调查员工申诉','Investigate employee grievance','Điều tra khiếu nại nhân viên','hr'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='hr.grievance.investigate');
INSERT INTO permissions(code,name_zh,name_en,name_vi,category)
SELECT 'hr.grievance.respond','回复调查说明','Respond to grievance investigation','Trả lời điều tra khiếu nại','hr'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='hr.grievance.respond');
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('employee','operator') AND p.code='hr.grievance.submit'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','hr_manager','hr') AND p.code='hr.grievance.investigate'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','line_leader','engineering_manager','plant_manager') AND p.code='hr.grievance.respond'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);

CREATE TABLE IF NOT EXISTS hr_employee_grievance_cases (
  id BIGSERIAL PRIMARY KEY,
  case_no TEXT NOT NULL UNIQUE DEFAULT ('GRV-' || to_char(NOW(),'YYYYMMDDHH24MISSMS')),
  reporter_employee_id BIGINT REFERENCES employees(id),
  subject_employee_id BIGINT NOT NULL REFERENCES employees(id),
  line_id BIGINT REFERENCES production_lines(id),
  complaint_text TEXT NOT NULL,
  allegation_category TEXT NOT NULL,
  evidence_reference TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','INVESTIGATING','AWAITING_MANAGER_EXPLANATION','HR_REVIEW','RESOLVED','CLOSED','UNSUBSTANTIATED')),
  response_due_at TIMESTAMPTZ NOT NULL,
  manager_explanation TEXT,
  manager_responded_by BIGINT REFERENCES employees(id),
  manager_responded_at TIMESTAMPTZ,
  hr_finding TEXT,
  hr_action TEXT,
  investigated_by BIGINT REFERENCES employees(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_grievance_subject_status ON hr_employee_grievance_cases(subject_employee_id,status);
CREATE INDEX IF NOT EXISTS idx_hr_grievance_hr_queue ON hr_employee_grievance_cases(status,response_due_at);
