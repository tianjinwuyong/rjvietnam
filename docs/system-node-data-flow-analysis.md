# System Node and Data-Flow Analysis

Date: 2026-07-19  
Scope: physical stations, local Agents, MES services, management nodes, PostgreSQL, local SQLite, and the manual-line 3D monitor. Automatic-line and SMT nodes use the same ownership rules and must be audited against this map before deployment.

## 1. System layers

| Layer | Nodes | Correct responsibility | Must not do |
|---|---|---|---|
| Physical process | Tester, scanner, operator, printer, database source | Produce physical facts | Invent upstream history or central approval |
| Station Agent | ICT/FCT/AOI/depanel/binding/ATE/etc. | Read source, validate, commit locally, queue immutable events | Accept a generic MES snapshot as a replacement for local pending/PASS/raw state |
| Local persistence | Per-station SQLite and durable outbox | Offline continuity and local source truth | Become an independent factory-wide master |
| MES ingestion/workflow | Express API and PostgreSQL | Accept events, register SNs, own confirmed NG/workflows/audit | Push station-owned datasets back down |
| MES management UI | Station, repair, scrap, conflict, trace, WO, binding pages | Supervise and issue approved targeted actions | Directly mutate station SQLite or bypass workflow APIs |
| 3D monitor | `ManualLineDashboard.tsx` | Display MES state and alarms | Reconstruct production truth in browser memory/localStorage |
| Central persistence | PostgreSQL | Factory SN, confirmed NG, handover, WO, audit and version registry | Treat transient UI state as authoritative |

## 2. Physical station and Agent map

| Seq. | Station | Canonical code | Formal input | Local authority | MES output | Required downstream input/ack |
|---:|---|---|---|---|---|---|
| 1 | PDA material loading | `manu_pda` (must be made explicit) | Scanner + work order | Scan observation/loading session | Loading and WO binding event | AOI/first process accepts released WO/material context |
| 2 | AOI quality | currently `manu_aio` | MySQL AOI records | Raw/parsed AOI result | Heartbeat, formal result, confirmed NG proposal | ICT consumes accepted identity and AOI restriction state |
| 3 | ICT | `manu_ict` | `D:\SRC` CSV, 12-board group | Raw result, PASS, pending test state | Formal SN/result, confirmed NG, motherboard layout | FCT consumes the exact acknowledged 12-board output |
| 4 | FCT | `manu_fct` | ATS Excel, 12-board group | Raw result, PASS, pending test state | Formal result, confirmed NG, FCT layout | Depanel consumes MES-merged ICT+FCT layout |
| 5 | PCBA depanel | `manu_depanel` | Scanner + merged MES layout | Scan receipt and local rendered cache | NG pick, maintenance WO request, receipt | Binding receives separated allowed boards; repair receives NG boards |
| 6 | PCBA/shell binding | `manu_shellbinding` | Two scanner reads | Binding session until acknowledged | Shell↔board mapping, WO trace | Assembly ATE consumes accepted binding identity |
| 7 | Assembly ATE | `manu_assem_ate` | ATE Excel; separated boards | Raw/parsed test result | Formal result, confirmed NG | Supersonic consumes accepted board/shell identity and restrictions |
| 8 | Supersonic | `manu_supersonic` | SQL Server test table + scanner check | Raw/parsed process result | PASS/confirmed NG | Aging consumes accepted product state |
| 9 | Finished-product aging | `manu_agingcab` | MySQL aging data | Raw/parsed aging result | PASS/confirmed NG and required ATE retest execution | High-voltage ATE consumes accepted aging result |
| 10 | High-voltage ATE | `manu_hivolt_ate` | ATE Excel | Raw/parsed test result | Formal result/confirmed NG | Package ATE or aging retest consumes accepted result |
| 11 | Package ATE | `manu_package_ate` | ATE Excel | Raw/parsed test result | Formal result/confirmed NG | Outer-box binding consumes accepted final-test result |
| 12 | Outer-box binding | `manu_outer_box_binding` | Product and carton scanner reads | Open carton session | Carton↔SN binding and WO trace | Pallet binding consumes sealed accepted carton |
| 13 | Pallet binding | currently `manu_case_binding` | Carton/pallet scanner + printer | Open pallet session | Pallet↔carton binding, label/print audit | Warehouse accepts sealed pallet and quantity |
| Branch | Repair/quality station | `manu_rework` | Scanner + targeted MES maintenance WO | Repair receipt, material usage, repair execution | Completion, return order, revival proposal | Original source station scans and acknowledges return |
| Support | Wave solder heartbeat | `wave_solder` | Process heartbeat only | Current health | Heartbeat | MES/3D only |

## 3. MES management nodes

| Management node | Authoritative data | Reads | Writes/commands | Consumers |
|---|---|---|---|---|
| Station master/type management | Station identity, line membership, capabilities | Station definitions | Versioned station configuration | MES routing, Agents, 3D |
| Station-flow/sequence management | Canonical route and order | Station master | Approved route versions | Handover and upstream validation |
| Factory SN registry | Accepted production SN identity | Formal station events | Atomic registration/status | Duplicate guard and traceability |
| Confirmed-NG registry | Active factory NG blocks | Confirmed NG proposals/repair decisions | Versioned guard/revival events | Every scanning station |
| Motherboard merge service | ICT+FCT 12-slot combined layout | Acknowledged ICT/FCT layouts | Merged versioned layout | Depanel and 3D |
| Handover manager | Output/receipt continuity | Source output and destination scans | Targeted receipt commands/timeouts | Source, destination, 3D |
| Maintenance WO manager | Repair lifecycle/material usage | Depanel/source request and repair scans | Targeted WO, return, revival | Repair and original station |
| Retest policy manager | Allowed test policy and approvals | Station/product configuration | Versioned targeted policy/authorization | Relevant testing station |
| Scrap workflow | Scrap application/evidence/approval | Station requests | Approved/rejected targeted command | Requesting station, quality, audit |
| Work-order/QR binding | QR↔WO and active station WO | PDA/binding/packaging events | Query response and approved WO state | All identity-consuming stations |
| Residence/timeout monitor | Entry, exit, dwell time | Acknowledged station events | Targeted alarm | Station, MES UI, 3D |
| Reconciliation/conflict manager | Hashes, versions, investigation record | Station snapshot + MES copy | Approved correction version | Relevant station and audit |
| Traceability | Immutable product history | All accepted events/workflows | Read-only query response | MES users, quality, service |
| 3D data supplier | Current MES projection | Central registries and workflows | Display stream only | All 3D browsers |

## 4. Persistence ownership

| Store/table family | Owner | Direction | Recovery behavior |
|---|---|---|---|
| Station raw/source tables | Station | Station → MES only | Replay immutable events after reconnect |
| Station pending/PASS/local test tables | Station | Station → MES only | MES compares; never overwrites |
| Station outbox | Station until acknowledged | Station → MES | Ordered retry; quarantine permanent rejection |
| `station_sn_registry` / `factory_sn_master` | MES | Request/response | MES atomic check and registration |
| Confirmed-NG registry/cache | MES | MES → stations | Versioned delta or atomic MES-owned cache replacement |
| `station_bucket_snapshots` | MES copy/display projection | Station → MES → 3D | Never treated as a station write-back payload |
| Handover/maintenance/scrap/retest tables | MES | Targeted commands | Cursor/version and receipt acknowledgement |
| `station_confirmed_motherboard_layouts` | MES | ICT/FCT → MES → depanel | Merge only verified motherboard identities |
| Browser state/localStorage | No production ownership | Display preference only | Safe to discard at any time |

## 5. Confirmed problems found in the current implementation

| Severity | Problem | Evidence/impact | Required correction |
|---|---|---|---|
| Critical | MES rewrites station bucket snapshots during revival | `server.js` rebuilds `pending_ng` and `confirmed_ng` for station snapshots | MES may change only its confirmed-NG registry and issue a targeted revival command; station removes local rows after scan/ack |
| Critical | Generic bucket updates broadcast to `to: "*"` | Every browser/station can receive unrelated payloads | Bucket events are display-only; commands must carry an explicit target and consumer policy |
| Critical | 3D reconstructs production boxes from SSE/browser state | Different browsers can diverge | 3D must query/version MES projections and never own production state |
| Critical | Pallet/container data is retained in browser `localStorage` | One browser differs from another | Store active carton/pallet sessions in MES; localStorage only keeps UI preference |
| High | Route inference uses UI station IDs and adjacent array entries | Non-consecutive IDs and repair branch can infer the wrong station | Use MES station-sequence/route tables only |
| High | Two overlapping API families exist | `/api/pda/events` and generic `/mes/events` can apply different validation | Select one canonical ingestion contract; adapt legacy clients at an edge adapter |
| High | Station naming is inconsistent | AOI uses `manu_aio`; pallet uses `manu_case_binding` | Create immutable canonical codes and aliases; never infer meaning from display name |
| High | All bucket snapshots are returned by one unscoped GET | Stations can read unrelated station-owned data | Require consumer station, dataset, direction policy, and authorization filter |
| High | Many MES workflow broadcasts use `to: "*"` | Repair/scrap/handover commands leak to all nodes | Target the affected station(s); send a separate redacted display event to 3D |
| High | Legacy `copy.py` Agents remain beside formal Agents | Wrong executable may use obsolete reverse-sync behavior | Remove/archive legacy entry points before final EXE build |
| High | Repair Agent is outside the manual-line single-instance rollout | Duplicate repair processing is possible | Add the shared single-instance lock to `manu_rework` |
| Medium | PDA has no explicit canonical station code in its entry file | Loading events can become `unknown` or inconsistent | Set and register `manu_pda`; keep it non-display if desired |
| Medium | Hardcoded IPs/credentials and mixed localhost/remote URLs | Deployment behavior differs by machine | Use signed/versioned station configuration with secrets outside source |
| Medium | Heartbeat, display event and business event share transport | Replay/filter mistakes can contaminate state | Separate ephemeral telemetry from durable business ingestion |

## 6. Canonical downstream relay

For every route edge `A → B`:

1. A commits its output locally.
2. A sends an immutable event to MES.
3. MES validates and acknowledges the accepted output.
4. MES exposes that accepted output to B as scoped upstream context.
5. B scans/identifies and durably acknowledges receipt.
6. B processes and appends its result; it never edits A's history.
7. MES checks identity, quantity, work order, bindings, NG restrictions and timing across the edge.

Invariant:

`B input = acknowledged A output + approved exceptions`

## 7. Correction order

1. Freeze canonical station codes and the physical route graph.
2. Separate durable business events, ephemeral heartbeat, display projections and targeted commands.
3. Remove MES reverse writes to station-owned pending/PASS/raw datasets.
4. Replace global workflow broadcasts with targeted commands plus separate 3D display events.
5. Make PostgreSQL the only 3D data supplier; remove production state from browser localStorage.
6. Scope bucket/snapshot APIs by consumer and data-flow policy.
7. Consolidate ingestion APIs and preserve an adapter for legacy Agents.
8. Implement per-edge output/receipt balance and handover acknowledgement.
9. Enforce offline cursors, event ordering, idempotency and controlled reconnect deltas.
10. Archive legacy Agents, add locks to remaining support nodes, and run end-to-end acceptance tests.
