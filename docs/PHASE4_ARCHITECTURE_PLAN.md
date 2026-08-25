# Phase 4: Modular Service Architecture Plan
## Current State: Monolithic Express API

```
smt-factory-system/services/api/server.js
├── ~13,500 lines (single file)
├── 20 modules in src/modules/
├── Shared PostgreSQL pool (max=20)
├── No caching (in-memory TTL added for dashboard/delivery-watch)
├── Synchronous cross-module queries (PMC → WMS → MES → Reports)
└── Single deployment unit
```

**Problem**: When PMC queries WMS inventory for material-status, it blocks.
When the report generation runs heavy aggregations, it affects real-time MES operations.

---

## Target Architecture: Modular Services + CQRS + Message Queue

```
┌─────────────────────────────────────────────────────────┐
│                     API Gateway (BFF)                     │
│              apps/web  ←  PDA  ←  Station Terminals        │
└──────┬──────────────┬──────────────┬──────────────┬───────┘
       │              │              │              │
   ┌───▼───┐    ┌────▼────┐  ┌────▼────┐  ┌───▼────┐
   │ PMC   │    │   WMS   │  │   MES   │  │   HR   │
   │Service│    │ Service │  │ Service │  │ Service│
   └───┬───┘    └────┬────┘  └────┬────┘  └───┬────┘
       │              │              │              │
       │         ┌────▼────────────▼────┐           │
       │         │   Message Bus       │           │
       │         │  (Bull / Redis MQ)  │           │
       │         └──────────┬───────────┘           │
       │                   │                        │
   ┌───▼───────────────────▼───┐              ┌───▼────┐
   │  Read Models / Projections │              │ Reports│
   │  (PostgreSQL R/O replica)  │              │ Service│
   └────────────────────────────┘              └────────┘

  ─── Sync REST/gRPC ───    ─── Async Events ───
```

---

## Phase 4A: Extract Services (Weeks 1-4)

### Service Boundary Decision

| Service | Owns | DB Schema | Port |
|---------|------|-----------|------|
| `pmc-svc` | work_orders, customer_pos, bom, bom_lines | `smt_pmc` | 8081 |
| `wms-svc` | material_lots, inventory_transactions, storage_locations | `smt_wms` | 8082 |
| `mes-svc` | mes_runs, station_events, feeder_bindings, ng_registry | `smt_mes` | 8083 |
| `hr-svc` | employees, shifts, attendance, leave | `smt_hr` | 8084 |
| `reports-svc` | Read-only projections, materialized views | `smt_reports` | 8085 |
| `auth-svc` | users, roles, permissions, jwt | `smt_auth` | 8086 |

**Why separate schemas (not just tables)?**
- Clear ownership boundaries
- Independent backup/restore
- Schema-level security isolation
- Each service can choose its own DB if needed later (e.g., WMS could move to TimescaleDB)

### Step 1: Shared Kernel Extract

Extract interfaces and types that cross service boundaries into `packages/shared-types`:

```
packages/shared-types/src/
├── factory.ts        ← existing types (Locale, WorkOrder, MaterialLot, etc.)
├── events.ts        ← NEW: canonical domain event definitions
└── api-contracts/   ← NEW: OpenAPI specs per service
```

**Domain Events (canonical)**:
```typescript
// events.ts
export type DomainEvent =
  | { type: 'WORK_ORDER_RELEASED';   payload: { woId: string; code: string; lineId: string } }
  | { type: 'WORK_ORDER_COMPLETED';  payload: { woId: string; completedQty: number } }
  | { type: 'MATERIAL_RECEIVED';     payload: { lotId: string; materialId: string; qty: number } }
  | { type: 'IQC_RELEASED';         payload: { lotId: string } }
  | { type: 'MATERIAL_ISSUED';       payload: { lotId: string; woId: string; qty: number } }
  | { type: 'FEEDER_BOUND';         payload: { bindingId: string; woId: string; feederNo: string } }
  | { type: 'STATION_CHECKIN';      payload: { stationId: string; employeeId: string; ts: string } }
  | { type: 'OUTPUT_REPORTED';      payload: { woId: string; stationId: string; qty: number; result: 'pass'|'fail' } };
```

---

## Phase 4B: CQRS — Separate Read from Write (Weeks 3-5)

### Write Side (Command Model)
- Normalized PostgreSQL schemas
- Strict constraints and triggers
- Synchronous validation
- Events emitted to message bus on commit

### Read Side (Query Model / Projections)
- Denormalized, pre-joined views/materialized views
- Optimized for specific query patterns
- Eventually consistent (eventual, < 1 second)

### Projection Examples

| Projection | Source Events | Updated By |
|-----------|---------------|------------|
| `proj_wo_material_status` | `MATERIAL_ISSUED`, `IQC_RELEASED` | `wms-svc` → `reports-svc` |
| `proj_dashboard_stats` | All domain events | `reports-svc` |
| `proj_delivery_risk` | `WORK_ORDER_RELEASED`, `OUTPUT_REPORTED` | `pmc-svc` |
| `proj_line_oee_daily` | `STATION_CHECKIN`, `OUTPUT_REPORTED` | `mes-svc` |

### Materialized Views → Projections

The `mv_*` views created in Phase 3 become **projection tables** maintained by event consumers:

```sql
-- Projection table maintained by wms-svc consuming MATERIAL_ISSUED events
CREATE TABLE proj_wo_material_status (
  wo_code           TEXT,
  material_code     TEXT,
  required_qty      NUMERIC,
  picked_qty        NUMERIC,
  shortfall        NUMERIC,
  fulfillment_pct  NUMERIC,
  last_updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (wo_code, material_code)
);
```

**Instead of re-computing from joins on every query**, the projection is updated incrementally by the event consumer.

---

## Phase 4C: Message Queue (Weeks 4-6)

### Technology: BullMQ (Redis-backed)

Why BullMQ over raw Redis or Kafka:
- Already has Redis (used for caching in Phase 2)
- Simple job queues for fire-and-forget events
- Retry with exponential backoff
- Dashboard for monitoring
- No schema management needed

### Event Flow

```
PMC creates WO
  → pmc-svc writes work_orders (commit)
  → pmc-svc enqueues WORK_ORDER_RELEASED to BullMQ
  → BullMQ dispatches to:
       • wms-svc worker: reserves materials in proj_wo_material_status
       • mes-svc worker: creates mes_run record
       • reports-svc worker: updates dashboard stats projection
       • auth-svc worker: notifies assigned operators (future)
  → All workers ACKnowledge → job marked complete
  → If any worker fails → BullMQ retries with backoff (3 attempts)
```

### Queue Definitions

```typescript
// queues/events.ts
import { Queue } from 'bullmq';
import { getRedisInstance } from './redis.js';

let _queues: Record<string, Queue> = {};

export function getQueue(name: string): Queue {
  if (!_queues[name]) {
    _queues[name] = new Queue(name, {
      connection: getRedisInstance(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
      },
    });
  }
  return _queues[name];
}

// Event producers (in each service)
export async function emitEvent(event: DomainEvent) {
  await getQueue('domain-events').add(event.type, event, {
    jobId: `${event.type}_${Date.now()}`,
  });
}
```

### Inter-Service REST (for synchronous needs)

**Only for**: critical reads that must be current (e.g., "is this lot IQC released?").

```
pmc-svc  →  GET http://wms-svc:8082/lots/{lotId}/iqc-status
mes-svc  →  GET http://pmc-svc:8081/work-orders/{code}/requirements
```

**Rule**: If it can be eventual consistent, use the queue.

---

## Phase 4D: Migration Path (Weeks 1-8)

### Week 1-2: Shared Kernel + Event Types
1. Extract `packages/shared-types/src/events.ts` with all domain events
2. Publish `packages/shared-types` to local npm registry (or use `file:` protocol)
3. Add event type definitions to each module's index.ts

### Week 3-4: Extract First Service (PMC)
1. Copy `server.js` routes for `/pmc/*` into new `pmc-svc/`
2. Extract `src/modules/pmc/` → `pmc-svc/routes/`
3. Create `smt_pmc` schema (copy of relevant tables)
4. Set up `pmc-svc` on port 8081
5. Keep old routes in `server.js` but have them call `pmc-svc` via REST
6. Run both in parallel, compare responses

### Week 5-6: Extract WMS and MES
Same pattern for WMS and MES services.

### Week 7-8: Reports Service + BullMQ
1. Create `reports-svc` consuming domain events
2. Replace report routes in `server.js` with `reports-svc` calls
3. Add BullMQ consumers in each service for cross-service events

---

## Files to Create

```
smt-factory-system/
├── services/
│   ├── pmc-svc/         # NEW — PMC microservice
│   ├── wms-svc/         # NEW — WMS microservice
│   ├── mes-svc/         # NEW — MES microservice
│   ├── hr-svc/          # NEW — HR microservice
│   ├── reports-svc/     # NEW — Reports projection service
│   ├── auth-svc/        # NEW — Auth/JWT service
│   └── shared/          # SHARED — event types, queue utilities
├── packages/
│   ├── shared-types/
│   │   └── src/events.ts   # NEW — canonical domain events
│   └── queue/           # NEW — BullMQ utilities
└── docs/
    └── ARCHITECTURE.md  # UPDATED — new architecture diagrams
```

---

## Rollback Plan

If any service extract fails or causes issues:
1. Keep old route in `server.js` as fallback (commented)
2. Feature flag each extracted service via `ENABLED_SERVICES=pmc,wms,mes`
3. Fall back to direct DB calls when service is disabled

---

## Performance Targets (Post Phase 4)

| Metric | Before | After |
|--------|--------|-------|
| Dashboard load | ~400ms | < 50ms (cached) |
| Material-status | ~800ms | < 100ms (projection) |
| Report: material-balance | ~600ms | < 30ms (MV) |
| Cross-module event propagation | N/A | < 1s eventual |
| Report generation | ~2s | < 500ms (pre-computed) |
| Concurrent users supported | ~50 | ~500 |
