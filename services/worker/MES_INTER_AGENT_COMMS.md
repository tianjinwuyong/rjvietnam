# MES AI Manager — Inter-Agent Communication Specification

> How the MES AI Manager talks to WMS, BOM, HR, RDA, and other factory agents.
> Current state: **all managers are silos** — no communication exists. This spec defines it.

---

## 1. Agent Registry

| Agent | ID | Manager Script | Query Script | Domain | Patrol Interval |
|---|---|---|---|---|---|
| **MES** | `mes-ai` | `mes-manager.js` | `mes-query.js` | Production lines, yield, quality, stagnation, scraps | 15 min |
| **WMS** | `wms-ai` | `wms-manager.js` | `watchdog-query.js` | Warehouse, inventory, IQC, material lots, receiving | 30 min |
| **BOM** | `bom-ai` | `bom-manager.js` | `bom-query.js` | Bill of Materials, ECO, cost, alternates | 30 min |
| **HR** | `hr-ai` | `hr-manager.js` | `hr-query.js` | Employees, attendance, shifts, OT, payroll | 30 min |
| **RDA** | `rda-ai` | `rda-manager.js` | `rda-query.js` | Reports, analytics, archives, trends | Daily |
| **Worker** | `worker` | `worker.js` | — | Backend validation, file import, balance calc | Continuous |

---

## 2. Communication Architecture

### 2.1 Three Transport Channels

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTER-AGENT BUS                                │
│                                                                      │
│  ┌─────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Channel 1: SYNC      │  │ Channel 2: ASYNC  │  │ Channel 3: EVENT │  │
│  │ Direct subprocess    │  │ DB message queue  │  │ DB NOTIFY/LISTEN │  │
│  │ node <agent>.js <cmd>│  │ inter_agent_msgs  │  │ pg listen        │  │
│  │ (fast, blocking)     │  │ (reliable, logged)│  │ (real-time push) │  │
│  └──────────┬───────────┘  └─────────┬─────────┘  └────────┬───────┘  │
│             │                        │                      │          │
│             ▼                        ▼                      ▼          │
│      ┌──────────┐           ┌──────────────┐        ┌────────────┐   │
│      │  node    │           │  PostgreSQL   │        │  Trigger   │   │
│      │  spawn   │           │  inter_agent  │        │  channel   │   │
│      │  stdout  │           │  _msgs table  │        │  (future)  │   │
│      └──────────┘           └──────────────┘        └────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 When to Use Each Channel

| Pattern | Channel | Use Case | Latency |
|---|---|---|---|
| **Query-and-answer** | SYNC | "BOM, what components does WO-26061020007 need?" | < 5s |
| **Tell-and-forget** | SYNC | "WMS, issue material lot X to line Y" | < 3s |
| **Background request** | ASYNC | "RDA, generate last week yield report for me" | < 60s |
| **Broadcast event** | ASYNC | "MES here — I just detected a critical yield drop on line SMT-01" | < 2s |
| **Real-time notification** | EVENT (future) | "WMS just released a lot — MES needs to know NOW" | < 500ms |

---

## 3. Channel 1: Synchronous (SYNC) — Direct Subprocess Call

### 3.1 Pattern

Reuses the existing `run()` function pattern from every manager:

```javascript
// In mes-manager.js (ALREADY EXISTS):
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out);
    });
  });
}
```

### 3.2 Call Convention

```
node <agent-query.js> <scope> --key value [--key value ...]
  → stdout: JSON { ok: true/false, data: {...}, error: "..." }
```

### 3.3 MES → Other Agent Calls (SYNC)

| Call | MES Method | Target | Command | Purpose |
|---|---|---|---|---|
| Get material lot status | `queryWMS(lotNo)` | `wms-query.js` | `node watchdog-query.js stock --material <code>` | Check if lot is released/on-hold |
| Get BOM for WO | `queryBOM(woCode)` | `bom-query.js` | `node bom-query.js bom-explode --wocode <woCode>` | Get component list for material verification |
| Check material readiness | `queryBOMReadiness(woCode)` | `bom-query.js` | `node bom-query.js material-readiness --wocode <woCode>` | BOM readiness status |
| Get shift schedule | `queryHR(lineCode)` | `hr-query.js` | `node hr-query.js shift-schedule --line <lineCode>` | Who's on shift for a line |
| Get operator cert | `queryHRCert(operatorId)` | `hr-query.js` | `node hr-query.js operator-cert --operator <id>` | Is operator certified for station |
| Get historical yield | `queryRDA(lineCode, days)` | `rda-query.js` | `node rda-query.js yield-trend --line <code> --days 7` | Yield trend for analysis |
| Get report data | `queryRDAReport(sourceKey, period)` | `rda-query.js` | `node rda-query.js report --key <key> --period <period>` | Archived report data |

### 3.4 Other Agent → MES Calls (SYNC)

| Call | Target | MES Method | Command |
|---|---|---|---|
| Get line status | `mes-query.js` | `node mes-query.js lines` | Current status of all lines |
| Get active runs | `mes-query.js` | `node mes-query.js runs` | All running WOs |
| Check stagnation | `mes-query.js` | `node mes-query.js stagnation` | Current stagnant PCBs |
| Get yield | `mes-query.js` | `node mes-query.js events` | Recent station events for yield calc |
| Get line health | `mes-query.js` | `node mes-query.js oee` | OEE per line |
| Execute action | `mes-execute.js` | `node mes-execute.js <action> [opts]` | Execute MES action (from WMS scrap, etc.) |

### 3.5 Standard Response Format (ALL agents MUST conform)

```json
{
  "ok": true,
  "data": [ ... ],
  "meta": {
    "agent": "wms-ai",
    "scope": "material-stock",
    "queried_at": "2026-06-28T06:00:00Z",
    "duration_ms": 42
  }
}
```

**Error response**:
```json
{
  "ok": false,
  "error": "Lot not found",
  "meta": {
    "agent": "wms-ai",
    "scope": "material-stock",
    "queried_at": "2026-06-28T06:00:00Z",
    "duration_ms": 12
  }
}
```

---

## 4. Channel 2: Asynchronous (ASYNC) — DB Message Queue

### 4.1 Queue Table

```sql
-- Shared inter-agent message queue
CREATE TABLE IF NOT EXISTS inter_agent_messages (
  id            BIGSERIAL PRIMARY KEY,
  message_id    VARCHAR(64) NOT NULL UNIQUE,  -- UUID or agent-generated ID
  source_agent  VARCHAR(32) NOT NULL,         -- 'mes-ai', 'wms-ai', etc.
  target_agent  VARCHAR(32) NOT NULL,         -- 'mes-ai', 'wms-ai', '*'
  message_type  VARCHAR(64) NOT NULL,         -- 'request', 'response', 'event', 'broadcast'
  subject       VARCHAR(128) NOT NULL,         -- 'yield_drop', 'material_issued', 'line_downtime'
  payload       JSONB NOT NULL DEFAULT '{}',
  correlation_id VARCHAR(64),                 -- Links response to original request
  priority      VARCHAR(16) DEFAULT 'normal',  -- 'critical', 'high', 'normal', 'low'
  status        VARCHAR(16) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  error_message TEXT,

  -- Indexes
  CONSTRAINT fk_correlation FOREIGN KEY (correlation_id)
    REFERENCES inter_agent_messages (message_id) ON DELETE SET NULL
);

CREATE INDEX idx_iam_target_status ON inter_agent_messages (target_agent, status, created_at DESC);
CREATE INDEX idx_iam_source       ON inter_agent_messages (source_agent, created_at DESC);
CREATE INDEX idx_iam_subject      ON inter_agent_messages (subject);
CREATE INDEX idx_iam_priority     ON inter_agent_messages (priority, created_at);
```

### 4.2 Message Envelope (stored in `payload`)

Every message uses this standard envelope:

```json
{
  "envelope": {
    "version": "1.0",
    "message_id": "mes-msg-a1b2c3d4",
    "source_agent": "mes-ai",
    "target_agent": "wms-ai",
    "message_type": "event",
    "subject": "yield_drop_critical",
    "correlation_id": null,
    "priority": "critical",
    "ttl_seconds": 3600
  },
  "body": {
    // Domain-specific content (see Section 6)
  }
}
```

### 4.3 How Agents Use the Queue

**Producer** (sending agent):
```javascript
async function sendAgentMessage(targetAgent, subject, body, priority = "normal") {
  const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
  await pgPool.query(
    `INSERT INTO inter_agent_messages
     (message_id, source_agent, target_agent, message_type, subject, payload, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [messageId, "mes-ai", targetAgent, "event", subject, JSON.stringify(body), priority]
  );
  return messageId;
}
```

**Consumer** (receiving agent polls during patrol cycle):
```javascript
async function pollAgentMessages(targetAgent, limit = 10) {
  const result = await pgPool.query(`
    SELECT * FROM inter_agent_messages
    WHERE target_agent IN ($1, '*')
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
      END,
      created_at ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  `, [targetAgent, limit]);

  // Mark as processing
  for (const row of result.rows) {
    await pgPool.query(
      "UPDATE inter_agent_messages SET status = 'processing' WHERE id = $1",
      [row.id]
    );
  }
  return result.rows;
}
```

**Responder** (completing a request):
```javascript
async function completeAgentMessage(originalMessageId, responseBody) {
  await pgPool.query(
    `UPDATE inter_agent_messages
     SET status = 'completed', processed_at = NOW(),
         payload = payload || $2::jsonb
     WHERE message_id = $1`,
    [originalMessageId, JSON.stringify({ response: responseBody })]
  );
}
```

### 4.4 Polling Integration in MES Patrol Cycle

```javascript
// In patrolCycle(), after DB query but before Ornith:
async function processAgentMessages() {
  const messages = await pollAgentMessages("mes-ai", 20);
  for (const msg of messages) {
    log("INFO", `[AGENT-MSG] from ${msg.source_agent}: ${msg.subject}`);

    switch (msg.subject) {
      case "material_issued":
        // WMS notified MES that material was issued to a line
        // → Verify the binding, update local awareness
        await handleMaterialIssued(msg.payload);
        break;

      case "iqc_released":
        // WMS: lot passed IQC, now available
        // → Update feeder binding suggestion
        await handleIqcReleased(msg.payload);
        break;

      case "scrap_approved":
        // WMS: scrap request approved
        // → Update scrap records locally
        await handleScrapApproved(msg.payload);
        break;

      case "bom_updated":
        // BOM manager: ECO approved, BOM changed
        // → Flag active runs that use affected product
        await handleBomUpdate(msg.payload);
        break;

      case "shift_coverage":
        // HR: shift schedule updated
        // → Update line staffing awareness
        await handleShiftUpdate(msg.payload);
        break;

      case "data_request":
        // Another agent requesting MES data
        // → Query MES data, write response back
        await handleDataRequest(msg);
        break;

      default:
        log("WARN", `Unknown message subject: ${msg.subject}`);
    }

    await completeAgentMessage(msg.message_id, { processed: true });
  }
}
```

---

## 5. Channel 3: Event Bus (Future — PostgreSQL LISTEN/NOTIFY)

For real-time event push (not poll-based), each agent can LISTEN to a dedicated channel:

```sql
-- MES agent listens to:
LISTEN mes_events;

-- When WMS issues material to line:
NOTIFY mes_events, '{"source":"wms-ai","event":"material_issued","payload":{...}}';
```

**Implementation** (future, when patrol cycle needs true real-time):
```javascript
// mes-manager.js — optional real-time listener
import pg from "pg";

function startEventListener() {
  const client = new pg.Client(/* pool config */);
  client.connect();
  client.query("LISTEN mes_events");
  client.on("notification", (msg) => {
    const event = JSON.parse(msg.payload);
    log("INFO", `[REALTIME] ${event.source}: ${event.event}`);
    // Process event immediately without waiting for next patrol
  });
}
```

---

## 6. Domain Contracts — MES ↔ Each Agent

### 6.1 MES ↔ WMS (Warehouse)

**WMS → MES messages** (ASYNC queue):

| Subject | When Sent | Payload | MES Action |
|---|---|---|---|
| `material_issued` | WMS completes ISSUE_TO_LINE for a lot | `{ "lot_no": "VN-LOT-001", "material_code": "R-0603-10K", "qty": 5000, "work_order_code": "26061020007", "line_code": "SMT-01", "station_code": "SM01" }` | Verify feeder binding matches work order; log line-side inventory |
| `iqc_released` | WMS releases a lot from IQC | `{ "lot_no": "VN-LOT-002", "material_code": "IC-MCU-RJ32", "qty": 2000, "released_at": "..." }` | Update supply availability for active WOs |
| `iqc_hold` | WMS holds a lot (quality issue) | `{ "lot_no": "VN-LOT-003", "material_code": "CAP-0805-100N", "reason": "Defect rate 8% > 5% threshold", "qty": 10000 }` | If lot was bound to a feeder, alert line supervisor; find substitute |
| `scrap_created` | WMS scraps material | `{ "lot_no": "VN-LOT-004", "material_code": "IC-FLASH-128", "qty": 500, "reason_code": "DAMAGED" }` | Remove from line-side inventory; adjust stagnation if linked |
| `line_return` | Line returns unused material to warehouse | `{ "lot_no": "VN-LOT-005", "qty": 300, "work_order_code": "26061020007", "reason": "OVER_PRODUCTION" }` | Acknowledge return; close any open feeder binding |
| `low_stock_warning` | WMS detects material running low | `{ "material_code": "R-0603-10K", "days_remaining": 2.5, "threshold": 7, "critical": false }` | Alert Ornith: include in next patrol analysis; flag production risk |
| `msd_alert` | MSD material approaching limit | `{ "lot_no": "VN-LOT-006", "material_code": "IC-ADC-16bit", "exposed_hours": 120, "limit_hours": 168, "line_code": "SMT-01" }` | MSD baking needed before line uses; alert line supervisor |
| `stock_take_correction` | Manual stock adjustment | `{ "lot_no": "VN-LOT-007", "old_qty": 1000, "new_qty": 980, "reason": "COUNT_DIFFERENCE" }` | Reconcile line-side inventory tracking |

**MES → WMS messages** (ASYNC queue):

| Subject | When Sent | Payload | WMS Action |
|---|---|---|---|
| `material_needed` | MES detects material shortage on line | `{ "work_order_code": "26061020007", "material_code": "R-0603-10K", "required_qty": 5000, "line_code": "SMT-01", "urgency": "immediate" }` | Expedite pick + issue to line |
| `line_finished` | MES completes work order on line | `{ "work_order_code": "26061020007", "line_code": "SMT-01", "completed_qty": 1000, "unused_materials": [{"lot_no":"VN-LOT-001","qty":200}] }` | Prepare for line return or next WO |
| `feeder_mismatch` | MES detects wrong material on feeder | `{ "station_code": "SM01", "expected_material": "R-0603-10K", "actual_material": "R-0603-100K", "feeder_slot": "F12", "line_code": "SMT-01" }` | Immediate LINE alert + block further issue |
| `scrap_at_line` | Line scraps defective PCB material | `{ "lot_no": "VN-LOT-008", "qty": 50, "reason_code": "PROCESS_DAMAGE", "work_order_code": "26061020007" }` | Create SCRAP transaction in WMS |
| `request_issue` | MES requests material be issued to line for next WO | `{ "work_order_code": "26061030009", "line_code": "SMT-01", "items": [{"material_code":"R-0603-10K","qty":4000},{"material_code":"IC-MCU-RJ32","qty":200}] }` | Generate pick order + issue to line |

**MES → WMS SYNC queries**:

```javascript
// Query: Check if a specific lot is available for line use
const lotStatus = await run(["node", "watchdog-query.js", "stock", "--material", materialCode]);
// Response: { ok: true, data: [{ lot_no: "VN-LOT-001", qty: 5000, iqc_status: "released", location: "SMT-01-A01" }] }

// Query: Find best lot to issue for a WO (FIFO)
const pickCandidate = await run(["node", "watchdog-query.js", "pick-candidate", "--wocode", woCode, "--qty", String(qty)]);
// Response: { ok: true, data: { lot_no: "VN-LOT-001", qty: 5000, location: "SMT-01-A01" } }

// Execute: Issue material to line
const result = await run(["node", "wms-execute.js", "issue-to-line", "--lotno", lotNo, "--qty", String(qty), "--wocode", woCode]);
// Response: { ok: true, action: "issue-to-line", status: "issued" }
```

### 6.2 MES ↔ BOM (Bill of Materials)

**BOM → MES messages** (ASYNC queue):

| Subject | When Sent | Payload | MES Action |
|---|---|---|---|
| `bom_updated` | ECO approved, BOM version changed | `{ "product_code": "PCBA-MOTOR-01", "old_version": "1.0", "new_version": "1.1", "changes": [{"material_code":"R-0603-10K","old_value":"R-0603-100K","new_value":"R-0603-10K"}], "effective_date": "2026-07-01" }` | Check if any line is running this product; flag if running with old BOM |
| `eco_pending` | ECO created but not yet approved | `{ "eco_id": "ECO-2026-089", "product_code": "PCBA-DISPLAY-02", "change_summary": "Replace CAP-0805-100N with CAP-0805-470N", "created_by": "engineer_li" }` | Log for awareness — no action until approved |
| `alternative_available` | BOM manager suggests substitute for shortage | `{ "original_material": "IC-MCU-RJ32", "alternative_material": "IC-MCU-RJ32A", "substitution_reason": "Pin-compatible, same specs", "supplier": "越南电子" }` | Update feeder binding rules to accept alternative |
| `bom_accuracy_alert` | BOM audit found mismatch | `{ "product_code": "PCBA-POWER-03", "expected_material": "R-0603-10K", "actual_on_line": "R-0603-100K", "description": "BOM says 10KΩ but line has 100KΩ" }` | Urgent: stop line if running this product |

**MES → BOM messages** (ASYNC queue):

| Subject | When Sent | Payload | BOM Action |
|---|---|---|---|
| `material_substitution_needed` | MES feeder check found wrong material → need BOM guidance | `{ "work_order_code": "26061020007", "product_code": "PCBA-MOTOR-01", "expected": "R-0603-10K", "actual_on_feeder": "R-0603-100K", "station_code": "SM01" }` | Check if actual is a valid substitute; update BOM or flag deviation |
| `component_failure_rate` | MES defect analysis shows specific component failing | `{ "material_code": "CAP-0805-100N", "defect_rate_pct": 3.2, "station_type": "AOI", "defect_code": "MISSING_COMP", "period_days": 7 }` | Flag for supplier quality review; consider ECO |
| `bom_usage_feedback` | Actual consumption vs BOM expected | `{ "product_code": "PCBA-MOTOR-01", "material_code": "R-0603-10K", "bom_qty_per": 10, "actual_avg_consumption": 10.5, "sample_size": 100 }` | Consider adjusting loss_rate in BOM |

**MES → BOM SYNC queries**:

```javascript
// Query: Get BOM exploded for a product
const bom = await run(["node", "bom-query.js", "bom-explode", "--product", productCode]);
// Response: { ok: true, data: [{ material_code: "R-0603-10K", qty_per: 10, loss_rate: 0.01 }, ...] }

// Query: Check if a specific material is a valid substitute
const substitution = await run(["node", "bom-query.js", "check-substitute", "--original", origCode, "--alternative", altCode]);
// Response: { ok: true, data: { valid: true, match_level: "pin_compatible", notes: "Same footprint, different manufacturer" } }

// Query: Get material readiness for a WO
const readiness = await run(["node", "bom-query.js", "material-readiness", "--wocode", woCode]);
// Response: { ok: true, data: { ready: true, shortage_count: 0, items: [...] } }
```

### 6.3 MES ↔ HR (Human Resources)

**HR → MES messages** (ASYNC queue):

| Subject | When Sent | Payload | MES Action |
|---|---|---|---|
| `operator_absent` | Employee didn't clock in for shift | `{ "employee_id": "EMP-2026-0089", "name": "Nguyen Van A", "shift_type": "DAY", "line_code": "SMT-01", "station_type": "AOI" }` | Flag line SMT-01 as understaffed for AOI; include in next Ornith alert |
| `shift_change` | Shift schedule updated | `{ "line_code": "SMT-01", "old_operator": "EMP-2026-0089", "new_operator": "EMP-2026-0092", "station_code": "SM01", "effective_from": "2026-06-28T08:00:00Z" }` | Update operator tracking for station events |
| `certification_expiring` | Operator cert about to expire | `{ "employee_id": "EMP-2026-0045", "name": "Tran Thi B", "certification": "AOI_OPERATOR", "expires_at": "2026-07-15", "station_type": "AOI" }` | Alert line supervisor; plan retraining before expiry |
| `new_operator_assigned` | New operator added to line | `{ "employee_id": "EMP-2026-0100", "name": "Le Van C", "line_code": "SMT-01", "station_type": "SPI", "certifications": ["SPI_OPERATOR"], "start_date": "2026-06-28" }` | Add to operator tracking for station events |
| `ot_limit_warning` | Operator approaching OT limit | `{ "employee_id": "EMP-2026-0089", "name": "Nguyen Van A", "ot_this_month": 38, "legal_limit": 40, "line_code": "SMT-01" }` | Suggest reassignment to avoid OT violation |

**MES → HR messages** (ASYNC queue):

| Subject | When Sent | Payload | HR Action |
|---|---|---|---|
| `line_understaffed` | MES detects line running with fewer operators than required | `{ "line_code": "SMT-01", "required_operators": 5, "actual_operators": 3, "station_type": "SPI", "shift": "DAY" }` | Dispatch available operator; flag shift coverage gap |
| `operator_performance` | MES tracks operator-level yield data (anonymized or aggregated) | `{ "station_code": "SM01", "operator_name": "Nguyen Van A", "shift": "DAY", "yield_pct": 97.5, "defect_count": 3, "sample_size": 120, "period_hours": 8 }` | Feed into performance review KPI |
| `station_cert_gap` | Operator assigned to station without required cert | `{ "line_code": "SMT-01", "station_code": "SM02", "station_type": "AOI", "operator_name": "Le Van C", "missing_cert": "AOI_OPERATOR" }` | Urgent: reassign or arrange immediate training |
| `training_needed` | Defect trend suggests skill gap at specific station | `{ "line_code": "SMT-01", "station_type": "SPI", "defect_code": "SOLDER_BRIDGE", "defect_trend": "increasing_3x_last_week" }` | Schedule refresher training for SPI operators |

**MES → HR SYNC queries**:

```javascript
// Query: Get operators assigned to a line + shift
const operators = await run(["node", "hr-query.js", "shift-schedule", "--line", lineCode, "--date", today]);
// Response: { ok: true, data: [{ employee_id: "EMP-...", name: "...", station: "AOI", shift: "DAY", certs: ["AOI_OPERATOR"] }] }

// Query: Verify operator certification for a station type
const certCheck = await run(["node", "hr-query.js", "operator-cert", "--operator", operatorId, "--station-type", stationType]);
// Response: { ok: true, data: { certified: true, cert_name: "AOI_OPERATOR", expires_at: "2026-12-31" } }
```

### 6.4 MES ↔ RDA (Report Data Analysis)

**RDA → MES messages** (ASYNC queue):

| Subject | When Sent | Payload | MES Action |
|---|---|---|---|
| `report_ready` | RDA completes a scheduled report | `{ "report_key": "yield-weekly", "period": "2026-W26", "archive_id": 42, "summary": "Average yield 96.8% (↑0.3% vs prev week)" }` | Include in weekly quality review if relevant |
| `anomaly detected` | RDA finds statistical anomaly in historical data | `{ "source": "station_events", "metric": "yield", "station_type": "AOI", "line_code": "SMT-02", "expected_range": [95.0, 99.0], "actual": 82.0, "z_score": 3.4, "period": "2026-06-21 to 2026-06-28" }` | Investigate: possible sensor error or genuine quality issue |
| `trend_alert` | Long-term trend detected | `{ "subject": "yield_degradation", "line_code": "SMT-01", "station_type": "AOI", "slope": "-0.15%/day", "p_value": 0.003, "days": 30 }` | Include in root cause analysis patrol |

**MES → RDA messages** (ASYNC queue):

| Subject | When Sent | Payload | RDA Action |
|---|---|---|---|
| `analysis_request` | MES needs historical data for Ornith reasoning | `{ "request_id": "req-abc123", "data_points": ["yield_by_line_30d", "downtime_by_reason_7d", "scrap_by_reason_30d"], "priority": "normal" }` | Query data archives, write response to inter_agent_messages with correlation_id |
| `defect_pattern_query` | MES needs defect clustering analysis | `{ "material_code": "CAP-0805-100N", "station_type": "AOI", "defect_code": "MISSING_COMP", "period_days": 30 }` | Run statistical analysis, return findings |

**MES → RDA SYNC queries**:

```javascript
// Query: Get yield trend for a line
const yieldTrend = await run(["node", "rda-query.js", "yield-trend", "--line", lineCode, "--days", "7"]);
// Response: { ok: true, data: { daily: [{ date: "2026-06-21", yield: 97.2 }, ...], trend: "stable", avg: 96.8 } }

// Query: Get report data
const report = await run(["node", "rda-query.js", "report", "--key", "defect-analysis", "--period", "weekly"]);
// Response: { ok: true, data: { defect_pareto: [...], station: "AOI", top_defect: "MISSING_COMP" } }
```

### 6.5 MES ↔ Worker (Root Worker)

The root `worker.js` manages backend jobs (file import, balance calculation). MES can trigger or query these.

| Subject | Source | Payload | Action |
|---|---|---|---|
| `import_request` | MES → Worker | `{ "file_type": "AOI", "file_path": "D:/smt-data/aoi/2026-06-28/result01.csv", "line_code": "SMT-01" }` | Worker imports AOI result file into station_events |
| `balance_recalc` | MES → Worker | `{ "line_code": "SMT-01", "material_code": "R-0603-10K" }` | Worker recalculates line-side inventory balance |
| `import_complete` | Worker → MES | `{ "file_type": "AOI", "records_imported": 1200, "line_code": "SMT-01" }` | MES refreshes yield analysis with new data |

---

## 7. Communication Flow Patterns

### 7.1 MES Detects Material Mismatch → Resolves via WMS + BOM

```
MES patrol cycle
  ├─ mes-query.js feeders → finds feeder F12 has R-0603-100K (expected R-0603-10K)
  │
  ├─ SYNC: bom-query.js check-substitute --original R-0603-10K --alternative R-0603-100K
  │   └─ Response: { valid: false » mismatch }
  │
  ├─ ASYNC: sendAgentMessage("wms-ai", "feeder_mismatch", { station, expected, actual })
  │
  ├─ ASYNC: sendAgentMessage("bom-ai", "material_substitution_needed", { ... })
  │
  └─ Ornith alert: 🔴 feeder mismatch → LINE to line supervisor + pending-approvals.json
```

### 7.2 WMS Issues Material → MES Updates Awareness

```
WMS completes ISSUE_TO_LINE
  └─ ASYNC: sendAgentMessage("mes-ai", "material_issued", { lot_no, material, qty, wo_code, line_code })

MES next patrol cycle (or LISTEN if real-time):
  ├─ Reads "material_issued" message from queue
  ├─ Runs mes-query.js feeders to verify binding was done correctly
  └─ If no binding found → Ornith alert: material arrived but not bound
```

### 7.3 MES Detects Yield Drop → HR + RDA + LINE

```
MES patrol cycle
  ├─ mes-query.js events → AOI yield on SMT-01 dropped to 88% (baseline 97%)
  │
  ├─ (if critical) ASYNC: sendAgentMessage("wms-ai", "material_needed", ...) if also shortage
  │
  ├─ (if trend) ASYNC: sendAgentMessage("rda-ai", "analysis_request", { data_points: ["yield_by_line_30d"] })
  │   └─ RDA responds via correlation_id with historical data
  │
  ├─ (if operator-specific) ASYNC: sendAgentMessage("hr-ai", "operator_performance", { station, operator, yield })
  │
  └─ LINE alert: 🔴 AOI yield drop on SMT-01 (88% vs 97%)
```

### 7.4 Cross-Agent Data Request (Request-Response via Queue)

```
RDA needs current line status for a report:
  ├─ ASYNC: sendAgentMessage("mes-ai", "data_request", {
  │     request_id: "rda-req-456",
  │     query: "lines",
  │     filters: { status_in: ["running", "down"] }
  │   })
  │
MES next patrol cycle:
  ├─ Reads "data_request" message
  ├─ Runs mes-query.js lines → gets data
  ├─ Writes response as new message:
  │     sendAgentMessage("rda-ai", "data_response", {
  │       correlation_id: "rda-req-456",
  │       data: [ ... ]
  │     })
  │
RDA next patrol cycle:
  └─ Reads "data_response" with matching correlation_id → uses in report
```

---

## 8. Security & Authentication

### 8.1 Message Trust

All agents run on the same Windows machine. Inter-agent messages do NOT require JWT authentication because:

1. All agents are local processes (no network exposure)
2. Message queue is in local PostgreSQL (localhost only)
3. Source agent is recorded in the message (trusted, since only local agents write to the table)

### 8.2 Validation Rules

Each agent MUST validate before acting on a message:

```javascript
async function validateAgentMessage(msg) {
  // 1. Check source_agent is a known agent
  const validAgents = ["mes-ai", "wms-ai", "bom-ai", "hr-ai", "rda-ai", "worker", "*"];
  if (!validAgents.includes(msg.source_agent)) {
    await failMessage(msg.id, "Unknown source agent");
    return false;
  }

  // 2. Check target is us or broadcast
  if (msg.target_agent !== "mes-ai" && msg.target_agent !== "*") {
    await failMessage(msg.id, "Wrong target agent");
    return false;
  }

  // 3. Check required fields based on subject
  // (implemented per subject handler)

  // 4. Check message is not expired
  if (msg.expires_at && new Date(msg.expires_at) < new Date()) {
    await failMessage(msg.id, "Message expired");
    return false;
  }

  // 5. Check for duplicate (by message_id)
  const dup = await pgPool.query(
    "SELECT 1 FROM inter_agent_messages WHERE message_id = $1 AND status != 'pending'",
    [msg.message_id]
  );
  if (dup.rows.length > 0) {
    log("WARN", `Duplicate message: ${msg.message_id}, skipping`);
    return false;
  }

  return true;
}
```

### 8.3 Rate Limiting

```javascript
const RATE_LIMITS = {
  "wms-ai":  { maxPerCycle: 50,  cooldownMs: 100 },  // WMS is busiest
  "bom-ai":  { maxPerCycle: 20,  cooldownMs: 200 },
  "hr-ai":   { maxPerCycle: 20,  cooldownMs: 200 },
  "rda-ai":  { maxPerCycle: 10,  cooldownMs: 500 },  // RDA is slower
  "worker":  { maxPerCycle: 30,  cooldownMs: 100 },
  "*":       { maxPerCycle: 100, cooldownMs: 50 },
};
```

---

## 9. Error Handling

### 9.1 Message-Level Error

```javascript
async function failMessage(messageId, errorMessage) {
  await pgPool.query(
    `UPDATE inter_agent_messages
     SET status = 'failed', processed_at = NOW(), error_message = $2
     WHERE message_id = $1`,
    [messageId, errorMessage]
  );
}
```

### 9.2 Dead Letter Queue

Messages that fail ≥ 3 times are marked `dead` and not retried:

```sql
UPDATE inter_agent_messages
SET status = 'dead'
WHERE id = $1
  AND (SELECT COUNT(*) FROM inter_agent_messages WHERE correlation_id = message_id AND status = 'failed') >= 3;
```

### 9.3 Agent Unreachable

If a SYNC call to another agent fails:
1. Retry 1x after 1 second
2. Retry 2x after 5 seconds
3. Log warning + continue patrol (graceful degradation)
4. LINE alert: "⚠️ Agent {name} unreachable — pending actions queued"

```javascript
async function callAgentWithRetry(command, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await run(command);
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 5000));
        continue;
      }
      throw err;
    }
  }
}
```

---

## 10. Implementation Roadmap

### Phase 1 — Foundation (Next Sprint)
- [ ] Create `inter_agent_messages` DB table (migration 002)
- [ ] Create shared helper: `services/_shared/agent-bus.js` — `sendAgentMessage()`, `pollAgentMessages()`, `completeAgentMessage()`
- [ ] Add `processAgentMessages()` to MES patrol cycle
- [ ] Implement MES handlers for WMS `material_issued` and `iqc_released`

### Phase 2 — MES ↔ WMS Full Contract
- [ ] All WMS → MES message subjects (Table in 6.1)
- [ ] All MES → WMS message subjects (Table in 6.1)
- [ ] SYNC query wrappers in mes-manager.js for WMS data
- [ ] Implement `handleMaterialIssued()`, `handleIqcReleased()`, etc.

### Phase 3 — MES ↔ BOM
- [ ] All BOM → MES message subjects
- [ ] All MES → BOM message subjects
- [ ] Feeder mismatch → BOM substitution check flow
- [ ] BOM update → active run check flow

### Phase 4 — MES ↔ HR + MES ↔ RDA
- [ ] Operator absence → line staffing alert flow
- [ ] Certification gap → station blocking flow
- [ ] Historical data request → RDA response flow
- [ ] Anomaly detection → patrol integration

### Phase 5 — Monitoring & Dashboard
- [ ] Agent communication health dashboard (messages/minute, error rate, avg latency)
- [ ] Dead letter queue monitoring
- [ ] Cross-agent dependency graph visualization
- [ ] Message replay tool (re-process failed messages manually)

---

## 11. Shared Agent Bus Helper (`services/_shared/agent-bus.js`)

```javascript
/**
 * agent-bus.js — Shared inter-agent communication helper
 * Used by all managers: MES, WMS, BOM, HR, RDA, Worker
 *
 * Usage:
 *   import { sendAgentMessage, pollAgentMessages, callAgentQuery } from "../_shared/agent-bus.js";
 */

import pg from "pg";
import { spawn } from "child_process";

const POOL_CONFIG = {
  host:     process.env.PGHOST ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 2,
};

let pool;

function getPool() {
  if (!pool) pool = new pg.Pool(POOL_CONFIG);
  return pool;
}

/**
 * Send an asynchronous message to another agent via the DB queue.
 * @param {string} targetAgent - 'wms-ai', 'bom-ai', 'hr-ai', 'rda-ai', 'worker', '*'
 * @param {string} subject - Message subject (e.g. 'material_issued')
 * @param {object} body - Message payload
 * @param {object} [opts] - Options
 * @param {string} [opts.priority='normal'] - 'critical'|'high'|'normal'|'low'
 * @param {number} [opts.ttlSeconds=86400] - Time-to-live (default 24h)
 * @param {string} [opts.correlationId] - For response correlation
 * @returns {Promise<string>} message_id
 */
export async function sendAgentMessage(targetAgent, subject, body, opts = {}) {
  const p = getPool();
  const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const messageType = opts.correlationId ? 'response' : 'event';

  await p.query(
    `INSERT INTO inter_agent_messages
     (message_id, source_agent, target_agent, message_type, subject, payload, priority, correlation_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       CASE WHEN $9::int IS NOT NULL THEN NOW() + ($9::text || ' seconds')::interval ELSE NULL END)`,
    [
      messageId,
      process.env.AGENT_ID || "mes-ai",  // Each agent sets AGENT_ID
      targetAgent,
      messageType,
      subject,
      JSON.stringify(body),
      opts.priority || "normal",
      opts.correlationId || null,
      opts.ttlSeconds != null ? String(opts.ttlSeconds) : null,
    ]
  );

  return messageId;
}

/**
 * Poll pending messages for this agent.
 * @param {string} agentId - This agent's ID (e.g. 'mes-ai')
 * @param {number} [limit=20] - Max messages to fetch
 * @returns {Promise<Array>} Messages
 */
export async function pollAgentMessages(agentId, limit = 20) {
  const p = getPool();
  const result = await p.query(`
    SELECT * FROM inter_agent_messages
    WHERE target_agent IN ($1, '*')
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
      END,
      created_at ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  `, [agentId, limit]);

  if (result.rows.length > 0) {
    const ids = result.rows.map(r => r.id);
    await p.query(
      `UPDATE inter_agent_messages SET status = 'processing' WHERE id = ANY($1::bigint[])`,
      [ids]
    );
  }

  return result.rows;
}

/**
 * Complete a message (mark as processed).
 * @param {string} messageId
 * @param {object} [responseData]
 */
export async function completeAgentMessage(messageId, responseData = null) {
  const p = getPool();
  if (responseData) {
    await p.query(
      `UPDATE inter_agent_messages
       SET status = 'completed', processed_at = NOW(),
           payload = payload || $2::jsonb
       WHERE message_id = $1`,
      [messageId, JSON.stringify({ _response: responseData })]
    );
  } else {
    await p.query(
      `UPDATE inter_agent_messages
       SET status = 'completed', processed_at = NOW()
       WHERE message_id = $1`,
      [messageId]
    );
  }
}

/**
 * Fail a message.
 * @param {string} messageId
 * @param {string} errorMessage
 */
export async function failAgentMessage(messageId, errorMessage) {
  const p = getPool();
  await p.query(
    `UPDATE inter_agent_messages
     SET status = 'failed', processed_at = NOW(), error_message = $2
     WHERE message_id = $1`,
    [messageId, errorMessage]
  );
}

/**
 * Synchronous call to another agent's query script.
 * @param {string} scriptPath - Path to query script (e.g. 'services/worker/watchdog-query.js')
 * @param {string} scope - Query scope
 * @param {object} [args] - Key-value arguments for the script
 * @returns {Promise<object>} Parsed JSON response
 */
export async function callAgentQuery(scriptPath, scope, args = {}) {
  const cmdArgs = ["node", scriptPath, scope];
  for (const [key, value] of Object.entries(args)) {
    cmdArgs.push(`--${key}`, String(value));
  }

  return new Promise((resolve, reject) => {
    const child = spawn("node", cmdArgs, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`[${scriptPath}] ${err || out}`));
      else {
        try { resolve(JSON.parse(out)); }
        catch { reject(new Error(`Invalid JSON from ${scriptPath}: ${out.slice(0, 200)}`)); }
      }
    });
  });
}
```

---

## 12. Summary: What Each Agent Must Implement

| Agent | File Changes | New DB Table Reads | New Polling |
|---|---|---|---|
| **MES** | `mes-manager.js` — add `processAgentMessages()` in patrol cycle | `inter_agent_messages` | Every patrol (15 min) |
| **WMS** | `wms-manager.js` — add `sendAgentMessage()` after ISSUE_TO_LINE, IQC, SCRAP | `inter_agent_messages` | Every patrol (30 min) |
| **BOM** | `bom-manager.js` — add messages on BOM update, ECO approve, substitute suggest | `inter_agent_messages` | Every patrol (30 min) |
| **HR** | `hr-manager.js` — add messages on shift change, absence, cert expiry | `inter_agent_messages` | Every patrol (30 min) |
| **RDA** | `rda-manager.js` — add data response handler, anomaly detection message | `inter_agent_messages` | Every patrol (daily) |
| **Worker** | `worker.js` — add message on import complete | `inter_agent_messages` | Continuous |
| **All** | Import `agent-bus.js` from `services/_shared/agent-bus.js` | — | — |
