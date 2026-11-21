-- 075: Dedicated plant manager role for production exception authority.
-- Creates no users and does not grant access to any individual until HR maps an employee.

INSERT INTO roles (code, name_zh, name_en, name_vi)
VALUES ('plant_manager', '厂长', 'Plant Manager', 'Quản đốc nhà máy')
ON CONFLICT (code) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'plant_manager'
  AND p.code IN (
    'management.communication.view',
    'management.communication.send',
    'management.communication.ack',
    'management.exception.authorize'
  )
ON CONFLICT DO NOTHING;
