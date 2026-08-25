# First Runnable Implementation Map

This project now contains a runnable first version of the Vietnam Ruijing SMT factory platform.

## Implemented Surfaces

- `apps/web`: Vite React operations console with module navigation, i18n switching, live line dashboard, PMC work orders, WMS inventory, SMT scanner flow, feeder binding, quality records, traceability timeline, reports, and role permissions.
- `packages/shared-types`: TypeScript contracts for factory lines, POs, work orders, material lots, feeder bindings, inspections, traceability, and dashboard metrics.
- `packages/business-rules`: Work order code generation/validation and inventory transaction validation.
- `database/migrations`: Baseline PostgreSQL schema plus additive finance/accounting extension covering master data, transaction records, cost layers, billing references, quality closure, traceability events, and GL posting.
- `database/seeds`: Demo seed data for a realistic SMT flow plus finance/accounting master data and sample ledger postings.
- `services/api/openapi.yaml`: API boundary for the modules the UI is modeling.
- `tests/work-order-coding.test.ts`: Unit tests for the required 11-digit work order coding rule.

Contract layer ownership:
- `services/api/openapi.yaml`
- `packages/shared-types/src/contracts.ts`
- `packages/validators/src/index.ts`
- `docs/15-data-contract-map.md`

## MVP Flow Covered

Customer PO -> Work Order -> Material Receiving -> IQC -> Storage -> Picking -> Issue to SMT Line -> Feeder Binding -> SMT Production -> Inspection -> Repair -> Traceability Query.

## Run

```bash
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:5178
```
