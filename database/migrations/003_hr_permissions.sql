-- ============================================================
-- HR & System Permissions
-- Additive migration: extends permissions table created by 002_strengthen_mvp_schema.sql
-- The permissions table in 002 uses 'module' column; this file uses 'description' + 'category'.
-- ============================================================

-- Add missing columns if they don't exist in the permissions table from 002
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS category varchar(30) NOT NULL DEFAULT 'general';

-- Clear existing HR permission data for idempotency
DELETE FROM role_permissions USING permissions
  WHERE role_permissions.permission_id = permissions.id AND permissions.category = 'hr';
DELETE FROM permissions WHERE category = 'hr';

-- ============================================================
-- HR Permissions (category='hr')
-- ============================================================

INSERT INTO permissions (code, name_zh, name_en, name_vi, module, description, category)
VALUES
  ('hr.view',          '查看员工',         'View Employees',          'Xem nhân viên',         'hr', 'View employee directory and profiles',          'hr'),
  ('hr.edit',          '管理员工',         'Manage Employees',        'Quản lý nhân viên',      'hr', 'Create and edit employee records',              'hr'),
  ('hr.admin',         'HR 管理权限',      'HR Administration',        'Quản trị HR',            'hr', 'Full HR system administration',                'hr'),
  ('hr.department',    '管理部门',         'Manage Departments',       'Quản lý phòng ban',      'hr', 'Manage departments and org structure',         'hr'),
  ('hr.position',      '管理职位',         'Manage Positions',         'Quản lý chức vụ',        'hr', 'Manage positions and job titles',              'hr'),
  ('hr.leave',         '请假管理',         'Leave Management',         'Quản lý nghỉ phép',      'hr', 'Approve/reject leave requests',                'hr'),
  ('hr.attendance',    '考勤管理',         'Attendance Management',    'Quản lý chấm công',      'hr', 'Manage attendance records',                    'hr'),
  ('hr.salary',        '薪资管理',         'Salary Management',        'Quản lý lương',          'hr', 'View and manage salary information',           'hr'),
  ('org.view',         '查看组织架构',     'View Org Chart',          'Xem cơ cấu tổ chức',     'hr', 'View organization chart',                      'hr'),
  ('org.edit',         '编辑组织架构',     'Edit Org Chart',          'Chỉnh sửa cơ cấu',       'hr', 'Edit organization structure',                   'hr')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- General / System Permissions
-- ============================================================

INSERT INTO permissions (code, name_zh, name_en, name_vi, module, description, category)
VALUES
  ('pmc.view',         '查看工单',         'View Work Orders',        'Xem đơn công việc',      'pmc', 'View PMC work orders',                         'pmc'),
  ('pmc.edit',         '管理工单',         'Manage Work Orders',      'Quản lý đơn công việc',  'pmc', 'Create and edit work orders',                   'pmc'),
  ('mes.view',         '查看生产',         'View MES',                'Xem sản xuất',           'mes', 'View MES data',                                'mes'),
  ('mes.execute',      '执行生产',         'Execute MES',             'Thực thi sản xuất',      'mes', 'Execute MES operations',                       'mes'),
  ('wms.view',         '查看仓库',         'View WMS',                'Xem kho',                'wms', 'View WMS data',                                'wms'),
  ('wms.edit',         '管理仓库',         'Manage WMS',              'Quản lý kho',            'wms', 'Manage WMS operations',                        'wms'),
  ('quality.view',     '查看质量',         'View Quality',            'Xem chất lượng',         'quality', 'View quality data',                            'quality'),
  ('quality.execute',  '质量检验',         'Quality Inspection',       'Kiểm tra chất lượng',    'quality', 'Execute quality inspections',                   'quality'),
  ('bom.view',         '查看 BOM',         'View BOM',                'Xem BOM',                'bom', 'View bill of materials',                       'bom'),
  ('bom.edit',         '管理 BOM',         'Manage BOM',              'Quản lý BOM',            'bom', 'Create and edit BOMs',                         'bom'),
  ('admin.system',     '系统管理',         'System Admin',            'Quản trị hệ thống',      'admin', 'System administration',                         'admin'),
  ('admin.audit',      '审计日志',         'Audit Logs',              'Nhật ký kiểm toán',      'admin', 'View audit logs',                              'admin')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Role → Permission Assignments
-- ============================================================

-- admin (id=9): all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'admin';

-- management (id=1): all HR permissions + broad view permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'management'
  AND (p.category = 'hr' OR p.code IN ('pmc.view','mes.view','wms.view','quality.view','bom.view','admin.audit'));

-- pmc (id=2): pmc + bom.view + mes.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'pmc' AND p.code IN ('pmc.view','pmc.edit','bom.view','mes.view');

-- warehouse (id=3): wms permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'warehouse' AND p.code IN ('wms.view','wms.edit');

-- quality (id=4): quality + mes.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'quality' AND p.code IN ('quality.view','quality.execute','mes.view');

-- engineering (id=6): mes + bom permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'engineering' AND p.code IN ('mes.view','mes.execute','bom.view','bom.edit','pmc.view');

-- smt_operator (id=5): basic mes + wms view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'smt_operator' AND p.code IN ('mes.view','wms.view');

-- oqc (id=7): quality + mes view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'oqc' AND p.code IN ('quality.view','quality.execute','mes.view');

-- rework (id=8): quality + mes execute
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'rework' AND p.code IN ('quality.view','quality.execute','mes.view','mes.execute');

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
