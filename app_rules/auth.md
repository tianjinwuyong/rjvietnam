# Auth Rules

## Owns

- auth flows in `services/api`
- auth-related shared contracts
- auth-specific docs

## May edit

- login/logout/session/current-user logic
- role and permission policy code
- auth tests
- auth contract shapes

## Must not edit

- database schema unless the schema worker is explicitly handing off a field
- UI layout unless a login or session screen is required
- unrelated business module logic

## Required rules

1. Keep the auth contract aligned with the user, role, and permission schema.
2. Do not store secrets in plain text.
3. Every deny path must be auditable.
4. Keep login, logout, current-user, and route-gate behavior explicit and testable.
5. Treat permission checks as part of the API boundary, not as UI hints.

## Required checks

- Verify role-to-permission mapping for each visible module.
- Verify failed and successful login paths are logged or emitted as audit events.
- Verify session expiration and logout behavior are consistent.

## Handoff

- If auth needs a new persisted field or table, write the dependency clearly for the database lane.
