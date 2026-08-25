# Database Reference

This project uses one local PostgreSQL database for the full factory platform.

## Database

- Database name: `smt_factory`
- Engine: PostgreSQL 16
- Schema: `public`

## Source Of Truth

- Schema inventory: [database-schema-map.md](../database/database-schema-map.md)
- Local setup: [local-postgres-setup.md](../database/local-postgres-setup.md)

## Frontend Usage Rules

- Read module data from the tables that belong to that module.
- Do not duplicate inventory balance in the frontend; derive it from transactions.
- Do not assume hard-coded demo arrays are permanent business data.
- Use stable business codes in UI labels and filters.
- Treat `inventory_transactions`, `traceability_events`, and `audit_logs` as history tables.

## Main Table Groups

### Admin And Master Data

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
- `customers`
- `customer_contacts`
- `suppliers`
- `supplier_contacts`
- `products`
- `materials`
- `process_routes`
- `process_route_steps`
- `boms`
- `bom_lines`
- `defect_codes`

### PMC

- `customer_pos`
- `customer_po_lines`
- `work_order_serial_counters`
- `work_orders`
- `fiscal_periods`

### WMS

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

### MES And Equipment

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

### Quality

- `quality_inspections`
- `repair_records`

### Traceability

- `traceability_events`

### Finance

- `currencies`
- `exchange_rates`
- `gl_accounts`
- `cost_centers`
- `profit_centers`
- `tax_codes`
- `gl_journal_entries`
- `gl_journal_lines`
- `ap_invoices`
- `ap_invoice_lines`
- `ar_invoices`
- `ar_invoice_lines`
- `work_order_cost_summaries`

### HR And Support

- `marketing_campaigns`
- `marketing_campaign_leads`
- `customer_service_categories`
- `customer_service_tickets`
- `customer_service_ticket_messages`
- `customer_service_slas`

## Smart Shelf Integration

The current web app already calls these endpoints:

- `POST /api/shelf/LightOnAllEmptyLocationGY`
- `POST /api/shelf/ShelfInGY`
- `POST /api/shelf/ShelfOutGY`
- `POST /api/shelf/InventoryRemoveLable`

Recommended database support for shelf integration:

- `smart_shelves`
- `smart_shelf_slots`
- `smart_shelf_labels`
- `smart_shelf_commands`
- `smart_shelf_command_results`
- `smart_shelf_events`

## Key Relationships

- `work_orders` link customer demand to production.
- `material_lots` hold received lot state and IQC state.
- `inventory_transactions` record every stock movement.
- `traceability_events` mirror the important operational chain.
- `equipment_assets` and maintenance tables support MES equipment control.
- `gl_journal_entries` and `gl_journal_lines` keep finance append-only.

## Current Status

- Local PostgreSQL is installed and the project schema is applied.
- The database currently has `91` tables in the `public` schema.
- The frontend should treat this document as the lightweight reference and the schema map as the full inventory.

