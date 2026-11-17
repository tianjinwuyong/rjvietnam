# OpenMES adapter

This service connects the existing Ruijing SMT MES to OpenMES without sharing
application databases. The existing MES remains authoritative for SMT station
execution, IQC/MRB/NG and material traceability. OpenMES receives normalized
master data and work orders through its documented ERP API.

## Configuration

Set these variables in `services/api/.env` or the process environment:

```env
OPENMES_BASE_URL=http://127.0.0.1:8000
OPENMES_API_KEY=replace-with-openmes-erp-api-key
OPENMES_ADAPTER_PORT=8092
OPENMES_DEFAULT_WAREHOUSE=RAW-INCOMING
```

## Run

```powershell
node scripts/migrate.mjs
npm --workspace services/openmes-adapter run start
```

Use `POST http://127.0.0.1:8092/sync/all` to synchronize materials, lots, and
work orders. Use `{ "dryRun": true }` to validate row counts without calling
OpenMES. `GET /status` shows the run history and object-level sync state.

Use `POST /sync/inbound` to pull OpenMES production completions and quality
issues into the local inbound event ledger. The existing MES can then consume
those events without direct OpenMES database access.

OpenMES must have an ERP API key with `erp:masterdata:write` and
`erp:orders:import` scopes. No API key is stored in source control.
