# Local PostgreSQL Setup

This project is intended to run against a PostgreSQL database installed on the local machine.

## Recommended Version

- PostgreSQL 16

## Database Name

- `smt_factory`

## Suggested User

- `postgres` superuser (default for `npm run migrate` and API service)
  - For production, create a named user: `CREATE USER smt_factory WITH PASSWORD 'your_password'; GRANT ALL PRIVILEGES ON DATABASE smt_factory TO smt_factory;`

## Setup Steps

1. Install PostgreSQL 16 on the computer that will run the system.
2. Make sure the PostgreSQL service starts automatically.
3. Create the database and user.
4. Apply migrations in order (use `npm run migrate` from the project root, or apply manually):
   - `database/migrations/001_initial_factory_schema.sql`
   - `database/migrations/002_strengthen_mvp_schema.sql`
   - `database/migrations/002_supplementary_materials_and_constraints.sql`
   - `database/migrations/003_finance_accounting_schema.sql`
   - `database/migrations/003_hr_permissions.sql`
   - `database/migrations/004_enterprise_support_schema.sql`
   - `database/migrations/005_equipment_management_schema.sql`
   - `database/migrations/005_wms_smart_shelf.sql`
   - `database/migrations/006_nullable_work_order_po.sql`
   - `database/migrations/007_add_production_lines.sql`
   - `database/migrations/008_fix_production_lines_per_doc.sql`
   - `database/migrations/009_add_work_order_related.sql`
   - `database/migrations/010_finance_mvp.sql`
   - `database/migrations/011_sales_quote_order.sql`
   - `database/migrations/012_service_rma_and_quality_link.sql`
   - `database/migrations/013_hr_schema.sql`
5. Apply seed files in order (use `npm run migrate:seed`, or apply manually):
   - `database/seeds/001_demo_factory_seed.sql`
   - `database/seeds/002_mes_stations_seed.sql`
   - `database/seeds/002_mvp_extended_seed.sql`
   - `database/seeds/002_smart_shelf_test_seed.sql`
   - `database/seeds/003_finance_accounting_seed.sql`
   - `database/seeds/003_mes_process_route_seed.sql`
   - `database/seeds/004_enterprise_support_seed.sql`
   - `database/seeds/004_mes_permissions_seed.sql`
   - `database/seeds/005_equipment_management_seed.sql`
   - `database/seeds/013_hr_seed.sql`

   Or use the runner for automatic ordering: `npm run migrate:seed`

## Example Connection String

```text
postgresql://postgres:your_password@127.0.0.1:5432/smt_factory
```

## Notes

- Keep the database on the same machine as the application for the first install.
- Use backups after the database is working.
- Docker is optional, not required.

