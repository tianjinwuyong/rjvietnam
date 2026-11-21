-- HR master record for the Vietnam factory plant manager 莫立斌.
BEGIN;

INSERT INTO employees (
  employee_no, code, user_id, department_id, position_id,
  full_name, full_name_zh, full_name_en, full_name_vi,
  display_name, name_zh, name_en, name_vi,
  employment_type, hire_date, work_location, status
)
SELECT
  'MO_LI_BIN', 'MO_LI_BIN', u.id, d.id, p.id,
  '莫立斌', '莫立斌', 'Mo Libin', 'Mo Libin',
  '莫立斌', '莫立斌', 'Mo Libin', 'Mo Libin',
  'full_time', CURRENT_DATE, 'Vietnam Factory', 'active'
FROM users u
JOIN departments d ON d.code = 'MGMT'
JOIN positions p ON p.code = 'DIR-01'
WHERE u.username = 'MO_LI_BIN'
ON CONFLICT (employee_no) DO UPDATE SET
  code = EXCLUDED.code,
  user_id = EXCLUDED.user_id,
  department_id = EXCLUDED.department_id,
  position_id = EXCLUDED.position_id,
  full_name = EXCLUDED.full_name,
  full_name_zh = EXCLUDED.full_name_zh,
  full_name_en = EXCLUDED.full_name_en,
  full_name_vi = EXCLUDED.full_name_vi,
  display_name = EXCLUDED.display_name,
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  work_location = EXCLUDED.work_location,
  status = 'active',
  updated_at = NOW();

INSERT INTO _migrations (filename, hash)
VALUES ('227_hr_employee_mo_li_bin.sql', 'hr-employee-mo-li-bin-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
