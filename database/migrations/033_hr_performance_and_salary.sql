-- ============================================================
-- HR Performance Management & Salary Calculation
-- Migration 033
-- ============================================================

CREATE TABLE performance_reviews (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES employees(id),
  period_type     varchar(20) NOT NULL,
  period_value    varchar(20) NOT NULL,
  review_date     date NOT NULL,
  reviewer_id     bigint REFERENCES employees(id),
  total_score     numeric(5,2) DEFAULT 0,
  rating          varchar(20),
  status          varchar(20) NOT NULL DEFAULT 'draft',
  overall_comment text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE performance_review_items (
  id              bigserial PRIMARY KEY,
  review_id       bigint NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  kpi_name_zh     varchar(100) NOT NULL,
  kpi_name_en     varchar(100) NOT NULL,
  kpi_name_vi     varchar(100) NOT NULL,
  target          numeric(10,2) NOT NULL DEFAULT 0,
  actual          numeric(10,2) NOT NULL DEFAULT 0,
  unit            varchar(20) DEFAULT '',
  weight          numeric(5,2) NOT NULL DEFAULT 0,
  score           numeric(5,2) DEFAULT 0,
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE performance_kpis (
  id              bigserial PRIMARY KEY,
  name_zh         varchar(100) NOT NULL,
  name_en         varchar(100) NOT NULL,
  name_vi         varchar(100) NOT NULL,
  unit            varchar(20) DEFAULT '',
  target_min      numeric(10,2) DEFAULT 0,
  target_max      numeric(10,2) DEFAULT 100,
  weight          numeric(5,2) DEFAULT 10,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE salary_allowances (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES employees(id),
  allowance_type  varchar(30) NOT NULL,
  amount          numeric(10,2) NOT NULL DEFAULT 0,
  effective_from  date NOT NULL,
  effective_to    date,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE salary_records (
  id              bigserial PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES employees(id),
  year            int NOT NULL,
  month           int NOT NULL,
  base_salary     numeric(12,2) NOT NULL DEFAULT 0,
  normal_days     numeric(5,2) NOT NULL DEFAULT 0,
  absent_days     numeric(5,2) NOT NULL DEFAULT 0,
  late_count      int NOT NULL DEFAULT 0,
  early_count     int NOT NULL DEFAULT 0,
  ot_hours        numeric(6,2) NOT NULL DEFAULT 0,
  ot_rate         numeric(5,2) NOT NULL DEFAULT 1.5,
  allowances_total numeric(12,2) NOT NULL DEFAULT 0,
  bonus_performance numeric(12,2) NOT NULL DEFAULT 0,
  bonus_attendance  numeric(12,2) NOT NULL DEFAULT 0,
  bonus_other       numeric(12,2) NOT NULL DEFAULT 0,
  deduction_late    numeric(12,2) NOT NULL DEFAULT 0,
  deduction_absent  numeric(12,2) NOT NULL DEFAULT 0,
  deduction_other   numeric(12,2) NOT NULL DEFAULT 0,
  personal_tax    numeric(12,2) NOT NULL DEFAULT 0,
  social_insurance numeric(12,2) NOT NULL DEFAULT 0,
  health_insurance  numeric(12,2) NOT NULL DEFAULT 0,
  unemployment_ins  numeric(12,2) NOT NULL DEFAULT 0,
  gross_salary    numeric(12,2) NOT NULL DEFAULT 0,
  total_deductions numeric(12,2) NOT NULL DEFAULT 0,
  net_salary      numeric(12,2) NOT NULL DEFAULT 0,
  status          varchar(20) NOT NULL DEFAULT 'draft',
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, year, month)
);

CREATE INDEX idx_perf_reviews_employee ON performance_reviews(employee_id);
CREATE INDEX idx_perf_reviews_period  ON performance_reviews(period_type, period_value);
CREATE INDEX idx_perf_review_items     ON performance_review_items(review_id);
CREATE INDEX idx_salary_emp_month      ON salary_records(employee_id, year, month);
CREATE INDEX idx_salary_allowances_emp ON salary_allowances(employee_id, active);
CREATE INDEX idx_perf_kpis_active      ON performance_kpis(active);

INSERT INTO performance_kpis (name_zh, name_en, name_vi, unit, target_min, target_max, weight) VALUES
  ('产出良品率', 'First Pass Yield', 'Tỷ lệ đạt chất lượng đầu tiên', '%', 98, 100, 25),
  ('产出数量达成率', 'Output Target Achievement', 'Tỷ lệ hoàn thành sản lượng', '%', 95, 100, 25),
  ('设备保养配合度', 'Equipment Maintenance Compliance', 'Tuân thủ bảo trì thiết bị', '%', 90, 100, 15),
  ('5S现场整洁度', '5S Workplace cleanliness', 'Mức độ sạch sẽ 5S', '%', 85, 100, 10),
  ('出勤率', 'Attendance Rate', 'Tỷ lệ chuyên cần', '%', 98, 100, 15),
  ('安全规范遵守', 'Safety Compliance', 'Tuân thủ an toàn', '%', 100, 100, 10);
