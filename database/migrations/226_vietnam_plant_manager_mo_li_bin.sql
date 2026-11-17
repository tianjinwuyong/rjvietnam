-- Formal Vietnam factory plant-manager account for 莫立斌.
-- Authentication follows the existing backend policy for non-special users
-- (Factory@123); rotate that credential before production use.
BEGIN;

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
  AND p.code = ANY(ARRAY[
    'management.communication.view',
    'management.communication.send',
    'management.communication.ack',
    'management.exception.authorize',
    'pda.view'
  ])
ON CONFLICT DO NOTHING;

INSERT INTO users (username, display_name, role_id, locale, status)
SELECT 'MO_LI_BIN', '莫立斌', r.id, 'zh-CN', 'active'
FROM roles r
WHERE r.code = 'plant_manager'
ON CONFLICT (username) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role_id = EXCLUDED.role_id,
  locale = EXCLUDED.locale,
  status = 'active',
  updated_at = NOW();

INSERT INTO _migrations (filename, hash)
VALUES ('226_vietnam_plant_manager_mo_li_bin.sql', 'vietnam-plant-manager-mo-li-bin-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
