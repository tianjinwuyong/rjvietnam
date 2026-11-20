# Mission

**Derived from:** `AGENT.md`, `CONTEXT-MAP.md`, `FACTORY.md`, `app_rules/architecture.md`
**Last reconciled with it:** 2026-11-20

## What Ruijing Vietnam SMT Factory System is

One integrated management platform for the RuiJing electronics factory in Vietnam. It
runs the whole operating flow of an SMT plant — customer demand, purchase and receipt
of material, incoming inspection, warehouse and shelf movement, work-order release,
station-level production execution, quality disposition, traceability, and reporting —
on shared master data, one permission model, and one traceability chain.

The users are bilingual factory staff, not office knowledge workers: operators scan
barcodes at a station, warehouse staff receive and shelve pallets, IQC inspectors pass
or reject lots, line leaders watch a 3D line view, PMC releases work orders, and
managers read dashboards. Chinese and Vietnamese are both first languages on this site;
English is the fallback. Screens must stay dense and fast rather than decorative.

The design assumes **one factory, one deployment, one tenant**. It is an execution and
traceability system that mirrors ERP financials — it is not the accounting book of
record, and it does not model multiple customers sharing an instance.

## Who it is for

- **Warehouse / receiving operator** — scan a pallet, bind QR codes to a lot, move stock
  to a shelf cell, and have the balance be right afterwards.
- **IQC inspector** — receive the lot the PDA handed over, record PASS/FAIL, and have a
  FAIL open a defect loop that blocks the material from production.
- **Station operator** — pass a board through a station, record SN/NG, and have the
  result appear in traceability without a second data-entry step.
- **Line leader / PMC planner** — see the line state and released work orders, and know
  which station is blocking the flow.
- **Manager** — read production, quality and material reports that agree with the
  transaction history.

This is **not** a generic SaaS WMS/MES product, not an ERP replacement, and not a
marketing-facing portal. The supplier portal is a narrow, single-purpose window for
suppliers to acknowledge POs and print labels — it is not a second product surface.

## Core capabilities (in scope)

**WMS — receiving to issue**
- PO queue, receiving scan, QR binding per lot, MSL resolution on inbound
- IQC handover and result capture, including the FAIL path into the defect loop
- Put-away / shelf-in / shelf-out, rack cell tracking, fetch-package handover
- Requisition, picking, replenishment, cycle count, MRB and supplier returns
- Inventory balances derived from `inventory_transactions` — never stored as a free-standing number

**Smart shelf and PDA**
- Scanner terminal, QC PDA, employee PDA, dashboard PDA over the same API
- Shelf rack status, cell indicator, material-lot lookup
- Device pool registry for receiving and IQC PDAs

**MES — production execution**
- Work-order release handoff from PMC, station sequencing, station pass/fail
- Manual-line and auto-line execution, NG guard, rework / re-inspect
- SN binding and decode, station snapshots, 3D line views
- Immutable product facts emitted to traceability

**QMS**
- IQC, OQC, AQL sampling, defect catalogues, MRB disposition
- Quality authority over disposition — MES reports facts, QMS decides

**PMC, equipment and support modules**
- Work-order release, route assignment, dwell rules
- Equipment master, OEE and monthly equipment reporting, MES ingest
- HR attendance/payroll support data, finance and e-invoice, OA integration outbox
- Supplier portal (PO acknowledgement, ASN, label printing), debt and returns

**Cross-cutting**
- JWT auth with role/permission checks at the API boundary (`requirePermission`)
- Trilingual master data (`name_zh` / `name_en` / `name_vi`) and UI
- Audit history on every operational table; document sequences for WMS documents

## Out of scope -- the factory must never build this

**Accounting and financial system of record**
- General-ledger, tax filing, or statutory reporting logic beyond mirroring ERP rows
- Recomputing payroll net pay as the authoritative figure outside the HR module's rules

**Multi-tenancy and topology changes**
- Per-customer tenant isolation, per-plant schemas, or sharding
- A second deployment shape for the same product (cloud/SaaS mode)

**Data destruction**
- Hard deletes of operational, audit or traceability rows
- Schema rewrites or migration squashing that drop history
- Retroactively editing production or quality facts

**Bypassing the quality or signature gates**
- Letting material move to production while IQC is PENDING or FAIL
- Auto-approving an MRB/AQL disposition without the recorded human authority
- Turning `MES_SIGNATURE_ENFORCEMENT` off to make a workflow easier
- Treating a missing scan as a pass

**Direct state mutation outside the transaction model**
- Updating an inventory balance column directly instead of writing a transaction
- Writing device or AGV commands outside the audited adapter path
- Unauthenticated or unclassified endpoints, including "temporary" test bypasses in production

**Product surface expansion**
- Rewriting the PDA apps as native mobile applications
- Customer-facing e-commerce, marketing site or public API for third parties
- Real-time collaboration, chat, or notification features unrelated to production events

## Hard invariants -- not tunable by any issue

1. **Inventory is derived, never assigned.** Every quantity change is an
   `inventory_transactions` row; a balance table that disagrees is a bug, not a feature.
2. **No hard deletes.** Operational records are voided, cancelled or closed, and the
   history stays readable.
3. **Master data is trilingual.** New master tables carry `name_zh`, `name_en` and
   `name_vi`; a UI component renders exactly one active locale.
4. **Traceability facts are immutable.** A SN's station history can gain rows, never lose
   or rewrite them.
5. **Permission checks live at the API boundary.** A UI that hides a button is not a
   control; `requirePermission` on the route is.
6. **The start-up contract is real.** The API refuses to boot without a non-placeholder
   `JWT_SECRET`; do not weaken that to make a local run easier.
7. **Migrations are append-only** (`database/migrations/NNN_name.sql`, tracked in
   `_migrations`). Schema changes arrive as new files, even when the API also applies
   runtime DDL for its own tables.
8. **The factory cannot modify governance files.** `MISSION.md`, `FACTORY_RULES.md`,
   `AGENTS.md` and `AGENT.md` are the constitution. A PR touching any of them is an
   automatic reject.
9. **The factory cannot modify its own judge.** `harness/`, `.factory/locks/` and
   `.factory/holdout/` define what "working" means. Adding an assertion is welcome;
   removing or loosening one is a human decision, always.

## Allowed evolutions

- Extracting route groups out of `services/api/server.js` into `src/*.js` factories that
  take `{ authenticateJWT, requirePermission }`, provided the mounting order before
  `app.use("/api", api)` is preserved and asserted.
- Adding indexes, views and read-model tables for reporting, as new migrations.
- Adding tests, assertions, fixtures and factories anywhere under `tests/`.
- Tightening a permission check, an input validation path, or an audit record.
- Fixing a `?`-placeholder query to `$n`, or a `datetime('now')` to `CURRENT_TIMESTAMP`,
  wherever the compatibility shim still carries them.

## Definition of done

Every change the factory ships clears all three gates.

**Gate 1 -- static checks and tests pass.** Exactly the commands in
`harness/harness.config.json`:

```
npm run typecheck && npm run check:syntax && npm run typecheck:api
npm run test:unit
```

**Gate 2 -- the change is honest about its own evidence.** A new or changed route has a
permission expectation and a validation path; a changed quantity path writes a
transaction; a new master field carries all three languages. No test is weakened, no
assertion deleted, no `--exclude` widened to make a rung pass.

**Gate 3 -- the end-to-end path passes as a real user.**

1. Start the API (`npm run dev:api`, port 8080) and the web console (`npm run dev:web`,
   port 5178) against a seeded `smt_factory` database.
2. Log in as the role that owns the workflow being changed.
3. Walk the journey in `harness/END-TO-END.md` that covers that workflow.
4. The numbers on screen match the transaction history written by the walk.

This runs on every change that touches runnable code, including ones that "seem
unrelated". It is not optional.

## Open questions -- decisions nobody has made yet

These are undecided, not forbidden. **The factory may propose an answer to any of
them**, build against it, and record what it assumed — the merge is then held for a
human, so nothing ships on a guess and nothing stops for one.

- **Q1** May a lot be consumed in production while its IQC result is still `PENDING`, if
  the receiving supervisor signs an override — and if so, what does the traceability
  record show?
- **Q2** Is the shelf rack cell the authoritative location, or is the lot's warehouse
  location? The two can disagree today; which one do reports trust?
- **Q3** For a lot that fails IQC after partial consumption, does MRB disposition apply
  to the remainder only, or does it quarantine the WIP that already used it?
- **Q4** Which roles may edit a released work order's route, and is that an approval
  flow or a permission?

**Except these, which do stop the factory** -- they are on the irreversible list
(`FACTORY_RULES.md` §7.3) rather than open in the ordinary sense:

- Changing who may act as whom: role definitions, permission grants, or impersonation.
- Migrating, rewriting, or deleting stored data — including "one-time" backfills that
  alter production or quality history.

Once answered, an entry moves to `.factory/decisions.md` with its answer and date, and
stops being asked. **A decision is asked once.**

## What the factory does NOT own -- permanently human

- Whether a screen FEELS right for a Vietnamese operator standing at a line with
  gloves on: tap targets, weight, pacing.
- Whether it LOOKS right: layout hierarchy, whether two states read as different at
  1.5 m from a shop-floor monitor.
- Whether a first-time warehouse user can work it out unaided.
- The quality of the Vietnamese and Chinese wording itself.
- Which of the open questions above is the right answer.

The factory owns the domain rules, the data model, the transaction invariants and the
read models: the layer whose correctness can be asserted. That is where most of the
risk lives, and it is the half that can be defended. The list above is reviewed by a
human, on purpose, forever.
