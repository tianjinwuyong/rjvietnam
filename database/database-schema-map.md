g# Database Schema Map

This project uses one PostgreSQL database for the whole factory platform.

- Database name: `smt_factory`
- Engine: PostgreSQL 16
- Schema style: shared relational schema, no separate per-module databases

## 1. Database

### `smt_factory`
Single operational database for ERP, PMC, WMS, MES, Quality, Traceability, Finance, HR, and support modules.

## 2. Schema Groups

### Admin and Master Data
Core master tables and security foundation.

- `roles`
- `permissions`
- `role_permissions`
- `users`
- `departments`
- `positions`
- `employees`
- `employee_shifts`
- `leave_requests`
- `training_records`
- `currencies`
- `customers`
- `customer_contacts`
- `suppliers`
- `supplier_contacts`
- `products`
- `materials`
- `gl_accounts`
- `cost_centers`
- `profit_centers`
- `tax_codes`
- `process_routes`
- `process_route_steps`
- `boms`
- `bom_lines`
- `defect_codes`

### ERP and PMC
Demand, customer order, and work order control.

- `customer_pos`
- `customer_po_lines`
- `work_order_serial_counters`
- `work_orders`
- `fiscal_periods`

### WMS
Warehouse receiving, inspection, storage, picking, issue, return, and inventory movement.

- `storage_locations`
- `receiving_orders`
- `receiving_order_lines`
- `material_lots`
- `iqc_inspections`
- `pick_orders`
- `pick_order_lines`
- `line_issue_orders`
- `line_issue_order_lines`
- `line_return_orders`
- `line_return_order_lines`
- `inventory_transactions`
- `inventory_cost_layers`
- `shipments`
- `shipment_lines`

### MES, Quality, Traceability, and Audit
Production execution, inspection, repair, and event history.

- `production_lines`
- `stations`
- `machines`
- `equipment_categories`
- `equipment_models`
- `equipment_locations`
- `equipment_status_codes`
- `equipment_assets`
- `equipment_spare_parts`
- `maintenance_plans`
- `maintenance_plan_steps`
- `maintenance_plan_assignments`
- `maintenance_schedules`
- `maintenance_orders`
- `maintenance_order_lines`
- `maintenance_work_logs`
- `breakdown_events`
- `downtime_events`
- `inspection_tasks`
- `inspection_results`
- `calibration_records`
- `equipment_repair_records`
- `equipment_events`
- `equipment_status_history`
- `feeder_bindings`
- `pcb_serials`
- `station_events`
- `quality_inspections`
- `repair_records`
- `traceability_events`
- `audit_logs`

### Finance and Accounting
General ledger, AP, AR, costing, and valuation support.

- `exchange_rates`
- `ap_invoices`
- `ap_invoice_lines`
- `ar_invoices`
- `ar_invoice_lines`
- `gl_journal_entries`
- `gl_journal_lines`
- `work_order_cost_summaries`

### Marketing and Customer Service
Support and commercial follow-up.

- `marketing_campaigns`
- `marketing_campaign_leads`
- `customer_service_categories`
- `customer_service_tickets`
- `customer_service_ticket_messages`
- `customer_service_slas`

## 3. Migration Files

The database is created through additive SQL migrations (applied in lexical order by `npm run migrate`):

- [001_initial_factory_schema.sql](./migrations/001_initial_factory_schema.sql)
- [002_strengthen_mvp_schema.sql](./migrations/002_strengthen_mvp_schema.sql)
- [002_supplementary_materials_and_constraints.sql](./migrations/002_supplementary_materials_and_constraints.sql)
- [003_finance_accounting_schema.sql](./migrations/003_finance_accounting_schema.sql)
- [003_hr_permissions.sql](./migrations/003_hr_permissions.sql)
- [004_enterprise_support_schema.sql](./migrations/004_enterprise_support_schema.sql)
- [005_equipment_management_schema.sql](./migrations/005_equipment_management_schema.sql)
- [005_wms_smart_shelf.sql](./migrations/005_wms_smart_shelf.sql)
- [006_nullable_work_order_po.sql](./migrations/006_nullable_work_order_po.sql)
- [007_add_production_lines.sql](./migrations/007_add_production_lines.sql)
- [008_fix_production_lines_per_doc.sql](./migrations/008_fix_production_lines_per_doc.sql)
- [009_add_work_order_related.sql](./migrations/009_add_work_order_related.sql)
- [010_finance_mvp.sql](./migrations/010_finance_mvp.sql)
- [011_sales_quote_order.sql](./migrations/011_sales_quote_order.sql)
- [012_service_rma_and_quality_link.sql](./migrations/012_service_rma_and_quality_link.sql)
- [013_hr_schema.sql](./migrations/013_hr_schema.sql)

## 4. Seed Files

Initial data is loaded through SQL seed files (applied in lexical order by `npm run migrate:seed`):

- [001_demo_factory_seed.sql](./seeds/001_demo_factory_seed.sql)
- [002_mes_stations_seed.sql](./seeds/002_mes_stations_seed.sql)
- [002_mvp_extended_seed.sql](./seeds/002_mvp_extended_seed.sql)
- [002_smart_shelf_test_seed.sql](./seeds/002_smart_shelf_test_seed.sql)
- [003_finance_accounting_seed.sql](./seeds/003_finance_accounting_seed.sql)
- [003_mes_process_route_seed.sql](./seeds/003_mes_process_route_seed.sql)
- [004_enterprise_support_seed.sql](./seeds/004_enterprise_support_seed.sql)
- [004_mes_permissions_seed.sql](./seeds/004_mes_permissions_seed.sql)
- [005_equipment_management_seed.sql](./seeds/005_equipment_management_seed.sql)
- [013_hr_seed.sql](./seeds/013_hr_seed.sql)

## 5. Operational Notes

- Inventory balance is derived from `inventory_transactions`.
- Work order codes remain numeric and 11 digits long.
- Traceability is written during normal transactions, not reconstructed later.
- No hard-delete pattern is used for operational records.
- Finance uses append-only journal entries and derived balances.
- The bootstrap script applies all migrations and seeds on first database start.
