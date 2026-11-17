# Database Schema Notes

## Implemented Tables

### Admin and Master Data
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

### MES, Quality, Traceability, and Audit
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

### Finance And Accounting
- `exchange_rates`
- `ap_invoices`
- `ap_invoice_lines`
- `ar_invoices`
- `ar_invoice_lines`
- `gl_journal_entries`
- `gl_journal_lines`
- `work_order_cost_summaries`

### Marketing and Customer Service
- `marketing_campaigns`
- `marketing_campaign_leads`
- `customer_service_categories`
- `customer_service_tickets`
- `customer_service_ticket_messages`
- `customer_service_slas`

## Design Rules

- Work order codes remain numeric 11-digit values and are validated at the table level.
- Inventory balance is derived from `inventory_transactions`; do not add a stored balance as the source of truth.
- Material lots carry lifecycle state through `iqc_status`, `lot_status`, and timestamp fields.
- Receiving, picking, issue, and return are represented as header + line tables so traceability can stay auditable.
- `traceability_events` is the query-friendly event ledger; it should mirror the real source rows, not replace them.
- Finance uses append-only journal entries plus invoice and shipment references; GL balances are derived, not stored as a single balance field.
- Cost accumulation is held in `work_order_cost_summaries` and linked to GL postings, not duplicated in the work-order header as the only source of truth.

## Constraints And Indexes

- Unique codes exist on the main master-data tables and document tables.
- Status checks are added to the transactional tables so invalid states do not leak into the MVP data set.
- Foreign-key indexes cover the main lookup paths:
  - work order by line and PO
  - lot by material, supplier, and occurred time
  - inventory transaction by lot and work order
  - station event by PCB serial and station
  - traceability event by trace key and reference
  - audit log by entity and actor
  - journal line by account, cost center, and profit center
  - invoice by supplier, customer, posting status, and due date
  - shipment by customer and customer PO

## Remaining Gaps

- No migration runner is wired up yet.
- No dedicated inventory balance table is created; reporting must derive balances from transactions.
- No trigger-based audit framework exists yet; `audit_logs` is the manual ledger for now.
- No separate line-balance or pick-confirmation workflow has been modeled beyond the header/line tables.
- No formal route editor or route version lifecycle exists outside the route tables.
- No bank, cash, payroll, fixed-asset, or consolidation subledger is modeled yet.
- No WMS reservation allocation table or scheduler queue is modeled yet.
- No dedicated CRM contact history table is modeled yet beyond campaign leads and customer service tickets.
