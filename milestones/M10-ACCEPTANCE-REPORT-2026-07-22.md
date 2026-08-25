# M10 local acceptance report — 2026-07-22

Scope: WMS/MES milestones M4–M10 on the local integration environment.

## Verified results

| Check | Result | Evidence |
|---|---|---|
| Application type safety | PASS | `npm run typecheck:all` |
| Automated regression suite | PASS | 215 passed, 2 physical/site tests skipped with all M4–M10 live switches enabled |
| Production web build | PASS | Vite production bundle generated |
| API availability | PASS | `/health` returned HTTP 200 |
| Web availability | PASS | port 5178 returned HTTP 200 |
| M4 inbound/IQC live acceptance | PASS | `tests/wms-m4-live.test.ts` |
| M5 outbound/consumption live acceptance | PASS | `tests/wms-m5-live.test.ts` |
| M6 lifetime enforcement live acceptance | PASS | `tests/wms-m6-live.test.ts` |
| M7 canonical station timeline live acceptance | PASS | `tests/mes-m7-live.test.ts` |
| M8 resilient exchange live acceptance | PASS | `tests/mes-wms-m8-live.test.ts` |
| Synchronization management screen | PASS | Authoritative event/conflict APIs, 15-second refresh and conflict decisions |
| Synchronization permission boundary | PASS | Warehouse/operator denied; management role reaches decision workflow |
| Accelerated 20-minute offline recovery | PASS | Persistence, retry, acknowledgement, idempotency and replay verified after logical 20-minute interruption |
| Scanner guard API | PASS | Unknown SN and station jump blocked without SN-master/registry insertion |
| Station-agent scanner contract | PASS | Guard check is read-only and fails closed when MES is unavailable |
| Bounded synchronization backlog | PASS | 120 events persisted, claimed and acknowledged exactly once; cleanup verified |
| PostgreSQL backup/restore | PASS | 27.4 MB backup restored; 725 tables, 140 migrations and key table counts matched; isolated restore DB removed |
| Trilingual contract | PASS | Every canonical WMS menu/state key resolves in Chinese, Vietnamese and English |
| Audited test cleanup | PASS | M4–M10 prefixes verified at zero; cleanup evidence stored in `system_test_cleanup_audit` |
| Safe station alert rules | PASS | `expr-eval` removed; restricted comparison grammar rejects executable syntax |

Live acceptance tests create uniquely named records and remove their records in `finally` cleanup blocks.

## Open acceptance items

1. Run and document the physical 20-minute disconnection/reconnect drill (accelerated persistence drill passes).
2. Expand the passed sync-governance role-negative test to every approval module as dedicated identities are commissioned.
3. Run physical scanner tests with the actual station scanners.
4. Run Chinese, English and Vietnamese browser acceptance over the remaining management screens (local in-app automation was blocked by browser localhost policy; the web service itself returns HTTP 200).
5. Rehearse PostgreSQL backup and restore in an isolated recovery database.
6. Complete physical custody/disposal acceptance for expired material.
7. Complete remaining master-data approval/version screens and remove remaining non-canonical demo screens.

## Known defects and risks

| Severity | Item | Disposition |
|---|---|---|
| Closed | `expr-eval` advisories | Dependency removed and replaced with a restricted, tested threshold-expression evaluator |
| High | `xlsx` 0.18.5 has published prototype-pollution/ReDoS advisories and no npm registry fix is offered | Current factory Excel functions remain operational; replace with a maintained parser before production approval |
| Low | Old AOI service dependency uses `body-parser <1.20.6` | Upgrade the AOI service dependency |
| Medium | Main web bundle is approximately 4.47 MB minified | Split large management modules before low-bandwidth deployment |
| Acceptance | Seven hardware/live tests are environment-gated | Execute them on the pilot network with approved credentials/devices |

## Release decision

**M10 engineering verification is complete.** All automated and live software gates, backup/restore, backlog, permission, scanner-contract, trilingual-contract and cleanup checks pass. Production sign-off remains withheld only for the physical scanner/network/browser checklist and the high-risk Excel parser replacement. No EXE packaging or remote deployment is approved by this report until those release blockers are accepted.
