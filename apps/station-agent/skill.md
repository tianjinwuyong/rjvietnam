# MES Missioner — Station Agent

Factory floor data hub. Aggregates production data from multiple sources — barcode scans, equipment adapters, power supplies, AOI/SPI inspection machines, reflow ovens, and any industrial device with a data interface — then syncs everything to the MES API.

Runs as a Vite React app (port 5179) or as an Electron desktop app.

## Stack

- React 19 + TypeScript 5.8 + Vite 6
- Dexie (IndexedDB) for local offline storage
- Raw `fetch` for MES API communication
- Optional: Electron desktop shell (`apps/station-agent/electron/`)

## Architecture

```
Browser / Electron
├── scanEngine.ts      — Barcode decision logic: PASS/NG/DUP/BLOCKED
├── syncManager.ts     — Background queue drainer (5s interval)
│   ├── trimSyncQueue()             — Evicts oldest when >1000 items
│   └── processAlertRetryQueue()     — Exponential backoff retries (max 3)
├── db.ts             — Dexie schema: snRecords, ngPool, dupPool, syncQueue,
│                       shiftLog, alertRetryQueue, alertRules, dataSourceConfigs
├── mesApi.ts         — All /api/* fetch calls + auth header injection
├── alertRuleEngine.ts — Operator-defined threshold rules (expr-eval)
├── adapters/index.ts — DataSourceManager: file, http, tcp, ws, mqtt, db,
│                       opc-ua, modbus, serial, scanner-bridge adapters
└── components/
    ├── ScanPanel.tsx           — Barcode input + batch scan mode
    ├── StationSelector.tsx     — Station picker (10min auto-poll + manual 🔄)
    ├── OperatorLogin.tsx       — Employee SN login → JWT obtained from MES
    ├── StatsPanel.tsx          — Today's PASS/NG/DUP counts
    ├── SyncStatus.tsx          — Online/offline + pending sync count
    ├── LiveNgAlerts.tsx        — SSE NG_DEFECT broadcast display
    ├── AlertRuleEditor.tsx     — CRUD for alert threshold rules
    ├── AlertToast.tsx          — NG-trigger alert toasts
    ├── DataSourcePanel.tsx     — Data source config CRUD
    └── DataSourceRecordTable.tsx — Live feed from all connected adapters
```

**Data flow**: Any adapter (AOI, power supply, reflow oven, barcode scanner…) → DataSourceManager → alert rule engine → forward to MES API + local Dexie store → background sync queue → MES API (or queue if offline).

## Auth Flow

```
Operator scans employee SN
  → App calls POST /auth/station-login { operator, stationCode }
  → MES returns JWT (24h expiry)
  → JWT stored in mesApi module (_stationToken)
  → All subsequent postStationEvent / getWorkOrder calls
    inject: Authorization: Bearer <token>
  → On logout: setStationToken(null)
```

**API server endpoint**: `POST /auth/station-login` in `services/api/server.js`

**Token persistence**: JWT is stored in `localStorage` under key `mes_station_token`. On page refresh, `App.tsx` detects the stored operator + station code after the station list loads and re-logs in automatically. `setStationToken(null)` on logout clears both the server-side session and localStorage.

**Re-login on station change**: When the operator changes station via `StationSelector`, `App.tsx` calls `loginStation(operator, newStationCode)` to obtain a fresh JWT scoped to the new station.

## Sync Model

- **Online**: `syncManager.tick()` runs every 5s, drains `syncQueue` oldest-first
- **Offline**: Events queue to `syncQueue` + `alertRetryQueue`; `trimSyncQueue()` caps at 1000 items (oldest evicted first)
- **Re-online**: `App.tsx` calls `syncEngine.flushQueue()` on `syncState === 'online'` transition
- **Alert retries**: Exponential backoff — `2^attempts * 30s`, max 3 attempts before丢弃

## Station Heartbeat

The station-agent sends a liveness ping to MES every **30 seconds** while online:

```
POST /mes/heartbeat/:stationCode
Body: { operator?: string, lineCode?: string }
```

- **Trigger**: `sendHeartbeat()` in `syncManager.ts` — runs on a dedicated 30s interval, independent of the 5s sync tick
- **Context**: `setHeartbeatContext(stationCode, operator, lineCode)` updates the heartbeat context without restarting the timer; called at three points:
  - Session restore (after stations load, if operator was previously logged in)
  - Operator login (when SN entered)
  - Station change (when operator selects a different station)
- **Non-fatal**: heartbeat failures throw silently and do not affect the sync queue or alert retries
- **API endpoint**: `POST /mes/heartbeat/:stationCode` in `services/api/server.js:12971`
- **DB table**: `station_heartbeats` (migration `019_station_heartbeats.sql`) — `last_seen` updated via `ON CONFLICT DO UPDATE`

## Alert Rules

- Stored in Dexie `alertRules` table
- `AlertRule` shape: `{ id, adapterId, stationCode, name, expression, severity, action, enabled }`
- `action`: `local_alert` | `ng_trigger` | `forward_mes`
- `forward_mes` failures queue to `alertRetryQueue` for retry

## Offline Indicators

- `showOfflineBanner` state in App.tsx — set by `onOffline()` callback from syncManager
- `SyncStatus` component displays online/offline + pending count
- Station selector polls `/api/stations` every 10 minutes

## Key Files

| File | Purpose |
|---|---|
| `src/scanEngine.ts` | Barcode scan decision: NG pool → DUP pool → upstream check → PASS/NG/DUP |
| `src/syncManager.ts` | Background sync with offline queue + alert retry |
| `src/db.ts` | All Dexie tables (v3 schema) |
| `src/mesApi.ts` | API client + auth token injection |
| `src/alertRuleEngine.ts` | Rule evaluation with expr-eval parser |
| `src/adapters/index.ts` | DataSourceManager: registry for all equipment adapters + retry queue on forward_mes failure |
| `electron/main.js` | Electron main process (log file, menu, window) |

## Run Commands

```bash
# From apps/station-agent/

npm run dev          # Vite dev server on :5179
npm run build        # TypeScript compile + Vite build → dist/
npm run electron:dev # Electron + Vite dev (--dev flag enables dev server)
npm run electron     # Electron with production dist/ build
```

## Environment

- MES API expected at `http://localhost:8080`
- Vite proxy: `/api` → `http://localhost:8080`
- Electron log: `app.getPath('userData')/mes_missioner.log`

## NG Result Normalization

Equipment sometimes sends `result: 'NG'` but the `station_events_result_check` constraint only allows `pass | fail | hold | rework | reject | skip`. Both route handlers normalize this:

- **`api.post("/mes/events")`** (line ~7386): `const normalizedResult = result === 'NG' ? 'fail' : result` — also creates `ng_defect_records` entry and marks SN as `ng` status when `result === 'fail'` and `defectCode` is present.
- **`app.post("/mes/events")`** (line ~6329): same normalization — this is the route the station-agent calls.

Both fixes are required because:
- `POST /mes/events` → `app` router (station-agent calls this)
- `POST /api/mes/events` → `api` router (other callers)

If your equipment adapter sends `result: 'NG'`, it will be accepted and stored as `'fail'` without error.

## Known Limitations

1. `forward_mes` alert retries use 30s base delay — may be too aggressive for rate-limited APIs
2. `EventSource` for SSE (`subscribeNgDefect`) cannot forward auth headers — SSE endpoint must be unauthenticated or use a separate token mechanism
3. No token expiry detection — after 24h JWT expires, sync calls silently fail until re-login

## Data Sources (Equipment It Connects To)

The station-agent is a **universal data collector** for the factory floor. It ingests data from any equipment that can communicate:

| Type | Examples |
|---|---|
| **PCB barcode scans** | Operator scans serial numbers |
| **AOI / SPI** | Automated optical inspection, solder paste inspection |
| **Reflow ovens** | Temperature profile data, peak temp, dwell time |
| **Power supplies** | Voltage, current, status monitoring |
| **OPC-UA / Modbus** | Industrial equipment protocols |
| **Serial / TCP / MQTT / WebSocket** | General machine connectivity |
| **Database adapters** | Pull from existing factory DBs |
| **File / HTTP** | CSV exports, HTTP APIs from equipment |
| **Scanner bridge** | Dedicated barcode scanner hardware |

All incoming data runs through the **alert rule engine** — operators define threshold rules per station (e.g., "if AOI defect rate > 5% in 10 min, trigger NG alert → forward to MES"). Rules can also trigger `local_alert` or `ng_trigger` actions.

## Aging Cabinet (固化柜) Integration

The existing **老化柜质量中心** Python app (`station.py`) runs on the aging cabinet PC. It handles hardware control, voice alerts, and Excel file monitoring. The station-agent is designed to **complement or replace** it for the MES layer.

### Feature Comparison

| Feature | 老化柜 Python App | Station Agent |
|---|---|---|
| NG duplicate check (6 layers) | ✅ | ✅ |
| Offline queue + retry | ✅ | ✅ |
| Forward to MES API | ✅ | ✅ |
| Real-time Excel polling (0.5s) | ✅ | ❌ Needs `FileAdapter` |
| MySQL NG polling (30s) | ✅ | ❌ Needs `DbAdapter` (MySQL) |
| SQL Server aging monitor (10s) | ✅ | ❌ Needs `DbAdapter` (SQL Server) |
| NG alarm cascade (voice + popup) | ✅ | ❌ Electron only |
| USB scanner disable/enable | ✅ | ❌ Browser cannot control USB |
| Alert rule engine (operator-defined) | ❌ | ✅ |
| Equipment adapters (10+ types) | ❌ | ✅ |
| Multi-station support | ❌ | ✅ |
| React web UI | ❌ | ✅ |

### Curing / Aging Cycle (固化)

The aging cabinet monitors SNs **after** they enter the curing process:

```
PCB scanned → PASS → SN enters aging cabinet
  ↓
_aging_sns{} tracks: { sn, scan_time, status: "aging" }
  ↓
Background thread polls SQL Server every 10s:
  SELECT TestResult, FixturePosition, EndTime
  FROM BI_Test_Result WHERE ProductBarcode = ?
  ↓
  ┌─ FAIL  → Trigger NG alarm → add to ng_pool
  ├─ PASS   → Log aging PASS → remove from tracking
  └─ >8h timeout → Stop monitoring
```

The station-agent can mirror this via `DbAdapter` (SQL Server) polling. NG events discovered during curing are forwarded to MES with `eventType: "AGING_NG"`.

**Note**: The aging cabinet Python app already has its own aging monitor. If the station-agent also polls the same SQL Server table, de-duplicate at the MES layer using `ProductBarcode + EndTime` as a unique key.

| Source | DB | Polling | NG Reason |
|---|---|---|---|
| MySQL (老化测试) | `ps` | 30s | `ps_1.reason NOT IN (0,255)` |
| SQL Server (aging monitor) | `AgingCabinet` | 10s | `BI_Test_Result.TestResult = 'FAIL'` |
| Excel file | `D:\PowerSupply\record\` | 0.5s | Result = NG/FAIL |

### Integration Decision: Keep Both

The 老化柜 Python app and station-agent run **side by side** — they are complementary, not competing:

| Who | Role |
|---|---|
| **老化柜 Python app** | Hardware control, voice alerts, USB scanner control, Excel file polling, SQL Server aging monitor |
| **Station Agent** | Central MES forwarder, alert rule engine, multi-station dashboard, alert retry + offline queue |

Both push events to the same MES API (`POST /mes/events`). The MES combines all sources for unified reporting — production dashboards, yield analysis, traceability — regardless of which app sent the data.

**Data flow — how they work together:**
```
老化柜 Python app
  ├── Scan SN → 6-layer check → PASS/NG
  ├── Excel poll → NG detected
  ├── MySQL poll → NG found (ps_1)
  ├── SQL Server poll → aging FAIL detected
  └── → POST /mes/events → MES database

Station Agent
  ├── Receives scan events from other stations
  ├── Applies alert rules (e.g. "NG rate > 5% in 10 min → alert")
  ├── Queues if offline (max 1000, retry 3x)
  └── Forwards to MES API

MES API (combined)
  └── Unified reporting: pass/NG/DUP counts, yield, traceability
       across all stations + aging cabinet data
```

**Key point**: They are both **MES data sources**. The station-agent does not replace the Python app — it augments it with unified MES routing, alert rules, offline resilience, and a modern web dashboard. The Python app continues handling all hardware-level concerns (voice, USB lock, Excel reading) unchanged.

## Station Management (MES API)

MES exposes production line and station metadata via REST:

| Endpoint | Description |
|---|---|
| `GET /mes/lines` | List all 5 production lines with station count and active work orders |
| `GET /mes/lines/:lineCode` | Detail for one line: current run, recent events, all stations |
| `GET /mes/heartbeats` | All station heartbeat statuses (`alive` / `warning` / `dead`) |
| `POST /mes/heartbeat/:stationCode` | Station liveness ping — called by station-agent every 30s |

**Production lines seeded** (migration `074_factory_production_lines.sql`):

| Code | Name | Stations |
|---|---|---|
| L001 | SMT产线 | 7 (Laser, AI Insert, Printer, SPI, Pick&Place, AOI, PD Scan) |
| L002 | 自动线 | 12 (Load, AOI, Laser, ICT, FCT, PCBA, Assembly, Ultrasonic, Aging Cabinet, Hi-Pot, ATE, Pack) |
| L003 | 包装产线 | 4 (Hi-Pot, ATE, Shell Bind, Pallet Bind) |
| L004 | 手动线 | 13 (PDA, AOI, ICT, FCT, PCBA, Shell, Assembly, Ultrasonic, Aging, Hi-Pot, Pack-ATE, Shell-B, Pallet-B) |
| L005 | 回修站 | 1 (Rework QC) |

Station types are also seeded (AGING_CAB, AUTO_*, PACK_*, MAN_*, SMT_*, REWORK, etc.) for type-based routing and filtering.

## Optional: Ollama

Ollama is **not required** for the station-agent. It is used only by:
- The opencode AI assistant (your coding tool)
- The web app's optional `/ai/*` routes (chat, traceability queries)

The station-agent has zero Ollama dependencies.
## First-observation conflict handling

Use the shared conflict manager for every authoritative record update. On the first version mismatch, reject the write, preserve both versions, create an immutable `CONFLICT` event, block the affected SN/WO, alert MES, and wait for MES resolution. Never silently overwrite, merge, or allow a client to resolve its own conflict.
