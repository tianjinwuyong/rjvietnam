-- Close the plant-manager identity across HR and management views.
BEGIN;

INSERT INTO hr_employees (
  id, employee_no, name_zh, name_en, name_vi, gender,
  department_id, position_title, employment_type, join_date,
  status, created_at, updated_at
)
SELECT
  e.id, e.employee_no, e.full_name_zh, e.full_name_en, e.full_name_vi, 'M',
  e.department_id, COALESCE(p.name_zh, p.name_en, p.code),
  COALESCE(e.employment_type, 'full_time'), COALESCE(e.hire_date, CURRENT_DATE),
  e.status, COALESCE(e.created_at, NOW()), COALESCE(e.updated_at, NOW())
FROM employees e
LEFT JOIN positions p ON p.id = e.position_id
WHERE e.employee_no = 'MO_LI_BIN'
ON CONFLICT (id) DO UPDATE SET
  employee_no = EXCLUDED.employee_no,
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  department_id = EXCLUDED.department_id,
  position_title = EXCLUDED.position_title,
  employment_type = EXCLUDED.employment_type,
  join_date = EXCLUDED.join_date,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Plant manager can view and administer the HR/organization records needed
-- to close management actions; payroll remains separately controlled.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'plant_manager'
  AND p.code = ANY(ARRAY[
    'hr.view', 'hr.edit', 'hr.department', 'hr.position', 'hr.leave',
    'hr.attendance', 'org.view', 'org.edit',
    'pmc.view', 'mes.view', 'wms.view', 'quality.view', 'bom.view', 'admin.audit'
  ])
ON CONFLICT DO NOTHING;

INSERT INTO _migrations (filename, hash)
VALUES ('228_plant_manager_closed_loop_access.sql', 'plant-manager-closed-loop-access-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
