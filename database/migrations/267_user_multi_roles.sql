-- 267: a person (users row) may hold MULTIPLE PDA roles.
-- users.role_id stays as the primary role for legacy compatibility; user_roles
-- is the full assignment set. Login merges permissions across all roles and
-- returns roles[]; the PDA picks which role to operate as for the session.

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  granted_by  VARCHAR(64),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

-- Backfill existing single-role assignments as primary.
INSERT INTO user_roles (user_id, role_id, is_primary, granted_by)
SELECT u.id, u.role_id, true, 'MIGRATION_267'
  FROM users u
 WHERE u.role_id IS NOT NULL
ON CONFLICT (user_id, role_id) DO NOTHING;
