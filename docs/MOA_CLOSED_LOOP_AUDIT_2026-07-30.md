# MoA Closed-Loop Audit — 2026-07-30

Scope: PMC planning, production capacity, material/WMS readiness, quality and
engineering gates, approvals, HR/employee app, difficult bugs, and architecture.

Method: local repository evidence, `grill-me` first-safe-recommendation policy,
and the Hermes `factory-review` MoA risk board. No production or HR records were
changed.

## Baseline

- Production web build: PASS.
- Vitest: PASS, 209 tests passed and 20 skipped.
- TypeScript: OPEN, 71 errors remain after the shared query-contract repair.
- Rollback/review trail: OPEN. This directory is not a Git working tree.

## Closed in this pass

1. WMS canonical navigation now has typed routes for PDA receiving, PDA cycle
   count, production inbound, and production outbound.
2. Missing zh-CN, vi-VN, and en-US navigation strings were added for incoming
   materials and production inbound/outbound.
3. The shared API client now accepts direct query objects and Axios-style
   `{ params }` objects, ignores non-scalar values, and preserves existing query
   strings.
4. The previously failing WMS trilingual contract now passes; the full test
   suite passes.

## Domain closure board

| Domain | Status | Evidence / blocker | Owner | Next action |
|---|---|---|---|---|
| PMC plan review | PARTIAL | `PmcClosedLoop` presents the six gates, but a UI declaration is not proof that release is blocked server-side. | PMC + API | Add negative-path API tests proving a work order cannot release while any gate is incomplete. |
| Production capacity | OPEN | Capacity is represented in the planned flow; enforcement was not proven by the current test suite. | PMC | Define the source-of-truth capacity snapshot and block release on overload or missing snapshot. |
| Material / WMS readiness | PARTIAL | WMS closure and handover surfaces exist; trilingual navigation contract is now closed. End-to-end release enforcement is not yet proven. | WMS + PMC | Test BOM demand → allocation → kit-ready → release, including shortage and hold paths. |
| Quality / engineering | OPEN | The release flow names this gate, but server-side quality and engineering prerequisites were not proven. | Quality + Engineering | Define required sign-offs and add release rejection tests for missing/expired sign-offs. |
| Approval workflow | BLOCKED | HR management UI calls `/hr/leave-requests/:id`; no matching server route was found. The canonical leader flow uses `/hr/leave/approve` and advances to `pending_hr`. | HR + Auth + API | Reconcile the two leave contracts, enforce leader/HR roles, persist audit actor/time/reason, then add unauthorized and out-of-order transition tests. |
| HR / employee app | PARTIAL | Profile updates have HR approval. Several HR screens still consume `ListEnvelope.data` although the shared contract exposes `items`. | HR UI + API contract | Migrate pages to `items`; remove unsafe casts; test photo/profile approval and persistence. |
| Bugs / architecture | PARTIAL | Tests and build pass; TypeScript still reports 71 errors. The repo copy has no Git history. | Engineering | Fix HR/approval contract errors first, then add a no-new-errors ratchet. Put the maintained source under version control before broad refactors. |

## Release decision

Do not declare the entire factory workflow closed yet. WMS localization and the
shared query contract are verified closed, but production release gating and
the leave approval contract remain open. No production deployment is approved
by this audit.
