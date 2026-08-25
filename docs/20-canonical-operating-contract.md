# Canonical Operating Contract

Version: 1.0  
Frozen: 2026-07-22  
Scope: manual line, automatic line, MES, WMS, IQC, station agents and 3D monitoring

This document records the existing contract. It does not rename persisted production records. Legacy names are accepted only at the ingestion boundary and are converted to the canonical code before storage.

## 1. Identity rules

- Canonical line keys: manual line `L004`; automatic line `L002`.
- Canonical station identity: `station:<lineCode>:<stationCode>`.
- Manual station codes use `manu_`; automatic station codes use `auto_`.
- Display names are multilingual labels, never identifiers.
- An alias is scoped by line. `ICT-01` alone is not globally unique.
- New code must emit canonical codes. Aliases are input compatibility only.

### Main process sequence

| Step | Manual line (`L004`) | Automatic line (`L002`) | Official process |
|---:|---|---|---|
| 1 | `manu_aio` | `auto_aio` | AOI quality |
| 2 | `manu_ict` | `auto_ict` | ICT |
| 3 | `manu_fct` | `auto_fct` | FCT |
| 4 | `manu_depanel` | `auto_depanel` | Depanel |
| 5 | `manu_shellbinding` | `auto_shellbinding` | PCBA/shell binding |
| 6 | `manu_assem_ate` | `auto_assem_ate` | Assembly ATE |
| 7 | `manu_supersonic` | `auto_supersonic` | Ultrasonic |
| 8 | `manu_agingcab` | `auto_agingcab` | Finished-product aging |
| 9 | `manu_hivolt_ate` | `auto_hivolt_ate` | High-voltage ATE |
| 10 | `manu_package_ate` | `auto_package_ate` | Packaging ATE |
| 11 | `manu_case_binding` | `auto_case_binding` | Outer-box binding |
| 12 | `manu_pallet_binding` | `auto_pallet_binding` | Pallet binding |

`manu_pda`/`auto_pda` are pre-route loading nodes. `manu_rework` is a controlled branch and return node. They are not inserted into the numbered main route.

### Frozen compatibility aliases

| Line | Alias | Canonical code |
|---|---|---|
| L004 | `manu_aoi`, `AOI-01` | `manu_aio` |
| L004 | `ICT-01`, `MAN-ICT-01` | `manu_ict` |
| L004 | `FCT-01`, `MAN-FCT-01` | `manu_fct` |
| L004 | `manu_qr_binding`, `SHELL-BIND-01` | `manu_shellbinding` |
| L004 | `manu_outer_box_binding`, `CARTON-BIND-01` | `manu_case_binding` |
| L004 | `PALLET-BIND-01` | `manu_pallet_binding` |
| L004 | `REWORK-01` | `manu_rework` |
| L002 | `auto_aoi`, `AOI-01`, `AUTO-AOI-01` | `auto_aio` |
| L002 | `ICT-01`, `AUTO-ICT-01` | `auto_ict` |
| L002 | `FCT-01`, `AUTO-FCT-01` | `auto_fct` |
| L002 | `AUTO-PCBA-01` | `auto_depanel` |
| L002 | `AUTO-ASM-01` | `auto_shellbinding` |
| L002 | `auto_aging`, `AGING-CAB-01` | `auto_agingcab` |
| L002 | `AUTO-ATE-L`, `AUTO-ATE-R`, `auto_ate_left`, `auto_ate_right` | `auto_package_ate` |

The executable alias registry remains `services/api/src/shared/station-identity.js`; the persisted alias registry remains `station_code_aliases` from migration `137`.

## 2. Data ownership and direction

| Entity/fact | Authoritative owner | Producer | Consumers | Allowed direction |
|---|---|---|---|---|
| Work order, route, SN history | MES | PMC/MES | stations, WMS, 3D | MES downstream |
| Test result/raw source | station | station parser | MES | station -> MES |
| Confirmed NG lifecycle | MES | station detection; repair decisions | every station, maintenance, 3D | station -> MES; MES broadcast |
| Retest request/result | MES lifecycle; station execution fact | operator/station | MES, 3D | MES authorizes; station reports |
| Material, lot, location, inventory ledger | WMS | WMS/IQC | MES, stations | WMS downstream |
| IQC disposition | IQC | quality user | WMS, MES | IQC downstream |
| Binding map | MES history | binding station | downstream stations, 3D | station -> MES -> downstream |
| Heartbeat | station | station agent | MES/monitoring/3D | station -> monitoring |
| Alarm acknowledgement | owning operational system | authorized operator | MES audit, 3D | owner -> MES; 3D displays |
| 3D scene and counters | none (derived projection) | MES/read APIs | browsers | read-only |

Rules:

1. A consumer never writes back a derived copy as if it were the source.
2. After reconnect, upstream authoritative history wins; local unsent facts are replayed idempotently and conflicts are quarantined.
3. MES broadcasts confirmed NG and revival state, not pending/local parsing state.
4. Scanner reads perform NG and duplicate checks but do not create formal SN history unless the station contract explicitly defines a production event.
5. 3D can display and alarm only. It cannot lock, revive, migrate, delete or correct production data.

## 3. Roles and permissions

| Capability | Required permission/role | Prohibited shortcut |
|---|---|---|
| Create/change/void production WO | `pmc.edit` | station or WMS direct write |
| Read MES state | `mes.view` | anonymous mutation |
| Execute MES production event | `mes.execute` | 3D action |
| Maintain station master data | `mes.admin` | alias inferred from label |
| Read WMS | `wms.read` or deployed equivalent `wms.view` | direct table access from UI |
| Execute WMS movement/count | `wms.execute` | editing a balance column |
| Put away | `wms.put_away` | release without IQC state |
| NG migration to maintenance | operator or QC confirmation | scanner-only silent shipment |
| NG revival | Quality + line leader approval, MES audit | deleting NG history |
| Important conflict correction | Quality + Production + MES IT + factory manager meeting | silent overwrite |

## 4. State-transition contract

### Work order

`draft -> released -> running -> completed -> closed`

Exceptional transitions: `draft/released -> voided` with reason and immutable number history; `released/running -> held -> released` with authorization.

### Inventory lot

`received -> pending_iqc -> released -> stored -> reserved -> picked -> issued`

Branches: `pending_iqc -> hold/rejected`; `issued -> returned`; any eligible state -> `isolated -> approved_scrap -> disposed`. Quantity is derived from the movement ledger.

### IQC

`pending -> inspecting -> passed/released` or `pending/inspecting -> held/rejected`. Reinspection creates a new decision record; it does not rewrite the original result.

### Lifetime

`normal -> near_expiry -> expired -> isolated -> reinspection_passed/approved_scrap -> released/disposed`. Only approved reinspection may extend expiry.

### Product NG and repair

`detected -> confirmed_ng -> transfer_confirmed -> maintenance_pending_receipt -> repair_in_progress -> repair_completed -> return_pending_receipt -> revived`

The original NG and repair records remain permanent. Revival is a new authorized event. Detection-to-maintenance transfer alarm threshold is 20 minutes; repair lifecycle target is 2 hours; physical handovers require scan acknowledgement.

## 5. API and event envelope

- HTTP resources use plural nouns and system prefix: `/mes/...`, `/wms/...`, `/api/station/...` only for station-edge compatibility.
- Commands use `POST`; partial state changes use `PATCH`; reads use `GET`.
- Event types use uppercase dotted past tense: `MES.WORK_ORDER.RELEASED`, `WMS.LOT.ISSUED`, `STATION.TEST.RECORDED`.
- Every cross-system event contains:

```json
{
  "eventId": "globally-unique-id",
  "eventType": "STATION.TEST.RECORDED",
  "schemaVersion": 1,
  "occurredAt": "2026-07-22T00:00:00Z",
  "sourceSystem": "station",
  "sourceNode": "station:L004:manu_ict",
  "targetSystem": "mes",
  "correlationId": "work-order-or-transfer-id",
  "idempotencyKey": "stable-producer-key",
  "payload": {}
}
```

- Replayed events retain the same `eventId` and `idempotencyKey`.
- Acknowledgement confirms durable receipt, not merely HTTP delivery.
- Unknown schema versions are quarantined rather than partially applied.

## 6. Requirements-to-test traceability

| Requirement | Evidence target | Acceptance test |
|---|---|---|
| Manual/auto identities never collide | alias registry + canonical key | resolve same alias under L002/L004 and assert different keys |
| No route skipping | MES route history | reject station N+1 when N is incomplete |
| Scanner always checks NG/duplicate | station validation API | known NG and known SN are blocked without recording a new SN |
| Station facts reach MES once | exchange event ledger | repeat identical event and assert one durable fact |
| Reconnect loses no facts | offline queue/ack | 20-minute disconnect, replay, compare counts/checksums |
| Confirmed NG reaches all stations | MES NG broadcast | detect once and verify every subscribed station cache |
| Revival preserves history | NG/repair audit | complete repair approval and verify old NG remains searchable |
| Inventory is authoritative in WMS | inventory ledger | compare derived lot/location balance after receipt/issue/return |
| Expired/held stock is blocked | lifetime and IQC guards | reservation/pick/issue return 409/403 |
| 3D is read-only | route inventory + browser test | assert no 3D request can mutate production |
| Trilingual UI | i18n keys | render zh-CN/en-US/vi-VN without hardcoded fallback |
| WO number cannot duplicate/reuse | allocator + audit | 100 concurrent allocations and void/retry test |

## 7. Freeze decisions and known compatibility items

- `manu_case_binding` and `auto_case_binding` are the official outer-box binding codes.
- `manu_outer_box_binding` is retained only as a legacy alias.
- Historical sequence values in migrations `075/076` included loading offsets; canonical route order is the normalized order stored by migration `137`.
- Existing API permission spelling includes both `wms.read` and `wms.view`. New endpoints must use `wms.read`; `wms.view` remains compatibility-only until the permission migration is audited in M1.
- No IP address is part of station identity. IPs are deployment configuration and may change without changing canonical codes.
