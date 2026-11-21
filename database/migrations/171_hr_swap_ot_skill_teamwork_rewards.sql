-- ============================================================
-- HR Shift Swap, OT Pay, Skill Rating, Teamwork Light, Rewards
-- Migration 171
-- ============================================================

-- ── 1. Shift Swap (替班方案) ──────────────────────────────────
CREATE TABLE hr_shift_swap_requests (
  id                  bigserial PRIMARY KEY,
  request_no          varchar(30) NOT NULL UNIQUE,
  requester_id        bigint NOT NULL REFERENCES hr_employees(id),
  requester_name_zh   varchar(80),
  requester_emp_no    varchar(30),
  requester_dept_id   bigint,
  swap_partner_id     bigint REFERENCES hr_employees(id),
  swap_partner_name_zh varchar(80),
  original_shift_date date NOT NULL,
  original_shift_type varchar(20) NOT NULL,
  original_shift_start time,
  original_shift_end   time,
  target_shift_date   date NOT NULL,
  target_shift_type   varchar(20) NOT NULL,
  target_shift_start  time,
  target_shift_end    time,
  reason_zh           varchar(200),
  reason_en           varchar(200),
  reason_vi           varchar(200),
  status              varchar(20) NOT NULL DEFAULT 'pending',
  approver_id         bigint,
  approver_name_zh    varchar(80),
  approved_at         timestamptz,
  remark              varchar(300),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_shift_swap_records (
  id                   bigserial PRIMARY KEY,
  swap_request_id      bigint NOT NULL REFERENCES hr_shift_swap_requests(id),
  original_worker_id   bigint NOT NULL REFERENCES hr_employees(id),
  original_worker_name varchar(80),
  original_shift_date  date NOT NULL,
  original_shift_type  varchar(20) NOT NULL,
  swap_worker_id       bigint NOT NULL REFERENCES hr_employees(id),
  swap_worker_name     varchar(80),
  swap_shift_date      date NOT NULL,
  swap_shift_type      varchar(20) NOT NULL,
  actual_performer_id  bigint REFERENCES hr_employees(id),
  actual_performer_name varchar(80),
  actual_performed_at  timestamptz,
  swap_status          varchar(20) NOT NULL DEFAULT 'completed',
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. OT Pay Rules & Calculation (加班薪资) ───────────────────
CREATE TABLE hr_ot_pay_rules (
  id              bigserial PRIMARY KEY,
  rule_code       varchar(30) NOT NULL UNIQUE,
  name_zh         varchar(120) NOT NULL,
  name_en         varchar(120),
  name_vi         varchar(120),
  ot_type         varchar(30) NOT NULL,
  multiplier      numeric(4,2) NOT NULL,
  currency        varchar(10) NOT NULL DEFAULT 'VND',
  min_hours       numeric(4,2) DEFAULT 0,
  max_hours       numeric(4,2),
  night_allowance numeric(12,2) DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  effective_from  date NOT NULL,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_ot_records (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES hr_employees(id),
  emp_name        varchar(80),
  emp_no          varchar(30),
  dept_name       varchar(80),
  ot_date         date NOT NULL,
  ot_hours        numeric(4,2) NOT NULL,
  ot_type         varchar(30) NOT NULL,
  pay_rule_id     bigint REFERENCES hr_ot_pay_rules(id),
  hourly_base     numeric(12,2) NOT NULL,
  multiplier      numeric(4,2) NOT NULL,
  ot_pay_amount   numeric(12,2) NOT NULL,
  night_allowance numeric(12,2) DEFAULT 0,
  total_pay       numeric(12,2) NOT NULL,
  currency        varchar(10) NOT NULL DEFAULT 'VND',
  applied_month   varchar(7),
  approved_by     bigint,
  approver_name   varchar(80),
  approved_at     timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  remark          varchar(300),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Skill Rating Standards (技能评分标准) ──────────────────
CREATE TABLE hr_skill_categories (
  id          bigserial PRIMARY KEY,
  code        varchar(30) NOT NULL UNIQUE,
  name_zh     varchar(80) NOT NULL,
  name_en     varchar(80),
  name_vi     varchar(80),
  description varchar(300),
  sort_order  int DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_skill_levels (
  id            bigserial PRIMARY KEY,
  category_id   bigint NOT NULL REFERENCES hr_skill_categories(id),
  level_code    varchar(20) NOT NULL,
  level_name_zh varchar(40) NOT NULL,
  level_name_en varchar(40),
  level_name_vi varchar(40),
  score_min     numeric(5,1) NOT NULL,
  score_max     numeric(5,1) NOT NULL,
  salary_ratio  numeric(3,2) NOT NULL DEFAULT 1.00,
  description   varchar(300),
  sort_order    int DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_skill_items (
  id            bigserial PRIMARY KEY,
  category_id   bigint NOT NULL REFERENCES hr_skill_categories(id),
  station_code  varchar(30),
  station_name_zh varchar(80),
  item_code     varchar(30) NOT NULL,
  item_name_zh  varchar(120) NOT NULL,
  item_name_en  varchar(120),
  item_name_vi  varchar(120),
  max_score     numeric(5,1) NOT NULL DEFAULT 100,
  weight        numeric(5,2) NOT NULL DEFAULT 1.00,
  data_source   varchar(20) DEFAULT 'manual',
  sort_order    int DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_skill_rating (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES hr_employees(id),
  emp_name        varchar(80),
  emp_no          varchar(30),
  dept_name       varchar(80),
  category_id     bigint NOT NULL REFERENCES hr_skill_categories(id),
  category_name_zh varchar(80),
  period_year     int NOT NULL,
  period_month    int NOT NULL,
  total_score     numeric(5,1) NOT NULL DEFAULT 0,
  skill_level_id  bigint REFERENCES hr_skill_levels(id),
  skill_level_name varchar(40),
  rated_by        bigint,
  rater_name      varchar(80),
  rated_at        timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, category_id, period_year, period_month)
);

CREATE TABLE hr_skill_rating_details (
  id                  bigserial PRIMARY KEY,
  skill_rating_id     bigint NOT NULL REFERENCES hr_employee_skill_rating(id),
  skill_item_id       bigint NOT NULL REFERENCES hr_skill_items(id),
  item_name_zh        varchar(120),
  max_score           numeric(5,1),
  actual_score        numeric(5,1),
  weight              numeric(5,2),
  weighted_score      numeric(6,2),
  data_source         varchar(20),
  data_value          numeric(10,2),
  remark              varchar(200),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Teamwork Light (合作能力灯) ────────────────────────────
CREATE TABLE hr_teamwork_metrics (
  id              bigserial PRIMARY KEY,
  metric_code     varchar(30) NOT NULL UNIQUE,
  name_zh         varchar(80) NOT NULL,
  name_en         varchar(80),
  name_vi         varchar(80),
  description     varchar(300),
  data_source     varchar(20) NOT NULL DEFAULT 'manual',
  target_value    numeric(8,2),
  target_max      numeric(8,2),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      int DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_teamwork_rating (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES hr_employees(id),
  emp_name        varchar(80),
  emp_no          varchar(80),
  dept_name       varchar(80),
  period_year     int NOT NULL,
  period_month    int NOT NULL,
  overall_score   numeric(5,1) NOT NULL DEFAULT 0,
  light_status    varchar(10) NOT NULL DEFAULT 'green',
  light_reason    varchar(200),
  rater_id        bigint,
  rater_name      varchar(80),
  rated_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period_year, period_month)
);

CREATE TABLE hr_teamwork_rating_details (
  id                  bigserial PRIMARY KEY,
  teamwork_rating_id  bigint NOT NULL REFERENCES hr_employee_teamwork_rating(id),
  metric_id           bigint NOT NULL REFERENCES hr_teamwork_metrics(id),
  metric_name_zh      varchar(80),
  target_value        numeric(8,2),
  actual_value        numeric(8,2),
  metric_score        numeric(5,1),
  remark              varchar(200),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 5. Extended Reward Mechanism (扩展奖励机制) ───────────────
CREATE TABLE hr_reward_programs (
  id              bigserial PRIMARY KEY,
  program_code    varchar(30) NOT NULL UNIQUE,
  name_zh         varchar(120) NOT NULL,
  name_en         varchar(120),
  name_vi         varchar(120),
  program_type    varchar(30) NOT NULL,
  start_date      date NOT NULL,
  end_date        date,
  target_dept_ids varchar(200),
  budget_total    numeric(14,2),
  budget_used     numeric(14,2) DEFAULT 0,
  currency        varchar(10) NOT NULL DEFAULT 'VND',
  status          varchar(20) NOT NULL DEFAULT 'active',
  created_by      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_reward_nominations (
  id              bigserial PRIMARY KEY,
  program_id      bigint REFERENCES hr_reward_programs(id),
  nominator_id    bigint NOT NULL REFERENCES hr_employees(id),
  nominator_name  varchar(80),
  nominee_id      bigint NOT NULL REFERENCES hr_employees(id),
  nominee_name    varchar(80),
  nominee_dept    varchar(80),
  category_id     bigint NOT NULL REFERENCES hr_reward_categories(id),
  cat_name_zh     varchar(80),
  nomination_date date NOT NULL,
  reason_zh       varchar(300),
  reason_en       varchar(300),
  reason_vi       varchar(300),
  evidence_urls   varchar(500),
  status          varchar(20) NOT NULL DEFAULT 'pending',
  approver_id     bigint,
  approver_name   varchar(80),
  decided_at      timestamptz,
  final_amount    numeric(14,2),
  final_reason    varchar(300),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_peer_recognition (
  id              bigserial PRIMARY KEY,
  recognizing_id  bigint NOT NULL REFERENCES hr_employees(id),
  recognizing_name varchar(80),
  recognized_id   bigint NOT NULL REFERENCES hr_employees(id),
  recognized_name varchar(80),
  recognized_dept varchar(80),
  recognition_type varchar(30) NOT NULL,
  message         varchar(300),
  likes_count     int DEFAULT 0,
  liked_by        varchar(200),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ssr_req     ON hr_shift_swap_requests(requester_id);
CREATE INDEX idx_ssr_partner ON hr_shift_swap_requests(swap_partner_id);
CREATE INDEX idx_ssr_date    ON hr_shift_swap_requests(original_shift_date, target_shift_date);
CREATE INDEX idx_ssr_status  ON hr_shift_swap_requests(status);
CREATE INDEX idx_ssr_ym      ON hr_shift_swap_requests(original_shift_date);
CREATE INDEX idx_ssr2_req    ON hr_shift_swap_records(swap_request_id);
CREATE INDEX idx_ssr2_orig   ON hr_shift_swap_records(original_worker_id, original_shift_date);
CREATE INDEX idx_ot_emp      ON hr_ot_records(employee_id);
CREATE INDEX idx_ot_date     ON hr_ot_records(ot_date);
CREATE INDEX idx_ot_ym       ON hr_ot_records(applied_month);
CREATE INDEX idx_ot_status   ON hr_ot_records(status);
CREATE INDEX idx_esr_emp     ON hr_employee_skill_rating(employee_id);
CREATE INDEX idx_esr_ym      ON hr_employee_skill_rating(period_year, period_month);
CREATE INDEX idx_srd_rating  ON hr_skill_rating_details(skill_rating_id);
CREATE INDEX idx_etr_emp     ON hr_employee_teamwork_rating(employee_id);
CREATE INDEX idx_etr_ym      ON hr_employee_teamwork_rating(period_year, period_month);
CREATE INDEX idx_trd_rating  ON hr_teamwork_rating_details(teamwork_rating_id);
CREATE INDEX idx_rn_prog     ON hr_reward_nominations(program_id);
CREATE INDEX idx_rn_nominee  ON hr_reward_nominations(nominee_id);
CREATE INDEX idx_rn_status   ON hr_reward_nominations(status);
CREATE INDEX idx_pr_recogn   ON hr_peer_recognition(recognized_id);
CREATE INDEX idx_pr_recogniz ON hr_peer_recognition(recognizing_id);

-- ── Seed OT Pay Rules ─────────────────────────────────────────
INSERT INTO hr_ot_pay_rules (rule_code, name_zh, name_en, name_vi, ot_type, multiplier, min_hours, night_allowance, currency, effective_from) VALUES
('OT-WD-15', '平日加班1.5倍', 'Weekday OT 1.5x', 'Tăng ca ngày thường 1.5x', 'weekday', 1.50, 0, 20000, 'VND', '2024-01-01'),
('OT-WD-2', '平日加班超2h双倍', 'Weekday OT 2x after 2h', 'Tăng ca ngày thường 2x sau 2h', 'weekday_excess', 2.00, 2, 20000, 'VND', '2024-01-01'),
('OT-WE-2', '周末加班2倍', 'Weekend OT 2x', 'Tăng ca cuối tuần 2x', 'weekend', 2.00, 0, 30000, 'VND', '2024-01-01'),
('OT-HOL-3', '节假日加班3倍', 'Holiday OT 3x', 'Tăng ca ngày lễ 3x', 'holiday', 3.00, 0, 50000, 'VND', '2024-01-01'),
('OT-NIGHT', '夜班补贴', 'Night shift allowance', 'Phụ cấp ca đêm', 'night', 0, 0, 40000, 'VND', '2024-01-01'),
('OT-LEGAL', '法定节假日调休', 'Legal holiday comp time', 'Nghỉ bù ngày lễ', 'legal_holiday', 0, 0, 0, 'VND', '2024-01-01');

-- ── Seed Skill Categories ─────────────────────────────────────
INSERT INTO hr_skill_categories (code, name_zh, name_en, name_vi, description, sort_order) VALUES
('SK-SMT', 'SMT技能', 'SMT Skill', 'Kỹ năng SMT', 'SMT产线操作员技能评定', 1),
('SK-QA', '质量检验技能', 'QA Skill', 'Kỹ năng QC', '质检岗位技能评定', 2),
('SK-MNT', '设备维护技能', 'Maintenance Skill', 'Kỹ năng bảo dưỡng', '设备维护工程师技能评定', 3),
('SK-SAFETY', '安全生产技能', 'Safety Skill', 'Kỹ năng AT', '安全生产操作技能', 4),
('SK-LEAD', '管理协作技能', 'Leadership Skill', 'Kỹ năng lãnh đạo', '线长/组长管理协作能力', 5);

-- ── Seed Skill Levels ─────────────────────────────────────────
INSERT INTO hr_skill_levels (category_id, level_code, level_name_zh, level_name_en, level_name_vi, score_min, score_max, salary_ratio, description, sort_order) VALUES
-- SK-SMT levels
(1, 'SMT-L1', 'SMT初级', 'SMT Junior', 'SMT sơ cấp', 0, 59.9, 1.00, '能独立操作单台设备', 1),
(1, 'SMT-L2', 'SMT熟练', 'SMT Skilled', 'SMT thành thạo', 60, 74.9, 1.10, '能操作多条线设备', 2),
(1, 'SMT-L3', 'SMT高级', 'SMT Senior', 'SMT cao cấp', 75, 89.9, 1.20, '能处理异常、带新人', 3),
(1, 'SMT-L4', 'SMT专家', 'SMT Expert', 'SMT chuyên gia', 90, 100, 1.35, '全线精通、主导改善', 4),
-- SK-QA levels
(2, 'QA-L1', '质检初级', 'QA Junior', 'QC sơ cấp', 0, 59.9, 1.00, '能独立完成检测任务', 1),
(2, 'QA-L2', '质检熟练', 'QA Skilled', 'QC thành thạo', 60, 74.9, 1.10, '能判定不良、填写报告', 2),
(2, 'QA-L3', '质检高级', 'QA Senior', 'QC cao cấp', 75, 89.9, 1.20, '能分析问题、推动改善', 3),
(2, 'QA-L4', '质检专家', 'QA Expert', 'QC chuyên gia', 90, 100, 1.35, '主导质量改善项目', 4),
-- SK-MNT levels
(3, 'MNT-L1', '维护初级', 'Maint Junior', 'Bảo dưỡng sơ cấp', 0, 59.9, 1.00, '能执行日常保养', 1),
(3, 'MNT-L2', '维护熟练', 'Maint Skilled', 'Bảo dưỡng thành thạo', 60, 74.9, 1.10, '能处理一般故障', 2),
(3, 'MNT-L3', '维护高级', 'Maint Senior', 'Bảo dưỡng cao cấp', 75, 89.9, 1.20, '能处理重大故障', 3),
(3, 'MNT-L4', '维护专家', 'Maint Expert', 'Bảo dưỡng chuyên gia', 90, 100, 1.35, '能预防故障、优化设备', 4),
-- SK-SAFETY levels
(4, 'SAF-L1', '安全初级', 'Safety Basic', 'AT cơ bản', 0, 69.9, 1.00, '了解安全规程', 1),
(4, 'SAF-L2', '安全熟练', 'Safety Skilled', 'AT thành thạo', 70, 84.9, 1.10, '能识别并上报隐患', 2),
(4, 'SAF-L3', '安全高级', 'Safety Senior', 'AT cao cấp', 85, 100, 1.20, '能主导安全培训', 3),
-- SK-LEAD levels
(5, 'LEAD-L1', '管理入门', 'Leadership Basic', 'QL cơ bản', 0, 59.9, 1.00, '能分配任务、跟踪进度', 1),
(5, 'LEAD-L2', '管理熟练', 'Leadership Skilled', 'QL thành thạo', 60, 79.9, 1.15, '能协调资源、处理投诉', 2),
(5, 'LEAD-L3', '管理高级', 'Leadership Senior', 'QL cao cấp', 80, 100, 1.30, '能制定计划、培养下属', 3);

-- ── Seed Skill Items ──────────────────────────────────────────
INSERT INTO hr_skill_items (category_id, station_code, station_name_zh, item_code, item_name_zh, item_name_en, item_name_vi, max_score, weight, data_source, sort_order) VALUES
-- SMT items
(1, 'smt_pda_loading', '上料工位', 'SMT-LOAD', '物料上料准确性', 'Material loading accuracy', 'Độ chính xác lắp linh kiện', 100, 1.0, 'mes', 1),
(1, 'smt_printer', '印刷机', 'SMT-PRINT', '印刷质量(SPI通过率)', 'Print quality SPI pass', 'Chất lượng in SPI', 100, 1.5, 'mes', 2),
(1, 'smt_placement', '贴片机', 'SMT-PLACE', '贴装精度与速度', 'Placement accuracy/speed', 'Độ chính xác đặt', 100, 1.5, 'mes', 3),
(1, 'smt_aoi', 'SMT-AOI', 'SMT-AOI', 'AOI检测通过率', 'AOI pass rate', 'Tỷ lệ AOI đạt', 100, 1.5, 'mes', 4),
(1, NULL, '通用', 'SMT-SAFE', '安全生产合规', 'Safety compliance', 'Tuân thủ AT', 100, 1.0, 'safety', 5),
(1, NULL, '通用', 'SMT-TEAM', '团队协作与出勤', 'Teamwork and attendance', 'Làm việc nhóm', 100, 0.5, 'attendance', 6),
-- QA items
(2, NULL, '通用', 'QA-DET', '缺陷检出率', 'Defect detection rate', 'Tỷ lệ phát hiện lỗi', 100, 2.0, 'quality', 1),
(2, NULL, '通用', 'QA-FALSE', '误判率', 'False alarm rate', 'Tỷ lệ báo sai', 100, 1.5, 'quality', 2),
(2, NULL, '通用', 'QA-REPT', '报告准确性', 'Report accuracy', 'Độ chính xác báo cáo', 100, 1.0, 'manual', 3),
(2, NULL, '通用', 'QA-SAFE', '安全合规', 'Safety compliance', 'Tuân thủ AT', 100, 0.5, 'safety', 4),
(2, NULL, '通用', 'QA-TEAM', '团队协作', 'Teamwork', 'Làm việc nhóm', 100, 1.0, 'manual', 5),
-- MNT items
(3, NULL, '通用', 'MNT-RESP', '响应时间', 'Response time', 'Thời gian phản hồi', 100, 1.5, 'mes', 1),
(3, NULL, '通用', 'MNT-FIX', '故障修复率', 'Fix rate within shift', 'Tỷ lệ sửa chữa', 100, 2.0, 'mes', 2),
(3, NULL, '通用', 'MNT-PM', 'PM完成率', 'PM completion rate', 'Hoàn thành PM', 100, 1.0, 'mes', 3),
(3, NULL, '通用', 'MNT-DOC', '文档记录完整性', 'Document completeness', 'Hoàn chỉnh tài liệu', 100, 0.5, 'manual', 4),
(3, NULL, '通用', 'MNT-SAFE', '安全合规', 'Safety compliance', 'Tuân thủ AT', 100, 1.0, 'safety', 5),
-- Safety items
(4, NULL, '通用', 'SAF-KNOW', '安全知识考核', 'Safety knowledge test', 'Kiểm tra AT', 100, 1.5, 'manual', 1),
(4, NULL, '通用', 'SAF-EQUIP', '设备操作安全', 'Equipment safety ops', 'Vận hành AT', 100, 1.5, 'manual', 2),
(4, NULL, '通用', 'SAF-REPORT', '隐患上报及时性', 'Hazard report timeliness', 'Báo cáo nguy hiểm', 100, 1.0, 'safety', 3),
(4, NULL, '通用', 'SAF-DRILL', '应急演练参与', 'Emergency drill participation', 'Tham gia diễn tập', 100, 1.0, 'manual', 4),
-- Leadership items
(5, NULL, '通用', 'LEAD-PLAN', '计划排程能力', 'Planning ability', 'Khả năng lập kế hoạch', 100, 1.5, 'manual', 1),
(5, NULL, '通用', 'LEAD-COMM', '沟通协调能力', 'Communication skill', 'Kỹ năng giao tiếp', 100, 1.5, 'manual', 2),
(5, NULL, '通用', 'LEAD-TRAIN', '下属培养能力', 'Subordinate development', 'Phát triển nhân viên', 100, 1.0, 'manual', 3),
(5, NULL, '通用', 'LEAD-KPI', 'KPI达成管理', 'KPI management', 'Quản lý KPI', 100, 1.0, 'mes', 4),
(5, NULL, '通用', 'LEAD-SAFE', '安全管理能力', 'Safety management', 'Quản lý AT', 100, 1.0, 'safety', 5);

-- ── Seed Teamwork Metrics ─────────────────────────────────────
INSERT INTO hr_teamwork_metrics (metric_code, name_zh, name_en, name_vi, description, data_source, target_value, target_max, sort_order) VALUES
('TW-HELP', '主动协助同事', 'Proactively help colleagues', 'Chủ động giúp đỡ', '主动帮助其他工位同事解决问题的次数', 'manual', 5, 20, 1),
('TW-COMM', '信息共享及时', 'Timely information sharing', 'Chia sẻ thông tin kịp thời', '班前会信息传达、异常通报是否及时', 'manual', 3, 10, 2),
('TW-CONFLICT', '冲突处理', 'Conflict resolution', 'Xử lý xung đột', '与其他同事发生冲突被投诉次数(越低越好)', 'attendance', 0, 5, 3),
('TW-IMPROVE', '改善提案', 'Improvement suggestions', 'Đề xuất cải tiến', '提出改善提案并被采纳的数量', 'manual', 1, 10, 4),
('TW-ABSENT', '缺勤率', 'Absence rate', 'Tỷ lệ nghỉ', '月度缺勤率(越低越好)', 'attendance', 0, 5, 5),
('TW-OT', '加班配合度', 'OT cooperation', 'Phối hợp tăng ca', '主动配合加班次数', 'attendance', 3, 15, 6);

-- ── Seed Reward Programs ──────────────────────────────────────
INSERT INTO hr_reward_programs (program_code, name_zh, name_en, name_vi, program_type, start_date, budget_total, currency, status) VALUES
('PRG-2026-Q1', '2026年Q1质量激励计划', '2026 Q1 Quality Incentive', 'Kế hoạch Q1 2026', 'quarterly', '2026-01-01', 50000000, 'VND', 'active'),
('PRG-2026-SAFETY', '2026年安全生产零事故计划', '2026 Zero Accident Program', 'CT 2026 không TN', 'safety', '2026-01-01', 30000000, 'VND', 'active'),
('PRG-2026-INNOV', '2026年创新改善计划', '2026 Innovation Program', 'CT đổi mới 2026', 'innovation', '2026-01-01', 80000000, 'VND', 'active'),
('PRG-2026-MILESTONE', '2026年产能里程碑奖励', '2026 Output Milestone', 'Cột mốc 2026', 'milestone', '2026-01-01', 100000000, 'VND', 'active');
