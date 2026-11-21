-- Line manager requests a staffing position; HR owns review, proposal and hiring.
INSERT INTO permissions (code, name_zh, name_en, name_vi, category)
SELECT 'hr.hiring_request.create','提交岗位招聘需求','Create hiring request','Tạo yêu cầu tuyển dụng','hr'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='hr.hiring_request.create');
INSERT INTO permissions (code, name_zh, name_en, name_vi, category)
SELECT 'hr.hiring_request.sign','签署岗位招聘需求','Sign hiring request','Ký yêu cầu tuyển dụng','hr'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='hr.hiring_request.sign');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','line_leader','engineering_manager')
  AND p.code='hr.hiring_request.create'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','hr_manager','plant_manager','factory_manager')
  AND p.code='hr.hiring_request.sign'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);

CREATE TABLE IF NOT EXISTS hr_line_position_hiring_requests (
  id BIGSERIAL PRIMARY KEY,
  request_no TEXT NOT NULL UNIQUE DEFAULT ('LHR-' || to_char(NOW(),'YYYYMMDDHH24MISSMS')),
  requested_by BIGINT NOT NULL REFERENCES employees(id),
  line_id BIGINT NOT NULL REFERENCES production_lines(id),
  shift_code TEXT NOT NULL,
  position_code TEXT NOT NULL,
  position_name_zh TEXT NOT NULL,
  position_name_en TEXT NOT NULL,
  position_name_vi TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  required_date DATE NOT NULL,
  work_order_code TEXT,
  product_code TEXT,
  skill_requirements TEXT,
  certification_requirements TEXT,
  reason TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('DRAFT','SUBMITTED','HR_REVIEW','PROPOSAL','FILLED','REJECTED','CANCELLED')),
  hr_owner_id BIGINT REFERENCES employees(id),
  hr_comment TEXT,
  hr_manager_signed_by BIGINT REFERENCES employees(id),
  hr_manager_signed_at TIMESTAMPTZ,
  plant_manager_signed_by BIGINT REFERENCES employees(id),
  plant_manager_signed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_by BIGINT REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hr_line_position_hiring_requests ADD COLUMN IF NOT EXISTS hr_manager_signed_by BIGINT REFERENCES employees(id);
ALTER TABLE hr_line_position_hiring_requests ADD COLUMN IF NOT EXISTS hr_manager_signed_at TIMESTAMPTZ;
ALTER TABLE hr_line_position_hiring_requests ADD COLUMN IF NOT EXISTS plant_manager_signed_by BIGINT REFERENCES employees(id);
ALTER TABLE hr_line_position_hiring_requests ADD COLUMN IF NOT EXISTS plant_manager_signed_at TIMESTAMPTZ;
ALTER TABLE hr_line_position_hiring_requests ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE hr_line_position_hiring_requests ADD COLUMN IF NOT EXISTS published_by BIGINT REFERENCES employees(id);
CREATE INDEX IF NOT EXISTS idx_hr_hiring_request_status_date ON hr_line_position_hiring_requests(status, required_date);
CREATE INDEX IF NOT EXISTS idx_hr_hiring_request_line ON hr_line_position_hiring_requests(line_id, required_date);
