-- M10: conflict decisions change canonical cross-system history and therefore
-- require a dedicated management permission, not ordinary warehouse execution.
INSERT INTO permissions(code,name_zh,name_en,name_vi,module,description,category)
VALUES(
  'wms.sync.manage',
  '管理MES-WMS同步冲突',
  'Manage MES-WMS synchronization conflicts',
  'Quản lý xung đột đồng bộ MES-WMS',
  'wms',
  'Approve or reject a quarantined MES-WMS data conflict',
  'wms'
)
ON CONFLICT(code) DO UPDATE SET
  name_zh=EXCLUDED.name_zh,
  name_en=EXCLUDED.name_en,
  name_vi=EXCLUDED.name_vi,
  module=EXCLUDED.module,
  description=EXCLUDED.description,
  category=EXCLUDED.category;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN('admin','management') AND p.code='wms.sync.manage'
ON CONFLICT DO NOTHING;
