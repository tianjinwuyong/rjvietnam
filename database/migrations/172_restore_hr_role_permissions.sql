BEGIN;

-- Later role/schema migrations may recreate roles after 003_hr_permissions ran.
-- Reconcile by stable role/permission codes rather than historical numeric ids.
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code LIKE 'hr.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'management'
  AND p.code IN ('hr.view', 'hr.admin', 'hr.department', 'hr.position',
                 'hr.leave', 'hr.attendance', 'hr.salary')
ON CONFLICT DO NOTHING;

INSERT INTO _migrations(filename, hash)
VALUES ('172_restore_hr_role_permissions.sql', 'restore-hr-role-permissions-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
