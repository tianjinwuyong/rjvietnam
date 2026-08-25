# App Rules

This folder contains the operating contract for every OpenCode agent working in `smt-factory-system`.

Each agent must load the rule file for its lane before editing code. If a task spans multiple lanes, the agent uses its own file and treats the others as read-only contracts.

## Agent map

- `architecture.md` for cross-cutting structure and boundaries
- `database.md` for schema, migrations, seeds, and data history
- `ui.md` for `apps/web` and other user-facing screens
- `auth.md` for login, sessions, roles, and permission checks
- `api.md` for backend endpoints and API contracts
- `data-contract.md` for UI-to-DB mapping and DTO alignment
- `backend-validation.md` for continuous backend verification
- `runtime-ports.md` for startup ports and service launch rules

## Shared rules

1. Own one lane, not the whole repo.
2. Do not revert another agent's edits.
3. Keep changes additive unless a rewrite is explicitly required.
4. Document gaps instead of silently inventing behavior.
5. Validate the boundary you changed before handing off.

## Rule format

Each lane file should state:

1. ownership boundary
2. allowed files
3. forbidden files
4. required checks
5. handoff notes
