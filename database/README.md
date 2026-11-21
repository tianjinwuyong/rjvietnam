# Database

Recommended database: PostgreSQL installed locally on the server or development PC.

```text
database/
├── migrations/
├── seeds/
├── diagrams/
├── docker/
│   └── init/
└── schema-notes.md
```

Core table groups:
- master data
- ERP / customer PO
- PMC / work order
- WMS / inventory
- MES / production
- Quality / inspection and repair
- Traceability
- Finance / accounting
- Reports and audit

Local PostgreSQL flow:
- Install PostgreSQL 16 on the machine that runs the system
- Create the `smt_factory` database and a database user for the app
- Apply the SQL files in `database/migrations/` in order
- Apply the SQL files in `database/seeds/` after the migrations
- Keep the database running as a Windows service or Linux service

Docker remains optional for development, but it is not required for the local installation path.
