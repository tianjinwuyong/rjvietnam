-- ============================================================
-- HR Training Full Lifecycle + Certification & Exam System
-- Migration 174
-- ============================================================

-- ── Training Plan Detail ──────────────────────────────────────────────────────
CREATE TABLE hr_training_plan_detail (
  id          BIGSERIAL PRIMARY KEY,
  plan_id     INTEGER NOT NULL REFERENCES hr_training_plans(id),
  session_no  TEXT    NOT NULL,
  course_id   INTEGER NOT NULL REFERENCES hr_training_courses(id),
  trainer_id  INTEGER REFERENCES hr_employees(id),
  trainer_name_zh TEXT,
  location    TEXT,
  scheduled_date TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  max_attendees INTEGER DEFAULT 30,
  actual_attendees INTEGER DEFAULT 0,
  status      TEXT    DEFAULT 'scheduled',
  notes       TEXT,
  created_by  INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Certification / 上岗证 Type ───────────────────────────────────────────────
CREATE TABLE hr_certification_type (
  id                BIGSERIAL PRIMARY KEY,
  code              TEXT    NOT NULL UNIQUE,
  name_zh           TEXT    NOT NULL,
  name_en           TEXT,
  name_vi           TEXT,
  description       TEXT,
  requires_exam     INTEGER DEFAULT 1,
  passing_score     INTEGER DEFAULT 60,
  validity_years    INTEGER DEFAULT 2,
  renewal_required  INTEGER DEFAULT 1,
  station_code      TEXT,
  is_active         INTEGER DEFAULT 1,
  created_by        INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Employee Certification / 上岗证 ───────────────────────────────────────────
CREATE TABLE hr_employee_certification (
  id                 BIGSERIAL PRIMARY KEY,
  employee_id        INTEGER NOT NULL REFERENCES hr_employees(id),
  cert_type_id       INTEGER NOT NULL REFERENCES hr_certification_type(id),
  cert_no            TEXT    NOT NULL UNIQUE,
  issued_date        TEXT    NOT NULL,
  expiry_date        TEXT,
  status             TEXT    DEFAULT 'active',
  issued_by          INTEGER,
  issued_by_name     TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── Certification Exam / 考试 ─────────────────────────────────────────────────
CREATE TABLE hr_certification_exam (
  id              BIGSERIAL PRIMARY KEY,
  exam_no         TEXT    NOT NULL UNIQUE,
  cert_type_id    INTEGER NOT NULL REFERENCES hr_certification_type(id),
  exam_name_zh    TEXT    NOT NULL,
  exam_date       TEXT    NOT NULL,
  exam_time_start TEXT,
  exam_time_end   TEXT,
  location        TEXT,
  exam_type       TEXT    DEFAULT 'written',
  total_score     INTEGER DEFAULT 100,
  passing_score   INTEGER DEFAULT 60,
  duration_minutes INTEGER DEFAULT 60,
  max_attendees   INTEGER DEFAULT 30,
  enrolled_count  INTEGER DEFAULT 0,
  status          TEXT    DEFAULT 'scheduled',
  notes           TEXT,
  created_by      INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Exam Enrollment / 考试报名 ────────────────────────────────────────────────
CREATE TABLE hr_exam_enrollment (
  id              BIGSERIAL PRIMARY KEY,
  exam_id         INTEGER NOT NULL REFERENCES hr_certification_exam(id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees(id),
  enrolled_by     INTEGER,
  enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
  exam_status     TEXT    DEFAULT 'enrolled',
  score_obtained  INTEGER,
  is_passed       INTEGER,
  result_remarks  TEXT,
  graded_by       INTEGER,
  graded_at       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, employee_id)
);

-- ── Exam Question Bank / 题库 ─────────────────────────────────────────────────
CREATE TABLE hr_exam_question_bank (
  id              BIGSERIAL PRIMARY KEY,
  cert_type_id    INTEGER NOT NULL REFERENCES hr_certification_type(id),
  question_no     TEXT    NOT NULL,
  question_type   TEXT    NOT NULL,
  question_text_zh TEXT   NOT NULL,
  question_text_en TEXT,
  options_zh      TEXT,
  correct_answer  TEXT    NOT NULL,
  score_per_q     INTEGER DEFAULT 5,
  difficulty      TEXT    DEFAULT 'medium',
  topic           TEXT,
  is_active       INTEGER DEFAULT 1,
  created_by      INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Exam Record / 考试记录明细 ────────────────────────────────────────────────
CREATE TABLE hr_exam_record_detail (
  id              BIGSERIAL PRIMARY KEY,
  enrollment_id   INTEGER NOT NULL REFERENCES hr_exam_enrollment(id),
  question_id     INTEGER NOT NULL REFERENCES hr_exam_question_bank(id),
  given_answer    TEXT,
  is_correct      INTEGER,
  score_obtained  INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Certification Approval / 上岗审批 ─────────────────────────────────────────
CREATE TABLE hr_certification_approval (
  id               BIGSERIAL PRIMARY KEY,
  approval_no      TEXT    NOT NULL UNIQUE,
  employee_id      INTEGER NOT NULL REFERENCES hr_employees(id),
  cert_type_id     INTEGER NOT NULL REFERENCES hr_certification_type(id),
  cert_type_name   TEXT,
  request_type     TEXT    NOT NULL,
  request_reason   TEXT,
  training_record_id INTEGER,
  exam_enrollment_id INTEGER,
  exam_score       INTEGER,
  current_step     INTEGER DEFAULT 1,
  total_steps      INTEGER DEFAULT 3,
  current_status   TEXT    DEFAULT 'pending',
  submitted_by     INTEGER,
  submitted_at     TIMESTAMPTZ DEFAULT NOW(),
  final_approved_by INTEGER,
  final_approved_at TEXT,
  final_remarks    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Approval Steps / 审批步骤明细 ─────────────────────────────────────────────
CREATE TABLE hr_approval_steps (
  id               BIGSERIAL PRIMARY KEY,
  approval_id      INTEGER NOT NULL REFERENCES hr_certification_approval(id),
  step_no          INTEGER NOT NULL,
  step_role        TEXT    NOT NULL,
  step_name_zh     TEXT,
  approver_id      INTEGER,
  approver_name_zh TEXT,
  decision         TEXT,
  decision_at      TEXT,
  remarks          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Training Tracking / 培训跟踪 ──────────────────────────────────────────────
CREATE TABLE hr_training_tracking (
  id               BIGSERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES hr_employees(id),
  training_record_id INTEGER REFERENCES hr_employee_training_records(id),
  tracking_type    TEXT    NOT NULL,
  tracking_date    TEXT    NOT NULL,
  outcome_zh       TEXT,
  outcome_en       TEXT,
  score            INTEGER,
  performance_rating TEXT,
  next_follow_up_date TEXT,
  next_follow_up_type TEXT,
  trainer_feedback TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Training Attendance Real-time / 培训实时考勤 ──────────────────────────────
CREATE TABLE hr_training_attendance (
  id              BIGSERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES hr_training_plan_detail(id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees(id),
  sign_in_time    TEXT,
  sign_out_time   TEXT,
  attendance_status TEXT DEFAULT 'enrolled',
  is_present      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, employee_id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────────
CREATE INDEX idx_tpd_plan    ON hr_training_plan_detail(plan_id);
CREATE INDEX idx_tpd_session ON hr_training_plan_detail(session_no);
CREATE INDEX idx_tpd_date    ON hr_training_plan_detail(scheduled_date);
CREATE INDEX idx_ec_emp      ON hr_employee_certification(employee_id);
CREATE INDEX idx_ec_cert     ON hr_employee_certification(cert_type_id);
CREATE INDEX idx_ec_status   ON hr_employee_certification(status);
CREATE INDEX idx_exam_cert   ON hr_certification_exam(cert_type_id);
CREATE INDEX idx_exam_status ON hr_certification_exam(status);
CREATE INDEX idx_enroll_exam ON hr_exam_enrollment(exam_id);
CREATE INDEX idx_enroll_emp  ON hr_exam_enrollment(employee_id);
CREATE INDEX idx_qb_cert     ON hr_exam_question_bank(cert_type_id);
CREATE INDEX idx_approval_emp ON hr_certification_approval(employee_id);
CREATE INDEX idx_approval_status ON hr_certification_approval(current_status);
CREATE INDEX idx_tracking_emp ON hr_training_tracking(employee_id);
CREATE INDEX idx_tracking_date ON hr_training_tracking(tracking_date);
CREATE INDEX idx_ta_session  ON hr_training_attendance(session_id);

-- ── Seed: Certification Types / 上岗证类型 ────────────────────────────────────
INSERT INTO hr_certification_type (code, name_zh, name_en, name_vi, description, requires_exam, passing_score, validity_years, station_code) VALUES
  ('CERT-SMT-OP',   'SMT操作员上岗证',   'SMT Operator Certificate',  'Chứng chỉ vận hành SMT',   'SMT产线操作资格，需通过SMT操作培训考核', 1, 70, 2, 'smt_placement'),
  ('CERT-AOI-OP',   'AOI检测员上岗证',   'AOI Inspector Certificate', 'Chứng chỉ kiểm tra AOI',   'AOI光学检测岗位资格', 1, 70, 2, 'smt_aoi'),
  ('CERT-PRINT-OP', '印刷机操作上岗证', 'Printer Operator Cert',      'Chứng chỉ vận hành máy in','印刷机操作资格', 1, 70, 2, 'smt_printer'),
  ('CERT-SAFETY',   '安全生产上岗证',   'Safety Certificate',         'Chứng chỉ an toàn',         '安全生产基础知识考核，所有员工必须', 1, 80, 1, NULL),
  ('CERT-MSD',      'MSD管理上岗证',    'MSD Handler Certificate',   'Chứng chỉ xử lý MSD',       '潮湿敏感元件管理资格', 1, 75, 2, NULL),
  ('CERT-QA',       '质检员上岗证',     'QA Inspector Certificate',  'Chứng chỉ QA',              '质量检验岗位资格', 1, 70, 2, NULL);

-- ── Seed: Sample Exam Questions / 题库样例 ────────────────────────────────────
INSERT INTO hr_exam_question_bank (cert_type_id, question_no, question_type, question_text_zh, options_zh, correct_answer, score_per_q, difficulty, topic) VALUES
  (4, 'SAF-001', 'single', '以下哪项是静电防护的正确做法？', '穿防静电手环|穿普通工服|用金属工具直接接触|随意接触元器件', 'A', 5, 'easy', 'ESD'),
  (4, 'SAF-002', 'single', 'MSD元件开封后超过几小时必须烘烤？', '24小时|48小时|72小时|168小时', 'C', 5, 'medium', 'MSD'),
  (4, 'SAF-003', 'single', '锡膏冷藏保存温度范围？', '-10°C~0°C|0°C~10°C|10°C~25°C|25°C~35°C', 'B', 5, 'easy', 'Solder'),
  (1, 'SMT-001', 'single', '贴片机吸取元件时，真空压力不足可能原因？', '吸嘴堵塞|元件太大|速度太快|光源太强', 'A', 5, 'medium', 'PickPlace'),
  (1, 'SMT-002', 'single', 'PCB基准点（ fiducial mark）的作用？', '定位校准|美观装饰|元件标识|测试点', 'A', 5, 'easy', 'Alignment'),
  (2, 'AOI-001', 'single', 'AOI检测到缺锡缺陷时的标准图像颜色？', '红色|绿色|黄色|蓝色', 'A', 5, 'medium', 'Defect'),
  (3, 'PRT-001', 'single', '印刷机脱模不完全的原因不包括？', '刮刀速度过快|脱模距离不足|钢网张力不够|焊膏粘度太高', 'D', 5, 'hard', 'Print');

-- Approval steps are instantiated after a real approval record is created.
