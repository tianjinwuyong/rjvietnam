# API Service

Main backend API for the integrated SMT system.

Default port:

```text
8080
```

Recommended modules:

```text
services/api/src/
├── common/
├── auth/
├── admin/
├── master-data/
├── erp/
├── pmc/
├── wms/
├── mes/
├── quality/
├── traceability/
├── reports/
└── integrations/
```

API principles:
- One source of truth for master data.
- Every stock movement creates an inventory transaction.
- Every production and inspection action creates traceability events.
- Do not delete traceability records; close, cancel, or void them with status.

Contract artifacts:
- `openapi.yaml` defines the public route inventory.
- `../../packages/shared-types/src/contracts.ts` defines request and response DTOs.
- `../../packages/validators/src/index.ts` defines boundary validation helpers for scans and business codes.
