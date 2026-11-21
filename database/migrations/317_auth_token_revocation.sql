-- 317 — Sessions that can actually be revoked.
--
-- WHY THIS EXISTS. `POST /api/auth/logout` answered `{"revoked": true}` and wrote an
-- audit row, then did nothing else: no route consulted a revocation list, so the
-- token it had just "revoked" kept working for the rest of its 24 hours. Verified
-- live on 2026-11-20 — logout returned 200 and the same bearer token still returned
-- 200 from /wms/raw-material-inventory afterwards.
--
-- A JWT cannot be withdrawn, so the withdrawal is recorded here, by `jti`, and
-- services/api/server.js checks it on every authenticated request (in memory,
-- reloaded from this table at boot so a restart is not a re-login for a token that
-- was already signed out).
--
-- Rows are self-expiring: `expires_at` is the token's own `exp`, and the server
-- prunes anything past it. Nothing here is ever read as production history, so the
-- no-hard-delete rule does not apply — but nothing deletes a live row either.

CREATE TABLE IF NOT EXISTS auth_revoked_token (
  jti        text PRIMARY KEY,
  user_id    bigint,
  expires_at timestamptz NOT NULL,
  reason     text NOT NULL DEFAULT 'logout',
  revoked_at timestamptz NOT NULL DEFAULT now()
);

-- Boot loads "everything not yet expired"; this is that query.
CREATE INDEX IF NOT EXISTS idx_auth_revoked_token_expires_at
  ON auth_revoked_token (expires_at);
