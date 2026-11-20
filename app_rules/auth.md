# Auth Rules

## Owns

- auth flows in `services/api`
- auth-related shared contracts
- auth-specific docs

## May edit

- login/logout/session/current-user logic
- role and permission policy code
- auth tests
- auth contract shapes

## Must not edit

- database schema unless the schema worker is explicitly handing off a field
- UI layout unless a login or session screen is required
- unrelated business module logic

## Required rules

1. Keep the auth contract aligned with the user, role, and permission schema.
2. Do not store secrets in plain text.
3. Every deny path must be auditable.
4. Keep login, logout, current-user, and route-gate behavior explicit and testable.
5. Treat permission checks as part of the API boundary, not as UI hints.

## Required checks

- Verify role-to-permission mapping for each visible module.
- Verify failed and successful login paths are logged or emitted as audit events.
- Verify session expiration and logout behavior are consistent.

## Session tokens (JWT)

- **One signer, one verifier.** `issueSessionToken()` / `decodeSessionToken()` in
  `services/api/server.js` (~line 909). Every login path (`/api/auth/login`,
  `/auth/station-login`) signs through it, and every route that reads a token
  verifies through it, so `algorithms: ["HS256"]` and the `jti` cannot be missing
  from one copy.
- **Logout revokes.** `jti` is written to `auth_revoked_token`
  (`database/migrations/317_auth_token_revocation.sql`, also created by runtime DDL
  at boot) and reloaded at startup, so a revoked token stays dead across a restart
  and across the second API process the harness starts.
- **Account state is checked per request.** `active` is required; a deleted user is
  `401 AUTH_FAILED`, a non-active one is `403 ACCOUNT_LOCKED`, a DB outage is
  `503 AUTH_UNAVAILABLE` (never a fake `401 TOKEN_INVALID`). Cached 60 s per user.
- **Login throttle is per username, not per IP.** Five failures block that operator
  for 15 min; the IP key only guards sprays (50). `trust proxy` is off, so a tight
  IP limit from nginx would lock the whole site out.
- **`/auth/station-login` needs a device credential once `STATION_LOGIN_KEY` is
  set.** `x-station-key` must match, compared on sha256 digests with
  `timingSafeEqual` (`stationKeyFailure()`) so the response time does not walk the
  key byte by byte. No header is `401 STATION_KEY_MISSING`, a wrong one is
  `401 STATION_KEY_INVALID`. Neither is audited: a mis-provisioned terminal retries
  on a timer and would flood `audit_logs`, and the IP throttle already caps it.
  While the variable is unset the boot log says so loudly, because the endpoint
  then mints a full-permission session from a username alone.
- **Terminals are provisioned at deploy time, not built with the key.** Copy
  `apps/station-agent/public/station-config.example.js` to `station-config.js`
  (gitignored) beside it with the value pasted in; the bundle reads
  `window.__STATION_AGENT__.stationKey`, else sessionStorage `station_key`, and
  sends the header. Set the key on the API **after** every terminal carries it —
  an unprovisioned scanner cannot sign in at all. It stays empty in development
  and under the harness on purpose: `harness/END-TO-END.md` J1 step 3 signs in
  with no header, so switching it on locally breaks a protected journey. The prod
  compose file takes it from the deploy host's `.env` (`${STATION_LOGIN_KEY:-}`).
- **Switching the key on is a two-step move, not a flip.**
  `STATION_LOGIN_KEY_FLAG_UNTIL` (ISO timestamp) opens a grace window: while it is
  open a terminal that sends no header is still accepted and recorded once per
  machine as `STATION_LOGIN_UNPROVISIONED` (`reference_no` = `<operator>@<station>`),
  and the boot line says `enforced from <deadline>`. A key that is present and
  wrong is refused the whole time — grace covers "not provisioned yet", never
  "wrong credential". Empty, unparsable or past deadline = enforced. This mirrors
  `MES_SIGNATURE_ENFORCEMENT` / `MES_SIGNATURE_FLAG_UNTIL`, the pattern this repo
  already uses to require a credential that not every client sends yet.
  The list to provision from is readable without psql:
  `GET /admin/audit-logs?eventType=STATION_LOGIN_UNPROVISIONED` (needs `admin.view`;
  `data.items[].referenceNo` is `<operator>@<station>`, `data.total` is how many are
  still missing the file). That endpoint was itself dead until 2026-11-21 — it
  selected `event_type`, `status`, `actor` and `details`, four columns `audit_logs`
  has never had, so every authenticated call returned 500 `字段 al.event_type 不存在`
  and the trail could only be read from the database. It now maps to the real
  columns (`action`, `actor_id`→`users.username`, `entity_type`, `reference_no`) and
  keeps `eventType` as the wire name; `total` shares the row predicate.
- The per-token `permissions[]` are frozen at login: a role change takes effect at
  the next sign-in, not mid-session.
- **Station login is for floor roles only.** `services/api/src/auth/station-login-policy.js`
  refuses any role holding `admin.*`, `finance.*`, `hr.admin`, `hr.salary` or `*`;
  `STATION_LOGIN_ALLOW_ROLES` re-opens a named role on purpose; `STATION_LOGIN_ALLOW_OPERATORS`
  (comma-separated **usernames**) lets one person with an office role stand at a
  machine — `MO_LI_BIN` (总经理, role `admin`) relies on it, set in
  `docker-compose.prod.yml` and in both `.env` files. Such a session writes
  `STATION_LOGIN_EXCEPTION` (`named:<user>@<station>:role:<code>`) so the grant is
  visible, never silent. Floor approvals (`smt.loading.approve`,
  `lifecycle.approve`) are deliberately not privileged.
- **Deny paths are audited.** `audit_logs.action` gains `LOGIN_DENIED`
  (`reference_no` = `<reason>:<username>`) and `STATION_LOGIN_DENIED`
  (`role:<code>@<station>:<blocked perms>`). Only the auth boundary logs — a
  per-request audit of every rejected token would be a write per probe.
- **UI screens that call `fetch()` directly must send the token** through
  `authHeaders()` from `apps/web/src/api/client.ts`; the boundary checks they hit
  are not UI hints.

### Known open surface (measured 2026-11-20)

280 app-level routes are declared *above* the app-level JWT gate (line ~16860), 177
of them with no auth in their own handler list: 79 mutating. The clearance- and
approval-shaped ones are now guarded inline (`scrap-requests` assessment/approve/
reject, `handovers/:id/acknowledge-alarm`, `smt/loading/approvals/:sessionId/decision`,
`smt/loading/offline-events/:eventId/leader-decision`). What remains open is station
telemetry (`/api/station/activity`, `/api/pda/events`, `/api/mes/heartbeat/:code`,
`/api/smt/loading/*` machine steps) — device paths that carry no JWT today. Closing
them needs a device key at the adapter, not a route guard, and is a separate change.

## Handoff

- If auth needs a new persisted field or table, write the dependency clearly for the database lane.
