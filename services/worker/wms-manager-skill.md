# WMS AI Manager — Virtual Agent Skills

## Agent Profile

**Name**: WMS AI Manager (`仓库AI管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no data leaves factory)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Escalation**: LINE notifications for critical WMS decisions; human-in-the-loop for high-stakes actions
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
┌──────────────▼──────────────────────────────┐
│  wms-manager.js (Node.js)                  │
│  1. Query DB (wms-query.js)              │
│  2. Feed Ornith for reasoning             │
│  3. Parse decisions                         │
│  4. Execute via API or log                 │
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
|---|
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
node wms-vision-inspect.js reel    --image /path/to/reel.jpg
node wms-vision-inspect.js defect  --image /path/to/iqc-photo.jpg
node wms-vision-inspect.js msd    --image /path/to/bag-seal.jpg
node wms-vision-inspect.js label  --image /path/to/label.jpg
node wms-vision-inspect.js defect --camera   # capture from webcam
node wms-vision-inspect.js defect --url http://192.168.1.100/capture.jpg  # IP camera
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
|---|
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
      "id": "step_delta",
      "name": "Delta Detection",
      "type": "SCRIPT",
      "function": "detectChanges",
      "outputVar": "newNgLots, newWo",
      "next": "step_ornith"
    },
    {
      "id": "step_ornith",
      "type": "LLM",
      "model": "ornith",
      "outputVar": "analysis",
      "timeoutSec": 120,
      "onError": "SKIP_TO step_audit",
      "next": "step_execute"
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
    C --> D({4️⃣ 执行分支})
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

**CLI**:
```bash
node wms-sop-manager.js run                   # Run patrol following SOP
node wms-sop-manager.js render-mermaid      # Output current Mermaid diagram
node wms-sop-manager.js state               # Show live execution state
node wms-sop-manager.js history             # Show last 10 cycles
node wms-sop-manager.js validate           # Validate SOP JSON
node wms-sop-manager.js edit reorder step_ornith,6   # Move step
node wms-sop-manager.js edit toggle step_msd          # Disable step
node wms-sop-manager.js edit timeout step_ornith,180  # Change timeout
node wms-sop-manager.js edit save           # Save + activate new version
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

## Implementation Files

| File | Purpose |
|---|
| `wms-manager.js` | Main manager: patrol loop, decision execution, LINE integration |
| `wms-query.js` | DB query tool: iqc-ng, work-orders, wms-health, quality, all |
| `wms-execute.js` | Action executor: iqc decisions, pick, issue, return, scrap, put-away |
| `wms-evaluator.js` | Judge LLM scoring: score-recent, score-all, tune-thresholds, report |
| `wms-sop-manager.js` | SOP engine: run, render-mermaid, state, history, validate |
| `wms-vision-inspect.js` | Vision inspection: reel, msd-seal, label, receiving, iqc |
| `wms-sop.json` | SOP definition file |
| `wms-sop-state.json` | Live SOP execution state |
| `pda-receiving.js` | PDA receiving workflow |
| `pda-iqc.js` | PDA IQC inspection workflow |
| `Invoke-WMSPatrol.ps1` | PowerShell wrapper for wms-manager.js patrol |
| `Invoke-WMSDigest.ps1` | PowerShell wrapper for morning digest |
| `Invoke-WMSCheck.ps1` | Scheduled WMS health check |

---

## Tool Reference

### wms-query.js
```
node wms-query.js [scope]
  scope: iqc-ng | work-orders | wms-health | quality | all
```

### wms-execute.js
```
node wms-execute.js <action> [options]
  Actions: iqc-decide | pick-order | issue-to-line | return-from-line | scrap | put-away | receive | audit-log
```

### wms-evaluator.js
```
node wms-evaluator.js score-recent [--limit N]
node wms-evaluator.js score-all --days N
node wms-evaluator.js tune-thresholds
node wms-evaluator.js report --days N
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

**Audit Log Table**:
```sql
create table if not exists wms_manager_audit_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  agent varchar(40) not null default 'wms-ai',
  area varchar(40) not null,             -- iqc|wo|wms|quality|msd
  decision_type varchar(60) not null,   -- iqc_release|iqc_hold|iqc_reject|pick|issue|scrap|...
  lot_no varchar(80),
  work_order_code varchar(20),
  input_data jsonb,
  output_decision jsonb,
  executed boolean not null default false,
  executor varchar(40) default 'wms-ai',
  line_alert_sent boolean default false,
  feedback varchar(20),                  -- correct|incorrect|null
  override_by varchar(60),
  notes text
);
```

---

## Inter-Agent Communication

### WMS ↔ MES

**WMS → MES**:
- `material_issued` — inform MES material issued to line (so MES can verify feeder binding)
- `iqc_released` — inform MES lot passed IQC and is available
- `iqc_hold` — inform MES lot is on hold (if on feeder, alert supervisor)
- `scrap_created` — inform MES material scrapped
- `line_return` — inform MES material returned from line
- `low_stock_warning` — inform MES material running low
- `msd_alert` — inform MES MSD material approaching exposure limit

**MES → WMS**:
- `material_needed` — MES requests WMS to expedite material to line
- `line_finished` — MES reports WO completed, WMS handles material return
- `feeder_mismatch` — MES reports feeder binding error, WMS to investigate
- `request_issue` — MES requests WMS to issue specific material to line

### WMS ↔ BOM

**WMS → BOM**:
- `material_shortage` — BOM to source alternative or expedite
- `bom_accuracy_alert` — WMS reports BOM mismatch found at receiving

**BOM → WMS**:
- `alternative_available` — BOM suggests material substitution
- `bom_updated` — BOM version changed, WMS to update picking rules

### WMS ↔ PMC

**WMS → PMC**:
- `wo_material_shortage` — WMS reports shortage blocking WO release
- `wo_material_ready` — WMS confirms 100% kit readiness

**PMC → WMS**:
- `wo_released` — PMC releases WO, WMS to prepare material kit
- `wo_cancelled` — WMS to return reserved materials

### WMS ↔ HR

**WMS → HR**:
- `work_order_critical` — WO at risk due to staffing
- `material_shortage` — material shortage affecting production

**HR → WMS**:
- `operator_absent` — receiving/IQC staffing impact
- `shift_change` — staffing update affecting warehouse operations

---

## Known Limitations

1. **No vision for physical reel inspection**: Cannot inspect physical reels — rely on barcode/ label data only
2. **No electronic scale**: Quantity verified by count only
3. **No live MES integration**: Work order completion not auto-synced — patrol fills gap
4. **BOM dependency**: Pick orders require active BOM; missing BOM = cannot generate pick list
5. **Single language**: Ornith prompt in Chinese; LINE output in Chinese; VT/VN staff need translation layer
6. **Offline Ornith**: If Ollama is down, system falls back to rule-based decisions only (no LLM reasoning)
7. **No AMR/AGV integration**: Physical material movement still manual
8. **No real-time stock**: Balance is derived from transaction history, not real-time — slight lag possible

---

## Related Files

- `virtualagentskills.md` — Master virtual agent skills document (WMS, BOM, HR, MES, PMC managers)
- `mes-manager-skill.md` — MES AI Manager standalone skill
- `bom-manager-skill.md` — BOM AI Manager standalone skill
- `services/api/` — API server implementing WMS endpoints
- `apps/web/src/api/wms.ts` — Frontend WMS API client (DTO definitions)
- `apps/web/src/wms/` — WMS UI components
- `database/migrations/001_initial_factory_schema.sql` — WMS table definitions
