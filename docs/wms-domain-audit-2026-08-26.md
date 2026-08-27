# WMS domain audit (read-only)

Scope: canonical inventory ledger, reservations, issue/return flows, loading paths, and duplicate/quantity protections.

## Source map

- `services/api/server.js`: authoritative HTTP handlers and SQL mutations. The generic ledger endpoint/command is around lines 18870-19200; reservation, pick, issue, acknowledgement, reconciliation, and return handlers are around lines 19218-19506.
- `services/api/server.js`: `/api/smt/loading/pda-load` (around 7650-7730) is the stronger WMS-aware loading path: transaction idempotency by `reference_type='SMT_PDA_LOAD', reference_no=idempotencyKey`, source/location/IQC/expiry/quantity checks, slot and roll duplicate checks, and an `ISSUE_TO_LINE` ledger row.
- `services/api/server.js`: `/api/smt/loading/bind` (around 7725-7975) is a second loading path. It validates session/BOM/quality gates and writes `feeder_binding_events` plus audit, but does not write `inventory_transactions` or decrement `material_lots`.
- `packages/business-rules/src/inventory.ts` and `packages/business-rules/src/inventoryService.ts`: typed action validation exists, but the service is explicitly mock-only with empty in-memory lots/locations and no persistence/state transition.
- `tests/wms-m5-live.test.ts`, `tests/wms-m4-live.test.ts`, `tests/wms-closed-loop-live.test.ts`, `tests/wms-inventory.test.ts`, and `tests/smt-pda-material-loading.test.ts`: intended reservation lifecycle, ledger, closed-loop, and loading acceptance coverage.

## Findings / gaps

1. **Two competing loading authorities (high).** `pda-load` is ledger-coupled, while `/api/smt/loading/bind` can create an active binding without inventory issue/quantity deduction. A caller can therefore make MES appear loaded while canonical WMS stock remains unchanged; route ownership should be unified or `/bind` must call one atomic WMS command.

2. **Binding duplicate policy is inconsistent (high).** `pda-load` blocks an already-loaded roll for the work order (`DUPLICATE_MATERIAL`) and rejects occupied slots unless it is the same binding. `/bind` only finds an occupied slot, marks it `replaced`, and does not check the same material roll elsewhere in the work order. It can also accept an unknown lot by synthesizing an `UNVERIFIED` pending object, with `testBypassAllChecks`/`deferWoApproval` paths that intentionally override failed gates; these need explicit authorization and audit controls in production.

3. **Reservation duplicate/idempotency is application-incomplete (medium/high).** `POST /wms/reservations` locks the lot and checks available quantity, but has no pre-check or visible idempotency key for a repeated same lot/work-order request; the insert has no `ON CONFLICT` handling in the handler. The M5 test expects a duplicate reservation to return 409, so this contract depends on an unseen database constraint or currently fails under a schema without that unique active-reservation constraint.

4. **Generic `/wms/transactions` bypasses lifecycle workflows (high).** It accepts `RESERVE`, `PICK`, `ISSUE_TO_LINE`, and `RETURN_FROM_LINE` as arbitrary ledger commands, while the dedicated endpoints require reservation/pick/approval semantics. Its updates are not wrapped in one transaction, and `ISSUE_TO_LINE` increments `reserved_qty` rather than consuming stock; concurrent requests can insert the ledger row and fail to update the lot, or expose inconsistent balances.

5. **Return is only a submission, not inventory restoration (medium/high).** `/wms/return-from-line` validates outstanding issued quantity and creates a pending closure case; it does not append `RETURN_FROM_LINE` or restore stock until a separate closure approval flow. This is defensible as a controlled workflow, but callers and stock dashboards must not treat HTTP 201 as returned/available inventory, and a replay/idempotency key is absent.

6. **Quantity protections are uneven (medium).** Dedicated reservation/issue/return paths use row locks and positive/exact checks, but generic `SCRAP` only checks the action's IQC status and can subtract quantity without an explicit `qty <= available` check; `RETURN_FROM_LINE` in the generic command only clamps `reserved_qty` rather than checking issued balance. The `/bind` path derives quantity from `p.qty`, roll quantity, BOM requirement, or lot quantity and has no ledger-side deduction.

7. **Ledger identity is weak (medium).** Transaction numbers are generated from `Date.now()` (with a random suffix only in the PDA load path), and most generic/dedicated mutations have no client idempotency key. Duplicate prevention is therefore query/application-based rather than backed by clear unique constraints on business references (`LOT_RESERVATION`, PDA load event, return case).

8. **Business-rule package is not an executable guard (medium).** `executeInventoryTransaction` is a mock with empty arrays and returns success for most actions; production safety resides in the monolithic `server.js` handlers, so unit tests of the package do not prove database invariants.

## Positive controls observed

- Dedicated reservation/pick/issue uses PostgreSQL transactions and `FOR UPDATE` locks; issue requires a fulfilled reservation with exact quantity and checks duplicate issue by reservation reference.
- Dedicated issue validates released IQC, open/running work order, frozen BOM membership, and effective expiry; reservation validates available quantity as `received_qty - reserved_qty`.
- `pda-load` has an idempotency lookup, source-location match, active-location checks, IQC/lifecycle/expiry checks, quantity ceiling, occupied-slot protection, and duplicate-roll protection.
- Closed-loop reconciliation derives issued, returned, consumed, and approved-difference quantities from the ledger and exposes a balance flag.

## Recommended acceptance gates

Make one loading command canonical and atomic across binding, ledger, lot quantity, and audit; add database-enforced unique/idempotency keys for reservation, issue, return, and loading references; remove or tightly permission/audit all bypass/deferred paths; route every inventory action through a transaction that validates signed quantity deltas and current stock; and add concurrent replay tests proving no duplicate ledger rows or negative/over-committed quantity.
