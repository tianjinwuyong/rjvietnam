-- ============================================================
-- Customer Service Department Seed Data
-- 6 virtual CS agents: 3 male, 3 female
-- ============================================================

-- Position: CS Staff (below CS Lead)
INSERT INTO positions (code, department_id, name_zh, name_en, name_vi, position_level, level, is_shift_leader, status)
SELECT 'POS-CS-STAFF', d.id, '客服专员', 'CS Agent', 'Nhân viên CS', 'staff', 1, false, 'active'
FROM departments d WHERE d.code = 'DEP-CS'
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Employees: 6 CS agents
-- male: Adrian (启阳), Derek (峻熙), Ryan (睿铭)
-- female: Bella (芷晴), Chloe (怡然), Emily (诗韵)
-- ============================================================
INSERT INTO employees (
  employee_no, user_id, department_id, position_id,
  full_name, full_name_zh, full_name_en, full_name_vi,
  employment_type, hire_date, work_location, status,
  gender, phone, email
)
SELECT
  v.employee_no,
  u.id,
  d.id,
  p.id,
  v.full_name,     -- English name (Adrian, Derek...)
  v.name_zh,       -- Chinese name (启阳, 峻熙...)
  v.name_en,       -- English name (Adrian, Derek...)
  v.name_vi,       -- Vietnamese name (Khải Dương...)
  'full_time',
  date '2026-06-01',
  'Hanoi',
  'active',
  v.gender,
  v.phone,
  v.email
FROM (
  VALUES
    -- Male CS agents
    ('CS-0001', 'CS_ADRIAN', 'Adrian', '启阳', 'Adrian', 'Khải Dương', 'M', '+84 90 123 1001', 'adrian.cs@ruijing.vn'),
    ('CS-0002', 'CS_DEREK',  'Derek',  '峻熙', 'Derek', 'Tuấn Kiệt',  'M', '+84 90 123 1002', 'derek.cs@ruijing.vn'),
    ('CS-0003', 'CS_RYAN',   'Ryan',   '睿铭', 'Ryan', 'Duệ Minh',   'M', '+84 90 123 1003', 'ryan.cs@ruijing.vn'),
    -- Female CS agents
    ('CS-0004', 'CS_BELLA',  'Bella',  '芷晴', 'Bella', 'Trúc Tâm',   'F', '+84 90 123 1004', 'bella.cs@ruijing.vn'),
    ('CS-0005', 'CS_CHLOE',  'Chloe',  '怡然', 'Chloe', 'Diễm Nhiên', 'F', '+84 90 123 1005', 'chloe.cs@ruijing.vn'),
    ('CS-0006', 'CS_EMILY',  'Emily',  '诗韵', 'Emily', 'Thi Vận',    'F', '+84 90 123 1006', 'emily.cs@ruijing.vn')
) AS v(employee_no, username, full_name, name_zh, name_en, name_vi, gender, phone, email)
JOIN users u ON u.username = v.username
JOIN departments d ON d.code = 'DEP-CS'
JOIN positions p ON p.code = 'POS-CS-STAFF'
ON CONFLICT (employee_no) DO NOTHING;

-- User accounts for CS agents (login enabled)
-- NOTE: default password is 'CS@123456' — must be changed on first login
INSERT INTO users (username, display_name, role_id, locale)
SELECT
  v.username,
  v.display_name,
  r.id,
  v.locale
FROM (
  VALUES
    ('CS_ADRIAN', 'Adrian',  'zh-CN'),
    ('CS_DEREK',  'Derek',   'zh-CN'),
    ('CS_RYAN',   'Ryan',    'zh-CN'),
    ('CS_BELLA',  'Bella',   'zh-CN'),
    ('CS_CHLOE',  'Chloe',   'zh-CN'),
    ('CS_EMILY',  'Emily',   'zh-CN')
) AS v(username, display_name, locale)
JOIN roles r ON r.code = 'operator'
ON CONFLICT (username) DO NOTHING;
