BEGIN;

CREATE TABLE IF NOT EXISTS hr_team_assignments(
  id BIGSERIAL PRIMARY KEY,leader_id BIGINT NOT NULL,employee_id BIGINT NOT NULL,
  assigned_by BIGINT,assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(leader_id,employee_id)
);

ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS leave_type VARCHAR(40);
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS days_count NUMERIC(6,2);
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS group_leader_id BIGINT;
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS group_leader_result VARCHAR(20);
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS group_leader_reason TEXT;
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS group_leader_at TIMESTAMPTZ;
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS hr_id BIGINT;
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS hr_result VARCHAR(20);
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS hr_reason TEXT;
ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS hr_at TIMESTAMPTZ;
ALTER TABLE hr_leave_requests ALTER COLUMN leave_type_id DROP NOT NULL;
ALTER TABLE hr_leave_requests DROP CONSTRAINT IF EXISTS hr_leave_requests_status_check;

CREATE TABLE IF NOT EXISTS hr_leave_attachments(
  id BIGSERIAL PRIMARY KEY,leave_id BIGINT NOT NULL REFERENCES hr_leave_requests(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,file_name TEXT,file_type TEXT,uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hr_leave_types ADD COLUMN IF NOT EXISTS requires_attachment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hr_leave_types ADD COLUMN IF NOT EXISTS color VARCHAR(20) NOT NULL DEFAULT '#6366f1';

-- Q11: 添加报休请假类型
INSERT INTO hr_leave_types (code, name_zh, name_en, name_vi, requires_attachment, color, sort_order)
SELECT 'report', '报休（事后补）', 'Report Leave', 'Nghỉ báo trước', FALSE, '#f59e0b', 4
WHERE NOT EXISTS (SELECT 1 FROM hr_leave_types WHERE code = 'report');


CREATE TABLE IF NOT EXISTS hr_shift_adjustments(
  id BIGSERIAL PRIMARY KEY,employee_id BIGINT NOT NULL,shift_id BIGINT NOT NULL,
  reason TEXT,start_date DATE NOT NULL,end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  reviewed_by BIGINT,reviewed_at TIMESTAMPTZ,review_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_notifications(
  id BIGSERIAL PRIMARY KEY,recipient_id BIGINT NOT NULL,type VARCHAR(40) NOT NULL,
  title_zh TEXT NOT NULL,body_zh TEXT,title_vi TEXT,body_vi TEXT,data_json JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_leader ON hr_team_assignments(leader_id);
CREATE INDEX IF NOT EXISTS idx_team_leave_status ON hr_leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON hr_notifications(recipient_id,is_read);
CREATE INDEX IF NOT EXISTS idx_shift_adjust_emp ON hr_shift_adjustments(employee_id);

ALTER TABLE hr_leave_requests DROP CONSTRAINT IF EXISTS hr_leave_requests_status_check;
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_requests_status_check CHECK(status IN(
  'draft','pending','pending_group_leader','pending_hr','approved','rejected','cancelled'
));

INSERT INTO _migrations(filename,hash)VALUES('185_team_leader_app.sql','team-leader-postgresql-v2')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
