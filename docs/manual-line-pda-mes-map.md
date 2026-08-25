# Manual-line PDA material loading → MES map

The manual-line PDA is an Android edge client. MES owns the manual-line process domain,
work-order/BOM decisions, authorization, inventory truth, consumption history, and audit.

```mermaid
flowchart LR
  subgraph EDGE[Android PDA — MANUAL domain]
    LOGIN[Device + operator login]
    PROFILE[Versioned PdaProfile]
    SCAN[Scan machine → channel → feeder → material]
    LOCAL[Local encrypted queue / retry]
    UI[zh-CN / en-US / vi-VN UI]
  end

  subgraph MES[MES Level 3 — source of truth]
    AUTH[Identity + role authorization]
    WO[Work order + product + BOM]
    GATE[Manual-line domain gate]
    VALIDATE[Four-way match + IQC/MSD/expiry checks]
    USAGE[Material issue / consumption / return]
    TRACE[Immutable event and audit history]
    APP[Managed-app registry: MANUAL-LINE-PDA v1.0.9]
    HEALTH[Heartbeat + device/app status]
  end

  subgraph WMS[WMS / inventory]
    LOT[Lot, QR, quantity, location]
    BALANCE[Available / issued / consumed / returned balance]
  end

  subgraph LINE[Manual-line stations]
    STATIONS[ICT · FCT · Depanel · repair loop]
    PRODUCT[Product/SN trace]
  end

  LOGIN --> PROFILE --> SCAN
  UI -. display only .- SCAN
  SCAN -->|request| GATE
  GATE --> AUTH
  GATE --> WO
  GATE --> VALIDATE
  VALIDATE --> LOT
  VALIDATE -->|ALLOW / BLOCK| SCAN
  SCAN -->|confirmed usage fact| USAGE
  USAGE --> BALANCE
  USAGE --> TRACE
  USAGE --> PRODUCT
  PRODUCT --> STATIONS
  APP --> PROFILE
  LOGIN --> HEALTH
  HEALTH --> TRACE
  SCAN -. MES offline .-> LOCAL
  LOCAL -->|idempotent replay after recovery| TRACE
  AUTH -. offline privileged actions blocked .-> LOCAL
```

## Required event envelope

Every loading, return, or consumption event must contain: `eventId`, `processDomain=manual-line`,
`stationCode`, `deviceId`, `operatorId`, `workOrder`, `productCode`, `machineCode`,
`channelCode`, `feederCode`, `materialCode`, `lotNo`, `quantity`, `unit`, `occurredAt`,
`source=android-pda`, and the MES decision. The event is append-only and idempotent.

## Standard alignment

- ISA-95 places MES/manufacturing operations management at Level 3 and defines exchanged
  objects and attributes for integration; the PDA therefore captures facts while MES owns
  decisions and process state.
- GS1 traceability uses Critical Tracking Events and Key Data Elements; the loading map
  records the five practical dimensions: who, what, where, when, and why.
- Android managed configurations allow enterprise administrators to control approved-app
  settings remotely; the MES managed-app registry supplies the approved version/profile.

## Release gate

1. Apply migration `222_manual_line_pda_loader_release.sql`.
2. Register each PDA device and assign the `MANUAL` profile.
3. Verify the manual-line API endpoints and WMS lot/quantity responses.
4. Run read-only smoke tests for scan order, duplicate blocking, domain blocking, and
   MES recovery replay.
5. Run one authorized production test and verify the complete material-consumption trace.

