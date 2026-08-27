# RJV-108 staging release-candidate handoff

## Disposition

This is a staging-only package for independent evaluation by RJV-35. It is not a production release approval.

- Source code commit: `3143e7c698d6f5cd7903e2582fc8c260501ba14c` (`feat: enforce WMS receiving validation and ledger actions`)
- Source parent / rollback target: `fef5c26c547490c578d5416cfb3fb70a53c4968e` (`docs: publish SMT management system backup`)
- Source identity command: `git rev-parse 3143e7c698d6f5cd7903e2582fc8c260501ba14c^{commit}`
- Package identity: the immutable commit containing this handoff directory; record its full SHA from `git rev-parse HEAD` after checkout.
- Package contents: the committed tree of the package commit, never the working directory.
- Fixture manifest: [endpoint-database-manifest.json](endpoint-database-manifest.json)
- Rollback procedure: [ROLLBACK.ps1](ROLLBACK.ps1)

The current checkout contains pre-existing untracked files. They are excluded from this package by definition; reviewers must verify using `git archive <package-sha>` or a clean checkout of the immutable package commit.

## Explicit safety boundary

No production MES, SQLite, PostgreSQL, Excel, remote station, employee, customer, or vendor dataset is part of this handoff. No production endpoint was called and no database migration or seed command was run during packaging. The database name in the manifest is disposable and must be provisioned only in an isolated staging PostgreSQL instance.

## Reproduction

```powershell
git clone <approved-non-production-remote> rjv-108-rc
Set-Location rjv-108-rc
git checkout --detach <package-sha>
git status --short --branch                 # must be clean in the fresh checkout
git rev-parse HEAD                          # record the immutable package SHA
git archive --format=zip --output=RJV-108-package.zip <package-sha>
Get-FileHash .\RJV-108-package.zip -Algorithm SHA256
```

Run only with the fixture manifest loaded and a disposable database:

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:hardware
```

Do not run `npm run migrate` against any database except the disposable database named in the manifest. Do not point browser, API, scanner, or hardware tests at production addresses.

## Evidence tied to candidate

| Control | Result | Evidence / exception |
|---|---|---|
| Immutable Git identity | PASS for source / package SHA recorded at handoff | `git rev-parse <package-sha>`; source `3143e7c698d6f5cd7903e2582fc8c260501ba14c` |
| Clean committed candidate | PASS for package tree / REVIEW for this checkout | `git archive <package-sha>`; current checkout has unrelated untracked files |
| Fixture-only endpoint/database boundary | PASS | `endpoint-database-manifest.json`; no production calls |
| Unit tests | NOT RUN | Must run from fresh checkout at `3143e7c` with fixture dependencies |
| Typecheck/build | NOT RUN | Same controlled rerun required |
| Browser E2E | NOT RUN | Requires isolated staging services; no production browser target used |
| WMS/MES/PDA/3D/OQC workflows | NOT RUN in this packaging heartbeat | Independent RJV-35 workflow verification required; existing historical docs are not substituted as SHA-bound evidence |
| Security | EXCEPTION—pending | No production security probe performed; RJV-35 must run auth/role/input-boundary checks against fixtures |
| Performance | EXCEPTION—pending | No load test performed; RJV-35 must run its agreed fixture workload and retain raw output |
| Restored-copy migrations | EXCEPTION—pending | No migration was run; RJV-35 must restore a disposable copy and execute migrations there |
| Hardware | EXCEPTION—pending | No scanner/shelf/label/remote-station hardware was touched; physical test owner must provide fixture/simulator evidence |

The NOT RUN and EXCEPTION rows are deliberate safety exceptions, not release approval. RJV-35 is the independent release gate and must close them or record an approved exception before acceptance.

## Rollback

The rollback target is `fef5c26c547490c578d5416cfb3fb70a53c4968e`. From a clean staging checkout, execute `powershell -ExecutionPolicy Bypass -File .\docs\release-candidates\RJV-108-3143e7c\ROLLBACK.ps1`. This changes only the staging checkout. Any staging database rollback must use the disposable database's snapshot/restore procedure; never issue destructive commands against production.

## Handoff request

RJV-35 should independently verify the fresh checkout, manifest boundary, reproducibility commands, and every pending evidence row. This package intentionally does not claim release approval.
