BEGIN;

CREATE TABLE IF NOT EXISTS hr_face_profiles(
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL UNIQUE REFERENCES employees(id),
  hr_photo_url TEXT,hr_photo_emb BYTEA,self_photo_url TEXT,self_photo_emb BYTEA,
  reg_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(reg_status IN('pending','active','suspended')),
  reg_at TIMESTAMPTZ,verified_at TIMESTAMPTZ,verified_by BIGINT REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_mobile_checkin(
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  checkin_type VARCHAR(20) NOT NULL CHECK(checkin_type IN('in','out','arrive_post','leave_post')),
  location_type VARCHAR(20) NOT NULL DEFAULT 'mobile' CHECK(location_type IN('gate','workstation','mobile')),
  checkin_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  face_score NUMERIC(6,5),face_photo_url TEXT,
  face_result VARCHAR(16) CHECK(face_result IN('pass','fail','pending')),
  gps_lat NUMERIC(10,7),gps_lng NUMERIC(10,7),gps_accuracy NUMERIC(10,2),
  device_info TEXT,fail_reason TEXT,retry_count INTEGER NOT NULL DEFAULT 0,
  hr_confirmed BOOLEAN NOT NULL DEFAULT FALSE,confirmed_by BIGINT REFERENCES employees(id),
  confirmed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkin_emp_time ON hr_mobile_checkin(employee_id,checkin_time);
CREATE INDEX IF NOT EXISTS idx_checkin_time ON hr_mobile_checkin(checkin_time);
CREATE INDEX IF NOT EXISTS idx_face_emp ON hr_face_profiles(employee_id);

CREATE OR REPLACE VIEW v_hr_today_checkin AS
SELECT e.id employee_id,e.code employee_no,e.name_zh,d.name_zh dept_name,
  c.checkin_type,c.checkin_time,c.face_result,c.location_type,c.checkin_time::date checkin_date
FROM hr_mobile_checkin c JOIN employees e ON e.id=c.employee_id
LEFT JOIN departments d ON d.id=e.department_id
WHERE c.checkin_time::date=CURRENT_DATE;

INSERT INTO _migrations(filename,hash) VALUES('184_hr_mobile_checkin.sql','hr-mobile-checkin-postgresql-v2')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
