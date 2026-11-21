# Restart Continuation — SMT Factory System

Created: 2026-08-04

## Before restarting the API

`services/api/server.js` now refuses to start without a real `JWT_SECRET`.
Confirm the existing local `.env` has a non-placeholder value:

```dotenv
JWT_SECRET=<strong-secret>
```

Do not paste secrets into chat or commit `.env`.

## Completed changes

1. Scanner launch path repaired.
   - `package.json`: `npm run dev:scanner` now uses
     `npm --prefix apps/pdas/scanner-terminal run dev`.
   - `services/watchdog/watchdog.js`: scanner now runs from
     `apps/pdas/scanner-terminal`.
2. Default Vitest run is safe.
   - Excluded `tests/smt-pda-immediate-test-bypass.test.mjs` from ordinary
     Vitest runs. It is a standalone script that writes to the local factory
     database and calls the API; it must only be run deliberately against an
     approved disposable environment.
3. Runtime configuration/documentation aligned.
   - `.env.example` now documents `API_PORT=8080`.
   - `README.md`, `docs/13-implementation-map.md`, and `docs/16-port-map.md`
     now document web port `5178`.
4. JWT startup safety improved.
   - Removed the source-embedded fallback signing secret.
   - API startup requires a non-placeholder `JWT_SECRET`.

## Verification already completed

```powershell
cd C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system
npm --prefix apps/pdas/scanner-terminal run build
node --check services/api/server.js
npm test
```

Results:

- Scanner production build passed.
- API syntax check passed.
- Vitest: 17 files passed, 212 tests passed, 18 intentionally skipped.

## Safe restart sequence

```powershell
cd C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system
node start_dev.js
```

Expected local endpoints:

- Web console: `http://localhost:5178`
- API: `http://localhost:8080`
- Scanner PDA (separate command): `npm run dev:scanner`, then `http://localhost:5174`

Do not apply database migrations, seeds, or live integration scripts during
restart without explicit approval.

## Next work

1. Replace the two live API login routes' source-embedded passwords with a
   controlled credential migration. This needs compatibility planning because
   current users and live tests depend on the existing passwords.
2. Audit WMS-to-MES material issue / station execution / QC / traceability as
   one closed production workflow.
3. Review station-agent deployment and release-version consolidation.

## Repository note

This source copy has newly initialized Git metadata but no baseline commit and
many untracked files. Do not bulk-stage it. Create a protective `.gitignore`
and establish an approved baseline before committing.
