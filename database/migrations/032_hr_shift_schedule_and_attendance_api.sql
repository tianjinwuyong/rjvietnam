-- ============================================================
-- HR Shift Schedule + Attendance API support tables
-- ============================================================

-- Shift schedule: employee × shift × date assignment
CREATE TABLE hr_shift_schedules (
  id            bigserial PRIMARY KEY,
  employee_id   bigint NOT NULL REFERENCES hr_employees(id),
  shift_id      bigint NOT NULL REFERENCES hr_shifts(id),
  schedule_date date NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'confirmed', 'absent')),
  remark        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, schedule_date)
);

-- Indexes
CREATE INDEX idx_shift_schedules_date    ON hr_shift_schedules(schedule_date);
CREATE INDEX idx_shift_schedules_employee ON hr_shift_schedules(employee_id);
CREATE INDEX idx_shift_schedules_shift   ON hr_shift_schedules(shift_id);
CREATE INDEX idx_shift_schedules_emp_date ON hr_shift_schedules(employee_id, schedule_date);

-- ============================================================
-- Attendance summary view (materialized for fast monthly reports)
-- ============================================================
-- Replaced by a non-materialized view below; caller can query directly.
-- Keeping this comment as placeholder for future partitioning strategy.

-- View: daily attendance summary grouped by shift
CREATE OR REPLACE VIEW v_hr_daily_attendance AS
SELECT
  a.work_date,
  s.id   AS shift_id,
  s.code AS shift_code,
  s.name_zh AS shift_name_zh,
  s.name_vi AS shift_name_vi,
  s.start_time,
  s.end_time,
  s.night_shift,
  COUNT(DISTINCT a.employee_id) AS headcount,
  COUNT(DISTINCT CASE WHEN a.status = 'normal'  THEN a.employee_id END) AS normal_count,
  COUNT(DISTINCT CASE WHEN a.status = 'late'    THEN a.employee_id END) AS late_count,
  COUNT(DISTINCT CASE WHEN a.status = 'early'   THEN a.employee_id END) AS early_count,
  COUNT(DISTINCT CASE WHEN a.status = 'absent'  THEN a.employee_id END) AS absent_count,
  COUNT(DISTINCT CASE WHEN a.status = 'leave'   THEN a.employee_id END) AS leave_count,
  COUNT(DISTINCT CASE WHEN a.status = 'holiday' THEN a.employee_id END) AS holiday_count,
  COUNT(DISTINCT CASE WHEN a.status = 'ot'      THEN a.employee_id END) AS ot_count,
  SUM(COALESCE(a.ot_hours, 0))          AS total_ot_hours,
  SUM(COALESCE(a.late_minutes, 0))      AS total_late_minutes,
  SUM(COALESCE(a.early_minutes, 0))    AS total_early_minutes,
  SUM(COALESCE(a.actual_work_hours, 0)) AS total_work_hours
FROM hr_attendance_records a
JOIN hr_shifts s ON s.id = a.shift_id
GROUP BY a.work_date, s.id, s.code, s.name_zh, s.name_vi, s.start_time, s.end_time, s.night_shift;

-- View: monthly attendance per employee
CREATE OR REPLACE VIEW v_hr_monthly_attendance AS
SELECT
  EXTRACT(YEAR FROM a.work_date)  AS year,
  EXTRACT(MONTH FROM a.work_date) AS month,
  a.employee_id,
  e.employee_no,
  e.name_zh,
  e.name_vi,
  d.id   AS department_id,
  d.name_zh AS dept_name_zh,
  COUNT(*)                                    AS total_days,
  COUNT(DISTINCT CASE WHEN a.status = 'normal'  THEN a.work_date END) AS normal_days,
  COUNT(DISTINCT CASE WHEN a.status = 'late'    THEN a.work_date END) AS late_days,
  COUNT(DISTINCT CASE WHEN a.status = 'early'   THEN a.work_date END) AS early_days,
  COUNT(DISTINCT CASE WHEN a.status = 'absent'  THEN a.work_date END) AS absent_days,
  COUNT(DISTINCT CASE WHEN a.status = 'leave'   THEN a.work_date END) AS leave_days,
  COUNT(DISTINCT CASE WHEN a.status = 'holiday' THEN a.work_date END) AS holiday_days,
  COUNT(DISTINCT CASE WHEN a.status = 'ot'      THEN a.work_date END) AS ot_days,
  SUM(COALESCE(a.actual_work_hours, 0)) AS total_work_hours,
  SUM(COALESCE(a.ot_hours, 0))          AS total_ot_hours,
  SUM(COALESCE(a.late_minutes, 0))      AS total_late_minutes,
  SUM(COALESCE(a.early_minutes, 0))    AS total_early_minutes
FROM hr_attendance_records a
JOIN hr_employees e ON e.id = a.employee_id
LEFT JOIN hr_departments d ON d.id = e.department_id
GROUP BY year, month, a.employee_id, e.employee_no, e.name_zh, e.name_vi, d.id, d.name_zh;
