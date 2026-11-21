-- Grant 莫立斌 the same full management-system access as the existing admin account.
-- The HR identity and Factory Director position remain unchanged.
BEGIN;

UPDATE users
SET role_id = COALESCE((SELECT id FROM roles WHERE code = 'admin'), role_id),
    status = 'active',
    updated_at = NOW()
WHERE username = 'MO_LI_BIN';

INSERT INTO _migrations (filename, hash)
VALUES ('229_mo_li_bin_full_management_access.sql', 'mo-li-bin-full-management-access-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
