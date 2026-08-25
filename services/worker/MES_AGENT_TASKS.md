# MES AI Manager — Complete Task Catalog

> Production-grade job descriptions for every agent/skill the MES Manager must execute.
> Sources: Paxrel SMT AI patterns, ManuGent MES agent architecture, MES AI framework, Critical Manufacturing AI co-pilot model, Chat with MES, existing WMS manager patterns, OpenMES, IPC standards.

---

## Patrol Core Tasks (every 15 min)

### T1: Line Status Anomaly Detection
**Trigger**: Every 15 min + on-demand
**Priority**: P0 (critical path)

**Input**: `mes-query.js lines` + `mes-query.js events` (last 15 min)

**Logic**:
```
FOR each line:
  1. status == "down" AND no downtime_record in last 30 min
     → CREATE missing_downtime_flag
  2. status == "idle" AND 2h+ AND has released WO
     → ESCALATE to LINE (production manager)
  3. status == "running" AND 0 station_events in last 15 min
     → FLAG data_gap — possible stoppage or scan failure
  4. status == "changeover" AND duration > 1h
     → FLAG yellow warning
  5. status == "changeover" AND duration > 2h
     → ESCALATE to LINE (line supervisor)
  6. status == "running" AND completed_qty == 0 in last 1h
     → ESCALATE to LINE (possible stoppage)
```

**Output**: alerts[] with severity + line_code + detail
**Escalation**: critical → LINE immediate; warning → patrol log

**Reference**: Paxrel §1 SMT Line Optimization

---

### T2: Station Yield & Quality Monitor
**Trigger**: Every 15 min + per-station on-demand
**Priority**: P0

**Input**: `mes-query.js events` (last 1h/8h/24h per station)

**Station Baseline Targets** (IPC + industry standard):
| Station | Target Yield | Warning Drop | Critical Drop |
|---|---|---|---|
| SPI (solder paste) | ≥ 95% | 5% below | 10% below |
| AOI (optical) | ≥ 97% | 5% below | 10% below |
| AXI (X-ray) | ≥ 98% | 3% below | 7% below |
| ICT (in-circuit) | ≥ 98% | 2% below | 5% below |
| FCT (functional) | ≥ 98% | 2% below | 5% below |
| Assembly/P&P | ≥ 99.5% | 0.5% below | 2% below |

**Logic**:
```
FOR each station_type with recent events:
  yield = PASS / (PASS + FAIL) for time window
  IF yield < (baseline - 5%):
    → WARNING
  IF yield < (baseline - 10%):
    → LINE CRITICAL alert to QA engineer

  # Defect pareto
  TOP 3 defect codes in last 24h → patrol log

  # Defect trend
  SAME defect code 3+ times in 1h at same station
    → FLAG engineer review
  SAME defect code across DIFFERENT stations (same product)
    → FLAG systemic issue — LINE to process engineer
```

**Auto-Actions**:
- Warning → log + include in digest
- Critical → LINE to QA engineer + recommendation to check upstream (SPI/feeder)

**Reference**: Paxrel §2 AOI analysis; mes-manager-skill.md Skill 2

---

### T3: Feeder Binding Guardian
**Trigger**: Every patrol + new binding created
**Priority**: P1

**Input**: `mes-query.js feeders` + `mes-query.js fool-proof`

**Pre-Flight Checks**:
```
FOR each active feeder binding:
  1. Fool-proof: rules[stationCode + feederSlot].materialCode == binding.materialCode
     MISMATCH → BLOCK alert to line operator
  2. MSD: material_lot.msd_expiry > now? (if past → BLOCK)
  3. Quantity: received_qty - reserved_qty >= needed_qty
     LOW → flag warning
  4. WO match: binding.work_order_code matches active run's WO?
     MISMATCH → BLOCK
  5. Slot conflict: any other active binding on same slot?
     CONFLICT → BLOCK
```

**Output**: feeder_alerts[] with binding_id, check_result, severity
**Reference**: Paxrel §1 nozzle/feeder optimization; mes-manager-skill.md Skill 3

---

### T4: PCB Serial Tracker & Routing Verification
**Trigger**: Every patrol + new PCB serial registration
**Priority**: P1

**Input**: `mes-query.js pcb-serials` (status=wip)

**Routing Verification**:
```
FOR each WIP PCB serial:
  1. Load station flow: station_events for this serial
  2. Load process route: by WO → productCode
  3. Compare actual vs expected station order:
     - MISSING_STATION: PCB skipped required station
       → BLOCK line (quality violation)
     - EXTRA_STATION: PCB at wrong station
       → WARNING + reroute instruction
     - REVERSED_ORDER: PCB went backward
       → BLOCK investigation
     - DUPLICATE_EVENT: same station scanned twice
       → FLAG data integrity
```

**Stagnation Check** (per PCB):
```
dwell = minutes since last station_event
threshold = lookup from stagnation_thresholds[station_type]

IF dwell > threshold.warning → FLAG
IF dwell > threshold.critical → LINE alert to supervisor
```

**Reference**: mes-manager-skill.md Skill 4; IPC-2591 (CFX) traceability

---

### T5: Stagnation Manager
**Trigger**: Every 15 min + new stagnation detected
**Priority**: P1

**Input**: `mes-query.js stagnation`

**Stagnation Level Calculation**:
```
LEVELS:
  normal:   dwell < warning_minutes   → log only
  warning:  warning ≤ dwell < alert   → flag in patrol log
  alert:    alert ≤ dwell < critical  → LINE to station operator
  critical: dwell ≥ critical          → LINE to supervisor + QC

Default thresholds (configurable per station_type):
  warning:  15 min
  alert:    30 min
  critical: 60 min
```

**Resolution Logic**:
```
FOR each alert/critical stagnation:
  1. Check if PCB has recent event (maybe resolved but not flagged)
  2. If still stagnant:
     - Has upstream FAIL events? → recommend rework first
     - Idle > 7 days? → recommend scrap disposition
     - Otherwise → recommend resume flow
  3. Log recommendation
```

**Overdue Report** (daily): PCBs with overdue_months > 0
**Reference**: mes-manager-skill.md Skill 5

---

### T6: Scrap Manager
**Trigger**: Patrol cycle + weekly scrap analysis
**Priority**: P1

**Input**: `mes-query.js scraps`

**Auto-Triage Rules**:
| Condition | Auto Action |
|---|---|
| reason=IQC_REJECTED AND qty ≤ 100 | ✅ Auto-approve |
| reason=DAMAGED AND qty ≤ 10 | ✅ Auto-approve |
| reason=EXPIRED | ✅ Auto-approve |
| qty > 100 OR value > $500 | ⏳ Pending — LINE to QA manager |
| Same SN scrapped twice | 🚨 BLOCK — anomaly |
| Batch scrap (>50pcs, same WO, same reason) | 🟡 Flag — LINE to production manager |

**Trend Analysis** (weekly):
- Top scrap reasons by line
- Scrap rate = scrapped_qty / total_produced_qty per WO
- IF scrap rate > 5% for any WO → LINE alert to QA

**Reference**: mes-manager-skill.md Skill 6

---

### T7: Downtime Manager
**Trigger**: Patrol cycle + new downtime opened
**Priority**: P1

**Input**: `mes-query.js downtimes`

**Duration-Based Actions**:
| Duration | Level | Action |
|---|---|---|
| < 5 min | Green | Log only |
| 5-30 min | Yellow | Include in patrol summary |
| 30-120 min | Orange | LINE to line supervisor |
| > 120 min | Red | LINE to production manager |

**Reason Analysis**:
```
IF same reason_code > 3x/day on same line
  → REPEAT FAILURE — LINE to maintenance
IF reason = "SETUP" AND duration > 60 min
  → Suggest SMED review
IF open downtime > 30 min with no close action
  → Flag to close or extend
```

**Reference**: mes-manager-skill.md Skill 9

---

### T8: OEE Calculator
**Trigger**: Every hour + end of shift + on-demand
**Priority**: P1

**Input**: `mes-query.js oee`

**Calculation**:
```
OEE = Availability × Performance × Quality

Availability = OperatingTime / PlannedProductionTime
  OperatingTime = PlannedTime - DowntimeTotal
  DowntimeTotal = sum of all closed/open downtimes in period

Performance = (TotalPcs / OperatingTime) / IdealCycleTime
  TotalPcs = PASS + FAIL events at output station
  IdealCycleTime = configured per product (default 60s if missing)

Quality = GoodPcs / TotalPcs
  GoodPcs = PASS at output station
  TotalPcs = PASS + FAIL at all stations
```

**OEE Thresholds** (industry standard):
| Range | Rating | Action |
|---|---|---|
| ≥ 85% | World Class | Log only |
| 70-84% | Acceptable | Include in daily report |
| 50-69% | Needs Improvement | LINE to production manager |
| < 50% | Critical | LINE to factory manager |

**Reference**: mes-manager-skill.md Skill 10; OEE industry standard (Vorne)

---

### T9: Fool-Proof Guardian
**Trigger**: Patrol cycle + new rule created/modified
**Priority**: P2

**Input**: `mes-query.js fool-proof`

**Coverage Check**:
```
FOR each active line:
  Get all stations + all feeders per station
  Coverage = rules_count / feeder_count
  IF coverage < 80% → FLAG yellow
  IF coverage < 50% → LINE to process engineer
```

**Conflict Detection**:
```
  Same materialCode → different feederSlots on same station
    → FLAG potential conflict
  Same feederSlot → overlapping active rules
    → ALERT rule conflict
```

**Reference**: mes-manager-skill.md Skill 11

---

### T10: Material Verification Agent
**Trigger**: Patrol cycle + new verification record
**Priority**: P2

**Input**: `mes-query.js material-verify`

**Match Analysis**:
```
FOR each material_verification with matchResult=FAIL:
  Check fool-proof rule for [stationCode + feederSlot]
  IF rule exists:
    rule.materialCode vs actual materialCode
    MISMATCH → LINE alert (wrong material in slot)
    MATCH but operator error → flag retraining
  IF no rule:
    Log warning — missing fool-proof rule?
```

**Reference**: mes-manager-skill.md Skill 8; Paxrel §1 feeder optimization

---

### T11: First Article Inspection Gate
**Trigger**: Patrol cycle + new FA inspection
**Priority**: P2

**Input**: `mes-query.js first-article` + `mes-query.js runs`

**Readiness Gate**:
```
FOR each released WO without FA inspection:
  IF released > 2h ago → remind QC team
  IF released > 4h ago → LINE to QC manager
```

**Result Validation**:
```
FOR each FA inspection:
  IF overall result = FAIL:
    BLOCK line start → LINE to supervisor + QC
    Suggest re-inspection after correction
  IF PASS:
    Log only (no action)
```

**Reference**: mes-manager-skill.md Skill 7

---

### T12: Upstream NG Check Agent
**Trigger**: Patrol cycle + on station event POST
**Priority**: P2

**Input**: `mes-query.js events` + `mes-query.js pcb-serials`

**Logic**:
```
FOR each FAIL event at upstream station:
  Check if downstream stations received this PCB later
  IF downstream PASSED a PCB that had upstream FAIL:
    Was repair performed? Check repair station events
    IF no repair event → QUALITY BYPASS alert
```

**Reference**: mes-manager-skill.md Skill 13

---

### T13: Retest & Rework Agent
**Trigger**: Patrol cycle + on FAIL event
**Priority**: P2

**Input**: `mes-query.js events` (per PCB serial)

**Logic**:
```
FOR each FAIL event:
  Check retest rules for station_type + defect_code
  IF rule exists:
    retries < max → allow retest
    retries >= max → BLOCK, route to repair
  IF no retest rule → warn missing retest rule

  # Loop detection
  Same PCB retested 3+ times in 1h → loop detected
  Same PCB at repair station > 30 min → repair delay flag
```

**Reference**: mes-manager-skill.md Skill 12

---

### T14: Time Control Agent
**Trigger**: Patrol cycle
**Priority**: P2

**Input**: `mes-query.js events` (station flow)

**Checks**:
```
1. Station Cycle Time:
   Avg dwell > 1.5x standard → bottleneck flag
   Avg dwell > 2x → potential blockage

2. Production Pace:
   Expected = PlannedQty / AvailableHours
   Current = CompletedQty / ElapsedHours
   Current < Expected × 0.8 → behind schedule
   Current < Expected × 0.6 → LINE alert

3. Shift Transition:
   Near shift end, WIP > 50 → note for handover
   Line running with 0 operators clocked in → flag
```

**Reference**: mes-manager-skill.md Skill 14

---

### T15: Process Documentation Agent
**Trigger**: Patrol cycle + new/updated process route
**Priority**: P3

**Input**: `mes-query` equivalent for process routes

**Checks**:
```
FOR each active process route:
  Missing requiredScan for AOI/SPI → flag
  Missing requiredInspection for quality gate → flag
  No productCode → incomplete
  Duplicate step sequences → fix
```

**Reference**: mes-manager-skill.md Skill 15

---

### T16: Digital Station Operator Advisor
**Trigger**: Patrol cycle + on-demand per station
**Priority**: P3

**Input**: `mes-query` stations + events

**Readiness Check**:
```
FOR each station:
  Registered in system?
  Recent events (last 15 min) during running status?
  Operators assigned?
  Required scan configured correctly?
```

**Output**: Station guidance card for LINE/display
**Reference**: mes-manager-skill.md Skill 16

---

## Vision & Inspection Tasks

### T17: Visual PCB Inspection
**Trigger**: Camera capture event + on-demand
**Priority**: P1

**Model**: `minicpm-v4.5:8b`

**Tasks**:
| Sub-task | Input | Detects |
|---|---|---|
| pcb | AOI station photo | Missing component, tombstone, bridge, misalignment |
| solder | SPI paste inspection | Insufficient paste, bridging potential |
| feeder | Feeder bank photo | Wrong slot, tape peeling, empty feeder |
| label | Reel label photo | Material code match vs BOM |

**CLI**: `node mes-vision-inspect.js [pcb|solder|feeder|label] --image <path>`

**Reference**: Paxrel §2 AOI/AXI analysis; mes-manager-skill.md Skill 20

---

### T18: Solder Paste Cpk Trending
**Trigger**: Patrol cycle + SPI data available
**Priority**: P2

**Logic** (Paxrel §1):
```
FOR each aperture class (0201, 0402, 0603, QFP, BGA):
  Calculate Cpk = min(USL - mean, mean - LSL) / (3 * std)
  IF Cpk < 1.33 → FLAG

  # Wear trend detection
  Linear regression on last 50 prints
  IF slope < -0.05%/print → predict prints until out-of-limits
    → Schedule stencil clean/replace
```

**Reference**: Paxrel §1 SPI analysis

---

### T19: BGA Void Analysis
**Trigger**: AXI inspection event
**Priority**: P2

**Logic** (Paxrel §2, IPC-7095):
```
FOR each BGA X-ray result:
  IF max_void_pct > 25% (IPC standard) → FAIL
  IF max_void_pct > 15% (OEM tight spec) → FAIL
  IF corner-concentrated void pattern
    → Root cause: PCB warpage or component coplanarity
  IF uniformly distributed voids
    → Root cause: reflow profile or paste outgassing
```

**Reference**: Paxrel §2 X-ray analysis; IPC-7095

---

## Digest & Reporting Tasks

### T20: Morning Digest (07:15)
**Trigger**: Daily 07:15
**Priority**: P0

**Content** (LINE message):
```
🌅 MES晨报 {date}
━━━━━━━━━━━━━━━━━━
🏭 产线状态 ({n}条)
  SMT-1F: Running (WO: 26061020007) ✅
  SMT-2F: Changeover (预计30min) 🟡

📊 近24h良率
  SMT-1F: 98.2% ✅
  SMT-2F: 96.7% ✅

⚠️ 今日关注
  - SMT-1F: AOI良率94.1%低于基线(97%)
    建议: 检查SPI参数 + 确认来料状态
  - PCB-SN-001234: ICT停滞45min (超预警线)

📋 今日待办
  - [ ] SMT-1F: 首件检验确认
  - [ ] 呆滞PCB处理: 3片 > 7天
```

**Reference**: mes-manager-skill.md Skill 18; Critical Manufacturing co-pilot model

---

### T21: Evening Report (17:00)
**Trigger**: Daily 17:00
**Priority**: P0

**Content**:
```
🌇 MES日报 {date}
━━━━━━━━━━━━━━━━━━
总产出: 12,450pcs
整体良率: 97.8%
OEE: 78.3%
━━━━━━━━━━━━━━━━━━
停机总计: 47min (3次)
报废总计: 28pcs (0.22%)
故障TOP3: BRIDGE(12), TOMBSTONE(8), MISSING(5)
```

Reference: mes-manager-skill.md Skill 18

---

### T22: Weekly Quality Report (Monday 08:00)
**Trigger**: Weekly Monday
**Priority**: P1

**Content**:
- Defect pareto by station by week
- Scrap rate trend (weekly comparison)
- OEE trend (daily bars, weekly average)
- Top 3 root causes with corrective action status
- Fool-proof coverage changes
- AI manager accuracy (auto-improvement)
- LINE summary to factory manager + QA + production

---

## Self-Improvement Tasks

### T23: Auto-Improvement Loop
**Trigger**: After every patrol cycle
**Priority**: P0 (enables trust in the system)

**Pipeline**:
```
Patrol Cycle
  → Ornith decisions logged to mes_manager_audit_log
  → Judge LLM (qwen2.5:7b) scores recent decisions
  → Accuracy per decision_type computed
  → IF rolling 7-day accuracy < 70%
      → Disable auto_execute for that type
      → LINE alert to system admin
  → Threshold tuning: IF error_rate > 30% for type
      → Flag for human review
```

**Judge Rubric**:
| Decision Type | Correct If | Incorrect If |
|---|---|---|
| yield_warning | Yield genuinely dropped | Normal statistical variation |
| stagnation_action | PCB truly stagnant | Events missed by system |
| scrap_decision | Material genuinely scrap-worthy | Salvageable material scrapped |
| downtime_flag | Downtime legitimately prolonged | Short pause misclassified |
| line_alert | Line had genuine anomaly | False alarm |
| feeder_violation | Material mismatch confirmed | Data entry error |

**CLI**: `node mes-evaluator.js score-recent`
**Reference**: mes-manager-skill.md Skill 19; ManuGent memory architecture

---

### T24: Threshold Tuner
**Trigger**: Weekly + on-demand
**Priority**: P2

**Logic**:
```
FOR each decision_type with ≥5 feedback entries:
  IF error_rate > 30%:
    → Suggest threshold adjustment
    → Or disable auto_execute for this type

  Examples:
    stagnation:warning_minutes too low → raise from 15 to 20
    yield:warning_drop too sensitive → raise from 5% to 7%
    scrap:auto_approve_qty_too_high → lower from 100 to 50
```

**CLI**: `node mes-evaluator.js tune-thresholds`

---

### T25: Performance Report
**Trigger**: On-demand + weekly auto
**Priority**: P2

**Output**:
```json
{
  "period": "7 days",
  "overall": {
    "total": 1240,
    "evaluated": 892,
    "accuracy": "86.3%",
    "unevaluated": 348
  },
  "byType": [
    { "type": "yield_warning", "total": 312, "accuracy": "91.2%" },
    { "type": "scrap_decision", "total": 89, "accuracy": "78.6%" }
  ]
}
```

**CLI**: `node mes-evaluator.js report --days 7`

---

## SOP & Workflow Engine Tasks

### T26: SOP Execution Engine
**Trigger**: Patrol start + on-demand resume
**Priority**: P0

**Capabilities**:
| Step Type | Behavior |
|---|---|
| QUERY | Run mes-query.js, capture output |
| EXECUTE | Run mes-execute.js action |
| EVAL | Run mes-evaluator.js |
| VISION | Run mes-vision-inspect.js |
| DIGEST | Run digest generation |
| CONDITION | Evaluate expression, route to next step |
| SET-VARIABLE | Store value in state vars |
| NOTIFY | Send LINE message |
| BRANCH | Route based on condition result |

**Transitions**: Condition-based routing (`result_X eq value`, `result_X gt N`)
**State Persistence**: `mes-sop-state.json` — survives crash, supports resume

**CLI**: `node mes-sop-manager.js [run|resume|next|state-set|state-get]`
**Reference**: mes-manager-skill.md Skill 21

---

### T27: MES Patrol SOP Flow
**Trigger**: Every patrol cycle
**Priority**: P0

**Default 15-Step Flow**:
```
1. QUERY lines          → get active line statuses
2. QUERY runs           → get active production runs
3. QUERY stagnation     → detect stagnant PCBs
4. CONDITION            → if stagnation found → resolve
5. EXECUTE resolve-stagnation → auto-resolve
6. QUERY scraps         → get pending scrap requests
7. CONDITION            → if scraps found → approve
8. EXECUTE approve-scrap → auto-approve low-value
9. QUERY oee            → get OEE metrics
10. EVAL                → self-evaluate recent decisions
11. VISION              → if cameras available → inspect
12. NOTIFY digest       → send patrol summary
13. SET-VARIABLE        → mark cycle complete
```

---

## Alert & Escalation Matrix

### T28: Alert Manager
**Trigger**: Continuous (any patrol finding)
**Priority**: P0

| Severity | Trigger | Recipient | Channel |
|---|---|---|---|
| 🔴 CRITICAL | Line 0 output > 1h | Supervisor + PMC | LINE immediate |
| 🔴 CRITICAL | Yield drop > 10% | QA engineer | LINE immediate |
| 🔴 CRITICAL | Fool-proof mismatch | Operator + supervisor | LINE immediate |
| 🔴 CRITICAL | PCB routing skip | QC + production | LINE immediate |
| 🟠 ALERT | Line idle > 2h with WO | Production manager | LINE immediate |
| 🟠 ALERT | Stagnation critical | Supervisor | LINE immediate |
| 🟠 ALERT | OEE < 50% | Factory manager | LINE immediate |
| 🟡 WARNING | Yield drop 5-10% | QA | LINE digest |
| 🟡 WARNING | Downtime > 30min | Supervisor | LINE digest |
| 🟡 WARNING | Coverage < 80% fool-proof | Process engineer | LINE weekly |
| 🔵 INFO | WO released | Supervisor | LINE as-it-happens |

**Debounce**: Same alert type + same entity not re-sent within 24h unless severity escalates.

---

## Execution Priority Matrix

| Task | Frequency | Priority | Auto | Human Review |
|---|---|---|---|---|
| T1 Line Status | 15 min | P0 | ✅ | Critical only |
| T2 Yield Monitor | 15 min | P0 | Warning | Critical → LINE |
| T3 Feeder Guardian | 15 min | P1 | Block alerts | ✅ |
| T4 PCB Tracker | 15 min | P1 | Route violation | ✅ |
| T5 Stagnation | 15 min | P1 | Alert/Critical | Normal/Warning |
| T6 Scrap | 15 min | P1 | Criteria-based | Auto if ≤ threshold |
| T7 Downtime | 15 min | P1 | Duration-based | Critical → LINE |
| T8 OEE | 1h | P1 | Log | < 70% → LINE |
| T9 Fool-Proof | 15 min | P2 | Coverage < 50% | ✅ |
| T10 Material Verify | 15 min | P2 | Mismatch alerts | ✅ |
| T11 FA Gate | 15 min | P2 | Reminders | LINE if > 4h |
| T12 Upstream NG | 15 min | P2 | Bypass critical | ✅ |
| T13 Retest/Rework | 15 min | P2 | Block if maxed | ✅ |
| T14 Time Control | 15 min | P2 | Flag slowdown | LINE if critical |
| T15 Process Doc | 15 min | P3 | Log flags | Weekly review |
| T16 Station Advisor | 15 min | P3 | Guidance card | On request |
| T17 Vision PCB | On-demand | P1 | Recommendation | Rework/Scrap |
| T18 SPI Cpk | 15 min | P2 | Cpk < 1.33 | Stencil action |
| T19 BGA Void | On AXI | P2 | Void % > limit | Process fix |
| T20 Morning Digest | 07:15 daily | P0 | ✅ Full auto | N/A |
| T21 Evening Report | 17:00 daily | P0 | ✅ Full auto | N/A |
| T22 Weekly Report | Monday 08:00 | P1 | ✅ Full auto | Read only |
| T23 Auto-Improve | Post-patrol | P0 | ✅ Auto | < 70% → alert |
| T24 Threshold Tune | Weekly | P2 | Proposal | Human approves |
| T25 Performance Rpt | On-demand | P2 | ✅ | Read only |
| T26 SOP Engine | Patrol start | P0 | ✅ | State resume |
| T27 SOP Flow | Every patrol | P0 | ✅ | Critical only |
| T28 Alert Manager | Continuous | P0 | ✅ | By severity |

---

## Data Dependencies

| Task | Required Tables |
|---|---|
| T1 Line Status | production_lines, station_events, downtime_records, mes_runs |
| T2 Yield | station_events, stations, station_types |
| T3 Feeder | feeder_bindings, fool_proof_rules, material_lots, materials |
| T4 PCB | pcb_serials, station_events, process_routes, stagnation_thresholds |
| T5 Stagnation | stagnation_log, station_events |
| T6 Scrap | scrap_records, scrap_reason_codes |
| T7 Downtime | downtime_records |
| T8 OEE | station_events, downtime_records, mes_runs, production_lines |
| T9 Fool-Proof | fool_proof_rules, stations, production_lines |
| T10 Material | material_verifications, fool_proof_rules |
| T11 FA | first_article_inspections, mes_runs, work_orders |
| T12 Upstream | station_events, pcb_serials |
| T13 Retest | station_events, retest_rules |
| T14 Time | station_events, mes_runs |
| T15 Process | process_routes, process_route_steps |
| T16 Station | stations, station_events, station_operators |
| T17 Vision | (image files) |
| T18 SPI | station_events (SPI), stencil_maintenance |
| T19 BGA | station_events (AXI) |
| T23 Audit | mes_manager_audit_log |
