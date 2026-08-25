# MES AI Manager — Role Specification

> Job description, performance requirements, capabilities, and evaluation framework
> for the MES AI Manager agent in a Vietnam SMT factory.

---

## 1. Job Title

**MES AI Manager (制造执行AI管理员)**

Reports to: Factory Manager / Production Engineering Manager
Shift: 24/7 on-call (patrol every 15 min, no rest)
Team: Virtual — coordinates with Ornith (reasoning), Judge LLM (evaluation), Vision LLM (inspection), LINE (alerting), PostgreSQL (data)

---

## 2. Job Targets (OKRs)

### 2.1 Production Targets

| Target | Metric | Threshold | Measurement |
|---|---|---|---|
| Line downtime detection | Time from actual stop to AI flag | ≤ 20 min | patrol_log.timestamp vs actual downtime start |
| Yield drop warning | Detection within 1 patrol cycle (15 min) of crossing threshold | ≥ 95% of events | station_events vs yield_alerts timestamp |
| Stagnation resolution | Auto-resolve stagnant PCBs within critical threshold | ≥ 80% within critical window | stagnation_log.resolved_at - stagnation_log.created_at |
| Scrap auto-approve accuracy | Scrap decisions that don't need human override | ≥ 95% approval acceptance rate | scrap_records.approved_by = 'mes-ai' AND NOT overridden |
| Fool-proof violations | Block alerts issued before material reaches line | 100% of mismatches | feeder_bindings vs fool_proof_rules vs alert timestamp |
| PCB routing violations | Detect wrong-station/before routing within 1 patrol cycle | ≥ 90% of violations | station_events sequence analysis |
| First article readiness | Flag WOs missing FA inspection before line starts | 100% coverage | work_orders.released_at vs WO started_at |

### 2.2 Quality Targets

| Target | Metric | Threshold |
|---|---|---|
| Patrol cycle completion | % of scheduled patrols that complete fully | ≥ 99.5% (allows 2 missed patrols/day) |
| Ornith response parse rate | % of Ornith responses successfully parsed to valid JSON | ≥ 95% |
| Decision accuracy (overall) | % of AI decisions rated "correct" by Judge LLM | ≥ 80% rolling 7-day |
| Yield warning precision | % of yield warnings confirmed by actual yield drop | ≥ 85% |
| Stagnation alert precision | % of alert-level stagnation confirmed as real | ≥ 85% |
| Scrap decision accuracy | % of scrap approve/reject that match human judgment | ≥ 90% |
| Downtime flag precision | % of escalated downtimes that were > 30 min | ≥ 90% |
| False alarm rate | Alerts that required no action | ≤ 5% of all alerts |

### 2.3 Availability Targets

| Target | Metric | Threshold |
|---|---|---|
| Patrol uptime | Successful patrol cycles / total scheduled | ≥ 99.5% |
| Digest delivery | Morning + evening digests delivered on schedule | ≥ 99% |
| LINE alert delivery | Critical alerts delivered within 1 min of detection | ≥ 98% |
| Database connectivity | Successful queries / total attempts | ≥ 99% |
| Ornith availability | Successful LLM calls / total attempts | ≥ 95% |
| Recovery time after failure | Time to resume normal patrol after crash | ≤ 2 min (auto via SOP state) |

### 2.4 Business Impact Targets

| Target | Metric | Expected Impact |
|---|---|---|
| Reduce line downtime | Total unplanned downtime per line per week | -15% within 3 months |
| Improve yield | First-pass yield improvement | +0.5% within 3 months |
| Reduce scrap cost | Scrap value / total production value | -10% within 3 months |
| OEE improvement | Average OEE across all lines | +3% within 3 months |
| Reduce stagnation | Average dwell time per stagnant PCB | -20% within 1 month |
| Operator efficiency | Time saved by automating patrol decisions | 2+ hours/shift saved |

---

## 3. Job Roles & Responsibilities

### 3.1 Core Responsibilities

1. **Production Line Surveillance** (every 15 min)
   - Query all active production lines for status
   - Detect anomalies: missing downtime logs, idle lines with released WOs, running lines with no events
   - Escalate critical issues to human supervisors via LINE

2. **Quality Monitoring** (every 15 min)
   - Calculate real-time yield per station type per line
   - Compare against station-specific baselines (AOI 97%, SPI 95%, ICT 98%, FCT 98%)
   - Flag yield drops: warning at -5%, critical at -10%
   - Generate defect pareto (top 3 defect codes in last 24h)
   - Detect defect trends (same code 3x/h at same station)

3. **Material Flow Integrity** (every patrol)
   - Verify feeder bindings against fool-proof rules
   - Check reel MSD status
   - Detect slot conflicts and quantity shortages
   - Block material mismatches before they reach the line

4. **PCB Traceability** (every patrol)
   - Track WIP PCB serials through station flow
   - Verify against process route (no skipped/reversed/extra stations)
   - Detect stagnation per station threshold
   - Flag routing violations

5. **Scrap Management** (every patrol)
   - Review pending scrap requests
   - Auto-approve low-risk scraps (IQC rejected ≤ 100pcs, damaged ≤ 10pcs, expired)
   - Escalate high-value or batch scraps to human
   - Generate weekly scrap trend analysis

6. **Downtime Management** (every patrol)
   - Monitor open downtimes by duration
   - Classify: <5min log, 5-30min flag, 30-120min LINE, >120min LINE critical
   - Detect repeat failures (same reason >3x/day)
   - Flag overdue close actions

7. **OEE Calculation** (hourly + end of shift)
   - Compute Availability × Performance × Quality per line
   - Rate: World Class ≥85%, Acceptable 70-84%, Needs Improvement 50-69%, Critical <50%
   - Include in daily reports

8. **First Article Inspection Gate** (every patrol)
   - Check released WOs for completed FA inspection
   - Remind QC at 2h, escalate at 4h
   - Block line start on FA failure

9. **Alert Management** (continuous)
   - Classify findings by severity (critical/warning/info)
   - Route to correct recipient channel (LINE immediate vs digest vs log)
   - Debounce: no repeat of same alert within 24h unless severity increases

### 3.2 Daily Responsibilities

10. **Morning Digest** (07:15)
    - Query overnight production data
    - Summarize: line status, 24h yield, active WOs, stagnant PCBs, top concerns
    - Include AI accuracy snapshot from self-evaluation
    - Send formatted LINE message to management group

11. **Evening Report** (17:00)
    - Query daily production totals
    - Summarize: total output, overall yield, OEE, downtime total, scrap total
    - Top 3 defect codes with trends
    - Send formatted LINE message

### 3.3 Weekly Responsibilities

12. **Weekly Quality Review** (Monday 08:00)
    - Defect pareto by station by week
    - Scrap rate trend vs previous week
    - OEE trend (daily bars)
    - Fool-proof coverage changes
    - AI decision accuracy report
    - Root cause analysis for top 3 defects
    - LINE summary to factory manager + QA + production

13. **Threshold Tuning** (weekly)
    - Analyze decision accuracy per type
    - Propose threshold adjustments for underperforming types
    - Flag decision types that need human review

### 3.4 On-Demand Responsibilities

14. **Ad-Hoc Analysis**
    - Query any MES data point on request
    - Generate yield report for specific line + time range
    - Trace specific PCB serial through entire production flow
    - Check specific feeder binding status

15. **Visual Inspection**
    - Inspect PCB photo for defects (missing component, tombstone, bridge)
    - Inspect solder paste SPI image for quality
    - Inspect feeder bank photo for alignment
    - Verify reel label against BOM

16. **SOP Execution**
    - Run full patrol SOP flow on command
    - Resume from last completed step if interrupted
    - Display current SOP state
    - Override specific SOP steps on command

### 3.5 Self-Improvement Responsibilities

17. **Self-Evaluation** (after every patrol)
    - Score recent Ornith decisions using Judge LLM (qwen2.5:7b)
    - Compute accuracy per decision type
    - Log all results to mes_manager_audit_log

18. **Threshold Optimization** (continuous)
    - Track rolling 7-day accuracy
    - If any decision type < 70% accuracy → disable auto_execute for that type
    - Propose new thresholds based on historical data

19. **Performance Reporting** (on-demand)
    - Generate accuracy report for any time period
    - Break down by decision type, line, shift
    - Export to JSON for dashboard consumption

---

## 4. Performance Requirements (SLA/SLO)

### 4.1 Latency SLOs

| Operation | SLO (P95) | Measurement |
|---|---|---|
| Complete patrol cycle (all 15+ steps) | ≤ 120 seconds | patrol_log timestamps |
| Ornith LLM inference (analysis) | ≤ 45 seconds | Ollama API call duration |
| DB query (any single scope) | ≤ 5 seconds | query execution time |
| Decision execution (API call) | ≤ 10 seconds | HTTP response time |
| LINE notification delivery | ≤ 3 seconds | LINE API response time |
| State save/load | ≤ 1 second | filesystem operation |
| SOP step transition | ≤ 2 seconds | step execution time |
| Vision inference (single image) | ≤ 30 seconds | Ollama vision API time |

### 4.2 Reliability SLOs

| Metric | Target | Measurement |
|---|---|---|
| Patrol cycle success rate | ≥ 99.5% | successful / total cycles |
| DB query success rate | ≥ 99% | successful queries / total |
| Ornith call success rate | ≥ 95% | successful calls / total |
| LINE delivery success rate | ≥ 98% | 200 OK / total sends |
| State file integrity | 100% | valid JSON on every read |

### 4.3 Accuracy SLOs

| Decision Type | Minimum Accuracy | Measurement |
|---|---|---|
| yield_warning | 75% | Judge LLM + human feedback |
| stagnation_action | 75% | Judge LLM + human feedback |
| scrap_decision | 85% | Judge LLM + human feedback |
| downtime_flag | 80% | Judge LLM + human feedback |
| line_alert | 75% | Judge LLM + human feedback |
| feeder_violation | 85% | Judge LLM + human feedback |
| Overall | 80% | Weighted average |

### 4.4 Capacity

| Resource | Requirement |
|---|---|
| Concurrent lines monitored | Up to 20 |
| PCBs tracked simultaneously | Up to 10,000 |
| Patrol cycles stored | Unlimited (rotate log on size) |
| Audit log retention | 2 years |
| State file size | < 1 MB |
| Concurrent operator queries | Up to 5 |

---

## 5. Capabilities

### 5.1 Query Capabilities

| Capability | Description | CLI |
|---|---|---|
| Line status | Query all production lines with active runs | `mes-query.js lines` |
| Run status | Query active/past production runs | `mes-query.js runs` |
| Station events | Query events per station/line/time | `mes-query.js events` |
| Stagnation | Query stagnant PCB records | `mes-query.js stagnation` |
| Scraps | Query scrap records | `mes-query.js scraps` |
| Downtimes | Query downtime records | `mes-query.js downtimes` |
| Feeders | Query active feeder bindings | `mes-query.js feeders` |
| PCB serials | Query PCB serial tracking | `mes-query.js pcb-serials` |
| Fool-proof | Query fool-proof rules | `mes-query.js fool-proof` |
| First article | Query FA inspections | `mes-query.js first-article` |
| Material verify | Query material verifications | `mes-query.js material-verify` |
| OEE | Query OEE metrics per line | `mes-query.js oee` |
| All | Query all above in one call | `mes-query.js all` |

### 5.2 Execution Capabilities

| Capability | Description | CLI |
|---|---|---|
| Line alert | Send LINE alert for line anomaly | `mes-execute.js line-alert` |
| Yield warning | Log yield drop with severity | `mes-execute.js yield-warning` |
| Resolve stagnation | Auto-resolve stagnant PCB | `mes-execute.js resolve-stagnation` |
| Approve scrap | Auto-approve/reject scrap | `mes-execute.js approve-scrap` |
| Flag downtime | Mark downtime with severity | `mes-execute.js flag-downtime` |
| Check feeder | Verify feeder binding vs rules | `mes-execute.js check-feeder` |
| Generate digest | Generate morning/evening digest | `mes-execute.js generate-digest` |
| Line check | Detailed line health snapshot | `mes-execute.js line-check` |
| LINE notify | Send arbitrary LINE message | `mes-execute.js notify-line` |
| Audit log | Log decision to audit table | `mes-execute.js audit-log` |

### 5.3 Analysis Capabilities

| Capability | Model | Description |
|---|---|---|
| Line patrol reasoning | Ornith-1.0-9B | Analyze full factory snapshot, generate decisions |
| Decision self-evaluation | qwen2.5:7b | Score recent decisions by rubric |
| Performance report | Algorithmic | Aggregate accuracy metrics by type |
| Threshold tuning | Algorithmic | Analyze error patterns, propose new limits |
| Trend detection | Algorithmic | Detect defect trends, repeat failures |

### 5.4 Vision Capabilities

| Capability | Model | Description |
|---|---|---|
| PCB defect inspection | minicpm-v4.5:8b | Detect missing component, tombstone, bridge, misalignment |
| Solder quality | minicpm-v4.5:8b | Detect insufficient paste, bridging potential |
| Feeder alignment | minicpm-v4.5:8b | Detect wrong slot, tape peeling, empty feeder |
| Label verification | minicpm-v4.5:8b | Read material code, check vs BOM |

### 5.5 SOP Capabilities

| Capability | Description |
|---|---|
| Load SOP | Load and validate SOP JSON definition |
| Execute step | Run any SOP step type (query/execute/eval/vision/digest/condition/notify) |
| Resolve transitions | Evaluate conditions, route to correct next step |
| Save state | Persist execution state for crash recovery |
| Resume | Continue from last completed step after interruption |
| Template variables | Resolve `{{ var_X }}` and `{{ result_step_Y }}` in step params |

### 5.6 Integration Capabilities

| System | Integration Type | Details |
|---|---|---|
| PostgreSQL | Direct SQL | All MES data queries |
| REST API | JWT-authenticated HTTP | State-modifying actions (resolve, approve, etc.) |
| LINE Notify | HTTP POST with token | All alerting and digests |
| Ollama | REST API | Ornith (reasoning), Judge (evaluation), Vision (inspection) |
| Windows Task Scheduler | PowerShell | Scheduled patrol/digest execution |
| File system | JSON state files | Patrol state, pending approvals, logs |

### 5.7 Operational Capabilities

| Capability | Description |
|---|---|
| Auto-recovery | Resume patrol from last saved state after crash |
| Graceful degradation | If Ornith unavailable → fall back to rule-based decisions |
| Debounce | Same alert not re-sent within 24h unless severity escalates |
| Pending queue | Non-auto decisions saved to JSON for dashboard |
| Audit trail | Every decision logged with input, output, timestamp |
| Cycle isolation | Each patrol cycle has unique ID linking all decisions |

---

## 6. Evaluation Abilities

### 6.1 Self-Evaluation (Automated)

**Method**: LLM-as-Judge using qwen2.5:7b

**Process**:
```
After every patrol cycle:
  1. Collect recent unevaluated decisions from mes_manager_audit_log
  2. For each decision, build rubric prompt with decision_type + input + output
  3. Ask Judge LLM: "correct" or "incorrect"
  4. Store feedback in audit_log.feedback column
  5. Update rolling accuracy stats
```

**Rubric Template**:
```
Decision Type: {type}
Input: {JSON of input data}
Decision: {JSON of Ornith's output}

Rubric:
- yield_warning: Correct if yield genuinely dropped below baseline by indicated margin.
  Incorrect if normal statistical variation.
- stagnation_action: Correct if PCB truly stagnant (no recent events).
  Incorrect if events were missed.
- scrap_decision: Correct if material genuinely scrap-worthy.
  Incorrect if salvageable.
- downtime_flag: Correct if downtime legitimately prolonged.
  Incorrect if short pause.
- line_alert: Correct if line had genuine anomaly.
  Incorrect if false alarm.

Respond ONLY: "correct" or "incorrect"
```

**Accuracy Tracking**:
```sql
SELECT decision_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
  COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect,
  ROUND(COUNT(*) FILTER (WHERE feedback = 'correct')::float /
    NULLIF(COUNT(*) FILTER (WHERE feedback IN ('correct','incorrect')), 0) * 100, 1) AS accuracy_pct
FROM mes_manager_audit_log
WHERE feedback IS NOT NULL
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY decision_type;
```

### 6.2 Human Evaluation (Ground Truth)

**Method**: Operator dashboard review

**Process**:
```
1. Non-auto decisions saved to pending-approvals.json
2. Dashboard displays pending decisions for human review
3. Human approves/rejects/overrides each decision
4. Override logged with override_by, override_at, reason
5. Human feedback stored as ground truth in audit_log
```

**Metrics**:
- Human override rate (lower = better)
- Human agreement rate with AI (higher = better)
- Time-to-review for pending decisions

### 6.3 Performance Metrics (Dashboard)

| Metric | Formula | Update Frequency |
|---|---|---|
| Patrol Cycle Success Rate | successful_cycles / total_cycles × 100 | After each patrol |
| Average Cycle Duration | avg(patrol_end - patrol_start) | After each patrol |
| Ornith Response Rate | successful_llm_calls / total_llm_calls × 100 | After each patrol |
| Decision Accuracy (7d) | correct / (correct + incorrect) × 100 | Hourly |
| Auto-Execution Rate | auto_executed / total_decisions × 100 | After each patrol |
| False Alarm Rate | alerts_with_no_action / total_alerts × 100 | Daily |
| Alert Count by Severity | COUNT(critical), COUNT(warning), COUNT(info) | Per patrol |
| Top Decision Types | COUNT by decision_type DESC | Daily |
| Average Latency per Step | avg(step_execution_time) by step_type | Per patrol |

### 6.4 Quality Gates (Pass/Fail)

| Gate | Condition | Action on Fail |
|---|---|---|
| Ornith parse success | ≥ 95% over 24h | Disable auto-execute, alert admin |
| Decision accuracy | ≥ 70% over 7d per type | Disable auto_execute for that type |
| DB connectivity | ≥ 99% over 24h | Retry with backoff, alert if persistent |
| LINE delivery | ≥ 98% over 24h | Log failure, fall back to file log |
| State file integrity | 100% valid JSON | Backup corrupted file, restart from defaults |
| Patrol completion | ≥ 99.5% over 7d | Escalate to factory manager |

### 6.5 Evaluation Reports

**Quick Report** (daily):
```
🤖 MES AI准确率报告 (近7天)
━━━━━━━━━━━━━━━━━━
总决策: 1,240 | 自动: 892 | 人工评估: 348
准确率: 86.3% (892条评分)
  yield_warning:       89.2% (312条)
  stagnation_action:   82.5% (143条)
  scrap_decision:      78.6% (89条)
  downtime_flag:       91.4% (198条)
  line_alert:          85.7% (150条)
  feeder_violation:    93.1% (58条)
Auto-execute 停用类型: (无)
━━━━━━━━━━━━━━━━━━
```

**Detailed Report** (weekly, JSON):
```json
{
  "period": { "from": "2026-06-21", "to": "2026-06-28" },
  "overall": {
    "total_decisions": 8680,
    "evaluated": 6244,
    "correct": 5389,
    "incorrect": 855,
    "accuracy_pct": 86.3,
    "unevaluated": 2436,
    "auto_executed": 6244,
    "manual_pending": 348,
    "human_overridden": 42,
    "override_rate_pct": 0.67
  },
  "by_type": [
    { "type": "yield_warning", "total": 2184, "accuracy": 89.2, "auto_disabled": false },
    { "type": "stagnation_action", "total": 1001, "accuracy": 82.5, "auto_disabled": false },
    { "type": "scrap_decision", "total": 623, "accuracy": 78.6, "auto_disabled": true },
    { "type": "downtime_flag", "total": 1386, "accuracy": 91.4, "auto_disabled": false },
    { "type": "line_alert", "total": 1050, "accuracy": 85.7, "auto_disabled": false },
    { "type": "feeder_violation", "total": 406, "accuracy": 93.1, "auto_disabled": false }
  ],
  "threshold_changes": [
    { "type": "scrap_decision", "old_threshold": 100, "new_threshold": 50,
      "reason": "Accuracy 78.6% < 80% target — tightening auto-approve qty limit" }
  ]
}
```

---

## 7. Escalation & Override

### 7.1 When to Escalate to Human

| Condition | Escalation Path | SLI |
|---|---|---|
| Decision accuracy < 70% for any type | LINE to system admin | Immediate |
| Ornith unavailable > 3 consecutive cycles | LINE to factory manager | 45 min |
| DB unavailable > 5 consecutive cycles | LINE to IT | 75 min |
| Critical alert suppressed by debounce but still active | Re-escalate with severity increase | After 24h |
| Human override rate > 10% in 24h | LINE to process engineer | Daily |
| Patrol cycle fails > 5 times in 1h | LINE to system admin | Immediate |

### 7.2 Override Mechanism

```
Human reviews pending decision in dashboard:
1. APPROVE — AI decision stands, logged as confirmed
2. REJECT — AI decision reversed, feedback=incorrect
3. MODIFY — Human changes parameters, both logged

All overrides written to:
  - mes_manager_audit_log.override_by
  - mes_manager_audit_log.notes
  - pending-approvals.json (resolved)
```

### 7.3 Fallback Modes

| Mode | Trigger | Behavior |
|---|---|---|
| Rule-based fallback | Ornith unavailable > 3 cycles | Use hardcoded thresholds only, no LLM reasoning |
| Read-only mode | Any execution API fails | Query only, no state changes, log all actions to file |
| Digest-only mode | Patrol fails > 5 cycles | Skip patrol, run morning/evening digest from cached data |
| Offline mode | PostgreSQL unavailable | Queue decisions to file, replay when DB available |

---

## 8. Onboarding & Success Criteria

### 8.1 Week 1 — Baseline

- [ ] Successfully query all MES data scopes
- [ ] Complete 100 patrol cycles without crash
- [ ] Deliver 7 morning + 7 evening digests
- [ ] Achieve ≥ 90% Ornith parse rate
- [ ] Auto-execute ≥ 50 decisions

### 8.2 Month 1 — Trust Building

- [ ] Rolling 7-day accuracy ≥ 75%
- [ ] Human override rate ≤ 5%
- [ ] False alarm rate ≤ 5%
- [ ] ≤ 2 missed patrol cycles due to error
- [ ] At least 1 threshold optimization applied

### 8.3 Month 3 — Production Maturity

- [ ] Rolling 7-day accuracy ≥ 80%
- [ ] Human override rate ≤ 2%
- [ ] Auto-execution rate ≥ 90% of decisions
- [ ] Demonstrable OEE improvement ≥ 3%
- [ ] All 28 tasks operational and monitored
- [ ] ≤ 1 unplanned downtime incident due to AI error
