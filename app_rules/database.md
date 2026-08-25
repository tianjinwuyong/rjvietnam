# Database Rules

## Owns

- `database/migrations`
- `database/seeds`
- `database/schema-notes.md`
- DB-focused docs under `docs/`

## May edit

- SQL migrations
- seed files
- schema notes
- DB design docs

## Must not edit

- UI implementation
- API implementation
- auth implementation
- integration adapters

## Required rules

1. Keep the schema additive unless a rewrite is unavoidable.
2. Model master data, transactions, audit/history, permissions, and traceability explicitly.
3. Preserve void/cancel/close status history instead of hard-deleting operational records.
4. Cover the full system, not just the MVP slice.
5. Keep derived values out of source-of-truth tables unless they are needed for auditability.
6. Add indexes on hot query paths and name them clearly.

## Required checks

- Check foreign keys, constraints, and status enums for consistency.
- Verify the seed data exercises the main factory and enterprise flows.
- Call out any deferred tables or columns in the schema notes.

## Handoff

- If another lane needs a new field or table, document the dependency here and in the contract docs.
