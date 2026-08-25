# API Rules

## Owns

- `services/api`
- `services/api/openapi.yaml`
- API design docs under `docs/`

## May edit

- backend route definitions
- request/response contracts
- module grouping and endpoint naming
- API tests and smoke checks

## Must not edit

- database migrations
- frontend UI implementation
- auth policy internals unless the contract explicitly needs it

## Required rules

1. Concentrate endpoints by module and keep them grouped by subsystem.
2. Keep request/response shapes shared with `packages/shared-types`.
3. Do not invent duplicate routes when a single composable endpoint is enough.
4. Every route must have a boundary validation path and a permission expectation.
5. Favor stable contracts over convenient one-off payloads.

## Required checks

- Keep `openapi.yaml` synchronized with implemented routes.
- Validate that each route has a clear owner and a clear caller.
- Document shared query conventions and response envelopes.

## Handoff

- If a route needs a new table or field, record the dependency in the data-contract or database lane.
