# AGV AI Manager — Virtual Agent Skills

## Agent Profile

**Name**: AGV AI Manager (`AGV调度AI管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no data leaves factory)
**Execution**: Node.js DB queries + AGV REST API calls (port 8081)
**Escalation**: LINE notifications for battery alerts, stuck tasks, critical incidents
**Audit**: Every dispatch decision logged to `mes_manager_audit_log` with agent='agv-ai'
**Fleet**: 4 AGVs — AGV-S01 (shuttle, idle, 95.5%), AGV-S02 (shuttle, busy, 72%), AGV-F01 (forklift, idle, 45%), AGV-F02 (forklift, maintenance)

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)   │
│  Every 5 min: patrol, dispatch, battery    │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  agv-manager.js (Node.js)                 │
│  1. Poll agent bus (mes-ai messages)       │
│  2. Query fleet + tasks (agv-query.js)      │
│  3. Assign pending tasks (agv-execute.js)   │
│  4. Route low-battery AGVs to charging      │
│  5. Send LINE alerts                        │
└──────────────┬──────────────────────────────┘
               │
  ┌────────────┼──────────────────┐
  ▼            ▼                  ▼
PostgreSQL   AGV REST API       LINE API
(data+queue) (port 8081)       (alerts)
```

**AGV REST API** (`services/api/agv-api.js`, port 8081):
- `POST /agv/commands` — enqueue command for AGV to poll
- `GET  /agv/commands?agv_code=X` — AGV polls for pending commands
- `POST /agv/commands/:id/complete` — AGV marks command done
- `POST /agv/heartbeat` — AGV alive signal
- `POST /agv/alert` — AGV reports alerts

---

## Core Skills

### Skill 1: Kit Delivery Request Handler

**Trigger**: `kit_delivery_request` message from `mes-ai` via agent bus

**Payload**:
```json
{
  "task_code": "AGV-T00010",
  "task_type": "material_delivery",
  "from_zone": "ZONE-WH-A",
  "to_zone": "ZONE-SMT-1",
  "from_station": "ST-LOAD-WH",
  "to_station": "ST-UNLOAD-SMT1",
  "work_order_code": "WO260701001",
  "line_code": "SMD-01",
  "load_type": "reel_trolley",
  "load_kg": 120,
  "priority": 2,
  "requested_by": "mes-ai"
}
```

**Flow**:
1. Validate zones exist in `agv_zones`
2. Create task in `agv_tasks` with status='pending'
3. Log decision to `mes_manager_audit_log` with agent='agv-ai'
4. Notify LINE: `[AGV] 任务已创建: AGV-T00010 (ZONE-WH-A→ZONE-SMT-1)`
5. `dispatchPendingTasks()` picks up pending task next cycle

**Task Types**:
- `material_delivery` — SMT line material supply (shuttle)
- `empty_trolley_return` — return empty reel trolley to warehouse (shuttle)
- `pallet_pickup` — move pallet from staging (forklift)
- `finished_goods` — move completed boards to FG zone (forklift)
- `reel_supply` — reel cart delivery (shuttle)
- `empty_pallet` — empty pallet collection

---

### Skill 2: Task Dispatch Engine

**Trigger**: Patrol cycle (every 5 min) or after `kit_delivery_request`

**Logic**:
1. Query all `pending` tasks from `agv_tasks`, ordered by priority ASC, created_at ASC
2. Query available AGVs: status IN ('idle','charging') AND battery_pct > low_battery_threshold + 10
3. For each pending task:
   - Pick AGV with highest battery (simple heuristic)
   - Validate AGV type matches load requirement (forklift for pallets >500kg)
   - Update `agv_tasks`: status='dispatched', agv_id set, dispatched_at=NOW()
   - Update `agv_fleet`: status='busy', current_task_id set
   - Enqueue command via `POST /agv/commands` for AGV device to poll
4. Log to `mes_manager_audit_log`

**AGV Selection Rules**:
- Shuttle (AGV-S01, AGV-S02): max_load_kg=500, for reel trolleys, carts
- Forklift (AGV-F01, AGV-F02): max_load_kg=1500, lift_height=3000mm, for pallets
- Battery must be > low_battery_threshold + 10% before assignment
- Skip AGV-F02 if status='maintenance'

---

### Skill 3: Battery Watch & Auto-Charge

**Trigger**: Every patrol cycle (5 min) for all 'idle' AGVs

**Logic**:
1. For each idle AGV with battery_pct ≤ low_battery_threshold:
   - Find nearest charging station (by zone x_coord ascending)
   - Update `agv_fleet`: status='charging'
   - Log to `agv_charging_log` with start_battery_pct
   - Enqueue `charge` command via `POST /agv/commands`
   - Notify LINE: `🔋 [AGV充电] AGV-S01 → ZONE-CHG-1`
2. After task completion, if battery_pct ≤ threshold, auto-route to charging

**Thresholds** (from `agv_fleet.low_battery_threshold`):
- Default: 20%
- Charging station codes: ST-CHG-1 (ZONE-CHG-1), ST-CHG-2 (ZONE-CHG-2)

---

### Skill 4: Task Cancellation

**Trigger**: `task_cancel` message from `mes-ai` via agent bus

**Payload**:
```json
{
  "task_code": "AGV-T00010",
  "reason": "WO cancelled by operator",
  "cancelled_by": "mes-ai"
}
```

**Logic**:
1. Only cancellable: 'pending', 'assigned', 'dispatched'
2. Update `agv_tasks`: status='cancelled', cancelled_at=NOW(), cancelled_reason
3. If AGV was assigned: reset `agv_fleet` to 'idle', clear current_task_id
4. Delete pending command from `agv_command_queue` if exists
5. Log to audit log

---

### Skill 5: Zone Blocking

**Trigger**: `station_block` message from `mes-ai` via agent bus

**Payload**:
```json
{
  "zone_code": "ZONE-SMT-1",
  "station_code": "ST-UNLOAD-SMT1",
  "blocked": true,
  "reason": "SMT-1 changeover in progress",
  "blocked_by": "mes-ai"
}
```

**Logic**:
1. Resolve zone_id from `agv_zones`
2. Update `agv_stations`: status='blocked'
3. Notify LINE: `🚧 [AGV区域封锁] ZONE-SMT-1/ST-UNLOAD-SMT1 — SMT-1 changeover in progress`
4. AGV routing will avoid blocked stations

---

### Skill 6: Stuck Task Detection

**Trigger**: Every patrol cycle

**Logic**:
1. Query tasks with status IN ('en_route','in_progress','dispatched') where dispatched_at is >30 min ago
2. For each stuck task:
   - Notify LINE: `🚨 [AGV任务卡住] AGV-T00002 (AGV-S02) 状态:in_progress 已持续45分钟`
   - Log to audit
3. Threshold configurable via `--threshold-min` (default 30)

---

### Skill 7: Critical Alert Escalation

**Trigger**: Every patrol cycle

**Logic**:
1. Query `agv_alerts` where resolved=false AND severity='critical'
2. For each critical alert:
   - Notify LINE immediately: `🚨 [AGV紧急告警] AGV-F01 — obstacle: Blocked by pallet in aisle 3`
3. Alert types:
   - `low_battery` (warning) → auto-route to charging
   - `collision_warning` (warning)
   - `obstacle` (critical)
   - `offline` (critical)
   - `stuck` (critical)
   - `task_timeout` (warning)
   - `maintenance_due` (info)

---

### Skill 8: Fleet Status Patrol

**Trigger**: Every patrol cycle

**Reporting**:
```
Fleet: idle:1 busy:1 charging:1 lowBattery:1
Tasks: pending:2 inProgress:1 completed:5
```

**LINE Digest** (optional, on request):
```
🤖 AGV晨报
━━━━━━━━━━━━━━━━
AGV-S01: 🟢 idle 95.5% 🔋
AGV-S02: 🟡 busy 72% 🔋
AGV-F01: 🟠 idle 45% 🔋 (低电量)
AGV-F02: ⚪ maintenance
```

---

## SOP: agv-sop.json

The `agv-sop-manager.js` executes the SOP in `agv-sop.json`:

```
query-fleet → query-pending-tasks
  → check-battery? → route-low-battery
  → filter-available? → assign-tasks
  → query-active-tasks → check-task-stuck? → alert-stuck-tasks
  → query-alerts → check-critical-alerts? → escalate-alerts
  → query-kpi → evaluate-dispatch → complete
```

---

## Database Tables

| Table | Purpose |
|---|---|
| `agv_fleet` | AGV vehicle registry — status, battery, position |
| `agv_tasks` | Transport task queue — priority, status, route |
| `agv_zones` | Factory zones / navigation nodes |
| `agv_stations` | Docking/charging stations |
| `agv_positions` | Position log (1h rolling window) |
| `agv_alerts` | Alert log — low battery, obstacle, offline, stuck |
| `agv_charging_log` | Charging session history |
| `agv_task_history` | Completed task audit |
| `agv_command_queue` | AGV command queue (polled by devices) |

---

## Inter-Agent Messages

**Inbound to `agv-ai`** (handled by agv-manager.js):
- `kit_delivery_request` — from mes-ai: new material delivery needed
- `task_cancel` — from mes-ai: cancel an assigned task
- `station_block` — from mes-ai: block/unblock a zone
- `return_request` — from wms-ai: return empty trolley

**Outbound from `agv-ai`** (send via bus):
- `agv_task_created` — task dispatched (to mes-ai, wms-ai)
- `agv_low_battery` — AGV battery below threshold (to mes-ai, hr-ai)
- `agv_stuck` — AGV stuck/blocked (to mes-ai, hr-ai)
- `agv_task_completed` — task finished (to mes-ai, wms-ai)
- `agv_incident` — critical AGV incident (to mes-ai, hr-ai)

---

## CLI Commands

```bash
# Patrol: fleet status + dispatch + battery
node agv-manager.js patrol

# Continuous loop (every 5 min)
node agv-manager.js watch --interval 5

# Process pending tasks only
node agv-manager.js task-dispatch

# Battery check only
node agv-manager.js battery-watch

# Self-evaluation
node agv-manager.js eval --limit 5

# SOP execution
node agv-sop-manager.js run --sop agv-sop.json --state agv-sop-state.json
node agv-sop-manager.js next --sop agv-sop.json --state agv-sop-state.json

# Direct query
node agv-query.js fleet
node agv-query.js tasks
node agv-query.js alerts
node agv-query.js kpi
node agv-query.js all

# Direct execute
node agv-execute.js create-task --task-code AGV-T00010 --task-type material_delivery \
  --from-zone ZONE-WH-A --to-zone ZONE-SMT-1 --load-type reel_trolley --load-kg 120
node agv-execute.js assign-task --task-id 3 --agv-code AGV-S01
node agv-execute.js cancel-task --task-code AGV-T00010 --reason "WO cancelled"
node agv-execute.js route-to-charging --agv AGV-S01
node agv-execute.js block-zone --zone ZONE-SMT-1 --station ST-UNLOAD-SMT1 --reason "changeover"
```

---

## AGV Fleet Reference

| Code | Type | Status | Battery | Location | Navigation |
|---|---|---|---|---|---|
| AGV-S01 | shuttle | idle | 95.5% | ZONE-CHG-1 | SLAM |
| AGV-S02 | shuttle | busy | 72% | ZONE-SMT-1 | SLAM |
| AGV-F01 | forklift | idle | 45% | ZONE-CHG-2 | LIDAR |
| AGV-F02 | forklift | maintenance | 88% | ZONE-TRANSIT | LIDAR |

---

## Zone Reference

| Zone | Type | Area | Charging |
|---|---|---|---|
| ZONE-WH-A | storage | Warehouse | No |
| ZONE-WH-B | storage | Warehouse | No |
| ZONE-SMT-1 | production | SMT-A | No |
| ZONE-SMT-2 | production | SMT-A | No |
| ZONE-FG | loading | Warehouse | No |
| ZONE-CHG-1 | charging | Factory | Yes |
| ZONE-CHG-2 | charging | Factory | Yes |
| ZONE-TRANSIT | transit | Factory | No |

---

## Quality Standards

- Every dispatch decision logged with input_data + output_decision
- Battery routing happens automatically when battery ≤ threshold
- Blocked zones are respected in task assignment
- Task priority: 1 (highest) to 10 (lowest)
- Audit log retention: indefinitely (mes_manager_audit_log)
