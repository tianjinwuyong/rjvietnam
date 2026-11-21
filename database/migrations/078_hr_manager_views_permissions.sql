-- 078: Allow management and line-manager PDAs to read real-time HR dashboards.
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','management','plant_manager','hr_manager','line_manager_manual','line_manager_auto','line_manager_smt')
  AND p.code IN ('hr.view','org.view')
ON CONFLICT DO NOTHING;
