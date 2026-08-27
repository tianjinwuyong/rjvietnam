# SMT Factory System — Agent Operational Guide

**Workspace**: `C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\`

## Stack

React 18.3.1 + Vite 8 + TypeScript 5.8 + Express + Vitest 4 + PostgreSQL (raw `pg` driver, no ORM)

**Languages**: zh-CN (primary), en-US, vi-VN — all UI text **must** use i18n keys, never hardcoded strings.

**Runtime**: Node.js, npm only (no yarn/pnpm), Windows

## Directory Map

```
smt-factory-system/
├── apps/
│   ├── web/                  React SPA (port 5178 via Vite)
│   ├── scanner-terminal/     Station scanner app
│   ├── display-board/        Andon/display board
│   └── station-agent/        Electron-based station agent
├── packages/                 NOT npm workspaces — import via relative paths
│   ├── shared-types/         Domain types (Locale, WorkOrder, MaterialLot, …)
│   ├── business-rules/       Work order coding + inventory validation
│   └── validators/           isBarcodeScan(), assertWorkOrderCode()
├── services/
│   ├── api/                  Express API — port 8080 (~16.6K lines server.js)
│   ├── worker/               Background job worker
│   ├── realtime/            WebSocket/realtime service
│   └── watchdog/            Auto-restart on crash (3s delay)
├── database/
│   ├── migrations/           SQL migrations (001–045+)
│   └── seeds/               Demo data seeds
├── integrations/             80+ station/device adapter dirs (aoi, spi, fct, etc.)
├── tests/                   Vitest test files
└── start_dev.js             Preferred dev launcher
```

## npm Workspaces

`package.json` has `workspaces: ['apps/*', 'services/*', 'packages/*']`. Apps and services are proper workspaces; **packages are not** — import them via relative path: `../../../packages/shared-types/src/factory`.

## Developer Commands

| Command | What it does |
|---|---|
| `npm run dev` | `node ./scripts/dev-all.mjs` → watchdog → API + Vite |
| `node start_dev.js` | Direct spawn API + Vite (no watchdog, simpler) |
| `npm run dev:api` | `npm --workspace services/api run dev` → `node server.js` |
| `npm run dev:web` | `npm --workspace apps/web run dev` → `vite` |
| `npm run build` | Vite production build (`apps/web`) |
| `npm run test` | `vitest run` |
| `npm run typecheck` | `tsc -p tsconfig.base.json --noEmit` |
| `npm run migrate` | Apply migrations |
| `npm run migrate:seed` | Apply migrations + seed data |

## Running Services

**Preferred for development**: `node start_dev.js` — spawns API (port 8080) + Vite (port 5178) in same process tree with auto-restart.

**For full stack** (includes scanner/display/watchdog): `npm run dev` → runs `dev-all.mjs` → watchdog → spawns api + web + scanner.

**Dev server ports**:
- API: `http://localhost:8080`
- Web: `http://localhost:5178`
- Vite proxy: `/api` → `http://127.0.0.1:8080`

**API contracts**: `services/api/openapi.yaml` (route inventory) and `packages/shared-types/src/contracts.ts` (DTOs).

## Login Credentials

All accounts use password: `Factory@123` (hardcoded in `services/api/server.js` lines 1565, 2636 — should move to `.env`)

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
| Dashboard | `apps/web/src/` | `/dashboard` |
| WMS | `apps/web/src/wms/` (29 files) | `/wms` |
| PMC | `apps/web/src/pmc/` (23 files) | `/pmc` |
| MES | `apps/web/src/mes/` | `/mes` (54 endpoints) |
| HR | `apps/web/src/hr/` | `/hr` |
| Finance | `apps/web/src/finance/` | `/finance` |
| Equipment | `apps/web/src/equipment/` | `/equipment` |
| Reports | `apps/web/src/reports/` | `/reports` |
| Quality | `apps/web/src/quality/` | `/quality` |
| AI | `apps/web/src/ai/` | `/ai` — Ollama at `localhost:11434` |
| Sales | `apps/web/src/sales/` | `/sales` |
| Service | `apps/web/src/service/` | `/service` |

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

## WMS Workflow

```
Receiving → Label → IQC → Storage → Pick → Issue to SMT Line → (Line Return / Scrap)
```

Key DB tables: `material_lots`, `inventory_transactions`, `storage_locations`.
IQC flow: `pending → hold (if failed) → released` or `pending → rejected`.

## Known Issues

- **React "Invalid hook call" / blank page in dev** — caused by React 19 + Vite 8 + npm workspaces esbuild interop bug. Vite pre-bundles CJS React with `needsInterop: true`, creating separate `ReactSharedInternals` instances between `react` and `react-dom/client`. Root cause: `ReactDOMSharedInternals.d` set by react-dom but never visible to react's `resolveDispatcher()`. **Fix**: use React 18.3.1 (`react@18.3.1`, `react-dom@18.3.1`). Full details in `docs/skills.md` → "Dev Server Invalid Hook Call Bug".
- **Watchdog process management on Windows** — background terminal sessions may exit even when child processes are healthy. Use `start_dev.js` directly.
- **Hardcoded password** — `Factory@123` is hardcoded in `server.js` lines 1565, 2636. Should be read from `.env`.
- **API_PORT in .env.example is 3000** — actual server defaults to 8080 (line: `const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8080)`).

## Environment

- PostgreSQL: `127.0.0.1:5432/smt_factory` (password: `postgres` via `PGPASSWORD` env)
- Ollama: `http://localhost:11434/v1` (model: `gemma4:latest`)

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
