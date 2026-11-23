-- =============================================================================
-- 401: 四个“幽灵权限码”补种（wms.read / finance.view / reports.view /
--      procurement.purchaseOrders）
-- =============================================================================
-- 背景：requirePermission() 引用了这四个码，但 permissions 表从未有过这些行
-- ——任何角色都不可能被授予它们，相关路由对所有人恒 403（锡膏深链
-- ?view=wms&wmsTab=solderPaste 即 wms.read；GET /api/reports 即 reports.view）。
-- 本迁移按同族码的现有持有者补种，纯增量、幂等；server.js 的
-- REQUIRED_PERMISSION_ROLE_MAP 同步登记，保证新库 bootstrap 一致。
--
-- 镜像来源（2026-11-23 现网查询）：
--   wms.read                    ← wms.view 持有者 + warehouse（warehouse 已持
--                                 wms.receive/iqc/pick，只读严格更窄）
--   finance.view                ← finance.manage 持有者
--   procurement.purchaseOrders  ← procurement.view 持有者
--   reports.view                ← 前端 roleModuleAccess 中带 "reports" 模块的
--                                 角色全集（后端守卫必须与前端白名单同集合，
--                                 否则页面可见、接口 403）

BEGIN;

INSERT INTO permissions(code,name_zh,name_en,name_vi,category,module,status)
VALUES
  ('wms.read','WMS 只读','WMS Read','Đọc WMS','runtime_guard','wms','active'),
  ('finance.view','财务查看','Finance View','Xem tài chính','runtime_guard','finance','active'),
  ('reports.view','报表查看','Reports View','Xem báo cáo','runtime_guard','reports','active'),
  ('procurement.purchaseOrders','采购订单','Purchase Orders','Đơn mua hàng','runtime_guard','procurement','active')
ON CONFLICT(code) DO UPDATE SET status='active';

-- wms.read ← wms.view 持有者 ∪ warehouse
INSERT INTO role_permissions(role_id,permission_id)
SELECT rp.role_id, np.id
  FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  JOIN permissions np ON np.code = 'wms.read'
 WHERE p.code = 'wms.view'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'warehouse' AND p.code = 'wms.read'
ON CONFLICT DO NOTHING;

-- finance.view ← finance.manage 持有者
INSERT INTO role_permissions(role_id,permission_id)
SELECT rp.role_id, np.id
  FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  JOIN permissions np ON np.code = 'finance.view'
 WHERE p.code = 'finance.manage'
ON CONFLICT DO NOTHING;

-- procurement.purchaseOrders ← procurement.view 持有者
INSERT INTO role_permissions(role_id,permission_id)
SELECT rp.role_id, np.id
  FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  JOIN permissions np ON np.code = 'procurement.purchaseOrders'
 WHERE p.code = 'procurement.view'
ON CONFLICT DO NOTHING;

-- reports.view ← 前端 reports 模块受众（roleModuleAccess，2026-11-23 核对）
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE p.code = 'reports.view'
   AND r.code = ANY(ARRAY['admin','plant_manager','management','pmc','finance',
                         'purchasing','customer_service','hr_manager',
                         'reports_admin','reports_viewer',
                         'line_manager_smt','line_manager_manual','line_manager_auto'])
ON CONFLICT DO NOTHING;

COMMIT;
