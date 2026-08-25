# Trinity Charter Compliance Audit

Date: 2026-07-19  
Scope: current source structure for station Agents/local SQLite, MES/API/PostgreSQL, and the manual-line 3D monitor.  
Method: static code and data-flow review. Runtime, network-loss, scanner, database-load, and multi-browser acceptance tests are still required.

## Executive result

The Trinity is **not yet compliant enough for production sign-off**.

| Trinity member | Result | Summary |
|---|---|---|
| Station Agents + local SQLite | Partial | Strong local durability and guard foundations exist, but scanner recording, outbox failure handling, legacy entry points, locks, and configuration are inconsistent. |
| MES + PostgreSQL/workflows | Fail on ownership boundary | MES has the right central registries and workflows, but it also rewrites station-owned bucket projections, exposes broad mutation APIs, and globally broadcasts commands. |
| 3D line | Fail on display-only boundary | The 3D client reconstructs operational state, stores production-related state in browser localStorage, and can clear/migrate data. Different browsers can therefore diverge. |

The central architectural defect is mixed ownership: station facts, MES workflow truth, and browser projection are not consistently separated.

Hard invariant: **3D has no authority to lock or control station activity.** It is limited to versioned display and sound/light alarms. Station locks, releases, receipts, routing, approvals, and state changes belong to authenticated station or MES workflows.

Hard invariant: **Every scanner read performs detection, with MES involved; scanner reads never create formal SN records.** The station first runs its immediate local/offline guards, then requests the current MES decision for factory-wide confirmed NG, duplicate history, incomplete handover, identity, and route sequence. MES owns the canonical cross-station decision and interception audit; the station owns the physical block/alarm and execution of the permitted station action. Detection is repeated on every scan and a previous clear decision is never permanent. Scanner observations may be retained only in a separate short-retention audit/interception log and must never enter today-SN, historical-SN, PASS, or production-result registries. Only accepted CSV, Excel, or production equipment/database results may register formal production SN facts. During loss of MES connectivity, local guards remain active and the station must apply its configured fail-safe policy; queued observations are reconciled when connectivity returns without becoming formal SN registrations. An explicitly armed one-shot retest may bypass duplicate handling once, but never confirmed-NG, handover, identity, or route-sequence protection.

Hard invariant: **No stuck data.** Every durable message has a stable event ID, entity key, creation time, attempt count and explicit state. An accepted message must be acknowledged and idempotent. Transient transport/server failures retry with bounded exponential backoff. Permanent schema, authorization, ownership or validation failures must be moved to a visible quarantine/dead-letter state and must not block unrelated entities. Ordering is preserved for the same entity, while independent entities continue. Queue age, oldest pending message, retry count and quarantine count must be observable and alarmed. Nothing may be silently dropped, retried forever without escalation, or left indefinitely in an ambiguous processing state.

Hard invariant: **No mis-piping.** Every dataset has one declared owner, producer, consumer set, direction, schema version and acknowledgement contract. Station production facts flow station → MES; MES decisions and commands flow MES → specifically addressed station; versioned display projections flow MES → 2D/3D; heartbeat/telemetry uses its separate ephemeral channel. 3D never writes production state. MES never rewrites station-owned raw source or local execution facts. A receiver must reject and quarantine messages sent on the wrong channel, from the wrong owner, for the wrong station, or with an incompatible schema. Reconnection resumes from acknowledged checkpoints, compares event IDs/versions/hashes, and never reverses upstream truth or replaces newer accepted history with stale downstream state.

Hard invariant: **Pipeline failures must alarm.** Alarm on MES disconnection, stale station heartbeat, oldest pending event over the configured threshold, retry count over threshold, any permanent quarantine, wrong-owner/wrong-channel rejection, acknowledgement timeout, version/hash reconciliation conflict, and queue growth beyond capacity. The station must show the local warning; MES must supervise and retain the alarm; 3D may display and sound/flash it. Manual acknowledgement silences the presentation only—it never deletes the event, changes delivery state, clears NG, or substitutes for successful reconciliation. Alarm creation, acknowledgement, recurrence and final resolution are audited separately.

## Charter compliance matrix

### Mandatory P0 downstream NG rule

Every active NG published by MES must be checked and blocked at every downstream scan, arrival, tester/database ingest, binding and packaging boundary. The detecting station and all downstream stations must alarm. Offline stations enforce the last complete cached snapshot. Only an authorized retest PASS may publish `RELEASED`; all NG/retest history remains immutable. Any bypass is a P0 containment failure.

Legend: **Pass**, **Partial**, **Fail**, **Not verified**.

| Charter rule | Station/local | MES | 3D | Finding |
|---|---|---|---|---|
| Safety first | Partial | Partial | Partial | Confirmed-NG guards exist, but broad APIs and client-side mutations can bypass the intended safety boundary. |
| Respect history | Partial | Partial | Fail | Durable outboxes and audit tables help; browser reconstruction and snapshot rewrites can replace historical meaning with current state. |
| One fact, one owner | Partial | **Fail** | **Fail** | MES rewrites station bucket copies; 3D keeps and mutates operational state. |
| Downstream consumes acknowledged upstream truth | Partial | Partial | Partial | The intended relay exists in documentation and some handover flows, but route inference and overlapping APIs weaken it. |
| Truth before display | Partial | Partial | **Fail** | 3D can derive boxes from SSE/browser state rather than a single versioned MES projection. |
| Clear data direction | Partial | **Fail** | Fail | Station-to-MES facts, MES-to-station commands, and MES-to-3D projections are mixed in shared snapshot/broadcast paths. |
| Least authority | Partial | **Fail** | **Fail** | Unscoped snapshot reads, generic mutation/delete routes, global broadcasts, and 3D write actions exceed minimum authority. |
| Effective action | Partial | Partial | Partial | Repair, handover, revival, alarms, and buckets exist, but their ownership and receipt semantics are inconsistent. |
| Efficiency / low burden | Partial | Partial | Partial | Heartbeat coalescing exists; global broadcasts, full-snapshot polling, and browser reconstruction add avoidable load. |
| Human judgment and approvals | Partial | Partial | Partial | Repair/scrap/revival workflows contain approval concepts, but enforcement and role authorization require runtime verification. |
| Accountability and traceability | Partial | Partial | Partial | Event IDs, outboxes, WOs, transfers, and audit structures exist; generic direct mutations can bypass them. |
| Resilience and offline continuity | Partial | Partial | Fail | Station outboxes/disaster snapshots are positive; poison events can block queues and 3D browser state is not authoritative or recoverable. |
| Idempotency | Partial | Partial | Not verified | Event IDs exist, but every ingestion and workflow transition has not been proven idempotent end to end. |
| Dependency integrity | Partial | Partial | Fail | Legacy Agents, hardcoded addresses, and UI-order route inference create hidden dependencies. |
| Scoped priority / urgency | Partial | Fail | Partial | Priority fields are present, but no centrally enforced policy was found; many urgent events are still sent to `*`. |
| No silent conflict | Partial | Partial | Fail | Reconciliation/conflict tables exist, but competing snapshots and browser-local state can diverge before investigation. |
| Secure by design | Partial | **Fail** | **Fail** | Hardcoded deployment values, routes intentionally placed before JWT middleware, debug exposure, and browser mutations are production risks. |
| Privacy and dignity | Not verified | Not verified | Not verified | No complete personal-data classification, retention, or redaction review was found in this audit. |
| Quality at source | Partial | Partial | Not applicable | File-stability and parsing helpers exist; scanner/formal-SN boundaries are not uniform. |
| Observable health | Partial | Partial | Partial | Heartbeats, alarms, data-flow gaps, and residence monitoring exist; they share transports and are not consistently authoritative. |
| Simple, controlled recovery | Partial | Partial | Fail | Station replay is present, but rejection quarantine and versioned reconnect rules are incomplete; browser reset is not a production recovery model. |
| Future compatibility | Partial | Partial | Partial | The charter and node map are extensible, but canonical contracts and capability discovery are not yet enforced in code. |

## Critical evidence

### 1. MES crosses the station ownership boundary

- `services/api/server.js:431` defines `commitStationBucket`.
- `services/api/server.js:558-559` rewrites station `pending_ng` and `confirmed_ng` snapshots during revival.
- Other workflows write `pending_ng`, `confirmed_ng`, and `pass` snapshots for source/destination stations (for example lines 578-586, 1727-1750, and 1826-1829).
- `services/api/server.js:1251` exposes a generic bucket-snapshot PUT.

Charter decision: MES may own factory SN, confirmed NG, approvals, work orders, and accepted projections. It must not replace station-owned raw, pending-test, or PASS facts. MES should issue a targeted command; the station applies it locally and acknowledges the resulting event.

### 2. Commands and data are over-broadcast

- `commitStationBucket` broadcasts bucket updates to `to: "*"` at line 440.
- Repair, timeout, scrap, NG, and conflict paths contain many additional `to: "*"` broadcasts.

Charter decision: use separate channels/contracts:

1. station -> MES immutable durable fact;
2. MES -> named station targeted command;
3. MES -> 3D redacted/versioned display projection;
4. heartbeat/telemetry as ephemeral data.

### 3. 3D is acting as an operational client

- `apps/web/src/mes/ManualLineDashboard.tsx:2498-2502` persists pallet/container state in browser localStorage.
- Lines 2528-2614 fetch snapshots and reconstruct local browser state; line 2614 exposes it as `window.debugData`.
- Line 2647 calls the ICT data DELETE endpoint.
- Additional localStorage entries retain confirmed-NG disposition/release state.

Charter decision: 3D is display and alarm only. It must receive a single versioned MES projection. It has no right to lock, block, release, acknowledge, route, migrate, clear, approve, revive, retest, or otherwise control any station activity. Operational buttons belong in authenticated MES/station workflows, not the 3D scene.

### 4. Scanner/formal-record boundary is inconsistent

- `004-手动线/(05)PCBA分板工位/depanel_heartbeat_agent.py:87-96` inserts scanner reads into `all_sns`.
- This conflicts with the declared rule that scanner input performs identity/NG/duplicate checks but does not create a formal SN production record.

Charter decision: only accepted CSV/Excel/database production results register formal SN facts. Scanner observations may be audited separately with short retention.

### 5. Offline replay can be blocked by one bad event

- `004-手动线/station_data_sync.py:107-116` stops `flush()` after the first exception and does not classify permanent rejection versus transient failure.
- ICT contains stronger permanent-rejection handling, but this behavior is not shared consistently by all stations.

Charter decision: ordered events for the same entity must remain ordered, but an invalid event must be quarantined with a visible investigation record instead of silently blocking unrelated entities forever.

### 6. Least-authority and authentication gaps

- `services/api/server.js:2151` defines a generic station-data DELETE.
- The source comment at line 2169 says routes are registered before `/api` JWT middleware to bypass authentication.
- Snapshot GET/PUT routes are broadly scoped rather than consumer/dataset authorized.

Charter decision: destructive and correction operations require authenticated role, reason, event ID, before/after hash, approval level, and immutable audit log.

## Positive foundations to preserve

- Durable station outboxes and event IDs.
- Confirmed-NG and today-SN local guards sourced from MES.
- File-stability checks for CSV/Excel ingestion.
- Heartbeat coalescing and disaster snapshot support.
- Factory SN, confirmed-NG, handover, repair, revival, residence-time, and conflict-management concepts in MES.
- Motherboard identity/layout concepts for ICT, FCT, and depanel.
- Single-instance protection on many formal station Agents.

These should be unified, not replaced.

## Required correction sequence

1. Freeze canonical station codes, route edges, dataset owners, and allowed direction per dataset.
2. Make one canonical event envelope: `eventId`, entity key, owner, source version, occurred time, received time, schema version, causation/correlation ID, payload hash.
3. Separate durable facts, targeted commands, display projections, and ephemeral heartbeat transports.
4. Stop MES writes to station-owned raw/pending/PASS datasets; retain MES read models only.
5. Remove every operational mutation from 3D and eliminate production state from browser localStorage.
6. Replace `to: "*"` workflow commands with target lists; broadcast only confirmed-NG guard deltas and redacted display events that genuinely require factory-wide visibility.
7. Scope and authenticate all snapshot, conflict-resolution, correction, and delete APIs.
8. Standardize outbox retry: exponential backoff, permanent-rejection quarantine, per-entity ordering, independent progress, metrics, and operator recovery.
9. Correct scanner storage so observations never become formal SN registrations.
10. Archive legacy `copy.py`/obsolete entry points, finish single-instance locks, and externalize addresses/secrets.
11. Run acceptance tests for multi-browser equality, 20-minute offline replay, duplicate/confirmed-NG guards, repair/revival, handover timeouts, and source-to-destination quantity balance.

## Production acceptance gates

The system is ready only when all of these pass:

- Two fresh browsers show the same MES version and identical boxes without localStorage production data.
- Disconnecting one station for 20 minutes does not lose, duplicate, reorder, or reverse a committed fact.
- MES cannot mutate station-owned pending/PASS/raw state through any API.
- 3D cannot clear, route, revive, approve, or migrate production data.
- 3D cannot lock, block, pause, release, or acknowledge any station activity, and station operation is unaffected when every 3D client is offline.
- A permanent bad event is quarantined and does not block unrelated replay.
- Every command is addressed, authorized, acknowledged, timed out, and audited.
- Every formal SN registration originates from an accepted production data source, not a scanner observation.
- Confirmed NG remains factory-wide blocked until an approved repair/revival and destination receipt complete.
