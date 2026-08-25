# SMT PDA Material Loading — MES Authority and API Knowledge

## Scope

This document defines the SMT material-loading PDA domain model. MES is the system of record and final authority. The PDA is a station execution client: it identifies the operator and hardware, scans the required identifiers, submits them to MES, displays the decision, and preserves the traceability context.

The PDA must not locally unlock a machine, bypass a BOM, override IQC/QMS, alter inventory, or decide whether production may continue.

## System authority

```text
PMC  -> releases production plan and loading time window
WMS  -> provides approved material lots, quantity, reel/SN and issue status
QMS  -> provides IQC, expiry, MSD and quality restrictions
MES  -> validates rules, controls loading, binds material, releases line and audits
PDA  -> scans, displays, submits and executes the MES decision
```

## Loading flow

```text
PMC plan
  -> MES releases work order/time window
  -> PDA authenticates operator and device
  -> PDA scans machine
  -> PDA scans channel/slot
  -> PDA scans feeder
  -> PDA scans material reel/lot SN
  -> MES validates BOM, machine, slot, feeder, material, lot, quality, expiry and quantity
  -> PASS: MES records binding and PDA continues
  -> BLOCK: PDA shows reason and stops the binding
  -> all required slots complete
  -> Line Manager confirms
  -> MES releases or continues production
```

## PDA navigation

```text
SMT PDA
├── Home
│   ├── MES online/offline status
│   ├── current line and operator
│   └── pending loading tasks
├── MES Work Orders
│   ├── today's work orders
│   ├── scheduled / ready / loading / completed
│   └── work-order detail and time window
├── Start Material Loading
│   ├── select work order
│   ├── scan operator, machine, channel/slot, feeder and reel SN
│   └── MES validation
├── Loading Progress
│   ├── pending slots
│   ├── passed slots
│   ├── blocked slots
│   ├── replacement
│   └── replenishment
├── Exceptions
│   ├── create request
│   ├── line-manager review
│   └── plant-manager authorization
├── History
│   ├── loading records
│   ├── reel/material traceability
│   ├── feeder-binding history
│   └── audit log
└── Settings
    ├── language
    ├── MES connection
    ├── scanner/device authorization
    └── logout
```

## Required permissions and authorization

- Operator: execute assigned loading tasks and scan only.
- Line Manager: confirm completion, request replenishment, and submit exceptions.
- Plant Manager: authorize permitted exceptions.
- MES Admin: maintain rules and permissions; not normal loading execution.
- Every action requires a valid user session, role, line authorization, device authorization, work-order permission, and valid loading time window.
- Session timeout, shift end, logout, revoked authorization, or expired offline authorization must lock the PDA.
- Offline mode is allowed only for a pre-authorized task and approved cached data. It must never bypass BOM, IQC, expiry, quantity, or traceability checks.

## API communication map

The PDA communicates with MES. MES is the gateway to PMC, WMS and QMS.

```text
PDA
├── Authentication
│   ├── POST /api/auth/login
│   ├── POST /api/auth/employee-scan
│   ├── GET  /api/auth/session
│   └── POST /api/auth/logout
├── MES work orders and loading
│   ├── GET  /api/mes/work-orders
│   ├── GET  /api/mes/loading/tasks
│   ├── POST /api/mes/loading/session
│   ├── POST /api/mes/loading/validate
│   ├── POST /api/mes/loading/bind
│   ├── POST /api/mes/loading/replace
│   ├── POST /api/mes/loading/complete
│   ├── POST /api/mes/line-release
│   └── GET  /api/mes/loading/history
├── PMC through MES
│   ├── GET /api/mes/pmc/plans
│   ├── GET /api/mes/pmc/time-windows
│   └── GET /api/mes/pmc/released-work-orders
├── WMS through MES
│   ├── GET  /api/mes/wms/material-lots
│   ├── GET  /api/mes/wms/material-availability
│   ├── POST /api/mes/wms/replenishment-request
│   └── GET  /api/mes/wms/issue-status
├── QMS through MES
│   ├── GET /api/mes/qms/iqc-status
│   ├── GET /api/mes/qms/lot-status
│   ├── GET /api/mes/qms/expiry-status
│   └── GET /api/mes/qms/msd-status
├── Exceptions
│   ├── POST /api/mes/exceptions
│   ├── GET  /api/mes/exceptions/my-requests
│   ├── POST /api/mes/exceptions/:id/line-manager-review
│   └── POST /api/mes/exceptions/:id/plant-manager-authorize
├── Traceability
│   ├── GET /api/mes/trace/material/:reelSn
│   ├── GET /api/mes/trace/feeder/:feederId
│   ├── GET /api/mes/trace/work-order/:wo
│   └── GET /api/mes/audit/loading
└── Connectivity and sync
    ├── GET  /api/mes/health
    ├── GET  /api/mes/sync/status
    ├── POST /api/mes/sync/upload
    └── GET  /api/mes/sync/pending
```

Endpoint names are the conceptual contract. Existing implementation routes must be mapped to this contract before production rollout; do not invent a parallel source of truth.

## Mandatory MES validation

MES must validate all of the following before binding:

- work order is released/running and belongs to the current line;
- loading time window is valid;
- material belongs to the frozen work-order BOM;
- machine and channel/slot belong to the work order and line;
- feeder matches the channel and machine rule;
- reel/SN exists, is not duplicated, and is not already bound elsewhere;
- lot passed IQC and is not expired, frozen, scrapped, or otherwise blocked;
- MSD/open-time rules are satisfied;
- available quantity is sufficient;
- operator and device are authorized.

Every PASS, BLOCK, replacement, exception, approval, retry and synchronization event must be auditable with operator, device, line, work order, machine, slot, feeder, material code, lot/reel SN, timestamp and reason.

## Safety boundary

PDA does not scan PCB SN or decide SPI results. SPI/QMS results, NG isolation, disposition and audit remain under MES/QMS control. A failed validation must stop the binding and show a concrete reason for the operator, without offering a bypass action.
