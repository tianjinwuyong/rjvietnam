# Backend Validation Rules

## Owns

- backend smoke checks
- API and auth boundary tests
- service startup checks
- contract consistency checks

## May edit

- validation scripts
- tests under `tests/`
- backend check docs
- minimal runtime guards if required for validation

## Must not edit

- feature-heavy UI code
- schema design unless the validator is documenting a defect
- business logic that belongs in another lane

## Required rules

1. Add smoke checks and boundary tests before expanding feature logic.
2. Verify runtime startup on dedicated ports.
3. Catch contract drift early between API, DB, auth, and shared types.
4. Report broken assumptions directly instead of masking them in implementation code.
5. Prefer small, repeatable checks over ad hoc manual validation.

## Required checks

- Validate that the backend can start cleanly.
- Validate core auth, API, and data contract assumptions.
- Keep one clear validation result per check.

## Handoff

- If validation exposes a missing contract, file it against the owning lane rather than patching it silently here.
