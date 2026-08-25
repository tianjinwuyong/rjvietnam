# SMT Factory System - Material Loading Workflow

## Overview

Material loading problem: SMT operators need to load correct materials (reels/components) onto production lines according to work order BOMs, with barcode verification to prevent errors.

**Key constraint**: One operator = One work order at a time. Operator must finish current WO before starting another.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          SMT Factory System                                    │
│                                                                              │
│  ┌────────────────┐    ┌─────────────────────┐    ┌────────────────────┐  │
│  │ PDA Material   │    │   Express API        │    │   PostgreSQL       │  │
│  │ Loader App     │◀──▶│   (Port 8080)        │◀──▶│   Database         │  │
│  │ (Android/Kotlin│    │                     │    │                    │  │
│  │  Jetpack Compose)    │                     │    │  work_orders       │  │
│  │                     │  /pmc/work-orders  │    │    + locked_by    │  │
│  │                     │  /erp/boms/product│    │  boms/bom_lines   │  │
│  │                     │  /wms/issue-to-line│    │  materials        │  │
│  └─────────────────────┘                     └──────────────────────────┘  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Web Frontend (PMC Work Order Manager)              │   │
│  │   • Monitor WO lock status (auto-refresh every 10s)                    │   │
│  │   • See which operator is loading which WO                            │   │
│  │   • Force unlock if needed                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### Backend (Express API)
- `services/api/server.js`
  - `GET /pmc/work-orders` - List WOs (includes `lockedBy`, `lockedAt`)
  - `POST /pmc/work-orders/:code/lock` - Lock WO for PDA (enforces one-WO-per-operator)
  - `POST /pmc/work-orders/:code/unlock` - Unlock WO (operator or manager force)
  - `POST /pmc/work-orders/:code/complete` - Complete WO (supports material-loading-only)
  - `GET /erp/boms/product/:productCode` - Get BOM for product

### Unified PDA App
- `apps/pdas/scanner-terminal/`
  - Unified PDA profiles and MES work-order/material-loading flows
  - Scanner, authentication, language, sync, diagnostics, and line-domain selection

### Database
- `database/migrations/046_add_wo_locking.sql` - Adds `locked_by`, `locked_at` columns

## WO Locking Mechanism

### Rules
1. **One WO per operator**: An operator can only have ONE active WO locked at a time
2. **Exclusive lock**: A WO can only be locked by one operator at a time
3. **Finish to proceed**: Must complete current WO before locking another
4. **Manager override**: Managers can force-unlock any WO

### Lock Flow

```
┌──────────────┐                              ┌──────────────┐
│   PDA App    │                              │   Backend    │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │  1. GET /pmc/work-orders                   │
       │  ─────────────────────────────────────────▶ │
       │     (shows all WOs with lock status)        │
       │                                             │
       │  2. User selects WO                        │
       │  ─────────────────────────────────────────▶ │
       │     POST /pmc/work-orders/:code/lock        │
       │     { operator: "PDA_USER" }                │
       │                                             │
       │  ┌─────────────────────────────────────┐   │
       │  │ Backend checks:                      │   │
       │  │ 1. Operator has other locked WO?     │   │
       │  │    → 409: "Complete WO X first"     │   │
       │  │ 2. WO locked by another operator?    │   │
       │  │    → 409: "WO locked by Y"          │   │
       │  │ 3. Both OK → lock succeeds          │   │
       │  └─────────────────────────────────────┘   │
       │                                             │
       │  ◀─ 200 OK (or 409 Conflict)              │
       │                                             │
       │  3. Fetch BOM & start loading              │
       │  ─────────────────────────────────────────▶ │
       │     GET /erp/boms/product/:productCode      │
       │                                             │
       │  4. Scan materials (slot → reel)           │
       │                                             │
       │  5. All loaded → Confirm                  │
       │  ─────────────────────────────────────────▶ │
       │     POST /pmc/work-orders/:code/complete   │
       │                                             │
       │  6. Backend: complete + unlock             │
       │  ─────────────────────────────────────────▶ │
       │     POST /pmc/work-orders/:code/unlock     │
       │                                             │
       │  ◀─ Success: Can select next WO           │
       └─────────────────────────────────────────────┘
```

## API Endpoints

### Work Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/pmc/work-orders` | List WOs (includes `lockedBy`, `lockedAt`) |
| POST | `/pmc/work-orders` | Create WO |
| POST | `/pmc/work-orders/:code/lock` | Lock WO for PDA |
| POST | `/pmc/work-orders/:code/unlock` | Unlock WO |
| POST | `/pmc/work-orders/:code/complete` | Complete WO (material loading or production output) |
| POST | `/pmc/work-orders/:code/complete` | Complete WO (material loading or production output) |

### BOMs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/erp/boms/product/:productCode` | Get active BOM for product |

### Inventory
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/wms/issue-to-line` | Issue materials to production |

## Database Schema

### work_orders (with locking)
| Column | Type | Description |
|--------|------|-------------|
| id | bigserial | Primary key |
| code | char(11) | Work order code |
| status | varchar(20) | draft, released, running, hold, closed |
| locked_by | varchar(50) | Operator who locked this WO (PDA operator) |
| locked_at | timestamptz | When the WO was locked |

## WO Manager Responsibilities

The WO Manager (web frontend at `/pmc/work-orders`):

1. **Monitor Lock Status**: See which WOs are currently being loaded by PDA operators
2. **Auto-Refresh**: Updates every 10 seconds to show real-time lock status
3. **Alert**: Shows badge "🔒 N WOs being loaded on PDA" when WOs are locked
4. **Force Unlock**: If operator abandons a locked WO, manager can force-unlock

## Error Handling

| Scenario | HTTP Code | Message |
|----------|-----------|---------|
| WO locked by another operator | 409 | "Work order is locked by {operator}" |
| Operator has another locked WO | 409 | "Complete WO {code} first. You can only work on one WO at a time." |
| WO not found | 404 | "Work order {code} not found" |
| BOM not found for product | 404 | "No active BOM for product {code}" |

## 上料流程 (Material Loading Process)

上料 = SMT生产线物料装载。操作员扫描物料，核查批次/数量，系统自动扣减库存，直至所有物料装载完成。

### 流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PDA Material Loading Flow                             │
└─────────────────────────────────────────────────────────────────────────────┘

1️⃣ SELECT WO (选择工单)
   │
   ├─ Operator opens app → sees all WOs
   ├─ Selects WO → system LOCKS it (其他WO自动锁定)
   └─ System fetches BOM → shows material list

2️⃣ LOAD MATERIALS (装载物料) — 循环
   │
   ├─ Step A: SCAN SLOT (扫描工位)
   │   └─ Operator scans feeder slot barcode (e.g., "SLOT-A1")
   │
   ├─ Step B: SCAN REEL (扫描物料)
   │   ├─ System reads material SN/barcode
   │   ├─ System fetches from backend:
   │   │   ├─ 批次 (lot/ batch number)
   │   │   ├─ 数量 (qty available)
   │   │   └─ IQC status (是否已质检)
   │   │
   │   ├─ Validation (校验):
   │   │   ├─ Material matches BOM? ✓/✗
   │   │   ├─ Sufficient qty? ✓/✗
   │   │   └─ IQC passed? (status="released") ✓/✗
   │   │
   │   └─ If OK → CHECK OUT item (出库)
   │       └─ POST /wms/issue-to-line
   │           { lotNo, workOrderCode, qty, operator }
   │
   ├─ Step C: Feedback (反馈)
   │   ├─ ✓ Green: "CAP-100UF → A1 ✓"
   │   └─ ✗ Red: "Wrong material / Insufficient qty"
   │
   └─ Repeat A→B→C until ALL materials loaded
       └─ Progress: "5/10 loaded"

3️⃣ COMPLETE (完成)
   ├─ All materials scanned
   ├─ Operator confirms "Complete"
   ├─ POST /pmc/work-orders/:code/complete
   │   └─ Updates WO status, UNLOCKS WO
   └─ Return to WO selection → can pick next WO
```

### 上料界面示意

```
┌────────────────────────────────────────────────────────────┐
│  WO: WO2026-07-001    Line: L001    Product: PCB-ASSY-001  │
├────────────────────────────────────────────────────────────┤
│  Progress: ████████░░░░░░░░░░░  8/15 materials loaded  │
├────────────────────────────────────────────────────────────┤
│  # │ Material Code │ Lot No    │ Qty  │ Status           │
│  1 │ CAP-100UF     │ LOT-001  │ 200  │ ✓ Loaded        │
│  2 │ RES-10K       │ LOT-002  │ 500  │ ✓ Loaded        │
│  3 │ IC-STM32      │ LOT-003  │ 10   │ ⟳ Scaning...    │
│  4 │ LED-GREEN     │ LOT-004  │ 50   │ ○ Pending       │
│  ...                                                     │
├────────────────────────────────────────────────────────────┤
│  [📷 Scan Reel]                     [✓ Complete Loading]  │
└────────────────────────────────────────────────────────────┘
```

### Backend API Flow (Per Material)

```
PDA App                          Backend                          Database
   │                                 │                                │
   │  (For each material in BOM):    │                                │
   │                                 │                                │
   │── Scan reel barcode             │                                │
   │                                 │                                │
   │── GET /wms/material-lots?q=───▶│── SELECT FROM material_lots ──▶│
   │    (by lot_no or material_code) │                                │
   │                                 │                                │
   │◀─ Response:                    │                                │
   │   {                             │                                │
   │     lotNo: "LOT-001",           │                                │
   │     qty: 200,                   │                                │
   │     iqcStatus: "released",     │                                │
   │     materialCode: "CAP-100UF"   │                                │
   │   }                             │                                │
   │                                 │                                │
   │── Validate:                    │                                │
   │   1. Material matches BOM?      │                                │
   │   2. Qty sufficient?            │                                │
   │   3. IQC status = released?     │                                │
   │                                 │                                │
   │── POST /wms/issue-to-line ────▶│── INSERT inventory_trans ─────▶│
   │   {                              │── UPDATE material_lots ───────▶│
   │     lotNo: "LOT-001",            │    SET qty = qty - N          │
   │     workOrderCode: "WO-001",    │                                │
   │     qty: 200,                    │                                │
   │     operator: "VN_OP_001"       │                                │
   │   }                              │                                │
   │◀─ Response:                     │                                │
   │   { txNo: "TX-001", success }   │                                │
   │                                 │                                │
   │  (Repeat for next material)     │                                │
   │                                 │                                │
   │── All done:                     │                                │
   │── POST /pmc/work-orders/───▶│── UPDATE work_orders ──────────▶│
   │     WO-001/complete             │    status = 'released'         │
   │◀─ { completed, unlocked }        │── UPDATE work_orders ──────────▶│
   │                                     SET locked_by = NULL           │
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| **Slot (工位)** | feeder位置 on SMT line (e.g., "A1", "B2-C3") |
| **Reel SN (物料条码)** | 物料卷 barcode / lot number |
| **批次 (Lot)** | 批次号 for traceability |
| **数量 (Qty)** | 该批次可用数量 |
| **IQC Status** | Must be "released" (passed QC) 才能使用 |
| **Checkout** | 扣减 `material_lots`, 创建 `inventory_transactions` |
| **Lock** | 防止其他操作员选择同一工单 |
| **Unlock** | 完成上料后或取消时解锁 |

### 物料校验规则

| 校验项 | 失败时 |
|--------|--------|
| 物料代码匹配BOM | ✗ "Wrong material" |
| 批次数量充足 | ✗ "Insufficient qty" |
| IQC已通过 (released) | ✗ "Material not yet released" |
| 物料未过期 | ✗ "Material expired" |

## Error Handling

| Scenario | HTTP Code | Message |
|----------|-----------|---------|
| WO locked by another operator | 409 | "Work order is locked by {operator}" |
| Operator has another locked WO | 409 | "Complete WO {code} first. You can only work on one WO at a time." |
| WO not found | 404 | "Work order {code} not found" |
| BOM not found for product | 404 | "No active BOM for product {code}" |
| Material lot not found | 404 | "Lot {lotNo} not found" |
| Insufficient qty | 400 | "Insufficient quantity in lot {lotNo}" |
| Material IQC not released | 400 | "Material not yet released (IQC pending)" |

## Future Enhancements

1. **Real-time WebSocket updates** - Push lock status changes to WO Manager
2. **Lock timeout** - Auto-unlock if operator hasn't scanned material in X minutes
3. **Loading progress** - Track how many materials have been scanned vs total
4. **Partial loading** - Allow WO to be loaded across multiple sessions
5. **Feeder binding** - Map specific reels to specific feeder slots
6. **Material expiration check** - MSD level & shelf life validation
7. **Alternative material** - Suggest substitute if primary material unavailable
