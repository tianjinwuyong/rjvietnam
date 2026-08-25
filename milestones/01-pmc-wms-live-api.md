# Milestone: PMC + WMS Live API Integration

**Date:** 2026-06-16
**Status:** Completed

---

## Goal

Connect the SMT factory ERP frontend (Vite/React) to the Express/PostgreSQL backend API, implementing the full work order lifecycle with auto-generated codes per the 工单编码规则, and wiring all PMC and WMS views to real API endpoints.

---

## Constraints

- Same component pattern as `src/wms/` (named exports, `{ locale }` prop, CSS from `styles.css`)
- No router, no external state library; all UI text via `t(key, locale)` or `text(multilingual, locale)`
- API server on port 8080, Express + pg
- Work order code: 11 digits `YY(2)+MM(2)+业务代码(1)+产线代码(2)+流水号(4)`, auto-generated via `work_order_serial_counters`

---

## What Was Built

### Backend Changes

#### New/Modified Endpoints (`services/api/server.js`)

| Endpoint | Method | Change |
|---|---|---|
| `/pmc/work-orders` | POST | `customerPoId` made optional — uses `resolvedPoId` which can be `null` |
| `/pmc/customer-pos` | GET | **New** — JOINs `customer_pos` → `customers` (uses `name_zh`), returns `ListEnvelope<CustomerPo>` |
| `/pmc/work-orders` | GET | Existing — lists work orders with full details |
| `/wms/transactions` | GET | Existing — inventory transaction history |
| `/wms/material-lots` | GET | Existing — material lot status (pending/hold/released) |

#### Database Migrations

| File | Change | Applied |
|---|---|---|
| `006_nullable_work_order_po.sql` | `ALTER TABLE work_orders ALTER COLUMN customer_po_id DROP NOT NULL` | ✓ |
| `007_add_production_lines.sql` | Added L002 (AI产线), L003 (装配产线), L004 (返修产线) to `production_lines` | ✓ |

---

### Frontend Changes

#### API Layer (`apps/web/src/api/`)

**`pmc.ts`** — wired:
- `getWorkOrders()` → `GET /pmc/work-orders`
- `getCustomerPos()` → `GET /pmc/customer-pos` (new)
- `createWorkOrder({ customerPoId?, woType?, ... })` → `POST /pmc/work-orders`
- `getSchedules()` → `GET /pmc/schedules`

**`wms.ts`** — wired:
- `getTransactions()` → `GET /wms/transactions`
- `getMaterialLots()` → `GET /wms/material-lots`
- `getStorageLocations()` → `GET /wms/storage-locations`

**`client.ts`** — response unwrapping:
- `get<T>()` returns `json.data as T` — response IS the `ListEnvelope` directly; use `.items` not `.data.items`
- `post<T>()` returns `json.data as T` from `MutateEnvelope`; use `result.item` for created object

#### PMC Views — All Wired to Real API

| File | API Called | Verified |
|---|---|---|
| `PmcDashboard` | `getWorkOrders()` | ✓ |
| `PmcWorkOrderList` | `getWorkOrders()` | ✓ |
| `PmcWorkOrderDetail` | `getWorkOrders()` | ✓ |
| `PmcCreateWorkOrder` | `getCustomerPos()` + `createWorkOrder()` | ✓ |
| `PmcPoList` | `getCustomerPos()` | ✓ |
| `PmcMaterialStatus` | `getSchedules()` | ✓ |

#### WMS Views — All Wired to Real API

| File | API Called | Verified |
|---|---|---|
| `WmsDashboard` | `getMaterialLots()` | ✓ |
| `WmsReceiving` | `getTransactions()` (RECEIVE filter) | ✓ |
| `WmsIqc` | `getMaterialLots()` (pending/hold) | ✓ |
| `WmsPutAway` | `getMaterialLots()` + `getStorageLocations()` + `getTransactions()` | ✓ |
| `WmsPicking` | Empty state (no pick-order API) | ✓ |
| `WmsIssue` | `getTransactions()` (ISSUE_TO_LINE filter) | ✓ |
| `WmsInventory` | `getMaterialLots()` | ✓ |

---

## Critical Bug Fix

**Problem:** `apiClient.get<T>()` returns `json.data as T` (unwraps one envelope level), but code was treating it as `Envelope<T>` and accessing `.data.items` — double-unwrap.

**Fix applied across all 13+ view files:**
- GETs: `woRes.items` (was `woRes.data.items`)
- POST (mutateEnvelope): `result.item?.code` (was `result.code`)

**`createWorkOrder` type signature:** `woType?: number` (was `type`), response includes `code: string`

---

## Browser Verification (2026-06-16)

| View | Result | Data |
|---|---|---|
| PMC 看板 | ✓ | 8 WO total, 2 running, release queue with real WO codes (26061010006…) |
| PMC 工单列表 | ✓ | 8 WOs with progress (4,210/7,200), (8,420/9,600), status filters |
| PMC 创建工单 | ✓ | PO dropdown loads from API, success shows generated 11-digit code |
| WMS 仓库看板 | ✓ | pendingReceive=0, 待检批次=2, 物料=16, 库区=62 |
| WMS 收料 | ✓ | RCV-240617-21/20/18/17 RECEIVE timeline |
| WMS IQC | ✓ | 2 pending lots (CAP-0805-100N待检, IC-MCU-RJ32待判定) with 合格/不合格 |
| WMS 上架 | ✓ | 62 storage locations + PUT-240617-30/28/29 timeline |
| WMS 履历 | ✓ | ISS/PICK/PUT/IQC transaction table + event chain |

---

## Known Data in System

- **Work orders:** 13 total — running×2, released×2, draft×8, paused×1, closed×1
- **Customer POs:** 3 (河内/胡志明/岘港)
- **Production lines:** L001 (SMT 一线), L002 (AI产线), L003 (装配产线), L004 (返修产线)
- **Material lots:** 16+ lots across L001A-xx, L001B-xx, RAW-xx, IQC-xx, HOLD-xx
- **API server:** `http://127.0.0.1:8080` (PID 33940)
- **Vite dev server:** `http://127.0.0.1:5173` (PID 35444)
- **Tests:** 12/13 passing (1 pre-existing backend smoke test timeout)

---

## What's Still TBD / Not Yet Wired

- `WmsPicking` and `WmsIssue` show empty-state/placeholder (no pick-order API exists in backend)
- `PmcMaterialStatus` shows placeholder "100%" / "pending" / "暂无数据" for `materialReady`, `firstArticle`, `pickOrder` (columns don't exist in DB)
- No IQC hold/release action wiring (合格/不合格 buttons exist but don't call API)
- No actual工单 creation flow beyond the form submit
- No MES, Quality, Traceability views wired to API

---

## How to Run

```bash
# Terminal 1: API server
cd smt-factory-system
node services/api/server.js

# Terminal 2: Vite dev server
cd smt-factory-system
npm run dev

# Open
http://127.0.0.1:5173
```

---

## Relevant Files

- `services/api/server.js` — POST /pmc/work-orders (optional PO), GET /pmc/customer-pos (new)
- `database/migrations/006_nullable_work_order_po.sql` — DROP NOT NULL on customer_po_id
- `database/migrations/007_add_production_lines.sql` — L002/L003/L004 seed
- `apps/web/src/api/pmc.ts` — getWorkOrders, getCustomerPos, createWorkOrder, getSchedules
- `apps/web/src/api/wms.ts` — getTransactions, getMaterialLots, getStorageLocations
- `apps/web/src/api/client.ts` — get/post with envelope unwrapping
- `apps/web/src/pmc/PmcDashboard.tsx`, `PmcWorkOrderList.tsx`, `PmcWorkOrderDetail.tsx`, `PmcCreateWorkOrder.tsx`, `PmcPoList.tsx`, `PmcMaterialStatus.tsx`
- `apps/web/src/wms/WmsDashboard.tsx`, `WmsReceiving.tsx`, `WmsIqc.tsx`, `WmsPutAway.tsx`, `WmsPicking.tsx`, `WmsIssue.tsx`, `WmsInventory.tsx`
