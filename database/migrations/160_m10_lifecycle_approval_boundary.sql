-- Only quality governance may extend an expired material's usable lifetime.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN('admin','quality','oqc') AND p.code='lifecycle.approve'
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp
USING roles r,permissions p
WHERE rp.role_id=r.id AND rp.permission_id=p.id
  AND p.code='lifecycle.approve' AND r.code NOT IN('admin','quality','oqc');
