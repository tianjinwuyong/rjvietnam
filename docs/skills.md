# MES SN + NG Blocking — Architecture & Gap Analysis

---

## Playwright Browser Automation (Playwright MCP)

Use Playwright MCP for browser automation: verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.

### Available MCP Server: `playwright`

**Tools** (invoke via `skill_mcp(mcp_name="playwright", tool_name="...", arguments={...})`):

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Navigate to URL |
| `browser_snapshot` | Capture accessibility snapshot (better than screenshot for QA) |
| `browser_take_screenshot` | Screenshot of current page |
| `browser_console_messages` | Read browser console errors/warnings |
| `browser_click` | Click element |
| `browser_find` | Search accessibility tree for text/regex |
| `browser_wait_for` | Wait for text/element or time |
| `browser_network_requests` | List network requests |
| `browser_evaluate` | Run JS in page context |
| `browser_fill_form` | Fill form fields |
| `browser_type` | Type text into element |
| `browser_press_key` | Press keyboard key |
| `browser_tabs` | Manage browser tabs |
| `browser_select_option` | Select dropdown option |
| `browser_hover` | Hover over element |
| `browser_drag` | Drag and drop |
| `browser_resize` | Resize browser window |
| `browser_close` | Close the page |
| `browser_network_request` | Get full details of a single network request |
| `browser_handle_dialog` | Accept/dismiss browser dialog |
| `browser_file_upload` | Upload files |
| `browser_drop` | Drop files onto element |
| `browser_run_code_unsafe` | Run arbitrary Playwright JS code (RCE-equivalent) |

### Quick Start

```typescript
// Navigate and screenshot
skill_mcp({
  mcp_name: "playwright",
  tool_name: "browser_navigate",
  arguments: { url: "http://localhost:5178/#manual-line-3d" }
})

// Check console errors
skill_mcp({
  mcp_name: "playwright",
  tool_name: "browser_console_messages",
  arguments: { level: "error", all: true }
})

// Screenshot
skill_mcp({
  mcp_name: "playwright",
  tool_name: "browser_take_screenshot",
  arguments: { type: "png", filename: "manual-line-check.png", scale: "css" }
})

// Snapshot (accessibility tree) — best for QA verification
skill_mcp({
  mcp_name: "playwright",
  tool_name: "browser_snapshot",
  arguments: { boxes: true }
})
```

### Workflow for UI Verification

1. **Navigate** to the page
2. **Wait** for it to stabilize
3. **Check console** for errors (`browser_console_messages`)
4. **Snapshot** to verify elements present
5. **Screenshot** for visual record

### Example: Verify Manual Line 3D Renders

```typescript
// 1. Navigate
browser_navigate({ url: "http://localhost:5178/#manual-line-3d" })

// 2. Wait 3s for 3D to init
browser_wait_for({ time: 3 })

// 3. Check console for errors
browser_console_messages({ level: "error", all: true })

// 4. Screenshot
browser_take_screenshot({ type: "png", filename: "manual-line-3d.png", scale: "css" })
```

### Key Notes

- `browser_snapshot` captures the accessibility tree — use this instead of screenshot for functional QA (faster, text-verifiable)
- `browser_console_messages` with `all: true` returns ALL console entries since page load, not just new ones
- `scale: "css"` = normal viewport size; `scale: "device"` = high-DPI screenshot
- `browser_run_code_unsafe` executes arbitrary JS in the Playwright server process — **RCE-equivalent, use only for debugging**
- Logs saved to `.playwright-mcp/` directory in the workspace root

## Architecture

## Canonical scanner invariant

- Every scan at every station runs detection; there is no trusted scanner registry or permanent clearance cache.
- The station performs immediate local/offline checks, then MES supplies the canonical factory-wide NG, DUP, handover, identity, and route-sequence decision.
- MES records the interception decision; the station executes the physical block and sound/light alarm. 3D only displays and alarms.
- Scanner observations never register formal production SNs and must not enter today-SN, historical-SN, PASS, or production-result tables.
- Scanner observations may exist only in a separate short-retention audit/interception log.
- Only accepted CSV, Excel, or production equipment/database results may create formal SN facts.
- On network loss, local guards continue under the configured fail-safe policy. Reconnection reconciles queued checks without converting scanner observations into formal SN records.
- One explicitly armed retest may bypass duplicate handling once; confirmed-NG, handover, identity, and route protections remain mandatory.

## Canonical delivery and piping invariants

- **No stuck data:** stable event IDs, idempotent acknowledgement, bounded exponential retry for transient failures, and visible quarantine for permanent failures.
- A bad message may preserve ordering for its own entity, but it must never stop unrelated entities from synchronizing.
- Expose pending count, oldest queue age, attempts, last error and quarantine count; alarm on thresholds.
- **No mis-piping:** each dataset declares its owner, producer, allowed consumers, direction, schema version and acknowledgement contract.
- Station facts flow station → MES. MES commands flow only to named stations. MES projections flow to 2D/3D. Heartbeats use a separate ephemeral path.
- Reject and quarantine wrong-owner, wrong-station, wrong-channel, stale-version and incompatible-schema messages.
- Reconnection resumes from acknowledged checkpoints and reconciles event IDs, versions and hashes. Downstream data never overwrites newer upstream truth.

```
station_types table
     ↑ FK
stations table  ←  production_lines (via line_id)
                        production_stations (via station_type_id)
```

**Station Type** = classification layer (e.g. "SMT-AOI", "ICT检测") with section (smt/post_smt/packaging/oqc/auxiliary) and integration flags (has_hardware / has_software)

**Station Master** = operational instance of a station type on a specific production line (e.g. "SMT-AOI-01 on line-01")

## API Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/mes/station-types` | `mes.view` | List all station types |
| POST | `/mes/station-types` | `mes.admin` | Create station type |
| PUT | `/mes/station-types/:id` | `mes.admin` | Update station type (code immutable) |
| DELETE | `/mes/station-types/:id` | `mes.admin` | Soft-delete (status='inactive') |
| GET | `/mes/stations` | `mes.view` | List stations (filter: ?lineCode, ?stationType) |
| POST | `/mes/stations` | `mes.admin` | Create station (FK: line_id, station_type_id) |
| PUT | `/mes/stations/:code` | `mes.admin` | Update station by code |
| DELETE | `/mes/stations/:code` | `mes.admin` | Soft-delete (status='inactive') |

## SN + NG Blocking — How It Works

### Duplicate SN Detection — `/mes/events` POST

When a PCB serial is scanned, the POST handler checks `pcb_serials`:

```
SN found + status ∈ {scrapped, voided, shipped}  → BLOCK
SN found + action ∈ {scrapped, voided, bind, issue_to_line, ship} → BLOCK
SN found + otherwise                        → ALLOW (log to sn_duplicate_attempts)
SN not found                               → auto-register + ALLOW
```

**Key**: Duplicate detection is based on `pcb_serials.status` (master flag), NOT on FAIL events in `station_events`.

### NG Defect Recording — `/mes/events` POST

When `result === "fail"` with `errorCode` or `defectCode`:
- Records to `ng_defect_records` table via `recordNgDefect()`
- Broadcasts SSE `NG_DEFECT` event to all subscribers

**Problem**: Does NOT update `pcb_serials.status`. NG board can still be re-scanned at downstream stations.

### Upstream NG Check — `GET /mes/events/upstream-check/:pcbSerial?stationCode=X`

The **core anti-NG-leaking mechanism**:
1. Looks up station's sequence order in `station_sequences`
2. Finds all upstream stations (same line with lower `sequence_order` + parent line)
3. Queries `station_events` for this SN at upstream stations
4. Returns verdict: `BLOCK_NG` / `OK` / `UNKNOWN`

**PROBLEM**: This endpoint exists but `StationOperator.tsx` NEVER calls it.

## The Gaps

### Gap 1: StationOperator.tsx does NOT call upstream-check

`StationOperator.tsx` posts events directly without checking upstream NG history. System should:
1. `GET /mes/events/upstream-check/:pcbSerial?stationCode=X`
2. If `BLOCK_NG` → block with alert; if `OK` → allow; if `UNKNOWN` → warn but allow

### Gap 2: NG at one station does NOT block downstream re-scan

Board fails at ICT → NG recorded → same SN can still pass at FCT. `pcb_serials.status` only set to scrapped/voided/shipped, not updated on NG.

### Gap 3: Re-pass / repair flow not enforced

After NG → repair, no mechanism clears the FAIL flag. `upstream-check` returns BLOCK_NG forever.

### Gap 4: Retest flow not enforced in UI

Retest rules exist as display text but are NOT enforced in `StationOperator.tsx`.

## Relevant DB Tables

| Table | Purpose |
|-------|---------|
| `pcb_serials` | SN master — `serial_no`, `status` (wip/bind/scrapped/voided/shipped) |
| `station_events` | All pass/fail events — `pcb_serial_id`, `station_id`, `event_type`, `result` |
| `ng_defect_records` | NG defect details — `sn`, `station_code`, `defect_code`, `defect_desc` |
| `sn_duplicate_attempts` | Duplicate SN attempt log — `sn`, `station_code`, `decision` (allowed/blocked) |
| `station_sequences` | Station order per line — `line_code`, `station_code`, `sequence_order` |

## Relevant API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/mes/events` | Post station event (checkin/pass/fail) |
| GET | `/mes/events/upstream-check/:pcbSerial?stationCode=X` | **KEY** — returns BLOCK_NG/OK/UNKNOWN |
| GET | `/mes/sn-duplicate-attempts` | Query duplicate SN attempt log |
| GET | `/mes/stations/:code/ng-defects` | NG defects per station |
| GET | `/mes/trace/:serialNo` | Full traceability chain for an SN |

---

## 工位目录清理（Wipe Ass）

完成 station.py + station.html 开发后，清理工位目录，只留必要文件。

### 必须保留
```
工位文件夹/
├── *.py              # Python 源码
├── station.html      # HTML 界面
├── *.db              # SQLite 数据文件
└── *.spec           # PyInstaller spec（如有）
```

### 清理规则

| 类型 | 示例 | 操作 |
|------|------|------|
| Python cache | `__pycache__/` | 删除 |
| Build 输出 | `build/`, `dist/` | 删除 |
| 代码索引 | `.codegraph/` | 删除 |
| 打包产物 | `*.exe` | 删除 |
| 测试脚本 | `test_*.py` | 删除 |
| 临时文件 | `*.tmp`, `*.bak` | 删除 |
| 错误 station 文件 | `index_*.html`（不是该工位的） | 删除 |
| node_modules | `node_modules/` | 删除（如有） |

### PowerShell 命令

```powershell
# 在工位文件夹下执行
Get-ChildItem | ForEach-Object {
  $size = if ($_.PSIsContainer) {
    (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  } else { $_.Length }
  [PSCustomObject]@{ Name=$_.Name; Type=if($_.PSIsContainer){'dir'}else{'file'}; "Size(MB)"=[math]::Round($size/1MB,2)} }
} | Sort-Object Type,Name | Format-Table -AutoSize

# 删除常见垃圾
Remove-Item -LiteralPath "build" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "__pycache__" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath ".codegraph" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Filter "test_*.py" -Force
Remove-Item -Filter "*.exe" -Force -ErrorAction SilentlyContinue
```

---

## MES Missioner — `apps/station-agent/`

### Purpose

New standalone station PC app (React + Vite) coexists with `scanner_helper.py`. Provides:
- Local offline-first SQLite pool (SN records, NG pool, DUP pool)
- Full MES integration (posts events, subscribes to SSE NG_DEFECT, calls upstream-check)
- Keyboard barcode scanner capture
- Real-time inter-station NG broadcast via MES SSE

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  station-agent (React SPA, Vite dev server)          │
│  Port: 5179 (separate from web :5178)               │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Local SQLite │  │ MES API Client│  │ SSE Sub  │ │
│  │ (Dexie.js)  │  │ /mes/events  │  │ NG_DEFECT│ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
│         │                  ↑              │         │
│         ↓                  │              │         │
│  ┌──────────────────────────────────────┐ │         │
│  │         Scan Logic Engine            │ │         │
│  │  1. Capture keystroke (barcode)      │ │         │
│  │  2. Check local NG/DUP pools         │ │         │
│  │  3. POST /mes/events upstream-check  │───────────┘
│  │  4. Record result to local SQLite    │            │
│  │  5. Sync queue when online           │            │
│  └──────────────────────────────────────┘            │
└─────────────────────────────────────────────────────┘
         ↕ REST / SSE
         ↓
┌─────────────────────┐     ┌────────────────────────────┐
│  smt-factory-system  │     │  PostgreSQL (central DB)   │
│  Express API :8080   │────▶│  pcb_serials              │
│  SSE neuralBroadcast │     │  station_events            │
└─────────────────────┘     │  ng_defect_records         │
                            └────────────────────────────┘
```

### Location & Stack

- **Path**: `smt-factory-system/apps/station-agent/`
- **Stack**: React 19 + TypeScript 5.8 + Vite 8 + Dexie.js (SQLite wrapper)
- **Port**: 5179 (dev), distinct from main web app (5178)
- **npm workspace**: registered in root `package.json` under `apps/*`

### Local SQLite Schema (Dexie.js)

```typescript
// db.ts — Dexie.js instance
import Dexie, { type Table } from 'dexie';

interface SnRecord {
  id?: number;
  sn: string;
  result: 'PASS' | 'NG' | 'DUP';
  time: string;
  source: 'scanner' | 'manual' | 'sync';
  station: string;
  lineName: string;
  operator: string;
  synced: boolean;  // false = pending sync to MES API
}

interface NgPoolRecord {
  id?: number;
  sn: string;
  time: string;
  source: string;
  station: string;
  lineName: string;
  operator: string;
  synced: boolean;
}

interface SyncQueueItem {
  id?: number;
  action: 'add_sn' | 'add_ng' | 'add_dup';
  payload: Record<string, unknown>;
  createdAt: string;
  retries: number;
}

class StationDB extends Dexie {
  snRecords!: Table<SnRecord>;
  ngPool!: Table<NgPoolRecord>;
  dupPool!: Table<NgPoolRecord>; // reuse same shape
  syncQueue!: Table<SyncQueueItem>;

  constructor() {
    super('scanner_station_db');
    this.version(1).stores({
      snRecords: '++id, sn, result, time, synced',
      ngPool: '++id, sn, time, synced',
      dupPool: '++id, sn, time, synced',
      syncQueue: '++id, action, createdAt',
    });
  }
}
export const db = new StationDB();
```

### API Integration (`mesApi.ts`)

```typescript
// mesApi.ts — wrapper for MES API calls from station app
const API_BASE = '/api'; // proxy to :8080 in dev

export async function postStationEvent(payload: {
  stationCode: string;
  pcbSerial: string;
  result: string;
  eventType: string;
  defectCode?: string;
  defectDescription?: string;
}) {
  const res = await fetch(`${API_BASE}/mes/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getUpstreamCheck(pcbSerial: string, stationCode: string) {
  const res = await fetch(
    `${API_BASE}/mes/events/upstream-check/${encodeURIComponent(pcbSerial)}?stationCode=${encodeURIComponent(stationCode)}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { verdict, mustRepair, upstreamEvents, ... }
}

// SSE subscription for NG_DEFECT from all stations
export function subscribeNgDefect(onEvent: (payload: NgDefectPayload) => void) {
  const es = new EventSource(`${API_BASE}/pda/events?node=station_op&types=NG_DEFECT`);
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'NG_DEFECT') onEvent(data.payload);
  };
  return () => es.close();
}
```

### Scan Logic (`scanEngine.ts`)

```typescript
// scanEngine.ts — core scan decision tree
export async function processScan(sn: string, stationCode: string) {
  // 1. Check local NG pool
  const ngMatch = await db.ngPool.where('sn').equals(sn).first();
  if (ngMatch) return { result: 'NG', source: 'local_ng_pool', synced: ngMatch.synced };

  // 2. Check local DUP pool
  const dupMatch = await db.dupPool.where('sn').equals(sn).first();
  if (dupMatch) return { result: 'DUP', source: 'local_dup_pool', synced: dupMatch.synced };

  // 3. Check local SN records (already processed this SN today)
  const snMatch = await db.snRecords.where('sn').equals(sn).first();
  if (snMatch) return { result: 'DUP', source: 'local_sn_record', synced: snMatch.synced };

  // 4. Call MES upstream-check
  const uc = await getUpstreamCheck(sn, stationCode);
  if (uc.verdict === 'BLOCK_NG') {
    // Record NG locally + queue sync
    await recordLocal('ngPool', sn, 'upstream_block');
    return { result: 'NG', source: 'upstream_check', verdict: 'BLOCK_NG' };
  }

  if (uc.mustRepair) {
    // Allow FAIL but track — PASS will be blocked until repaired
    return { result: 'PASS', source: 'upstream_ok', upstreamCheck: uc };
  }

  // 5. All clear — record PASS
  await recordLocal('snRecords', sn, 'pass');
  return { result: 'PASS', source: 'cleared', synced: false };
}

async function recordLocal(
  table: 'snRecords' | 'ngPool' | 'dupPool',
  sn: string,
  result: string,
) {
  const now = new Date().toISOString();
  const record = { sn, result, time: now, source: 'scanner', synced: false };
  await db[table].add(record);
  // Always queue for sync
  await db.syncQueue.add({ action: `add_${table.replace('Records','').replace('Pool','')}`, payload: { ...record }, createdAt: now, retries: 0 });
}
```

### Offline Sync (`syncManager.ts`)

```typescript
// syncManager.ts — background sync worker
export function startSyncManager(intervalMs = 5000) {
  setInterval(async () => {
    const pending = await db.syncQueue.toArray();
    for (const item of pending) {
      try {
        await postStationEvent(item.payload);
        await db.syncQueue.delete(item.id!);
        // Mark source record as synced
        if (item.action === 'add_sn') {
          await db.snRecords.where('sn').equals(item.payload.sn).modify({ synced: true });
        }
      } catch (err) {
        if (item.retries >= 3) {
          await db.syncQueue.delete(item.id!); // drop after 3 retries
        } else {
          await db.syncQueue.update(item.id!, { retries: item.retries + 1 });
        }
      }
    }
  }, intervalMs);
}
```

### Keyboard Capture (Barcode Scanner)

```typescript
// useBarcodeCapture.ts — React hook
// Barcode scanners send rapid keystrokes (<80ms between chars, ending with Enter)
// We detect this pattern and extract the SN.

const SCAN_MAX_GAP_MS = 80;
const SCAN_MIN_CHARS = 3;
const SCAN_FINAL_WAIT_MS = 150;

export function useBarcodeCapture(onScan: (sn: string) => void) {
  const buffer = useRef<string[]>([]);
  const lastKeyTime = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      const gap = now - lastKeyTime.current;

      if (e.key === 'Enter') {
        // Finalize scan
        if (buffer.current.length >= SCAN_MIN_CHARS) {
          const sn = buffer.current.join('').trim();
          onScan(sn);
        }
        buffer.current = [];
        lastKeyTime.current = 0;
        if (timer.current) clearTimeout(timer.current);
        return;
      }

      if (e.key.length === 1) {
        // Printable character
        if (gap < SCAN_MAX_GAP_MS) {
          buffer.current.push(e.key);
        } else {
          buffer.current = [e.key];
        }
        lastKeyTime.current = now;

        // Schedule finalization
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (buffer.current.length >= SCAN_MIN_CHARS) {
            onScan(buffer.current.join('').trim());
          }
          buffer.current = [];
        }, SCAN_FINAL_WAIT_MS);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onScan]);
}
```

### UI Components

```
scanner-station/src/
├── App.tsx                    # Main layout + routing
├── main.tsx                   # Entry point
├── i18n.ts                    # Same i18n as main web app
├── db.ts                      # Dexie.js SQLite schema
├── mesApi.ts                  # MES API client (postEvent, upstream-check, SSE)
├── scanEngine.ts              # Core scan decision logic
├── syncManager.ts             # Offline queue + background sync
├── useBarcodeCapture.ts       # React hook for keyboard capture
├── components/
│   ├── ScanPanel.tsx          # SN input + result display
│   ├── StationSelector.tsx    # Pick station/line
│   ├── LiveNgAlerts.tsx      # Real-time NG alerts from SSE
│   ├── StatsPanel.tsx         # Today's pass/ng/dup counts
│   ├── PoolViewer.tsx         # Browse local SN/NG/DUP pools
│   ├── SyncStatus.tsx         # Online/offline + pending sync count
│   └── OperatorLogin.tsx      # Scan employee barcode to login
```

### Scan Flow (Full)

```
扫码枪输入 → keystroke timing检测 (useBarcodeCapture)
  → buffer ≥ 3 chars → onScan(sn)
    → processScan(sn, stationCode)
      1. db.ngPool.find(sn)          → NG (local)
      2. db.dupPool.find(sn)         → DUP (local)
      3. db.snRecords.find(sn)        → DUP (local)
      4. getUpstreamCheck(sn)         → MES API
         verdict=BLOCK_NG             → NG (upstream blocked)
         mustRepair=true              → warn but allow FAIL
         verdict=OK|UNKNOWN           → PASS
      5. recordLocal()                → write to local SQLite
      6. queueSync()                  → add to syncQueue
    → UI显示结果 + 更新统计

SSE NG_DEFECT 广播:
  → subscribeNgDefect()             → 其他工位的NG实时弹窗提醒
  → 显示: SN, 工位, 缺陷代码, 操作员
  → 30秒自动消失

离线同步:
  → syncManager 每5秒扫描 syncQueue
  → 逐条 POST /mes/events
  → 成功 → 删除queue + 标记synced=true
  → 失败3次 → 丢弃
  → 上线后自动补同步
```

### npm Scripts (root `package.json`)

```json
{
  "scripts": {
    "dev:agent": "vite --port 5179",
    "build:agent": "vite build"
  },
  "workspaces": ["apps/*", "services/*", "packages/*"]
}
```

### Gaps Addressed

| Gap | Fix |
|-----|-----|
| NG not blocking downstream | Via `upstream-check` API + local NG pool |
| No offline resilience | Local SQLite + sync queue |
| No real-time NG alerts | SSE subscription to `NG_DEFECT` |
| scanner_helper.py standalone | Coexists; new app adds full MES integration |
| Retest not enforced | `mustRepair` from `upstream-check` shown in UI |

### Coexists With

- `scanner_helper.py` — Python app on port 8089 (unchanged)
- `smt-factory-system/services/api/server.js` — MES API on :8080 (unchanged)
- `apps/web/` — main React SPA on :5178 (unchanged)

---

## MES Missioner — Data Source Adapter Framework

### Purpose

The MES Missioner can connect to and consume data from **any data source** — files, APIs, databases, industrial protocols, and message queues. Data sources feed the scan engine and MES workflow with live context (e.g., work order data, material specs, upstream station results, AOI/SPI output).

**Key principle: All data source configuration is human-operable.** Operators at the station can add, edit, remove, enable, or disable any data source directly from the UI — no restart, no config file editing, no deployment required. Configs persist in local SQLite and auto-reconnect on app restart.

### Supported Data Sources

| Category | Type | How It Works |
|----------|------|-------------|
| **Files** | JSON, CSV, Text, Excel (.xlsx), PDF, Word (.docx) | File watcher or on-demand read; parses content into typed records |
| **HTTP/REST** | External APIs, MES vendors, ERP endpoints | `fetch()` with auth (Bearer/API key/Basic); polls or webhook receiver |
| **TCP/Raw Socket** | PLCs, testers, AOI machines, custom device protocols | Node.js `net` module; JSON-framed or delimiter-separated messages |
| **WebSocket** | Live feeds from AOI, SPI, reflow profilers | `WebSocket` client; subscribes to device-specific topics |
| **Database** | MySQL, SQL Server, PostgreSQL, SQLite | Direct query; connection pool; used for lookup (SN history, WO data) |
| **MQTT** | Industrial IoT sensors, AOI results, environment monitors | `mqtt.js` subscriber; QoS 1; topic-filtered |
| **OPC-UA** | SMT pick-and-place machines, reflow ovens, conveyors | `node-opcua` client; subscription-based monitoring |
| **Modbus TCP** | Power meters, temperature controllers, aging racks | `modbus-serial`; read/write holding registers |
| **Serial (RS-232/485)** | RS-485 sensors, legacy testers, weighing scales | `serialport` package; delimiter or length-based framing |
| **USB/HID** | Scales, gauges, CMM devices | `node-hid` or WebHID API via browser |

### Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                     MES Missioner — Station Agent                       │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │              DataSourcePanel (Operator UI)                     │       │
│  │  Operator can ADD / EDIT / REMOVE / ENABLE / DISABLE        │       │
│  │  any data source directly from this panel — no restart        │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                    │                                   │
│  ┌─────────────────────────────────┴─────────────────────────────┐      │
│  │                  DataSourceManager                            │      │
│  │  • Registry of live adapters                                │      │
│  │  • Connect / disconnect / auto-reconnect on failure           │      │
│  │  • Unified .query() — all adapters implement same interface  │      │
│  └──────────────┬────────────────┬────────────────┬──────────────┘      │
│                 │                │                │                    │
│  ┌──────────────┴───┐ ┌──────────┴───┐ ┌──────────┴───┐            │
│  │  FileAdapter    │ │  HttpAdapter  │ │  TcpAdapter   │            │
│  │  excel/csv     │ │  REST /       │ │  JSON/delimit  │            │
│  │  json/pdf/docx  │ │  Webhook      │ │  OPC-UA/Modbus │            │
│  └─────────────────┘ └───────────────┘ └────────────────┘            │
│  ┌──────────────┐ ┌───────────┐ ┌──────────┐ ┌───────────────┐       │
│  │  WsAdapter   │ │ MqttAdapter│ │ DbAdapter │ │SerialAdapter  │       │
│  │  WebSocket  │ │  MQTT IoT  │ │ MySQL/SQL │ │ RS-485/HID   │       │
│  └──────────────┘ └───────────┘ └──────────┘ └───────────────┘       │
│                          │                                           │
│                          ↓                                           │
│               ┌──────────────────────────┐                         │
│               │    NormalizedRecord       │                         │
│               │  { source, timestamp,     │                         │
│               │    sn?, type, data }       │                         │
│               └──────────────┬─────────────┘                         │
└──────────────────────────────┼───────────────────────────────────────┘
                               ↓
┌────────────────────────────────────────────────────────────────────────┐
│                      Consumer Layer                                    │
│                                                                        │
│  scanEngine.ts   → cross-references SN + data source records         │
│  MES API sync    → feeds normalized records to central PostgreSQL    │
│  AlertRuleEngine → evaluates operator-defined rules per adapter         │
│                    → triggers local UI alert or NG broadcast           │
│  LiveFeed UI     → real-time scrollable feed of all adapter records  │
└────────────────────────────────────────────────────────────────────────┘
```

### Interface (`dataAdapters.ts`)

```typescript
// ── Base adapter interface ────────────────────────────────────────
export interface AdapterOptions {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface NormalizedRecord {
  source: string;           // adapter id
  timestamp: string;         // ISO 8601
  sn?: string;              // PCB serial if identifiable
  type: 'result' | 'measurement' | 'event' | 'log';
  data: Record<string, unknown>;
}

export interface DataAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Execute a query / read / subscribe depending on adapter type */
  query<T = NormalizedRecord>(opts?: Record<string, unknown>): Promise<T[]>;
  isConnected(): boolean;
  onRecord(cb: (record: NormalizedRecord) => void): void;
  onError(cb: (err: Error) => void): void;
}
```

### File Adapter (`adapters/fileAdapter.ts`)

```typescript
// Handles: JSON, CSV, TSV, Text, Excel (.xlsx/.xls), PDF, Word (.docx)
// Config in local SQLite: data_source_configs table

interface FileAdapterOptions extends AdapterOptions {
  type: 'file';
  config: {
    filepath: string;           // absolute path or glob pattern
    format: 'json' | 'csv' | 'excel' | 'pdf' | 'docx' | 'text';
    watch?: boolean;            // use chokidar FS watcher for live updates
    pollIntervalMs?: number;    // or poll periodically
    snField?: string;           // field name for SN in the file
    timestampField?: string;    // field name for timestamp
    delimiter?: string;         // for CSV (default: ',')
    sheetName?: string;         // for Excel: which sheet to read
    jsonPath?: string;          // JSONPath expression to extract records
  };
}

class FileAdapter implements DataAdapter {
  async query<T = NormalizedRecord>() {
    const records: NormalizedRecord[] = [];
    if (this.opts.config.format === 'json') {
      const content = await fs.promises.readFile(this.opts.config.filepath, 'utf-8');
      const json = JSON.parse(content);
      const items = this.opts.config.jsonPath
        ? jsonpath.query(json, this.opts.config.jsonPath)
        : Array.isArray(json) ? json : [json];
      for (const item of items) {
        records.push(this.normalize(item));
      }
    } else if (this.opts.config.format === 'excel') {
      const wb = readExcel(this.opts.config.filepath);
      const ws = wb.getSheet(this.opts.config.config.sheetName ?? wb.getSheetName(0));
      const rows = ws.getRows();
      const headers = rows[0].values as string[];
      for (const row of rows.slice(1)) {
        const obj = Object.fromEntries(headers.map((h, i) => [h, row.values[i]]));
        records.push(this.normalize(obj));
      }
    } else if (this.opts.config.format === 'csv') {
      const content = await fs.promises.readFile(this.opts.config.filepath, 'utf-8');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',');
      for (const line of lines.slice(1)) {
        const values = line.split(',');
        const obj = Object.fromEntries(headers.map((h, i) => [h.trim(), values[i]?.trim()]));
        records.push(this.normalize(obj));
      }
    } else if (this.opts.config.format === 'pdf') {
      // Use pdf-parse to extract text from PDF
      const buf = await fs.promises.readFile(this.opts.config.filepath);
      const data = await pdfParse(buf);
      // Parse data.text for SN patterns or structured content
      records.push({ source: this.id, timestamp: new Date().toISOString(), type: 'log', data: { text: data.text } });
    } else if (this.opts.config.format === 'docx') {
      // Use mammoth to extract text from Word
      const buf = await fs.promises.readFile(this.opts.config.filepath);
      const result = await mammoth.extractRawText({ buffer: buf });
      records.push({ source: this.id, timestamp: new Date().toISOString(), type: 'log', data: { text: result.value } });
    }
    return records as T[];
  }
}
```

### HTTP/REST Adapter (`adapters/httpAdapter.ts`)

```typescript
interface HttpAdapterOptions extends AdapterOptions {
  type: 'http';
  config: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    auth?: { type: 'bearer' | 'basic' | 'apikey'; value: string };
    pollIntervalMs?: number;    // 0 = no polling (webhook-only)
    body?: Record<string, unknown>;   // for POST
    responseSnPath?: string;    // JSONPath to extract SN field
    responseRecordsPath?: string; // JSONPath to array of records
    timeoutMs?: number;
  };
}

class HttpAdapter implements DataAdapter {
  private token?: string;

  async connect() {
    if (this.opts.config.auth?.type === 'bearer') {
      this.token = this.opts.config.auth.value;
    }
    // For webhook receiver, start an Express listener on a local port
    if (this.opts.config.pollIntervalMs === 0) {
      // Webhook mode: listen on localhost for POST webhook
      this.startWebhookServer();
    }
  }

  async query<T = NormalizedRecord>() {
    const headers = { ...this.opts.config.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(this.opts.config.url, {
      method: this.opts.config.method,
      headers,
      body: this.opts.config.method === 'POST' ? JSON.stringify(this.opts.config.body) : undefined,
      signal: AbortSignal.timeout(this.opts.config.timeoutMs ?? 10000),
    });
    const json = await res.json();

    // Extract records via JSONPath
    const items = this.opts.config.responseRecordsPath
      ? jsonpath.query(json, this.opts.config.responseRecordsPath)
      : [json];

    return items.map((item: Record<string, unknown>) => this.normalize(item)) as T[];
  }
}
```

### TCP Socket Adapter (`adapters/tcpAdapter.ts`)

```typescript
// Handles: JSON-framed TCP, delimiter-separated (newline/ETX), PLC protocols
interface TcpAdapterOptions extends AdapterOptions {
  type: 'tcp';
  config: {
    host: string;
    port: number;
    protocol: 'json' | 'delimiter' | 'length-prefix' | 'modbus';
    delimiter?: string;          // for delimiter mode: '\n' or '\r\n' or '\x03'
    framing?: { lengthSize: 2 | 4; bigEndian?: boolean }; // for length-prefix
    reconnectIntervalMs?: number;
    heartbeatIntervalMs?: number;
    snExtractRegex?: string;    // regex to pull SN from raw bytes
  };
}

class TcpAdapter implements DataAdapter {
  private client?: net.Socket;
  private buffer = '';

  async connect() {
    this.client = net.createConnection({
      host: this.opts.config.host,
      port: this.opts.config.port,
    });

    this.client.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      this.processBuffer();
    });

    this.client.on('close', () => {
      setTimeout(() => this.connect(), this.opts.config.reconnectIntervalMs ?? 5000);
    });
  }

  private processBuffer() {
    if (this.opts.config.protocol === 'delimiter') {
      const parts = this.buffer.split(this.opts.config.delimiter ?? '\n');
      this.buffer = parts.pop() ?? '';
      for (const part of parts) {
        this.emitRecord(part.trim());
      }
    } else if (this.opts.config.protocol === 'json') {
      // Try to parse complete JSON objects (may span multiple chunks)
      while (this.buffer.includes('\n')) {
        try {
          const idx = this.buffer.indexOf('\n');
          const line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 1);
          const obj = JSON.parse(line);
          this.emitRecord(obj);
        } catch {
          break; // incomplete JSON, wait for more data
        }
      }
    }
  }
}
```

### WebSocket Adapter (`adapters/wsAdapter.ts`)

```typescript
// Handles: AOI live results, SPI data, reflow profiler streams, custom WS feeds
interface WsAdapterOptions extends AdapterOptions {
  type: 'websocket';
  config: {
    url: string;
    protocols?: string | string[];
    headers?: Record<string, string>;
    subscribeTopic?: string;   // message to send after connect to subscribe
    pollIntervalMs?: number;  // if server doesn't push, poll this interval
    snPath?: string;           // JSONPath to SN field in message
  };
}

class WebSocketAdapter implements DataAdapter {
  private ws?: WebSocket;
  private queue: NormalizedRecord[] = [];

  async connect() {
    this.ws = new WebSocket(this.url, this.opts.config.protocols);

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
        if (this.opts.config.subscribeTopic && !this.subscribed) {
          this.ws?.send(JSON.stringify(this.opts.config.subscribeTopic));
          this.subscribed = true;
        }
        const record = this.normalize(msg);
        this.queue.push(record);
        this.recordCallbacks.forEach((cb) => cb(record));
      } catch {
        // raw text message
        this.recordCallbacks.forEach((cb) =>
          cb({ source: this.id, timestamp: new Date().toISOString(), type: 'log', data: { raw: data.toString() } }),
        );
      }
    });

    this.ws.on('close', () => {
      setTimeout(() => this.connect(), 5000);
    });
  }

  async query<T = NormalizedRecord>() {
    const out = [...this.queue];
    this.queue = [];
    return out as T[];
  }
}
```

### MQTT Adapter (`adapters/mqttAdapter.ts`)

```typescript
// Handles: industrial IoT sensors, AOI/SPI result topics, environment monitors
interface MqttAdapterOptions extends AdapterOptions {
  type: 'mqtt';
  config: {
    broker: string;           // mqtt://host:1883 or wss:// for TLS
    clientId?: string;
    username?: string;
    password?: string;
    topics: string[];       // e.g. ['factory/+/aoi/result', 'factory/+/spi/data']
    qos?: 0 | 1 | 2;
    retain?: boolean;
    snTopicExtract?: string; // JSONPath in payload for SN field
  };
}

class MqttAdapter implements DataAdapter {
  private client?: mqtt.MqttClient;

  async connect() {
    this.client = mqtt.connect(this.opts.config.broker, {
      clientId: this.opts.config.clientId ?? `station-agent-${Date.now()}`,
      username: this.opts.config.username,
      password: this.opts.config.password,
    });

    for (const topic of this.opts.config.topics) {
      this.client.subscribe(topic, { qos: this.opts.config.qos ?? 1 });
    }

    this.client.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        const record = this.normalize(msg);
        this.recordCallbacks.forEach((cb) => cb(record));
      } catch {
        // binary or non-JSON payload
      }
    });
  }
}
```

### Database Adapter (`adapters/dbAdapter.ts`)

```typescript
// Handles: MySQL, SQL Server, PostgreSQL, SQLite — lookup tables only
interface DbAdapterOptions extends AdapterOptions {
  type: 'mysql' | 'sqlserver' | 'postgresql' | 'sqlite';
  config: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    filepath?: string;       // for SQLite
    sql: string;             // parameterized query template
    params?: unknown[];
    pollIntervalMs?: number;
    snField?: string;         // column name for SN
  };
}

class DbAdapter implements DataAdapter {
  private pool?: mysql.Pool | pg.Pool | mssql.Pool | sqlite3.Database;

  async connect() {
    if (this.opts.type === 'mysql') {
      this.pool = mysql.createPool({
        host: this.opts.config.host, port: this.opts.config.port,
        user: this.opts.config.user, password: this.opts.config.password,
        database: this.opts.config.database, waitForConnections: true,
        connectionLimit: 5,
      });
    } else if (this.opts.type === 'postgresql') {
      this.pool = new pg.Pool({
        host: this.opts.config.host, port: this.opts.config.port,
        user: this.opts.config.user, password: this.opts.config.password,
        database: this.opts.config.database, max: 5,
      });
    } else if (this.opts.type === 'sqlite') {
      this.pool = sqlite3.open(this.opts.config.filepath!);
    }
  }

  async query<T = NormalizedRecord>() {
    const rows = await this.pool.query(this.opts.config.sql, this.opts.config.params ?? []);
    return (Array.isArray(rows) ? rows : rows.rows).map((row: Record<string, unknown>) =>
      this.normalize(row),
    ) as T[];
  }
}
```

### AlertRuleEngine (`alertRuleEngine.ts`)

```typescript
// Evaluates operator-defined threshold rules against incoming NormalizedRecords
// Rules are stored in local SQLite; operators define them via AlertRuleEditor UI

import { Parser } from 'expr-eval';

interface AlertRule {
  id: string;
  adapterId: string;         // only evaluate rules for this adapter
  name: string;
  expression: string;        // e.g., "defect_count > 3" or "peak_temp > 260"
  severity: 'warning' | 'critical';
  action: 'local_alert' | 'ng_trigger' | 'forward_mes';
  enabled: boolean;
}

class AlertRuleEngine {
  private rules: AlertRule[] = [];
  private db = new StationDB();
  private parser = new Parser();

  async loadRules() {
    this.rules = await this.db.alertRules.toArray();
  }

  async addRule(rule: AlertRule) {
    // Validate expression syntax before saving
    try { this.parser.evaluate(rule.expression, {}); }
    catch { throw new Error(`Invalid expression: ${rule.expression}`); }
    await this.db.alertRules.put(rule);
    this.rules.push(rule);
  }

  async removeRule(id: string) {
    await this.db.alertRules.delete(id);
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  /** Called by DataSourceManager for every incoming record */
  evaluate(record: NormalizedRecord): AlertResult | null {
    const matchingRules = this.rules.filter(
      (r) => r.enabled && r.adapterId === record.source,
    );

    for (const rule of matchingRules) {
      try {
        // Evaluate expression against record.data
        const result = this.parser.evaluate(rule.expression, record.data as Record<string, number>);
        if (result === true) {
          return { rule, record };
        }
      } catch {
        // expression evaluated false or error — skip
      }
    }
    return null;
  }
}

interface AlertResult {
  rule: AlertRule;
  record: NormalizedRecord;
}
```

### DataSourceManager (`dataSourceManager.ts`)

```typescript
// Central registry and lifecycle manager for all adapters
class DataSourceManager {
  private adapters = new Map<string, DataAdapter>();
  private db = new StationDB();
  private ruleEngine = new AlertRuleEngine();

  async register(opts: AdapterOptions): Promise<void> {
    const adapter = this.factory(opts);
    await adapter.connect();
    adapter.onRecord((record) => this.handleRecord(record));
    adapter.onError((err) => console.error(`[${adapter.id}] error:`, err.message));
    this.adapters.set(opts.id, adapter);

    // Persist config
    await this.db.dataSourceConfigs.put({ id: opts.id, ...opts, enabled: true });
  }

  async unregister(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
      await this.db.dataSourceConfigs.delete(id);
    }
  }

  async queryAll<T = NormalizedRecord>(): Promise<T[]> {
    const results = await Promise.allSettled(
      [...this.adapters.values()].map((a) => a.query<T>()),
    );
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  private async handleRecord(record: NormalizedRecord) {
    // Feed record into scan engine context
    if (record.sn) {
      await this.db.dataSourceRecords.put(record);
    }

    // Evaluate alert rules
    const alert = this.ruleEngine.evaluate(record);
    if (alert) {
      if (alert.rule.action === 'ng_trigger') {
        // Trigger NG alert in scan engine
        // ...
      } else if (alert.rule.action === 'local_alert') {
        // Emit to UI alert stream
        // ...
      }
    }

    // Emit to UI for live display
    this.recordCallbacks.forEach((cb) => cb(record));
  }
}
```

### Local SQLite Schema Extension

```typescript
// Additional Dexie tables for data source support
interface DataSourceConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

interface DataSourceRecord {
  id?: number;
  source: string;       // adapter id
  sn?: string;
  timestamp: string;
  type: string;
  data: string;        // JSON stringified
}

class StationDB extends Dexie {
  // ... existing tables ...
  dataSourceConfigs!: Table<DataSourceConfig>;
  dataSourceRecords!: Table<DataSourceRecord>;

  this.version(2).stores({
    // ... existing ...
    dataSourceConfigs: 'id, type, enabled',
    dataSourceRecords: '++id, source, sn, timestamp',
  });
}
```

### npm Dependencies for Adapters

```json
{
  "dependencies": {
    "dexie": "^4.0.11",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "mqtt": "^5.10.0",
    "node-opcua": "^2.122.0",
    "modbus-serial": "^8.0.17",
    "serialport": "^13.0.0",
    "xlsx": "^0.18.5",
    "pdf-parse": "^2.4.5",
    "mammoth": "^1.7.2",
    "chokidar": "^4.0.3",
    "ws": "^8.18.0",
    "expr-eval": "^2.0.2",
    "jsonpath": "^0.2.0"
  }
}
```

### Source File Structure

```
apps/station-agent/src/
├── App.tsx
├── main.tsx
├── i18n.ts
├── db.ts                      # Extended with dataSourceConfigs, dataSourceRecords
├── mesApi.ts
├── scanEngine.ts
├── syncManager.ts
├── useBarcodeCapture.ts
├── alertRuleEngine.ts         # ← NEW: evaluates operator-defined rules
├── adapters/
│   ├── index.ts               # DataSourceManager + factory
│   ├── DataAdapter.ts          # Interface + NormalizedRecord types
│   ├── fileAdapter.ts         # json, csv, excel, pdf, docx, text
│   ├── httpAdapter.ts          # REST, webhook receiver
│   ├── tcpAdapter.ts          # Raw sockets, JSON-framed, PLC protocols
│   ├── wsAdapter.ts           # WebSocket client
│   ├── mqttAdapter.ts         # MQTT subscriber
│   ├── dbAdapter.ts           # MySQL, SQL Server, PostgreSQL, SQLite
│   ├── opcuaAdapter.ts        # OPC-UA client
│   ├── modbusAdapter.ts       # Modbus TCP / RTU
│   └── serialAdapter.ts      # RS-232/485 serial port
└── components/
    ├── ScanPanel.tsx
    ├── StationSelector.tsx
    ├── LiveNgAlerts.tsx
    ├── StatsPanel.tsx
    ├── SyncStatus.tsx
    ├── OperatorLogin.tsx
    ├── DataSourcePanel.tsx     # Operator UI: add/edit/enable/disable/remove adapters
    ├── DataSourceRecordTable.tsx # Live feed from all adapters
    └── AlertRuleEditor.tsx      # ← NEW: operator UI to define threshold rules
```

### Data Source Config UI

The `DataSourcePanel` is a **fully operator-facing UI** — not an admin-only panel. Every operator at the station can add, edit, remove, enable, or disable data sources directly from the MES Missioner screen. No restart required.

**What operators can do from the DataSourcePanel:**

1. **Add a new data source**
   - Pick adapter type (File / HTTP / TCP / WebSocket / MQTT / DB / OPC-UA / Modbus / Serial)
   - Fill in connection parameters (IP, port, file path, URL, topic, SQL query, etc.)
   - **Test connection** before saving — button sends a probe and shows pass/fail inline
   - Assign a human-readable name and icon for easy identification

2. **Edit an existing data source**
   - Click any adapter card to expand its config
   - Change any parameter (IP address, polling interval, credentials, SQL, topic filter, etc.)
   - **Save & reconnect** — adapter disconnects, reconnects with new config, no app restart

3. **Enable / disable adapters**
   - Toggle switch per adapter — disabled adapters still persist their config but consume no resources
   - Quick way to switch data sources for different products or shift changeovers

4. **Remove a data source**
   - Delete with confirmation — removes config from local SQLite
   - Historical records already ingested remain in `dataSourceRecords`

5. **View live feed**
   - Real-time scrollable feed of normalized records from all connected adapters
   - Each record shows: timestamp, source adapter name, SN (if found), type badge, raw data preview

6. **SN cross-reference**
   - After scanning an SN, the UI shows all data source records linked to that SN (from any adapter)
   - Useful for operators to see AOI result, SPI data, reflow profile, etc. for the current board

7. **Alert rules**
   - Operators define per-adapter threshold rules in plain language:
     - e.g., `AOI defect_count > 3` → trigger local NG alert
     - e.g., `reflow peak_temp > 260` → warning
     - e.g., `TCP message contains "ERROR"` → alert
   - Rules are stored in local SQLite and evaluated against each incoming record
   - Alert actions: local popup on station screen, plus optional forward to MES via API

**Persistence:**
- All data source configs are stored in local SQLite (`dataSourceConfigs` table)
- On app restart, the `DataSourceManager` auto-reconnects all adapters that were `enabled: true`
- No config file editing, no code changes, no redeployment needed for adapter changes

**Example: Adding an AOI results feed via TCP**

```
Operator flow:
1. Click "+ Add Data Source"
2. Select type: "TCP Socket"
3. Name: "SMT-AOI-01 Results"
4. Host: 192.168.1.100, Port: 9001
5. Protocol: "JSON (newline-delimited)"
6. SN Extract Regex: "SN=(\w+)"
7. Click "Test Connection" → green "Connected"
8. Click "Save"
9. Live records start appearing in the feed
10. Operator sets alert rule: "defect_count > 0" → local NG alert
```

---

## Dev Server "Invalid Hook Call" Bug (React 19 + Vite 8 + npm workspaces)

### Symptom

`npm run dev` (Vite dev server) shows blank page. Browser console:

```
Invalid hook call. Hooks can only be called inside of the body of a function component.
resolveDispatcher @ react.development.js:518
Uncaught TypeError: Cannot read properties of null (reading 'useState')
    at exports.useState (react.development.js:1263:32)
    at App (App.tsx:2195:31)
```

**Production build (`npm run build` + preview) works fine.**

### Root Cause

React 19's internal module architecture uses `ReactDOMSharedInternals.d` (HooksDispatcher) which is set at module load time in `react-dom/client`. Vite's dev server pre-bundles CJS dependencies via esbuild with `needsInterop: true`. In npm workspaces, `react` is hoisted to the root `node_modules` — when esbuild pre-bundles it, the CJS→ESM interop wrappers create **separate module instances** of `ReactSharedInternals`. The `react` module and `react-dom/client` module end up with different copies of `ReactSharedInternals`, so when `react-dom` sets `ReactDOMSharedInternals.d` (the dispatcher), `react`'s `resolveDispatcher()` reads from a different `ReactSharedInternals` where `H` is still `null`.

### Why Production Works

Rollup resolves all imports to a single module instance — the dispatcher is shared correctly.

### The Fix

**Downgrade React to 18.3.1.** React 18 doesn't have the `ReactDOMSharedInternals.d` / `HooksDispatcher` separation that React 19 introduced. Vite's esbuild interop doesn't break it.

```json
// root package.json
{
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}

// apps/web/package.json
{
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

Then:
```powershell
npm install --legacy-peer-deps
# kill all node processes
npm run build
node serve-prod.mjs  # production server on port 5179
```

### What NOT to Do

- **Do not** try `@vitejs/plugin-react` version downgrades — the peer dep range issue was a red herring
- **Do not** try `optimizeDeps.include` / `exclude` — the issue persists regardless
- **Do not** try `resolve.dedupe` — already present, doesn't fix this
- **Do not** try Vite version downgrades — the bug is React 19 + esbuild interop, not Vite version

### Known Working Config

| Package | Version |
|---------|---------|
| `react` | `18.3.1` |
| `react-dom` | `18.3.1` |
| `vite` | `^8.0.16` |
| `@vitejs/plugin-react` | `^5.2.0` |
| `@types/react` | `^18.3.0` |
| `@types/react-dom` | `^18.3.0` |

---

## Canonical MES–Station–3D Data-Flow Policy

### RUIJING Trusted Data Relay Charter

#### 3D non-control invariant

The 3D line is a monitoring and alarm surface only. It has no authority to lock or otherwise control any station activity.

- It may read versioned MES projections, visualize state, and issue sound/light notifications.
- It must not lock, block, release, acknowledge, route, migrate, clear, approve, revive, retest, or mutate station or MES production state.
- Acknowledgement or release shown in 3D is display feedback only; the authoritative action must originate from an authenticated station or MES workflow.
- Closing, refreshing, disconnecting, or compromising a 3D browser must have no effect on station operation.
- MES and station safety controls must never depend on a 3D client being online.

#### One-test NG invariant

Every testing station confirms NG on the first accepted FAIL result.

- `confirmAfterFailCount = 1` and automatic retest count is zero.
- There is no ordinary pending/initial-NG stage or box.
- Any NG may be explicitly retested whenever the authorized station operator starts the retest action; there are no automatic retests.
- The product remains in the NG box during retest. Duplicate detection is bypassed for that scanner-or-result cycle only, and normal duplicate enforcement then resumes.
- Any accepted retest PASS revives the product, removes the active NG block, and records the revival in MES history.
- A failed retest remains Confirmed NG and may be selected for another authorized retest later.
- Scanners do not create formal test results; only accepted CSV, Excel, or database source records can create PASS or Confirmed NG.

#### Station box invariant

Testing stations normally present PASS and NG result boxes. ICT is the explicit exception and presents only its NG Motherboard Box.

- At ICT, PASS remains a formal result, statistic, traceability record, and MES history entry, but is not represented as a physical box.
- The visible `NG` box is the authoritative Confirmed-NG dataset; "Confirmed" is a property, not a separate box.
- Pending NG, first retest, aged NG, duplicate, handover, alarm, and processing states must not become additional product boxes.
- Retest count, age, defect, handover, and repair status appear inside the NG detail view.
- Duplicate detection and scanner interception are controls/alarms, not product boxes.
- NG aging is a deadline, not a box: every NG must be dispositioned within two hours of its first accepted NG timestamp.
- After two hours the product remains in the same NG box with an overdue flag and sound/light alarm until handled; aging never creates another product box.

#### Retest Trinity workflow

- The authenticated station Agent is the only place where an operator can arm or execute retest.
- MES authorizes, records, audits, and resolves the retest lifecycle; an accepted PASS revives NG and an accepted FAIL leaves NG active.
- The 3D line displays retest state, station, product identity, timing, result, revival, and alarms only.
- The 3D line must not expose a retest, approve, revive, release, or cancel control and cannot lock any station activity.

#### Maintenance NG work-order lifecycle

Routing NG to maintenance never revives it and always creates an MES work order.

1. Source station selects the NG motherboard/SN and requests maintenance.
2. MES creates the maintenance WO with source station, designated return station, NG identity, motherboard layout, defect, discovery time, submission time, and two-hour deadline.
3. The NG stays active and the WO is `WAITING_MAINTENANCE_RECEIPT`.
4. Maintenance scans the physical NG SN to accept it; MES records receiver/time and starts repair time. A button without the scan cannot accept it.
5. Maintenance records diagnosis, actions, replaced materials, quantities, operator, start/end time, and repair result.
6. Completing repair creates a return handover to the designated source station; the NG remains active and the WO is `WAITING_SOURCE_RETURN_RECEIPT`.
7. The designated station scans the returned SN to accept it. A scan at a different station is rejected.
8. Only that accepted return scan completes the handover, closes the WO, revives the SN, removes the active MES NG block, and updates the station PASS/NG projection.
9. Missing maintenance receipt or return receipt raises a timed alarm; 3D displays the alarm but cannot acknowledge or alter the workflow.

Every state change is append-only audited. MES owns the WO and lifecycle; stations own physical scan facts and repair execution facts.

#### ICT/FCT to depanel NG custody

- An NG motherboard remains in the originating ICT/FCT NG Motherboard Box after routing or dispatch.
- MES may mark it `WAITING_DEPANEL_RECEIPT`, but must not remove it from the source box at send time.
- Depanel identifies the complete motherboard by scanning any member SN, displays the merged twelve-slot ICT/FCT NG layout, and accepts physical custody.
- Only the accepted depanel scan/receipt removes the motherboard from the originating NG Motherboard Box and places it in depanel custody.
- Missing receipt keeps the source box entry active and raises the handover alarm; 3D displays the state but cannot complete it.
- Removal from an active station box never deletes MES history. MES permanently retains the original motherboard identity, full twelve-slot layout, NG positions, source results, timestamps, custody changes, retests, repairs, material use, revival, and final disposition.
- Active boxes are current-work projections; MES lifecycle history is immutable and remains queryable after depanel receipt, repair, revival, scrap, or line completion.

This charter governs every present and future station, person, Agent, MES node, management module, supplier/customer connection, database, device, dashboard and external subsystem.

| Principle | System obligation |
|---|---|
| Safety first | Contain confirmed NG, duplicates, unsafe material and dangerous conditions before production speed or convenience. |
| Respect history | Append new facts and corrections; never silently rewrite, erase or disguise what occurred. |
| One fact, one owner | Every business fact has one authoritative owner, even when many systems hold copies. |
| Downstream respects upstream | Downstream input comes from acknowledged upstream output plus approved exceptions. |
| Truth before display | Commit durable business truth before dashboards, voice, animation, reports or AI interpretation. |
| Effective action | Deliver the correct information to the correct responsible node in time to change the outcome. |
| Efficient operation | Avoid duplicate work, uncontrolled broadcasts, unnecessary polling, repeated payloads and resource contention. |
| Clear direction | Every channel declares source, target, purpose, owner, flow mode, acknowledgement and offline behavior. |
| Least authority | People and systems receive only the data and actions necessary for their role and scope. |
| Human judgment with control | People provide context and approval; policy preserves safety, separation of duties and audit. |
| Accountability | Every important action identifies who, what, where, when, why, source, target and result. |
| Traceability | SN, lot, motherboard, WO, carton, pallet, supplier, material, equipment and repair history remain linked end to end. |
| Resilience | Local operation, durable queues, versioned recovery and disaster snapshots protect work during outages. |
| Idempotency | Retrying the same event never creates a second business transaction. |
| Dependency integrity | No priority, person or subsystem may apply a result before its required predecessor. |
| Scoped urgency | Escalate the smallest affected scope and expire escalation when the condition resolves. |
| No silent conflict | Differences create an investigation and approved resolution, never an automatic hidden overwrite. |
| Secure by design | Authenticate nodes and people, encrypt sensitive data, protect secrets, back up records and detect tampering. |
| Privacy and dignity | Collect only necessary personal data; protect operators, suppliers and customers from misuse or unfair automated judgment. |
| Quality at the source | Validate identity, completeness, schema, checksum and business rules where data first enters the system. |
| Observable health | Expose connection, backlog, oldest event, rejection, version, acknowledgement and recovery status. |
| Simple recovery | Fail safely, explain the condition clearly and provide a controlled path back to normal operation. |
| Continuous improvement | Measure failures, delays, false alarms, overrides and conflicts; improve policy without deleting history. |
| Future compatibility | New modules inherit this charter and publish versioned contracts before production access. |

#### Charter decision test

Before implementing any data flow or human action, answer:

1. Is it safe?
2. Does it preserve history and traceability?
3. Who owns the fact?
4. What acknowledged upstream fact authorizes it?
5. Is the direction explicit and scoped?
6. Is it durable, idempotent and recoverable?
7. Does it respect dependencies and approvals?
8. Is it effective without creating unnecessary burden?
9. Can people understand, challenge and audit it?
10. Will it behave correctly offline, after reconnect and in a future subsystem?

If any answer is unclear, the flow remains in an isolated test state and cannot receive production write authority.

**Charter maxim:** `Safe truth moves forward, history remains intact, and every action is effective, accountable and recoverable.`

#### P0 downstream NG containment — non-negotiable

1. Any station that detects an NG shall durably record it locally and publish it to MES immediately.
2. MES shall maintain the canonical active-NG state and publish it to every downstream station, not only the next station.
3. Every downstream station shall check active NG before accepting a scan, arrival, tester/database row, binding, packing, or other production action.
4. An active NG shall be stopped at every downstream station with visible and audible alarm. No downstream operation may proceed.
5. This rule applies to all current and future manual-line, automatic-line, SMT, ATE, binding, packaging, PDA, WMS and maintenance integrations.
6. During MES/network outage, each station shall enforce the last complete local active-NG snapshot and queue its interception evidence. An incomplete refresh must never clear the cache.
7. Only an authorized retest that finishes PASS may cause MES to publish `RELEASED`. The complete NG and retest history remains immutable.
8. Duplicate authorization and retest authorization are separate. Retest confirmation may suppress DUP for that retest, but it must not erase NG history.
9. A 3D display may visualize NG flow and alarms but cannot independently clear or release an NG.
10. Failure to block an active NG downstream is a P0 production-containment defect and requires immediate stop, correction, deployment, and end-to-end verification.

MES may listen to all station data, but it may push down only MES-owned or explicitly approved data. Station-owned pending work, raw results, PASS boxes, and local test state are never overwritten by MES.

| Data channel | Source | MES behavior | Downstream destination | Direction | Authoritative owner |
|---|---|---|---|---|---|
| Equipment heartbeat | Station Agent | Listen and retain latest state | 3D monitoring | Station → MES → 3D | Station |
| Raw ICT CSV / FCT Excel / equipment DB result | Source Agent | Listen, archive, audit | MES reports only | Station → MES | Source station |
| Parsed test result | Source Agent | Listen, validate, store | MES and 3D dashboards | Station → MES → Display | Source station |
| Pending NG / local retest state | Source Agent | Listen and monitor; never push back | 3D display only | Station → MES → 3D | Source station |
| Local PASS box and counts | Source Agent | Listen and monitor; never push back | 3D display only | Station → MES → 3D | Source station |
| Raw scanner observation | Scanner/Agent | Validate and audit; never register as an SN | MES monitoring | Station → MES | Source station |
| Formal SN registration | CSV/Excel/equipment DB Agent | Validate and atomically register | Factory SN master | Station → MES | MES after acceptance |
| Duplicate decision | Requesting station | Query factory SN master and return decision | Requesting station only | Station ⇄ MES | MES |
| Duplicate alarm state | MES or local Agent | Record and target display/alarm | Affected station and 3D | MES → Target/3D | MES |
| Confirmed NG proposal | Source station | Validate and promote | Confirmed-NG registry | Station → MES | MES after acceptance |
| Confirmed NG registry | MES | Versioned factory-wide broadcast | All scanning stations | MES → Stations | MES |
| NG revival approval | Quality/line leader through MES | Approve, audit, publish | Affected stations | MES → Targets | MES |
| ICT/FCT motherboard layouts | ICT/FCT Agents | Listen and store | MES merge service | Station → MES | Source result; MES copy |
| Merged ICT+FCT layout | MES | Merge by motherboard identity | Depanel and 3D | MES → Depanel/3D | MES |
| Maintenance request | Source/depanel station | Generate maintenance WO | Maintenance station | Station → MES → Maintenance | MES |
| Maintenance receipt/completion/materials | Maintenance station | Validate and audit workflow | MES and source station | Maintenance → MES → Source | MES |
| Repair return/revival order | MES | Send targeted approved command | Original source station | MES → Target | MES |
| Handover request | Source station | Create controlled handover | Destination station | Station → MES → Destination | MES |
| Handover receipt | Destination scanner | Confirm receipt | MES and source station | Destination → MES → Source | MES |
| Handover/repair/residence timeout | MES timer | Send targeted alarm | Relevant stations and 3D | MES → Targets | MES |
| Product residence entry/exit | Station Agent | Calculate and retain history | MES/3D | Station → MES → 3D | MES history |
| Scrap application | Station | Start approval workflow | MES quality management | Station → MES | MES |
| Scrap approval/rejection | Authorized MES user | Send targeted decision | Requesting station | MES → Target | MES |
| Shell/board, carton, pallet, and work-order binding | Binding station | Validate and store centrally | MES traceability | Station → MES | MES |
| Configuration and test policy | MES administrators | Version and publish | Relevant station only | MES → Target | MES |
| Local SQLite health/backup metadata | Station Agent | Listen to status only | MES monitoring | Station → MES | Station |
| Offline outbox | Station Agent | Accept idempotently after reconnect | MES | Station → MES | Station until acknowledged |
| Inventory reconciliation | Station and MES | Compare versions; never auto-overwrite | Conflict-management workflow | Station ⇄ MES | Approved resolution |
| 3D production display | MES | Supply read-only state | 3D browsers | MES → 3D | MES |
| 3D user action | 3D | Alarm acknowledgement/monitoring action only | MES audit | 3D → MES | MES |
| BOM and work-order master | ERP/MES | Manage centrally and answer scoped queries | Requesting station | MES → Requesting station | MES |
| Simulation/test data | Station test mode | Isolate from production namespace | Test dashboard only | Test station → Test namespace | Test system |

### Enforced channel modes

| Mode | Rule |
|---|---|
| `LISTEN_ONLY` | MES receives and displays; it never writes the dataset back into station-local tables. |
| `AUTHORITATIVE_PUSH` | MES owns the dataset and sends versioned updates only to authorized consumers. |
| `REQUEST_RESPONSE` | A station asks for a specific decision or record; MES returns only that result. |
| `TARGETED_COMMAND` | MES sends an approved command only to affected stations, never as a general data dump. |
| `DISPLAY_ONLY` | MES supplies state to 3D; 3D cannot mutate production records. |
| `RECONCILE` | MES and station compare versions; neither automatically overwrites the other. Conflicts are audited and resolved explicitly. |

### Non-negotiable rules

1. Scanner reads perform NG and duplicate checks but never register production SNs.
2. Only formal CSV, Excel, or equipment/database sources may propose new SN records.
3. Pending NG, PASS, raw results, and local test progress always flow upward only.
4. Confirmed NG, duplicate decisions, approved handovers, repair/revival commands, and authorized configuration may flow downward.
5. MES commands must be targeted and versioned; generic bucket broadcasts are display notifications, not station write instructions.
6. 3D is read-only for production state and may only acknowledge alarms through audited MES APIs.
7. Reconciliation reports conflicts and never silently chooses or overwrites either side.
8. Test data must use an isolated namespace and must never enter the production SN master.

### Offline and reconnection data-flow policy

Network loss does not change dataset ownership. A reconnect is not permission for MES to push every central record into station-local tables.

| Connectivity event | Dataset | Required direction | Required behavior |
|---|---|---|---|
| Connection lost | Raw/test result, pending NG, PASS, binding, scan audit | Station local only | Commit locally first and append a durable outbox event. Continue operation only where the station's offline policy permits. |
| Connection lost | Formal SN registration | Station local pending → MES later | Mark `PENDING_MES_ACK`; never claim central acceptance until MES atomically accepts it. |
| Connection lost | Duplicate check | Local cache only | Use the last versioned MES SN/NG cache and local source records. Mark the decision `OFFLINE_PROVISIONAL`. |
| Connection lost | Confirmed NG | Station local proposal | Block locally immediately, queue the proposal, and retain it until MES acknowledges and broadcasts the authoritative version. |
| Connection lost | MES command/approval | No new downward data | Keep the last acknowledged version. Do not invent approval, revival, scrap, route, or repair commands. |
| Connection lost | Heartbeat | No replay queue | Show the station offline. Old heartbeat messages are ephemeral and must never be replayed. |
| Reconnection detected | Station outbox | Station → MES | Upload oldest committed business events first, in station sequence order, using immutable event IDs. |
| MES accepts event | Outbox item | MES acknowledgement → Station | Mark the local event acknowledged only after a successful durable MES commit. |
| MES rejects duplicate | Formal SN event | MES decision → Source station | Keep the source file and audit record, roll back provisional registration, and trigger a duplicate alarm. |
| Reconnection detected | Confirmed NG registry | MES → All stations | Pull/broadcast only records newer than the station's last acknowledged registry version. Apply atomically to the local MES-owned guard cache. |
| Reconnection detected | Factory SN guard | Station request ⇄ MES | Refresh by registry version or delta cursor. Do not replace station-owned test tables. |
| Reconnection detected | Handovers, repair/revival and approvals | MES → Target station only | Deliver commands newer than the target station's last command cursor; require receipt acknowledgement. |
| Reconnection detected | Pending NG, PASS, raw results, local boxes | Station → MES only | Upload the local authoritative state. MES must not return its stored copy as a station write instruction. |
| Reconciliation mismatch | Any station-owned dataset | Compare only | Create a conflict case with both hashes/versions. Never automatically overwrite local data. |
| Reconciliation mismatch | MES-owned guard/command cache | MES → Station | Replace only the specific MES-owned cache with a newer signed/versioned snapshot. Never touch station-owned tables. |
| Connection stable | 3D state | MES → 3D | Rebuild display from current MES state. 3D never becomes a recovery source for stations. |

#### Mandatory reconnect order

1. Re-establish transport and authenticate the station identity.
2. Exchange station cursor, outbox range, MES registry versions, and current clock offset.
3. Upload station-owned business events in local sequence order.
4. MES performs idempotent insertion using `stationCode + eventId` and returns an acknowledgement per event.
5. Quarantine rejected events with the reason; do not block later independent events behind a permanently rejected item.
6. Upload current station-owned inventory snapshots for comparison only.
7. Pull MES-owned confirmed-NG and factory-SN deltas.
8. Pull targeted pending commands: handover, repair, return, revival, scrap, and configuration.
9. Acknowledge each targeted command after durable local storage.
10. Refresh MES/3D displays after the authoritative stores are current.

#### Idempotency and ordering requirements

- Every business event has an immutable UUID/event ID, station code, local sequence number, source timestamp, and payload checksum.
- MES treats repeated event IDs as successful re-delivery, not a second production event.
- Ordering is enforced per station, not globally across unrelated stations.
- One poison/rejected event is quarantined after a permanent 4xx response and cannot block the complete outbox.
- Temporary network/5xx failures remain pending with bounded exponential backoff and jitter.
- Files are not marked processed until the station has committed their parsed result locally.
- MES acknowledgement means the PostgreSQL transaction is committed, not merely that the HTTP request was received.

#### Version and conflict rules

- Station-owned records carry `localVersion`; MES stores the copy and never sends it back as an overwrite.
- MES-owned registries carry `registryVersion`; stations apply only a version greater than their last acknowledged version.
- Targeted commands carry `commandVersion`, target station, expiry, and acknowledgement state.
- Clock time is audit information; ordering uses sequence/version numbers rather than timestamps alone.
- A same-version/different-hash result is a data-integrity incident and must open a conflict investigation.
- Approved conflict resolution produces a new version and immutable audit event; existing history is never edited silently.

#### Offline safety limits

- Confirmed-NG blocking continues from the last durable MES cache plus new local NG discoveries.
- Scanner reads remain check-only and never become SN registrations while offline.
- Actions requiring MES authority—NG revival, scrap approval, important routing changes, and repair closure—remain blocked until authorization is available.
- After 20 minutes offline, raise the disaster/offline alarm, create an emergency snapshot, and show the unsent event count.
- Local queues must expose oldest-event age, pending count, rejected count, and last successful acknowledgement.
- Reconnection must never clear an alarm automatically unless the relevant authoritative condition is actually resolved.

### Golden rule: downstream always consumes upstream data

Every downstream station or service must take its product identity, state, quantity, quality status, routing context, and handover evidence from the authoritative upstream output. Downstream systems must not recreate, guess, silently replace, skip, or reverse-write upstream production data.

| Rule | Required behavior |
|---|---|
| Upstream output becomes downstream input | The exact accepted upstream record is the starting record for the next process. |
| Output/receipt balance | Every upstream output requires a matching downstream receipt; quantity out must equal quantity in unless an approved exception exists. |
| Explicit handover | Product movement remains incomplete until the downstream station scans or otherwise durably acknowledges receipt. |
| Preserve identity | SN, motherboard membership, work order, bindings, NG flags, and trace IDs travel forward unchanged. |
| Preserve history | Downstream appends a new process event; it never edits or deletes upstream events. |
| Preserve restrictions | Confirmed NG, pending handover, scrap hold, repair routing, and other blocks follow the product downstream. |
| No data invention | A downstream station cannot create missing upstream PASS, test, binding, or receipt records merely to continue production. |
| No reverse overwrite | Downstream corrections cannot overwrite upstream local tables. They create a correction request or audited MES event. |
| MES mediation | MES validates the continuity and supplies the accepted upstream state to the authorized downstream consumer. |
| Offline continuity | A downstream station may use its last durable upstream/MES cache only when policy permits; it must reconcile after reconnect. |
| Mismatch handling | Missing, duplicated, stale, or different upstream/downstream data opens a conflict and blocks unsafe continuation. |
| 3D role | 3D visualizes the relay and imbalance but never supplies production input or repairs missing records. |

#### Process relay sequence

1. Upstream station commits its result locally.
2. Upstream sends an immutable event to MES and receives acknowledgement.
3. MES validates identity, quantity, NG status, route, and work order.
4. MES makes the accepted upstream output available to the specific downstream station.
5. Downstream scans/identifies the product and receives the upstream state.
6. Downstream durably records receipt before processing begins.
7. Downstream appends its result and becomes the upstream source for the next process.
8. Any missing receipt, quantity difference, or state mismatch triggers an audited alarm and exception workflow.

**Golden invariant:** `Downstream input = acknowledged upstream output + approved exceptions`.

### Universal applicability to current and future subsystems

The canonical data-flow policy and golden invariant apply to every current module and every future annexed portion, plugin, service, station, device, management system, supplier/customer connection, or external API. No subsystem is exempt because it is new, third-party, temporary, cloud-hosted, mobile, or outside the production-line folder.

Covered systems include, but are not limited to:

- PDA loading, scanning, receiving, issuing, counting, and mobile approval applications.
- Supplier management, supplier quality, incoming inspection, purchase-order confirmation, ASN, and supplier portals.
- ERP, PMC, MES, WMS, QMS, BOM, traceability, maintenance, repair, scrap, logistics, warehouse, finance, procurement, HR, and reporting systems.
- ICT/FCT/ATE/AOI Agents, PLCs, testers, scanners, printers, SQL Server, MySQL, PostgreSQL, SQLite, file watchers, and industrial protocols.
- 3D monitoring, dashboards, Power BI/reporting, AI/analytics, notification services, and data warehouses.
- Automatic lines, manual lines, SMT, future lines, remote factories, contract manufacturers, customers, and service centers.

#### Mandatory integration declaration

Before a subsystem is allowed to exchange production data, it must register this contract:

| Required field | Meaning |
|---|---|
| `systemId` | Immutable globally unique subsystem identity |
| `nodeType` | Station, PDA, management, supplier, database, device, display, analytics, or external service |
| `datasetsProduced` | Exact datasets for which the subsystem is the source |
| `datasetsConsumed` | Exact upstream/MES datasets it is authorized to read |
| `authoritativeOwner` | Owner for every produced and consumed dataset |
| `flowMode` | `LISTEN_ONLY`, `AUTHORITATIVE_PUSH`, `REQUEST_RESPONSE`, `TARGETED_COMMAND`, `DISPLAY_ONLY`, or `RECONCILE` |
| `upstreamNodes` | Approved providers whose acknowledged output may become this subsystem's input |
| `downstreamNodes` | Approved consumers of this subsystem's acknowledged output |
| `identityKeys` | SN, work order, supplier lot, material lot, carton, pallet, employee, equipment, or other canonical identity |
| `acknowledgement` | Durable receipt/commit condition and timeout |
| `offlinePolicy` | Allowed offline actions, queue behavior, cursor and reconnect order |
| `retentionPolicy` | Retention, archive, deletion and legal/audit requirements |
| `securityPolicy` | Authentication, authorization, encryption, secret handling and data classification |
| `versionPolicy` | Schema version, event version, compatibility and migration rules |
| `exceptionWorkflow` | Approved method for shortage, mismatch, rejection, correction and cancellation |

An integration with no registered contract is denied production write access and may operate only in an isolated test namespace.

#### Examples

| Subsystem | Upstream data it consumes | Output it owns | MES behavior |
|---|---|---|---|
| PDA loading | Released work order, BOM/material requirement, approved supplier/material lots | Scan observation and material-loading transaction | MES validates and acknowledges; PDA never creates BOM or production SN truth |
| Supplier management | Approved PO, specification, supplier master and quality requirement | Supplier confirmation, ASN, lot/certificate and corrective-action response | MES/ERP accepts versioned supplier output; supplier cannot overwrite receiving or IQC results |
| WMS | Accepted PO/ASN, MES material demand and completed pallet | Receipt, inventory movement, issue and shipment transaction | Downstream production consumes acknowledged WMS issue; WMS cannot invent production completion |
| QMS/IQC | Supplier lot, specification and receiving record | Inspection result, hold/release and NCR | Quality decision may be authoritative push; supplier receives only targeted/redacted feedback |
| Analytics/AI | Read-only acknowledged operational history | Recommendation, prediction or anomaly signal | `DISPLAY_ONLY` or advisory; never mutates production truth without approved workflow |
| Customer/service system | Shipped-product trace and approved service case | Service observation and return authorization request | MES validates targeted return workflow; customer data cannot rewrite factory history |

#### Annexation gate

Every new subsystem must pass these checks before production activation:

1. Unique identity and single ownership for each dataset.
2. Explicit upstream and downstream nodes.
3. Direction and flow mode defined for every API/topic/table/file.
4. Idempotent event IDs and durable acknowledgement.
5. Offline/reconnect behavior tested.
6. No generic reverse synchronization or unscoped broadcast.
7. Quantity, identity and state continuity tested at every boundary.
8. Role-based permissions and immutable audit enabled.
9. Test data isolated from production registries.
10. MES and 3D behavior verified in multiple browsers and after restart.

**Universal rule:** a future subsystem inherits the architecture; it does not redefine the architecture merely by being attached later.

### Governed mutual-flow systems

Some systems legitimately exchange data in both directions. Mutual flow is permitted only when each direction is declared separately with a clear owner, purpose, schema, acknowledgement, and conflict rule. Bidirectional transport never means bidirectional ownership of the same fact.

| Mutual-flow pattern | Direction A → B | Direction B → A | Ownership rule |
|---|---|---|---|
| Request/response | Request or query | Scoped answer/decision | Responder owns the answer; requester owns the request context |
| Command/acknowledgement | Versioned targeted command | Durable receipt/result acknowledgement | Command issuer owns command; executor owns execution evidence |
| Proposal/approval | Proposed change/evidence | Approval, rejection or requested correction | Proposer owns evidence; approving authority owns decision |
| Order/fulfilment | PO/WO/demand | Confirmation, ASN, completion or shortage | Ordering system owns requirement; fulfiller owns fulfilment fact |
| Handover/receipt | Acknowledged output and transfer | Receipt, rejection or discrepancy | Source owns output; destination owns receipt evidence; MES owns transfer state |
| Repair/return | Repair WO and product | Receipt, repair record, completion and return | MES owns WO; repair station owns repair evidence; source owns return receipt |
| Reconciliation | Version/hash/count summary | Version/hash/count summary | Each side owns its source data; approved resolution creates a new authoritative version |
| Master-data distribution/feedback | Authoritative master version | Validation error or change request | Master owner remains authoritative; consumer cannot overwrite it directly |

#### Mutual-flow requirements

1. Model the integration as two named channels, for example `purchase_order_out` and `supplier_confirmation_in`.
2. Assign one authoritative owner to every field and business fact; shared ownership is prohibited.
3. Every response references the originating `correlationId`; follow-up events include `causationId`.
4. Preserve the original event ID and source system; forwarded events must not appear as newly originated facts.
5. Add `hopCount` or a route trace and reject loops, repeated hops, and self-returned events.
6. A received event may generate a new response event, but it must not echo the same event back unchanged.
7. Use independent sequence/cursor tracking for each direction.
8. Acknowledgement confirms durable storage or completed action; it is not a copy of the original payload.
9. Conflicting updates are rejected or opened as a conflict case; last-write-wins is prohibited for production, quality, inventory, financial, supplier-lot, and identity data.
10. Offline queues are independent per direction so a blocked inbound command cannot block outbound production evidence.
11. Retry is idempotent using the same event ID; retries never create a second business transaction.
12. Permissions are directional: permission to read or send one channel does not authorize the reverse channel.

#### Loop-prevention envelope

Every mutual-flow event should carry:

```json
{
  "eventId": "immutable-uuid",
  "eventType": "named-channel-event",
  "sourceSystem": "system-a",
  "targetSystem": "system-b",
  "correlationId": "business-conversation-id",
  "causationId": "event-that-caused-this-event",
  "sourceSequence": 123,
  "schemaVersion": 1,
  "hopCount": 0,
  "routeTrace": ["system-a"],
  "occurredAt": "source-time",
  "payloadChecksum": "sha256"
}
```

On forwarding, append the forwarding node to `routeTrace` and increment `hopCount`. Reject the event when the current node already exists in `routeTrace`, the target equals the source, or the allowed hop limit is exceeded.

**Mutual-flow invariant:** `Two directions = two governed channels; one fact = one authoritative owner`.

### Canonical data-flow priority model

Priority determines scheduling and delivery urgency; it never changes ownership, authorization, validation, or required process order. A high-priority event cannot bypass an upstream prerequisite, approval, or durable acknowledgement.

| Priority | Class | Examples | Delivery target | Retry/handling |
|---:|---|---|---|---|
| P0 | Safety and containment | Confirmed NG block/revival, duplicate block, unsafe product interception, emergency stop, data-integrity incident | Immediate, target <1 second on connected LAN | Dedicated queue; preempt lower classes; retry until acknowledged; never drop |
| P1 | Transaction control | Handover receipt, repair receipt/return, scrap hold/decision, route command, WO authorization, shortage/quantity block | Target <2 seconds | Durable targeted command; strict acknowledgement and timeout alarm |
| P2 | Production evidence | Formal test result, SN registration, binding, station entry/exit, material issue/receipt, repair material usage | Target <5 seconds | Durable ordered outbox; idempotent retry; quarantine permanent rejection |
| P3 | State synchronization | Confirmed-NG delta, SN-guard delta, inventory reconciliation, configuration version, recovery cursor | Target <15 seconds | Versioned delta/snapshot; coalesce superseded state where safe |
| P4 | Monitoring | Heartbeat, station health, queue depth, residence metrics, alarm display state | Target <30 seconds | Latest-value delivery; old heartbeat/telemetry may expire and is not replayed |
| P5 | Analytics and bulk | Historical reports, KPI aggregation, Power BI extracts, archive, backup verification | Best effort / scheduled | Throttled bulk channel; pause during production backlog |

#### Priority rules

1. Preserve FIFO ordering inside the same station, business aggregate and priority class.
2. Use priority scheduling across independent aggregates; never reorder dependent events for the same SN, batch, WO, carton or pallet.
3. P0 and P1 use reserved worker/connection capacity so bulk P5 traffic cannot exhaust the pool.
4. Priority never authorizes a write. Direction, ownership and permission checks run before scheduling.
5. A display event cannot be promoted above its underlying business event; persist first, then broadcast.
6. Acknowledgements inherit the priority of the command or event being acknowledged.
7. Repeated alarms may be coalesced for voice/display, but the original incident and acknowledgement remain durable.
8. Heartbeats are replaceable latest-state messages; production events are immutable and never coalesced.
9. Bulk synchronization pauses when P0–P2 backlog or database latency crosses the configured threshold.
10. Prevent starvation with bounded service guarantees for lower priorities after urgent queues stabilize.
11. Priority changes require an audited policy version; clients cannot self-promote arbitrary events.
12. Reject contradictory priorities, such as a confirmed-NG block labeled as monitoring or a KPI refresh labeled as safety.

#### Dependency before priority

When two events depend on each other, dependency wins over numeric priority. Examples:

- A repair completion cannot be applied before the repair receipt, even if completion arrives with higher priority.
- A downstream PASS cannot be committed before the upstream handover receipt.
- A revival broadcast cannot precede approved quality and line-leader decisions.
- A 3D alarm cannot become the production record; the P0 display follows the committed P0 containment event.

#### Offline queue scheduling

After reconnection:

1. Send locally generated P0 containment events and their prerequisites.
2. Send P1 handover/repair/control transactions in dependency order.
3. Send P2 production evidence in per-station sequence order.
4. Exchange P3 registry versions and reconciliation data.
5. Resume current P4 heartbeat/health state without replaying expired telemetry.
6. Resume P5 history, analytics and backup traffic only after production queues are healthy.

**Priority invariant:** `Safety first, dependencies first, durable facts before displays, and no priority may bypass authority`.

### Situational priority variation

An event has a base priority from its business class and an effective priority calculated from the current situation. Dynamic priority affects scheduling only; it never changes the event's owner, permissions, validation, dependencies, retention, or audit requirements.

`effectivePriority = policy(basePriority, safety, deadline, dependency, outage, backlog, integrity, recovery)`

#### Situation matrix

| Situation | Priority variation | Examples and constraints |
|---|---|---|
| Normal production | Use base priority | P0/P1 control, P2 production, P3 sync, P4 monitoring, P5 analytics |
| Confirmed NG or duplicate detected | Escalate containment and acknowledgement to P0 | Related display/voice may be P0, but only after the durable block exists |
| Product approaching handover deadline | Escalate the existing P1 transaction within P1 | Warn at configured threshold; timeout becomes P0/P1 alarm without fabricating receipt |
| Repair approaching 2-hour limit | Escalate repair status/notification from P2/P4 to P1 | Repair evidence remains ordered; escalation cannot mark repair complete |
| Residence time approaching limit | Escalate monitoring signal P4 → P1 warning | Actual station entry/exit remains P2 evidence |
| Network lost | Raise local containment and queue-health visibility; suspend network delivery | Local confirmed NG remains P0; heartbeat becomes local offline state and is not queued |
| First minutes after reconnect | Prioritize prerequisites, P0, P1 and ordered P2 recovery | P3/P5 waits; new live events must not overtake older dependent events for the same aggregate |
| Large outbox backlog | Allocate more P2 workers but preserve P0/P1 reserved capacity | Do not promote all backlog to P0; age-based fairness applies within P2 |
| MES/PostgreSQL degraded | Reduce P4/P5 frequency and pause bulk jobs | Preserve capacity for P0–P2 commits and acknowledgements |
| Same-version/different-hash conflict | Escalate integrity incident to P0/P1 depending impact | Freeze unsafe mutation; open investigation; never auto-select a side |
| Quantity or identity mismatch | Escalate boundary transaction to P1/P0 | Block downstream continuation until approved exception or corrected receipt |
| Shift change | Escalate unacknowledged handovers and open alarms to P1 | Routine historical reporting remains P5 |
| Planned maintenance | Drain P0–P2, checkpoint cursors, then pause | Maintenance announcement is P3/P4; production facts are never discarded |
| Disaster recovery | Restore identity, NG, handover and WO control before dashboards | Restore P0/P1 registries, then P2 history, P3 state, P4 display, P5 analytics |
| Cybersecurity incident | Security containment may become P0 | Revoke tokens/isolate node; preserve evidence; do not accept unauthenticated emergency writes |
| Supplier shortage affecting active WO | Escalate affected material/WO decision to P1 | General supplier KPI remains P5; only affected lots/orders are promoted |
| Customer safety/recall hold | Escalate affected SN/lot containment to P0 | Target exact scope; retain immutable decision and release approval |

#### Controlled escalation rules

1. Escalation uses policy-defined triggers, not a client-provided unrestricted `priority` field.
2. Record base priority, effective priority, escalation reason, policy version, trigger time, and expiry.
3. Promote the smallest affected scope: specific SN, batch, WO, lot, station or route—not the whole factory unless required.
4. Promote prerequisite events with the blocked urgent event so dependency order remains valid.
5. Do not repeatedly clone an event when priority changes; update scheduling metadata for the same immutable event ID.
6. Escalation expires or is explicitly resolved; permanent promotion requires an approved policy change.
7. Acknowledgements and rejection notices follow the effective priority of the originating event.
8. A situation may reduce traffic frequency but cannot downgrade an unresolved safety containment below P0.

#### Controlled de-escalation rules

| Condition | Allowed de-escalation |
|---|---|
| Alarm acknowledged but condition remains | Voice/display repetition may reduce; containment remains P0 |
| Condition authoritatively resolved | Close P0/P1 incident and emit a durable resolution event |
| Queue backlog cleared | Return recovery workers and P2 events to normal allocation |
| Database/network stable for configured window | Resume P3 synchronization, then P4 monitoring and P5 bulk work |
| Deadline no longer at risk due to valid receipt | Remove time escalation; preserve original transaction history |
| Conflict approved and new version committed | Release freeze and return related flow to normal priority |

#### Priority aging and fairness

- P0 safety events never wait behind lower priorities.
- P1 control events use deadline-aware scheduling.
- P2 production events gain bounded age weight so older independent events are not starved by continuous new traffic.
- P3 synchronization is coalesced by version when intermediate states are superseded safely.
- P4 telemetry keeps only the newest state unless history is specifically required.
- P5 jobs run with explicit rate, time-window and resource budgets.

#### Example: reconnect with live production continuing

1. Local NG block created during outage: P0.
2. Its prerequisite formal FAIL result: promoted P2 prerequisite and sent first.
3. Pending handover receipt near timeout: P1.
4. Older production results: P2 in station sequence order.
5. Current confirmed-NG/SN registry delta: P3 after critical uploads.
6. Current heartbeat: P4 latest value only.
7. Historical KPI export: P5 after backlog recovery.

**Situational-priority invariant:** `Urgency may change scheduling, but never truth, ownership, authority, or dependency order`.

### Human input into priority and data flow

People may provide context, urgency, evidence, acknowledgement, exception requests and approval. They do not directly rewrite authoritative data or assign unrestricted system priority. The system evaluates human input against role, scope, policy, dependencies and safety rules.

#### Human roles and permitted input

| Role | May request/input | Cannot do alone |
|---|---|---|
| Operator | Report blockage, shortage, damage, wrong route, missing receipt; request escalation | Change authoritative SN/NG, approve revival/scrap, downgrade safety alarm |
| Line leader | Prioritize active WO/line issue, approve routine exception, confirm physical count | Alter test evidence, release confirmed NG alone, erase audit history |
| Quality | Set/confirm quality hold, classify defect, approve quality side of revival/scrap | Invent production receipt or change supplier/production evidence silently |
| Maintenance | Set repair urgency, record material usage, completion evidence and delay reason | Revive NG or close return receipt without required approval/scan |
| Warehouse/logistics | Report shortage/damage, prioritize receipt/issue/shipment | Change production test or quality result |
| Supplier manager | Escalate supplier lot/ASN/shortage/corrective action | Change IQC result, factory inventory or production completion |
| Planner/PMC | Prioritize WO/material demand and schedule impact | Bypass NG, duplicate, quality hold or physical receipt |
| MES administrator | Configure priority policy and role permissions | Modify production truth without approved correction workflow |
| Incident commander | Activate declared emergency policy for scoped incident | Remove immutable history or bypass authentication/audit |

#### Required manual-priority input

Every human priority request contains:

- Requester identity, role, station/system and authenticated session.
- Affected scope: SN, batch, WO, material/supplier lot, station, route or subsystem.
- Requested urgency and required-by time—not a raw unrestricted queue number.
- Standard reason code plus free-text explanation.
- Evidence or reference: scan, photo/document ID, alarm, customer/supplier notice, count sheet or incident ID.
- Expected business impact: safety, quality, delivery, quantity, equipment, customer or compliance.
- Requested action and target owner.
- Expiry/review time.

MES returns the calculated base/effective priority, policy reason, required approvals, accepted scope and expiry.

#### Approval rules

| Request | Minimum approval |
|---|---|
| Routine WO sequencing inside same priority class | Line leader or authorized planner |
| Handover/receipt deadline exception | Source and destination responsible roles; MES records both |
| Repair time extension | Maintenance leader plus line leader; quality when product risk exists |
| Confirmed-NG revival | Quality and line leader; physical return receipt still required |
| Scrap | Quality and authorized management according to scrap policy |
| Safety/recall containment | Authorized quality/safety role; immediate P0 containment may precede later review |
| Data correction/conflict resolution | Dataset owner plus approval level based on impact; important events require meeting review |
| Factory-wide emergency priority mode | Incident commander with time limit and post-incident review |

#### Human-input safeguards

1. Human input creates a new audited request/event; it never edits the original event.
2. The UI presents allowed actions for the authenticated role and affected state only.
3. Safety and confirmed-NG containment cannot be manually downgraded while the condition remains active.
4. A person cannot approve their own high-impact request when separation of duties is required.
5. Manual priority has a defined scope and expiry; no permanent “urgent forever” flag.
6. Repeated or excessive escalation is measured and reviewed, not silently accepted.
7. Rejection includes reason and appeal/escalation path.
8. Manual alarm acknowledgement silences notification according to policy but does not resolve the underlying condition.
9. Emergency override is break-glass: strong authentication, reason, time limit, immediate notification and mandatory review.
10. Human-entered text is never treated as an SN, test result, quantity or authoritative identity without source validation.

#### Human-in-the-loop sequence

1. System detects a situation or a person submits an issue.
2. MES collects structured context and identifies the authoritative owner.
3. Policy calculates initial priority and required approvals.
4. Authorized people provide decision/evidence.
5. MES commits the decision as a new immutable event/version.
6. MES sends a targeted command to affected nodes and a display event to 3D.
7. Target node acknowledges durable receipt and later completion.
8. MES closes or de-escalates only when the authoritative condition is resolved.

**Human-input invariant:** `People provide judgment and approval; the system preserves truth, scope, separation of duties and audit`.
