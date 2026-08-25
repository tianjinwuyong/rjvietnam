# Master Data

Master data must be stable before transactional modules are built. Bad master data will break work orders, picking, production checks, and traceability.

## Roles And Permissions

Tables:
- `roles`
- `permissions`
- `role_permissions`
- `users`

This is the minimum admin layer needed for the MVP audit trail and module gating.

## Customer

Tables:
- `customers`
- `customer_pos`
- `customer_po_lines`

Fields:
- Customer code
- Customer name
- Short name
- Contact name
- Contact phone
- Delivery address
- Status

Used by:
- Customer PO
- Delivery plan
- Shipment
- Reports

Lifecycle:

`DRAFT -> PENDING_APPROVAL -> ACTIVE -> ON_HOLD -> ACTIVE`

Rejected drafts may be corrected and resubmitted. Records with completed business
transactions are archived rather than physically deleted. Every create, edit, approval,
freeze, reactivation, and archive event is immutable in `erp_customer_audit`.

SMT customer control also requires:

- Customer part number to internal product mapping
- Customer drawing/specification and revision
- PPAP/sample approval status where required
- PCN/ECN notification rules and effective dates
- Customer-specific traceability, test-data retention, packaging, and label rules
- Complaint/RMA linkage to lot, pallet, box, motherboard, and daughter SN
- 8D/CAPA containment, root cause, corrective action, verification, and closure
- Customer satisfaction, on-time delivery, PPM, return, and complaint metrics

Implemented governance tables:

- `erp_customer_governance`
- `erp_customer_audit`

Only an `ACTIVE` customer is selectable when creating a Customer PO. A customer with
open business cannot be frozen, archived, or deleted.

## Supplier

Tables:
- `suppliers`
- `receiving_orders`
- `receiving_order_lines`

Fields:
- Supplier code
- Supplier name
- Short name
- Contact name
- Contact phone
- Status

Used by:
- Receiving
- IQC
- Supplier quality reports

## Product

Tables:
- `products`
- `process_routes`
- `process_route_steps`
- `work_orders`

Fields:
- Product number
- Product model
- Customer
- Product type
- Revision
- Default route
- Status

Used by:
- Customer PO
- Work order
- BOM
- Traceability
- Shipment

## Material

Tables:
- `materials`
- `material_lots`
- `inventory_transactions`

Fields:
- Material number
- Material name
- Specification
- Unit
- Package type
- MSL level if applicable
- Shelf life if applicable
- Status

Used by:
- BOM
- Receiving
- Inventory
- Picking
- Feeder setup
- Material traceability

## BOM

Tables:
- `boms`
- `bom_lines`

Fields:
- Product number
- Product revision
- Material number
- Quantity per board
- Position reference
- Substitute group
- Effective date
- Status

Used by:
- Work order material demand
- WMS picking
- SMT feeder setup
- Material anti-error check
- Cost and consumption reports

## Process Route

Tables:
- `process_routes`
- `process_route_steps`

Fields:
- Route code
- Product number
- Step sequence
- Station code
- Required scan
- Required inspection
- Output rule

Example route:

```text
Print solder paste -> SPI -> SMT placement -> Reflow -> AOI -> ICT -> Visual -> Packing
```

## Line / Station / Machine

Tables:
- `production_lines`
- `stations`
- `machines`

Line fields:
- Line code
- Line name
- Line type
- Status

Station fields:
- Station code
- Station name
- Station type
- Line code
- Scan required

Machine fields:
- Machine code
- Machine name
- Station code
- Vendor
- Model
- Status

## Equipment

Tables:
- `equipment_categories`
- `equipment_models`
- `equipment_locations`
- `equipment_status_codes`
- `equipment_assets`
- `equipment_spare_parts`
- `maintenance_plans`
- `maintenance_plan_steps`
- `maintenance_plan_assignments`

Transactional tables:
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

Used by:
- MES line execution
- Equipment maintenance
- Downtime management
- Calibration control
- Traceability
- Quality support

## Defect Code

Table:
- `defect_codes`

Fields:
- Defect code
- Defect name
- Defect category
- Station type
- Severity
- Status

Used by:
- AOI
- ICT
- Visual inspection
- Repair
- Quality reports

## Finance

Tables:
- `currencies`
- `fiscal_periods`
- `gl_accounts`
- `cost_centers`
- `profit_centers`
- `tax_codes`
- `exchange_rates`
- `customer_contacts`
- `supplier_contacts`
- `shipments`
- `shipment_lines`
- `ap_invoices`
- `ap_invoice_lines`
- `ar_invoices`
- `ar_invoice_lines`
- `inventory_cost_layers`
- `work_order_cost_summaries`
- `gl_journal_entries`
- `gl_journal_lines`

Fields:
- Account code
- Cost center / profit center code
- Period code
- Currency code
- Tax code
- Invoice reference
- Shipment reference
- Posting status

Used by:
- Billing
- AP/AR
- Costing
- Inventory valuation
- Reporting
