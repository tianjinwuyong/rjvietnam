-- 077: MES-routed communication channels for line managers and departments.
-- Channels address HR/MES roles, never an uncontrolled device list.

INSERT INTO roles (code, name_zh, name_en, name_vi)
VALUES
  ('line_manager_manual', '手动线线长', 'Manual Line Manager', 'Quản lý chuyền thủ công'),
  ('line_manager_auto', '自动线线长', 'Auto Line Manager', 'Quản lý chuyền tự động'),
  ('line_manager_smt', 'SMT 线线长', 'SMT Line Manager', 'Quản lý chuyền SMT'),
  ('hr_manager', 'HR 经理', 'HR Manager', 'Quản lý nhân sự'),
  ('purchasing', '采购', 'Purchasing', 'Mua hàng')
ON CONFLICT (code) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('plant_manager','management','line_manager_manual','line_manager_auto','line_manager_smt','hr_manager','warehouse','purchasing','pmc','quality','engineering')
  AND p.code IN ('management.communication.view','management.communication.send','management.communication.ack')
ON CONFLICT DO NOTHING;

INSERT INTO mes_manager_channels(channel_code,name_zh,name_en,name_vi,recipient_role_codes)
VALUES
 ('ALL_DEPARTMENTS','全部门协同','All Departments','Tất cả phòng ban',ARRAY['plant_manager','management','pmc','quality','engineering','warehouse','purchasing','hr_manager','line_manager_manual','line_manager_auto','line_manager_smt']),
 ('LINE_MANAGERS','三条线线长','Line Managers','Quản lý các chuyền',ARRAY['plant_manager','management','line_manager_manual','line_manager_auto','line_manager_smt','pmc','quality','engineering']),
 ('HR','人力资源','Human Resources','Nhân sự',ARRAY['plant_manager','management','hr_manager','line_manager_manual','line_manager_auto','line_manager_smt']),
 ('WMS','WMS/仓库','WMS / Warehouse','WMS / Kho',ARRAY['plant_manager','management','warehouse','production_transport','line_manager_manual','line_manager_auto','line_manager_smt']),
 ('PURCHASING','采购','Purchasing','Mua hàng',ARRAY['plant_manager','management','purchasing','finance','pmc','warehouse']),
 ('PMC','PMC 计划','PMC Planning','Kế hoạch PMC',ARRAY['plant_manager','management','pmc','line_manager_manual','line_manager_auto','line_manager_smt','warehouse','purchasing']),
 ('QUALITY','质量','Quality','Chất lượng',ARRAY['plant_manager','management','quality','oqc','line_manager_manual','line_manager_auto','line_manager_smt'])
ON CONFLICT (channel_code) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  recipient_role_codes = EXCLUDED.recipient_role_codes,
  status = 'ACTIVE';
