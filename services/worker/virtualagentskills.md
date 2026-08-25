# WMS AI Manager — Virtual Agent Skills

## Agent Profile

**Name**: WMS AI Manager (`仓库AI管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no data leaves factory)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Escalation**: LINE notifications for critical decisions; human-in-the-loop for high-stakes actions
**Memory**: Last-state JSON for delta detection between cycles
**Audit**: Every action logged with timestamp, operator, reason

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)  │
│  Every 30 min: patrol, iqc-check           │
│  07:30: morning digest to LINE              │
│  17:00: daily summary report               │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  wms-manager.js (Node.js)                  │
│  1. Query DB (wms-query.js)                │
│  2. Feed Ornith for reasoning              │
│  3. Parse decisions                        │
│  4. Execute via API or log                  │
│  5. Send LINE alerts                        │
└──────────────┬──────────────────────────────┘
               │
     ┌─────────┼──────────┐
     ▼         ▼          ▼
  PostgreSQL  Ornith     LINE API
  (data)    (reason)  (alerts)
```

---

## Core Skills

### Skill 1: IQC Decision Agent

**Trigger**: New `pending` lot detected, or 30-min patrol cycle

**Decision Matrix**:

| Supplier History | Defect Rate Found | Action |
|---|---|---|
| > 95% pass rate | < 3% | ✅ Auto-release |
| 80–95% pass rate | < 5% | ✅ Recommend release |
| 70–80% pass rate | 5–10% | 🟡 IQC_HOLD — flag for QA review |
| < 70% pass rate | > 10% | 🔴 IQC_REJECT — auto-NCR, LINE alert |
| First-time supplier | any | 🟡 IQC_HOLD — require manual sign-off |
| MSD expired | — | 🔴 IQC_REJECT — auto-return request |
| No COA/COC | — | 🔴 IQC_REJECT — reject at dock |

**Tool**: `POST /wms/transactions` with `{ action: "IQC_RELEASE"|"IQC_HOLD"|"IQC_REJECT", lotNo, qty, operator: "wms-ai" }`

**Data Sources**:
- `material_lots` (lot_no, iqc_status, received_at)
- `suppliers` (supplier_code, history defect rate)
- `quality_inspections` (defect rate per supplier)
- `materials` (msd_level, shelf_life_days)

---

### Skill 2: Inventory Patrol Agent

**Trigger**: Every 30 minutes + on-demand

**Checks**:

1. **Low Stock Detection**
   - Threshold: < 7 days of consumption (based on `issue_to_line` rate from `inventory_transactions`)
   - Critical: < 3 days
   - Action: 🟡 warning log → 🔴 LINE alert if critical
   - Query: `SUM(issue_qty) / days_active` per material

2. **Overstock Detection**
   - Threshold: > 90 days of consumption sitting idle
   - Action: 🟡 flag in daily report, suggest return-to-supplier

3. **Expiry / Shelf Life**
   - MSD exposed > 168h without baking → flag `baking_required`
   - Shelf life < 30 days remaining → highlight
   - Action: Auto LINE alert + create baking task

4. **Aging / No-Movement**
   - No transaction > 90 days → long-idle flag
   - Action: 🟡 include in weekly aging report

5. **Negative Stock Anomaly**
   - Any material with `approx_balance < 0` → immediate LINE alert
   - Indicates data entry error or untracked consumption
   - Action: Flag for warehouse manager investigation

**Tool**: `wms-query.js --scope wms-health` + Ornith analysis

---

### Skill 3: Pick Order Generator Agent

**Trigger**: When `work_orders.status = 'released'` detected in patrol

**Logic**:
```
FOR each released WO:
  1. Read BOM for the product
  2. FOR each BOM line (material):
     a. Find released lots by FIFO (earliest received first)
     b. Match to storage location
     c. Calculate picked_qty = qty_per × planned_qty × (1 + loss_rate)
  3. Generate pick order JSON
  4. If stock insufficient → flag shortage
  5. Post to API: POST /wms/transactions { action: "PICK", ... }
```

**Escalation**:
- If any material shortage: pause and LINE alert with shortage list
- If BOM missing: log warning, skip WO

**Tool**: `GET /wms/pick-orders?workOrderCode=` + `POST /wms/transactions { action: "PICK" }`

---

### Skill 4: Issue to Line Agent

**Trigger**: Pick order confirmed + warehouse operator confirmation

**Pre-flight Checks** (all must pass):

| Check | Pass Condition | Fail Action |
|---|---|---|
| IQC status | `released` | Block, LINE alert |
| MSD status | Not expired, baking done | Block, trigger bake |
| Quantity | Available ≥ required | Block, find alternative lot |
| Location | Valid storage location | Block, re-shelve first |
| Work Order | `released` status | Block, escalate |

**Execution**:
```
POST /wms/transactions {
  action: "ISSUE_TO_LINE",
  lotNo: "...",
  qty: ...,
  workOrderCode: "26061020007",
  operator: "wms-ai"
}
```

**Post-Issue**:
- Log `inventory_transaction` with `ISSUE_TO_LINE`
- Update `reserved_qty` on lot
- Trigger MES feeder binding suggestion in LINE

---

### Skill 5: Line Return Handler

**Trigger**: MES reports `RETURN_FROM_LINE` event

**Process**:
1. Scan returned lot, record `RETURN` transaction
2. Assess condition:
   - **Unopened reel** → return to stock (status = `released`, MSD timer preserved)
   - **Opened but usable** → return to stock, note partial qty
   - **Damaged** → `SCRAP` workflow
   - **Contaminated** → quarantine + LINE alert
3. Update `msd_exposure_start` if re-sealed
4. Log return reason (dropdown: `OVER_PRODUCTION`, `LINE_CANCEL`, `QUALITY_HOLD`, `MSD_EXPIRED`)

**Tool**: `POST /wms/transactions { action: "RETURN_FROM_LINE" }`

---

### Skill 6: Scrap Agent

**Trigger**: NG lot confirmed, or damaged return, or expired material

**Required Fields**:
- `lot_no` — material lot identifier
- `qty` — quantity being scrapped
- `reason_code` — dropdown: `DAMAGED`, `EXPIRED`, `CONTAMINATED`, `IQC_REJECTED`, `OVERAGE`
- `photo_url` — photo evidence (optional but logged)
- `operator` — scrap issuer

**Process**:
1. Create `SCRAP` transaction → deducts from inventory
2. Update lot `iqc_status = 'rejected'`
3. Create NCR record if IQC-rejected
4. LINE alert: 🔴 `[SCRAP ALERT] Lot {lot_no} | {material} | {qty}pcs | Reason: {reason}`
5. If > 5 items scrapped in one week → weekly scrap report to LINE

**Tool**: `POST /wms/transactions { action: "SCRAP" }` + `POST /api/lifecycle/scrapping`

---

### Skill 7: Put-Away Agent

**Trigger**: IQC release completed, or material transfer needed

**Logic**:
```
FOR each released lot awaiting put-away:
  1. Check storage location preferences (per material type):
     - MSD materials → MSD zone
     - Bulk components → RAW zone
     - Finished goods → GOOD zone
  2. Check location capacity
  3. Assign nearest available location with FIFO in mind
  4. Execute: POST /wms/transactions { action: "PUT_AWAY", toLocationCode: "SMT-1F-A01" }
```

**Tool**: `GET /wms/storage-locations` + `POST /wms/transactions { action: "PUT_AWAY" }`

---

### Skill 8: Receiving Advisor

**Trigger**: New delivery arrives at dock

**Advisory Checklist** (presented via LINE to receiving operator):

- [ ] Verify PO number matches ERP/ supplier delivery note
- [ ] Count and scan all reels/ packages — match against delivery note
- [ ] Check MSD packaging integrity (vacuum seal, humidity indicator)
- [ ] Verify COA/ COC present for each lot
- [ ] Check date code vs. shelf life requirement
- [ ] Flag any unlabeled reels for re-labeling before IQC
- [ ] Register in system via `POST /api/receiving`

**Tool**: `POST /api/receiving` + LINE notification to IQC team

---

### Skill 9: MSD (Moisture Sensitive Device) Guardian

**Trigger**: Any `RECEIVE` event + every 30-min patrol

**Lifecycle Tracking**:
```
Sealed → Opened (exposure starts) → [≤168h?] → [YES] → Bake required
                                          ↓ NO
                                       Can be issued to line
```

**Automated Actions**:
- On `RECEIVE`: record `msd_sealed_at` from barcode/ label scan
- On `ISSUE_TO_LINE`: check `NOW() - msd_exposure_start ≤ msd_level_hours`
  - If expired: BLOCK + LINE alert + create baking task
- On baking complete: reset `msd_exposure_start = NULL`, set `baking_required = false`

**Baking Task Format** (LINE message):
```
🔧 MSD BAKE REQUIRED
Lot: {lot_no}
Material: {material_name}
Exposure: {hours}h (limit: {limit}h)
Action: Bake 40°C / <5%RH for {duration}h
Location: MSD烤箱-01
```

**Tool**: `GET /material-lots` (filter `msd_level IS NOT NULL`) + `PATCH /api/lifecycle/...`

---

### Skill 10: Work Order Material Readiness

**Trigger**: 08:00 daily + when WO is released

**For each released WO**:
```
FOR each BOM line:
  Required = qty_per × planned_qty × (1 + loss_rate)
  Available = SUM(released lots qty - reserved_qty - picked_qty)

  IF Available >= Required:
    status = "READY" ✅
  ELSE:
    status = "SHORTAGE" ⚠️
    shortage_qty = Required - Available
```

**Readiness Dashboard** (LINE morning digest):
```
📋 工单物料齐套率 {date}
━━━━━━━━━━━━━━━━━━
WO: 26061020007 | 电机驱动IO板 | 72h内
  └ R-0603-10K-1: ✅ 10,000/8,000 (SMT-1F-B12)
  └ IC-MCU-RJ32: ⚠️ 2,000/5,000 SHORTAGE (HOLD区待判)
  └ CAP-0805-100N: ✅ 50,000/30,000 (RAW-C01)
━━━━━━━━━━━━━━━━━━
Overall: 2/3 ready | 1 SHORTAGE
```

**Tool**: `GET /pmc/work-orders` + `GET /wms/stock` + BOM join

---

### Skill 11: Supplier Quality Scorecard

**Trigger**: Weekly (every Monday 08:00) + on each IQC_REJECT

**Metrics Tracked**:
- Total lots received (rolling 90 days)
- Release rate: `released / total`
- Hold rate: `hold / total`
- Reject rate: `reject / total`
- Average IQC turnaround time (hours)
- MSD compliance rate

**Thresholds**:
| Metric | Green | Yellow | Red |
|---|---|---|---|
| Release rate | > 95% | 85–95% | < 85% |
| Reject rate | < 3% | 3–10% | > 10% |
| Avg IQC time | < 4h | 4–8h | > 8h |

**Output**: LINE weekly scorecard to PMC + Quality manager

---

### Skill 12: Alert & Escalation Manager

**Escalation Rules**:

| Severity | Trigger | Recipient | Channel |
|---|---|---|---|
| 🔴 CRITICAL | New NG lot (hold/reject) | Warehouse + QA + PMC manager | LINE (immediate) |
| 🔴 CRITICAL | MSD expired lot attempted to issue | Line supervisor + QA | LINE (immediate) |
| 🔴 CRITICAL | Negative stock detected | Warehouse manager | LINE (immediate) |
| 🟡 WARNING | Low stock (< 3 days) | Warehouse | LINE (daily digest) |
| 🟡 WARNING | WO material shortage | PMC | LINE (morning report) |
| 🟡 WARNING | IQC hold > 7 days | QA | LINE (weekly) |
| 🔵 INFO | New lot received | IQC team | LINE (as it happens) |
| 🔵 INFO | WO material 100% ready | PMC | LINE (morning report) |

**No LINE noise**: Debounce same alert for 24h unless severity increases.

---

### Skill 13: Daily WMS Digest

**Trigger**: 07:30 and 17:00 daily

**Morning (07:30) — Pre-Production Briefing**:
```
🌅 WMS晨报 {date}
━━━━━━━━━━━━━━━━━━
📦 库存概览
  待检: X批 | Hold: X批 | 已检验: X批

⚠️ 今日关注
  - VN-IC240619-01: MCU等待IQC判定(已3天)
  - R-0603-10K-1: 低库存预警(库存3.2天消耗量)
  - WO-26061030009: 物料齐套率78%

📋 今日待办
  - [ ] IQC检验: TEST-RCV-001 (5,000pcs)
  - [ ] 补料: IC-MCU-RJ32 需3,000pcs

✅ 产线发料计划
  - 08:00: WO-26061020007 → SMT-1F (已就绪)
```

**Tool**: Ornith analysis of last 24h data → formatted LINE message

---

### Skill 14: Receiving Advisor

**Trigger**: On delivery arrival notification

**Checklist** (LINE to receiving operator):
```
📦 来料接收清单
━━━━━━━━━━━━━━━━━━
PO: {po_number}
供应商: {supplier_name}
━━━━━━━━━━━━━━━━━━
□ 标签扫码验证 (lot_no, date code, qty)
□ MSD真空包装检查
□ COA/COC证书核对
□ 数量清点
□ 外观抽检 (5%抽样)
□ 录入系统
□ 送往IQC区
━━━━━━━━━━━━━━━━━━
```

---

### Skill 15: Auto-Improvement Loop

**Trigger**: After every patrol cycle (automated); on-demand via CLI

**Purpose**: Self-evaluate Ornith decisions using LLM-as-Judge, track accuracy, tune thresholds, document failure patterns

**Architecture**:

```
Patrol Cycle → Ornith Decision → Audit Log → Judge LLM Scoring → Performance Report
                                       ↓
                              Threshold Tuning
                                       ↓
                              Skill Behavior Update
                                       ↓
                              LINE Accuracy Digest
```

**Components**:

| Component | File | Role |
|---|---|---|
| Judge LLM | `wms-evaluator.js` | `qwen2.5:7b` scores recent Ornith decisions |
| Audit log | `wms_manager_audit` | Every Ornith decision + execution result |
| Feedback | Dashboard operator approves/rejects | Ground-truth labels |
| Threshold tuner | `wms-evaluator.js tune-thresholds` | Analyzes scored decisions → proposes new limits |
| Performance report | `wms-evaluator.js report --days N` | Accuracy metrics per decision type |

**Judge Rubric** (per decision type):

| Decision Type | Correct if... | Incorrect if... |
|---|---|---|
| `iqc_release` | Lot genuinely passed IQC; no defect signal | Lot had defect or supplier history issue |
| `iqc_hold` | Hold was justified; follow-up found real issue | Lot was clean; unnecessary delay |
| `iqc_reject` | Rejection warranted; safety/quality risk | False rejection; supplier dispute likely |
| `pick` | Correct lot + qty for the WO | Wrong lot, wrong qty, or premature pick |
| `put_away` | Correct storage location; follows zone rules | Stored in wrong zone or violated MSD placement |
| `issue_to_line` | WO needed the material; right qty/timing | WO didn't need it; overallocated |
| `return_to_line` | Return justified; material genuinely excess | Unnecessarily returned; disrupts production |
| `scrap` | Material genuinely unrecoverable | Salvageable material scrapped |

**Feedback Pipeline**:

1. Operator at `wms-dashboard.ps1` approves Ornith's recommendation → `wms-execute.js receive-feedback --feedback correct`
2. Operator rejects → `wms-execute.js receive-feedback --feedback incorrect`
3. Dashboard send-feedback calls `UPDATE wms_manager_audit SET feedback='correct|incorrect' WHERE lot_no=$1`

**Evaluator Commands**:

```bash
# Score recent unevaluated decisions (runs automatically after each patrol)
node wms-evaluator.js score-recent --limit 5

# Score all decisions from last N days
node wms-evaluator.js score-all --days 7

# Analyze patterns → propose threshold updates
node wms-evaluator.js tune-thresholds

# Generate performance report
node wms-evaluator.js report --days 7
```

**Accuracy Threshold**: 70%

- If rolling 7-day accuracy drops below 70%, system escalates via LINE
- All decisions for that type become `auto_execute=false` until root cause addressed

**Self-Improvement Rules**:

1. After 20+ scored decisions: run `tune-thresholds` to re-examine limits
2. If a specific decision type (e.g., `iqc_reject`) shows > 30% error rate: flag for human review
3. Feedback from dashboard is authoritative — Judge LLM scores are comparative, not absolute
4. Failure patterns documented in audit log `feedback` column for later analysis

**Metacognitive Learning** (3 components applied):

| Component | WMS Implementation |
|---|---|
| **Metacognitive Knowledge** | Every Ornith decision logged with full context: lot_no, supplier history, iqc_status, area, work_order, cycle_id |
| **Metacognitive Planning** | `tune-thresholds` analyzes which rules produced wrong outcomes → propose new thresholds for Skills 1-14 |
| **Metacognitive Evaluation** | Judge LLM scores decisions independently; accuracy trend tracked per decision type in weekly LINE digest |

**Known Failure Modes**:

| Failure | Symptom | Mitigation |
|---|---|---|
| Ornith hallucinates lot number | Audit log shows non-existent `lot_no` | `wms-execute.js` validates lot_no exists before `receive-feedback`; 409 = already correct status |
| Judge LLM is too lenient | Accuracy inflated | Use dashboard feedback as ground truth; Judge scores are secondary |
| Feedback not collected | Accuracy shows N/A | Dashboard integration (approve/reject → `receive-feedback`) now wired |
| Chinese path in batch wrappers | `schtasks /tr` fails with Chinese paths | 8.3 short path used in all batch wrappers |

---

### Skill 16: Visual Inspection Agent

**Trigger**: Receiving scan; IQC station camera; material reel label; on-demand from dashboard

**Vision LLM**: `minicpm-v4.5:8b` at `localhost:11434` (6.1GB, already available)

**Vision Tasks**:

| Task | Input | Detects |
|---|---|---|
| Reel count | Photo of SMD reel | Lot no, date code, label qty, estimated remaining pcs |
| Defect detection | Photo at IQC station | Bent pins, lifted leads, missing components, tombstoning |
| MSD seal integrity | Photo of bag seal | Seal broken, desiccant color (pink=wet), humidity indicator card |
| Label OCR | Photo of label | Lot no, supplier, qty, MSL level, date code |

**CLI**:
```bash
node vision-inspect.js reel    --image /path/to/reel.jpg
node vision-inspect.js defect  --image /path/to/iqc-photo.jpg
node vision-inspect.js msd    --image /path/to/bag-seal.jpg
node vision-inspect.js label   --image /path/to/label.jpg
node vision-inspect.js defect  --camera   # capture from webcam
node vision-inspect.js defect  --url http://192.168.1.100/capture.jpg  # IP camera
```

**Output** (JSON):
```json
{
  "task": "defect",
  "defect_found": true,
  "defect_type": "BENT_LEAD",
  "severity": "major",
  "recommendation": "IQC_HOLD",
  "confidence": 0.91,
  "_source": "file:C:/receiving/reel01.jpg",
  "_inspected_at": "2026-06-28T06:00:00Z"
}
```

**Integration**: Ornith `step_ornith` sets `needsVision: true` → SOP routes to `step_vision` → result appended to analysis and logged to `wms_manager_audit.vision_result`.

---

### Skill 17: Warning & Human Escalation System

**Trigger**: Ornith confidence < 80%; evaluator accuracy drops; patrol finds critical state

**Warning Levels**:

| Level | Ornith Conf. | Example | Timeout | Escalation |
|---|---|---|---|---|
| 🟢 INFO | > 80% | Normal patrol | — | Log only |
| 🟡 WARN | 60–80% | Low stock, borderline IQC | 4h | LINE to operator |
| 🟠 ALERT | 40–60% | IQC reject, MSD exceeded | 2h | LINE to supervisor |
| 🔴 CRITICAL | < 40% | Safety defect, debarment | 1h | LINE + call manager |
| ⛔ BLOCK | N/A | NCR open, supplier halted | 30min | Block all WOs using material |

**Escalation Workflow**:
```
Detection (any agent/skill) → classify severity → LINE alert → pending-approvals.json → human approves/rejects → execute + log feedback
```

**Auto-escalation**: No human response within timeout → escalate to next level. Rolling accuracy < 70% → all decisions require approval.

**LINE Message Format**:
```
🟠 [WMS 审批请求] #ALERT
━━━━━━━━━━━━━━━━━━
类型: IQC_HOLD
物料: 集成电路 IC / VN-BAD-xxx
供应商: 劣质电子 (历史拒收3批)
Ornith置信度: 58%
━━━━━━━━━━━━━━━━━━
AI建议: IQC_REJECT
操作员回复:
  ✅同意 → 执行REJECT
  ❌拒绝 → 说明原因
```

---

### Skill 18: Adaptive SOP & Live Workflow Agent

**Trigger**: Every patrol cycle; manager edits SOP via dashboard

**Files**:
- `wms-sop.json` — current SOP definition (versioned, manager-editable)
- `wms-sop-state.json` — live execution state: current step, cycle ID, lot no, history
- `wms-sop-manager.js` — engine: `loadSOP()`, `executeStep()`, `advanceToNext()`, `renderMermaid()`, `validateSOP()`

**SOP Step Types**:

| Type | Behavior |
|---|---|
| `QUERY` | Run external script, capture output |
| `LLM` | Call Ornith/judge LLM |
| `EXECUTE` | Call wms-execute.js handler |
| `BRANCH` | Evaluate condition → route to next step |
| `BRANCH_VISION` | Route to vision-inspect.js if `needsVision == true` |
| `EVALUATE` | Run wms-evaluator.js |
| `ESCALATION` | Classify severity, send alerts |
| `PENDING` | Save pending approvals queue |
| `LINE` | Send LINE notification |
| `SAVE_STATE` | Persist cycle state |
| `SCRIPT` | Run inline JS function |

**SOP JSON Schema** (`wms-sop.json`):
```json
{
  "version": "1.0.0",
  "updatedBy": "manager_zhang",
  "updatedAt": "2026-06-28T10:00:00Z",
  "steps": [
    {
      "id": "step_query",
      "name": "Query Database",
      "nameZh": "查询数据库",
      "type": "QUERY",
      "script": "services/worker/watchdog-query.js",
      "args": ["all"],
      "outputVar": "wmsData",
      "timeoutSec": 30,
      "onError": "ABORT",
      "next": "step_delta",
      "mermaid": { "icon": "1️⃣", "color": "#4CAF50" }
    },
    {
      "id": "step_ornith",
      "type": "LLM",
      "model": "ornith",
      "outputVar": "analysis",
      "timeoutSec": 120,
      "onError": "SKIP_TO step_audit",
      "next": "step_execute",
      "mermaid": { "icon": "3️⃣", "color": "#FFD700" }
    },
    {
      "id": "step_vision",
      "type": "BRANCH_VISION",
      "condition": "analysis.needsVision == true",
      "next": "step_execute",
      "mermaid": { "icon": "📷", "color": "#9C27B0" }
    },
    {
      "id": "step_execute",
      "type": "BRANCH",
      "branches": [
        { "condition": "analysis.iqc_decisions?.length > 0", "next": "step_iqc" },
        { "condition": "analysis.msd_alerts?.length > 0", "next": "step_msd" },
        { "condition": "analysis.issue_to_line?.length > 0", "next": "step_issue" }
      ],
      "defaultNext": "step_escalation"
    }
  ],
  "startStep": "step_query"
}
```

**Live Mermaid Diagram** (rendered in dashboard):
```mermaid
flowchart TD
    A([1️⃣ 查询数据库]) --> B([2️⃣ 变更检测])
    B --> C([3️⃣ Ornith分析])
    C --> D{[4️⃣ 执行分支]}
    D -->|"IQC"| E([🔨 执行IQC])
    D -->|"MSD"| F([⚠️ MSD])
    D -->|"ISSUE"| G([📦 发料])
    E --> I([🚨 升级判断])
    F --> I
    G --> I
    I --> J([5️⃣ 评分])
    J --> K([6️⃣ LINE])
    K --> L([💾 保存])

    style C fill:#FFD700,color:#000
    style E fill:#F44336,color:#fff
```

**Dashboard SOP Menu** (`wms-dashboard.ps1` → press `S`):
```
WMS SOP 管理器  v1.0.0  |  编辑者: manager_zhang

  1) 查看当前SOP流程图 (Mermaid)
  2) 查看当前执行状态 (实时)
  3) 查看执行历史 (最近10轮)
  4) 编辑步骤顺序 (重排next指针)
  5) 启用/禁用某步骤 (toggle)
  6) 修改步骤超时时间
  7) 保存并激活新SOP

Manager reorder: 输入 3,6 → 把第3步移到第6位
Manager toggle: 输入 step_msd → 禁用MSD步骤
```

**Manager Reorder Flow**:
```
当前顺序:
  [1] 1️⃣ 查询数据库
  [2] 2️⃣ 变更检测
  [3] 3️⃣ Ornith分析  ← 金色高亮(执行中)
  [4] 4️⃣ 执行分支
  [5] 🔨 执行IQC
  [6] 🚨 升级判断

输入格式: 3,6 → 把第3步移到第6位
输入格式: 3,0 → 删除第3步
```

**SOP State** (`wms-sop-state.json`):
```json
{
  "sopVersion": "1.0.0",
  "cycleId": "wc-mqxcdfza",
  "startedAt": "2026-06-28T05:22:30Z",
  "currentStepId": "step_iqc",
  "currentLotNo": "VN-BAD-xxx",
  "currentStepStartedAt": "2026-06-28T05:22:35Z",
  "history": [
    { "stepId": "step_query", "enteredAt": "...", "exitedAt": "...", "status": "OK" },
    { "stepId": "step_ornith", "enteredAt": "...", "exitedAt": "...", "status": "OK" }
  ],
  "stepHistoryMap": {
    "step_query": { "status": "OK", "durationMs": 160 },
    "step_ornith": { "status": "OK", "durationMs": 15394 }
  },
  "completed": false
}
```

**CLI**:
```bash
node wms-sop-manager.js run                   # Run patrol following SOP
node wms-sop-manager.js render-mermaid        # Output current Mermaid diagram
node wms-sop-manager.js state                 # Show live execution state
node wms-sop-manager.js history               # Show last 10 cycles
node wms-sop-manager.js validate              # Validate SOP JSON
node wms-sop-manager.js edit reorder step_ornith,6   # Move step
node wms-sop-manager.js edit toggle step_msd          # Disable step
node wms-sop-manager.js edit timeout step_ornith,180  # Change timeout
node wms-sop-manager.js edit save             # Save + activate new version
```

**SOP History**: Each completed cycle archived to `wms-sop-history/{cycleId}.json`.

**State persistence**: `wms-sop-state.json` written after every step. If manager saves new SOP mid-cycle, current cycle completes on old SOP; next cycle uses new SOP.

---

### Skill 19: PDA Receiving & Material Import

**Trigger**: Warehouse operator opens PDA app; scans barcode or captures camera image at receiving dock

**Purpose**: Record incoming material deliveries via barcode scan + camera photo, trigger IQC queue, match against PO, print label

**PDA Receiving Workflow**:
```
1. 扫描PO/供应商条码 → 验证PO存在
2. 扫描物料条码 (lot_no) → 读取标签数据
3. 摄像头拍摄 → 自动OCR识别lot_no、date code、qty
4. 人工确认数量 + MSD检查
5. 打印接收标签 → 贴在物料上
6. 系统记录 → material_lots (iqc_status=pending)
7. 自动触发 → IQC队列 + Ornith分析
```

**CLI Commands**:
```bash
# Scan barcode (USB scanner connected)
node pda-receiving.js scan --po PO-2024-001 --lotno VN-LOT-001 --qty 500

# Camera capture + OCR
node pda-receiving.js camera --po PO-2024-001

# Print receiving label
node pda-receiving.js print-label --lotno VN-LOT-001 --printer "Zebra-ZD420"

# Complete receiving (commit to DB)
node pda-receiving.js receive --po PO-2024-001 --lotno VN-LOT-001 --qty 500 --camera /path/to/label.jpg
```

**CLI Output**:
```json
{
  "ok": true,
  "lot_no": "VN-LOT-001",
  "iqc_status": "pending",
  "material": "集成电路 IC",
  "supplier": "深越电子",
  "received_qty": 500,
  "iqc_queue_position": 3,
  "recommended_action": "IQC_HOLD (first-time supplier)",
  "label_printed": true,
  "cycle_id": "wc-mqxcdfza"
}
```

---

### Skill 20: PDA IQC Inspection

**Trigger**: IQC operator opens PDA; scans material lot barcode; performs inspection

**Purpose**: Record IQC results (pass/fail/hold), capture defect photos, trigger disposition

**PDA IQC Workflow**:
```
1. 扫描lot_no条码 → 查找物料信息 + 供应商历史
2. 人工录入: 抽检数量、缺陷数量、缺陷类型
3. 摄像头拍摄缺陷位置照片
4. 系统计算: defect rate → 对照供应商质量阈值
5. 自动判定: PASS / HOLD / REJECT
6. 如需NCR: 自动创建NCR单
7. 拍照存档 → 审计追溯
```

**CLI Commands**:
```bash
# Record IQC result
node pda-iqc.js inspect --lotno VN-LOT-001 --sample 50 --defects 2 --type MISSING_COMP --notes "引脚缺失"

# Capture defect photo
node pda-iqc.js photo --lotno VN-LOT-001 --defect-type BENT_LEAD --camera

# Auto-decide (let Ornith recommend)
node pda-iqc.js decide --lotno VN-LOT-001 --camera

# Override IQC result (supervisor)
node pda-iqc.js override --lotno VN-LOT-001 --action RELEASE --reason "特采审批通过" --by supervisor_wang
```

**IQC Decision Rules**:
```javascript
const SUPPLIER_THRESHOLDS = {
  PASS_RATE: { excellent: 0.95, good: 0.80, borderline: 0.70, poor: 0.0 },
  DEFECT_RATE: { excellent: 0.03, good: 0.05, borderline: 0.10, poor: 1.0 },
};

function iqcDecide(supplierHistory, defectRate, msdStatus, firstTimeSupplier) {
  if (firstTimeSupplier)     return { action: "IQC_HOLD", auto: false, reason: "首件验证" };
  if (msdStatus === "expired") return { action: "IQC_REJECT", auto: true, reason: "MSD超限" };
  if (defectRate > 0.10)     return { action: "IQC_REJECT", auto: true, reason: "缺陷率过高" };
  if (defectRate > 0.05)     return { action: "IQC_HOLD", auto: false, reason: "缺陷率偏高" };
  if (defectRate <= 0.03)    return { action: "IQC_RELEASE", auto: true, reason: "缺陷率合格" };
  return { action: "IQC_HOLD", auto: false, reason: "需人工评审" };
}
```

---

### Skill 21: PDA Inspection History & Charts

**Trigger**: User opens PDA Inspection History tab; periodic quality trend analysis

**Purpose**: Visualize all PDA receiving and IQC inspection records with charts, filters, and drill-down detail for quality audit and trend analysis

**Data Source**: `pda_inspection_records` table (PostgreSQL) — all PDA receiving + IQC results logged with timestamps, operator, decision

**Web UI**: `WmsPdaHistory.tsx` at `apps/web/src/wms/`

**Features**:
- Summary cards: total inspections, pass/hold/reject rates, receiving count
- Filter by record type (Receiving / IQC), decision (PASS / HOLD / REJECT / RECEIVED), lot no / material / supplier
- Pie chart: decision distribution (PASS vs HOLD vs REJECT)
- Bar chart: defect type frequency (BENT_LEAD, MISSING_COMP, TOMBSTONE, etc.)
- Trend line chart: pass/fail rate over time (daily aggregation)
- Expandable detail rows for each record — shows supplier, qty, MSD level, sample size, defect rate, severity, Ornith confidence, notes, photos
- Export-ready data grid with all historical PDA inspection records

**DB Table**:
```sql
create table pda_inspection_records (
  id bigserial primary key,
  record_type varchar(20) not null,          -- 'RECEIVING' | 'IQC'
  lot_no varchar(80) not null,
  material_code varchar(80),
  material_name_zh varchar(160),
  supplier_code varchar(60),
  supplier_name_zh varchar(160),
  received_qty numeric(18, 4),
  po_no varchar(80),
  date_code varchar(40),
  msd_level varchar(10),
  sample_size integer,
  defect_count integer,
  defect_type varchar(40),
  defect_severity varchar(20),
  defect_rate numeric(8, 4),
  defect_photo_url text,
  inspection_notes text,
  decision varchar(20),                      -- 'PASS' | 'HOLD' | 'REJECT'
  decision_by varchar(20),                   -- 'AUTO' | 'OPERATOR'
  ornith_confidence numeric(5, 3),
  operator_name varchar(120),
  recorded_at timestamptz not null default now()
);
```

**Charts (inline SVG — no external library required)**:
- `PieChartSvg` — decision distribution
- `BarChartSvg` — defect type frequency
- `TrendChartSvg` — pass/fail rate over time (daily)

**API Endpoints**:
```
GET  /wms/pda-inspection-records    — list with filters (recordType, lotNo, decision, date range)
POST /wms/pda-inspection-records    — create record from PDA commit
```

**PDA Save Flow** (both receiving and IQC):
```
PDA page commit → wmsApi.createPdaInspectionRecord() → POST /api → pda_inspection_records INSERT
```

---

## Task Schedule

| Time | Agent | Action |
|---|---|---|
| 07:00 | Receiving Advisor | Check expected deliveries, alert receiving team |
| 07:30 | WMS Digest | Morning briefing to LINE |
| 08:00 | WO Readiness | Check all released WOs, flag shortages |
| 08:30 | IQC Patrol | Check pending lots, trigger IQC for stale lots |
| 09:00 | MSD Guardian | Check exposed lots approaching limit |
| 10:00 | Inventory Patrol | Low stock, overstock, aging |
| 12:00 | Inventory Patrol | Mid-day status update |
| 14:00 | WO Readiness | Re-check WO status for afternoon |
| 15:00 | MSD Guardian | Final MSD check before SMT changeover |
| 16:30 | Put-Away Agent | Ensure all released lots are put away |
| 17:00 | WMS Digest | End-of-day summary to LINE |
| 17:30 | Supplier Scorecard | (Mondays only) Weekly quality to LINE |
| Every 30min | IQC Patrol | New NG detection, LINE alert if critical |

---

## AI Prompt Template

Every Ornith analysis uses this structured prompt:

```
## WMS AI Manager — Analysis Request

Factory data snapshot — {timestamp}

<WORK_ORDERS>
{json}
</WORK_ORDERS>

<IQC_LOTS>
{json}
</IQC_LOTS>

<INVENTORY>
{json}
</INVENTORY>

<RECENT_TRANSACTIONS>
{json}
</RECENT_TRANSACTIONS>

Context: You are a WMS AI Manager for a Vietnam SMT factory.
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [
    {{
      "severity": "critical|warning|info",
      "area": "iqc|wo|wms|quality|msd",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动",
      "lot_no": "批次号（如适用）",
      "urgency": "immediate|24h|this_week"
    }}
  ],
  "iqc_decisions": [
    {{
      "lot_no": "",
      "action": "IQC_RELEASE|IQC_HOLD|IQC_REJECT",
      "reason": "判定原因",
      "auto_execute": true|false
    }}
  ],
  "pick_orders": [
    {{
      "work_order_code": "",
      "items": [
        {{"material_code": "", "lot_no": "", "qty": 0, "location": ""}}
      ],
      "shortages": ["物料代码（如有）"]
    }}
  ],
  "msd_alerts": [
    {{
      "lot_no": "",
      "material": "",
      "exposed_hours": 0,
      "limit_hours": 0,
      "action": "BAKE|BLOCK|RELEASE"
    }}
  ],
  "summary": "一句话总结当前工厂状态"
}}
</ANALYSIS>
```

---

## Tool Reference

### wms-query.js
```
node wms-query.js [scope]
  scope: iqc-ng | work-orders | wms-health | quality | all
```

### API Endpoints Used
| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/wms/material-lots` | JWT | IQC status |
| GET | `/wms/storage-locations` | JWT | Location list |
| GET | `/wms/stock` | JWT | Inventory balance |
| GET | `/wms/inventory-transactions` | JWT | TX history |
| GET | `/wms/pick-orders` | JWT | BOM pick list |
| POST | `/wms/transactions` | JWT | All WMS actions |
| POST | `/api/receiving` | JWT | New lot registration |
| GET | `/api/receiving/queue` | JWT | Pending lots |
| GET | `/pmc/work-orders` | JWT | WO status |
| PATCH | `/api/lifecycle/scrapping/:id` | JWT | Scrap approval |

### LINE Integration
- Token stored in `services/worker/line_token.txt`
- Endpoint: `https://notify-api.line.me/api/notify`
- Method: POST with `message` field
- Debounce: Same message not re-sent within 24h unless severity increased

---

## Data Retention & Audit

- All AI decisions stored in `wms_manager_audit_log` table
- Schema: `id, timestamp, agent, area, decision_type, lot_no, input_data, output_decision, executed, executor, line_alert_sent, notes`
- Retention: 2 years
- Human can override any decision — override logged with `override_by` field

---

## Known Limitations

1. **No vision**: Cannot inspect physical reels — rely on barcode/ label data only
2. **No electronic scale**: Quantity verified by count only
3. **No live MES integration**: Work order completion not auto-synced — patrol fills gap
4. **BOM dependency**: Pick orders require active BOM; missing BOM = cannot generate
5. **Single language**: Ornith prompt in Chinese; LINE output in Chinese; VT/VN staff need translation layer
6. **Offline Ornith**: If Ollama is down, system falls back to rule-based decisions only (no LLM reasoning)
7. **No AMR/AGV integration**: Physical material movement still manual
---

## BOM AI Manager 鈥?Virtual Agent Skills

### Skill Entry

**Name**: BOM AI Manager (BOM绠＄悊鍛榒)
**Skill File**: om-manager-skill.md
**Model**: Ornith-1.0-9B (local, privacy-first) + OpenCode (code execution)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Scope**: BOM lifecycle, work order portal decisions (normal/abnormal), ERP integration, cost analysis, change control, reporting

### Skills Summary

| # | Skill | Purpose |
|---|---|---|
| 1 | BOM Creation & Maintenance | Create, update, validate BOMs (EBOM/MBOM/SBOM) |
| 2 | Work Order from BOM | Generate WOs from BOM explosion, check material readiness |
| 3 | Material Shortage Agent | Detect shortages, excess, shelf-life risk; suggest substitutes |
| 4 | BOM Change Management (ECO) | Manage engineering change orders with approval workflow |
| 5 | BOM Cost & Pricing | Multi-level cost roll-up, make vs buy analysis |
| 6 | BOM Accuracy & Audit | Detect orphan/phantom/duplicate BOMs; track accuracy rate |
| 7 | Production Planning & Scheduling | MRP net-change logic from BOM explosion |
| 8 | WO Status & Tracking | Patrol active WOs, flag overdue, update progress |
| 9 | BOM Report Generator | Daily digest (LINE 07:30/17:00), weekly health report |
| 10 | Supplier BOM Coordination | Compare supplier BOM vs internal EBOM, manage alternates |

### AI Integration

- **Analysis**: Ornith-1.0-9B via ornith-watchdog.ps1
- **Code/File ops**: OpenCode (virtualagentskills.md configured with execution: "opencode+ornith")
- **Execution**: PowerShell (Invoke-BOMCheck.ps1, Invoke-PDACheck.ps1, Invoke-SOPCheck.ps1, Invoke-Patrol.ps1, Invoke-MorningDigest.ps1, Invoke-AutoImprove.ps1)
- **DB queries**: `bom-query.js [scope]` — bom-list, bom-detail, bom-explode, bom-audit, bom-cost, wo-status, material-readiness, eco-list, bom-health
- **Action execution**: `bom-execute.js <action>` — wo-decide, bom-create, bom-update, eco-create, eco-approve, cost-rollup, shortage-check, audit-bom, patrol, morning-digest
- **Auto-improvement**: `bom-auto-improvement.js run|suggest|cost-optimize|substitute|merge-suggestions`
- **PDA Receiving**: `pda-receiving.js scan|receive|short-ship|close|status`
- **PDA IQC**: `pda-iqc.js check|record|verdict|history`
- **Managed workflow**: `bom-manager.js [--watchdog|--once|--health]`
- **API**: /bom, /eco, /pmc/work-orders, /wms/stock, /mrp/suggestions

### Escalation

- LINE alerts for: critical shortages (< 80%), BOM cost delta > 5%, overdue WOs, ECO approvals pending > 24h
- Human-in-the-loop for: BOM deletions, ECO with safety implications, BOMs affecting > 5 active WOs

---

## PMC AI Manager — Virtual Agent Skills

### Agent Profile

**Name**: PMC AI Manager (`PMC计划管理员`)
**Model**: Ornith-1.0-9B (local Ollama) + OpenCode (code execution)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Scope**: Master Production Schedule (MPS), Material Requirements Planning (MRP), production planning and scheduling, capacity analysis, inventory control, delivery management, cross-department coordination, KPI monitoring

### Skills Summary

| # | Skill | Purpose |
|---|---|---|
| 1 | Master Production Schedule (MPS) | Create and maintain MPS aligned with customer demand and capacity |
| 2 | MRP Execution | Run MRP calculations based on BOM explosion to generate material requirements |
| 3 | Production Order Scheduling | Sequence and release production orders; monitor WIP progress |
| 4 | Capacity Planning & Analysis | Assess line/machine capacity utilization; identify bottlenecks |
| 5 | Kit Readiness / Shortage Detection | Monitor kit completeness; flag shortages; trigger expedite |
| 6 | Supplier Delivery Tracking | Track imported/local material ETA; coordinate with procurement |
| 7 | Customer PO / Delivery Management | Match WO progress to PO due dates; flag delays |
| 8 | Inventory Health Monitoring | Track WIP, safety stock, excess, and obsolete inventory |
| 9 | KPI Reporting | OTD, Schedule Attainment, Inventory Turnover, WO Completion Rate |
| 10 | Engineering Change Coordination | ECO impact on MPS and open WOs; notify affected parties |
| 11 | Cross-department Coordination | Align with Production, Engineering, Purchasing, Warehouse, QA |
| 12 | AI Agent Integration | Coordinate with WMS Manager, BOM Manager, Reports Manager |

### Core Responsibilities

#### 1. Master Production Schedule (MPS)
- Develop and maintain MPS based on confirmed customer POs and demand forecasts
- Balance production capacity against demand to avoid overloading or under-loading lines
- Update MPS in real-time as POs change, WOs complete, or new orders arrive
- Provide visibility into future production load per line per week

#### 2. MRP Execution
- Execute MRP based on BOM explosion from confirmed WO quantities
- Generate material requirements taking into account: current stock, on-order quantities, lead times, safety stock
- Run MRP with both forward and backward scheduling logic
- Recommend purchase requisitions or WO creation to fill gaps
- Support multi-level BOM explosion for multi-level products (PCBA → sub-assembly → box build)

#### 3. Production Order Scheduling
- Sequence production orders across all SMT lines and assembly stations
- Coordinate with Production to set realistic cycle time targets
- Monitor WIP: flag WOs that are behind schedule or stuck in queue
- Trigger re-scheduling when: material shortages occur, urgent POs arrive, line breakdowns happen
- Publish weekly/daily production schedule to all lines

#### 4. Capacity Planning
- Analyze current and projected capacity per production line, per shift
- Calculate OEE, line utilization rate, and machine loading
- Identify bottlenecks (e.g., SMT feeder limitation, DIP station bottleneck)
- Provide capacity simulation for "what-if" scenarios: adding new PO, line shutdown impact
- Coordinate with Maintenance Manager to plan preventive maintenance during low-load windows

#### 5. Kit Readiness / Shortage Detection
- Maintain kit completeness check for every WO before release
- Flag materials with insufficient quantity, pending IQC, or on hold
- Trigger "shortage WO" escalation to Purchasing and WMS Manager
- Suggest alternative materials or substitute BOM items when shortages occur
- Monitor long-lead-time items and MSL-sensitive components

#### 6. Supplier Delivery Tracking
- Track order status for imported materials (lead times, shipping dates, customs clearance)
- Coordinate phased delivery schedules with trading partners
- Alert when material arrival will miss WO start date
- Work with WMS Manager on receiving priority for critical materials

#### 7. Customer PO / Delivery Management
- Match WO progress against customer PO due dates
- Calculate OTIF (On Time In Full) for open orders
- Alert Sales/Customer Service when delivery is at risk
- Coordinate with QA for OQC release to meet ship dates
- Publish delivery status reports to stakeholders

#### 8. Inventory Health
- Monitor WIP levels at each production stage
- Flag excess inventory (overstock) and initiate disposition
- Track obsolete inventory and lead monthly review
- Maintain inventory turnover targets (target: 8-12x per year for electronics)
- Coordinate with WMS Manager on physical inventory and cycle count results

#### 9. KPI Reporting
- Track and report: On-Time Delivery Rate (OTD ≥ 95%), Schedule Attainment (≥ 90%), Inventory Turnover, Schedule Adherence
- Weekly and monthly KPI reports distributed via LINE/email
- Trend analysis with root cause identification
- CAPA tracking for missed targets

#### 10. ECO Coordination
- When ECO is approved, assess impact on: in-progress WOs, open POs, material excess
- Recommend WO hold, rework, or re-start based on ECO scope
- Coordinate with BOM Manager on BOM version switching
- Notify customers if delivery impact from ECO

#### 11. Cross-Department Coordination
- **Production**: Schedule alignment, line readiness, bottleneck resolution
- **Engineering**: BOM changes, ECO impact, technical issues on line
- **Purchasing**: Material expedite, supplier delays, delivery changes
- **Warehouse (WMS Manager)**: Material availability, storage location, picking priority
- **QA**: IQC release speed, OQC hold, quality escape impact on delivery
- **Sales/Customer Service**: Delivery status, PO changes, forecast accuracy

#### 12. AI Agent Collaboration
- Request WMS Manager to check inventory availability before scheduling WO
- Request BOM Manager to validate BOM version before WO release
- Request Reports Manager to generate production performance analytics
- Delegate equipment maintenance windows to Maintenance Manager
- Alert WMS Manager when shortage risks require emergency receiving

### AI Integration

- **Analysis**: Ornith-1.0-9B via local Ollama (privacy-first, no customer data leaves factory)
- **Code/File ops**: OpenCode execution
- **Execution scripts**: pmc-query.js, pmc-execute.js, pmc-manager.js
- **PowerShell**: Invoke-PMCCheck.ps1 (scheduled patrol), Invoke-PMCDigest.ps1 (morning digest)
- **DB queries** — pmc-query.js scopes:
  - `wo-list` — all work orders with status, planned/completed qty
  - `wo-detail` — single WO with full routing, material, and production data
  - `wo-progress` — WIP tracking: completed vs planned per station
  - `mps-view` — master schedule: demand vs capacity per line per week
  - `mrp-result` — MRP explosion output: material requirements vs availability
  - `capacity-analysis` — line utilization, OEE, bottleneck analysis
  - `kit-readiness` — kit completeness per WO before release
  - `shortage-list` — materials with insufficient qty for open WOs
  - `delivery-status` — PO vs WO progress, OTIF calculation
  - `inventory-health` — WIP, excess, obsolete, turnover metrics
  - `supplier-tracking` — in-transit and on-order material ETAs
  - `pmc-kpi` — OTD, schedule attainment, inventory turnover
- **Action execution** — pmc-execute.js actions:
  - `wo-schedule` — sequence and release WOs based on MPS
  - `wo-reschedule` — adjust WO dates due to material/line changes
  - `wo-hold` — hold WO pending material or ECO resolution
  - `wo-release` — force release WO (override kit check)
  - `mrp-run` — execute MRP for specified date range and products
  - `kit-check` — check kit completeness for WO before release
  - `shortage-escalate` — escalate shortage to Purchasing + WMS Manager
  - `capacity-simulate` — run what-if capacity scenarios
  - `delivery-alert` — notify Sales of at-risk deliveries
  - `mps-update` — update MPS based on new PO or forecast change
  - `pmc-digest` — daily LINE digest: WO status, shortages, delivery risk

### KPI Targets

| KPI | Target | Threshold |
|---|---|---|
| On-Time Delivery (OTD) | ≥ 95% | < 90% → escalate |
| Schedule Attainment | ≥ 90% | < 85% → escalate |
| WO Completion Rate | ≥ 92% | < 88% → escalate |
| Kit Readiness at Release | 100% | < 100% → hold WO |
| Inventory Turnover | 8-12x/year | < 6x → review excess |
| OEE (Overall) | ≥ 85% | < 75% → investigate |
| Schedule Adherence | ≥ 93% | < 88% → CAPA |
| Delivery Accuracy (OTIF) | ≥ 96% | < 92% → escalate |
| WO Cycle Time Variance | ≤ 10% | > 20% → review |

### Tools & Systems

| System | Role |
|---|---|
| PostgreSQL (DB) | WO master data, BOM, production transactions, inventory |
| ERP (SAP/Oracle/Odoo) | MPS, MRP, PO management |
| MES | Real-time WIP tracking, station events, OEE |
| WMS | Inventory levels, receiving, picking |
| QMS | Quality holds, IQC status, OQC release |
| Excel/BI | Ad-hoc planning analysis, capacity simulation |
| LINE | Escalation alerts, daily digest to team |
| PowerShell | Scripted patrol, MRP runs, digest generation |
| Node.js | DB query API for PMC dashboard |

### Escalation Rules

**Auto-escalate to LINE group if:**
- OTD drops below 90% for any active PO
- Kit readiness < 100% for WO start date < 48 hours
- Material shortage will delay WO by > 1 day — flag Purchasing + WMS Manager
- Line breakdown + no backup capacity available — flag Maintenance Manager
- ECO approved impacting > 3 active WOs — flag Engineering + BOM Manager
- Supplier delivery delay > 3 days for critical component — flag Purchasing
- Schedule attainment < 80% for 3 consecutive days — escalate to plant manager

**Human-in-the-loop required for:**
- MPS change affecting > 10 WOs or > 30% of weekly output
- WO cancellation with > 50 units already in WIP
- Creating expediting order outside normal PO cycle
- Disposition decision for obsolete inventory > $10K value
- Customer PO cancellation or date move with delivery impact

### Analysis Request Format

```
Context: You are a PMC AI Manager for a Vietnam SMT factory.
[Brief description of current production situation, e.g., new customer PO received, line breakdown, shortage alert]

Task: [Specific analysis needed, e.g., assess feasibility of adding 500-unit PO to Week 28 MPS]
Data available: [WO list, BOM, inventory snapshot — refer to pmc-query results]
Constraints: [Capacity limit, material window, customer delivery date]

Please analyze:
1. [Question 1]
2. [Question 2]
3. Recommendation / Action plan
```

### Decision Rules

| Situation | Decision |
|---|---|
| Kit < 100% at WO-24h | Hold WO; escalate to WMS Manager + Purchasing |
| Capacity utilization > 95% | Re-schedule lower-priority WO or request overtime |
| Shortage for long-lead item > 4 weeks | Request expedite; consider partial kit release |
| OTD risk > 5 days | Escalate to Sales + customer; propose alternative ship date |
| ECO impact on released WO | Compare ECO scope; recommend hold/rework/new WO |
| Excess inventory > 6 months | Flag to Finance; initiate EOL/obsolete process |
| Supplier delay + no safety stock | Source alternate supplier or use express freight |
| MRP suggests PO qty > 2x normal | Validate with Engineering + Sales before issuing |
| Schedule change > 20% weekly output | Require manager approval before executing |

---

## AGV AI Manager — Virtual Agent Skills

### Agent Profile

**Name**: AGV AI Manager (`AGV车队管理员`)
**Model**: Ornith-1.0-9B (local Ollama, no fleet data leaves factory)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Scope**: AGV fleet coordination, task dispatch, charging management, material transport automation, fleet health monitoring
**Navigation**: Free navigation (Laser SLAM / LIDAR) — no floor infrastructure needed
**Fleet Types**: 潜伏式 (under-shelf shuttle) + 叉式 (forklift)

### Architecture

```
PostgreSQL (AGV fleet + tasks + positions)
       │
       ▼
mes-query.js  ← fleet, tasks, positions, stations, kpi, all
       │
       ▼
mes-manager.js  ← Ornith analysis, task dispatch decisions
       │
       ▼
mes-execute.js  ← agv-dispatch, agv-return, agv-pause, agv-resume, agv-task-complete, agv-charge
       │
       ├──► AGV Fleet API (REST) — dispatch commands
       ├──► LINE Notify — alerts and digests
       └──► Agent Bus ──► WMS (material_arrived)
                        ──► PMC (kit_delivered)
                        ──► HR  (agv_incident)
```

### DB Tables

| Table | Purpose |
|---|---|
| `agv_zones` | Zone map with coordinates |
| `agv_stations` | Stations (loading, unloading, charging) |
| `agv_fleet` | AGV status, battery, position |
| `agv_tasks` | Task queue (pending → dispatched → completed) |
| `agv_task_history` | Completed task archive |
| `agv_positions` | Position log (x, y, heading, zone) |
| `agv_alerts` | Low battery, stuck, collision, error |
| `agv_charging_log` | Charging session start/end, battery delta |

### Skills Summary

| # | Skill | Purpose |
|---|---|---|
| 1 | Fleet Health Monitor | Patrol battery, status, position; alert on low battery, stuck, offline |
| 2 | Task Dispatch Agent | Assign pending tasks to best-fit AGV by type, battery, proximity |
| 3 | Auto-Charge Agent | Detect low battery → auto-route AGV to nearest charging station |
| 4 | Material Transport Agent | Receive kit_delivery_request → dispatch AGV for material delivery |
| 5 | Station Block Management | Block/unblock stations during maintenance; reroute AGVs |
| 6 | Morning Digest | 07:30 LINE: fleet status, task queue, KPI summary |
| 7 | Incident Reporter | Log AGV stuck/collision → notify HR for human intervention |
| 8 | Task Completion Handler | Auto-complete docked task → notify WMS material_arrived + PMC kit_delivered |

### Core Skills

#### Skill 1: Fleet Health Monitor

**Trigger**: Every 30 min patrol + on-demand via `Invoke-AGVCheck.ps1`

**Checks**:
- Battery ≤ low_battery_threshold → auto-charge dispatch
- Status = `offline` → LINE alert + mark for human check
- Status = `error` → LINE alert with AGV code
- Task pending > 30 min → flag task backlog
- Charging session > 60 min → check if stuck at station

**CLI**: `node mes-query.js agv-fleet` + `node mes-query.js agv-tasks` + `node mes-query.js agv-kpi`

#### Skill 2: Task Dispatch Agent

**Trigger**: New `kit_delivery_request` from PMC, or `pending` task in queue

**Dispatch Logic**:
1. Filter AGVs by: `status IN (idle, busy) AND battery_pct > low_battery_threshold + 10`
2. Match by AGV type: shuttle → reel/pallet tasks; forklift → heavy/pallet tasks
3. Pick nearest AGV by Euclidean distance to `from_zone`
4. Execute: `node mes-execute.js agv-dispatch --task-id=N`

**Outbound**: `MES → AGV` via REST API; fallback to DB update + LINE alert

#### Skill 3: Auto-Charge Agent

**Trigger**: `handleAgvLowBattery` (bus message) OR battery drops below threshold after task complete

**Flow**:
1. Find nearest `charging` type station from `agv_stations`
2. Create `return_charging` task
3. Execute: `node mes-execute.js agv-return --agv <code>`
4. Log to `agv_charging_log` on charge start
5. LINE notification: `[AGV低电量] AGV-X 电量 20% — 已安排回桩充电`

#### Skill 4: Material Transport Agent

**Trigger**: PMC sends `kit_delivery_request` via agent bus

**Payload**:
```json
{
  "request_id": "kit-abc123",
  "work_order_code": "26061020007",
  "line_code": "SMT-1F",
  "destination_station": "ST-UNLOAD-SMT1",
  "material_codes": ["IC-MCU-RJ32", "R-0603-10K-1"],
  "priority": "urgent"
}
```

**Flow**:
1. Ornith validates WO and material readiness
2. Create `agv_tasks` record (or find existing pending)
3. Dispatch to best AGV
4. On `agv_docked` event → check task completion
5. Notify WMS: `material_arrived` (lot, station, zone)
6. Notify PMC: `kit_delivered` (WO, station)

#### Skill 5: Station Block Management

**Trigger**: MES line maintenance event OR manual operator command

**Actions**:
- `informAgvStationBlock(zoneCode, stationCode, reason, durationMin)` → AGV skips this station
- AGV pathfinding should avoid blocked zones

#### Skill 6: Morning Digest

**Trigger**: 07:30 daily via `Invoke-AGVDigest.ps1`

**LINE Output**:
```
==========================================
  AGV 车队晨间简报  2026-06-29 07:30
==========================================

【车队状态】
  总计: 4  空闲: 2  作业: 1  充电: 0  维护: 1
  潜伏式: 2  叉式: 2
  低电量: 1 — AGV-S01 15%（需充电）

【任务队列】
  待派: 3  执行中: 1  完成: 12  失败: 0
  当前作业:
    AGV-T00005 material_delivery AGV-S02
  待派任务（TOP5）:
    P1 AGV-T00007 reel_supply WH-A → SMT-1

【30日KPI】
  完成率: 97.5%  完成: 128  失败: 3
  平均电量消耗: 8.2%/趟
  充电次数: 45  平均充电时长: 38m
==========================================
```

#### Skill 7: Incident Reporter

**Trigger**: `handleAgvStuck` (AGV blocked > 5 min)

**Flow**:
1. AGV sends `agv_stuck` message with location, reason, duration
2. MES logs to audit + LINE alert
3. MES → HR: `informAgvIncident(agvCode, incidentType, detail, severity)`
4. HR creates human intervention ticket

#### Skill 8: Task Completion Handler

**Trigger**: `handleAgvDocked` (AGV reached destination)

**Flow**:
1. Check if `task_id` exists and `to_zone` matches
2. Execute: `node mes-execute.js agv-task-complete --task-id=N`
3. MES → WMS: `sendAgentMessage("wms-ai", "material_arrived", {...})`
4. MES → PMC: `sendAgentMessage("pmc-ai", "kit_delivered", {...})`
5. Check battery → auto-route to charging if low

### AI Integration

- **Analysis**: Ornith-1.0-9B via local Ollama
- **DB queries**: `mes-query.js` — agv-fleet, agv-tasks, agv-positions, agv-stations, agv-kpi, agv-all
- **Action execution**: `mes-execute.js` — agv-dispatch, agv-return, agv-pause, agv-resume, agv-task-complete, agv-charge
- **AGV REST API**: `services/api/agv-api.js` — command queue + device endpoints (port 8081)
- **Patrol**: `Invoke-AGVCheck.ps1` (every 30 min)
- **Digest**: `Invoke-AGVDigest.ps1` (07:30 daily)

### AGV REST API (`agv-api.js`)

AGV devices communicate with MES via this Express API (port 8081). MES enqueues commands; AGVs poll `GET /agv/commands`.

**Startup**: `node services/api/agv-api.js`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/token` | device_code + secret | Get JWT for device |
| `POST` | `/agv/heartbeat` | Bearer JWT | AGV alive signal |
| `POST` | `/agv/status` | Bearer JWT | Status + position update |
| `POST` | `/agv/task-event` | Bearer JWT | Task lifecycle events |
| `POST` | `/agv/alert` | Bearer JWT | AGV alerts (low battery, stuck, etc.) |
| `GET` | `/agv/commands` | agv_code param | AGV polls for pending commands |
| `POST` | `/agv/commands/:id/ack` | — | AGV acknowledges a command |
| `POST` | `/agv/commands/:id/complete` | — | AGV marks command done |
| `POST` | `/agv/commands` | Bearer JWT (MES) | MES enqueues a command |
| `GET` | `/agv/commands/queue` | — | MES views command queue |
| `DELETE` | `/agv/commands/:id` | — | MES cancels pending command |
| `GET` | `/agv/fleet` | JWT | Fleet status (MES internal) |
| `GET` | `/agv/tasks` | JWT | Task queue (MES internal) |
| `GET` | `/health` | none | Health check |

**Command queue DB**: `agv_command_queue` table — stores pending/acknowledged/completed commands for AGV poll model.

### mes-query.js Scopes

| Scope | Returns |
|---|---|
| `agv-fleet` | Fleet summary (counts) + individual AGV status, battery, position, zone |
| `agv-tasks` | Task queue with priority, zone, AGV join |
| `agv-positions` | Position log (x, y, heading, zone, timestamp) |
| `agv-stations` | Station registry with type, zone, capacity |
| `agv-kpi` | 30d: completion rate, avg duration/distance, battery drop, charging stats |
| `agv-all` | All of the above in parallel |

### mes-execute.js Actions

| Action | CLI | Description |
|---|---|---|
| `agv-dispatch` | `--task-id N` | Assign AGV to pending task |
| `agv-return` | `--agv CODE` | Route AGV to nearest charging station |
| `agv-pause` | `--agv CODE` | Pause AGV and free current task |
| `agv-resume` | `--agv CODE` | Resume paused AGV |
| `agv-task-complete` | `--task-id N` | Mark task completed, archive to history |
| `agv-charge` | `--agv CODE` | Start charging session |

### Agent Bus Messages

**Inbound to MES** (AGV → MES):
| Message | Handler | Action |
|---|---|---|
| `agv_low_battery` | handleAgvLowBattery | Auto-charge dispatch |
| `agv_stuck` | handleAgvStuck | LINE alert + HR incident |
| `agv_docked` | handleAgvDocked | Task complete + notify WMS/PMC |
| `agv_task_completed` | handleAgvTaskCompleted | Archive + battery check |

**Outbound from MES** (MES → AGV/others):
| Function | Destination | Message |
|---|---|---|
| `requestAgvKitDelivery` | agv-ai | kit_delivery_request |
| `informAgvTaskCancel` | agv-ai | task_cancel |
| `informAgvStationBlock` | agv-ai | station_block |
| `informAgvIncident` | hr-ai | agv_incident |

### KPI Targets

| KPI | Target | Alert Threshold |
|---|---|---|
| Task completion rate | ≥ 95% | < 90% |
| Average task duration | ≤ 15 min | > 20 min |
| Battery safety margin | ≥ 15% buffer | ≤ 5% buffer |
| Charging turnaround | ≤ 45 min | > 60 min |
| Fleet uptime | ≥ 90% | < 85% |

---

## HR AI Manager — Virtual Agent Skills

### Agent Profile

**Name**: HR AI Manager (`人事AI管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no employee data leaves factory)
**Execution**: Node.js DB queries + API calls + LINE notifications
**Escalation**: LINE/Email alerts for compliance risks, disciplinary actions, payroll cutoff; human-in-the-loop for terminations, salary changes, critical compliance flags
**Memory**: Last-state JSON for delta detection; employee snapshot cache for anniversary/contract expiry tracking
**Regulatory Reference**: Vietnam Labour Code 45/2019/QH14, Law on Employment 74/2025/QH15, Social Insurance Law 2024, Decree 337/2025/ND-CP (electronic contracts), DOLISA regulations
**Audit**: Every HR action logged with timestamp, operator, reason, data before/after

---

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)          │
│  07:30: morning HR digest to LINE                   │
│  08:00: daily attendance patrol                     │
│  09:00: contract/visa/certification expiry check    │
│  12:00: mid-day attendance sync                     │
│  17:00: end-of-day HR summary                       │
│  23:00: payroll preprocessing (monthly on 25th)     │
│  Every 30min: pending leave/OT approval patrol      │
│  Monday 08:00: weekly HR health report              │
│  1st of month: monthly SI/PIT reconciliation        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  hr-manager.js (Node.js)                            │
│  1. Query DB (hr-query.js)                          │
│  2. Feed Ornith for reasoning                       │
│  3. Parse decisions                                 │
│  4. Execute via API or log                           │
│  5. Send LINE/Email alerts                           │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┬─────────────┐
          ▼            ▼            ▼             ▼
      PostgreSQL    Ornith       LINE API     Email/SMTP
      (HR data)   (reason)     (alerts)      (reports)
```

---

### Core Skills

#### Skill 1: Employee Lifecycle Agent (Onboarding → Active → Offboarding)

**Trigger**: New hire created in system; probation end approaching; resignation notice received

**Onboarding Workflow**:
```
1. Generate employee_no (EMP{YYYY}{4-digit serial})
2. Create system accounts (email, HRIS, ERP access level by role)
3. Generate employee QR code for access/badge printing
4. Schedule: orientation → safety training → department induction → shift assignment
5. Assign onboarding checklist (document collection, PPE issue, locker assignment)
6. Set probation_end_date = join_date + 2 months (default for operators)
7. LINE alert to department manager: "[新员工] {name} 将于 {date} 报到"
```

**Probation Review** (trigger: 7 days before probation_end):
```
IF pending_review:
  → LINE: "{name} 试用期于 {date} 结束，请主管提交转正评估"
IF no_action_by_end_date:
  → escalate to HR manager: "⚠️ {name} 试用期已结束未处理"
```

**Offboarding Workflow**:
```
1. Record resign_date, resign_reason, last_working_day
2. Trigger asset return checklist (badge, PPE, locker, tools)
3. Calculate severance: ½ month per year (Vietnam Labour Code Art.46)
4. Update status = 'resigned'
5. Generate离职证明 (work certificate) — Vietnamese law requirement
6. LINE to HR: "🔴 [离职] {name} | 最后工作日: {date} | 原因: {reason}"
7. Archive employee record (retain 2 years per Vietnamese law)
8. Stop SI/PIT contributions from next month
```

**Decision Matrix**:

| Event | Condition | Auto Action | Escalation |
|---|---|---|---|
| New hire created | Role + department known | Generate emp_no, QR, accounts | None |
| Probation end -7d | No review submitted | Remind manager | +3d → HR manager |
| Resignation notice | < 30d notice period | Flag legal risk | HR manager LINE |
| Resignation notice | ≥ 30d, handover OK | Process offboarding | Log only |
| Contract expiry -30d | Performance OK | Recommend renewal | HR manager |
| Contract expiry -30d | Below expectation | Flag non-renewal | HR + dept manager |

**Data Sources**:
- `hr_employees` (employee info, status, dates)
- `employee_work_history` (position changes)
- `hr_leave_balances` (leave payout on termination)

**Tool**: `POST /api/hr/employees` + `GET /hr/employees?status=probation`

---

#### Skill 2: Attendance Patrol Agent

**Trigger**: Every 30 minutes (patrol cycle); 08:00 daily summary; 12:00 mid-day sync

**Checks**:

1. **Missed Clock-In Detection**
   - Query: `SELECT e.id, e.name_zh, s.start_time FROM hr_employees e JOIN hr_shift_schedules ss ON ... WHERE a.id IS NULL AND ss.schedule_date = TODAY`
   - Action: 🟡 LINE reminder to employee + supervisor if clock-in missing > 30 min after shift start
   - Escalation: > 2h → 🔴 alert to HR: `{name} 未打卡 ({shift}班次)`

2. **Early Clock-Out Warning**
   - Query: clock_out < scheduled_end - 1h and no leave/OT approved
   - Action: 🟡 notify supervisor

3. **Absentee Alert**
   - End of shift: no clock_in AND no leave record → mark as `absent`
   - Action: 🔴 LINE: `{name} 今日缺勤 (未请假)`

4. **OT Limit Monitor**
   - Vietnam law: max 40h OT/month, 200h/year (Art.107 Labour Code)
   - Query: `SELECT SUM(ot_hours) FROM hr_attendance_records WHERE employee_id = $1 AND month = CURRENT`
   - Action: > 35h/month → 🟡 warning | > 40h → 🔴 block further OT, escalate to HR

5. **Attendance Anomaly** (buddy punch detection)
   - Same IP/machine clocking for multiple employees at identical second
   - Action: 🟡 flag for HR investigation

**Decision Matrix**:

| Condition | Action | Channel |
|---|---|---|
| No clock-in > 30min after shift | 🟡 Remind | LINE (employee + supervisor) |
| No clock-in > 2h | 🔴 Alert | LINE (HR) |
| Early out > 1h (unapproved) | 🟡 Warning | LINE (supervisor) |
| End of shift: absent + no leave | 🔴 Mark absent | Auto + LINE to HR |
| OT > 35h/month | 🟡 Warning | LINE (employee + HR) |
| OT > 40h/month | 🔴 Block OT | HR approval required |
| Same-second clock from same device | 🟡 Flag | HR review queue |

**Tool**: `GET /hr/attendance/daily` + `GET /hr/shift-schedules?date=today`

---

#### Skill 3: Leave & Absence Manager

**Trigger**: New leave request submitted; pending approval patrol (every 30 min)

**Validation Rules**:
```
FOR each pending leave request:
  1. Check balance: available_days >= requested_days
  2. Check notice period: min_days_notice met (annual=1d, sick=0d, personal=1d)
  3. Check conflicts: no overlapping leave for same employee
  4. Check department coverage: remaining headcount >= minimum required
  5. If all pass → auto-approve (if auto_approval enabled for leave type)
     Else → route to department manager for approval
```

**Auto-Approval Rules**:

| Leave Type | Max Days Auto | Condition |
|---|---|---|
| Annual leave | ≤ 3 days | Sufficient balance, no conflict |
| Sick leave | ≤ 2 days | Medical note attached |
| Personal leave | ≤ 1 day | Sufficient balance |
| Maternity | N/A | Always requires HR approval |

**Leave Balance Calculation** (Vietnam):
```javascript
// Per Vietnam Labour Code:
// - < 1 year service: 12 days annual leave
// - 1-5 years: 14 days
// - 5-10 years: 16 days
// - 10-20 years: 20 days
// - 20+ years: 24 days
// Prorated for mid-year joiners
// Carry forward: max 3 days (company policy)
```

**Annual Leave Encashment** (trigger: year-end):
- Unused leave > 3 days → auto carry-forward reminder
- Employee can encash up to 5 unused days at 1 day = 1 day base salary
- LINE: `📋 {name} 剩余年假 {days}天，可结转最多3天或折现`

**Escalation**:
- Leave request pending > 4h (critical roles) / > 24h (standard) → escalate to next approver
- Maternity leave start/end → auto-update shift schedule
- Extended sick leave > 14 days → flag for SI claim processing

**Tool**: `POST /api/hr/leave-requests` + `GET /hr/leave-balances/:employeeId`

---

#### Skill 4: Shift Scheduling Agent

**Trigger**: Weekly schedule generation (Sunday 18:00); daily adjustment patrol

**Logic**:
```
FOR each department:
  1. Load next week production plan (from PMC work orders)
  2. Determine shift demand per day based on line schedule
  3. Match available employees (skill, certification, preference)
  4. Apply constraints:
     - No consecutive night shifts > 3 (company policy)
     - Min 12h rest between shifts (Vietnam Labour Code Art.109)
     - Seniority-based shift preference (if configured)
  5. Generate shift_schedules
  6. Check coverage: if headcount < required → flag shortage
  7. Publish via LINE to department
```

**Preference Scoring**:
```javascript
function scoreEmployeeForShift(emp, shiftDate, shiftType) {
  let score = 0;
  if (emp.preferredShift === shiftType)      score += 10;
  if (emp.lastShiftType === 'NIGHT' && shiftDate - emp.lastShiftDate === 1) score -= 20;  // prevent back-to-back night
  if (emp.seniority > 3)                     score += 5;  // seniority bonus
  if (emp.certifications.includes('LEAD'))   score += 3;  // certified lead hand
  if (emp.otHoursThisMonth > 30)             score -= 10; // reduce OT load
  return score;
}
```

**Shift Swap Patrol** (every 30 min):
```
IF swap_request_pending:
  → Check: both employees qualified for each other's shift
  → Check: no OT limit breach
  → Auto-approve if conditions met
  → Else: route to supervisor
```

**Tool**: `POST /api/hr/shift-schedules` (batch) + `GET /hr/shifts`

---

#### Skill 5: Overtime Compliance Agent

**Trigger**: OT request submitted; weekly OT patrol (Friday 14:00)

**Vietnam OT Limits** (Labour Code Art.107):
- Max 4h/day, 40h/month, 200h/year (general)
- Max 300h/year with company register (manufacturing exemption)
- Night OT (22:00-06:00): additional 30% premium
- Weekend OT: 200% rate
- Holiday OT: 300% rate

**Validation**:
```
FOR each OT request:
  1. Hours this month + requested_hours <= legal limit
  2. Hours this year + requested_hours <= annual limit
  3. Not already clocked in for regular shift (no double-count)
  4. Employee consented (Vietnam law requires written agreement for OT > 4h/day)
  5. Reason: production / machine maintenance / inventory / other
  6. If all pass → auto-approve (within limits)
     Else → escalate to HR + department manager
```

**Weekly OT Forecast**:
- Run Friday 14:00: project rest-of-week OT need vs remaining monthly budget
- If projected > 80% of monthly limit → 🟡 warning
- If projected > 95% → 🔴 alert to HR + production manager

**Tool**: `POST /api/hr/overtime-requests` + `GET /hr/shift-schedules`

---

#### Skill 6: Performance Review Agent

**Trigger**: Quarterly review cycle (end of quarter); probation end; annual review (January)

**Review Cycle**:
```
1. Auto-create review period: review_date = end_of_quarter
2. Load KPIs from performance_kpis (by role/department)
3. Load actual data:
   - hr_attendance_records → attendance rate, late/absent count
   - quality data (if applicable) → FPY, defect rate
   - output data (if applicable) → production qty vs target
4. Calculate scores:
   - score = (actual / target) × weight for each KPI
   - total_score = SUM(all KPI scores)
5. Map score to rating:
   - >= 90: Excellent
   - >= 75: Good
   - >= 60: Meets Expectations
   - >= 45: Needs Improvement
   - < 45: Poor
6. Generate review summary → LINE to manager for review
7. Manager adjusts → save final rating → influences bonus/salary
```

**KPI Library** (seed data already in DB):

| KPI | Weight | Target | Source |
|---|---|---|---|
| First Pass Yield | 25% | ≥ 98% | Quality module |
| Output Target Achievement | 25% | ≥ 95% | MES reporting |
| Equipment Maintenance Compliance | 15% | ≥ 90% | PM completion |
| 5S Cleanliness | 10% | ≥ 85% | Audit scores |
| Attendance Rate | 15% | ≥ 98% | Attendance records |
| Safety Compliance | 10% | 100% | Incident log |

**Escalation**:
- Review not submitted within 7 days → LINE reminder to manager
- Manager rating contradicts AI score by > 20 points → flag for HR review
- Consecutive "Poor" ratings → flag retention risk

**Tool**: `GET /api/hr/performance/reviews` + `POST /api/hr/performance/reviews`

---

#### Skill 7: Payroll Preprocessor Agent

**Trigger**: Monthly on 25th (payroll cutoff); daily patrol for attendance data readiness

**Preprocessing Pipeline**:
```
1. Verify attendance data completeness:
   - CHECK: all employees have clock_in/out for each workday
   - MISSING: flag incomplete records → LINE to HR
2. Calculate regular hours:
   - actual_work_hours = SUM(clock_out - clock_in - break) per day
3. Calculate OT hours (from hr_attendance_records.ot_hours)
4. Calculate deductions:
   - late: {late_minutes} deducted per company policy
   - absent: {absent_days} × daily_rate
5. Load allowances: salary_allowances (active for current period)
6. Parse performance bonus from latest review
7. Calculate social insurance:
   - SI: 8% of gross (employee share) — max cap at 20× base salary
   - HI: 1.5% — max cap at 20× base
   - UI: 1% — max cap at 20× base (2026: expanded to 1-3 month contracts)
8. Calculate PIT (progressive tax table)
9. Compute:
   - gross = base + OT_pay + allowances + bonuses
   - total_deductions = SI + HI + UI + PIT + late/absent deductions
   - net = gross - total_deductions
10. Generate payroll preview → LINE to finance: "📊 {month}月薪资预览 | 总人数{N} | 应发{VND} | 实发{VND}"
```

**Vietnam Social Insurance Rates (2026)**:

| Component | Employer | Employee | Cap |
|---|---|---|---|
| Social Insurance (SI) | 17.5% | 8% | 20× base salary |
| Health Insurance (HI) | 3% | 1.5% | 20× base salary |
| Unemployment Insurance (UI) | 1% | 1% | 20× base salary |
| **Total** | **21.5%** | **10.5%** | |

> Note: From 2026, UI expanded to cover 1-3 month fixed-term contracts per Law on Employment 2025.

**Regulatory Compliance Check**:
- Regional minimum wage compliance: verify all base salaries ≥ regional minimum
- Overtime cap compliance: monthly OT ≤ 40h, yearly ≤ 200h
- SI contribution base: at least regional minimum, at most 20× base salary

**Escalation**:
- Attendance data incomplete by 25th → 🔴 to HR: "考勤数据不全，{N}人缺打卡"
- Net salary < regional minimum → 🟡 flag
- OT limit breached → 🔴 alert with employee list

**Tool**: `GET /hr/attendance/monthly/:employeeId` + `GET /hr/leave-balances/:employeeId` + `POST /hr/salary-records`

---

#### Skill 8: Certification & Compliance Tracker

**Trigger**: Daily 09:00 expiry check; on new hire; on certification upload

**Certification Types** (SMT factory):
| Cert | Renewal | Regulatory Body |
|---|---|---|
| Forklift license | 3 years | Ministry of Labour |
| Welding cert | 2 years | Ministry of Industry |
| Safety training | Annual | DOLISA |
| MSDS/Hazmat handling | 2 years | Ministry of Industry |
| Electrician license | 5 years | MOIT |
| First aid / CPR | 2 years | MOH |
| PPE/compliance training | Annual | Company policy |

**Checks**:
```
DAILY PATROL:
  1. Query certifications expiring within 30/60/90 days
  2. 60d before expiry → 🟡 LINE: "{cert} 将于{date}到期，请安排续期"
  3. 30d before expiry → 🔴 LINE to HR + employee
  4. EXPIRED → 🔴 BLOCK: employee cannot be assigned to role requiring cert
  5. Update employee eligibility flag: is_eligible_for_role = false
```

**Compliance Document Audit** (Vietnam-specific):
- Internal Labour Regulations (ILR): must be registered with DOLISA if > 10 employees
- Labour contracts: must be signed within 30 days of start (electronic since Decree 337/2025)
- Salary scale: must be published internally
- Collective Labour Agreement (CLA): recommended for > 10 employees
- Personal data protection: employer = data controller per Law on Personal Data Protection 2025

**Tool**: `CERT_TRACKING TABLE` (custom) + `GET /hr/employees?cert=expiring`

---

#### Skill 9: Recruitment & Talent Pipeline Agent

**Trigger**: New headcount request approved; weekly pipeline review (Monday)

**Process**:
```
1. Receive headcount request → validate budget approved
2. Generate job posting template (position_title, department, required_skills, qty)
3. Calculate sourcing strategy:
   - Operator/line worker: referral program + local job centers
   - Technician/engineer: recruitment platforms + schools
   - Manager: executive search + internal promotion
4. Screen candidates against requirements:
   - Match: skills, experience, certification, shift availability
   - Score: 0-100 based on fit
5. Schedule interview: coordinate with hiring manager's shift
6. Track pipeline: sourced → screened → interviewed → offered → onboarded
7. Weekly pipeline report to LINE:
   📋 招聘管道周报
   ━━━━━━━━━━━━━━━━━━
   {position}: {sourced}人 → {screened}人 → {interviewed}人 → {offered}人 → {joined}人
   平均招聘周期: {days}天
   ━━━━━━━━━━━━━━━━━━
```

**Decision Matrix**:

| Candidate Score | Action |
|---|---|
| ≥ 85 | Auto-advance to interview |
| 70–84 | Recommend screening call |
| 50–69 | Hold for manager review |
| < 50 | Auto-reject with template |

**Tool**: Custom recruitment tracking tables + `GET /hr/employees` (for internal transfer candidates)

---

#### Skill 10: Training & Development Agent

**Trigger**: New hire onboarding; skill gap detected; annual training plan (January)

**Training Paths**:
```
NEW OPERATOR:
  → Day 1: Factory safety induction (4h) [mandatory DOLISA]
  → Day 2: SMT basics, ESD awareness, MSD handling
  → Day 3-5: On-the-job training (buddy system)
  → Day 30: Skills assessment → pass → independent work

NEW TECHNICIAN:
  → Week 1: Safety + equipment familiarization
  → Week 2-3: Machine-specific training (printer, mount, reflow, AOI)
  → Week 4: Certification assessment

ANNUAL REFRESHER:
  → Safety refresher (all employees) — annual requirement
  → 5S training (all operators)
  → New equipment training (as needed)
```

**Patrol Checks**:
- Training not completed within 7 days of target → 🟡 remind
- Overdue > 14 days → 🔴 escalate to HR manager
- Training completion rate < 80% department-wide → flag to department head

**Tool**: Custom training tracking + `POST /api/hr/employees/:id/training`

---

#### Skill 11: Labour Cost & Budget Agent

**Trigger**: Monthly after payroll close; weekly budget patrol (Friday)

**Calculations**:
```
1. Total labour cost this month:
   = SUM(gross_salary + employer_SI + employer_HI + employer_UI + bonuses + allowances)
2. Labour cost per unit (LCPU):
   = Total labour cost / total output qty (from MES)
3. Budget vs actual:
   = monthly_budget - actual_cost
4. Headcount vs budget:
   = approved_HC - actual_active_HC
5. Overtime cost ratio:
   = total_OT_pay / total_labour_cost
```

**Decision Matrix**:

| Metric | Green | Yellow | Red |
|---|---|---|---|
| LCPU vs target | ≤ 100% | 100–115% | > 115% |
| Budget variance | ≤ ±3% | ±3–10% | > ±10% |
| OT cost ratio | < 5% | 5–10% | > 10% |
| Vacancy rate | < 5% | 5–15% | > 15% |

**Escalation**:
- Red metrics → 🔴 LINE to finance + HR manager
- Consecutive yellow > 2 months → 🟡 weekly report
- OT cost ratio red → suggest hiring additional headcount vs OT dependency

**Tool**: `GET /hr/salary-records?month=` + `GET /reports/material-balance` (for output data)

---

#### Skill 12: Employee Self-Service (ESS) Patroller

**Trigger**: Employee submits request via ESS portal; 30-min pending queue check

**ESS Request Types Handled**:
```
1. LEAVE REQUEST
   → Auto-validate balance → route to approver → update balance on approval
2. OT REQUEST
   → Check limits → route to supervisor → update attendance on approval
3. SHIFT SWAP
   → Check qualifications → auto-approve if no conflict → notify both
4. PERSONAL INFO UPDATE
   → Validate (phone, address, emergency contact) → update record
5. CERTIFICATE UPLOAD
   → OCR scan → validate cert type → update employee record
6. PAYSLIP QUERY
   → Return current month payslip summary (net, deductions)
7. ATTENDANCE DISCREPANCY
   → Log discrepancy → route to HR for investigation
```

**SLA Patrol**:
```
FOR pending ESS requests:
  IF pending > 4h AND priority = 'urgent':      → 🔴 escalate to HR
  IF pending > 24h AND priority = 'normal':     → 🟡 remind assigned approver
  IF pending > 48h:                             → 🔴 escalate to HR manager
```

**Tool**: `GET /api/hr/ess/pending` + `POST /api/hr/ess/:id/approve`

---

#### Skill 13: Employee Relations & Sentiment Agent

**Trigger**: Weekly sentiment check (Friday); exit interview; critical incident report

**Data Sources**:
- Attendance anomalies (frequent late/absent → possible disengagement)
- OT refusal patterns → possible burnout
- Disciplinary records → track repeat offenders
- Exit interview reasons → department-level pattern detection
- Performance trend (declining → flag for intervention)

**Pattern Detection**:
```javascript
// Disengagement risk scoring
function disengagementRisk(employeeId) {
  let risk = 0;
  if (lateDaysThisMonth > 5)         risk += 20;
  if (absentDaysThisQuarter > 3)     risk += 30;
  if (performanceTrend === 'DOWN')   risk += 25;
  if (OT_refusals > 2 && OT_hours > 30) risk += 15; // burnout signal
  if (grievanceFiled)                risk += 10;
  return risk; // > 50 = high risk
}
```

**Escalation**:

| Risk Score | Action |
|---|---|
| 0–20 | Normal — log only |
| 21–50 | 🟡 Watch — add to weekly report |
| 51–80 | 🟠 Alert — recommend manager check-in |
| 81–100 | 🔴 Critical — HR intervention required |

**Exit Interview Pattern Report** (Monthly):
```
📋 离职分析月报 {month}
━━━━━━━━━━━━━━━━━━
离职率: {rate}% (目标 < 5%)
本月离职: {N}人
主要离职原因:
  - 薪资: {N}人 ({pct}%)
  - 加班过多: {N}人
  - 个人原因: {N}人
高危部门: {dept} ({rate}% 离职率)
━━━━━━━━━━━━━━━━━━
```

**Tool**: `GET /hr/employees?status=resigned&date_range=this_month` + attendance + performance data

---

#### Skill 14: Insurance & SI Reporting Agent

**Trigger**: Monthly (before 10th for SI reporting); new hire; resignation; salary change

**Vietnam SI/PIT Reporting Requirements (2026)**:
```
MONTHLY (before 10th):
  → Submit SI contribution list to social insurance agency (electronic)
  → Submit HI contribution
  → Submit UI contribution

QUARTERLY (from April 2026):
  → Submit PIT declaration (quarterly, previously monthly)

ANNUALLY:
  → PIT finalization (March-April)
  → SI book reconciliation
  → Labor report submission to DOLISA
  → EEO-1 equivalent report
```

**Data Preparation**:
```
FOR each employee:
  1. Verify SI eligibility (all employees with ≥ 1 month contract)
  2. Calculate contribution base = min(max(salary, regional_min), 20× base_salary)
  3. Split: employee share (10.5%) vs employer share (21.5%)
  4. Generate SI register file (XML format for Vietnam SI portal)
  5. Validate: all fields complete, math correct
  6. Post to SI portal API (or generate file for manual upload)
```

**Tool**: `GET /hr/salary-records?status=final&month=` + SI calculation module

---

#### Skill 15: HR Morning Digest & Reporting Agent

**Trigger**: 07:30 daily; 17:00 daily; Monday 08:00 weekly; 1st of month

**Morning Briefing (07:30)**:
```
🌅 人事晨报 {date}
━━━━━━━━━━━━━━━━━━
👥 今日概览
   在职: {N}人 | 出勤: {N}人 | 缺勤: {N}人
   迟到: {N}人 | 请假: {N}人

⭐ 今日关注
   - {name}: 试用期到期 ({date})
   - {name}: 合同到期 ({date})
   - {dept}: 缺勤率偏高 ({rate}%)
   - {cert}: {N}人证书即将到期

📋 待办事项
   - [ ] 试用期评估: {N}人待处理
   - [ ] 离职面谈: {N}人
   - [ ] {N}个请假待审批
   - [ ] {N}个加班待审批

📊 考勤率: {rate}% | 准时率: {rate}%
```

**End-of-Day Summary (17:00)**:
```
🌆 人事晚报 {date}
━━━━━━━━━━━━━━━━━━
✅ 今日打卡完成率: {rate}%
⚠️ 未打卡: {N}人 → 已通知主管
📌 请假批准: {N}件 | OT批准: {N}件
```

**Weekly HR Health (Monday 08:00)**:
```
📋 人事周报 W{week}
━━━━━━━━━━━━━━━━━━
👥 人数: {active} | 新入职: {new} | 离职: {left}
📊 出勤率: {rate}% | 加班率: {rate}%
⚠️ 关注:
   - {dept}: 离职率 {rate}% (高于阈值)
   - {N}人证书本月到期
💰 人工成本: {amount} VND | LCPU: {amount}
```

**Monthly HR Report (1st)**:
```
📊 人事月报 {month}
━━━━━━━━━━━━━━━━━━
人员流动
   期初: {N} | 入职: {N} | 离职: {N} | 期末: {N}
   离职率: {rate}% | 新进率: {rate}%

考勤
   平均出勤率: {rate}% | 迟到率: {rate}%
   总加班时数: {hours} | 人均加班: {hours}

薪资 (上月)
   总人工成本: {amount} VND
   人均成本: {amount} VND
   OT占比: {rate}%

合规
   合同签署率: {rate}% | SI缴纳: ✅
   培训完成率: {rate}% | 证书有效: {rate}%
```

**Tool**: Ornith analysis of last 24h HR data → formatted LINE message

---

#### Skill 16: Employee QR Code Manager

**Trigger**: Employee created; QR expired; reprint request; daily patrol for expiry

**QR Code Lifecycle**:
```
1. On employee create → generate QR containing employee_no + employee_id
2. Store in employee_qr_codes table (or equivalent)
3. Set expiry = 365 days from issue
4. On scan (at gate, canteen, station):
   - Validate QR is active AND not expired
   - Log scan event (scanner_device, scanned_at, location)
5. 30 days before expiry → 🟡 LINE: "{name} 二维码即将过期"
6. On expiry → auto-regenerate new QR, notify employee
```

**Tool**: `POST /api/hr/qr/generate` + `GET /hr/qr/status`

---

#### Skill 17: Disciplinary & Grievance Agent

**Trigger**: Incident report submitted; HR investigation opened; NCR with human factor

**Process**:
```
1. Receive incident report → classify severity:
   - Minor: late, dress code, 5S violation → verbal warning
   - Moderate: safety violation, quality mistake → written warning
   - Severe: theft, fight, deliberate damage → suspension + investigation
   - Critical: accident, fatality → immediate escalation + regulatory report
2. Check employee history: repeat offenses → escalate severity
3. Route to appropriate channel:
   - Minor → supervisor resolves
   - Moderate/Severe → HR + department manager
   - Critical → HR manager + factory director
4. Track resolution: status = reported → investigating → resolved
5. Log to employee record — used in performance review
```

**Decision Matrix**:

| Severity | 1st Offense | 2nd | 3rd+ |
|---|---|---|---|
| Minor | Verbal warning | Written warning | Final warning |
| Moderate | Written warning | Final warning | Suspension |
| Severe | Suspension (pending investigation) | Termination (with HR approval) | Termination |
| Critical | Immediate suspension + investigation | N/A | N/A |

**Vietnam Labour Code Note**:
- Disciplinary dismissal requires:
  1. Internal Labour Regulations registered with DOLISA
  2. Written evidence of violation
  3. Employee has right to defend (hearing)
  4. Union/worker representative present
- Procedural error = wrongful termination claim (high risk)

**Tool**: `POST /api/hr/disciplinary` + `GET /hr/disciplinary-history/:employeeId`

---

#### Skill 18: HR Compliance Audit Agent

**Trigger**: Weekly compliance scan (Monday); monthly deep audit (1st); regulatory change detected

**Compliance Checklist** (Vietnam 2026):

| Item | Frequency | Status Check |
|---|---|---|
| Labour contracts signed ≤ 30 days of hire | Per hire | Audit unsigned contracts > 30d |
| ILR registered with DOLISA | Once + amendments | Verify registration receipt |
| SI contributions paid by 10th | Monthly | Compare payment vs obligation |
| PIT declaration submitted | Quarterly | Verify submission receipt (from April 2026) |
| OT within legal limits | Monthly | Check OT cap compliance |
| Regional minimum wage compliance | Annual (Jan) | Verify all salaries ≥ regional min |
| Contract expiry tracking | Weekly | 30-day advance renewal notice |
| Foreign worker work permits valid | Monthly | Verify permit expiry dates |
| Personal data protection compliance | Quarterly | Audit employee data handling |
| Training records (safety) | Annual | Verify all employees have current safety training |

**Regulatory Change Monitor** (trigger: official gazette / regulatory alert):
```
1. Detect change (manual feed or web scrape)
2. Assess impact: which policies/contracts/processes affected
3. Generate impact report → LINE to HR manager
4. Track remediation: open action items with due dates
```

**Escalation**:
- Critical non-compliance (SI not paid, expired work permits) → 🔴 immediate LINE to HR + finance manager
- ILR not registered → 🔴 alert (legally cannot discipline employees without it)
- Multiple unsigned contracts → 🟡 weekly until resolved

**Tool**: `GET /hr/employees?contract_status=pending` + `GET /hr/salary-records?status=draft`

---

### AI Prompt Template

Every Ornith HR analysis uses this structured prompt:

```
## HR AI Manager — Analysis Request

Factory HR data snapshot — {timestamp}

<EMPLOYEES>
{json: active_employees, new_hires, pending_offboarding}
</EMPLOYEES>

<ATTENDANCE>
{json: today_attendance, anomalies, missing_punches}
</ATTENDANCE>

<LEAVE_AND_OT>
{json: pending_requests, balances, ot_totals}
</LEAVE_AND_OT>

<COMPLIANCE>
{json: expiring_certs, unsigned_contracts, si_status}
</COMPLIANCE>

<LABOUR_COST>
{json: month_to_date_cost, budget, variance}
</LABOUR_COST>

Context: You are an HR AI Manager for a Vietnam SMT factory.
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD
Regulatory base: Vietnam Labour Code 2019, Employment Law 2025

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [
    {{
      "severity": "critical|warning|info",
      "area": "attendance|leave|compliance|payroll|recruitment|labour_cost",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动",
      "employee_no": "工号（如适用）",
      "urgency": "immediate|24h|this_week|this_month"
    }}
  ],
  "attendance_summary": {{
    "active_headcount": 0,
    "present_today": 0,
    "absent_today": 0,
    "late_today": 0,
    "attendance_rate": 0.0,
    "on_time_rate": 0.0
  }},
  "pending_actions": [
    {{
      "type": "leave_approval|ot_approval|probation_review|contract_renewal|cert_renewal",
      "employee_no": "",
      "employee_name": "",
      "due_date": "YYYY-MM-DD",
      "auto_action": "approve|remind|escalate|block"
    }}
  ],
  "compliance_flags": [
    {{
      "check": "si_contribution|contract_signing|ot_cap|cert_valid|ilr_registered",
      "status": "ok|warning|fail",
      "detail": "详细说明"
    }}
  ],
  "labour_cost_summary": {{
    "total_labour_cost": 0.0,
    "budget_variance_pct": 0.0,
    "ot_cost_ratio_pct": 0.0,
    "lcpu": 0.0
  }},
  "summary": "一句话总结当前HR状态"
}}
</ANALYSIS>
```

---

### Task Schedule

| Time | Agent | Action |
|---|---|---|
| 07:30 | HR Digest | Morning briefing to LINE |
| 07:45 | Attendance Patrol | Pre-shift check: expected vs actual clock-in |
| 08:00 | Attendance Patrol | Missed clock-in alert |
| 09:00 | Cert & Compliance | Daily expiry check + contract renewal scan |
| 10:00 | Leave/OT Patrol | Pending approval check, auto-decision |
| 12:00 | Attendance Patrol | Mid-day attendance sync + anomalies |
| 14:00 | Shift Scheduling | Next-day adjustment check |
| 15:00 | OT Patrol | Weekly OT limit forecast (Friday) |
| 16:00 | Labour Cost | Budget vs actual check |
| 17:00 | HR Digest | End-of-day summary to LINE |
| 18:00 | Shift Scheduling | (Sunday) Next week auto-generation |
| 23:00 | Payroll Preprocessor | (25th monthly) Payroll preparation |
| Monday 08:00 | Weekly Report | HR health report to LINE |
| 1st of month | Monthly Report | Full HR monthly report |
| 1st of month | SI Reporting | Monthly SI/HI/UI submission prep |
| Every 30min | ESS Patrol | Pending employee requests |
| Quarterly | Performance Review | Auto-create review cycle |
| Annually (Jan) | Training Plan | Annual training budget & schedule |

---

### Tool Reference

#### hr-query.js
```
node hr-query.js [scope]
  scope: attendance | employees | leave | payroll | compliance | all
```

#### DB Tables Used
| Table | Purpose |
|---|---|
| `hr_employees` | Employee master, status, employment dates |
| `hr_departments` | Org hierarchy, manager, headcount target |
| `hr_shifts` | Shift definitions (DAY, AM, PM, NIGHT) |
| `hr_shift_schedules` | Employee × shift × date assignment |
| `hr_attendance_records` | Daily clock-in/out, OT, late/early |
| `hr_leave_types` | Leave categories with rules |
| `hr_leave_requests` | Leave applications and approvals |
| `hr_leave_balances` | Annual leave tracking |
| `hr_overtime_requests` | OT applications |
| `hr_holidays` | Vietnamese public + company holidays |
| `performance_reviews` | Review cycles and scores |
| `performance_review_items` | Per-KPI scoring |
| `performance_kpis` | KPI library |
| `salary_records` | Monthly salary calculation |
| `salary_allowances` | Per-employee allowances |
| `employee_work_history` | Position/department change log |

#### Views
| View | Purpose |
|---|---|
| `v_hr_daily_attendance` | Daily attendance by shift |
| `v_hr_monthly_attendance` | Monthly per-employee summary |

#### API Endpoints Used
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/hr/employees` | List employees |
| GET | `/hr/departments` | Department hierarchy |
| GET | `/hr/shifts` | Active shifts |
| GET | `/hr/shift-schedules` | Shift assignments |
| POST | `/hr/shift-schedules` | Assign shift |
| POST | `/hr/attendance/clock-in` | Clock in |
| POST | `/hr/attendance/clock-out` | Clock out |
| GET | `/hr/attendance/daily` | Today's attendance |
| GET | `/hr/attendance/monthly/:employeeId` | Monthly summary |
| GET | `/hr/attendance/shift-summary` | By-shift summary |
| GET | `/hr/leave-balances/:employeeId` | Leave balances |
| POST | `/api/hr/leave-requests` | Create/approve leave |
| POST | `/api/hr/overtime-requests` | Create/approve OT |
| GET | `/api/hr/performance/reviews` | Performance reviews |
| POST | `/api/hr/qr/generate` | Employee QR |
| POST | `/api/hr/salary-records` | Salary records |

#### LINE Integration
- Token stored in `services/worker/line_token.txt`
- Endpoint: `https://notify-api.line.me/api/notify`
- Method: POST with `message` field
- Debounce: Same alert not re-sent within 24h unless severity increased
- HR-specific LINE group ID in `services/worker/line_hr_group.txt`

---

---

#---

## Maintenance AI Manager — Virtual Agent Skills

### Agent Profile

**Name**: Maintenance AI Manager (`设备维护AI管理员`)
**Model**: Ornith-1.0-9B (local Ollama, no data leaves factory)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Scope**: Equipment (SMT lines, AOI, SPI, printers) + AGV fleet (shuttle + forklift) + spare parts lifecycle
**Audit**: Every action logged with timestamp, operator, reason

### Business Scope

| Area | Coverage |
|---|---|---|
| **Production Equipment** | SMT placement machines, AOI, SPI, printers, reflow ovens, conveyors, dip stations |
| **AGV Fleet** | 潜伏式 AGV (shuttle) + 叉式 AGV (forklift) — battery health, navigation, task handling, maintenance alerts |
| **Spare Parts** | Wear parts lifecycle (feeder springs, nozzle tips, cutter blades, belts), consumption tracking, reorder alerts |
| **Preventive Maintenance** | PM schedules per equipment + AGV, checklist execution tracking, compliance rate |
| **Corrective Maintenance** | Fault WO lifecycle: report → diagnose → repair → handover → close |
| **Checking Records** | Daily/shift inspection checklists (equipment + AGV), pass/fail results, auto-WO on failure |

### AGV Maintenance Coverage

AGV maintenance is fully integrated into the Maintenance Manager scope — no separate AGV-specific maintenance system needed.

| AGV Maintenance Item | Description | How Tracked |
|---|---|---|
| **Battery Health** | Battery cycle count, degradation, replacement threshold | `agv_fleet.battery_cycle_count`; LINE alert when threshold reached |
| **Navigation Health** | SLAM map drift, LIDAR sensor anomalies via position variance | Position log variance check during patrol |
| **Mechanical Wear** | Wheel wear (shuttle), fork mechanism (forklift), lift motor | `agv_alerts.alert_type='maintenance_due'` → creates `maintenance_work_orders` |
| **Collision Events** | AGV reports `collision_warning` / `obstacle` via `/agv/alert` | `agv_alerts` → fault WO → LINE to Maintenance Manager |
| **AGV Fault WO** | Fault work orders for AGV mechanical/electrical issues | Same `maintenance_work_orders` table, `equipment_code` = AGV code |
| **AGV PM Schedules** | Preventive maintenance schedules for AGVs | `equipment_maintenance_schedules` with `equipment_type='agv'` |
| **AGV Shift Inspections** | Pre-shift AGV inspection checklists | `equipment_checking_records` with `equipment_type='agv'` |
| **Charging Issues** | Charging timeout (>60 min), charging session failures | `agv_charging_log` anomaly detection during patrol |

**Alert Routing**: AGV `/agv/alert` → `agv_alerts` table → Maintenance patrol picks up → creates `maintenance_work_orders` → LINE to Maintenance Manager

### Skills Summary

| # | Skill | Purpose |
|---|---|---|
| 1 | Patrol & Fault Detection Agent | Patrol all equipment + AGV fleet, detect faults, classify severity |
| 2 | Preventive Maintenance Scheduler | PM schedule management + AGV PM, compliance tracking, LINE escalation |
| 3 | Spare Parts Wear & Reorder Agent | Parts lifecycle tracking, wear alerts, auto-reorder suggestions |
| 4 | Fault Work Order Manager | Full lifecycle: report → diagnose → repair → handover → close |
| 5 | Parts Consumption & Reorder | Track consumption rate, low-stock alerts, reorder workflow |
| 6 | Checking Records Manager | Daily inspection checklists (equipment + AGV), pass/fail, auto-WO on fail |
| 7 | OEE Impact Analyzer | Correlate downtime/faults to OEE loss, LINE report |
| 8 | Technician Performance Agent | Track per-technician WO resolution time, first-visit fix rate |
| 9 | Emergency Fault Response | Critical faults → immediate LINE escalation, supervisor call |
| 10 | Maintenance KPI Reporter | Weekly/monthly PM compliance, MTBF, MTTR, spare parts KPIs |
| 11 | AGV Fault Handler | AGV faults route to maintenance WOs, battery/collision events |
| 12 | AGV Preventive Maintenance | AGV PM schedules tracked alongside production equipment |
| 13 | Parts Wear Forecaster | Predict future wear dates based on current rate, alert ahead |
| 14 | Maintenance Budget Tracker | Monthly spend vs budget, LINE if over-threshold |
| 15 | Checklist Compliance Monitor | Ensure all shift inspections submitted, alert on missing |
| 16 | Shift Handover Assistant | Generate handover summary for maintenance status at shift change |
| 17 | Root Cause Analysis Assistant | Ornith analyses repeated faults to find root cause |
| 18 | Maintenance Digest | Morning + evening LINE digest: open WOs, PM compliance, AGV status |
| 19 | Equipment Health Scorecard | Per-equipment + AGV health score, trending, alert on degradation |
| 20 | Energy Consumption Monitor | Track energy per equipment, flag anomalies |
| 21 | Water/Coolant Maintenance | Track consumables, reorder alerts |
| 22 | Fault Scenario Tester | Validate fault detection logic end-to-end |
| 23 | Equipment Maintenance WO Manager | Full WO lifecycle (report → diagnose → repair → close) |

---

### Skill 22: Maintenance Manager Tester — Fault Scenario Simulation

**Trigger**: On-demand (CLI); post-migration validation; weekly health check

**Purpose**: Run 5 fault scenarios per equipment to verify the maintenance manager system correctly detects, classifies, and escalates all fault conditions. Generates per-machine + per-part HTML report.

**Equipment Under Test** (from `parts_wear_schedule`):

| ID | Code | Name | Parts Tracked |
|---|---|---|---|
| eq-001 | SMT-NXT-01 | Fuji NXT III #1 | 3 (SP-001, SP-004, SP-018) |
| eq-002 | SMT-NXT-02 | Fuji NXT III #2 | 2 (SP-002, SP-004) |
| eq-003 | PRINTER-DEK-01 | DEK Horizon #1 | 3 (SP-006, SP-007, SP-019) |
| eq-004 | AOI-CTI-01 | CTI A40 AOI | 2 (SP-010, SP-011) |
| eq-005 | REF-V8-01 | Rehm V8 Reflow | 2 (SP-008, SP-009) |
| eq-006 | PRINTER-DEK-02 | DEK Horizon #2 | 2 (SP-006, SP-019) |

**5 Fault Scenarios (applied to each equipment's critical part)**:

| # | Scenario | Simulation Method | Expected Detection |
|---|---|---|---|
| 1 | **Wear Progression** — Fast-forward running_hours past replace_interval_hours, check status transitions | DB UPDATE running_hours, then query /lifespan | wearStatus transitions normal→warning→critical→overdue at correct % thresholds |
| 2 | **Overdue Replacement** — running_hours exceeds interval by 10%, verify overdue flag | DB force overdue, check /lifespan/overdue endpoint | Endpoint returns part, alert severity = critical, type = overdue |
| 3 | **Consumption Spike** — Abnormal consumption velocity (>3× baseline) in last 7 days | INSERT spike consumption events, query /spare-parts/consumption | Consumption velocity > threshold, alert triggers |
| 4 | **Combined Low Stock + Critical Wear** — Part is near-critical wear AND current_stock < min_stock | DB UPDATE stock + wear, query /low-stock + /wear-alerts | Both endpoints return the part, dual alert generated |
| 5 | **Alert Escalation Fidelity** — Verify each alert severity maps correctly, no false positives | Check existing alerts + create borderline cases | All severities (info/ warning/ critical) correctly assigned, no misclassifications |

**Execution**:
```bash
node tests/maintenance-tester.js                    # Full test run
node tests/maintenance-tester.js --equipment eq-003 # Single equipment
node tests/maintenance-tester.js --scenario 1       # Single scenario
node tests/maintenance-tester.js --report           # Re-generate report from saved results
```

**Report Output**: `tests/maintenance-tester-report.html` — per-machine summary table, per-part pass/fail badges, fault timeline chart, system recommendations

**CLI Output** (compact):
```
[MNT-TESTER] Equipment: PRINTER-DEK-01 | Part: SP-006 (刮刀)
  ✓ Scenario 1: Wear Progression — 92% → critical detected (OK)
  ✓ Scenario 2: Overdue Detection — interval 500h, running 550h → flagged (OK)
  ✗ Scenario 3: Consumption Spike — no anomaly detection exists yet (FAIL — needs feature)
  ✓ Scenario 4: Low Stock + High Wear — stock=4<min_stock=5, wear=92% → dual alert (OK)
  ✓ Scenario 5: Alert Fidelity — severity=critical, correct (OK)
  Result: 4/5 PASS  ████████░░
```

**Warnings** (consumption spike detection not yet implemented in API — Scenario 3 will fail until `services/api/server.js` adds velocity threshold logic)

**Data Sources**:
- `parts_wear_schedule` — wear schedule, running_hours, intervals
- `parts_consumption_log` — consumption history
- `spare_parts` — stock levels, min_stock
- `parts_wear_alerts` — existing alerts for baseline comparison
- API: `/spare-parts/lifespan`, `/spare-parts/lifespan/overdue`, `/spare-parts/low-stock`, `/spare-parts/wear-alerts`, `/spare-parts/consumption`

---

### Skill 23: Equipment Maintenance Work Order Manager

**Trigger**: On-demand (Maintenance dashboard); patrol detects abnormal wear/fault; spare parts replacement creates WO; LINE alert from operator

**Purpose**: Full lifecycle management of equipment fault work orders — from issue reporting through diagnosis, repair, handover, and closure. Integrates with spare parts replacement, technician assignment, and downtime tracking.

**DB Table**: `maintenance_work_orders`

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | Auto-increment |
| `wo_no` | varchar(40) UNIQUE | Formatted: `WO-{YYMMDD}-{4-digit-serial}` |
| `equipment_id` | bigint | FK → equipment.id |
| `equipment_code` | varchar(60) | Denormalized for fast display |
| `equipment_name_zh` | varchar(200) | Denormalized |
| `line_id` | bigint | FK → production_lines.id |
| `line_name` | varchar(120) | Denormalized |
| `issue_time` | timestamptz NOT NULL | When fault was reported |
| `issue_person` | varchar(120) NOT NULL | Who reported the fault |
| `issue_phone` | varchar(40) | Contact number of reporter |
| `fault_description` | text NOT NULL | What's broken |
| `fault_category` | varchar(40) | `mechanical` / `electrical` / `software` / `wear` / `leak` / `sensor` / `other` |
| `priority` | varchar(20) DEFAULT 'medium' | `low` / `medium` / `high` / `critical` |
| `assigned_technician` | varchar(120) | Who is fixing it |
| `assigned_at` | timestamptz | When assigned |
| `status` | varchar(40) DEFAULT 'waiting_to_process' | See workflow |
| `received_at` | timestamptz | Technician received the WO |
| `started_at` | timestamptz | Repair work started |
| `completed_at` | timestamptz | Repair finished |
| `real_cause` | text | Root cause analysis |
| `resolution_notes` | text | What was done to fix it |
| `hanging_reason` | text | If status=hanging, why |
| `handover_to` | varchar(120) | Transferred to whom |
| `handover_at` | timestamptz | When transferred |
| `handover_note` | text | Transfer notes |
| `parts_used` | jsonb | `[{part_id, part_name, quantity}]` |
| `downtime_minutes` | integer | Total downtime caused |
| `photo_urls` | text[] | Fault photo URLs |
| `created_by` | varchar(120) | WO creator |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**Status Workflow**:
```
waiting_to_process (待处理) → received (已接收) → in_processing (处理中)
                                                      ├── fixed (已修复)
                                                      ├── hanging (挂起)
                                                      └── handover_to_other (转交)
fixed → closed (已关闭, 需填写 real_cause + resolution)
hanging → in_processing (解除挂起) | closed (取消)
handover_to_other → received (新负责人接收) | in_processing (新负责人开始)
```

**Auto-WO Creation by AI Patrol**:
| Trigger | Priority | Auto-Create |
|---|---|---|
| Wear_status = 'overdue' | critical | ✅ Yes |
| Wear_status = 'critical' | high | ✅ Yes |
| Wear_status = 'warning' | medium | 🟡 Recommend |
| Equipment status = 'fault' | critical | ✅ Yes |
| Inspection abnormal = 'critical' | high | ✅ Yes |
| Line stoppage > 30min unexplained | high | ✅ Yes |

**API Endpoints**:
```
GET    /maintenance/work-orders                            — list with filters
GET    /maintenance/work-orders/:id                        — single WO detail
POST   /maintenance/work-orders                            — create new WO
PUT    /maintenance/work-orders/:id/status                 — transition status
PUT    /maintenance/work-orders/:id/assign                 — assign technician
PUT    /maintenance/work-orders/:id/parts                  — record parts used
DELETE /maintenance/work-orders/:id                        — cancel/void WO
GET    /maintenance/work-orders/stats/summary              — WO dashboard metrics
GET    /maintenance/work-orders/stats/technician           — per-technician load
```

**AI Decision Matrix**:
| Condition | Auto Action |
|---|---|
| New WO, priority=critical, no technician | Auto-assign to on-duty tech with lightest load |
| WO 'in_processing' > 4h (critical) | 🟡 LINE escalation to supervisor |
| WO 'in_processing' > 8h (high) | 🟡 LINE escalation |
| WO 'hanging' > 24h without update | 🔴 LINE to maintenance manager |
| WO closed without real_cause | BLOCK — require real_cause |
| Same equipment 3+ WOs in 7 days | 🔴 LINE alert + flag for PM review |

**Dashboard Tab**: Maintenance → Work Orders (工单管理) — kanban view, technician workload, downtime chart, SLA compliance, recurring fault patterns

**CLI**:
```bash
node services/worker/mnt-wo-manager.js patrol              # AI patrol → auto-create WOs
node services/worker/mnt-wo-manager.js escalate             # Check SLA breaches
node services/worker/mnt-wo-manager.js report --days 7      # Weekly WO summary
```

---

### Skill 24: Equipment Periodic Checking Checklists

**Trigger**: Scheduled (daily/weekly/monthly by equipment); on-demand from maintenance dashboard; handover between shifts

**Purpose**: Create, assign, execute, and track periodic equipment checking checklists (设备点检表). Each equipment type has a template of check items with pass/fail criteria. Shift workers fill checklists on a schedule; failed items auto-create work orders.

**DB Tables**:

**`equipment_checklist_templates`** — defines what to check per equipment type:

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | |
| `template_code` | varchar(60) UNIQUE | e.g. `CHK-SMT-NXT-DAILY`, `CHK-DEK-WEEKLY` |
| `template_name` | varchar(200) | e.g. "Fuji NXT III 每日点检表" |
| `equipment_type` | varchar(100) | Target equipment type (matches `equipment.type`) |
| `frequency` | varchar(20) | `shift` / `daily` / `weekly` / `monthly` / `quarterly` |
| `is_active` | boolean DEFAULT true | |
| `version` | integer DEFAULT 1 | Template versioning |
| `created_by` | varchar(120) | |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**`equipment_checklist_items`** — individual check items within a template:

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | |
| `template_id` | bigint FK → `equipment_checklist_templates.id` | |
| `item_order` | integer | Sort order |
| `check_point` | varchar(300) NOT NULL | What to check — e.g. "气压表读数是否在0.5-0.7MPa" |
| `check_method` | varchar(300) | How to check — e.g. "目视检查气压表指针" |
| `standard_value` | varchar(200) | Acceptable range / norm |
| `result_type` | varchar(20) DEFAULT 'pass_fail' | `pass_fail` / `numeric` / `text` |
| `unit` | varchar(40) | e.g. "MPa", "°C", "rpm" |
| `lower_limit` | numeric | For numeric results |
| `upper_limit` | numeric | For numeric results |
| `is_optional` | boolean DEFAULT false | Optional check item |
| `category` | varchar(40) | `safety` / `operation` / `cleanliness` / `lubrication` / `temperature` / `pressure` / `electrical` / `mechanical` / `other` |
| `failure_priority` | varchar(20) DEFAULT 'medium' | If fails, what priority WO to create: `low` / `medium` / `high` / `critical` |

**`equipment_checking_records`** — each completed checklist execution:

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | |
| `record_no` | varchar(60) UNIQUE | `CHK-{YYMMDD}-{4-digit-serial}` |
| `template_id` | bigint FK | Which template was used |
| `equipment_id` | bigint FK → `equipment.id` | Which equipment |
| `equipment_code` | varchar(60) | Denormalized |
| `equipment_name_zh` | varchar(200) | Denormalized |
| `line_id` | bigint FK → `production_lines.id` | |
| `line_name` | varchar(120) | Denormalized |
| `frequency` | varchar(20) | Snapshot of frequency at execution |
| `shift_type` | varchar(20) | `day` / `night` / `mid` |
| `check_date` | date NOT NULL | Date of check |
| `check_time` | timestamptz DEFAULT now() | Exact execution time |
| `inspector_name` | varchar(120) NOT NULL | Who performed the check |
| `inspector_id` | bigint FK → `hr_employees.id` | |
| `total_items` | integer | Items in template |
| `passed_items` | integer | Items with pass result |
| `failed_items` | integer | Items with fail result |
| `skipped_items` | integer | Optional items skipped |
| `overall_result` | varchar(20) | `pass` / `conditional_pass` / `fail` |
| `notes` | text | Inspector notes |
| `verified_by` | varchar(120) | Supervisor verification |
| `verified_at` | timestamptz | |
| `work_order_ids` | bigint[] | WOs auto-created from failures |
| `created_at` | timestamptz DEFAULT now() | |

**`equipment_checking_record_details`** — individual item results:

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | |
| `record_id` | bigint FK → `equipment_checking_records.id` | |
| `item_id` | bigint FK → `equipment_checklist_items.id` | |
| `item_order` | integer | Snapshot of order at execution |
| `check_point` | varchar(300) | Snapshot of check point |
| `result` | varchar(20) NOT NULL | `pass` / `fail` / `na` / `skip` |
| `numeric_value` | numeric | For numeric results |
| `notes` | text | Inspector notes for this item |
| `photo_url` | text | Photo evidence |
| `created_at` | timestamptz DEFAULT now() | |

**Checklist Template Examples** (seed data):

| Template Code | Equipment Type | Frequency | Items |
|---|---|---|---|
| `CHK-SMT-NXT-DAILY` | SMT-NXT | daily | 12 items (air pressure, viscosity, nozzle wear, rail alignment, solder paste check, etc.) |
| `CHK-DEK-DAILY` | PRINTER-DEK | daily | 10 items (squeegee pressure, stencil tension, paste height, cleaning cloth, etc.) |
| `CHK-REFLOW-DAILY` | REF-V8 | daily | 8 items (temperature profile check, conveyor width, N2 level, filter status, etc.) |
| `CHK-AOI-DAILY` | AOI-CTI | daily | 6 items (camera calibration, lighting, conveyor, PC connection, etc.) |
| `CHK-SMT-WEEKLY` | SMT-NXT | weekly | 8 items (vacuum pump filter, lubrication, belt tension, calibration check, etc.) |
| `CHK-ALL-MONTHLY` | ALL | monthly | 15 items (grounding resistance, emergency stop, air dryer drain, panel cleaning, etc.) |

**Status Workflow**:
- Template: `draft` → `active` → `archived`
- Record: not started → `in_progress` → `completed`
- On completion: if `failed_items > 0` → auto-create WOs for each failed item based on `failure_priority`

**Auto-WO Creation on Failure**:

| Failure Priority | WO Priority | Auto Action |
|---|---|---|
| `critical` | critical | ✅ Create WO immediately, LINE alert |
| `high` | high | ✅ Create WO immediately |
| `medium` | medium | ✅ Create WO (batch in daily digest) |
| `low` | low | 🟡 Log only, include in weekly report |

**API Endpoints**:

```
# Templates
GET    /maintenance/checklists/templates                      — list templates (filter by equipment_type, frequency)
GET    /maintenance/checklists/templates/:id                  — single template with items
POST   /maintenance/checklists/templates                      — create template + items
PUT    /maintenance/checklists/templates/:id                  — update template + items
DELETE /maintenance/checklists/templates/:id                  — deactivate template

# Records
GET    /maintenance/checklists/records                        — list records (filter by equipment, date, template, inspector)
GET    /maintenance/checklists/records/:id                    — single record with item details
POST   /maintenance/checklists/records                        — create record (start checking)
PUT    /maintenance/checklists/records/:id/items              — update individual item result
PUT    /maintenance/checklists/records/:id/complete           — complete record (auto-calc pass/fail, create WOs)
PUT    /maintenance/checklists/records/:id/verify             — supervisor verify
GET    /maintenance/checklists/records/:id/report             — printable report (HTML/PDF)

# Dashboard
GET    /maintenance/checklists/stats/compliance               — daily/weekly compliance rate (passed / scheduled)
GET    /maintenance/checklists/stats/failure-trend            — failure items by category over time
GET    /maintenance/checklists/stats/due-today                — equipment with checklists due today
```

**AI Decision Matrix**:

| Condition | Auto Action |
|---|---|
| Checklist due today, no record by 14:00 | 🟡 LINE reminder to shift leader |
| Checklist due today, no record by 17:00 | 🔴 LINE escalation to maintenance supervisor |
| Same check item fails 3+ consecutive periods | 🔴 LINE alert + suggest PM review |
| Overall result = `fail` on safety-related item | 🔴 LINE escalation to EHS + maintenance manager |
| Inspector misses 3+ checklists in a week | 🟡 LINE report to supervisor |
| Compliance rate < 80% in a week | 🔴 LINE to maintenance manager |

**Dashboard Tab**: Maintenance → Checklists (点检管理) — calendar view of due checklists, today's pending items, compliance heatmap, failure trend chart, per-equipment pass rate

**CLI**:
```bash
node services/worker/mnt-checklist-manager.js patrol           # AI patrol → check due checklists, send reminders
node services/worker/mnt-checklist-manager.js due-today        # List equipment with checklists due today
node services/worker/mnt-checklist-manager.js compliance --days 30  # Compliance report
node services/worker/mnt-checklist-manager.js record --start --equipment eq-001 --template CHK-SMT-NXT-DAILY  # Start new check (PDA)
node services/worker/mnt-checklist-manager.js record --item --record-id 1 --item-id 5 --result pass  # Record item result
node services/worker/mnt-checklist-manager.js record --complete --record-id 1  # Complete check, auto-create WOs for failures
```

---

### Skill 25: Checklist Compliance Tracking & Manager Oversight

**Trigger**: After each patrol cycle; on-demand from manager dashboard; end-of-shift compliance check; end-of-day/week/month report generation

**Purpose**: Provide maintenance managers full visibility into checklist execution compliance — which checklists were completed on time, which were missed, which items were skipped or left blank. Detect gaps, enforce completion integrity, and generate audit-grade compliance reports.

**New DB Tables**:

**`equipment_checklist_schedule`** — which equipment needs which checklist on which dates (auto-generated from templates):

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | |
| `equipment_id` | bigint FK → `equipment.id` | |
| `template_id` | bigint FK → `equipment_checklist_templates.id` | |
| `frequency` | varchar(20) | `shift` / `daily` / `weekly` / `monthly` / `quarterly` |
| `scheduled_date` | date NOT NULL | Date the check is due |
| `shift_type` | varchar(20) | `day` / `night` / `mid` / `all` |
| `assigned_inspector` | varchar(120) | Default inspector (optional) |
| `status` | varchar(20) DEFAULT 'pending' | `pending` / `completed` / `missed` / `overridden` |
| `record_id` | bigint FK → `equipment_checking_records.id` | Link to completed record |
| `completed_at` | timestamptz | |
| `overridden_by` | varchar(120) | Manager who overrode a missed status |
| `override_reason` | text | Why it was overridden |
| `created_at` | timestamptz DEFAULT now() | |

**`equipment_checklist_compliance_log`** — audit log of all compliance events:

| Column | Type | Description |
|---|---|---|
| `id` | bigserial PK | |
| `event_type` | varchar(40) | `missed` / `completed` / `overridden` / `item_skipped` / `item_forgot` / `reminder_sent` / `escalated` |
| `schedule_id` | bigint FK → `equipment_checklist_schedule.id` | |
| `record_id` | bigint FK → `equipment_checking_records.id` | Null if missed |
| `equipment_id` | bigint FK → `equipment.id` | |
| `template_id` | bigint FK → `equipment_checklist_templates.id` | |
| `inspector_name` | varchar(120) | |
| `shift_type` | varchar(20) | |
| `check_date` | date | |
| `details` | text | Event description |
| `created_by` | varchar(120) | System or manager |
| `created_at` | timestamptz DEFAULT now() | |

**Missing Item Detection Logic** (AI patrol runs these checks):

| Check | Detection Method | Action |
|---|---|---|
| **Record incomplete** — `total_items` < expected items in template | Compare count at completion vs `equipment_checklist_items` count for template version | Flag record, 🟡 LINE reminder to inspector to complete missing items |
| **Item skipped without reason** — result = `skip` and `notes` is empty | Query `equipment_checking_record_details` where result='skip' AND (notes IS NULL OR notes = '') | 🟡 LINE: "{inspector} skipped item #{item_order} ({check_point}) without reason" |
| **All items pass suspiciously** — 100% pass for 30+ consecutive records | Query last 30 records for same equipment, check pass_rate = 100% | 🟡 Flag for random audit — possible rubber-stamping |
| **Checklist not started by cutoff** — schedule.status='pending' past shift end | Query `equipment_checklist_schedule` where status='pending' AND scheduled_date < today | 🔴 LINE to manager: "设备 {equipment_code} {template_name} 未完成" |
| **Item result inconsistent** — numeric value outside limits but marked `pass` | Query numeric items where (value < lower_limit OR value > upper_limit) AND result='pass' | 🔴 BLOCK — require correction before record can complete |
| **Multiple checklists same shift** — same inspector assigned > 15 items across templates in one shift | Count items per inspector per shift | 🟡 Suggest redistribute workload |
| **Verification gap** — record completed but not verified within 24h | Query records where verified_at IS NULL AND completed_at < now() - 24h | 🟡 LINE to supervisor: "请验证 {record_no}" |
| **Photo missing on critical item** — safety/critical category item has no photo_url | Query details where category='safety' AND photo_url IS NULL | 🟡 Line reminder to attach photo |

**Compliance Metrics** (calculated on patrol + on-demand):

```
For a given period (day/week/month):

Compliance Rate = CompletedOnTime / ScheduledCount × 100
Item Completion Rate = AnsweredItems / TotalItems × 100
OnTime Rate = CompletedBeforeCutoff / CompletedCount × 100
Missed Rate = MissedCount / ScheduledCount × 100
Skip Rate (warning) = SkippedWithoutReason / TotalSkipped × 100
Verification Rate = VerifiedRecords / CompletedRecords × 100
```

**Manager Dashboard** — dedicated oversight view:

```
┌─────────────────────────────────────────────────────────┐
│  📋 Checklist Compliance — {date}                        │
├─────────────────────────────────────────────────────────┤
│  Compliance: ████████░░ 82% (18/22 completed)           │
│  On-time:    ███████░░░ 72% (13/18 before 17:00)       │
│  Missed:     ████░░░░░░  4  (see table below)           │
│  Skipped w/o reason: 3 items                            │
│  Unverified (>24h):   2 records                         │
├─────────────────────────────────────────────────────────┤
│  ⚠️ MISSED TODAY                                             │
│  │ Equipment       │ Template       │ Shift │ Due     │
│  │───────────────────────────────────────────────────│
│  │ SMT-NXT-01 (L1) │ Daily          │ Day   │ 今日   │
│  │ DEK-02 (L2)     │ Daily          │ Night │ 今日   │
├─────────────────────────────────────────────────────────┤
│  ⚠️ RED FLAGS                                              │
│  │ SMT-NXT-01 — 100% pass rate for 34 consecutive days   │
│  │ DEK-01 — item #3 (刮刀压力) skipped ×3 without reason  │
│  │ AOI-01 — record CHK-240628-003 unverified since 26h   │
├─────────────────────────────────────────────────────────┤
│  📊 Weekly Trend                                          │
│  │ Mon ████████░░ 80% │ Tue ████████░░ 82%              │
│  │ Wed ███████░░░ 75% │ Thu █████████░ 90%              │
│  │ Fri ██████████ 95% │ Sat ██████░░░░ 60%              │
└─────────────────────────────────────────────────────────┘
```

**Monthly Compliance Report** (LINE digest on 1st of month):

```
📋 设备点检月度报告 — {month}
━━━━━━━━━━━━━━━━━━
📊 综合达标率: 85.3% (上月: 82.1%) 📈

✅ 达标率 TOP 3:
  1. SMT-1F: 96.7% (29/30)
  2. SMT-2F: 91.2% (31/34)
  3. AOI: 90.0% (27/30)

❌ 待改进:
  1. DEK-02: 63.3% (19/30) ← 连续2月低于70%
  2. 夜班: 71.4% ← 低于白班(89.2%)

⚠️ 异常项:
  - 遗漏项目: 12项 (上月8项)
  - 无故跳过: 7项
  - 未验证记录: 5份 (>24h)

🔴 重点关注:
  - SMT-NXT-01: 连续34天100%通过率 — 建议突击抽查
  - 操作员Nguyen Van A: 本月3次未完成点检

📌 改进建议:
  - DEK-02点检提醒提前至13:00
  - 夜班增加组长验证环节
━━━━━━━━━━━━━━━━━━
```

**API Endpoints**:

```
# Compliance Dashboard
GET    /maintenance/checklists/compliance/daily                           — today's compliance summary
GET    /maintenance/checklists/compliance/period?from=&to=&group=         — period compliance (group: day/week/equipment/inspector)
GET    /maintenance/checklists/compliance/missed                          — list missed checklists
GET    /maintenance/checklists/compliance/red-flags                       — anomaly detection results
GET    /maintenance/checklists/compliance/trend?days=30                   — compliance trend chart data
GET    /maintenance/checklists/compliance/by-inspector?from=&to=          — per-inspector stats
GET    /maintenance/checklists/compliance/by-equipment?from=&to=          — per-equipment stats

# Schedule Management
GET    /maintenance/checklists/schedule?date=&equipment_id=              — view schedule for date/equipment
POST   /maintenance/checklists/schedule/generate?from=&to=               — generate schedule from templates for date range
PUT    /maintenance/checklists/schedule/:id/override                     — manager override missed status

# Audit Log
GET    /maintenance/checklists/audit-log?from=&to=&event_type=           — compliance audit log
GET    /maintenance/checklists/audit-log/:id                             — single event detail

# Report
GET    /maintenance/checklists/reports/monthly?year=&month=              — monthly compliance report (JSON)
GET    /maintenance/checklists/reports/monthly-pdf?year=&month=          — printable PDF report
```

**AI Decision Matrix** (manager oversight additions):

| Condition | Auto Action |
|---|---|
| Equipment compliance < 70% for 2 consecutive months | 🔴 LINE escalation to factory manager + auto-schedule audit |
| Same inspector has > 20% skip rate in a week | 🟡 LINE to supervisor: shadow inspection recommended |
| Record unverified > 48h | 🔴 LINE to maintenance manager |
| > 5 missed checklists in one day across factory | 🔴 LINE to factory manager — systemic issue |
| Compliance rate drops > 10% week-over-week | 🟡 LINE alert with drill-down by shift/equipment |
| Monthly compliance < 75% | 🔴 Auto-flag in monthly report for management review |
| Inspector achieves 100% compliance for 3+ months | 🟢 Auto-recognition in monthly report |

**Schedule Generation Logic** (auto-run daily at 00:00 for next 7 days):

```
FOR each active template:
  FOR each equipment matching template.equipment_type:
    Generate schedule entries for the period based on frequency:
      - shift: generate for each shift (day/night/mid) every day
      - daily: one per day
      - weekly: one per Monday (or configured day)
      - monthly: one per 1st of month
      - quarterly: one per quarter start
    Set status = 'pending'
    Assign default inspector if configured in template
```

**CLI**:
```bash
node services/worker/mnt-checklist-manager.js compliance --today          # Today's compliance snapshot
node services/worker/mnt-checklist-manager.js compliance --period --from 2026-06-01 --to 2026-06-28  # Period report
node services/worker/mnt-checklist-manager.js compliance --by-equipment   # Per-equipment ranking
node services/worker/mnt-checklist-manager.js compliance --by-inspector   # Per-inspector ranking
node services/worker/mnt-checklist-manager.js red-flags                  # Anomaly detection
node services/worker/mnt-checklist-manager.js schedule --generate --from 2026-06-29 --to 2026-07-05  # Generate schedule
node services/worker/mnt-checklist-manager.js schedule --missing --date 2026-06-28  # Show pending/missed for date
node services/worker/mnt-checklist-manager.js audit-log --days 7         # Recent compliance events
node services/worker/mnt-checklist-manager.js monthly-report --month 6 --year 2026  # Generate report
```

**Dashboard Tab**: Maintenance → Checklists (点检管理) → sub-tabs: Execute | Compliance | Schedule | Audit

**Integration**: Compliance status feeds into the work order system: if a missed checklist leads to equipment failure, the WO links back to the missed compliance record for root cause analysis.

---

## Data Retention & Audit

- All AI decisions stored in `wms_manager_audit_log` table (shared with WMS, differentiated by `area='hr'`)
- Schema: `id, timestamp, agent='hr-manager', area='hr', decision_type, employee_no, input_data, output_decision, executed, executor, line_alert_sent, notes`
- Employee records retention: 2 years post-resignation (Vietnamese legal requirement)
- Attendance records: 5 years (SI audit requirement)
- Salary records: 5 years (tax audit requirement)
- Human can override any decision — override logged with `override_by` field
- Personal data protected per Law on Personal Data Protection 2025

---

### Known Limitations

1. **No biometric integration**: Cannot verify actual clock-in person — relies on scan/terminal data; buddy-punch detection limited to pattern heuristics
2. **No direct payroll execution**: Generates payroll preview only; actual payment requires finance approval and bank integration
3. **No LMS (Learning Management System)**: Training tracking is record-based; no content delivery or assessment engine
4. **Single-language Ornith**: HR prompts in Chinese; LINE output in Chinese; VT/VN staff need translation for some messages
5. **Offline Ornith**: If Ollama is down, fallback to rule-based decisions only (leave auto-approval, OT validation, attendance flagging)
6. **SI portal dependency**: SI/PIT reporting generates data files; actual submission to Vietnam SI portal requires API integration or manual upload
7. **No org chart generation**: Org hierarchy managed in DB; visual chart rendering is a web UI function
8. **No automated payslip delivery**: Payslip PDF generation and email/SMS delivery is a future enhancement
9. **Minimum wage changes**: Regional minimum wage updated annually; system must be updated by HR manager each January
10. **No integration with Vietnamese e-SI portal**: SI contribution submission is manual file upload until API is available

---

## MES AI Manager — 制造执行AI管理员

### Agent Profile

**Name**: MES AI Manager (`制造执行AI管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no data leaves factory)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Escalation**: LINE notifications for critical decisions; human-in-the-loop for high-stakes actions
**Memory**: Last-state JSON for delta detection between patrol cycles
**Audit**: Every action logged with timestamp, operator, reason
**Skill File**: `mes-manager-skill.md`

### Architecture

```
┌─────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)  │
│  Every 15 min: line patrol, event monitor   │
│  07:15: morning MES digest to LINE          │
│  17:00: daily yield & OEE report            │
│  Monday 08:00: weekly quality review        │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  mes-manager.js (Node.js)                  │
│  1. Query DB (mes-query.js)                │
│  2. Feed Ornith for reasoning              │
│  3. Parse decisions                        │
│  4. Execute via API or log                 │
│  5. Send LINE alerts                       │
└──────────────┬──────────────────────────────┘
               │
      ┌────────┼──────────┐
      ▼        ▼          ▼
   PostgreSQL  Ornith    LINE API
   (data)    (reason)  (alerts)
```

### Skills Summary

| # | Skill | Purpose |
|---|---|---|
| 1 | Production Line Patrol | Monitor line status, detect anomalies, flag idle/down issues |
| 2 | Station Yield & Quality | Calculate yield by station, detect defect trends, pareto analysis |
| 3 | Feeder Binding Guardian | Verify bindings vs fool-proof rules, detect mismatches |
| 4 | PCB Serial Tracker | Verify routing, detect station skips, backward movement, duplicates |
| 5 | Stagnation Manager | Detect stagnant PCBs, level-based escalation, auto-resolve or escalate |
| 6 | Scrap Manager | Auto-approve/reject scrap based on rules, weekly scrap trend analysis |
| 7 | First Article Inspector | Check FA inspection completeness, enforce WO readiness gate |
| 8 | Material Verification Agent | Flag reel-to-feeder mismatches against fool-proof rules |
| 9 | Downtime Manager | Track downtime duration, escalate prolonged stops, detect repeat failures |
| 10 | OEE Calculator | Hourly/end-of-shift OEE by line, bottleneck detection |
| 11 | Fool-Proof Guardian | Coverage rate monitoring, rule conflict detection |
| 12 | Retest & Rework Agent | Enforce retry limits, detect rework loops |
| 13 | Upstream NG Check Agent | Detect PCBs that failed upstream but passed downstream (quality bypass) |
| 14 | Time Control Agent | Cycle time monitoring, production pace vs schedule |
| 15 | Process Documentation Agent | Route completeness checks, missing fields |
| 16 | Digital Station Operator Advisor | Station readiness, operator guidance via LINE |
| 17 | Alert & Escalation Manager | Severity-based escalation with debounce |
| 18 | Daily MES Digest | Morning (07:15) & evening (17:00) LINE reports |
| 19 | Auto-Improvement Loop | LLM-as-Judge scoring, threshold tuning, accuracy tracking |
| 20 | Visual Inspection Agent (MES) | PCB defect, solder quality, feeder alignment, label OCR |
| 21 | Adaptive SOP & Live Workflow | SOP engine with BRANCH/BRANCH_VISION/EVALUATE step types |

### Data Sources

- `stations`, `station_types` — station registry
- `feeder_bindings` — active feeder assignments
- `pcb_serials` — PCB serial number tracking
- `station_events` — per-event PASS/FAIL results (partitioned by year)
- `pcb_laser_marking` — laser marking records (partitioned by year)
- `pcba_loading_records` — PCBA loading (partitioned by year)
- `stagnation_log` — PCB stagnation tracking (from Excel 产品呆滞管控)
- `scrap_records` — PCB scrap management
- `scrap_reason_codes` — standardized scrap reasons
- `fool_proof_rules` — feeder slot material verification rules
- `first_article_inspections`, `first_article_check_items` — FA inspection data
- `material_verifications` — reel verification records
- `process_routes`, `process_route_steps` — product routing definitions
- `mes_runs` — production run tracking
- `downtime_records` — line/station downtime logging
- `station_flow_records` — complete station flow tracking
- Work orders from `pmc.work_orders` — production planning data

### Implementation Files

| File | Purpose |
|---|---|
| `mes-manager.js` | Main manager: patrol loop, decision execution, LINE integration |
| `mes-query.js [scope]` | DB query tool: lines, runs, events, stagnation, scraps, downtimes, feeders, pcb-serials, fool-proof, first-article, material-verify, oee |
| `mes-execute.js <action>` | Action executor: send-alert, resolve-stagnation, approve-scrap, flag-downtime, check-feeder, generate-digest |
| `mes-evaluator.js` | Judge LLM scoring: score-recent, score-all, tune-thresholds, report |
| `mes-sop-manager.js` | SOP engine: run, render-mermaid, state, history, validate |
| `mes-vision-inspect.js` | Vision inspection: pcb, solder, feeder, label |
| `mes-sop.json` | SOP definition file |
| `mes-sop-state.json` | Live SOP execution state |
| `Invoke-MESCheck.ps1` | PowerShell wrapper for mes-manager.js --watchdog |
| `Invoke-MESMorningDigest.ps1` | PowerShell wrapper for morning digest task |

### Task Schedule

| Time | Agent | Action |
|---|---|---|
| 07:00 | Line Patrol | Check overnight line status, flag anomalies |
| 07:15 | MES Digest | Morning briefing to LINE |
| 07:30 | Scrap Manager | Review pending scrap records |
| 08:00 | Station Yield | Roll up previous day yield by station |
| 08:30 | Fool-Proof Check | Verify all feeder bindings against rules |
| 09:00 | Stagnation Patrol | Check PCBs exceeding thresholds |
| 10:00 | OEE Calculation | Hourly OEE by line |
| 12:00 | Mid-day Digest | Production progress vs plan |
| 14:00 | PCB Serial Patrol | Route verification for WIP boards |
| 15:00 | Material Verification | Flag mismatches from daily runs |
| 16:00 | Downtime Review | Follow up on open downtimes |
| 17:00 | MES Digest | End-of-day summary to LINE |
| Every 15min | Line Status | Quick health check all lines |
| Every 30min | Station Events | Yield/dwell monitoring |
| Monday 08:00 | Weekly Quality Report | Defect pareto, scrap analysis, OEE trend |

### API Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/mes/lines` | Line status list |
| GET | `/mes/lines/{lineCode}` | Line detail with stations |
| GET | `/mes/runs` | Active/past runs |
| GET | `/mes/runs/{id}` | Run detail with OEE |
| GET | `/mes/stations` | Station list |
| GET | `/mes/stations/{code}` | Station with events |
| GET | `/mes/events` | Station events with filters |
| POST | `/mes/events` | Post station event |
| GET | `/mes/feeder-bindings` | Active feeder bindings |
| GET | `/mes/pcb-serials` | PCB serial list |
| GET | `/mes/trace/{serialNo}` | Full PCB trace |
| GET | `/mes/downtimes` | Downtime records |
| POST | `/mes/downtimes` | Open downtime |
| PATCH | `/mes/downtimes/{id}` | Close downtime |
| GET | `/mes/stagnation` | Stagnation records |
| GET | `/mes/stagnation/alerts` | Stagnation alerts |
| PATCH | `/mes/stagnation/{id}/resolve` | Resolve stagnation |
| GET | `/mes/scraps` | Scrap records |
| POST | `/mes/scraps` | Create scrap |
| PATCH | `/mes/scraps/{id}` | Update scrap status |
| GET | `/mes/fool-proof-rules` | Fool-proof rules |
| GET | `/mes/first-article-inspections` | FA inspections |
| GET | `/mes/material-verifications` | Material verifications |
| GET | `/mes/station-flow` | Station flow records |
| GET | `/mes/process-routes` | Process routes |
| GET | `/mes/process-routes/{id}` | Route detail with steps |
| GET | `/mes/events/upstream-check/{pcbSerial}` | Upstream NG check |
| GET | `/mes/scrap-reason-codes` | Scrap reason codes |

### Escalation

| Severity | Trigger | Recipient | Channel |
|---|---|---|---|
| 🔴 CRITICAL | Line running 0 output > 1h | Line supervisor + PMC | LINE (immediate) |
| 🔴 CRITICAL | Station yield drop > 10% | QA engineer | LINE (immediate) |
| 🔴 CRITICAL | Fool-proof mismatch | Line operator + supervisor | LINE (immediate) |
| 🔴 CRITICAL | PCB routing skip | QC + production | LINE (immediate) |
| 🟠 ALERT | Line idle > 2h with released WO | Production manager | LINE (immediate) |
| 🟠 ALERT | Stagnation critical level | Supervisor | LINE (immediate) |
| 🟠 ALERT | OEE < 50% | Factory manager | LINE (immediate) |
| 🟡 WARNING | Yield drop 5-10% | QA | LINE (daily digest) |
| 🟡 WARNING | Downtime > 30min | Line supervisor | LINE (daily digest) |
| 🟡 WARNING | Fool-proof coverage < 80% | Process engineer | LINE (weekly) |
| 🔵 INFO | WO released ready to start | Line supervisor | LINE (as it happens) |

### AI Prompt Template

```
## MES AI Manager — Analysis Request

Factory data snapshot — {timestamp}

<LINES>
{json}
</LINES>

<RUNS>
{json}
</RUNS>

<STATION_EVENTS>
{json}
</STATION_EVENTS>

<STAGNATION>
{json}
</STAGNATION>

<SCRAPS>
{json}
</SCRAPS>

<DOWNTIMES>
{json}
</DOWNTIMES>

<FEEDER_BINDINGS>
{json}
</FEEDER_BINDINGS>

Context: You are an MES AI Manager for a Vietnam SMT factory.
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [...],
  "yield_alerts": [...],
  "stagnation_actions": [...],
  "scrap_decisions": [...],
  "downtime_flags": [...],
  "oee_report": {...},
  "summary": "一句话总结当前产线状态"
}}
</ANALYSIS>
```

### Known Limitations

1. **No direct PLC integration**: Line status comes from manual updates + event patterns, not real-time PLC signals
2. **No camera at every station**: Visual inspection only at stations with cameras (AOI/SPI) or on-demand
3. **OEE ideal cycle time**: Must be configured per product; missing config defaults to 60s
4. **Yield baseline**: Requires 7 days of data to establish baseline; new stations use global defaults
5. **Stagnation thresholds**: Must be configured per station type; defaults assume SMT line flow
6. **Offline Ornith**: If Ollama is down, system falls back to rule-based decisions only
7. **No AGV integration**: Physical PCB movement still manual; tracking via barcode scan only

---

## Inter-Agent Communication — MES Skills

All factory AI managers (MES, WMS, BOM, HR, RDA) communicate via a shared **PostgreSQL message queue** (`inter_agent_messages` table) and direct **subprocess SYNC calls**. See `MES_INTER_AGENT_COMMS.md` for the full specification.

### Agent IDs

| Agent | ID | Patrol Interval |
|---|---|---|
| MES | `mes-ai` | 15 min |
| WMS | `wms-ai` | 30 min |
| BOM | `bom-ai` | 30 min |
| HR | `hr-ai` | 30 min |
| RDA | `rda-ai` | Daily |

---

### MES Skill 26: MES → WMS Communication

**Trigger**: Every patrol cycle (after Ornith analysis, before LINE alerts)

**Outbound messages sent to WMS**:

| Ornith Finding | WMS Message | Subject | Priority | When |
|---|---|---|---|---|
| Yield drop + active WO | `material_needed` | Yield drop → possible material shortage | `warning`→`critical` | Every yield alert with active run |
| Run completed or closed | `line_finished` | Notify WMS to prepare line return | `normal` | When WO status = completed/closed |
| Feeder mismatch (block) | `feeder_mismatch` | Urgent: wrong material on feeder | `critical` | Every feeder block |
| Ornith approves/rejects scrap | `scrap_at_line` | Create WMS scrap transaction | `normal` | Every auto-executed scrap |
| New WO released | `request_issue` | Request material to be issued for upcoming WO | `normal` | When new released WO detected |

**Example outbound — feeder mismatch**:
```
→ sendAgentMessage("wms-ai", "feeder_mismatch", {
    station_code: "SM01",
    expected_material: "R-0603-10K",
    actual_material: "R-0603-100K",
    feeder_slot: "F12",
    line_code: "SMT-01",
  }, { priority: "critical" })
```

**Inbound messages from WMS (MES handles)**:

| Subject | Handler | Action |
|---|---|---|
| `material_issued` | `handleMaterialIssued` | Verify feeder binding exists; alert if material issued but not bound |
| `iqc_released` | `handleIqcReleased` | Log: lot now available for feeder binding |
| `iqc_hold` | `handleIqcHold` | Alert line supervisor if held material is on a feeder |
| `scrap_created` | `handleScrapCreated` | Remove from line-side inventory tracking |
| `line_return` | `handleLineReturn` | Acknowledge; close any open feeder binding |
| `low_stock_warning` | `handleLowStockWarning` | Include in next Ornith patrol analysis |
| `msd_alert` | `handleMsdAlert` | Alert line supervisor immediately: baking required |

---

### MES Skill 27: MES ↔ BOM Communication

**MES → BOM triggers**:

| Ornith Finding | BOM Message | Subject | When |
|---|---|---|---|
| Yield drop at specific station | `component_failure_rate` | Defect rate by material code for supplier quality review | Every critical yield alert |
| Stagnation with known WO | `bom_usage_feedback` | Actual consumption vs BOM expected — for BOM accuracy | Every stagnation with completed consumption data |
| Feeder mismatch | `material_substitution_needed` | Ask BOM if actual material is a valid substitute | Every feeder block |

**BOM → MES handlers**:

| Subject | Handler | Action |
|---|---|---|
| `bom_updated` | `handleBomUpdated` | Check if any active runs use affected product; alert if running with old BOM |
| `alternative_available` | `handleAlternativeAvailable` | Update feeder binding rules to accept valid substitute |
| `bom_accuracy_alert` | `handleBomAccuracyAlert` | Immediate LINE alert + block line: BOM/actual mismatch is critical |

---

### MES Skill 28: MES ↔ HR Communication

**MES → HR triggers**:

| Ornith Finding | HR Message | Subject | Priority | When |
|---|---|---|---|---|
| Line alert mentions understaffed | `line_understaffed` | Staffing gap at specific station | `high` | Line alert with `understaffed` in title |
| Operator-level yield data | `operator_performance` | Yield KPI by operator (for performance review) | `normal` | When station events include operator_id |
| Feeder block with cert reason | `station_cert_gap` | Operator lacks required cert for station | `critical` | Feeder block with `cert` in reason |
| Repeated defect at same station | `training_needed` | Same defect 10x+ in patrol window → skill gap | `normal` | Aggregated defect count per patrol |

**HR → MES handlers**:

| Subject | Handler | Action |
|---|---|---|
| `operator_absent` | `handleOperatorAbsent` | Flag line as understaffed; include in staffing assessment |
| `shift_change` | `handleShiftChange` | Update operator tracking for station events |
| `certification_expiring` | `handleCertificationExpiring` | Log for awareness; warn if cert expires soon |
| `new_operator_assigned` | `handleNewOperatorAssigned` | Add to operator tracking for station events |
| `ot_limit_warning` | `handleOtLimitWarning` | Note for shift reassignment planning |

---

### MES Skill 29: MES ↔ RDA Communication

**MES → RDA triggers**:

| Ornith Finding | RDA Message | Subject | Priority | When |
|---|---|---|---|---|
| Critical yield drop | `analysis_request` | Request historical yield + downtime + scrap data | `high` | Once per patrol cycle when critical yield alert fires |
| Material-related defect | `defect_pattern_query` | Statistical clustering analysis | `normal` | Every material-related yield alert |
| Trend analysis needed | `analysis_request` | Ask RDA for long-term OEE trends | `normal` | Weekly quality review patrol |

**RDA → MES handlers**:

| Subject | Handler | Action |
|---|---|---|
| `report_ready` | `handleReportReady` | Log for weekly quality review |
| `anomaly_detected` | `handleAnomalyDetected` | Immediate LINE alert with statistical evidence |
| `trend_alert` | `handleTrendAlert` | Include in root cause analysis patrol |

---

### MES Skill 30: Agent Bus Infrastructure

**Message Queue Table**: `inter_agent_messages`
```sql
CREATE TABLE inter_agent_messages (
  id              BIGSERIAL PRIMARY KEY,
  message_id      VARCHAR(64)  NOT NULL UNIQUE,
  source_agent    VARCHAR(32) NOT NULL,
  target_agent    VARCHAR(32) NOT NULL,
  message_type    VARCHAR(32) NOT NULL,   -- request|response|event|broadcast
  subject         VARCHAR(128) NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  correlation_id VARCHAR(64),
  priority       VARCHAR(16)  DEFAULT 'normal',  -- critical|high|normal|low
  status         VARCHAR(16)  DEFAULT 'pending',  -- pending|processing|completed|failed|dead
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  error_message  TEXT
);
```

**Shared Library**: `services/_shared/agent-bus.js`

```javascript
import {
  sendAgentMessage,    // async: write message to queue
  pollAgentMessages,  // async: fetch pending messages for this agent
  completeAgentMessage, // async: mark message as completed
  failAgentMessage,   // async: mark as failed
  initAgentBus,       // async: create table if not exists
  callAgentQuery,     // async: SYNC call to another agent's query script
} from "../_shared/agent-bus.js";
```

**Patrol Cycle Integration**:
```
Patrol Cycle:
  1. Query MES data (mes-query.js)
  1b. Poll + process inbound messages (processAgentMessages)  ← NEW
  2. Delta detection
  3. Ask Ornith
  4. Parse Ornith output
  5. Execute decisions (mes-execute.js)
  5b. Send outbound messages to WMS/BOM/HR/RDA  ← NEW
  6. Save pending approvals
  7. Self-evaluate (mes-evaluator.js)
  8. Send LINE alerts
  9. Save patrol state
```

**Polling pattern**:
```javascript
async function processAgentMessages() {
  await ensureBusInit();
  const messages = await pollAgentMessages("mes-ai", 20);
  for (const msg of messages) {
    const handler = MESSAGE_HANDLERS[msg.subject];
    try {
      await handler(msg.payload);
      await completeAgentMessage(msg.message_id);
    } catch (err) {
      await failAgentMessage(msg.message_id, err.message);
    }
  }
}
```

**SYNC calls to other agents** (direct `node <script>` subprocess):
```javascript
// WMS: check material lot status
const lotStatus = await callAgentQuery(
  "services/worker/watchdog-query.js", "stock",
  { material: materialCode }
);

// BOM: get BOM exploded for a product
const bom = await callAgentQuery(
  "services/worker/bom-query.js", "bom-explode",
  { product: productCode }
);

// HR: get shift schedule for a line
const operators = await callAgentQuery(
  "services/worker/hr-query.js", "shift-schedule",
  { line: lineCode }
);

// RDA: get yield trend
const trend = await callAgentQuery(
  "services/worker/rda-query.js", "yield-trend",
  { line: lineCode, days: "7" }
);
```

**Standard response envelope** (all agents conform):
```json
{ "ok": true, "data": [...], "meta": { "agent": "wms-ai", "scope": "...", "queried_at": "...", "duration_ms": 42 } }
```

**DB Migration needed**:
```bash
psql -f database/migrations/002_inter_agent_messages.sql
```

**Env var**: Each manager sets `AGENT_ID` before running:
```bash
AGENT_ID=mes-ai node services/worker/mes-manager.js patrol
AGENT_ID=wms-ai node services/worker/wms-manager.js patrol
AGENT_ID=bom-ai node services/worker/bom-manager.js patrol
AGENT_ID=hr-ai  node services/worker/hr-manager.js patrol
AGENT_ID=rda-ai node services/worker/rda-manager.js patrol
```

---

## WMS ↔ Other Agents

### WMS Skill W1: WMS → MES Communication

**Trigger**: After every WMS patrol cycle (after Ornith analysis, before LINE alerts)

**Outbound messages to MES**:

| Ornith Finding | MES Message | Subject | Priority | When |
|---|---|---|---|---|
| IQC decision = release | Material lot passed IQC | `iqc_released` | `normal` | Every auto-approved IQC release |
| IQC decision = hold | Lot placed on quality hold | `iqc_hold` | `high` | Every IQC hold |
| Ornith approves/rejects scrap | Scrap transaction created | `scrap_created` | `normal` | Every auto-executed scrap |
| Line returns unused material | Material returned to warehouse | `line_return` | `normal` | Every line return |
| Low stock detected | Material days remaining < threshold | `low_stock_warning` | `warning`→`critical` | Every low stock alert |
| MSD exposure limit alert | Moisture-sensitive material baking needed | `msd_alert` | `high`→`critical` | When MSD limit approached/exceeded |
| Manual stock correction | Inventory recount adjustment | `stock_take_correction` | `normal` | Every manual adjustment |

**Example outbound — IQC released**:
```
→ sendAgentMessage("mes-ai", "iqc_released", {
    lot_no: "VN-LOT-001",
    material_code: "R-0603-10K",
    qty: 5000,
    released_at: "2026-06-28T08:00:00Z"
  })
```

### WMS Skill W2: WMS ← MES Communication

**Inbound messages from MES (WMS handles)**:

| Subject | Handler | Action |
|---|---|---|
| `material_needed` | `handleMaterialNeeded` | Expedite pick + issue material to line; log urgency |
| `line_finished` | `handleLineFinished` | Prepare for line return; update lot status |
| `feeder_mismatch` | `handleFeederMismatch` | Immediate LINE alert; block further issues to affected feeder |
| `scrap_at_line` | `handleScrapAtLine` | Create WMS scrap transaction; update lot quantity |
| `request_issue` | `handleRequestIssue` | Generate pick order; issue materials to line for next WO |

### WMS Skill W3: WMS ↔ BOM Communication

**WMS → BOM**:

| Subject | Trigger | Payload |
|---|---|---|
| `component_failure_rate` | High defect rate at IQC/by material | `{ material_code, defect_rate_pct, station_type, defect_code, period_days }` |

**WMS ← BOM**:

| Subject | Handler | Action |
|---|---|---|
| `bom_updated` | `handleBomUpdated` | Log ECO change; may affect BOM-based picking |
| `alternative_available` | `handleAlternativeAvailable` | Accept substitute material in pick logic |
| `bom_accuracy_alert` | `handleBomAccuracyAlert` | LINE alert: BOM/actual mismatch at IQC |

### WMS Skill W4: WMS ↔ HR Communication

**WMS → HR**:

| Subject | Trigger | Payload |
|---|---|---|
| `work_order_critical` | Ornith flags priority WO | `{ work_order_code, line_code, priority, reason }` |
| `operator_leave_coverage` | Staffing gap from material handling perspective | `{ line_code, operator_employee_no, leave_dates, coverage_needed }` |

**WMS ← HR**:

| Subject | Handler | Action |
|---|---|---|
| `material_shortage_alert` | `handleMaterialShortageAlert` | HR aware of labor impact on warehouse ops |

### WMS Skill W5: WMS ↔ RDA Communication

**WMS → RDA**:

| Subject | Trigger | Payload |
|---|---|---|
| `bom_usage_feedback` | Material consumption vs BOM expected | `{ work_order_code, material_code, bom_qty_per, actual_avg_consumption, sample_size }` |

**WMS ← RDA**:

| Subject | Handler | Action |
|---|---|---|
| `defect_pattern_query` | `handleDefectPatternQuery` | Statistical analysis of material-related defects |

---

## BOM ↔ Other Agents

### BOM Skill B1: BOM → MES Communication

**Trigger**: After BOM patrol cycle (ECO approval, BOM change, alternative found)

**Outbound messages to MES**:

| Ornith Finding | MES Message | Subject | Priority | When |
|---|---|---|---|---|
| ECO approved | BOM version changed for a product | `bom_updated` | `high` | Every approved ECO |
| Alternative substitute found | BOM suggests alternate for shortage | `alternative_available` | `normal` | When BOM finds pin-compatible alternate |
| BOM audit found mismatch | BOM/actual mismatch on line | `bom_accuracy_alert` | `critical` | Every confirmed BOM accuracy breach |

**Example outbound — alternative available**:
```
→ sendAgentMessage("mes-ai", "alternative_available", {
    original_material: "IC-MCU-RJ32",
    alternative_material: "IC-MCU-RJ32A",
    substitution_reason: "Pin-compatible, same specs",
    supplier: "越南电子"
  })
```

### BOM Skill B2: BOM ← MES Communication

**Inbound messages from MES (BOM handles)**:

| Subject | Handler | Action |
|---|---|---|
| `material_substitution_needed` | `handleMaterialSubstitutionNeeded` | Check if actual material is valid substitute; update BOM if yes |
| `component_failure_rate` | `handleComponentFailureRate` | Flag for supplier quality review; consider ECO if rate exceeds threshold |
| `bom_usage_feedback` | `handleBomUsageFeedback` | Adjust loss_rate in BOM if actual consumption differs significantly |

### BOM Skill B3: BOM ↔ WMS Communication

**BOM → WMS**: See WMS Skill W3 above

**BOM ← WMS**: See WMS Skill W3 above

### BOM Skill B4: BOM ↔ HR Communication

**BOM → HR**:

| Subject | Trigger | Payload |
|---|---|---|
| `training_material_impact` | New material requiring operator training | `{ line_code, training_topic, affected_materials }` |

**BOM ← HR**:

| Subject | Handler | Action |
|---|---|---|
| `bom_operator_impact` | `handleBomOperatorImpact` | HR aware of ECO impact on operator skills |

### BOM Skill B5: BOM ↔ RDA Communication

**BOM → RDA**:

| Subject | Trigger | Payload |
|---|---|---|
| `component_failure_rate` | Supplier quality concern from BOM | `{ component_code, failure_rate, sample_size, line_code }` |

**BOM ← RDA**: (uses MES as intermediary for data requests)

---

## HR ↔ Other Agents

### HR Skill H1: HR → MES Communication

**Trigger**: After HR patrol cycle (Ornith analysis)

**Outbound messages to MES**:

| Ornith Finding | MES Message | Subject | Priority | When |
|---|---|---|---|---|
| Critical attendance anomaly | Employee didn't clock in | `operator_absent` | `high` | Every critical absent alert |
| Shift schedule updated | Operator reassignment | `shift_change` | `normal` | Every approved shift change |
| Certification expiring | Operator cert expires < 30 days | `certification_expiring` | `normal` | Every cert expiry alert |
| New operator assigned | New hire added to line | `new_operator_assigned` | `normal` | Every new operator onboarding |
| OT approaching legal limit | Employee OT hours exceed threshold | `ot_limit_warning` | `high` | Every OT limit warning |

**Example outbound — operator absent**:
```
→ sendAgentMessage("mes-ai", "operator_absent", {
    employee_id: "EMP-2026-0089",
    name: "Nguyen Van A",
    shift_type: "DAY",
    line_code: "SMT-01",
    station_type: "AOI"
  })
```

### HR Skill H2: HR ← MES Communication

**Inbound messages from MES (HR handles)**:

| Subject | Handler | Action |
|---|---|---|
| `line_understaffed` | `handleLineUnderstaffed` | Dispatch available operator; flag shift coverage gap |
| `operator_performance` | `handleOperatorPerformance` | Store in performance records for KPI |
| `station_cert_gap` | `handleStationCertGap` | Urgent LINE alert; arrange immediate training |
| `training_needed` | `handleTrainingNeeded` | Schedule refresher training for SPI operators |

### HR Skill H3: HR ↔ WMS Communication

**HR → WMS**:

| Subject | Trigger | Payload |
|---|---|---|
| `operator_leave_coverage` | Employee leave approved | `{ line_code, operator_employee_no, leave_dates, coverage_needed }` |

**HR ← WMS**:

| Subject | Handler | Action |
|---|---|---|
| `material_shortage_alert` | `handleMaterialShortage` | HR aware of warehouse impact on production |

### HR Skill H4: HR ↔ RDA Communication

**HR → RDA**:

| Subject | Trigger | Payload |
|---|---|---|
| `hr_data_for_analysis` | Attendance/OT analysis requested | `{ request_id, data_scope, filters }` |

**HR ← RDA**:

| Subject | Handler | Action |
|---|---|---|
| `attendance_anomaly_report` | `handleAttendanceAnomalyReport` | Anomaly pattern in attendance data |
| `workload_analysis` | `handleWorkloadAnalysis` | OT trend and workload distribution analysis |

### HR Skill H5: HR ← BOM Communication

**Inbound from BOM**:

| Subject | Handler | Action |
|---|---|---|
| `bom_operator_impact` | `handleBomOperatorImpact` | Track which operators need retraining for new BOM |
| `material_spec_change` | `handleMaterialSpecChange` | New material specs may affect operator procedures |

---

## RDA ↔ Other Agents

### RDA Skill R1: RDA → MES Communication

**Trigger**: After RDA patrol/insights cycle

**Outbound messages to MES**:

| Source | MES Message | Subject | Priority | When |
|---|---|---|---|---|
| Scheduled report ready | Archive report completed | `report_ready` | `normal` | Every daily/weekly archive |
| Anomaly detected | Statistical anomaly in historical data | `anomaly_detected` | `high`→`critical` | When z-score > 3 or p-value < 0.01 |
| Trend analysis | Long-term trend detected | `trend_alert` | `normal` | When degradation trend confirmed |

**Example outbound — anomaly detected**:
```
→ sendAgentMessage("mes-ai", "anomaly_detected", {
    source: "station_events",
    metric: "yield",
    station_type: "AOI",
    line_code: "SMT-02",
    expected_range: [95.0, 99.0],
    actual: 82.0,
    z_score: 3.4,
    period: "2026-06-21 to 2026-06-28"
  })
```

### RDA Skill R2: RDA ← MES Communication

**Inbound messages from MES (RDA handles)**:

| Subject | Handler | Action |
|---|---|---|
| `analysis_request` | `handleAnalysisRequest` | Query archives; return historical data + statistical analysis |
| `defect_pattern_query` | `handleDefectPatternQuery` | Statistical clustering of defect data by material/station/time |

### RDA Skill R3: RDA ↔ WMS Communication

**RDA → WMS**:

| Subject | Trigger | Payload |
|---|---|---|
| `bom_usage_feedback` | BOM consumption analysis from WMS data | `{ material_code, actual_qty, bom_qty, line_code }` |

**RDA ← WMS**:

| Subject | Handler | Action |
|---|---|---|
| `defect_pattern_query` | `handleDefectPatternQuery` | Analyze material-related defect patterns |

### RDA Skill R4: RDA ↔ HR Communication

**RDA → HR**:

| Subject | Trigger | Payload |
|---|---|---|
| `attendance_anomaly_report` | Anomaly in attendance data | `{ employee_no, anomaly_type, severity }` |
| `workload_analysis` | OT and workload distribution | `{ line_code, ot_hours, period }` |

**RDA ← HR**:

| Subject | Handler | Action |
|---|---|---|
| `hr_data_for_analysis` | `handleHrDataRequest` | Respond with attendance, leave, OT data |

---

## PMC AI Manager — Communication Skills

PMC manages work order scheduling, kit readiness, delivery risk, and line capacity. It communicates with MES, WMS, HR, and RDA via the agent bus.

**Agent ID**: `pmc-ai`
**Patrol**: Every 30 minutes (via `patrolCycle()`)
**Bus table**: `inter_agent_messages`

### PMC Skill P1: PMC → MES Communication

**Trigger**: After PMC patrol cycle (Ornith analysis)

**Outbound messages to MES**:

| Ornith Finding | MES Message | Subject | Priority | When |
|---|---|---|---|---|
| WO status changed | WO released or put on hold | `wo_schedule_changed` | `normal`→`high` | Every WO schedule action |
| Line utilization changed | Line capacity update | `line_capacity_update` | `normal` | Capacity analysis complete |

**Example outbound — WO schedule changed**:
```
→ sendAgentMessage("mes-ai", "wo_schedule_changed", {
    wo_code: "26061020007",
    new_status: "released",
    reason: "kit_ready"
  })
```

### PMC Skill P2: PMC ← MES Communication

**Inbound messages from MES (PMC handles)**:

| Subject | Handler | Action |
|---|---|---|
| `line_productivity_update` | `handleLineProductivityUpdate` | Update line capacity/performance data |
| `data_request` | `handleDataRequest` | Respond with PMC data (WO status, capacity) |

### PMC Skill P3: PMC ↔ WMS Communication

**PMC → WMS**:

| Subject | Trigger | Payload |
|---|---|---|
| `material_shortage` | WO needs material not in stock | `{ material_code, required_qty, wo_code, urgency }` |
| `kit_alert` | Kit readiness < 100% | `{ wo_code, kit_ready_pct, shortage_items }` |

**PMC ← WMS**:

| Subject | Handler | Action |
|---|---|---|
| `material_shortage_resolved` | `handleMaterialShortageResolved` | Update WO kit status; re-check readiness |

### PMC Skill P4: PMC ↔ HR Communication

**PMC → HR**:

| Subject | Trigger | Payload |
|---|---|---|
| `operator_shortage` | Line needs operators | `{ line_code, shift, shortage_count }` |

### PMC Skill P5: PMC ↔ RDA Communication

**PMC → RDA**:

| Subject | Trigger | Payload |
|---|---|---|
| `delivery_prediction` | Delivery risk analysis needed | `{ po_number, customer_name, due_date, risk_level, confidence }` |

**PMC ← RDA**:

| Subject | Handler | Action |
|---|---|---|
| `delivery_forecast_update` | `handleDeliveryForecastUpdate` | Update delivery risk based on RDA analysis |

---

## SOP Managers — Communication Skills

SOP managers (`mes-sop-manager.js`, `wms-sop-manager.js`) run JSON-defined state-machine patrol workflows and notify the MES agent on cycle completion or failure. They do not handle inbound messages — they are consumers of patrol state.

**Agent IDs**: `mes-sop-ai`, `wms-sop-ai`

### SOP Skill S1: SOP → MES Communication

**Trigger**: After every SOP `run` or `resume` cycle

**Outbound messages to MES**:

| Event | Subject | Payload |
|---|---|---|
| SOP cycle complete | `sop_cycle_complete` | `{ sop_name, cycle_id, steps_run, outcome, completed_at }` |
| SOP step error | `system_alert` | `{ alert_level: "high", source_agent, subject, detail }` |

**Example outbound — SOP cycle complete**:
```
→ sendAgentMessage("mes-ai", "sop_cycle_complete", {
    sop_name: "mes-sop",
    cycle_id: "wc-mqxcdfza",
    steps_run: 7,
    outcome: "completed",
    completed_at: "2026-06-28T08:45:00Z"
  })
```

**Example outbound — SOP step error**:
```
→ sendAgentMessage("mes-ai", "system_alert", {
    alert_level: "high",
    source_agent: "wms-sop-ai",
    subject: "SOP error: step_iqc",
    detail: "wms-sop step step_iqc failed: lot not found"
  })
```

### SOP Skill S2: SOP Bus Wiring

Both SOP managers call `processAgentMessages()` once per cycle run to handle any inbound messages, though they have no registered handlers (they are broadcast-only emitters).

```javascript
// mes-sop-manager.js and wms-sop-manager.js
import { sendAgentMessage, pollAgentMessages, completeAgentMessage, initAgentBus } from "../_shared/agent-bus.js";

async function ensureBusInit() {
  try { await initAgentBus(); } catch (_) {}
}

async function notifySopComplete(sopName, cycleId, stepsRun, outcome) {
  await ensureBusInit();
  await sendAgentMessage("mes-ai", "sop_cycle_complete", {
    sop_name: sopName, cycle_id: cycleId, steps_run: stepsRun, outcome,
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}
```
