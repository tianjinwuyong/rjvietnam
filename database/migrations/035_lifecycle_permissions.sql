-- ============================================================
-- Lifecycle Management Permissions
-- Category: lifecycle
-- ============================================================

-- Add category column if not exists (handle case where earlier migrations added it differently)
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS category varchar(20) NOT NULL DEFAULT 'general';

-- Clear existing lifecycle permissions for idempotency
DELETE FROM role_permissions USING permissions
  WHERE role_permissions.permission_id = permissions.id AND permissions.category = 'lifecycle';
DELETE FROM permissions WHERE category = 'lifecycle';

-- Insert lifecycle permissions
INSERT INTO permissions (code, name_zh, name_en, name_vi, module, description, category)
VALUES
  ('lifecycle.view',   '查看有效期管控',   'View Lifecycle Data',    'Xem dữ liệu tuổi thọ',      'lifecycle', '查看物料有效期管控数据（台账/预警/复检/开封/报废）', 'lifecycle'),
  ('lifecycle.edit',  '管理有效期管控',   'Manage Lifecycle Data',  'Quản lý tuổi thọ',         'lifecycle', '编辑预警状态/复检报告/开封记录/报废申请',           'lifecycle'),
  ('lifecycle.approve', '审批报废申请',   'Approve Scrapping',      'Phê duyệt thanh lý',       'lifecycle', '审批过期物料报废申请',                               'lifecycle')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Role → Permission Assignments
-- ============================================================

-- admin (code='admin'): gets ALL lifecycle permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.category = 'lifecycle';

-- warehouse (code='warehouse'): lifecycle.view + lifecycle.edit (manage stock lifecycle)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'warehouse'
  AND p.category = 'lifecycle'
  AND p.code IN ('lifecycle.view', 'lifecycle.edit');

-- quality (code='quality'): lifecycle.view + lifecycle.edit (can do reinspection)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'quality'
  AND p.category = 'lifecycle'
  AND p.code IN ('lifecycle.view', 'lifecycle.edit');

-- management (code='management'): lifecycle.view only (read-only)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'management' AND p.code = 'lifecycle.view';

-- pmc (code='pmc'): lifecycle.view (read PMC-level expiry risk)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'pmc' AND p.code = 'lifecycle.view';
