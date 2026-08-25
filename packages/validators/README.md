# Validators

Shared validation rules.

Initial validators:
- work order code
- customer PO number
- material number
- material reel ID
- PCB serial number
- storage location code
- feeder code
- station code
- shipment carton label

Boundary helpers in `src/index.ts` should stay aligned with the API DTOs in `packages/shared-types/src/contracts.ts`.
