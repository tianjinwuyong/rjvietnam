# API Design

This API boundary is organized by module, with a small number of reusable list, mutation, and query shapes.
The contract files for workers and UI adapters are:

- `services/api/src/contracts/api-contract.ts`
- `services/api/openapi.yaml`

## Shared conventions

- Base path: `/api`
- Authenticated requests use the current session established by `/auth/login`.
- Session and permission context is returned by `/auth/session` and `/meta/bootstrap`.
- Public i18n access is provided by `/meta/i18n/{locale}` so the login screen and shell can load strings before session bootstrap.
- All list endpoints support the common query family: `q`, `locale`, `page`, `pageSize`, `cursor`, `sort`, `fields`, and `include` where relevant.
- Date filters use ISO-8601 strings and the pair `fromDate` / `toDate`.
- Sort uses comma-separated field names. Prefix `-` for descending order.
- Mutation endpoints prefer a command payload with an `action` discriminator when one route must handle several related operations.

## Envelope conventions

Successful responses use one of these shapes:

```json
{ "data": { ... }, "meta": { "requestId": "...", "serverTime": "..." } }
```

List responses:

```json
{
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 50,
    "total": 0,
    "nextCursor": null
  },
  "meta": { "requestId": "...", "serverTime": "..." }
}
```

Mutation responses:

```json
{
  "data": { "item": { ... }, "auditEventId": "..." },
  "meta": { "requestId": "...", "serverTime": "..." }
}
```

Errors use a stable envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable summary",
    "details": {},
    "fieldErrors": { "field": ["message"] }
  },
  "meta": { "requestId": "...", "serverTime": "..." }
}
```

## Module surface

### Auth

- `POST /auth/login`
- `GET /auth/session`
- `GET /auth/sessions`
- `POST /auth/logout`
- `DELETE /auth/sessions/{sessionId}`
- `GET /auth/audit-events`

Notes:
- `GET /auth/session` is the canonical current-session read.
- `GET /auth/sessions` is for current-user session management and admin review.
- `GET /auth/audit-events` remains the audit search view for login, logout, and permission changes.

### Meta

- `GET /meta/bootstrap`
- `GET /meta/i18n/{locale}`
- `GET /meta/lookups`

Notes:
- `bootstrap` returns session, visible modules, permissions, locale, and dictionary version metadata.
- `i18n` is public so the UI can render the login shell.

### Dashboard

- `GET /dashboard/summary`

Notes:
- This is a read-only cross-module summary for management and line supervision.

### ERP

- `GET /erp/master-data`
- `POST /erp/master-data`
- `GET /erp/customer-pos`
- `POST /erp/customer-pos`

Notes:
- `master-data` is the shared entry point for customers, suppliers, products, materials, BOM revisions, and delivery plans.
- `customer-pos` carries the commercial demand that feeds PMC.

### PMC

- `GET /pmc/work-orders`
- `POST /pmc/work-orders`
- `PATCH /pmc/work-orders/{code}`
- `GET /pmc/schedules`

Notes:
- `PATCH /pmc/work-orders/{code}` is the lifecycle command surface for release, hold, close, and cancel.
- Work order codes remain the preserved 11-digit business code defined elsewhere in the project.

### WMS

- `GET /wms/material-lots`
- `GET /wms/storage-locations`
- `GET /wms/stock`
- `GET /wms/inventory-transactions`
- `POST /wms/transactions`

Notes:
- `transactions` is the canonical command endpoint for receive, IQC release/hold/reject, put-away, reserve, pick, issue to line, return, scrap, and adjust.
- Inventory balance is derived from the transaction ledger, not stored as a single mutable balance field.

### MES

The MES API exposes the production floor: lines, stations, process routes, runs, feeder bindings, PCB serials, station events, and downtime. Output rules per process-route step (`pass_through`, `route_fail_to_repair`, `close_work_order`) decide where each unit flows next.

#### Lines

- `GET /mes/lines` — list production lines with station count and active-run count
- `GET /mes/lines/{lineCode}` — single line plus its current run, OEE components, and 20 most recent events

#### Stations

- `GET /mes/stations` — filter by `lineCode` or `stationType`
- `GET /mes/stations/{code}` — station with its 20 most recent events

#### Process routes

- `GET /mes/process-routes` — list active routes, optional `productCode` filter
- `GET /mes/process-routes/{id}` — route with full ordered step list
- `GET /mes/process-routes/{id}/steps` — step list only

#### Runs (work-order execution sessions)

- `GET /mes/runs` — filter by `lineCode`, `workOrderCode`, `status`, date range
- `POST /mes/runs` — `action: 'start' | 'stop'` with `{ lineCode, workOrderCode, reason? }`
- `GET /mes/runs/{id}` — run with `oeeComponents` (availability × performance × quality), `downtimeMinutes`, `eventStats`, and `openDowntimes`
- `POST /mes/runs/{id}/close` — close the run and mark the work order as `closed`

#### Feeder bindings

- `GET /mes/feeder-bindings` — filter by `workOrderCode`, `lineCode`, `machineCode`, or `bound` (true/false)
- `POST /mes/feeder-bindings` — `action: 'bind'` with `{ workOrderCode, lineCode, machineCode, lotNo, feederNo, reelCode, operator }`
- `PATCH /mes/feeder-bindings/{id}` — `action: 'release' | 'unbind'`
- `DELETE /mes/feeder-bindings/{id}` — hard remove (use `PATCH release` for normal flow)

#### PCB serials

- `GET /mes/pcb-serials` — filter by `workOrderCode`, `lineCode`, `status`
- `POST /mes/pcb-serials` — `action: 'register'` with `{ serialNo, workOrderCode }`
- `GET /mes/pcb-serials/{serialNo}` — PCB with full event history

#### Station events

- `GET /mes/events` — filter by `lineCode`, `workOrderCode`, `pcbSerial`, `eventType`, date range
- `POST /mes/events` — `action: 'feeder_bind' | 'station_scan' | 'output' | 'downtime'` with the same payload shape used by all MES mutations

#### Downtime

- `GET /mes/downtimes` — filter by `lineCode`, `status` (open/closed/voided), date range
- `POST /mes/downtimes` — `action: 'open'` with `{ lineCode, stationCode?, reasonCode, reasonDetail?, operator }`
- `PATCH /mes/downtimes/{id}` — `action: 'close'` with `{ actionTaken, operator }`

#### Cross-cutting trace

- `GET /mes/trace/{serialNo}` — end-to-end trace: PCB + station events + material bindings

### Quality

- `GET /quality/records`
- `POST /quality/records`
- `PATCH /quality/records/{id}`
- `GET /quality/defect-pareto`

Notes:
- One records surface is used for inspection, defect, repair, re-inspection, close, void, and reopen.
- Quality records depend on defect code master data and station master data.

### Traceability

- `GET /traceability/{traceKey}`
- `GET /traceability/events`
- `POST /traceability/events`

Notes:
- `traceKey` can be a PO, work order, PCB serial, reel, lot, or shipment code.
- `POST /traceability/events` exists for internal append-only ingestion and imports, not as a replacement for normal business transactions.

### Reports

- `GET /reports`
- `GET /reports/{reportKey}`
- `GET /reports/{reportKey}/export`

Notes:
- `reports` is a catalog of available report definitions.
- `reportKey` is a stable business code, not a translated label.

### Admin

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{userId}`
- `GET /admin/roles`
- `PATCH /admin/roles/{roleKey}`
- `GET /admin/audit-logs`
- `GET /admin/settings`
- `PATCH /admin/settings`

Notes:
- `settings` covers shifts, calendar data, and code-rule configuration.
- `audit-logs` is the read surface for security and operational history.

### Finance

- `GET /finance/accounts`
- `GET /finance/cost-centers`
- `GET /finance/profit-centers`
- `GET /finance/journal-entries`
- `POST /finance/journal-entries`
- `GET /finance/ap-invoices`
- `POST /finance/ap-invoices`
- `GET /finance/ar-invoices`
- `POST /finance/ar-invoices`
- `GET /finance/shipments`

Notes:
- Finance reads should use the GL ledger, invoice tables, shipment references, and work-order cost summaries.
- Posting routes should remain append-only and should not overwrite ledger history.

## Request and response shape notes

- List payloads should return `items` plus pagination metadata, even when the current result set is small.
- Mutation payloads should return the saved record in `data.item` so UI workers do not need a second fetch.
- Command routes should include the operator context in the request body when the transport does not already provide a reliable identity.
- Locale-sensitive responses should echo the effective `locale` in `meta` when the server resolves one.
- The UI should rely on `meta.requestId` for support and audit correlation.

## Filtering conventions

- Text search: `q`
- Exact code filters: `code`, `lineCode`, `workOrderCode`, `materialCode`, `supplierCode`, `customerCode`
- Status filters: `status`, `iqcStatus`, `result`, `eventType`
- Time ranges: `fromDate`, `toDate`
- Pagination: `page` and `pageSize` for page-based lists, `cursor` for high-volume transaction streams
- Optional expansion: `include`
- Projection: `fields`

## Implementation dependencies that remain open

- ERP write operations still need final permission granularity for master-data maintenance.
- WMS transaction commands need action-specific authorization rules and final validation against the DB schema.
- MES event payloads depend on station, machine, feeder, and barcode contracts that are not yet finalized in this file.
- Quality closure depends on the defect-code and re-inspection policy owned by the data model and business rules layers.
- Report export behavior depends on the backend export worker and file delivery strategy.
- Auth/session cookie versus bearer-token handling is still an implementation decision in the auth layer and should not be fixed in this API file.
