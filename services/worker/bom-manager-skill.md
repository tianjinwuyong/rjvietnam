# BOM AI Manager — Virtual Agent Skills

## Agent Profile

**Name**: BOM AI Manager (`BOM管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no data leaves factory) + OpenCode (code execution)
**Execution**: PowerShell scripts + Node.js DB queries + OpenCode (file/code operations) + API calls
**Escalation**: LINE notifications for critical BOM decisions; human-in-the-loop for high-stakes changes
**Memory**: Last-state JSON for delta detection between cycles
**Audit**: Every action logged with timestamp, operator, reason

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)   │
│  Every 30 min: BOM patrol, shortage check   │
│  07:30: morning BOM digest to LINE         │
│  17:00: daily BOM report                  │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  bom-manager.js (Node.js)                   │
│  1. Query DB (bom-query.js)               │
│  2. Feed Ornith for BOM reasoning          │
│  3. Parse decisions                        │
│  4. Execute via API, PowerShell, or log   │
│  5. Send LINE alerts                       │
└──────────────┬──────────────────────────────┘
               │
     ┌─────────┼──────────┐
     │         │          │
  PostgreSQL  Ornith    OpenCode
   (data)   (reason)  (code/ps1)
```

---

## Core Skills

### Skill 1: BOM Creation & Maintenance Agent

**Trigger**: New product introduced, BOM change requested, or on-demand

**Responsibilities**:
- Create new BOMs: enter parent item, components, quantities, operations, work centers
- Update existing BOMs: add/remove components, change quantities, revise operations
- Validate BOM completeness: all components listed, quantities correct, operations sequenced
- Support multi-level BOMs: parent → sub-assemblies → components
- Track BOM revisions: maintain version history with effectivity dates
-同步EBOM↔MBOM: coordinate engineering BOM with manufacturing BOM

**Tool**: `POST /bom` + `PATCH /bom/:id` + `GET /bom/:productCode` + PowerShell for ERP sync

**BOM Types Handled**:
- `EBOM` — Engineering Bill of Materials (design-level)
- `MBOM` — Manufacturing Bill of Materials (production-level)
- `SBOM` — Service Bill of Materials (aftermarket/ repair)
- `Planning BOM` — rough-cut planning without full detail

---

### Skill 2: Work Order from BOM Agent

**Trigger**: Sales order confirmed, production plan released, or manual WO request

**Process**:
```
FOR each released WO request:
  1. Lookup BOM for the finished product
  2. Expand multi-level BOM (explode sub-assemblies)
  3. FOR each BOM line (material):
     a. Check inventory availability
     b. Calculate required qty = qty_per × planned_qty × (1 + loss_rate)
     c. Identify shortage if available < required
  4. Generate work order with:
     - WO number (auto-sequence)
     - BOM revision reference
     - Material lines with availability status
     - Operations/ work center assignments
     - Estimated cost (material + labor)
  5. If stock insufficient → flag shortage, do NOT release WO
  6. Post WO to ERP: POST /pmc/work-orders
```

**Tool**: `GET /bom/:productCode` + `GET /wms/stock` + `POST /pmc/work-orders`

---

### Skill 3: Material Shortage & Availability Agent

**Trigger**: Every 30 min patrol + when WO is released

**Checks**:
1. **Shortage Detection**
   - For each released WO: compare required vs available inventory
   - Threshold: < 100% → status = "SHORTAGE"
   - Critical: < 80% → immediate LINE alert
   - Action: auto-hold WO until materials available or substitute found

2. **Excess Inventory Detection**
   - Material sitting > 90 days with no WO consumption
   - Suggest: return-to-vendor or reallocation

3. **Shelf Life Risk**
   - Material with < 30 days shelf life on WO BOM
   - Flag for expedited use or write-off

4. **Alternate BOM / Substitute**
   - If primary component unavailable: suggest alternate part number
   - Verify alternate is approved in BOM or engineering

**Tool**: `bom-query.js --scope material-readiness` + Ornith analysis

---

### Skill 4: BOM Change Management (ECO Agent)

**Trigger**: Engineering change request, material substitution, or process update

**Process**:
```
FOR each ECO (Engineering Change Order):
  1. Validate change scope:
     - Affected BOMs (which products use this component?)
     - Affected WOs (which active orders use old BOM revision?)
     - Inventory impact (old component stock, new component lead time)
  2. Determine effectivity:
     - Immediate (for rework/ repair)
     - Date-based (next WO batch)
     - Lot-based (from specific lot forward)
  3. Calculate:
     - Old BOM vs new BOM cost delta
     -新旧组件切换成本
     - 库存处置方案 (use old stock first? scrap? return?)
  4. Escalate if:
     - Cost impact > threshold → human approval
     - Safety/ regulatory implication → QA sign-off
  5. Execute change:
     - Update BOM revision
     - Archive old BOM (keep for history)
     - Notify affected departments
```

**ECO Types**: `component_replace`, `quantity_change`, `operation_change`, `new_bom_revision`, `bom_cancellation`

**Tool**: `POST /eco` + `PATCH /bom/:id` + PowerShell ERP integration

---

### Skill 5: BOM Cost & Pricing Agent

**Trigger**: On-demand + monthly cost roll-up

**Calculations**:
- **Material Cost**: SUM(component unit cost × qty_per) per BOM level
- **Operation Cost**: SUM(work center hourly rate × operation time) per routing
- **Total BOM Cost**: material cost + operation cost + overhead rate
- **Sales Price Suggestion**: cost × markup factor (configurable per product family)

**Cost Roll-Up** (multi-level BOM):
```
FOR each sub-assembly level (bottom-up):
  L1 cost = SUM(L2 component costs) + L1 operation costs
  Roll up to top-level finished good
```

**Tool**: `GET /bom/:id/cost` + `GET /materials/pricing` + Ornith analysis

**Outputs**:
- BOM cost sheet (per product)
- Material cost variance report (planned vs actual)
- Make vs buy analysis (if operation can be outsourced)
- LINE digest: BOMs with cost change > 5%

---

### Skill 6: BOM Accuracy & Audit Agent

**Trigger**: Weekly + before major WO release

**Checks**:
1. **BOM vs Inventory Discrepancy**
   - Component listed in BOM but no inventory record → flag orphan
   - Inventory item with no BOM reference → flag orphan
   - Action: reconcile or escalate to engineering

2. **Phantom BOM Check**
   - Identify BOMs that reference non-existent sub-assemblies
   - Check for circular BOM references

3. **BOM Completeness**
   - Missing routing/ operations (for BOMs with operations)
   - Missing work center assignments
   - Zero-quantity component lines

4. **Duplicate BOM Check**
   - Same product with multiple active BOMs → flag for cleanup
   - Near-duplicate BOMs (same components, slight qty variance)

**Tool**: `bom-query.js --scope bom-audit` + Ornith analysis + PowerShell report generation

---

### Skill 7: Production Planning & Scheduling Agent

**Trigger**: Weekly planning cycle + on-demand

**Inputs**: Sales forecast, open orders, current inventory, BOM lead times

**MRP Logic**:
```
FOR each independent demand (finished product):
  1. Gross requirement = SUM(confirmed orders) + safety stock
  2. Net requirement = Gross requirement - available inventory
  3. FOR each BOM level (explosion):
     a. Calculate component requirements from parent demand
     b. Subtract on-hand inventory
     c. Net requirement → planned order quantity
     d. Check lead time: order date = need date - lead time
  4. Generate:
     - Planned purchase orders (for bought components)
     - Planned production orders (for made sub-assemblies)
     - Suggested WO releases
```

**Tool**: `GET /sales-orders` + `GET /bom/explode/:productCode` + `POST /mrp/suggestions`

---

### Skill 8: WO Status & Tracking Agent

**Trigger**: Every 30 min patrol

**For each active WO**:
```
1. Check WO status: released → in-progress → completed → closed
2. Track:
   - Material issued vs BOM required
   - Operation completion vs routing
   - Actual vs planned start/ end times
   - Labor hours booked vs estimated
3. Flag:
   - WO overdue (past planned end date)
   - WO with < 50% material issued
   - WO with quality holds
4. Update WO progress in ERP
```

**Tool**: `GET /pmc/work-orders` + `POST /pmc/work-orders/:id/progress`

---

### Skill 9: BOM Report Generator Agent

**Trigger**: On-demand + daily digest (07:30)

**Reports Generated**:

1. **Daily BOM Digest** (LINE morning):
   - Open WOs count and status
   - WOs released today
   - BOMs pending ECO approval
   - Material shortages affecting WOs
   - Overdue WOs

2. **Weekly BOM Health Report**:
   - BOM accuracy rate
   - ECO cycle time
   - BOMs without valid routing
   - Orphan inventory items
   - Cost variance summary

3. **BOM Master List**:
   - All active BOMs with latest revision
   - Product family grouping
   - Component commonality report (shared components across BOMs)

**Tool**: `bom-query.js --scope bom-report` + Ornith analysis → LINE/ file output

---

### Skill 10: Supplier BOM Coordination Agent

**Trigger**: New supplier qualified, or supplier change initiated

**Process**:
1. Compare supplier-provided BOM vs internal EBOM
2. Identify deviations: extra components, missing items, quantity differences
3. Assess impact: cost change, lead time change
4. If acceptable: create alternate BOM for this supplier
5. Update supplier record with approved BOM reference

**Tool**: `GET /suppliers/:id/bom` + `POST /bom/alternate`

---

## Task Schedule

| Time | Agent | Action |
|---|---|---|
| 07:00 | Supplier BOM Coordinator | Check expected BOM changes from suppliers |
| 07:30 | BOM Report Generator | Morning digest to LINE |
| 08:00 | WO Status Agent | All active WOs: progress check, flag overdue |
| 08:30 | Material Shortage Agent | Check shortages for released WOs |
| 09:00 | BOM Cost Agent | Cost roll-up for any BOMs changed yesterday |
| 10:00 | BOM Accuracy Agent | Weekly BOM audit check |
| 12:00 | WO Status Agent | Mid-day WO status update |
| 14:00 | Production Planning Agent | Refresh MRP suggestions |
| 15:00 | Material Shortage Agent | Re-check shortages for afternoon WOs |
| 16:00 | ECO Agent | Pending ECO review and approvals |
| 17:00 | BOM Report Generator | End-of-day summary to LINE |
| Every 30min | WO Status Agent | Active WO patrol |

---

## AI Prompt Template

Every Ornith analysis uses this structured prompt:

```
## BOM AI Manager — Analysis Request

Factory data snapshot — {timestamp}

<BOMS>
{json}
</BOMS>

<WORK_ORDERS>
{json}
</WORK_ORDERS>

<INVENTORY>
{json}
</INVENTORY>

<RECENT_ECOS>
{json}
</RECENT_ECOS>

<COST_DATA>
{json}
</COST_DATA>

Context: You are a BOM AI Manager for a manufacturing factory.
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD

Analyze the BOM data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [
    {{
      "severity": "critical|warning|info",
      "area": "bom|wo|inventory|eco|cost",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动",
      "bom_code": "BOM编号（如适用）",
      "urgency": "immediate|24h|this_week"
    }}
  ],
  "wo_decisions": [
    {{
      "wo_number": "",
      "action": "RELEASE|HOLD|CANCEL|REPLAN",
      "reason": "原因",
      "auto_execute": true|false
    }}
  ],
  "eco_recommendations": [
    {{
      "eco_number": "",
      "type": "component_replace|quantity_change|new_revision",
      "impact": "cost_delta|schedule_impact|none",
      "recommendation": "approve|defer|reject",
      "auto_execute": true|false
    }}
  ],
  "material_shortages": [
    {{
      "material_code": "",
      "wo_number": "",
      "required_qty": 0,
      "available_qty": 0,
      "shortage_qty": 0,
      "action": "HOLD_WO|REQUEST_PO|ALTERNATE_BOM"
    }}
  ],
  "bom_cost_changes": [
    {{
      "bom_code": "",
      "old_cost": 0.0,
      "new_cost": 0.0,
      "variance_pct": 0.0,
      "action": "REVIEW|APPROVE|FLAG"
    }}
  ],
  "summary": "一句话总结当前BOM状态"
}}
</ANALYSIS>
```

---

## Tool Reference

### bom-query.js
```
node bom-query.js [scope]
  scope: bom-list | bom-detail | bom-explode | bom-audit | bom-cost | wo-status | material-readiness | eco-list | all
```

### PowerShell Scripts
```
Invoke-BOMSync.ps1       — Sync BOMs with ERP system
Invoke-WOCreate.ps1      — Create work order from BOM
Invoke-MRPRun.ps1        — Run MRP net change
Invoke-ECORollout.ps1    — Apply ECO to affected BOMs
Invoke-BOMCostRollup.ps1 — Calculate multi-level BOM costs
Invoke-BOMAudit.ps1      — Generate BOM accuracy report
```

### API Endpoints Used
| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/bom` | JWT | BOM list |
| GET | `/bom/:id` | JWT | BOM detail |
| GET | `/bom/:productCode/explode` | JWT | Multi-level BOM explosion |
| POST | `/bom` | JWT | Create new BOM |
| PATCH | `/bom/:id` | JWT | Update BOM |
| GET | `/bom/:id/cost` | JWT | BOM cost breakdown |
| POST | `/eco` | JWT | Create ECO |
| PATCH | `/eco/:id` | JWT | Update ECO status |
| GET | `/pmc/work-orders` | JWT | WO list |
| POST | `/pmc/work-orders` | JWT | Create WO from BOM |
| PATCH | `/pmc/work-orders/:id` | JWT | Update WO |
| GET | `/wms/stock` | JWT | Inventory balance |
| GET | `/wms/inventory-transactions` | JWT | TX history |
| GET | `/materials` | JWT | Material master |
| GET | `/suppliers/:id/bom` | JWT | Supplier BOM |
| POST | `/mrp/suggestions` | JWT | MRP planned orders |
| GET | `/work-centers` | JWT | Work center list |

### LINE Integration
- Token stored in `services/worker/line_token.txt`
- Endpoint: `https://notify-api.line.me/api/notify`
- Method: POST with `message` field
- Debounce: Same message not re-sent within 24h unless severity increased

---

## Data Retention & Audit

- All AI decisions stored in `bom_manager_audit_log` table
- Schema: `id, timestamp, agent, area, decision_type, bom_code, wo_number, input_data, output_decision, executed, executor, line_alert_sent, notes`
- BOM revision history: never deleted, full traceability
- ECO history: linked to BOM revision pairs
- Retention: 2 years
- Human can override any decision → override logged with `override_by` field

---

## OpenCode Integration

The BOM Manager uses OpenCode for:
- **File operations**: Read/ write BOM exports, CSV imports, Excel BOM templates
- **Code generation**: Auto-generate PowerShell scripts for ERP sync
- **Report generation**: Create formatted HTML/ Markdown BOM reports
- **Data transformation**: Convert BOM formats between ERP systems
- **Script validation**: Verify PowerShell scripts before execution

```
OpenCode Tool Usage:
- Read BOM templates: BOM-*.xlsx → parse → validate → import
- Generate scripts: BOM cost roll-up → PowerShell → execute
- Create reports: BOM audit results → Markdown → LINE message
```

---

## Known Limitations

1. **No CAD/PLM integration**: BOMs must be entered manually or via ERP API; no direct SolidWorks/ Teamcenter pull
2. **Single BOM per product**: Variant BOMs (configurable products) not fully supported
3. **No vision**: Cannot inspect physical parts; relies on barcode/ label data
4. **Alternate BOM approval**: Requires human sign-off for production-critical substitutions
5. **Cost accuracy**: Tied to component cost data freshness in ERP; outdated costs = inaccurate BOM cost
6. **Offline Ornith**: If Ollama is down, falls back to rule-based decisions only (no LLM reasoning)
7. **Multi-plant BOM**: Not supported in current version; single-site BOM management only
