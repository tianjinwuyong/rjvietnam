-- ============================================================
-- HR Attendance Statistics, Performance KPI & Rewards
-- Migration 168
-- ============================================================

CREATE TABLE hr_attendance_monthly_stats (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  year              int NOT NULL,
  month             int NOT NULL,
  normal_days       numeric(5,2) NOT NULL DEFAULT 0,
  absent_days       numeric(5,2) NOT NULL DEFAULT 0,
  late_count        int NOT NULL DEFAULT 0,
  late_minutes      int NOT NULL DEFAULT 0,
  early_count       int NOT NULL DEFAULT 0,
  early_minutes     int NOT NULL DEFAULT 0,
  ot_hours          numeric(6,2) NOT NULL DEFAULT 0,
  leave_days        numeric(5,2) NOT NULL DEFAULT 0,
  holiday_days      numeric(5,2) NOT NULL DEFAULT 0,
  work_days         numeric(5,2) NOT NULL DEFAULT 0,
  attendance_rate   numeric(5,2) NOT NULL DEFAULT 0,
  punctuality_rate  numeric(5,2) NOT NULL DEFAULT 0,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, year, month)
);

CREATE TABLE hr_attendance_clock_detail (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  work_date         date NOT NULL,
  clock_in          timestamptz,
  clock_out         timestamptz,
  clock_in_method   varchar(20) DEFAULT 'fp',
  clock_out_method  varchar(20) DEFAULT 'fp',
  device_id         varchar(40),
  remark            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

CREATE TABLE hr_perf_kpi_templates (
  id                bigserial PRIMARY KEY,
  code              varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  category          varchar(30) NOT NULL,
  department_id     bigint REFERENCES departments(id),
  position_id       bigint REFERENCES positions(id),
  period_type       varchar(20) NOT NULL DEFAULT 'monthly',
  weight_total      numeric(5,2) NOT NULL DEFAULT 100,
  pass_score        numeric(5,2) NOT NULL DEFAULT 60,
  status            varchar(20) NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_perf_kpi_template_items (
  id                bigserial PRIMARY KEY,
  template_id       bigint NOT NULL REFERENCES hr_perf_kpi_templates(id) ON DELETE CASCADE,
  kpi_name_zh       varchar(120) NOT NULL,
  kpi_name_en       varchar(120) NOT NULL,
  kpi_name_vi       varchar(120) NOT NULL,
  category          varchar(30) NOT NULL,
  target_type       varchar(20) NOT NULL,
  target_value      numeric(10,2) NOT NULL DEFAULT 0,
  target_max        numeric(10,2),
  weight            numeric(5,2) NOT NULL DEFAULT 10,
  data_source       varchar(40),
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_emp_kpi_results (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  template_id       bigint REFERENCES hr_perf_kpi_templates(id),
  period_year       int NOT NULL,
  period_month      int,
  period_quarter    int,
  item_id           bigint REFERENCES hr_perf_kpi_template_items(id),
  item_name_zh      varchar(120) NOT NULL,
  item_category     varchar(30) NOT NULL,
  target_value      numeric(10,2) NOT NULL DEFAULT 0,
  actual_value      numeric(10,2) NOT NULL DEFAULT 0,
  score             numeric(5,2) NOT NULL DEFAULT 0,
  weight            numeric(5,2) NOT NULL DEFAULT 10,
  auto_computed     boolean NOT NULL DEFAULT false,
  computed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, item_id, period_year, period_month, period_quarter)
);

CREATE TABLE hr_perf_score_summary (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  period_year       int NOT NULL,
  period_month      int,
  period_quarter    int,
  total_score       numeric(5,2) NOT NULL DEFAULT 0,
  rating            varchar(10) NOT NULL,
  rank_in_dept      int,
  review_status     varchar(20) NOT NULL DEFAULT 'pending',
  self_score_at     timestamptz,
  manager_score_at  timestamptz,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period_year, period_month)
);

CREATE TABLE hr_reward_categories (
  id                bigserial PRIMARY KEY,
  code              varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  category_type     varchar(20) NOT NULL,
  amount_min        numeric(12,2),
  amount_max        numeric(12,2),
  currency          varchar(10) NOT NULL DEFAULT 'VND',
  approver_role     varchar(30) NOT NULL DEFAULT 'hr',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_rewards (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  category_id       bigint NOT NULL REFERENCES hr_reward_categories(id),
  reward_date       date NOT NULL,
  amount            numeric(12,2) NOT NULL DEFAULT 0,
  currency          varchar(10) NOT NULL DEFAULT 'VND',
  reason_zh         varchar(200) NOT NULL,
  reason_en         varchar(200),
  reason_vi         varchar(200),
  award_level       varchar(20),
  issued_by         bigint REFERENCES employees(id),
  approver_id       bigint REFERENCES employees(id),
  status            varchar(20) NOT NULL DEFAULT 'approved',
  payment_status    varchar(20) NOT NULL DEFAULT 'unpaid',
  paid_at           timestamptz,
  period_year       int,
  period_month      int,
  remark            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_periodic_bonus (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES employees(id),
  bonus_type        varchar(20) NOT NULL,
  period_year       int NOT NULL,
  period_quarter    int,
  base_amount       numeric(12,2) NOT NULL DEFAULT 0,
  coefficient       numeric(5,2) NOT NULL DEFAULT 1.0,
  final_amount      numeric(12,2) NOT NULL DEFAULT 0,
  currency          varchar(10) NOT NULL DEFAULT 'VND',
  performance_rating varchar(10),
  status            varchar(20) NOT NULL DEFAULT 'pending',
  approved_by       bigint REFERENCES employees(id),
  paid_at           timestamptz,
  remark            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_attendance_rules (
  id                bigserial PRIMARY KEY,
  rule_code         varchar(30) NOT NULL UNIQUE,
  name_zh           varchar(120) NOT NULL,
  name_en           varchar(120) NOT NULL,
  name_vi           varchar(120) NOT NULL,
  rule_type         varchar(30) NOT NULL,
  threshold_value   numeric(10,2),
  threshold_unit    varchar(20),
  amount            numeric(12,2) NOT NULL DEFAULT 0,
  amount_type       varchar(20) NOT NULL,
  currency          varchar(10) NOT NULL DEFAULT 'VND',
  is_active         boolean NOT NULL DEFAULT true,
  effective_from    date NOT NULL,
  effective_to      date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ams_emp  ON hr_attendance_monthly_stats(employee_id);
CREATE INDEX idx_ams_ym   ON hr_attendance_monthly_stats(year, month);
CREATE INDEX idx_acd_ed   ON hr_attendance_clock_detail(employee_id, work_date);
CREATE INDEX idx_pkt_dept ON hr_perf_kpi_templates(department_id);
CREATE INDEX idx_pkti_tpl ON hr_perf_kpi_template_items(template_id);
CREATE INDEX idx_ekr_emp  ON hr_emp_kpi_results(employee_id);
CREATE INDEX idx_ekr_per  ON hr_emp_kpi_results(period_year, period_month);
CREATE INDEX idx_pss_emp  ON hr_perf_score_summary(employee_id);
CREATE INDEX idx_er_emp   ON hr_employee_rewards(employee_id);
CREATE INDEX idx_er_date  ON hr_employee_rewards(reward_date);
CREATE INDEX idx_pb_emp   ON hr_periodic_bonus(employee_id);
CREATE INDEX idx_pb_per   ON hr_periodic_bonus(period_year, period_quarter);

-- Seed attendance rules
INSERT INTO hr_attendance_rules (rule_code, name_zh, name_en, name_vi, rule_type, threshold_value, threshold_unit, amount, amount_type, currency, effective_from) VALUES
('LATE-3', '迟到3次扣款', 'Late 3 times deduction', 'Trừ lương khi muộn 3 lần', 'late_deduct', 3, 'times', 100000, 'fixed', 'VND', '2024-01-01'),
('OT-1.5', '加班1.5倍', 'OT 1.5x rate', 'Tăng ca 1.5 lần', 'ot_pay', 1.5, 'hour', 0, 'per_unit', 'VND', '2024-01-01'),
('OT-3', '节假日加班3倍', 'Holiday OT 3x', 'Tăng ca ngày lễ 3 lần', 'ot_pay', 3.0, 'hour', 0, 'per_unit', 'VND', '2024-01-01'),
('ABSENT-1', '旷工扣日薪', 'Absence deduct 1 day', 'Nghỉ không phép trừ 1 ngày', 'absence_deduct', 1, 'day', 1, 'day_salary', 'VND', '2024-01-01'),
('FULL-ATT', '全勤奖励', 'Full attendance bonus', 'Thưởng chuyên cần', 'full_attendance', 0, 'day', 500000, 'fixed', 'VND', '2024-01-01');

-- Seed reward categories
INSERT INTO hr_reward_categories (code, name_zh, name_en, name_vi, category_type, amount_min, amount_max, currency, approver_role) VALUES
('RW-Quality', '质量奖励', 'Quality Award', 'Thưởng chất lượng', 'material', 100000, 5000000, 'VND', 'hr'),
('RW-Safety', '安全奖励', 'Safety Award', 'Thưởng an toàn', 'material', 100000, 2000000, 'VND', 'safety'),
('RW-Innovation', '创新奖励', 'Innovation Award', 'Thưởng sáng tạo', 'material', 500000, 10000000, 'VND', 'hr'),
('RW-Teamwork', '团队协作奖', 'Teamwork Award', 'Thưởng làm việc nhóm', 'material', 200000, 3000000, 'VND', 'manager'),
('RW-Annual', '年度优秀员工', 'Annual Best Employee', 'NV xuất sắc năm', 'honor', 0, 0, 'VND', 'hr'),
('RW-Milestone', '里程碑奖励', 'Milestone Award', 'Thưởng cột mốc', 'material', 1000000, 50000000, 'VND', 'hr');

-- Seed KPI templates
INSERT INTO hr_perf_kpi_templates (code, name_zh, name_en, name_vi, category, period_type, weight_total, pass_score) VALUES
('KPI-SMT-Op', 'SMT操作员绩效', 'SMT Operator KPI', 'KPI NV SMT', 'smt', 'monthly', 100, 60),
('KPI-QA', '质检员绩效', 'QA Inspector KPI', 'KPI QC', 'quality', 'monthly', 100, 60),
('KPI-Sup', '线长绩效', 'Supervisor KPI', 'KPI giám sát', 'management', 'monthly', 100, 70),
('KPI-Eng', '工程师绩效', 'Engineer KPI', 'KPI kỹ sư', 'engineering', 'monthly', 100, 65);

INSERT INTO hr_perf_kpi_template_items (template_id, kpi_name_zh, kpi_name_en, kpi_name_vi, category, target_type, target_value, weight, data_source, sort_order) VALUES
(1, '产出数量', 'Output Qty', 'Sản lượng', 'efficiency', 'higher_better', 1000, 20, 'mes', 1),
(1, '良品率', 'FPY', 'Tỷ lệ đạt', 'quality', 'higher_better', 98, 25, 'mes', 2),
(1, '缺勤率', 'Absence Rate', 'Tỷ lệ nghỉ', 'attendance', 'lower_better', 0, 15, 'attendance', 3),
(1, '5S检查', '5S Score', 'Điểm 5S', 'safety', 'higher_better', 90, 10, 'manual', 4),
(1, '设备保养', 'Equipment Maint', 'Bảo dưỡng TB', 'efficiency', 'higher_better', 95, 10, 'mes', 5),
(1, '安全合规', 'Safety Compliance', 'An toàn', 'safety', 'higher_better', 100, 10, 'safety', 6),
(1, '团队协作', 'Teamwork', 'Làm việc nhóm', 'teamwork', 'higher_better', 80, 10, 'manual', 7),
(2, '漏检率', 'Miss Rate', 'Tỷ lệ bỏ sót', 'quality', 'lower_better', 0, 25, 'quality', 1),
(2, '误判率', 'False Alarm', 'Tỷ lệ báo sai', 'quality', 'lower_better', 2, 20, 'quality', 2),
(2, '客户投诉', 'Customer Complaints', 'Khiếu nại KH', 'quality', 'lower_better', 0, 20, 'quality', 3),
(2, '检测效率', 'Inspection Effi', 'Hiệu suất KIỂM', 'efficiency', 'higher_better', 95, 15, 'mes', 4),
(2, '改善提案', 'Improvement', 'Đề xuất', 'teamwork', 'higher_better', 1, 10, 'manual', 5),
(2, '培训完成率', 'Training Comp', 'HT đào tạo', 'attendance', 'higher_better', 100, 10, 'training', 6),
(3, '产线产出', 'Line Output', 'Sản lượng dây', 'efficiency', 'higher_better', 100, 20, 'mes', 1),
(3, '产线良率', 'Line Yield', 'Tỷ lệ đạt dây', 'quality', 'higher_better', 97, 25, 'mes', 2),
(3, '人员流失率', 'Turnover Rate', 'Tỷ lệ nghỉ', 'teamwork', 'lower_better', 2, 15, 'hr', 3),
(3, '培训计划完成', 'Training Comp', 'HT đào tạo', 'teamwork', 'higher_better', 95, 10, 'training', 4),
(3, '安全事故', 'Safety Incidents', 'Sự cố AT', 'safety', 'lower_better', 0, 15, 'safety', 5),
(3, '5S评分', '5S Score', 'Điểm 5S', 'safety', 'higher_better', 90, 15, 'manual', 6),
(4, '良率改善', 'Yield Improvement', 'Cải thiện đạt', 'quality', 'higher_better', 2, 25, 'mes', 1),
(4, '改善项目数', 'Improvement Proj', 'Dự án cải tiến', 'efficiency', 'higher_better', 2, 20, 'manual', 2),
(4, '设备故障率', 'Downtime Rate', 'Thời gian chết', 'efficiency', 'lower_better', 2, 20, 'mes', 3),
(4, '交期达成', 'Delivery Rate', 'Tỷ lệ giao hàng', 'efficiency', 'higher_better', 98, 15, 'mes', 4),
(4, '技术文档', 'Tech Docs', 'Tài liệu kỹ thuật', 'efficiency', 'higher_better', 100, 10, 'manual', 5),
(4, '跨部门协作', 'Cross-team', 'Phối hợp liên BP', 'teamwork', 'higher_better', 80, 10, 'manual', 6);
