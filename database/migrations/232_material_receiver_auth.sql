-- Dedicated login for the unified PDA / scanner material-receiving workflow.
INSERT INTO roles (code, name_zh, name_en, name_vi)
VALUES ('material_receiver', '物料收料员', 'Material Receiver', 'Nhân viên nhận vật liệu')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'material_receiver'
  AND p.code IN ('wms.view', 'wms.read', 'wms.receive', 'wms.execute', 'pda.view')
ON CONFLICT DO NOTHING;

INSERT INTO users (username, display_name, role_id, locale, status)
SELECT 'VN_MATERIAL_RECEIVER', 'SMT Material Receiver', r.id, 'zh-CN', 'active'
FROM roles r WHERE r.code = 'material_receiver'
ON CONFLICT (username) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role_id = EXCLUDED.role_id,
  locale = EXCLUDED.locale,
  status = 'active';
