# SMT Factory System — Agent Operational Guide

**Workspace**: `C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\`

## Stack

React 18.3.1 + Vite 5.4.21 + TypeScript 5.9.3 + Express 5.2.1 + Vitest 4.1.9 + PostgreSQL (raw `pg` driver, no ORM)

**Languages**: zh-CN (primary), en-US, vi-VN — all UI text **must** use i18n keys, never hardcoded strings.

**Runtime**: Node.js, npm only (no yarn/pnpm), Windows

## Directory Map

```
smt-factory-system/
├── apps/
│   ├── web/                  React SPA (port 5178 via Vite) — main UI
│   ├── pdas/dashboard/       PDA dashboard (Kotlin/WebView consumer)
│   ├── pdas/plant-manager/   PDA plant-manager app
│   ├── display-board/        Andon/display board
│   ├── station-agent/        Electron-based station agent
│   ├── website/              Public site
│   └── qrbindingforinternalboadandshell/  QR binding tool
├── packages/                 NOT npm workspaces — import via relative paths
│   ├── shared-types/         Domain types + contracts.ts DTOs
│   ├── business-rules/       Work order coding + inventory validation
│   ├── validators/           isBarcodeScan(), assertWorkOrderCode()
│   ├── pda-components/       Shared PDA UI
│   ├── ui-kit/               Shared web UI primitives
│   ├── station-config/       Station config schema
│   └── mes-ate-contract/     MES/ATE interface contract
├── services/
│   ├── api/                  Express API — port 8080 (server.js ≈45K lines)
│   ├── worker/               Background job worker
│   ├── realtime/             WebSocket/realtime service
│   ├── watchdog/             Auto-restart on crash (3s delay)
│   ├── aoi-api/              AOI adapter API
│   ├── replication/          DB replication/failover helpers
│   ├── supplier-portal-api/  Supplier portal backend
│   └── memory/               mem0 long-term memory service (port 9876)
├── database/
│   ├── migrations/           279 SQL migrations, applied by scripts/migrate.mjs
│   └── seeds/                Demo data seeds (002_bom_seed.sql, …)
├── integrations/             80+ station/device adapter dirs (aoi, spi, fct, etc.)
├── tests/                    72 Vitest files (unit + integration)
├── app_rules/                Lane ownership rules per area
├── harness/ + .factory/      Self-verifying factory scaffold (see FACTORY_RULES.md)
├── graft/                    Repo context graph (see Graft section below)
└── start_dev.js              Preferred dev launcher
```

## npm Workspaces

`package.json` has `workspaces: ['apps/*', 'services/*', 'packages/*']`. **Apps and services are proper workspaces; packages are not** — import via relative path: `../../../packages/shared-types/src/factory`.

## Developer Commands

| Command | What it does |
|---|---|
| `npm run dev` | `node ./scripts/dev-all.mjs` → watchdog → API + Vite |
| `node start_dev.js` | Direct spawn API + Vite (no watchdog, simpler) |
| `npm run dev:api` | `npm --workspace services/api run dev` → `node server.js` |
| `npm run dev:web` | `npm --workspace apps/web run dev` → `vite` |
| `npm run build` | Vite production build (`apps/web`) |
| `npm run test` | `vitest run` (72 test files) |
| `npm run test:e2e` | `playwright test` |
| `npm run test:hardware` | Smart-shelf hardware suite (`vitest.hardware.config.ts`) |
| `npm run typecheck` | `tsc -p tsconfig.base.json --noEmit` |
| `npm run typecheck:all` | typecheck + `typecheck:tests` |
| `npm run migrate` | `node scripts/migrate.mjs` — applies pending migrations |
| `npm run migrate:seed` | `node scripts/migrate.mjs --seed` — migrations + seeds |

`scripts/migrate.mjs` flags: `--plan` (list pending, apply nothing), `--fresh` (drop everything, dev only), `--seed`. Tracks applied files in `_migrations` table.

## Running Services

**Preferred for development**: `node start_dev.js` — spawns API (port 8080) + Vite (port 5178) in same process tree with auto-restart.

**For full stack** (includes scanner/display/watchdog): `npm run dev` → runs `dev-all.mjs` → watchdog → spawns api + web + scanner.

**Dev server ports**:
- API: `http://localhost:8080`
- Web: `http://localhost:5178`
- Vite proxy: `/api` → `http://127.0.0.1:8080`

**API contracts**: `services/api/openapi.yaml` (route inventory) and `packages/shared-types/src/contracts.ts` (DTOs).

## Login Credentials

All accounts use password: `Factory@123` (`services/api/server.js:15978` — should move to `.env`)

Sample accounts from seed data:
- `VN_OP_001` / `Factory@123` — SMT operator (vi-VN)
- `VN_WH_001` / `Factory@123` — Warehouse (vi-VN)
- `PMC_CN_01` / `Factory@123` — PMC (zh-CN)
- `QC_VN_01` / `Factory@123` — Quality (vi-VN)
- `FIN_VN_001` / `Factory@123` — Finance (vi-VN)

JWT secret and expiry in `.env` (`JWT_SECRET`, `JWT_EXPIRY_MS`).

## Active Modules

| Module | UI Path | API Prefix |
|--------|---------|------------|
| Dashboard | `apps/web/src/` , `manager-dashboard/` | `/dashboard` |
| WMS | `apps/web/src/wms/` | `/wms` |
| PMC | `apps/web/src/pmc/` | `/pmc` |
| MES | `apps/web/src/mes/` | `/mes` |
| HR | `apps/web/src/hr/` , `employee/` | `/hr` |
| Finance | `apps/web/src/finance/` , `einvoice/` | `/finance` |
| Procurement | `apps/web/src/procurement/` | `/procurement` |
| QMS / Quality | `apps/web/src/qms/` , `quality/` | `/qms`, `/quality` |
| Equipment / Maintenance | `apps/web/src/maintenance/` , `spareparts/` | `/equipment` |
| OA / Workflow | `apps/web/src/oa/` , `workflow/` | `/oa` |
| AOI | `apps/web/src/aoi/` | `/aoi` |
| Reports | `apps/web/src/reports/` | `/reports` |
| AI | `apps/web/src/ai/` , `agents/` | `/ai` — Ollama at `localhost:11434` |
| Sales | `apps/web/src/sales/` | `/sales` |
| Service | `apps/web/src/service/` , `services/` | `/service` |
| Project / Admin | `apps/web/src/project-mgmt/` , `projects/` , `admin/` | `/projects` |

## App Rules (`app_rules/`)

This repo uses lane-based agent ownership. Read `app_rules/<lane>.md` before editing:

| Lane | Owns |
|------|------|
| `architecture.md` | Cross-cutting structure, module boundaries |
| `database.md` | `database/migrations`, seeds, schema |
| `ui.md` | `apps/web`, `apps/scanner-terminal`, `apps/display-board` |
| `auth.md` | Login, sessions, roles, permissions |
| `api.md` | Backend endpoints and contracts |
| `data-contract.md` | UI-to-DB mapping, DTO alignment |
| `backend-validation.md` | Smoke checks, API/auth boundary tests |
| `runtime-ports.md` | Startup ports and service launch rules |

Key UI rules (`app_rules/ui.md`): one active locale per page (never stack zh+en+vi), status colors consistent across all screens, tooltips on every non-obvious control, warnings are actionable with plain-language reasons.

## Conventions

1. **No new root-level dirs** — all under `smt-factory-system/`
2. **No ORM** — raw PostgreSQL via `pg` driver
3. **No hard-deletes** — use status fields (voided, closed, scrapped)
4. **Inventory balance derived** from `inventory_transactions` — never a single balance column
5. **Schema conventions**: `bigserial` PKs, `timestamptz`, `varchar` codes, `created_by/created_at/updated_at`
6. **Master data multilingual**: `name_zh`, `name_en`, `name_vi` columns
7. **Packages via relative path**: `../../../packages/shared-types/src/factory`
8. **Migrations are append-only** — numbered `NNN_name.sql` in `database/migrations/`, never edit or renumber an applied file. Check state with `node scripts/migrate.mjs --plan` before writing one.
9. **`server.js` also creates tables at runtime** — some tables exist only via `CREATE TABLE IF NOT EXISTS` in `services/api/server.js`, and later migrations reference them. New migrations must not assume the migration set alone produces the schema.
10. **Verify before claiming done** — `npm run typecheck` + `npm run test` (+ `npm run test:e2e` when a user-facing flow changes).

## WMS Workflow

```
Receiving → Label → IQC → Storage → Pick → Issue to SMT Line → (Line Return / Scrap)
```

Key DB tables: `material_lots`, `inventory_transactions`, `storage_locations`.
IQC flow: `pending → hold (if failed) → released` or `pending → rejected`.

## Known Issues

- **React "Invalid hook call" / blank page in dev** — caused by React 19 + npm workspaces esbuild interop bug. Vite pre-bundles CJS React with `needsInterop: true`, creating separate `ReactSharedInternals` instances between `react` and `react-dom/client`. Root cause: `ReactDOMSharedInternals.d` set by react-dom but never visible to react's `resolveDispatcher()`. **Fix**: stay on React 18.3.1 (`react@18.3.1`, `react-dom@18.3.1`) with Vite 5.4.21. Full details in `docs/skills.md` → "Dev Server Invalid Hook Call Bug".
- **Watchdog process management on Windows** — background terminal sessions may exit even when child processes are healthy. Use `start_dev.js` directly.
- **Hardcoded password** — `Factory@123` is hardcoded at `services/api/server.js:15978` (`password === "Factory@123"`). Should be read from `.env`.
- **API_PORT in .env.example is 3000** — actual server defaults to 8080 (line: `const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8080)`).
- **Repo root is a junk drawer** — ~400 untracked scratch files (`*.log`, `pw-*.cjs`, `_*_tmp.mjs`, test PNGs) sit beside real sources. Leave them alone; never `git add -A`.

## Environment

**Live database: `smt_factory` on `127.0.0.1:5432`** — this is what `.env` and `services/api/.env` point at (`PGDATABASE=smt_factory`, `PGUSER=smt_factory`). 279/279 migrations applied, tracked in `public._migrations`; 992 base tables in `public`. `services/api/server.js:867,886` open extra pools with `options: "-c search_path=public"`, so the API runs on `public`, not a named schema.

- `psql` is not on PATH: `C:\Program Files\PostgreSQL\17\bin\psql.exe`. Connect with `PGPASSWORD=postgres`.
- **`factory` is not the live DB.** It holds `rjvn` (263 tables), `public` (256) and `mesapp` (29) with only **128** of 279 migrations applied (`public.schema_migrations`) — a rehearsal/legacy target. `rjvn_mgmt`, `rjvn_verify`, `oa_rehearsal`, `oa_staging`, `oa_source`, `wms` are likewise side databases.
- Schema drift note: `scripts/migrate.mjs` defaults to `PGDATABASE=smt_factory` and tracks `_migrations`; any DB showing `schema_migrations` instead was migrated by something else and is out of band.
- Agent message bus: Redis on `127.0.0.1:6379`. Hermes and OpenCode talk through the `factory-mailbox` MCP server (`send_message` / `check_inbox`). Do not use Herdr agent commands for hand-off. See `../prompts/opencode_system.md`.

## Self-verifying factory (`harness/`, `factory/`, `.factory/`, `app_rules/`)

This repo carries the scaffold from `FACTORY_RULES.md`: governance files (`MISSION.md`, `FACTORY.md`, `FACTORY_RULES.md`) are human-owned and a PR touching them is an automatic reject. `factory/gate.py`, `merge.py`, `guard.py`, `state.py` are the gates that are actually code; `harness/ci.py` and `.factory/holdout/` are the checks. `MISSION.md` / `FACTORY.md` are still unfilled templates — do not treat `<angle-bracket>` placeholders as real scope.

Ollama: `http://localhost:11434/v1` (model: `gemma4:latest`)

## Memory Server (mem0 AI 记忆)

mem0 为 AI agent 提供长期记忆存储。需要 3 个服务依次启动：

### 启动顺序

1. **Qdrant** (向量数据库，port 6333)
   ```
   C:\Users\tianj\.mem0\qdrant\qdrant.exe
   ```
   数据目录：`C:\Users\tianj\.mem0\qdrant`
   检查：`netstat -ano | findstr ":6333"`

2. **Ollama** (LLM + embedding，port 11434)
   - 确认 `qwen2.5:7b` 和 `nomic-embed-text` 已下载
   - 检查：`curl http://localhost:11434/api/tags`

3. **memory_server.py** (mem0 HTTP API，port 9876)
   ```
   C:\Users\tianj\AppData\Local\Programs\Python\Python314\python.exe
     C:\path\to\smt-factory-system\services\memory\memory_server.py
   ```
   配置：`services/memory/memory_config.json`
   - `llm.provider: ollama` / `model: qwen2.5:7b`
   - `embedder.provider: ollama` / `model: nomic-embed-text`
   - `vector_store.provider: qdrant` / `collection: smt_factory_memory`
   检查：`curl http://127.0.0.1:9876/health`

### 启动命令（PowerShell）

```powershell
# 1. Qdrant
Start-Process -FilePath "C:\Users\tianj\.mem0\qdrant\qdrant.exe" -WindowStyle Hidden

# 2. memory_server (Python 3.14)
Start-Process -FilePath "C:\Users\tianj\AppData\Local\Programs\Python\Python314\python.exe" `
  -ArgumentList "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\services\memory\memory_server.py" `
  -WindowStyle Hidden
```

### API 端点

| Method | Path | Body |
|--------|------|------|
| GET | `/health` | — |
| POST | `/search_all` | `{"query": "...", "top_k": 20}` |
| POST | `/store` | `{"messages": [...], "agent_id": "factory_ui", "metadata": {}}` |
| POST | `/get_all` | `{"agent_id": "factory_ui", "top_k": 20}` |

### 已知问题

- **mem0ai 包名** — 正确包名是 `mem0ai`，不是 `mem0`
- **Python 版本** — 需要 Python 3.14（3.8 太旧）
- **默认 agent_id** — `memory_server.py` 使用 `factory_ui` 作为默认 agent_id
- **Qdrant 数据锁** — 不要在 Qdrant 运行时同时用 qdrant_client 访问同一目录

## Working Style

- User prefers **terse Chinese**, no preamble
- Senior dev — cite file:line for claims
- Bugs: minimal fix, no opportunistic refactor
- New features: match existing patterns strictly

## Multi-agent rules

Concurrent agents follow `docs/AGENT-WORKFLOW.md` (lane ownership, `.factory/locks/<lane>.lock` claims, Redis mailbox message types, W0–W3 wave gates, HANDOFF template). Non-negotiables:

1. **Single writer per file** — claim before editing, release when done.
2. **Never touch governance** — `MISSION.md`, `FACTORY.md`, `FACTORY_RULES.md`, `harness/`, `.factory/locks`, `.factory/holdout`.
3. **Never restart the dev servers** (`:8080`, `:5178`) while others work.
4. **Never `git add -A`** — the root holds 400+ scratch scripts and logs.
5. **No green without evidence** — a lane is done only when its Gate command output is pasted in the handoff.

## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives, or scoping a change — get context from the graph before grepping or opening source files. Re-ask freely (it's cheap) and reuse literal identifiers you already have (symbol, error string, file name) as the query. New to this repo? Run `graft map` first — a token-budgeted orientation (dir clusters, hubs, hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant code spans inlined (each hit's ≤8-line crux by default; `--full` for whole definitions when the crux isn't enough). Match the tool to the task shape: for understanding or editing, the top node IS the answer — cite its `covers:` file:line spans and edit straight from `--source`. For exhaustive tasks ("every occurrence / every caller of this pattern"), ranked results are top-N, not complete — run `graft grep "<literal>"` instead (exhaustive over indexed files, grouped by enclosing symbol), falling back to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this. Add `--direction out` for what it calls, or `--depth N` to walk transitively for the full blast radius. For structural questions, skip ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects — hits carry `[scope/]` labels naming which one they're from. Narrow with `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact range before finalizing. Only open source files when a node genuinely lacks a needed detail, and then at the exact file:line the node points to — never re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic, no API key, $0).