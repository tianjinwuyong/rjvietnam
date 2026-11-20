# SMT Factory System — Agent Operational Guide

**Workspace**: `C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\`

## Stack
- React 18.3.1 + Vite 5.4.21 + TypeScript + Express 5.2.1 + Vitest 4.1.9 + PostgreSQL (raw `pg`, no ORM).
- **Runtime**: Node.js (ESM), npm workspaces: `apps/*`, `services/*`, `packages/*`.
- **Localization**: `zh-CN`, `en-US`, `vi-VN` (i18n keys only).

## Developer Commands
- **Launch everything**: `node start_dev.js` — API `:8080`, Vite web `:5178`, supplier portal `:8098` (needs `py -3.14` + uvicorn), factory3d `:5179`. Auto-restarts any child that exits. (`npm run dev` is an alternative launcher, `scripts/dev-all.mjs`.)
- **Tests**: `npm run test` (vitest; e2e/hardware/3d specs are excluded here), `npm run test:grade` (behaviour-only subset — the only suite whose verdict may be used as a pass/fail *grading* signal), `npm run test:e2e` (Playwright), `npm run test:hardware`.
- **Single test**: `npx vitest run path/to/file.test.ts` (config: `vitest.config.ts`).
- **Typecheck**: `npm run typecheck` — **weak gate**: `tsconfig.base.json` only includes `apps/web/src` + `packages/*/src`; services and tests are not covered. `npm run typecheck:tests` is the stricter gate. `services/api/server.js` is plain JS — never typechecked.
- **Migrations**: `node scripts/migrate.mjs` (supports `--plan`, `--seed`, `--fresh`).
- **Migration gate**: `npm run check:migrations` — append-only + duplicate-prefix ratchet (44 colliding prefixes / 110 files on colliding numbers are baselined in `.factory/locks/migrations-baseline.json`; a new collision or an edited/deleted migration fails).

## Monorepo Map
- `services/api/server.js` — the real backend, ~49k lines, mounts everything (e.g. `/mesrj` router at ~line 9273; login handler near ~16135). Route modules also live in `services/api/routes/` and `services/api/src/routes/`.
- `apps/web` — main frontend (`apps/web/src/mes` is the biggest module; `App.tsx` registers `mesrj` as a top-level module key).
- Other workspaces: `apps/{station-agent,display-board,pdas,website,...}`, `services/{realtime,worker,watchdog,aoi-api,replication,supplier-portal-api,memory}`, `packages/{shared-types,validators,ui-kit,pda-components,...}`.

## Database Rules (Critical)
- **Schema**: `smt_factory` on `:5432`. Migrations (`database/migrations/NNN_name.sql`) are append-only.
- **Runtime DDL**: `services/api/server.js` applies tables at startup. **Verify existing tables before adding migrations** (`\dt` in psql or query `pg_tables`).
- **Migration numbering**: there is already a `311_` collision (two files). Convention between agents: opencode uses `31x+`, rjvn-dev uses `39x+`. Always list `database/migrations` before picking a number.
- **No ORM**: raw `pg` driver. **No hard-deletes** (status fields). Inventory is derived from `inventory_transactions`.
- **Multilingual master data**: `name_zh`, `name_en`, `name_vi`.
- `rjvn_*` mirror tables exist as a parallel set (synced from graft tables by migration 309) — code references live in the unprefixed tables.

## App Rules
- **Lane rules**: consult `app_rules/<lane>.md` before editing (`api.md`, `database.md`, `ui.md`, `auth.md`, `runtime-ports.md`, `data-contract.md`, ...).
- **One active locale** per UI component — never mix languages.
- **Multi-agent workflow**: claim files via `.factory/locks/CLAIM-<artifact>-<lane>.md`. Message peers through the `factory-mailbox` MCP (agent name `opencode`); never use Herdr for handoff.
- **Never `git add -A`** — repo root contains hundreds of scratch scripts, logs, screenshots, and `server.js.*` backups. Stage explicit paths only.
- **Handoff template**: `LANE / STATUS / CHANGED / COMMANDS / VERIFY / NOT DONE / RISKS / NEXT / EVIDENCE`, with `file:line` citations. Note: `server.js` line numbers drift constantly across its ~49k lines — cite a stable anchor (function/route name) alongside.

## Auth
- Login: `POST /api/auth/login`. Passwords are **scrypt-hashed in the DB** (`verifyPasswordHash`, `services/api/server.js` ~16117) — no hardcoded plaintext in the live server (old copies like `server.js.testbak.js` still have it; don't trust them).
- Default seeded credentials: `admin` / `Factory@123`. Login returns a JWT (24h) with role/permission keys.
- OA portal delegates login to this endpoint (single sign-on).
- **Mount order is load-bearing — and was broken for 24 routes until 2026-11-20.** The effective app-level gate is an inline wrapper (`app.use((req,res,next) => … authenticateJWT(req,res,next))`); the bare `app.use(authenticateJWT)` far below it never runs first. Every guarded `app.*` route declared *above* the wrapper with no covering prefix mount returned **401 to a valid token** (`/wms/receiving/qr-bindings`, `/api/manager/line-assignments` were the verified examples). Those are now authenticated and `npm run check:auth-order` reports `stranded=0 baseline=0`, so the ratchet is a floor at zero: any new guarded route above the wrapper fails the gate. Moving the wrapper itself is still an auth change — enumerate the public paths inside `authenticateJWT` first.

### Splitting server.js — the recipe that works

Two domains are out as reference implementations: **28 maintenance routes** (753 lines) in `services/api/src/routes/maintenance.js`, and **38 PMC routes** (1,287 lines) in `src/routes/pmc.js`. Both export `registerXxxRoutes(app, deps)` and are invoked from `server.js` **at the line the block used to occupy** — mounting anywhere else silently changes which middleware has already run. `server.js` is 48,586 → 47,308 lines.

1. Pick a contiguous run of one prefix with **no module-level declarations** in it (`awk 'NR>=A && NR<=B && /^(const|let|function|class) /'`). Those blocks move without touching anything else.
2. Cut the range into a register in the editor, paste it into `src/routes/<domain>.js` inside `export function registerXxxRoutes(app, deps) { … }`.
3. Let `tsc --checkJs` name the dependencies: every free identifier is a **TS2304**, and that list *is* the destructuring line. Do not hand-maintain it.
4. Replace the block in `server.js` with `registerXxxRoutes(app, { …deps });` and add one import.
5. Verify, in this order: `node --check server.js`, `npm run check:register-deps` (see the trap below — the one step that catches a moved block whose dependency does not exist), `npm run check:route-census` (**total must not shrink**), `npm run check:auth-order` (must stay `stranded=0`), `npm run check:route-shadowing`, `npx tsc -p tsconfig.api.json --noEmit | grep src/routes/<domain>` (must be empty: no TS2304 means the dependency closure is complete), `npm run test:unit`, then **boot the app and call a moved path**.
6. **`tsc` says nothing about `server.js`, so an empty grep there is not a pass.** `tsconfig.api.json` covers `services/api/src` only; `server.js` is outside every type program in the repo. The deps list you pass to `registerXxxRoutes` is evaluated at module load, so a name `server.js` does not declare throws `ReferenceError` **before `app.listen`** — `/health` never answers, every route is dead, and `node --check` is perfectly happy. This happened: `getCurrentUser` was passed into `registerCountRoutes` and did not exist. `npm run check:register-deps` is the check that catches it (it extracts the identifiers from every call site and fails if `server.js` has no declaration); booting the app is the other one. Both, every time.
7. **The 404 rule does not work in this app.** An unknown path is answered by the SPA catch-all with **200**, so "404 means the mount is missing" is false here, and an unauthenticated 401 proves nothing either because the auth gate rejects before routing. Use a valid token and read the status of a *known* handler: **200** for a route whose handler has no permission check (proves it ran), **403** for a guarded one (proves it registered and the gate sees it). The census is the real proof that nothing was lost; the live call only proves the process still routes.

Measured on four slices (maintenance 28, pmc 38, qms 23, lifecycle 19 = 108 routes, 2,704 lines; `server.js` 48,586 → 46,657): `AUTH_ORDER_OK stranded=0`, `API_TYPES 595/595`, `unit 362 passed`, census unchanged per slice. Live: `/maintenance/equipment` → 403, `/pmc/closed-loop/dashboard` → 403, `/pmc/delivery-watch` → 200 (runs its SQL), `/pmc/patrol-state` → 200 (uses the injected `fs`), `/api/lifecycle/lots` → 200, `/api/lifecycle/exempt-lots` → 403, `/qms/iqc/inspection-levels` → 403, `/wms/raw-material-inventory` → 200.

## Known Issues / Gotchas
- **Dev server**: keep React 18.3.1 + Vite 5.4.21 exactly — upgrading triggers "Invalid hook call".
- **Memory server**: `services/memory/memory_server.py` on `:9876`. Do not access Qdrant (`:6333`) directly while it's running.
- **PowerShell host**: no bash heredocs (write `.mjs`/`.sh` files instead of inline `node -e` with heredocs), and `<` input redirection is unsupported — pipe with `cmd /c "ssh ... bash -s < file"` when streaming scripts.
- **Duplicate/backup copies** of `server.js`: `server.js.testbak.js` was deleted on 2026-11-20 (it was untracked, carried the hardcoded password, and made the CI credential grep fail). Never resurrect a copy — edit `services/api/server.js` only.
- **Seeded demo credential is hardcoded in the UI, not the API.** `admin` / the factory default password is prefilled in `apps/web/src/App.tsx`, `auth/AuthSignIn.tsx`, `data.ts` and `i18n.ts` as a sign-in hint. The backend hashes passwords properly; the UI constant is a product decision (first-time UX), so CI checks the enforcement path (`services/`) only. Do not "fix" it by deleting the hint without the owner's call.
- **Boot time is not the bottleneck.** Measured through the harness driver: `APP_STARTED` ~2 s, then `/health` answers `{"status":"ready"}`. Earlier reports of "95 s cold boot" were an artifact of the undrained-pipe deadlock (see Harness Gotchas). `boot_timeout_s` is 300 as headroom for a machine running several API instances at once, where the runtime DDL serialises on table locks — a shorter timeout reports a healthy server as dead.
- **Mutation scoring refuses to run on a red gate.** `harness/mutations/run.py` first runs the gate on the unmodified tree and exits `MUTATIONS_NO_BASELINE` if it fails — otherwise every defect is "caught" by whatever was already broken and the score is noise. This is not theoretical: it fired twice in one session on two *other* agents' in-flight type errors in `services/api/src`. `--quick` scores only static+unit (the rungs a box without a journey agent can observe) and prints `MUTATION_SCOPE=` so the smaller number is never mistaken for the full one.
- **Route census (for the deferred split):** 1,492 route registrations across 70 first-segment prefixes; the top ones are the un-prefixed `api` router (340), `wms` (176), `/api/hr` (173), `mes` (98), `/api/qms` (83), `/api/equipment` (61), `pmc` (54). The graft graph indexes no definitions for `server.js` (`graft build` needed), so measure coupling from the file itself.
- **The `api` router shadows app-level `/api/*` routes — 10 permission guards can never run.** `const api = express.Router()` (server.js:117) is mounted by `app.use("/api", api)` at server.js:9368. A router's position in the middleware chain is its **mount point**, not the line its handlers are written on, so `api.get("/lifecycle/lots")` (written near the end of the file) answers before `app.get("/api/lifecycle/lots", requirePermission("wms.read"))`: the guard exists, reads as enforcement, and never executes. 10 such guards exist, all `/api/lifecycle/*`, 5 of them mutating. Verified, not inferred: a station token with no `wms.read` gets 200 from `/api/lifecycle/lots`, `/summary`, `/openings` but 403 from `/api/lifecycle/exempt-lots`, which has no router twin. `npm run check:route-shadowing` (part of the static rung, baseline `.factory/locks/route-shadowing-baseline.json`) fails if the count grows. Consequence for new work: put new `/api/*` routes on the `api` router. Before you conclude a guard is dead, compare the app-level line with the **mount** line — an app route declared ABOVE 9368 runs first and its guard is fine (`POST /api/smt/loading/daily-plans` at 6755 is that case, so its guard is live and the router copy there is the dead one). Fixing the ten is a policy call: guarding the router copies starts denying tokens that work today.
- **`python` on this box is 3.8.10; the factory machinery needs 3.12+.** `factory/gate.py` uses an f-string with a backslash (3.12 syntax), and `Path.is_relative_to` is 3.9+, so `python factory/_selftest.py` died with a SyntaxError inside an import that `doctor` reported only as "machinery self-test did not run". 3.14.6 is installed and is the `py` default: run `py -3.14 factory/_selftest.py` (→ `SELFTEST_PASSED checks=230`) and `py -3.14 factory/doctor.py`. `doctor.py`/`notify.py` were made version-agnostic anyway so the audit still prints a report under 3.8, and `_selftest.py` now names the requirement instead of crashing.

## Factory Harness Gotchas (both verified, both looked like repo bugs)
- **Never give the API an undrained `stdout` pipe.** `harness/appproc.py` now sends the child's output to a temp file. With `subprocess.PIPE` and no reader, `server.js` fills the 64 KB pipe buffer with its boot/DDL logging and blocks in `write()` before `app.listen` -- the gate reports `app-start` failure on a healthy server. Manual `node services/api/server.js` starts in ~2 s; the piped version timed out at 300 s.
- **Bare command names do not resolve on Windows.** `subprocess` uses `CreateProcess`, which ignores `PATHEXT`, so `codex`/`pi` (installed as `.CMD`) raised FileNotFound and the harness reported "not on PATH" for an installed tool. Both `appproc.resolve()` and `agentcheck.run_rung()` now go through `shutil.which`.
- **The journey agent must read stdin AND write a file.** `agentcheck` pipes the prompt in and then requires `harness/.results/<rung>.json` to exist; an agent that exits 0 having written nothing is a FAILURE, not a pass. Verified working here: `pi --mode json --print` (local ollama). `codex` fails on an unconfigured provider, `claude` is not logged in.
- **Never `source services/api/.env` in bash.** It is CRLF; the exported values keep a trailing newline, and every child process then dies with `getaddrinfo ENOTFOUND 127.0.0.1`. Parse it line by line like `scripts/migrate.mjs` does.

## Remote Production Deployment (rjms)
- Host `rjms` = `100.116.166.118` (Tailscale), user `wy`, password auth (`sshpass -p nolose ssh wy@100.116.166.118`; sshpass is installed via winget, plink also available).
- Deployment: `/home/wy/smt-factory-system` (not a git repo — a file copy). Containers: `smt-web`→5178, `smt-api`→8080, `smt-postgres`→5432, `smt-metabase`→3000, `smt-grafana`→3001, `smt-nodered`→1880, `smt-prometheus`→9090; host also runs ollama on 11434. Docker needs `sudo` (same password).
- **Cutover 2026-11-20 (complete)**: `smt-api` = `smt-factory-system-api:sync20261120`, `smt-web` = `smt-factory-system-web:sync20261120b` (b = nginx proxy fix). Rollback containers `smt-api-prev20260907` / `smt-web-prev20260907` (exited) and the old `sync20260907*` images are kept for rollback.
- **All 7 services are compose-managed** under project `smt-factory-system` (`docker compose ps` lists them all). Deploying local changes = `docker compose build api web && docker compose up -d api web`. Volumes and the network are `external: true`, so compose reconciles instead of recreating with generated names.
- **Remote DB is production** (1238 tables, 38 users, `_migrations` ledger has 330 rows / 0 pending after the 2026-11-20 cutover). Never assume schema parity with local (~1336 tables) — check before writing cross-env queries.
- **Metabase uses its own database, `metabase`, not `smt_factory`.** The factory schema already has a `permissions` table, which collides with Metabase's first Liquibase changeset (`v00.00-000`); pointing Metabase at `smt_factory` crash-loops it. Do not "simplify" the compose env back.
- **`employees.gender` must be `M`/`F` only.** `server.js` mirrors `employees` → `hr_employees` on every `/hr` request (`api.use("/hr", ...)` ~14183) with `ELSE 'U'` for unknown values, and `hr_employees_gender_check` only allows `M`/`F` — one `'male'` or NULL row takes the whole `/api/hr/*` router down with a 500.
- **pg_hba.conf gotcha** (bit us once): containerized clients connect from compose network `172.18.0.0/16` — `pg_hba.conf` inside `smt-postgres` must contain `host all all 172.18.0.0/16 scram-sha-256`, then `SELECT pg_reload_conf()`. Symptom of it missing: API login returns "no pg_hba.conf entry" and `smt-metabase` crash-loops.
- `smt-nodered` healthcheck must use `127.0.0.1:1880`, not `localhost:1880` — the image's own healthcheck resolves `localhost` to IPv6 `::1` while Node-RED binds IPv4, which reported "unhealthy" on a working service. Fixed in the compose file; `smt-nodered` is now healthy.
- **nginx `proxy_pass` with variables** (`nginx.conf`): when `proxy_pass` contains variables *and* a URI, nginx replaces the entire request URI with that static URI. `proxy_pass http://$api_host:$api_port/api/;` therefore collapsed every `/api/foo` request into `/api/`. Fixed by dropping the URI: `proxy_pass http://$api_host:$api_port;`. (The SPA never depended on it — `client.ts` calls `http://<hostname>:8080` directly — so production worked anyway.)
- Two migrations are **skipped on prod by ledger entry** (`skipped-prod-no-mirror`): `309_rjvn_mirror_sync.sql` and `311_rjvn_mirror_audit_aliases.sql` — the `rjvn_*` mirror tables only exist in the local dev DB, not on prod.
- Production data fixes applied 2026-11-20 (covered by `/home/wy/backups/20261120/smt_factory_pre_rjvn_migrate_052241.sql.gz`): `266_bom2_process_domain.sql` backfill applied with `SET session_replication_role = replica` (the BOM-immutability trigger would otherwise reject writes to non-draft BOMs); `employees.gender` normalized (`'male'`→`'M'`, 2 NULLs→`'F'`).
- Known remaining gap: `flow_webhook_outbox` (referenced by `services/api/src/oa/services/wms-webhook.js`) is created by no migration and no startup DDL — the OA "集成告警扫描" cron reports an error for it. Same for `equipment`, `sys_config`, `flow_instance`, `meeting`, `drive_folder`, `doc_system`, `sys_session`.
- When running remote multi-command diagnostics, pipe a local script via `bash -s` — inline quoting gets mangled by PowerShell.

## Graft (Context Graph)
- `graft map` (orientation), `graft ask` (understand), `graft grep` (exhaustive search). `graft build` after major changes. MCP tools (`graft_find_all`, `graft_file_api`) beat grep/read for large files like `server.js`.

## Verification
- Run `npm run typecheck:all` + `npm run test` before claiming a task complete (plain `typecheck` passes even when services code is broken).
- Bugs = minimal fix. New features = strictly match existing patterns.
- For API changes, verify live: login then hit the real endpoint with the JWT (route list is huge; 404 means the route genuinely doesn't exist — `/api/health` does not).
