-- Daily/product-specific factory assignment for PDA authorization.
-- HR remains the source for the employee's permanent position; this table
-- records the MES/PMC-approved assignment for a date, shift and production scope.

INSERT INTO permissions(code,name_zh,name_en,name_vi,category)
VALUES ('mes.line_assignment.manage','调整线别岗位','Manage line assignments','Quản lý phân công chuyền','mes')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','line_leader','engineering_manager')
  AND p.code='mes.line_assignment.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS hr_daily_line_role_assignments (
  id                    bigserial PRIMARY KEY,
  assignment_date       date NOT NULL,
  shift_code            varchar(30) NOT NULL,
  position_no           integer NOT NULL CHECK (position_no > 0),
  position_side         varchar(20) NOT NULL DEFAULT 'TOP' CHECK (position_side IN ('TOP','BOTTOM')),
  employee_id           bigint NOT NULL REFERENCES employees(id),
  line_id               bigint NOT NULL REFERENCES production_lines(id),
  supervisor_employee_id bigint REFERENCES employees(id),
  product_id            bigint REFERENCES products(id),
  work_order_code       varchar(80),
  role_code             varchar(60) NOT NULL,
  role_name_zh          varchar(120) NOT NULL,
  role_name_en          varchar(120) NOT NULL,
  role_name_vi          varchar(120) NOT NULL,
  loading_permission    varchar(80) NOT NULL DEFAULT 'NONE',
  permission_codes      text[] NOT NULL DEFAULT '{}',
  valid_from            timestamptz NOT NULL,
  valid_until           timestamptz NOT NULL,
  status                varchar(20) NOT NULL DEFAULT 'PLANNED',
  source_reference      varchar(120),
  created_by             bigint,
  confirmed_by          bigint REFERENCES employees(id),
  confirmed_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_daily_assignment_time_ck CHECK (valid_until > valid_from),
  CONSTRAINT hr_daily_assignment_status_ck CHECK (status IN ('PLANNED','ACTIVE','CANCELLED','CLOSED')),
  CONSTRAINT hr_daily_assignment_permission_ck CHECK (loading_permission IN ('NONE','VIEW','LOAD','LOAD_AND_RELEASE'))
);
ALTER TABLE hr_daily_line_role_assignments ADD COLUMN IF NOT EXISTS position_side varchar(20) NOT NULL DEFAULT 'TOP';

CREATE INDEX IF NOT EXISTS idx_hr_daily_assignment_employee_time
  ON hr_daily_line_role_assignments(employee_id, assignment_date, valid_from, valid_until)
  WHERE status IN ('PLANNED','ACTIVE');
CREATE INDEX IF NOT EXISTS idx_hr_daily_assignment_line_time
  ON hr_daily_line_role_assignments(line_id, assignment_date, valid_from, valid_until)
  WHERE status IN ('PLANNED','ACTIVE');
CREATE INDEX IF NOT EXISTS idx_hr_daily_assignment_wo
  ON hr_daily_line_role_assignments(work_order_code)
  WHERE work_order_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_daily_assignment_position
  ON hr_daily_line_role_assignments(line_id, assignment_date, shift_code, position_no);
