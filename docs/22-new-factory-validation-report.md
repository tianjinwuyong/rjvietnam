# New Factory Validation Report

Date: 2026-07-22  
Target: clean PostgreSQL database `smt_factory_migration_test`

## Application quality gate

- Production TypeScript: PASS, 0 errors (`npm run typecheck`).
- Test TypeScript: PASS, 0 errors (`npm run typecheck:tests`).
- Unit/API contract suite: PASS, 11 files and 200 tests.
- Production web build: PASS, 2,964 modules transformed.
- Non-blocking build risk: the main JavaScript bundle remains above 500 kB and requires later code splitting.
- Canonical MES address: `192.168.6.155:8080`, reachable from this host.
- Authenticated WMS checks: PASS for material lots, storage locations and stock (HTTP 200).
- Work-order allocation concurrency: PASS, 100 requests produced 100 unique 11-digit codes; isolated rows were removed after the test.
- Work-order creation contract: mass production requires PO; every WO requires product, BOM revision, quantity, line and due date.
- Stagnation routes: one active app-level implementation per list, thresholds and resolve operation.

## Database installation

- Migration files discovered: 124
- Migration records applied: 124
- Pending migrations after rerun: 0
- Unvalidated PostgreSQL constraints: 0
- Synthetic users: 0
- Synthetic material lots: 0
- Synthetic inventory transactions: 0
- Synthetic work orders: 0
- Stations created: 68 (manual, automatic and supporting factory nodes)

Clean-install blockers corrected:

1. Invalid trailing comma and anonymous `record` columns in report views.
2. Incompatible report-view replacement column layouts.
3. Partition child nullability changed before the partitioned parent.
4. Procurement quote table collided with the spare-parts quote table.
5. Random WMS lifecycle demo data existed in a production migration.
6. Missing PMC escalation, station activity and material-opening tables.
7. Factory station migration used incorrect canonical line codes and omitted HIPOT type.
8. Finance report configuration assumed user ID 1 existed.
9. Laser-marking retirement destroyed historical data with `CASCADE`.
10. Demo administrator creation was coupled to schema migration.

## Automated verification

| Check | Result |
|---|---|
| Clean database migrations | PASS, 124/124 |
| Idempotent migration plan | PASS, 0 pending |
| PostgreSQL constraint validation | PASS, 0 invalid |
| Production web build | PASS |
| Vitest unit/contract suite | PASS, 11 files / 200 tests |
| Playwright separation | PASS, no longer collected by Vitest |
| Real smart-shelf test separation | PASS, explicit `npm run test:hardware` only |
| TypeScript full-project check | FAIL, legacy DTO/UI/test declarations remain |
| Browser E2E | NOT RUN in this phase |
| Real hardware | NOT RUN; device access required |

## Commands

- Unit and contract tests: `npm test`
- Browser E2E: `npm run test:e2e`
- Real smart-shelf hardware: `npm run test:hardware`
- Migration preview: `node scripts/migrate.mjs --plan`

## Release decision

Database clean installation and the production web build are accepted. Full factory release remains blocked by TypeScript contract errors, browser E2E, real device tests and end-to-end MES/WMS workflows.
