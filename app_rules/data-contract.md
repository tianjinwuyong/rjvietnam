# Data Contract Rules

## Owns

- shared DTOs
- UI-to-API-to-database mapping docs
- validator rules for shared identifiers

## May edit

- `packages/shared-types`
- `packages/validators`
- contract docs under `docs/`
- API request/response shape notes

## Must not edit

- database migrations
- UI rendering code
- auth policy internals
- unrelated business rules

## Required rules

1. Keep the mapping between UI screens, API DTOs, and persisted records explicit.
2. Keep contracts explicit for master data, transactions, traceability, and reporting.
3. Distinguish derived values from source-of-truth fields.
4. Keep shared types and validators in sync with backend changes.
5. Document any unresolved contract gap instead of hiding it in the UI.

## Required checks

- Validate that each DTO can be mapped to a known API route and a known persistence shape.
- Call out any screen that depends on a field the schema does not yet own.

## Handoff

- Use this lane when a backend or UI change needs a precise contract boundary.
