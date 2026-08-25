# Plant AI Manager — Virtual Agent Skills
# 越南工厂瑞晶 — 工厂级AI管理员

## Agent Profile

**Name**: Plant AI Manager (`工厂AI管理员`, `Quản lý AI Nhà máy`)
**Model**: Ornith-1.0-9B (local, privacy-first, no factory data leaves premises)
**Execution**: Node.js orchestration scripts + inter-agent bus + API calls
**Escalation**: LINE notifications to factory director and department heads; human-in-the-loop for plant-wide decisions
**Memory**: Plant-level state JSON for cross-manager delta detection; last-state per sub-manager
**Audit**: Every plant-level decision logged with timestamp, sub-manager inputs, synthesis reasoning, and outcome
**Sub-Managers**: MES (SMT line control), WMS (warehouse), BOM (engineering), PMC (scheduling), HR (workforce), RDA (data archiving), **AGV (material transport)**

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)                                    │
│  Every 30 min: plant patrol (query all 7 sub-managers)                        │
│  Every 5 min: AGV patrol (fleet + battery + dispatch)                        │
│  07:00: morning brief (synthesized from all sub-managers) → LINE            │
│  17:00: evening report → LINE                                                 │
│  23:00: daily archive snapshot (via RDA)                                      │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  MES AI Manager  │  │  WMS AI Manager │  │  BOM AI Manager │
│  SMT line control│  │  Warehouse mgmt │  │  Engineering BOM │
│  (mes-manager.js)│  │ (wms-manager.js)│  │(bom-manager.js)│
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                      │                     │
         └──────────────────────┼─────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                                 ▼
    ┌──────────────────┐             ┌──────────────────┐
    │  PMC AI Manager  │             │  HR AI Manager   │
    │  Scheduling      │             │  Workforce mgmt  │
    │(pmc-manager.js) │             │ (hr-manager.js) │
    └────────┬─────────┘             └────────┬─────────┘
              │                                │
              └───────────────┬────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
    │  RDA AI Manager  │ │AGV AI Manager│ │  AGV REST API   │
    │  Data archiving  │ │  Fleet mgmt  │ │  (port 8081)    │
    │ (rda-manager.js) │ │(agv-manager) │ │  3 AGVs active  │
    └──────────────────┘ └──────────────┘ └──────────────────┘
```

---

## SMT Factory Patrol Knowledge Base

### Industry Benchmarks (source: EMS Handbook, TeepTrak 2026, Fabrico, ASM)

| Metric | Target | Escalation Trigger | Action |
|---|---|---|---|
| **OEE** (Overall Equipment Effectiveness) | **≥ 85%** | < 75% → YELLOW, < 65% → RED | Stop line if quality below FPY threshold |
| **Availability** | ≥ 90% | Changeover > 15 min → engineering review | Log as Logistics Loss, not Maintenance Loss |
| **Performance** (Real Speed) | ≥ 95% of rated CPH | Running < 95% rated speed → formal justification required | Fix vacuum/filter issues, restore rated speed |
| **Quality (FPY)** | ≥ **98.5%** at AOI | FPY < 98.5% → **STOP LINE immediately** | Producing defect faster destroys Quality OEE component |
| **DPMO** (Defects Per Million) | ≤ 500 DPMO | > 2000 DPMO → Pareto + corrective action | correlate AOI/SPI/spi |
| **Placement Accuracy** | Cpk ≥ 1.33 (critical pads) | CpK < 1.33 → recipe review | Monitor nozzle wear, feeder spring tension |
| **Minor Stops** | < 5 per hour | > 15 per hour on single feeder → flag feeder #slot | Root cause: mis-pick, feeder jam, vision reject — must be visible via PLC/IIoT |
| **IQC Pass Rate** | ≥ 97% | < 95% → supplier review | Block affected lots, trigger supplier corrective action |
| **Schedule Adherence** | ≥ 95% | < 90% → PMC + factory director review | Reschedule or authorize OT |
| **AGV Fleet Utilization** | ≥ 80% | < 60% → dispatch optimization | Route idle AGVs to charging or material transport |

### The Hidden Factory: Minor Stops (SMT's Biggest OEE Killer)

Most OEE loss in SMT is NOT from breakdowns — it's **thousands of 5-second mis-picks and feeder jams** that never trip an alarm. Industry data shows these invisible losses can account for **10–15% of total capacity**.

**EMS Handbook Rule**: All critical SMT assets must push live state codes, speeds, and error logs to MES. No manual logging of micro-stops — automated collection is mandatory.

**MES must detect**:
- Pick error → vacuum nozzle worn or feeder spring loose
- Slot 42 feeder jam → cycle-based PM overdue (every 1,000,000 picks)
- Solder paste printer: insufficient paste volume → SPI CpK drop
- AOI false call rate drift → library needs retraining

### SMT Patrol Checklist (per line, per 30-min cycle)

```
□ Line status: Running / Changeover / Down / Idle
□ Active WO: code, output vs plan, WIP balance
□ OEE components: availability (actual downtime min), performance (actual CPH vs rated), quality (FPY at AOI)
□ Minor stops last 30 min: count and top error codes
□ Feeder status: any slot flagged as high-error-rate
□ SPI: paste volume CpK, any out-of-spec
□ AOI: pass/fail count, false call rate trending
□ Reflow: peak temp, heating rate within spec
□ WIP alerts: stagnant PCBs (no event > 15 min)
□ Scrap: pending approval count, top reason codes
□ Material at line: reel count at feeder, MSD exposure timer
□ Downtime: open event with reason code, duration
□ MES → AGV: any kit_delivery_request pending or dispatched
```

### SMED / Changeover Best Practices

When changeover exceeds **15 minutes**: immediate engineering review required.

SMED best practice:
1. Pre-stage all feeders, carts, stencils **while machine is still running previous batch**
2. Pre-position trolleys offline
3. Reduce internal stop time (machine stopped) by maximizing external (machine running)
4. Log changeover time and operator — target < 10 min for high-mix

---

## Core Skills

### Skill 1: Plant-Wide Patrol Agent

**Trigger**: Every 30 minutes (automated), on-demand

**Responsibilities**:
- Query all 7 sub-managers simultaneously via plant-query.js
- Aggregate outputs: MES yield/OEE/WIP, WMS inventory/IQC, BOM ECO status, PMC schedule adherence, HR attendance, RDA archive freshness, **AGV fleet status**
- Detect cross-domain anomalies (e.g., WMS shortage → PMC delay → MES line stop)
- Run SMT patrol checklist per active line
- Generate patrol digest with RAG status per domain
- Escalate cross-manager issues that no single sub-manager can resolve

**SMT-Specific Cross-Domain Patterns**:

| Pattern | Domain A | Domain B | Action |
|---|---|---|---|
| WMS shortage delays MES line | WMS | MES | Escalate to factory director, trigger emergency PO |
| MES minor-stop spike from feeder | MES | WMS | Flag high-error feeder, request feeder PM from HR/Maintenance |
| BOM change blocks WMS material release | BOM | WMS | Route ECO approval to BOM manager, alert PMC |
| AGV low battery disrupts kit delivery | AGV | MES | Route to charging, reassign task to another AGV |
| AGV stuck blocks station access | AGV | MES | Block zone via station_block, alert human |
| HR absence disrupts PMC schedule | HR | PMC | Reassign WO to available line, alert HR manager |
| PMC schedule delay cascades to MES | PMC | MES | Recalculate line capacity, alert WMS for material readiness |
| IQC hold on critical component | WMS | MES | Expedite IQC or find substitute BOM |
| MES yield drop may indicate BOM issue | MES | BOM | Request BOM audit for affected component |
| AGV task timeout (>20 min) | AGV | WMS | Alert, check AGV task queue for stuck jobs |

**Ornith Prompt Template**: `plantPatrolPrompt`

---

### Skill 2: Morning Brief Agent

**Trigger**: 07:00 daily (automated via Windows Task Scheduler)

**Responsibilities**:
- Query overnight sub-manager outputs (last 16 hours: MES night shift, WMS receiving, HR attendance)
- Synthesize key events from overnight period
- Run SMT **shift handoff checklist**: outgoing team issues, incoming team alerts
- Identify top 3 factory risks for the day
- Assign action items to department heads with owner and deadline
- Format brief in both zh-CN and vi-VN for LINE

**Brief Structure**:
```
【早班简报 Y】{{date}}
时间: 07:00 | 工厂: 越南瑞晶 SMT

📊 夜班/昨日总结:
  • MES: 产出 {{mes.output}} PCS | 良率 {{mes.yield}}% | WIP {{mes.wip}} | OEE {{mes.oee}}%
  • WMS: 库存 {{wms.total_stock}} | 待IQC {{wms.iqc_pending}} | 超期 {{wms.overdue_iqc}}
  • PMC: 在产工单 {{pmc.active_wos}} | 已发布 {{pmc.released_wos}} | 暂停 {{pmc.held_wos}}
  • HR: 出勤率 {{hr.attendance_rate}}% | 加班超限 {{hr.ot_excess}} 人
  • BOM: 活跃BOM {{bom.active_boms}} | 待ECO {{bom.draft_boms}}
  • RDA: 归档表 {{rda.archive_tables}} | 最后归档 {{rda.last_archive}}
  • AGV: 可用{{agv.idle}} | 运输中{{agv.busy}} | 充电中{{agv.charging}} | 低电量{{agv.low_battery}}

🚨 今日重点问题 (Top 3):
  1. [{{domain}}] {{top_issue_1}} — 负责人: {{owner_1}} — 截止: {{deadline_1}}
  2. [{{domain}}] {{top_issue_2}} — 负责人: {{owner_2}} — 截止: {{deadline_2}}
  3. [{{domain}}] {{top_issue_3}} — 负责人: {{owner_3}} — 截止: {{deadline_3}}

📋 今日计划:
  • 计划产出: {{plan_output}} PCS | 良率目标: {{plan_yield}}%
  • 预计交付: {{plan_delivery}} | OEE目标: ≥85%
  • AGV运输计划: {{agv.delivery_schedule_count}} 次 | 充电时段: {{agv.charge_schedule}}

Generated by: Plant AI Manager | 工厂AI管理员
```

**Ornith Prompt Template**: `morningBriefPrompt`

---

### Skill 3: Evening Report Agent

**Trigger**: 17:00 daily (automated)

**Responsibilities**:
- Query full day outputs from all sub-managers
- Calculate daily KPIs vs targets (SMT-specific):
  - **OEE**: availability × performance × quality vs target ≥85%
  - **Minor stop count** and top error codes (feeder slot Pareto)
  - **FPY**: actual first-pass yield vs target ≥98.5%
  - **Changeover time**: vs SMED target <15 min
  - **AGV**: tasks completed, avg task duration, battery cycle count
- Identify deviations from plan and root cause
- Generate next-day preview (rough plan for first shift)
- Send to LINE factory group

**Report Structure**:
```
【晚班报告 T】{{date}}
时间: 17:00 | 工厂: 越南瑞晶 SMT

📈 今日产出:
  • 实际: {{actual_output}} PCS | 计划: {{plan_output}} PCS | 完成率: {{completion_rate}}%
  • OEE: {{oee}}% (目标: ≥85%) | 可用率: {{availability}}% | 速度: {{performance}}% | 良率: {{quality}}%
  • WIP结余: {{wip_remaining}} PCS

📦 交付状态:
  • 今日交付: {{delivery_today}} | 累计本周: {{delivery_week}}
  • 按期率: {{on_time_rate}}%

🔋 AGV运行摘要:
  • 完成任务: {{agv.tasks_completed}} | 可用率: {{agv.utilization}}%
  • 低电量事件: {{agv.low_battery_events}} | 任务超时: {{agv.timeout_events}}

⚠️ 偏差分析:
  1. [{{time}}] {{deviation_1}} — 原因: {{root_cause_1}}
  2. [{{time}}] {{deviation_2}} — 原因: {{root_cause_2}}

👥 明日计划:
  • 计划产出: {{tomorrow_plan_output}} PCS | OEE目标: ≥85%
  • AGV充电排程: {{agv.charge_schedule}}

Generated by: Plant AI Manager | 工厂AI管理员
```

**Ornith Prompt Template**: `eveningReportPrompt`

---

### Skill 4: KPI Synthesis Agent

**Trigger**: On-demand (from plant-manager.js kpi command), every 4 hours during production

**Responsibilities**:
- Aggregate real-time KPIs from all sub-managers including **AGV fleet metrics**
- Calculate plant-level **OEE** and productivity metrics
- Compare against SMT industry benchmarks (≥85% OEE, ≥98.5% FPY)
- Detect micro-stop patterns and feeder-level error rates
- Highlight outliers and trends

**KPI Dashboard Data**:
```javascript
{
  plant: {
    oee: { current: 0.85, target: 0.85, unit: "%" },
    fpy: { current: 0.986, target: 0.985, unit: "%" },
    minor_stops_per_hour: { current: 8, threshold: 15, unit: "count" },
    productivity: { current: 142, target: 150, unit: "PCS/人/天" },
  },
  mes: {
    oee: 0.86, line_utilization: 0.92, wip: 1240,
    fpy: 0.987, aqi_false_call_rate: 0.008,
    changeover_time_min: 12, target_changeover: 15,
    stagnant_pcb_count: 3,
  },
  wms: {
    stock_accuracy: 0.98, iqc_pass_rate: 0.97,
    stockout_events: 2, msd_exposure_hours: 0,
  },
  bom: {
    completeness: 0.99, eco_pending: 3,
    avg_eco_days: 12, bom_accuracy: 0.97,
  },
  pmc: {
    schedule_adherence: 0.94, ot_hours: 38,
    delivery_rate: 0.96, on_time: 22,
  },
  hr: {
    attendance: 0.97, labor_productivity: 142,
    turnover: 0.02, ot_excess_count: 1,
  },
  rda: {
    archive_freshness_hrs: 2, retention_compliance: 1.0,
  },
  agv: {
    fleet_utilization: 0.78, target: 0.80,
    idle_count: 1, busy_count: 1, charging_count: 1,
    low_battery_count: 1, tasks_completed_today: 12,
    avg_task_duration_min: 18, battery_cycles_today: 3,
  },
}
```

**SMT OEE Formula** (per line):
```
Availability = (Planned Production Time - Downtime) / Planned Production Time
Performance = Actual CPH / Rated CPH  [target ≥ 95%]
Quality = First Pass Yield at AOI [target ≥ 98.5%]
OEE = Availability × Performance × Quality
```

**Ornith Prompt Template**: `kpiSynthesisPrompt`

---

### Skill 5: AGV-MES Coordination Agent

**Trigger**: Every 5 minutes (automated), or when MES sends `kit_delivery_request`

**Responsibilities**:
- Poll `agv-ai` bus messages from MES (`kit_delivery_request`, `task_cancel`, `station_block`)
- Monitor AGV fleet: battery, position, active task status
- Assign pending AGV tasks to best available vehicle
- Route low-battery AGVs to charging stations proactively
- Detect stuck AGV tasks (>20 min in_progress) and escalate to LINE
- Coordinate **WMS → AGV → MES** closed-loop: kit ordered → AGV dispatched → delivered → MES notified

**AGV-MES Integration Best Practice** (VDA 5050 / industry standard):
- MES publishes `kit_delivery_request` with: from_zone, to_zone, work_order_code, line_code, priority
- AGV fleet manager subscribes, assigns best AGV, dispatches via REST API
- AGV reports task status back → MES updates WIP
- If AGV battery low or stuck → AGV sends alert to MES → MES reroutes or escalates

**AGV Selection Rules**:
| AGV | Type | Max Load | Battery | Used For |
|---|---|---|---|---|
| AGV-S01 | shuttle | 500 kg | idle 95.5% | Reel trolley, carts |
| AGV-S02 | shuttle | 500 kg | busy 72% | Reel trolley, carts |
| AGV-F01 | forklift | 1500 kg | idle 45% ⚠️ | Pallets, FG transport |
| AGV-F02 | forklift | 1500 kg | maintenance | Heavy pallets |

**Never dispatch AGV-F01** when battery ≤ 55% (threshold 50% + safety margin). Route to ZONE-CHG-1 or ZONE-CHG-2.

**Ornith Prompt Template**: `agvCoordinationPrompt`

---

### Skill 6: Cross-Domain Escalation Agent

**Trigger**: When sub-manager patrol detects cross-manager issue, manual escalation

**Responsibilities**:
- Receive escalations from sub-managers that require plant-level resolution
- Identify which other sub-managers are affected
- Route escalation to correct sub-manager with context
- Track escalation lifecycle: open → in_progress → resolved → closed
- Send escalation digest to factory director

**Escalation Types**:

| Type | From | To | SLA | Severity |
|---|---|---|---|---|
| WMS shortage stops production | WMS | MES | **1h** | CRITICAL |
| MES FPY < 98.5% (line stop) | MES | BOM, WMS | **30min** | CRITICAL |
| AGV stuck > 20 min | AGV | MES, HR | **30min** | CRITICAL |
| BOM change blocks material release | BOM | WMS | 2h | HIGH |
| HR shortage prevents WO start | HR | PMC | 4h | HIGH |
| PMC schedule change affects BOM | PMC | BOM | 4h | MEDIUM |
| MES yield drop may indicate BOM issue | MES | BOM | 8h | MEDIUM |
| AGV low battery cascade | AGV | WMS, MES | 2h | HIGH |
| RDA archive failure affects compliance | RDA | BOM/PMC | 24h | LOW |

**Priority Framework**: Safety > Delivery > Quality > Cost

---

### Skill 7: Inter-Manager Sync Agent

**Trigger**: When sub-managers need to coordinate but agent-bus routing is insufficient

**Responsibilities**:
- Mediate between sub-managers with conflicting priorities:
  - WMS: minimum stock vs PMC: maximum buffer
  - BOM ECO urgency vs MES: production continuity
  - HR OT cost control vs PMC: delivery pressure
  - AGV: task priority vs MES: kit urgency
- Synthesize constraints from all affected managers
- Propose resolution that minimizes plant-level impact
- Log resolution for future pattern learning

**Decision Framework**:
1. Collect constraints from affected sub-managers
2. Rank priorities: Safety > Delivery > Quality > Cost
3. Find solution satisfying top-priority constraints
4. Propose compromise to human if no algorithmic solution
5. Log resolution + reasoning for evaluator

---

## Decision Matrices

### Plant Health Assessment Matrix

| MES OEE | WMS Stockout | PMC Delay | AGV Utilization | HR Attendance | Plant Status |
|---|---|---|---|---|---|
| ≥ 0.85 | 0 | ≤ 2h | ≥ 80% | ≥ 98% | 🟢 GREEN |
| 0.80–0.85 | 1–2 | 2–4h | 70–80% | 95–98% | 🟡 YELLOW |
| 0.70–0.80 | 3–5 | 4–8h | 60–70% | 90–95% | 🟠 ORANGE |
| < 0.70 | > 5 | > 8h | < 60% | < 90% | 🔴 RED |

### Escalation Routing Matrix

| Issue | Primary Manager | Secondary | Escalate To |
|---|---|---|---|
| Material shortage | WMS | PMC | Factory Director |
| Line FPY below 98.5% | MES | BOM, WMS | Production Director |
| BOM change | BOM | MES, WMS | Engineering Manager |
| AGV stuck / blocked | AGV | MES | Factory Director |
| AGV low battery cascade | AGV | WMS, MES | Maintenance Lead |
| Schedule conflict | PMC | MES, HR | Production Director |
| Labor shortage | HR | PMC | Factory Director |
| Data integrity | RDA | BOM, PMC | IT Manager |

---

## LINE Alert Templates (zh-CN / vi-VN)

### Critical Line Stop Alert

**Key**: `plant.line_stop_critical`
```
🚨【生产线停止 Critical Line Stop】
线别: {{line_code}} | 工位: {{station}} | 时间: {{timestamp}}
原因: {{reason_code}} | 持续: {{duration_min}} min
良率: {{fpy}}% (目标: ≥98.5%)
建议: {{recommended_action}}
负责人: {{owner}}
```
**vi-VN**: `[Dừng máy nghiêm trọng Critical Line Stop]\nDây: {{line_code}} | Trạm: {{station}} | Thời gian: {{timestamp}}\nNguyên nhân: {{reason_code}} | Kéo dài: {{duration_min}} phút\nTỷ lệ đạt: {{fpy}}% (Mục tiêu: ≥98.5%)\nĐề xuất: {{recommended_action}}\nNgười phụ trách: {{owner}}`

### AGV Fleet Alert

**Key**: `plant.agv_fleet`
```
🔋【AGV车队状态 AGV Fleet Status】
可用: {{idle}} | 运输中: {{busy}} | 充电中: {{charging}}
低电量: {{low_battery}} (AGV: {{agv_codes}})
待处理任务: {{pending_tasks}}
```
**vi-VN**: `[Tình trạng đội xe AGV]\nSẵn sàng: {{idle}} | Đang vận chuyển: {{busy}} | Đang sạc: {{charging}}\nPin thấp: {{low_battery}} (AGV: {{agv_codes}})\nTác vụ chờ: {{pending_tasks}}`

### Escalation Alert Template

**Key**: `plant.escalation`
```
【工厂级升级 Factory Escalation】
级别: {{severity}} | 来源: {{source_manager}}
时间: {{timestamp}}

问题: {{issue_description}}
影响: {{impact}}
建议行动: {{proposed_action}}

负责人: {{owner}} | 截止: {{deadline}}
```
**vi-VN**: `[Leo cấp nhà máy Factory Escalation]\nMức: {{severity}} | Nguồn: {{source_manager}}\nThời gian: {{timestamp}}\n\nVấn đề: {{issue_description}}\nTác động: {{impact}}\nHành động đề xuất: {{proposed_action}}\n\nNgười phụ trách: {{owner}} | Hạn chót: {{deadline}}`

---

## i18n Key Conventions

**Key Format**: `plant.{category}.{event}.{variant}`

Examples:
- `plant.brief.morning.zh-CN` → "早班简报"
- `plant.brief.morning.vi-VN` → "Báo cáo sáng"
- `plant.escalation.critical.zh-CN` → "工厂级升级"
- `plant.escalation.critical.vi-VN` → "Leo cấp nhà máy"
- `plant.report.evening.zh-CN` → "晚班报告"
- `plant.agv.fleet.zh-CN` → "AGV车队状态"
- `plant.line_stop.zh-CN` → "生产线停止"

---

## Agent Bus Integration

**Subscribes To** (inbound to plant-ai):
- `mes-ai.sop_cycle_complete` → Update MES status in plant patrol
- `wms-ai.sop_cycle_complete` → Update WMS status
- `bom-ai.sop_cycle_complete` → Update BOM status
- `pmc-ai.sop_cycle_complete` → Update PMC status
- `hr-ai.sop_cycle_complete` → Update HR status
- `rda-ai.sop_cycle_complete` → Update RDA status
- **`agv-ai.sop_cycle_complete`** → Update AGV fleet status
- `mes-ai.system_alert` → Forward critical MES alerts
- `wms-ai.system_alert` → Forward critical WMS alerts
- **`agv-ai.agv_low_battery`** → Forward AGV battery alert
- **`agv-ai.agv_stuck`** → Forward AGV stuck alert → escalate immediately
- **`agv-ai.agv_incident`** → Forward critical AGV incident

**Publishes** (outbound from plant-ai):
- `plant.sop_cycle_complete` → When plant patrol cycle completes
- `plant.system_alert` → When cross-domain escalation is raised
- `plant.morning_brief_sent` → After morning brief delivered
- `plant.evening_report_sent` → After evening report delivered
- `plant.agv_escalation` → AGV-related escalation to factory director

---

## Error Handling

| Error | Action | Fallback |
|---|---|---|
| Sub-manager query timeout | Skip that manager, note "data unavailable" | Log, continue with available managers |
| All sub-managers fail | Alert factory director immediately | Switch to manual monitoring |
| AGV API unreachable | Log error, retry next cycle, notify MES of delay | Fall back to manual material transport alert |
| LINE API fails | Retry 3x, log to file | Save digest to file, retry next cycle |
| Ornith synthesis timeout | Use template-based fallback synthesis | Basic aggregation without LLM |
| JSON parse error in sub-manager output | Log error, exclude manager from synthesis | Continue with valid managers |

---

## Skill Evaluation Rubric (plant-evaluator.js)

| Criterion | Weight | Description |
|---|---|---|
| all_managers_queried | 0.20 | Were all 7 sub-managers properly queried? |
| smt_patrol_complete | 0.20 | Were SMT patrol checklist items executed per line? |
| kpi_aggregation_correct | 0.15 | Were KPIs correctly aggregated from all domain data? |
| oee_calculation_correct | 0.15 | Was OEE calculated correctly (A×P×Q vs target ≥85%)? |
| agv_coordination_correct | 0.10 | Were AGV tasks properly dispatched and monitored? |
| cross_domain_detected | 0.10 | Were cross-domain issues correctly identified? |
| escalation_appropriate | 0.05 | Were escalations correctly routed? |
| report_quality | 0.05 | Was the patrol digest informative and actionable? |

---

## Database Tables (Plant-Level)

- `plant_patrol_log` — patrol_id, timestamp, sub_manager_status (JSON), synthesis_output (JSON), issues_found (JSON), escalated (Boolean)
- `plant_escalations` — escalation_id, source_manager, affected_manager, issue_type, severity, status, owner, deadline, created_at, resolved_at
- `plant_manager_audit` — id, decision_type, ornith_summary (JSONB), input_data (JSONB), output_decision (JSONB), auto_execute (Boolean), feedback, feedback_at, created_at

---

## References

- EMS Handbook Vol.08 Ch.6: OEE targets >85%, Availability ≤15min changeover, FPY ≥98.5%, speed ≥95% rated
- TeepTrak 2026: OEE 67%→80% case study — minor stops account for 10-15% of hidden factory losses
- NTT DATA Taiwan MES/SMT Whitepaper 2026: MES + WMS + AGV/AMR integration architecture
- VDA 5050: AGV-master control standard interface (German automotive, MQTT-based)
- Neotel SMF: 6-step material lifecycle, ERP/MES/WMS/AGV closed-loop
- Fabrico OEE Guide: micro-stop detection via PLC/IIoT, feeder slot Pareto, CPK monitoring
- ASM Intelligent Factory: IPC-CFX for SMT line data, AI-based virtual assistant for engineers
- iFactory 2026: humanoid robot patrols 1200+ sensor points/hour, 98.7% anomaly accuracy
