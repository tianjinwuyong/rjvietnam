\set ON_ERROR_STOP on

\echo 'Applying database migrations'
\i /docker-entrypoint-initdb.d/database/migrations/001_initial_factory_schema.sql
\i /docker-entrypoint-initdb.d/database/migrations/002_strengthen_mvp_schema.sql
\i /docker-entrypoint-initdb.d/database/migrations/002_supplementary_materials_and_constraints.sql
\i /docker-entrypoint-initdb.d/database/migrations/003_finance_accounting_schema.sql
\i /docker-entrypoint-initdb.d/database/migrations/003_hr_permissions.sql
\i /docker-entrypoint-initdb.d/database/migrations/004_enterprise_support_schema.sql
\i /docker-entrypoint-initdb.d/database/migrations/005_equipment_management_schema.sql
\i /docker-entrypoint-initdb.d/database/migrations/005_wms_smart_shelf.sql
\i /docker-entrypoint-initdb.d/database/migrations/006_nullable_work_order_po.sql
\i /docker-entrypoint-initdb.d/database/migrations/007_add_production_lines.sql
\i /docker-entrypoint-initdb.d/database/migrations/008_fix_production_lines_per_doc.sql
\i /docker-entrypoint-initdb.d/database/migrations/009_add_work_order_related.sql
\i /docker-entrypoint-initdb.d/database/migrations/010_finance_mvp.sql
\i /docker-entrypoint-initdb.d/database/migrations/011_sales_quote_order.sql
\i /docker-entrypoint-initdb.d/database/migrations/012_service_rma_and_quality_link.sql
\i /docker-entrypoint-initdb.d/database/migrations/013_hr_schema.sql

\echo 'Applying database seeds'
\i /docker-entrypoint-initdb.d/database/seeds/001_demo_factory_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/002_mes_stations_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/002_mvp_extended_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/002_smart_shelf_test_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/003_finance_accounting_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/003_mes_process_route_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/004_enterprise_support_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/004_mes_permissions_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/005_equipment_management_seed.sql
\i /docker-entrypoint-initdb.d/database/seeds/013_hr_seed.sql
