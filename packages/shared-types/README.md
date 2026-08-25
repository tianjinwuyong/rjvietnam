# Shared Types

Shared API contracts and domain types for frontend apps and backend services.

Initial type groups:
- users and roles
- master data
- customer PO
- work order
- inventory
- material lot
- production run
- station event
- inspection result
- repair record
- traceability event

Contract file:
- `src/contracts.ts` for request/response DTOs and read-model shapes between the UI and API.
- `src/station-query.ts` for the shared read-only NG, history, station-status, and WIP query helpers used by Agent, MES Web, and PDA siblings.
- `src/station-query-api.ts` for the single MES read endpoint used by Web, PDA, and station adapters (`GET /api/mes/station-query`).
