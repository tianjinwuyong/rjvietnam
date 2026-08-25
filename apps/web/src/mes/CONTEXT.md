# MES Production Execution

This context controls how a released Work Order becomes traceable finished product. It is the sole authority for production route state, product execution state, and manufacturing exception closure.

## Language

**Product**:
The MES aggregate root representing one physical product through registration, execution, binding, quality disposition, packaging, and closure. A Product may have multiple identifiers but has one manufacturing lifecycle.
_Avoid_: SN object, scan row, station record

**Product Identifier**:
A typed, time-valid identifier attached to a Product, such as `PCBA_SN` or `SHELL_SN`. Scanning any active identifier resolves the same Product.
_Avoid_: Product, untyped SN field

**Product Attendance**:
The Product-owned record of its authorized route position and station-entry decisions. It begins at first-station registration, follows required stations and dependent NG sequences, then leaves the active queue after final packaging while its history remains immutable.
_Avoid_: Agent attendance, pre-report list, local route cache

**Product Gate**:
The single MES decision point that resolves a scanned Product Identifier and returns `ALLOW`, `HOLD`, `REJECT`, `REPAIR_ROUTE`, or `COMPLETED` for a Station.
_Avoid_: Agent-side route logic, arrival popup

**Binding Relationship**:
A versioned, auditable relationship between Products, identifiers, materials, cases, pallets, or locations. Product decides whether a binding is permitted; the binding relationship preserves what was bound, when, why, and by whom.
_Avoid_: Overwritten foreign key, deleted binding row

**Dependent Sequence**:
An ordered NG, repair, retest, missing-station, scrap, or destruction sequence that pauses the Product's main route until it reaches an authorized terminal outcome.
_Avoid_: Jump station, clear NG

**Production Run**:
The execution of one released Work Order on one assigned production line and route revision.
_Avoid_: Line task, schedule row

**Product Identity**:
The canonical identity of a motherboard, daughter board, assembled unit, carton, or pallet whose relationships are permanently traceable.
_Avoid_: Scan value, temporary SN

**Station Fact**:
An immutable observation reported by a Station Agent, such as a scan, measurement, test result, binding, receipt, or completion.
_Avoid_: MES decision, current status

**MES Decision**:
The authoritative result of validating a Station Fact against the active Work Order, route, quality hold, duplicate guard, and exception rules.
_Avoid_: Agent result, UI status

**Route Gate**:
The MES-owned condition that permits or blocks a Product Identity from entering the next Station.
_Avoid_: Frontend validation, scanner warning

**Station Route Configuration**:
The versioned, approved, and published MES definition of line domains, ordered Stations, PASS transitions, NG policies, repair return points, final-inspection release, and deviation alarms. The canonical source is `packages/station-config/stations.json`; Station Agents consume a published revision and never redefine it locally.
_Avoid_: Agent route table, station-specific hard-coded next step

**Route Deviation**:
An attempted Product transition that is absent from the Product's active published Station Route Configuration. MES blocks it, raises one actionable alarm, records the attempted and expected Stations, and requires authorized disposition.
_Avoid_: Silent station jump, operator warning only

**Final Inspection Release**:
The terminal MES/QMS decision after packaging and OQC evidence. PASS authorizes finished-goods handoff to WMS; NG creates a quality hold and dependent disposition route. Packaging completion alone never grants warehouse release.
_Avoid_: Packaging PASS, shipment approval

**Confirmed NG**:
A permanent quality exception accepted by MES after detection and confirmation. Later repair or PASS does not delete the original NG.
_Avoid_: Current FAIL, temporary alarm

**Repair Case**:
The single closed-loop record joining a Confirmed NG, physical transfer, repair receipt, repair action, return receipt, retest, SLA, and closure.
_Avoid_: Maintenance note, revival row

**Station Repair Policy**:
The MES-owned, versioned rule that determines whether a Station may initiate a Repair Case, its action mode, accountable roles, physical instruction, repair destination, return permission, and SLA. A Station Agent executes this policy but cannot redefine it locally.
_Avoid_: Agent button setting, hard-coded station exception

**Repair Return**:
The controlled physical and system handover of a repaired Product Identity to its authorized return Station.
_Avoid_: NG deletion, direct PASS

**Revival**:
The authorized transition that removes the active NG block after repair while retaining all NG and repair history.
_Avoid_: Clear NG, delete failure

**Retest Authorization**:
The MES decision that permits a specific Product Identity to execute another test attempt at a specific Station.
_Avoid_: Test retry button, unconditional rescan

**Execution Event Ledger**:
The append-only history of Station Facts, MES Decisions, commands, acknowledgements, and state transitions.
_Avoid_: Current-state table, application log

**Read Projection**:
A derived view for dashboards, search, reports, alarms, and 3D scenes. It never owns or changes production truth.
_Avoid_: Master record, editable dashboard data

**Station Agent**:
The edge adapter that captures local device facts, buffers them offline, submits them idempotently, and executes acknowledged MES commands.
_Avoid_: Independent MES, business-rule owner

**SLA Clock**:
An MES-owned timer attached to a business transition, with explicit start, pause, acknowledgement, breach, resolution, and audit timestamps.
_Avoid_: Page countdown, browser timer

**Operational Definition**:
The approved meaning, rationale, source, formula or rule, scope, owner, version, and effective period behind an MES metric, state, limit, SLA, or decision.
_Avoid_: Screen label, undocumented convention

**Evidence Chain**:
The traceable references from a displayed value or MES Decision back to its Operational Definition and immutable source records.
_Avoid_: Tooltip only, application log

**Closed Loop**:
An operational path with a defined trigger, accountable owner, required action, verification, closure rule, SLA or escalation where applicable, immutable audit, and review measure.
_Avoid_: Page delivered, record created, alarm displayed

**MES Process**:
A named, versioned production-execution lifecycle inside one explicit line domain. It declares the Station Facts it accepts, its accountable owner, required decisions, closure condition, and downstream WMS/QMS handoffs. Facts are never routed between manual-line, SMT, and auto-line processes by UI name or payload similarity.
_Avoid_: Page, endpoint, generic event bucket

**Material Usage Fact**:
An immutable report that a defined quantity of a material was used by a Product or Work Order at a Station. MES owns production attribution; WMS remains the authority for inventory balance and reconciles the reported usage.
_Avoid_: Inventory deduction, feeder binding, loading confirmation

**MES Process Supervisor**:
The read-only supervisory capability that checks every MES Process for contract compliance, sequence health, SLA, required handoffs, and evidence-backed closure. It opens actionable issues for accountable owners but never edits Product, process, quality, or inventory truth automatically.
_Avoid_: MES process owner, automatic data repair, dashboard-only alarm

## Manual-line NG repair domain

**Manual-line MES Domain**:
The explicit MES process domain for the manual production line. It owns only manual-line Product execution, Station Facts, NG repair, repair return, retest, authorization, and closure. Its routes and policies are not interchangeable with SMT, auto-line, warehouse, or other MES process domains; cross-domain movement requires an explicit MES handoff.
_Avoid_: Shared global route, UI tab as domain, implicit cross-line transfer

**Manual-line NG Repair Process**:
The MES-owned process for a Confirmed NG detected in the manual-line domain. It starts at MES confirmation, controls the repair handover and receipt, records repair evidence and material usage, authorizes retest, and ends only at an approved return, special release, or scrap disposition.
_Avoid_: Agent repair loop, local NG queue, cleared alarm

**Repair Route Publication**:
The versioned MES decision that names the repair destination, accountable roles, permitted retest stations, maximum retest count, SLA, and terminal outcomes for a manual-line NG. Agents may consume the published decision but cannot edit or replace it.
_Avoid_: Cached route override, operator-selected destination

**Repair Handover**:
The auditable MES-to-repair-station transfer containing the Product Identity, source Station, Confirmed NG, work order, route version, evidence references, and accountable sender/receiver.
_Avoid_: Physical delivery without receipt, informal repair request

**Repair Closure Decision**:
The MES-authorized decision after repair evidence and retest results that returns the Product to a named Station, repeats an allowed route, places it on quality hold, authorizes scrap, or grants an approved special release. Closure never removes the original Confirmed NG or its evidence chain.
_Avoid_: Repair complete button, automatic PASS

**Manual-line Repair Domain Invariants**:
MES is the sole authority for manual-line NG state, routing, retest authorization, roles, SLA, and final disposition. Station Agents capture facts, display the active published policy, execute acknowledged commands, and append offline evidence; they cannot change route, increase retest limits, erase history, scrap, or release product. Every transition requires an event identity, source and destination Stations, actor, policy version, timestamp, and immutable audit evidence.
