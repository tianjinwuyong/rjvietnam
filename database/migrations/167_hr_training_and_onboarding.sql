-- ============================================================
-- HR Training Plan & Employee Lifecycle (Onboarding/Offboarding)
-- Migration 167
-- ============================================================

CREATE TABLE hr_training_courses (
  id                bigserial PRIMARY KEY,
  code              varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  category          varchar(30) NOT NULL,
  trainer_name      varchar(80),
  duration_hours    numeric(5,2) NOT NULL DEFAULT 0,
  method            varchar(20) NOT NULL DEFAULT 'offline',
  description       text,
  status            varchar(20) NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_training_plans (
  id                bigserial PRIMARY KEY,
  plan_no           varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  plan_year         int NOT NULL,
  plan_month        int,
  department_id     bigint REFERENCES departments(id),
  course_id         bigint NOT NULL REFERENCES hr_training_courses(id),
  target_count      int NOT NULL DEFAULT 0,
  trainer_id        bigint REFERENCES employees(id),
  planned_hours     numeric(5,2) NOT NULL DEFAULT 0,
  actual_hours      numeric(5,2) NOT NULL DEFAULT 0,
  status            varchar(20) NOT NULL DEFAULT 'draft',
  created_by        bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_training_sessions (
  id                bigserial PRIMARY KEY,
  session_no        varchar(30) NOT NULL UNIQUE,
  plan_id           bigint NOT NULL REFERENCES hr_training_plans(id),
  course_id         bigint NOT NULL REFERENCES hr_training_courses(id),
  scheduled_date    date NOT NULL,
  start_time        time,
  end_time          time,
  location          varchar(120),
  method            varchar(20) NOT NULL DEFAULT 'offline',
  trainer_id        bigint REFERENCES employees(id),
  trainer_name      varchar(80),
  max_attendees     int NOT NULL DEFAULT 50,
  actual_attendees  int NOT NULL DEFAULT 0,
  status            varchar(20) NOT NULL DEFAULT 'scheduled',
  completion_date    date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_training_records (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  session_id        bigint REFERENCES hr_training_sessions(id),
  course_id         bigint NOT NULL REFERENCES hr_training_courses(id),
  plan_id           bigint REFERENCES hr_training_plans(id),
  enrolled_at       timestamptz NOT NULL DEFAULT now(),
  attended_at       timestamptz,
  assessment_score  numeric(5,2),
  rating            varchar(10),
  certificate_no    varchar(50),
  certificate_issued_at timestamptz,
  status            varchar(20) NOT NULL DEFAULT 'enrolled',
  remarks           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, session_id)
);

CREATE TABLE hr_onboarding_templates (
  id                bigserial PRIMARY KEY,
  code              varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  department_id     bigint REFERENCES departments(id),
  position_id       bigint REFERENCES positions(id),
  probation_months  int NOT NULL DEFAULT 3,
  status            varchar(20) NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_onboarding_template_tasks (
  id                bigserial PRIMARY KEY,
  template_id       bigint NOT NULL REFERENCES hr_onboarding_templates(id) ON DELETE CASCADE,
  task_name_zh      varchar(120) NOT NULL,
  task_name_en      varchar(120) NOT NULL,
  task_name_vi      varchar(120) NOT NULL,
  task_category     varchar(30) NOT NULL,
  assignee_role     varchar(30) NOT NULL,
  due_days          int NOT NULL DEFAULT 7,
  sort_order        int NOT NULL DEFAULT 0,
  is_mandatory      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_onboarding (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL UNIQUE REFERENCES employees(id),
  template_id       bigint REFERENCES hr_onboarding_templates(id),
  join_date         date NOT NULL,
  mentor_id         bigint REFERENCES employees(id),
  probation_end_date date,
  overall_status    varchar(20) NOT NULL DEFAULT 'pending',
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_onboarding_task_instances (
  id                bigserial PRIMARY KEY,
  onboarding_id     bigint NOT NULL REFERENCES hr_employee_onboarding(id) ON DELETE CASCADE,
  template_task_id  bigint REFERENCES hr_onboarding_template_tasks(id),
  task_name_zh      varchar(120) NOT NULL,
  task_category     varchar(30) NOT NULL,
  assignee_id       bigint REFERENCES employees(id),
  assignee_role     varchar(30) NOT NULL,
  due_date          date NOT NULL,
  completed_at      timestamptz,
  status            varchar(20) NOT NULL DEFAULT 'pending',
  remarks           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_offboarding_templates (
  id                bigserial PRIMARY KEY,
  code              varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  termination_type  varchar(20) NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_offboarding_template_tasks (
  id                bigserial PRIMARY KEY,
  template_id       bigint NOT NULL REFERENCES hr_offboarding_templates(id) ON DELETE CASCADE,
  task_name_zh      varchar(120) NOT NULL,
  task_name_en      varchar(120) NOT NULL,
  task_name_vi      varchar(120) NOT NULL,
  task_category     varchar(30) NOT NULL,
  assignee_role     varchar(30) NOT NULL,
  due_days          int NOT NULL DEFAULT 1,
  sort_order        int NOT NULL DEFAULT 0,
  is_mandatory      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_offboarding (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL UNIQUE REFERENCES employees(id),
  template_id       bigint REFERENCES hr_offboarding_templates(id),
  termination_type  varchar(20) NOT NULL,
  last_work_date    date NOT NULL,
  exit_interview_date date,
  exit_interview_by  bigint REFERENCES employees(id),
  exit_interview_notes text,
  final_settlement_date date,
  overall_status    varchar(20) NOT NULL DEFAULT 'pending',
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_offboarding_task_instances (
  id                bigserial PRIMARY KEY,
  offboarding_id   bigint NOT NULL REFERENCES hr_employee_offboarding(id) ON DELETE CASCADE,
  template_task_id  bigint REFERENCES hr_offboarding_template_tasks(id),
  task_name_zh      varchar(120) NOT NULL,
  task_category     varchar(30) NOT NULL,
  assignee_id       bigint REFERENCES employees(id),
  assignee_role     varchar(30) NOT NULL,
  due_date          date NOT NULL,
  completed_at      timestamptz,
  status            varchar(20) NOT NULL DEFAULT 'pending',
  remarks           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_tc_category  ON hr_training_courses(category);
CREATE INDEX idx_tp_year       ON hr_training_plans(plan_year, plan_month);
CREATE INDEX idx_tp_dept       ON hr_training_plans(department_id);
CREATE INDEX idx_ts_plan       ON hr_training_sessions(plan_id);
CREATE INDEX idx_ts_date       ON hr_training_sessions(scheduled_date);
CREATE INDEX idx_etr_employee  ON hr_employee_training_records(employee_id);
CREATE INDEX idx_etr_session   ON hr_employee_training_records(session_id);
CREATE INDEX idx_obt_tpl       ON hr_onboarding_template_tasks(template_id);
CREATE INDEX idx_eo_employee   ON hr_employee_onboarding(employee_id);
CREATE INDEX idx_oti_oid       ON hr_onboarding_task_instances(onboarding_id);
CREATE INDEX idx_oti_status    ON hr_onboarding_task_instances(status);
CREATE INDEX idx_oft_ttype     ON hr_offboarding_templates(termination_type);
CREATE INDEX idx_eof_employee  ON hr_employee_offboarding(employee_id);
CREATE INDEX idx_otfi_oid      ON hr_offboarding_task_instances(offboarding_id);

-- Seed onboarding template
INSERT INTO hr_onboarding_templates (code, name_zh, name_en, name_vi, probation_months) VALUES
('OB-GEN-01', '通用入职模板', 'General Onboarding', 'Mẫu onboard chung', 3);

INSERT INTO hr_onboarding_template_tasks (template_id, task_name_zh, task_name_en, task_name_vi, task_category, assignee_role, due_days, sort_order, is_mandatory) VALUES
(1, '提交入职材料', 'Submit documents', 'Nộp giấy tờ', 'paperwork', 'employee', 1, 1, true),
(1, '签署劳动合同', 'Sign contract', 'Ký HĐLĐ', 'paperwork', 'hr', 1, 2, true),
(1, '录入指纹/考勤', 'Enroll attendance', 'Đăng ký chấm công', 'system', 'it', 1, 3, true),
(1, '开通系统账号', 'Create system accounts', 'Mở tài khoản', 'system', 'it', 2, 4, true),
(1, '领取工牌/厂服', 'Receive badge/uniform', 'Nhận thẻ/phục', 'equipment', 'admin', 1, 5, true),
(1, '领取办公设备', 'Receive equipment', 'Nhận thiết bị', 'equipment', 'admin', 1, 6, true),
(1, '安全培训', 'Safety training', 'Đào tạo AT', 'training', 'mentor', 3, 7, true),
(1, '部门岗位培训', 'Department orientation', 'Đào tạo vị trí', 'training', 'supervisor', 5, 8, true),
(1, '指派导师', 'Assign mentor', 'Chỉ định mentor', 'other', 'hr', 1, 9, true),
(1, '部门介绍/参观', 'Dept tour', 'Tham quan bộ phận', 'orientation', 'supervisor', 2, 10, false);

-- Seed offboarding templates
INSERT INTO hr_offboarding_templates (code, name_zh, name_en, name_vi, termination_type) VALUES
('OFF-VOL-01', '主动离职', 'Voluntary Resignation', 'Nghỉ việc tự nguyện', 'voluntary'),
('OFF-DIS-01', '辞退', 'Dismissal', 'Sa thải', 'dismissal'),
('OFF-RET-01', '退休', 'Retirement', 'Nghỉ hưu', 'retirement');

INSERT INTO hr_offboarding_template_tasks (template_id, task_name_zh, task_name_en, task_name_vi, task_category, assignee_role, due_days, sort_order, is_mandatory) VALUES
(1, '提交离职申请', 'Resignation letter', 'Nộp đơn nghỉ', 'paperwork', 'employee', -30, 1, true),
(1, '工作交接', 'Knowledge transfer', 'Bàn giao', 'knowledge', 'supervisor', -7, 2, true),
(1, '归还设备/工牌', 'Return equipment', 'Trả thiết bị', 'equipment', 'admin', 0, 3, true),
(1, '注销系统账号', 'Revoke access', 'Thu hồi tài khoản', 'access', 'it', 0, 4, true),
(1, '结算工资/假期', 'Final settlement', 'Quyết toán', 'finance', 'hr', 0, 5, true),
(1, '离职面谈', 'Exit interview', 'Phỏng vấn', 'hr', 'hr', 0, 6, true),
(1, '出具离职证明', 'Experience letter', 'Cấp giấy', 'hr', 'hr', 0, 7, true),
(2, '发出辞退通知', 'Dismissal notice', 'Thông báo', 'paperwork', 'hr', 0, 1, true),
(2, '归还设备/工牌', 'Return equipment', 'Trả thiết bị', 'equipment', 'admin', 0, 2, true),
(2, '注销系统账号', 'Revoke access', 'Thu hồi TK', 'access', 'it', 0, 3, true),
(2, '结算工资', 'Final salary', 'Quyết toán', 'finance', 'hr', 0, 4, true),
(3, '提交退休申请', 'Retirement papers', 'Hồ sơ nghỉ hưu', 'paperwork', 'hr', -30, 1, true),
(3, '结算社保/公积金', 'Settle insurance', 'Quyết toán BH', 'finance', 'hr', 0, 2, true),
(3, '归还设备/工牌', 'Return equipment', 'Trả thiết bị', 'equipment', 'admin', 0, 3, true),
(3, '注销系统账号', 'Revoke access', 'Thu hồi TK', 'access', 'it', 0, 4, true),
(3, '退休欢送', 'Retirement ceremony', 'Tiễn nghỉ hưu', 'hr', 'hr', 0, 5, false);
