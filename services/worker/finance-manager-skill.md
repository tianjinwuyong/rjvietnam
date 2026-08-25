# Finance AI Manager — Virtual Agent Skills

## Agent Profile

**Name**: Finance AI Manager (`财务AI管理员`)
**Model**: Ornith-1.0-9B (local Ollama, privacy-first) + OpenCode (code execution)
**Execution**: PowerShell scripts + Node.js DB queries + API calls
**Scope**: GL accounting, AP/AR management, SMT work order costing, inventory valuation, cost control, Vietnam tax compliance (VAS), financial reporting, treasury management, and material financial event monitoring.
**Escalation**: LINE notifications for critical financial decisions; human-in-the-loop for high-value transactions.
**Memory**: Last-state JSON for delta detection between cycles.
**Audit**: Every financial action logged with timestamp, operator, reason, and GL entry reference.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)    │
│  Every 30 min: finance patrol               │
│  07:30: morning financial digest to LINE     │
│  17:00: daily financial summary report      │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  finance-manager.js (Node.js)              │
│  1. Query DB (finance-query.js)           │
│  2. Feed Ornith for reasoning              │
│  3. Parse decisions                       │
│  4. Execute via API or log                │
│  5. Send LINE alerts                       │
└──────────────┬──────────────────────────────┘
               │
      ┌─────────┼──────────┐
      ▼         ▼          ▼
   PostgreSQL  Ornith     LINE API
   (data)    (reason)  (alerts)
```

---

## Skills Summary

| # | Skill | Purpose |
|---|---|---|
| 1 | GL Accounting Agent | Post and manage GL journal entries; period closing |
| 2 | AR Collections Agent | Monitor receivables, aging analysis, overdue follow-up |
| 3 | AP Payment Agent | Manage payables, payment scheduling, cash forecasting |
| 4 | Work Order Costing Agent | Calculate actual WO costs, variance analysis, COGS posting |
| 5 | Inventory Valuation Agent | Track FIFO cost layers, material valuation, scrap cost impact |
| 6 | SMT Cost Variance Agent | Monitor material yield, labor efficiency, overhead variance |
| 7 | Vietnam Tax Agent | VAT management, withholding tax, CIT calculation, transfer pricing |
| 8 | Material Financial Event Monitor | Track NG compensation, scrap, disposal, return financial impact |
| 9 | Exchange Rate & FX Agent | Monitor USD/VND rates, revalue GL accounts, FX gain/loss |
| 10 | Fiscal Period Agent | Open/close accounting periods; enforce period locking |
| 11 | Financial Reporting Agent | Generate P&L, Balance Sheet, Cost Report; daily digest |
| 12 | Cost Escalation Agent | Alert when WO cost exceeds standard or budget |
| 13 | Treasury & Cash Flow Agent | Forecast cash needs, optimize payment timing |
| 14 | Audit & Compliance Agent | VAS compliance check, audit trail verification |
| 15 | Auto-Improvement Loop | Self-evaluate Ornith decisions, tune thresholds |

---

## Core Skills

### Skill 1: GL Accounting Agent

**Trigger**: On any financial transaction (invoice posted, payment recorded, WO cost posted); daily period reconciliation check.

**Responsibilities**:
- Validate that every financial transaction creates balanced GL entries (debits = credits)
- Enforce period access: only open fiscal periods accept journal entries
- Auto-reverse accrued entries at period start where configured
- Generate trial balance report on demand
- Post exchange rate revaluation journals at month-end

**Decision Matrix**:

| Transaction Type | Debit Account | Credit Account | Auto-Post? |
|---|---|---|---|
| AR Invoice posted | 1200 AR | 4100 Revenue, 2210 VAT Payable | ✅ |
| AP Invoice posted | 5100 COGS, 2220 VAT Input | 2100 AP | ✅ |
| Payment received (AR) | 1110/1120 Cash | 1200 AR | ✅ |
| Payment made (AP) | 2100 AP | 1110/1120 Cash | ✅ |
| WO cost posted | 5100 COGS | 1410 WIP Inventory | ✅ |
| Material scrap | 5130 Scrap COGS | 1400/1410 Inventory | ✅ |
| FX revaluation | 6610 FX Loss / 3300 FX Gain | 1200/2100 AR/AP | ✅ |

**Tool**: `POST /finance/gl-journals` + `GET /finance/gl-journals` + `GET /finance/gl-accounts`

---

### Skill 2: AR Collections Agent

**Trigger**: Daily at 08:00 + on new AR invoice creation + when invoice becomes overdue.

**Decision Matrix**:

| Aging Bucket | Days Overdue | Action |
|---|---|---|
| Current | 0-30 days | 🟢 Normal — no action |
| Aging-1 | 31-60 days | 🟡 Reminder — email/SMS to customer |
| Aging-2 | 61-90 days | 🟠 Warning — LINE alert to account manager |
| Aging-3 | 91-180 days | 🔴 escalation — call + letter, suspend shipment |
| Critical | > 180 days | 🔴🔴 write-off proposal — human approval required |

**Data Sources**:
- `ar_invoices` (invoice_no, customer_id, total_amount, paid_amount, outstanding_amount, due_date)
- `customers` (account_manager, payment_terms_days, credit_limit)
- `payment_records` (payment history)

**Tool**: `GET /finance/ar-aging` + `POST /finance/payments` + `GET /finance/ar-invoices`

**Output** (LINE to account manager):
```
🔔 [AR Follow-up] {customer_name}
━━━━━━━━━━━━━━━━━━
Invoice: {invoice_no} | Due: {due_date} | Overdue: {days}d
Outstanding: {currency} {outstanding_amount}
━━━━━━━━━━━━━━━━━━
Recommendation: {action}
```

---

### Skill 3: AP Payment Agent

**Trigger**: Daily at 09:00 + when new AP invoice created.

**Logic**:
```
FOR each unpaid AP invoice:
  dueIn = due_date - today
  IF payment_terms_days = 'NET30':
    optimalPay = min(dueIn, 7)  -- pay 7 days before due (cash optimization)
  IF dueIn < 0:
    flag as OVERDUE → 🔴 LINE alert
  IF cash_available < payment_amount:
    prioritize: critical suppliers → line down components → others deferred
```

**Prioritization Rules**:

| Priority | Supplier Type | Payment Timing |
|---|---|---|
| P1-Critical | Sole-source component supplier | Pay immediately |
| P2-Strategic | Long-lead-time import | Pay 5 days early |
| P3-Standard | Local secondary supplier | Pay on due date |
| P4-Defer | Non-critical, replaceable | Defer 7-15 days if cash needed |

**Tool**: `GET /finance/ap-aging` + `GET /finance/ap-invoices` + `POST /finance/payments`

---

### Skill 4: Work Order Costing Agent

**Trigger**: On WO close (`status = 'closed'`) + weekly cost variance review.

**Cost Calculation for SMT WO**:
```
Actual Material Cost = SUM(issue_qty × unit_cost) from inventory_cost_layers
  + material_financial_events (scrapped, returned, NG compensation)
  × exchange_rate (if VND-denominated)

Actual Labor Cost = SUM(operator_hours × labor_rate_vnd) from work_order_operations
  × benefits_load (30%)
  ÷ exchange_rate (convert to USD)

Actual Overhead Cost = SUM(machine_hours × overhead_rate_usd per line)
  from work_order_operations

Total Actual Cost = Material + Labor + Overhead

Variance = Total Actual Cost - Standard Cost (from work_order.standard_cost)

Cost Status:  variance > 10% → 🔴 ESCALATE
             variance 5-10% → 🟡 REVIEW
             variance < 5%  → 🟢 OK
```

**Data Sources**:
- `inventory_cost_layers` (material issue cost, FIFO layers)
- `material_financial_events` (scrap, return, compensation amounts)
- `work_order_operations` (labor hours, machine hours from MES)
- `work_order_cost_summaries` (standard vs actual cost)
- `finance_smt_overhead_rates` (overhead per line per hour)
- `finance_labor_rates` (hourly labor cost by grade)

**Tool**: `GET /finance/work-order-costs` + `GET /finance/ar-aging` + `GET /finance/material-events`

---

### Skill 5: Inventory Valuation Agent

**Trigger**: Daily at 10:00 + on every inventory transaction (issue, scrap, return).

**FIFO Cost Layer Logic**:
```
On ISSUE_TO_LINE (material consumed by WO):
  1. Find oldest OPEN inventory_cost_layer for the material_lot
  2. remaining_qty -= issued_qty
  3. If remaining_qty = 0 → status = 'consumed', closed_at = now()
  4. Record actual_unit_cost from layer for WO cost calculation
  5. Create GL entry: Debit 5100 COGS, Credit 1400/1410 Inventory

On SCRAP:
  1. remaining_qty = 0, status = 'closed'
  2. Calculate loss: qty × unit_cost
  3. Create material_financial_events entry (type: DISPOSAL_GARBAGE)
  4. Create GL entry: Debit 5130 Scrap COGS, Credit 1400 Inventory

On RETURN_TO_STOCK:
  1. Create new inventory_cost_layer with same unit_cost
  2. remaining_qty = returned_qty
```

**Inventory Value Report** (daily):
```
📊 库存估值报告 {date}
━━━━━━━━━━━━━━━━━━
原材料库存: ${raw_materials_value}
在制品库存: ${wip_value}
成品库存:   ${fg_value}
━━━━━━━━━━━━━━━━━━
Total: ${total_value}

⚠️ 高价值物料预警 (> $10,000):
  - IC-MCU-RJ32: $45,230 (批次老化风险)
  - CAP-0805-100N: $12,500 (库存周转68天)
```

**Tool**: `GET /finance/inventory-valuation` + `POST /finance/gl-journals`

---

### Skill 6: SMT Cost Variance Agent

**Trigger**: Weekly (every Monday 08:00) + on WO close.

**Variance Categories**:

| Category | Formula | Threshold |
|---|---|---|
| Material Yield Variance | `(actual_qty - standard_qty) × standard_rate` | > 2% → 🔴 |
| Material Price Variance | `(actual_price - standard_price) × actual_qty` | > 5% → 🟡 |
| Labor Efficiency Variance | `(actual_hours - standard_hours) × standard_rate` | > 10% → 🟡 |
| Overhead Spending Variance | `actual_overhead - budgeted_overhead` | > 8% → 🟡 |
| Scrap Cost Variance | `scrap_qty × standard_material_cost` | > 2% of material cost → 🔴 |

**Data Sources**:
- `inventory_cost_layers` — actual material cost
- `material_financial_events` — scrap, NG, return events with financial impact
- `work_order_operations` (MES) — actual labor/machine hours
- `work_order_cost_summaries` — standard vs actual
- `bom_versions` — standard BOM with standard costs

**Tool**: `GET /finance/work-order-costs` + `GET /finance/material-events` + `GET /finance/ar-aging`

---

### Skill 7: Vietnam Tax Agent

**Trigger**: On every invoice post, month-end, and quarter-end.

**VAT Management (VAT for Electronics Manufacturing in Vietnam)**:

| Event | VAT Treatment | Account |
|---|---|---|
| Domestic sale (AR invoice) | Output VAT 10% | Debit 1200 AR, Credit 4100 Revenue, Credit 2210 VAT Payable |
| Import of materials (AP invoice) | Input VAT creditable 10% | Debit 5100/1400, Debit 2220 VAT Receivable, Credit 2100 AP |
| Export sale (AR invoice) | VAT 0% (exempt) | Debit 1200 AR, Credit 4110 Export Revenue |
| Foreign contractor service | WHT 1%/2%/5% | Debit expense, Credit 2300 WHT Payable |

**Withholding Tax (Thuế Khấu Trừ)**:
- Service fees to foreign companies: 1% (technical), 2% (management), 5% (other)
- Domestic B2B payments: 5% on certain payments

**Corporate Income Tax (CIT)**:
- Rate: 20% of taxable income
- Quarterly provisional payments
- Annual final settlement
- Transfer pricing: arm's length principle for intercompany transactions

**Tool**: `GET /finance/ar-invoices` + `GET /finance/ap-invoices` + `GET /finance/gl-journals`

---

### Skill 8: Material Financial Event Monitor

**Trigger**: Every 30 minutes + on new material financial event created.

**Event Types & Financial Impact**:

| Event Type | Financial Impact | GL Entry |
|---|---|---|
| `COMPENSATION_REQUEST` | Supplier owes factory | Debit 1300 Other Receivable |
| `COMPENSATION_APPROVED` | Confirm recovery | Debit 1110 Cash, Credit 1300 |
| `COMPENSATION_DISPUTED` | Escalate to legal | Credit 1300, Debit 6700 |
| `DISPOSAL_GARBAGE` | Scrap loss | Debit 5130 Scrap COGS |
| `DISPOSAL_SOLD` | Recover some value | Debit 1110 Cash, Credit 5130 (gain/loss) |
| `DISPOSAL_RETURN_SUPPLIER` | Return to supplier | Debit 2100 AP, Credit 1400 |
| `MATERIAL_RETURN_PASS` | Return to stock | New cost layer |
| `MATERIAL_RETURN_NG` | N/G return cost | Debit 5130, Credit 1400 |
| `MATERIAL_RETURN_DAMAGED` | Damage loss | Debit 5130, Credit 1400 |

**Threshold Escalation**:
- Any single event > $1,000 loss → 🟠 LINE alert to Finance Manager
- Any single event > $10,000 loss → 🔴 LINE alert + human approval required
- Weekly total scrap > 3% of material cost → 🟡 KPI alert

**Tool**: `GET /finance/material-events` + `PUT /finance/material-events/:id/acknowledge` + `POST /finance/gl-journals`

---

### Skill 9: Exchange Rate & FX Agent

**Trigger**: Daily at 16:00 + on any FX transaction + month-end revaluation.

**Responsibilities**:
1. Fetch daily SBV reference rate for USD/VND
2. Record in `exchange_rates` table
3. At month-end: revalue all USD-denominated AR/AP balances
4. Calculate and post FX gain/loss

**Month-End Revaluation Logic**:
```
For each open AR/AP in USD:
  old_rate = booked_exchange_rate
  new_rate = latest_SBV_rate
  FX_delta = balance_usd × (new_rate - old_rate)
  if FX_delta > 0:
    Debit 1200/2100 AR/AP (additional value in VND)
    Credit 3300 FX Gain
  else:
    Debit 6610 FX Loss
    Credit 1200/2100
```

**Tool**: `GET /finance/exchange-rates` + `POST /finance/exchange-rates` + `POST /finance/gl-journals`

---

### Skill 10: Fiscal Period Agent

**Trigger**: On the 1st of each month (close prior period) + on-demand.

**Period Closing Rules**:
- Only `status = 'open'` periods accept journal entries
- Prior periods automatically locked (`status = 'closed'`)
- Month-end: all entries must be posted before closing
- Period close sequence:
  1. Verify all AP/AR invoices for the month are posted
  2. Post FX revaluation entries
  3. Post accrual entries (salaries, overhead)
  4. Generate trial balance — verify debits = credits
  5. Lock period: `UPDATE fiscal_periods SET status = 'closed'`
  6. Open new period: `INSERT fiscal_periods (new month)`

**Escalation**: If prior period still open after 5th of month → 🔴 LINE alert to Finance Manager

**Tool**: `GET /finance/fiscal-periods` + `POST /finance/gl-journals`

---

### Skill 11: Financial Reporting Agent

**Trigger**: Daily 07:30 digest + weekly report + month-end P&L + on-demand.

**Morning Financial Digest (LINE 07:30)**:
```
🌅 财务晨报 {date}
━━━━━━━━━━━━━━━━━━
💰 应收账款: ${total_ar} (逾期: ${overdue_ar})
💸 应付账款: ${total_ap}
📦 库存价值: ${inventory_value}
⚙️ 在制成本: ${wip_cost}
━━━━━━━━━━━━━━━━━━
⚠️ 今日关注
  - AP invoice #AP-202607-004 到期 (逾期3天)
  - WO-260701 cost variance +18% (需审阅)
  - 物料财务事件: ${total_scrap} 本周 scrap
━━━━━━━━━━━━━━━━━━
✅ 建议行动
  - 催收 {customer} 逾期${ar_amount}
  - 审阅WO成本差异
```

**Weekly Report** (every Monday):
- P&L Summary (Revenue, COGS, Gross Margin, Operating Expenses, Net Income)
- AR/AP Aging trend
- WO cost variance summary
- Inventory valuation change
- Cash flow forecast

**Monthly Report**:
- Full P&L (VAS format)
- Balance Sheet
- Cash Flow Statement
- Cost of Production Report by line
- Vietnam Tax Summary (VAT, WHT, CIT estimate)

**Tool**: Ornith analysis → formatted LINE/email report

---

### Skill 12: Cost Escalation Agent

**Trigger**: On WO close + when cost exceeds threshold during production.

**Escalation Rules**:

| Threshold | Action |
|---|---|
| WO actual cost > standard × 1.05 (5%) | 🟡 Log for review |
| WO actual cost > standard × 1.10 (10%) | 🟠 LINE alert to Finance Manager |
| WO actual cost > standard × 1.20 (20%) | 🔴 LINE alert + pause WO pending review |
| Weekly scrap > 3% of material issued | 🔴 LINE alert |
| Single material event > $1,000 loss | 🟠 LINE alert |
| Negative inventory (balance < 0) | 🔴🔴 Immediate LINE + block further issues |

**Data Sources**:
- `work_order_cost_summaries` (standard vs actual)
- `material_financial_events` (scrap/compensation amounts)
- `inventory_cost_layers` (negative stock check)

---

### Skill 13: Treasury & Cash Flow Agent

**Trigger**: Daily at 10:00 + on large AP/AR transaction.

**Cash Flow Forecasting**:
```
Cash Available = opening_balance
+ Expected AR receipts (next 30 days, weighted by probability)
- Scheduled AP payments (next 30 days)
= Forecasted cash position

Alert if:
  Forecasted cash < upcoming AP due → 🟠 Line alert
  Forecasted cash < 0 → 🔴 LINE + halt non-essential payments
```

**Payment Optimization**:
- Take advantage of early payment discounts (e.g., 2/10 NET30)
- Time large USD payments when VND is favorable
- Coordinate with bank for optimal FX conversion timing

---

### Skill 14: Audit & Compliance Agent

**Trigger**: Monthly audit check + before period close.

**VAS Compliance Checks**:
- All journal entries have supporting documents
- No postings to closed periods
- AR/AP aging matches subledger vs GL
- Inventory count matches book inventory (within 2%)
- All FX transactions use SBV reference rate
- Withholding tax correctly calculated and remitted

**Audit Trail Report** (monthly):
```
📋 审计追踪报告 {period}
━━━━━━━━━━━━━━━━━━
总GL凭证数: {je_count}
过账凭证数: {posted_count}
未过账凭证: {draft_count}
AR逾期超90天: {count} 金额: ${amount}
库存异常: {anomaly_count}
━━━━━━━━━━━━━━━━━━
合规状态: ✅ PASS / ❌ FAIL ({issues})
```

---

### Skill 15: Auto-Improvement Loop

**Trigger**: After every finance patrol cycle (automated); on-demand via CLI.

**Purpose**: Self-evaluate Ornith decisions using LLM-as-Judge, track accuracy, tune thresholds.

**Architecture**:
```
Finance Patrol → Ornith Decision → Audit Log → Judge LLM Scoring → Performance Report
                                     ↓
                            Threshold Tuning
                                     ↓
                            Skill Behavior Update
                                     ↓
                            LINE Accuracy Digest
```

**Judge Rubric**:

| Decision Type | Correct if... | Incorrect if... |
|---|---|---|
| `ar_post` | Invoice correctly posted, right accounts, balanced | Wrong accounts, unbalanced, wrong period |
| `ap_post` | Invoice correctly posted, VAT handled properly | Wrong VAT rate, unbalanced, missing WHT |
| `payment_record` | Payment linked to correct invoice, balance updated | Wrong amount, wrong invoice, double-payment |
| `wo_cost_post` | All material/labor/overhead captured, COGS balanced | Missing costs, wrong GL accounts |
| `scrap_post` | Correct quantity, correct cost, GL balanced | Wrong cost, wrong lot, unlinked to WO |
| `fx_reval` | Correct rate used, correct FX gain/loss calculated | Wrong rate, wrong direction, unbalanced |
| `period_close` | All entries posted, trial balance balanced, period locked | Entries missing, unbalanced, premature close |

**Accuracy Threshold**: 80%

- If rolling 7-day accuracy drops below 80%, escalate via LINE
- All decisions require approval until root cause addressed

---

## Task Schedule

| Time | Agent | Action |
|---|---|---|
| 07:30 | Financial Reporting Agent | Morning financial digest to LINE |
| 08:00 | AR Collections Agent | Check overdue invoices, send reminders |
| 09:00 | AP Payment Agent | Review AP due today, optimize payment timing |
| 10:00 | Treasury Agent | Cash flow forecast, payment optimization |
| 10:00 | Inventory Valuation Agent | Daily inventory value snapshot |
| 11:00 | Material Financial Event Monitor | Review open material events |
| 14:00 | Work Order Costing Agent | Weekly WO cost variance review |
| 15:00 | Vietnam Tax Agent | Review VAT balances, WHT obligations |
| 16:00 | Exchange Rate Agent | Fetch/update USD/VND rate |
| 17:00 | Financial Reporting Agent | End-of-day financial summary |
| Last day/month | Fiscal Period Agent | Month-end close, open new period |
| Mondays 08:00 | SMT Cost Variance Agent | Weekly variance report |
| Monthly | Audit & Compliance Agent | VAS compliance check |

---

## AI Prompt Template

```
## Finance AI Manager — Analysis Request

Factory financial snapshot — {timestamp}

<AR_INVOICES>
{json}
</AR_INVOICES>

<AP_INVOICES>
{json}
</AP_INVOICES>

<WORK_ORDER_COSTS>
{json}
</WORK_ORDER_COSTS>

<INVENTORY_VALUATION>
{json}
</INVENTORY_VALUATION>

<MATERIAL_FINANCIAL_EVENTS>
{json}
</MATERIAL_FINANCIAL_EVENTS>

<EXCHANGE_RATES>
{json}
</EXCHANGE_RATES>

Context: You are a Finance AI Manager for a Vietnam SMT electronics factory (RuiJing).
Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD
Currency: USD unless noted
VAT Rate: 10% standard (0% export, 5%/8% reduced)

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "alerts": [
    {{
      "severity": "critical|warning|info",
      "area": "ar|ap|wo_cost|inventory|tax|fx|compliance",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动",
      "amount": "金额（如适用）",
      "urgency": "immediate|24h|this_week"
    }}
  ],
  "ar_followup": [
    {{
      "invoice_no": "",
      "customer_name": "",
      "outstanding_amount": 0,
      "days_overdue": 0,
      "action": "reminder|warning|escalate|suspend"
    }}
  ],
  "ap_payment_plan": [
    {{
      "invoice_no": "",
      "supplier_name": "",
      "amount": 0,
      "due_date": "",
      "priority": "P1|P2|P3|P4",
      "recommendation": "pay_now|pay_early|pay_on_due|defer"
    }}
  ],
  "wo_cost_variance": [
    {{
      "work_order_code": "",
      "standard_cost": 0,
      "actual_cost": 0,
      "variance_pct": 0,
      "action": "ok|review|escalate"
    }}
  ],
  "fx_recommendations": [
    {{
      "currency_pair": "",
      "current_rate": 0,
      "recommendation": "",
      "rationale": ""
    }}
  ],
  "summary": "一句话总结当前财务状态"
}}
</ANALYSIS>
```

---

## Implementation Files

| File | Purpose |
|---|---|
| `finance-manager.js` | Main manager: patrol loop, decision execution, LINE integration |
| `finance-query.js` | DB query tool: ar-aging, ap-aging, wo-cost, inventory-valuation, material-events, gl-journals, fx-rates |
| `finance-execute.js` | Action executor: gl-post, ar-post, ap-post, payment-record, wo-cost-post, fx-reval, period-close |
| `finance-evaluator.js` | Judge LLM scoring: score-recent, score-all, tune-thresholds, report |
| `Invoke-FinancePatrol.ps1` | PowerShell wrapper for finance-manager.js patrol |
| `Invoke-FinanceDigest.ps1` | PowerShell wrapper for morning financial digest |
| `Invoke-FinanceMonthEnd.ps1` | PowerShell wrapper for month-end close |
| `finance-sop.json` | SOP definition file |
| `finance-sop-state.json` | Live SOP execution state |

---

## Tool Reference

### finance-query.js
```
node finance-query.js [scope]
  scope: ar-aging | ap-aging | wo-cost | inventory-valuation | material-events | gl-journals | fx-rates | fiscal-periods | dashboard-summary | all
```

### finance-execute.js
```
node finance-execute.js <action> [options]
  Actions: ar-post | ap-post | payment-record | wo-cost-post | fx-reval | period-close | material-event-acknowledge | gl-journal-create
```

### finance-evaluator.js
```
node finance-evaluator.js score-recent [--limit N]
node finance-evaluator.js score-all --days N
node finance-evaluator.js tune-thresholds
node finance-evaluator.js report --days N
```

### API Endpoints Used

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/finance/ar-invoices` | JWT | AR invoice list |
| POST | `/finance/ar-invoices` | JWT | Create AR invoice |
| PUT | `/finance/ar-invoices/:id/post` | JWT | Post AR to GL |
| GET | `/finance/ap-invoices` | JWT | AP invoice list |
| POST | `/finance/ap-invoices` | JWT | Create AP invoice |
| PUT | `/finance/ap-invoices/:id/post` | JWT | Post AP to GL |
| GET | `/finance/payments` | JWT | Payment records |
| POST | `/finance/payments` | JWT | Record payment |
| GET | `/finance/gl-accounts` | JWT | GL account list |
| GET | `/finance/gl-journals` | JWT | GL journal entries |
| GET | `/finance/work-order-costs` | JWT | WO cost summaries |
| PUT | `/finance/work-order-costs/:woId/post` | JWT | Post WO costs to GL |
| GET | `/finance/ar-aging` | JWT | AR aging report |
| GET | `/finance/ap-aging` | JWT | AP aging report |
| GET | `/finance/inventory-valuation` | JWT | Inventory value |
| GET | `/finance/material-events` | JWT | Material financial events |
| PUT | `/finance/material-events/:id/acknowledge` | JWT | Acknowledge event |
| GET | `/finance/exchange-rates` | JWT | FX rates |
| GET | `/finance/fiscal-periods` | JWT | Period status |
| GET | `/finance/dashboard-summary` | JWT | Finance KPI summary |

### LINE Integration
- Token stored in `services/worker/line_token.txt`
- Endpoint: `https://notify-api.line.me/api/notify`
- Method: POST with `message` field
- Debounce: Same message not re-sent within 24h unless severity increased

---

## Data Retention & Audit

- All AI decisions stored in `finance_manager_audit_log` table
- Schema: `id, timestamp, agent, area, decision_type, ref_id, ref_no, input_data, output_decision, executed, executor, line_alert_sent, amount_usd, notes`
- Retention: 7 years (Vietnam tax requirement)
- Human can override any decision — override logged with `override_by` field

**Audit Log Table**:
```sql
create table if not exists finance_manager_audit_log (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  agent           varchar(40) not null default 'finance-ai',
  area            varchar(40) not null,           -- ar|ap|wo_cost|inventory|tax|fx|compliance
  decision_type   varchar(60) not null,            -- ar_post|ap_post|payment|wo_cost_post|fx_reval|period_close
  ref_id          bigint,
  ref_no          varchar(80),
  gl_entry_id     bigint,
  input_data      jsonb,
  output_decision jsonb,
  executed        boolean not null default false,
  executor        varchar(40) default 'finance-ai',
  line_alert_sent boolean default false,
  feedback        varchar(20),                     -- correct|incorrect|null
  override_by     varchar(60),
  amount_usd      numeric(18,4),
  notes           text
);
```

---

## Inter-Agent Communication

### Finance ↔ WMS

**Finance → WMS**:
- `scrap_cost_recorded` — inform WMS scrap value recorded, update inventory
- `material_compensation_received` — WMS to update lot status
- `low_stock_financial_impact` — cost of stockout on production

**WMS → Finance**:
- `material_scrapped` — trigger scrap cost recording
- `compensation_approved` — trigger AP payment to supplier
- `material_returned` — trigger return cost entry

### Finance ↔ MES

**Finance → MES**:
- `wo_cost_exceeds_threshold` — MES to flag line supervisor
- `cost_posted_to_gl` — confirm COGS recorded

**MES → Finance**:
- `wo_completed` — trigger WO cost finalization
- `actual_hours_recorded` — for labor cost calculation

### Finance ↔ PMC

**Finance → PMC**:
- `wo_cost_variance_alert` — PMC to review WO
- `budget_exceeded` — request WO scope review

**PMC → Finance**:
- `wo_released` — Finance to set standard cost
- `wo_closed` — Finance to post final cost

### Finance ↔ HR

**Finance → HR**:
- `payroll_amount` — HR to confirm salary amounts for accrual

**HR → Finance**:
- `overtime_hours` — for labor cost calculation

---

## Known Limitations

1. **No ERP integration**: GL entries created manually or via API; no auto-sync with external ERP
2. **Cost layer accuracy**: FIFO cost depends on accurate unit_cost at receipt; manual receiving entry errors propagate
3. **Labor hours from MES**: If MES station time tracking is incomplete, labor cost will be underestimated
4. **FX rate dependency**: If SBV rate not updated daily, month-end revaluation may be inaccurate
5. **Single-currency reporting**: All reports in USD; VND reporting requires additional FX conversion layer
6. **No budget module**: Variance analysis against budget not yet implemented (next phase)
7. **No fixed asset depreciation**: Depreciation schedule not auto-posted (manual entry required)

---

## Related Files

- `virtualagentskills.md` — Master virtual agent skills document (WMS, BOM, HR, MES, PMC, Finance managers)
- `services/api/routes/finance.js` — Finance API routes
- `services/api/server.js` — Express server with finance endpoints
- `packages/shared-types/src/factory.ts` — Finance type definitions
- `database/migrations/003_finance_accounting_schema.sql` — Finance table definitions
- `database/migrations/010_finance_mvp.sql` — Finance MVP extension tables
- `database/migrations/058_material_financial_events.sql` — Material financial events table
- `database/migrations/059_gl_accounting_master_data.sql` — GL accounts seed data
- `database/migrations/060_finance_vietnam_tax_config.sql` — Vietnam tax config
