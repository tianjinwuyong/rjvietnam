# Manual-line PDA ↔ MES real-time binding contract

## Purpose

This contract keeps the material-loading PDA inside the `manual-line` process
domain. The PDA is the execution surface for MES and PMC instructions: it
scans, shows the authorized command, performs the physical/operator action,
and reports the fact back. MES/PMC remain authoritative for work-order state,
BOM permission, material consumption, NG/repair decisions, and final release.

## Domain gate (mandatory on every request)

```json
{
  "processDomain": "manual-line",
  "lineCode": "MANUAL-01",
  "stationCode": "PDA-MATERIAL-LOADING",
  "deviceId": "PDA-<registered-id>",
  "operatorId": "<authenticated-user>",
  "eventId": "uuid",
  "occurredAt": "2026-08-06T00:00:00Z"
}
```

MES must reject a request when `processDomain` is missing or differs from
`manual-line`; a PDA must never change the domain locally. `eventId` is the
idempotency key and must be unique per business event.

## Ownership map

| Area | Owner | PDA behavior |
|---|---|---|
| People, role, training, employment status | HR + MES authorization | Login only; cache no authority |
| Line/station/device registration | MES administration | Read assigned profile; heartbeat |
| Work order, priority, route, BOM revision | PMC/MES | Execute assigned steps; cannot edit source data |
| Lot IQC status, stock, issue/return | WMS/MES | Execute authorized issue/return; cannot bypass |
| Four-way binding (WO/BOM/slot/material) | MES | Show pass/NG result |
| Consumption and traceability | MES/WMS | Submit immutable event |
| NG/repair/retest | MES route service | Display decision and execute scan |

## API surface

The existing client routes remain the transport surface. The server must apply
the domain gate and common event envelope to all write calls.

### Identity and profile

- `POST /auth/login` — validate operator credentials and return roles.
- `GET /auth/session` — return operator, device, `processDomain`, line and
  station profile.
- `GET /pda/profile` — return the active manual-line configuration, API
  version, feature flags and MES connection state.
- `POST /pda/heartbeat` — device health, app version, local queue depth and
  last successful MES contact.

### PMC and WMS facts

- `GET /pmc/work-orders` and `GET /erp/boms/product/{productCode}` — read-only
  planning/BOM facts.
- `POST /pmc/work-orders/{code}/lock|unlock|complete` — authorized MES/PMC
  actions only; PDA may request but cannot self-authorize.
- `GET /wms/material-lots`, `GET /wms/stock` and lot transactions — read-only
  inventory facts.
- `POST /wms/issue-to-line` and `POST /wms/return-from-line` — idempotent
  inventory movements with `eventId`, operator and material evidence.

### Real-time material binding

- `POST /mes/feeder-binding/validate` — validate WO, BOM revision, machine,
  slot/channel, feeder, lot, IQC status and operator permission.
- `POST /mes/feeder-binding/confirm` — commit the binding only after a passing
  validation; returns binding id and authoritative timestamp.
- `GET /mes/feeder-binding/{workOrderCode}` — refresh the live binding map.
- `DELETE /mes/feeder-binding/{id}` — unbind only with an authorized reason;
  never delete history.
- `POST /mes/feeder-loading` and `DELETE /mes/feeder-loading/{id}` — record
  material load/unload and consumption reservation.
- `POST /mes/work-start` — start work only when the manual-line gate is valid.

Every write response should include:

```json
{
  "eventId": "same-id-as-request",
  "accepted": true,
  "serverTime": "2026-08-06T00:00:00Z",
  "processDomain": "manual-line",
  "mesRevision": 12345
}
```

## Real-time behavior

1. PDA scans and sends `validate` with the domain envelope.
2. MES checks PMC work order/BOM and WMS lot/IQC/quantity in one authoritative
   decision.
3. PDA displays `PASS`, `BLOCKED`, or `REQUIRES_AUTHORIZATION`; it does not
   infer a pass from a timeout.
4. PDA sends `confirm` with the returned validation token and `eventId`.
5. MES publishes the binding/consumption event to station views and history.
6. If disconnected, the PDA stores the immutable outbox event and marks the
   UI `PENDING_MES`; it must not issue, consume, release, or modify a route
   locally.

## Execution responsibility

The PDA is considered complete only when it can execute the approved command
and return a verifiable result for each responsibility below:

| Command from MES/PMC | PDA executes | MES records |
|---|---|---|
| Assign shift, line, station and work order | Show assignment and enforce scan context | Assignment acknowledgement |
| Start/hold/resume/complete work | Require operator confirmation and device readiness | State transition and audit |
| Load material to a machine/channel | Scan machine, channel, feeder, lot; guide operator | Four-way validation, binding and consumption |
| Return/unload material | Scan current binding, reason and quantity | WMS movement and trace event |
| Block for NG or repair | Stop the affected action and display route | NG event, repair order and next authorized station |
| Retest or release | Run only when MES supplies an approved token | Retest result and final disposition |
| Exception/override | Collect reason and supervisor approval | Approval, evidence and immutable history |

PMC supplies the plan and priority; MES translates that plan into executable
commands and permissions; the PDA executes them at the line and reports
success, block, or pending status. No layer silently substitutes a different
domain or route.

## HR and line-manager controls

- HR owns operator identity, employment status, role and training expiry.
- MES line managers own station assignment, shift, device pairing and
  authorized exception limits.
- A supervisor approval is required for unbind, manual issue/return, expired
  training, or any NG/repair override.
- Every approval records `operatorId`, `approverId`, reason, eventId and time.

## Acceptance checks

- A `smt`, `auto-line`, or missing-domain request returns `403 DOMAIN_MISMATCH`.
- Repeating the same `eventId` returns the original result without a duplicate
  stock movement or binding.
- A changed BOM revision or IQC failure blocks confirmation.
- MES outage leaves a visible pending state and an immutable local outbox.
- MES recovery replays by `eventId`; conflicts remain for MES adjudication.
- Audit history remains queryable after unbind, return, NG, repair and retry.
