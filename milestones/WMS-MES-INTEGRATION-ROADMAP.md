# WMS–MES Integration Roadmap

Owner: Factory digitalization team  
Baseline date: 2026-07-22  
Scope: MES, WMS, IQC, station agents, PostgreSQL, management UI and 3D monitoring

## Status legend

- `[x]` Completed and verified
- `[~]` Implemented but still requires integration acceptance
- `[ ]` Not started or incomplete
- **Gate**: mandatory acceptance condition before moving to the next milestone

## Milestone progress snapshot — 2026-07-22

| Milestone | Status | Gate | Current position |
|---|---|---|---|
| M0 Canonical contract | Complete | PASS | Ownership, naming, routing and data-direction rules published |
| M1 Database integrity | In progress | NOT READY | Clean migration passed; upgrade checksums and recovery runbooks remain |
| M2 Work-order governance | In progress | NOT READY | Number allocation is protected; WO relationships and QR/carton/pallet validation remain |
| M3 WMS master data | In progress | NOT READY | Core APIs complete; general version/approval UI and approved import remain |
| M4 Inbound and IQC | Gate passed | READY | Approved inbound-order linkage and exact quantity reconciliation enforced; live PASS/HOLD/REJECT acceptance passes |
| M5 Outbound/consumption | Gate passed | READY | Controlled reserve/pick/issue/acknowledge/consume/return flow and exact reconciliation pass live acceptance |
| M6 Material lifetime | Core complete | PASS | Expiry classification, isolation, blocking and controlled reinspection are live-tested; physical disposal/UI remain |
| M7 SN stagnation/scrap | Complete | PASS | Canonical station timeline, dwell alarms, actions and permanent history pass live acceptance |
| M8 Resilient synchronization | Core complete | PASS | Idempotency, replay, quarantine, retry, acknowledgement and health UI are implemented; timed outage drill remains |
| M9 Unified trilingual UI | In progress | NOT READY | Canonical WMS menu and synchronization center are complete; remaining screens require translation/state audit |
| M10 Verification/cleanup | Engineering complete | SITE SIGN-OFF REQUIRED | 215 tests pass with all live M4–M10 switches; backup/restore and audited cleanup pass; two physical checks remain |
| M11 Pilot/deployment | Pending | NOT READY | Blocked until local acceptance gates pass |

## Non-negotiable rules

1. PostgreSQL is the central system of record.
2. MES owns work orders, routing, SN history and production status.
3. WMS owns materials, lots, locations and inventory movements.
4. IQC owns inspection, release, rejection and reinspection decisions.
5. Stations may retain an offline queue but may not overwrite authoritative history.
6. The 3D line may display and alarm but may not lock or mutate production.
7. Production never falls back to mock inventory, mock SNs or synthetic station events.
8. Every cross-system handover is idempotent, acknowledged and auditable.
9. No EXE packaging or remote deployment before local end-to-end acceptance.

---

## M0 — Requirements and canonical contract

Outcome: one unambiguous source of truth for names, ownership, states and data direction.

- [x] Read WMS menu specification.
- [x] Read MES station and WMS requirements.
- [x] Read product stagnation and product scrap workbook.
- [x] Read warehouse component-lifetime workbook.
- [x] Read formal work-order numbering document.
- [x] Publish canonical station/line code and alias register (`docs/20-canonical-operating-contract.md`).
- [x] Publish station sequence for manual and automatic lines.
- [x] Publish data ownership and direction matrix.
- [x] Publish role/permission matrix.
- [x] Publish state-transition diagrams for WO, inventory, IQC, expiry and scrap.
- [x] Freeze API/event naming and envelope rules.
- [x] Create requirements-to-test traceability matrix.

Gate:

- Every important entity has exactly one owner.
- Every state transition names its authorized role and API.
- Manual and automatic lines cannot collide in station identity.

## M1 — Database and migration integrity

Outcome: repeatable database creation without fake data or destructive surprises.

- [x] Add durable MES↔WMS exchange and reconciliation tables (`138`).
- [x] Add complete WMS domain schema (`139`).
- [x] Add product stagnation and scrap custody schema (`140`).
- [x] Add component-lifetime controls (`141`).
- [x] Add formal work-order allocation and audit schema (`142`).
- [x] Retire old dispatch demo-inventory migration.
- [x] Audit every pending migration from `076` through `137` (`docs/21-migration-audit-076-137.md`).
- [x] Separate schema migrations from seed/demo scripts (retired `081`; optional seed `085_admin_vn_01_demo_seed.sql`).
- [x] Run all migrations against an isolated clean database (`smt_factory_migration_test`, 124/124).
- [ ] Compare row counts and checksums before/after migration.
- [~] Verify all foreign keys, unique constraints and indexes (0 unvalidated constraints; index workload review remains).
- [ ] Establish backup, restore and rollback runbooks.

Gate:

- Fresh and upgrade migrations both pass.
- No production row is silently deleted or rewritten.
- No migration inserts mock inventory, SNs or station results.

## M2 — Work-order governance

Outcome: authoritative, unique and traceable production work orders.

- [x] Enforce 11-digit numeric format.
- [x] Implement `YYMM + type + line + sequence` allocation.
- [x] Make allocation and WO insertion transactional.
- [x] Preserve voided numbers with reason and audit history.
- [x] Restrict WO creation/change to `pmc.edit`.
- [x] Add PO-line field and cross-process relationship table.
- [x] Require PO for mass-production type 1.
- [x] Require product, BOM revision, quantity, line and due date.
- [ ] Add UI for related upstream/downstream work orders.
- [ ] Link replenishment documents to the original WO only.
- [ ] Validate QR, carton and pallet against active WO.
- [ ] Add monthly sequence and voided-number management report.
- [x] Test 100 concurrent allocation requests (100 requests, 100 unique codes; isolated test rows cleaned).

Gate:

- No duplicate, reused or malformed number is possible.
- Failed transactions do not consume numbers.
- Voided numbers remain permanently searchable.

## M3 — WMS master data

Outcome: controlled warehouse data required by all transactions.

- [x] Create warehouse, zone and location hierarchy.
- [x] Create material category and unit structures.
- [x] Create supplier-material qualification mapping.
- [x] Create labels, containers, cartons and pallets.
- [x] Create material-lifetime policy table.
- [x] Build warehouse/zone/location maintenance APIs.
- [x] Build material/category/unit maintenance APIs.
- [x] Build supplier-material approval APIs.
- [x] Add capacity, environmental and locked-location checks.
- [ ] Add master-data version and approval UI.
- [ ] Import approved master data only after validation report.

Gate:

- Invalid or inactive master data cannot be used by transactions.
- Every changed rule has approver, timestamp and history.

## M4 — Inbound and IQC vertical slice

Outcome: supplier receipt reaches available stock through a controlled quality flow.

- [x] Supplier ASN/inbound-order receipt linkage (approved order and matching supplier/material/remaining quantity required).
- [x] Receiving scan and quantity verification (supplier qualification, duplicate lot and positive quantity enforced; transactional receipt).
- [x] Lot and label generation (`MATERIAL_LOT` label created atomically with receipt).
- [x] IQC queue creation (database-backed and exercised by live acceptance).
- [x] Inspection plan and characteristic capture (approved active plans only; results persist atomically).
- [x] Release, hold and reject decisions (live negative acceptance proves HOLD/REJECT cannot be put away).
- [x] Put-away task and location confirmation (active/unlocked/capacity and RAW_MATERIAL domain validation exercised).
- [~] Supplier return workflow (API/UI present; acceptance pending).
- [~] Receiving discrepancy and photo evidence (API/UI present; acceptance pending).
- [~] Complete trilingual screens (canonical receiving screen completed; broader WMS cleanup continues in M9).
- [x] End-to-end inbound acceptance test (`tests/wms-m4-live.test.ts`; test records automatically removed).

Gate:

- One test lot completes receipt→IQC→put-away.
- Ledger balance, lot quantity and location agree exactly.
- Rejected/held lots cannot become available stock.

Gate result: **PASS** (`tests/wms-m4-live.test.ts`, 2026-07-22).

## M5 — Outbound and production consumption

Outcome: material demand is issued and reconciled against the correct work order.

- [x] WO material demand/requisition (frozen work-order BOM requirements are canonical demand).
- [x] FIFO/FEFO lot recommendation (effective opened/sealed expiry first, receipt time second; expired lots excluded).
- [x] Controlled exception approval (reason/detail required; explicit one-time decision recorded).
- [x] Reservation and pick confirmation (same-WO/BOM/IQC/quantity validation and duplicate prevention).
- [x] Issue to line with receiver acknowledgement (exact fulfilled reservation required; duplicate issue/acknowledgement blocked).
- [ ] Station consumption by lot and SN.
- [x] Return from line (same-WO issued balance enforced atomically; excess return blocked).
- [x] Replenishment linked to original WO and approved original requisition/material.
- [~] Shortage and unexplained-difference alarms (live shortage/unacknowledged detection complete; scheduled escalation continues in M8).
- [x] WO material reconciliation page (single trilingual shortages, replenishment and reconciliation screen).

Gate:

- Issued = consumed + returned + approved scrap + explained difference.
- Expired, held, rejected or wrong-WO material is blocked.

Core flow acceptance: **PASS** (`tests/wms-m5-live.test.ts`, 2026-07-22). The test proves
reserve → pick → issue → acknowledge → consume/return quantity conservation and duplicate blocking.

Gate result: **PASS**. Wrong-WO, expired, held and rejected material are blocked, and the material equation is enforced.

## M6 — Material lifetime and disposal

Outcome: sealed/opened shelf life is enforced through final disposition.

- [x] Create sealed/opened lifetime views.
- [x] Configure default 60-day and 30-day warnings.
- [x] Create reinspection extension fields.
- [x] Create isolation and scrap approval history.
- [x] Calculate expiry during receiving from approved policy.
- [x] Run scheduled near-expiry classification.
- [x] Automatically isolate expired lots.
- [x] Block expired lots from reservation, pick and issue APIs.
- [x] Complete IQC reinspection workflow.
- [x] Extend expiry only after approved passing result.
- [ ] Complete physical custody and authorized disposal workflow.
- [ ] Build lifetime, warning, opening and scrap screens.

Gate:

- Expired material cannot leave isolation through normal APIs.
- Every expiry extension points to an approved test report.

Core gate result: **PASS** (`tests/wms-m6-live.test.ts`, 2026-07-22). Expired stock is automatically isolated and blocked from normal movement; failed or unapproved reinspection cannot extend expiry.

## M7 — Product/SN stagnation and scrap

Outcome: every product has an uninterrupted station timeline and controlled disposition.

- [x] Add stagnation warehouse location and PO fields.
- [x] Add stagnation action history.
- [x] Add product-scrap approval and custody tables.
- [x] Remove duplicate `/mes/stagnation` route registration (one app-level handler remains per operation).
- [x] Record arrival/departure consistently from the canonical station-event pipeline.
- [x] Calculate dwell and overdue levels on schedule.
- [x] Generate residence, handover and missing-next-receipt escalation alarms.
- [x] Build move, hold, retest, release and scrap actions.
- [x] Require physical custody before final product disposal.
- [x] Build stagnation, traceability and scrap management screens.

Gate:

- Every tested SN has a complete ordered station timeline.
- Resolved events remain in permanent history.

Gate result: **PASS** (`tests/mes-m7-live.test.ts`, 2026-07-22). The acceptance test proves destination-first persistence, upstream close-out, next-residence linkage and live residence visibility.

## M8 — MES↔WMS resilient synchronization

Outcome: disconnection and replay do not lose or duplicate facts.

- [x] Create idempotent exchange-event table.
- [x] Create acknowledgement API foundation.
- [x] Create offline-operation queue schema.
- [x] Create reconciliation-run schema.
- [x] Define event catalog and producer/consumer ownership.
- [x] Implement producer outbox and transactional consumer claim API.
- [x] Add retry, exponential backoff and quarantine processing.
- [x] Add acknowledgement timeout alarms.
- [x] Implement reconnect replay from last acknowledged event.
- [x] Implement conflict comparison and approval workflow.
- [x] Build synchronization health and backlog screen.
- [ ] Run 20-minute offline recovery test.

Gate:

- No loss and no duplicates after controlled network interruption.
- Conflicting records are quarantined, never silently overwritten.

Core gate result: **PASS** (`tests/mes-wms-m8-live.test.ts`, 2026-07-22). Idempotent replay, conflicting replay quarantine, manual conflict decision, retry and acknowledged replay all pass. The management synchronization center is connected to authoritative APIs. The timed 20-minute outage drill remains before full milestone closure.

## M9 — Unified trilingual management UI

Outcome: operators and managers use authoritative data through consistent screens.

- [x] Organize WMS navigation into canonical groups.
- [x] Connect previously unreachable WMS screens.
- [x] Remove runtime fallback from core WMS inventory APIs.
- [x] Resolve authenticated browser WMS data-loading failure (canonical MES API `192.168.6.155:8080`; no browser loopback dependency).
- [ ] Remove remaining mock arrays and demo labels.
- [ ] Add missing management pages from M3–M8.
- [ ] Make all UI text Chinese/English/Vietnamese.
- [ ] Add loading, empty, error and offline states.
- [ ] Add pagination for large history tables.
- [ ] Confirm 3D is read-only monitoring.

Gate:

- Every number on screen comes from an authoritative API.
- The same user sees the same state in different browsers.

## M10 — Verification and cleanup

Outcome: evidence that the complete system works under normal and failure conditions.

- [x] Unit tests for numbering, lifetime and status transitions.
- [x] API contract tests.
- [x] Database constraint and transaction tests (clean install, 100-number concurrency and live transactional flows pass).
- [x] Permission-negative tests (sync-conflict governance live acceptance complete; expand per module as roles are commissioned).
- [~] Scanner validation tests (API guard and read-only agent contract pass; physical USB scanner acceptance remains).
- [x] Full inbound/outbound lifecycle test (M4–M8 live suite passes together).
- [~] Offline/reconnect/replay test (accelerated 20-minute persistence/retry/replay drill implemented; physical network drill remains).
- [x] Load and backlog test (120 isolated events, exact drain and zero residue).
- [x] Backup/restore test (725 tables, 140 migrations and key row counts match in isolated restore).
- [~] Browser tests for three languages (canonical translation contract passes; physical visual acceptance remains).
- [x] Produce acceptance report and defect list (`milestones/M10-ACCEPTANCE-REPORT-2026-07-22.md`).
- [x] Remove test records with audited cleanup script (`scripts/m10-cleanup-test-data.mjs`; zero residue and permanent audit row).

Gate:

- All critical tests pass.
- No unresolved severity-1 or severity-2 defect.
- Test-data cleanup is verified.

Engineering gate result: **PASS** (215/215 executed tests; 2 hardware/browser-site tests intentionally skipped). Production sign-off remains blocked until the physical checklist is signed and the maintained Excel parser replacement is approved.

## M11 — Pilot, packaging and deployment

Outcome: controlled production release with recovery capability.

- [ ] Select one pilot line and station set.
- [ ] Freeze release version and checksums.
- [ ] Prepare operator SOP and quick-reference guide.
- [ ] Prepare installation, upgrade and rollback packages.
- [ ] Verify firewall, time sync and database connectivity.
- [ ] Run pilot shift with monitoring.
- [ ] Review pilot defects and approve release.
- [ ] Build final station EXEs only after approval.
- [ ] Deploy in controlled waves.
- [ ] Conduct post-deployment reconciliation.

Gate:

- Pilot acceptance signed.
- Rollback has been rehearsed.
- Central and local counts reconcile after deployment.

---

## Immediate execution queue

These tasks are next, in order:

1. [x] Finish canonical station, line and ownership registries.
2. [x] Audit all pending migrations and remove schema/demo coupling.
3. [x] Fix authenticated WMS browser data loading.
4. [x] Remove duplicate stagnation API route.
5. [x] Finish work-order required-field and concurrency tests.
6. [x] Implement WMS master-data APIs.
7. [x] Deliver the inbound receiving→IQC→put-away vertical slice.
8. [x] Run its live PostgreSQL acceptance tests before starting outbound flow.
9. [x] Deliver and live-test controlled outbound/consumption flow.
10. [x] Deliver and live-test lifetime enforcement and SN station timeline.
11. [x] Deliver resilient MES↔WMS exchange core and synchronization health UI.
12. [ ] Run the controlled 20-minute network-outage recovery drill.
13. [ ] Complete role-negative, scanner, browser-language and backup/restore acceptance.

## Progress reporting template

For every completed task, record:

- Milestone and task
- Files and migrations changed
- Database objects affected
- API/UI behavior delivered
- Tests executed and results
- Test data created and cleanup status
- Known risks or deferred work
- Gate status: PASS / FAIL / NOT READY
