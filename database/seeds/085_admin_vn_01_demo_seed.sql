-- Optional development seed. Run only through `npm run migrate:seed` on a
-- non-production database.
INSERT INTO users (username, display_name, role_id, locale)
SELECT 'ADMIN_VN_01', 'Admin 01', id, 'en-US'
FROM roles
WHERE code = 'admin'
ON CONFLICT (username) DO NOTHING;
