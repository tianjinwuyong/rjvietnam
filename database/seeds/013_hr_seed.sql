-- ============================================================
-- HR & Organization Seed Data
-- Use ON CONFLICT DO NOTHING for idempotency.
-- FK references use code lookups instead of hardcoded IDs.
-- ============================================================

-- ============================================================
-- Departments
-- Schema: id, code, parent_id, name_zh, name_en, name_vi,
--         department_type (NOT NULL), status, created_at, updated_at,
--         dept_type (NOT NULL), headcount_target, manager_emp_id
-- ============================================================
INSERT INTO departments (code, name_zh, name_en, name_vi, department_type, dept_type, status)
VALUES
  ('MGMT', '管理层', 'Management', 'Quản lý', 'management', 'management', 'active'),
  ('PMC', '计划部', 'Planning', 'Kế hoạch', 'planning', 'planning', 'active'),
  ('WH', '仓库部', 'Warehouse', 'Kho', 'warehouse', 'warehouse', 'active'),
  ('IQC', '品质部', 'Quality', 'Chất lượng', 'quality', 'quality', 'active'),
  ('SMT', 'SMT 生产部', 'SMT Production', 'Sản xuất SMT', 'production', 'production', 'active'),
  ('ENG', '工程部', 'Engineering', 'Kỹ thuật', 'engineering', 'engineering', 'active'),
  ('ADMIN', '行政部', 'Admin', 'Hành chính', 'admin', 'admin', 'active')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Positions
-- Schema: id, code, department_id, name_zh, name_en, name_vi,
--         position_level (NOT NULL, CHECK: executive|manager|supervisor|staff),
--         status, created_at, updated_at, level, is_shift_leader
-- ============================================================
INSERT INTO positions (code, department_id, name_zh, name_en, name_vi, position_level, level, is_shift_leader, status)
SELECT v.code, d.id, v.name_en, v.name_en, v.name_vi, v.position_level, v.level, v.is_shift_leader, 'active'
FROM (
  VALUES
    ('DIR-01',   'Factory Director',        'Giám đốc nhà máy',           'executive',  5, false, 'MGMT'),
    ('MGR-01',   'PMC Manager',            'Trưởng phòng PMC',           'manager',    4, false, 'PMC'),
    ('MGR-02',   'Warehouse Manager',      'Trưởng phòng kho',           'manager',    4, false, 'WH'),
    ('MGR-03',   'Quality Manager',        'Trưởng phòng chất lượng',    'manager',    4, false, 'IQC'),
    ('MGR-04',   'SMT Production Manager', 'Trưởng phòng SMT',           'manager',    4, false, 'SMT'),
    ('MGR-05',   'Engineering Manager',    'Trưởng phòng kỹ thuật',      'manager',    4, false, 'ENG'),
    ('MGR-06',   'Admin Manager',         'Trưởng phòng hành chính',    'manager',    4, false, 'ADMIN'),
    ('SUP-01',   'SMT Technician',        'Kỹ thuật viên SMT',          'supervisor', 3, false, 'SMT'),
    ('SUP-02',   'SMT Team Leader',       'Tổ trưởng SMT',             'supervisor', 2, true,  'SMT'),
    ('SUP-03',   'QC Team Leader',        'Tổ trưởng QC',              'supervisor', 2, false, 'IQC'),
    ('STAFF-01', 'PMC Planner',           'Nhân viên kế hoạch',         'staff',      1, false, 'PMC'),
    ('STAFF-02', 'Warehouse Staff',       'Nhân viên kho',              'staff',      1, false, 'WH'),
    ('STAFF-03', 'IQC Inspector',         'Nhân viên IQC',              'staff',      1, false, 'IQC'),
    ('STAFF-04', 'Operator',              'Nhân viên vận hành',         'staff',      1, false, 'SMT'),
    ('STAFF-05', 'Process Engineer',      'Kỹ sư quy trình',            'staff',      1, false, 'ENG'),
    ('STAFF-06', 'Equipment Engineer',    'Kỹ sư thiết bị',             'staff',      1, false, 'ENG'),
    ('STAFF-07', 'Admin Officer',         'Nhân viên hành chính',        'staff',      1, false, 'ADMIN'),
    ('STAFF-08', 'Procurement Officer',   'Chủ quản thu mua',           'staff',      1, false, 'WH'),
    ('STAFF-09', 'Quality Staff',         'Nhân viên chất lượng',        'staff',      1, false, 'IQC'),
    ('STAFF-10', 'Cleaning Staff',        'Công nhân tạp vụ',           'staff',      1, false, 'ADMIN'),
    ('WORKER-01','Production Worker',      'Công nhân sản xuất',         'staff',      1, false, 'SMT')
) AS v(code, name_en, name_vi, position_level, level, is_shift_leader, dept_code)
JOIN departments d ON d.code = v.dept_code
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Management & Office Staff (15 employees)
-- These are the people already listed in the Excel — same names as some RJ entries
-- ============================================================
INSERT INTO employees (employee_no, code, full_name, full_name_zh, full_name_en, full_name_vi, employment_type, hire_date, status, department_id, position_id, manager_employee_id, reports_to_id, gender, phone, email)
SELECT
  v.employee_no,
  v.employee_no,
  v.full_name,
  v.name_zh,
  v.name_en,
  v.name_vi,
  'full_time',
  v.hire_date,
  'active',
  d.id,
  p.id,
  m.id,
  r.id,
  v.gender,
  v.phone,
  v.email
FROM (
  VALUES
    ('VN001', 'Thân Ngọc Toản',       '', 'Thân Ngọc Toản',      'Thân Ngọc Toản',      'M', '+84 90 123 0001', 'than.ngoc.toan@ruijing.vn',   date '2026-05-21', 'MGMT', 'DIR-01',   NULL, NULL),
    ('VN002', 'Nguyễn Thị Hương',    '', 'Nguyễn Thị Hương',   'Nguyễn Thị Hương',   'F', '+84 90 123 0002', 'nguyen.thi.huong@ruijing.vn', date '2026-05-23', 'WH',   'STAFF-08', 'VN001', 'VN001'),
    ('VN003', 'Nguyễn Thị Huyền',   '', 'Nguyễn Thị Huyền',   'Nguyễn Thị Huyền',   'F', '+84 90 123 0003', 'nguyen.thi.huyen@ruijing.vn', date '2026-07-11', 'PMC',  'STAFF-01', 'VN001', 'VN001'),
    ('VN004', 'Nguyễn Thị Kim Ngân', '', 'Nguyễn Thị Kim Ngân','Nguyễn Thị Kim Ngân', 'F', '+84 90 123 0004', 'nguyen.kim.ngan@ruijing.vn',  date '2026-07-13', 'IQC',  'STAFF-09', 'VN001', 'VN001'),
    ('VN005', 'Hoàng Văn Cương',     '', 'Hoàng Văn Cương',    'Hoàng Văn Cương',     'M', '+84 90 123 0005', 'hoang.van.cuong@ruijing.vn', date '2026-07-06', 'SMT',  'SUP-02',   'VN001', 'VN001'),
    ('VN006', 'Lăng Thị Tài',        '', 'Lăng Thị Tài',       'Lăng Thị Tài',        'F', '+84 90 123 0006', 'lang.thi.tai@ruijing.vn',    date '2026-07-14', 'IQC',  'SUP-03',   'VN001', 'VN001'),
    ('VN007', 'Lê Đắc Yên',          '', 'Lê Đắc Yên',         'Lê Đắc Yên',          'M', '+84 90 123 0007', 'le.dac.yen@ruijing.vn',       date '2026-06-05', 'ENG',  'STAFF-05', 'VN001', 'VN001'),
    ('VN008', 'Hoàng Văn Hưng',      '', 'Hoàng Văn Hưng',     'Hoàng Văn Hưng',      'M', '+84 90 123 0008', 'hoang.van.hung@ruijing.vn',   date '2026-07-16', 'ENG',  'STAFF-05', 'VN001', 'VN001'),
    ('VN009', 'Phan Văn Thanh',      '', 'Phan Văn Thanh',     'Phan Văn Thanh',      'M', '+84 90 123 0009', 'phan.van.thanh@ruijing.vn',   date '2026-07-21', 'ENG',  'STAFF-05', 'VN001', 'VN001'),
    ('VN010', 'Nguyễn Thị Chiến',   '', 'Nguyễn Thị Chiến',  'Nguyễn Thị Chiến',   'F', '+84 90 123 0010', 'nguyen.thi.chien@ruijing.vn', date '2026-07-20', 'ADMIN','STAFF-10', 'VN001', 'VN001'),
    ('VN011', 'Hoàng Thị Sản',       '', 'Hoàng Thị Sản',      'Hoàng Thị Sản',       'F', '+84 90 123 0011', 'hoang.thi.san@ruijing.vn',   date '2026-07-14', 'IQC',  'STAFF-09', 'VN001', 'VN001'),
    ('VN012', 'Dương Quang Thắng',   '', 'Dương Quang Thắng', 'Dương Quang Thắng',   'M', '+84 90 123 0012', 'duong.quang.thang@ruijing.vn',date '2026-07-04', 'SMT',  'SUP-02',   'VN001', 'VN001'),
    ('VN013', 'Tô Văn Cường',        '', 'Tô Văn Cường',      'Tô Văn Cường',        'M', '+84 90 123 0013', 'to.van.cuong@ruijing.vn',    date '2026-07-21', 'ENG',  'STAFF-05', 'VN001', 'VN001'),
    ('VN014', 'Nguyễn Văn Dũng',    '', 'Nguyễn Văn Dũng',   'Nguyễn Văn Dũng',     'M', '+84 90 123 0014', 'nguyen.van.dung@ruijing.vn',  date '2026-07-27', 'SMT',  'WORKER-01','VN005', 'VN005'),
    ('VN015', 'Trịnh Thị Hạ',        '', 'Trịnh Thị Hạ',      'Trịnh Thị Hạ',        'F', '+84 90 123 0015', 'trinh.thi.ha@ruijing.vn',    date '2026-07-21', 'WH',   'STAFF-02', 'VN001', 'VN001')
) AS v(employee_no, full_name, name_zh, name_en, name_vi, gender, phone, email, hire_date, dept_code, pos_code, manager_emp_no, reports_to_emp_no)
JOIN departments d ON d.code = v.dept_code
JOIN positions p ON p.code = v.pos_code
LEFT JOIN employees m ON m.employee_no = v.manager_emp_no
LEFT JOIN employees r ON r.employee_no = v.reports_to_emp_no
ON CONFLICT (employee_no) DO NOTHING;

-- ============================================================
-- Factory Workers (39 unique employees from Excel)
-- Duplicates with management names removed: RJ001, RJ002, RJ011, RJ033,
-- RJ037, RJ040, RJ041, RJ047, RJ056 are same person as VN entry
-- ============================================================
INSERT INTO employees (employee_no, code, full_name, full_name_zh, full_name_en, full_name_vi, employment_type, hire_date, status, department_id, position_id, manager_employee_id, reports_to_id, gender, phone, email)
SELECT
  v.employee_no,
  v.employee_no,
  v.full_name,
  '',
  v.full_name,
  v.full_name,
  'full_time',
  v.hire_date,
  'active',
  d.id,
  p.id,
  m.id,
  r.id,
  v.gender,
  '',
  ''
FROM (
  VALUES
    -- RJ006 | Dương Thị Trang | SMT Worker | F | 2026-05-22
    ('RJ006', 'Dương Thị Trang',    'F', date '2026-05-22', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ007 | Nguyễn Thị Nguyện | SMT Worker | F | 2026-05-22
    ('RJ007', 'Nguyễn Thị Nguyện', 'F', date '2026-05-22', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ008 | Dương Thị Liên | SMT Worker | F | 2026-05-22
    ('RJ008', 'Dương Thị Liên',    'F', date '2026-05-22', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ009 | Bùi Thị Vân | SMT Worker | F | 2026-05-22
    ('RJ009', 'Bùi Thị Vân',       'F', date '2026-05-22', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ010 | Dương Thị Thành | SMT Worker | F | 2026-05-22
    ('RJ010', 'Dương Thị Thành',   'F', date '2026-05-22', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ014 | Dương Thị Lụa | SMT Worker | F | 2026-06-15
    ('RJ014', 'Dương Thị Lụa',     'F', date '2026-06-15', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ015 | Hà Thanh Huế | SMT Worker | F | 2026-06-15
    ('RJ015', 'Hà Thanh Huế',       'F', date '2026-06-15', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ016 | Nguyễn Thị Quyên | SMT Worker | F | 2026-06-15
    ('RJ016', 'Nguyễn Thị Quyên',  'F', date '2026-06-15', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ017 | Tăng Thị Túc | SMT Worker | F | 2026-06-15
    ('RJ017', 'Tăng Thị Túc',      'F', date '2026-06-15', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ018 | Đỗ Đức Truyền | SMT Worker | M | 2026-06-16
    ('RJ018', 'Đỗ Đức Truyền',     'M', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ019 | Dương Thị Tuyết | SMT Worker | F | 2026-06-16
    ('RJ019', 'Dương Thị Tuyết',   'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ020 | Đặng Thị Hạnh | SMT Worker | F | 2026-06-16
    ('RJ020', 'Đặng Thị Hạnh',     'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ021 | Vũ Thị Thu Uyên | SMT Worker | F | 2026-06-16
    ('RJ021', 'Vũ Thị Thu Uyên',    'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ022 | Vũ Thị Lũy | SMT Worker | F | 2026-06-16
    ('RJ022', 'Vũ Thị Lũy',        'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ023 | Nguyễn Thị Hoàn | SMT Worker | F | 2026-06-16
    ('RJ023', 'Nguyễn Thị Hoàn',    'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ024 | Nguyễn Thị Vân | SMT Worker | F | 2026-06-16
    ('RJ024', 'Nguyễn Thị Vân',     'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ025 | Phùng Văn Tân | SMT Worker | M | 2026-06-16
    ('RJ025', 'Phùng Văn Tân',      'M', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ026 | Nguyễn Thị Thu | SMT Worker | F | 2026-06-16
    ('RJ026', 'Nguyễn Thị Thu',     'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ027 | Tăng Thị Hương | SMT Worker | F | 2026-06-16
    ('RJ027', 'Tăng Thị Hương',    'F', date '2026-06-16', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ028 | Nguyễn Thị Huệ | SMT Worker | F | 2026-07-02
    ('RJ028', 'Nguyễn Thị Huệ',     'F', date '2026-07-02', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ029 | Hoàng Thị Dung | SMT Worker | F | 2026-07-03
    ('RJ029', 'Hoàng Thị Dung',     'F', date '2026-07-03', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ031 | Dương Quang Thắng | SMT Worker | M | 2026-07-04  (duplicate name with VN012, but different person)
    ('RJ031', 'Dương Quang Thắng',  'M', date '2026-07-04', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ034 | Hoàng Quỳnh Hoa | SMT Worker | F | 2026-07-10
    ('RJ034', 'Hoàng Quỳnh Hoa',     'F', date '2026-07-10', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ035 | Đàm Thị Trang | SMT Worker | F | 2026-07-10
    ('RJ035', 'Đàm Thị Trang',      'F', date '2026-07-10', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ036 | Trương Thị Giang | SMT Worker | F | 2026-07-10
    ('RJ036', 'Trương Thị Giang',   'F', date '2026-07-10', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ038 | Hoàng Thị Tuyết | SMT Worker | F | 2026-07-13
    ('RJ038', 'Hoàng Thị Tuyết',    'F', date '2026-07-13', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ042 | Hoàng Thị Sản | IQC Staff | F | 2026-07-14 (different person from VN011, same name)
    ('RJ042', 'Hoàng Thị Sản',      'F', date '2026-07-14', 'IQC', 'STAFF-09', 'VN006', 'VN006'),
    -- RJ043 | Ngân Thị Luyến | SMT Worker | F | 2026-07-15
    ('RJ043', 'Ngân Thị Luyến',     'F', date '2026-07-15', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ044 | Chu Minh Phúc | SMT Worker | M | 2026-07-15
    ('RJ044', 'Chu Minh Phúc',       'M', date '2026-07-15', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ045 | Nguyễn Quang Hưng | SMT Worker | M | 2026-07-17
    ('RJ045', 'Nguyễn Quang Hưng',  'M', date '2026-07-17', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ046 | Nguyễn Thu Uyên | SMT Worker | F | 2026-07-17
    ('RJ046', 'Nguyễn Thu Uyên',    'F', date '2026-07-17', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ048 | Nguyễn Thị Chiến | Admin Cleaning | F | 2026-07-20 (different person from VN010, same name)
    ('RJ048', 'Nguyễn Thị Chiến',   'F', date '2026-07-20', 'ADMIN','STAFF-10', 'VN001', 'VN001'),
    -- RJ049 | Bùi Thị Thư | SMT Worker | F | 2026-07-20
    ('RJ049', 'Bùi Thị Thư',        'F', date '2026-07-20', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ050 | Trương Thị Thu | SMT Worker | F | 2026-07-20
    ('RJ050', 'Trương Thị Thu',      'F', date '2026-07-20', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ053 | Tô Văn Cường | ENG | M | 2026-07-21 (different person from VN013, same name)
    ('RJ053', 'Tô Văn Cường',       'M', date '2026-07-21', 'ENG',  'STAFF-05', 'VN007', 'VN007'),
    -- RJ054 | Nguyễn Thị Linh | SMT Worker | F | 2026-07-21
    ('RJ054', 'Nguyễn Thị Linh',    'F', date '2026-07-21', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ055 | Trịnh Thị Hạ | WH | F | 2026-07-21 (different person from VN015, same name)
    ('RJ055', 'Trịnh Thị Hạ',       'F', date '2026-07-21', 'WH',   'STAFF-02', 'VN001', 'VN001'),
    -- RJ057 | Phùng Thị Minh | SMT Worker | F | 2026-07-21
    ('RJ057', 'Phùng Thị Minh',     'F', date '2026-07-21', 'SMT', 'WORKER-01', 'VN005', 'VN005'),
    -- RJ058 | Nguyễn Văn Dũng | SMT Worker | M | 2026-07-27 (different person from VN014, same name)
    ('RJ058', 'Nguyễn Văn Dũng',   'M', date '2026-07-27', 'SMT', 'WORKER-01', 'VN005', 'VN005')
) AS v(employee_no, full_name, gender, hire_date, dept_code, pos_code, manager_emp_no, reports_to_emp_no)
JOIN departments d ON d.code = v.dept_code
JOIN positions p ON p.code = v.pos_code
LEFT JOIN employees m ON m.employee_no = v.manager_emp_no
LEFT JOIN employees r ON r.employee_no = v.reports_to_emp_no
ON CONFLICT (employee_no) DO NOTHING;

-- ============================================================
-- Update department managers (manager_emp_id column)
-- ============================================================
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'MGMT';
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'PMC';
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'WH';
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'IQC';
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'SMT';
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'ENG';
UPDATE departments SET manager_emp_id = (SELECT id FROM employees WHERE employee_no = 'VN001') WHERE code = 'ADMIN';

-- ============================================================
-- Attendance Records (2026-06-16) - sample for management staff
-- Note: partitioned table attendance_records_2026 inherits attendance_records
-- ============================================================
INSERT INTO attendance_records_2026 (employee_id, date, clock_in, clock_out, status)
SELECT e.id, date '2026-06-16', v.clock_in::time, v.clock_out::time, v.status
FROM (
  VALUES
    ('VN001', '07:55'::time, '17:05'::time, 'normal'),
    ('VN002', '07:50'::time, '17:10'::time, 'normal'),
    ('VN003', '08:05'::time, '17:00'::time, 'normal'),
    ('VN004', '08:30'::time, '17:15'::time, 'late'),
    ('VN005', '07:45'::time, '16:55'::time, 'normal'),
    ('VN006', '07:50'::time, '17:00'::time, 'normal'),
    ('VN007', '07:55'::time, '17:30'::time, 'normal'),
    ('VN008', '07:40'::time, '16:50'::time, 'normal'),
    ('VN009', '09:00'::time, '17:00'::time, 'late'),
    ('VN010', '07:50'::time, '17:05'::time, 'normal'),
    ('VN011', '07:55'::time, '17:00'::time, 'normal'),
    ('VN012', '07:48'::time, '17:02'::time, 'normal'),
    ('VN013', '08:15'::time, '17:20'::time, 'normal'),
    ('VN014', '07:50'::time, '17:10'::time, 'normal'),
    ('VN015', '07:55'::time, '16:45'::time, 'early')
) AS v(employee_no, clock_in, clock_out, status)
JOIN employees e ON e.employee_no = v.employee_no
ON CONFLICT DO NOTHING;

-- ============================================================
-- Leave Requests (sample)
-- ============================================================
INSERT INTO leave_requests (leave_no, employee_id, leave_type, start_date, end_date, reason, status, approved_by, approver_user_id, approved_at)
SELECT
  'LR-' || v.employee_code || '-001',
  e.id,
  v.leave_type,
  v.start_date::date,
  v.end_date::date,
  v.reason,
  v.status,
  (SELECT id FROM employees WHERE employee_no = 'VN001'),
  NULL,
  CASE WHEN v.status = 'approved' THEN '2026-06-15 09:00:00'::timestamptz ELSE NULL END
FROM (
  VALUES
    ('VN003', 'annual', '2026-06-20'::date, '2026-06-25'::date, 'Family vacation', 'approved'),
    ('VN008', 'sick',   '2026-06-18'::date, '2026-06-18'::date, 'Doctor appointment', 'approved'),
    ('VN009', 'other',  '2026-06-23'::date, '2026-06-23'::date, 'Personal matter', 'submitted'),
    ('VN004', 'annual', '2026-07-01'::date, '2026-07-05'::date, 'Home visit', 'submitted')
) AS v(employee_code, leave_type, start_date, end_date, reason, status)
JOIN employees e ON e.employee_no = v.employee_code
ON CONFLICT (leave_no) DO NOTHING;
