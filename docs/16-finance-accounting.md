# Finance And Accounting

This system now treats finance as a first-class database area, but only at the level needed to support factory operations, billing references, valuation, and posting history.

## Minimum Supported Scope

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

## Key Relations

- Customer AR invoices can reference `customer_pos`, `shipments`, and `shipment_lines`.
- Supplier AP invoices can reference `receiving_orders` and `receiving_order_lines`.
- Cost summaries are attached to `work_orders` and post into the GL ledger.
- Inventory valuation is layer-based and derives from receipts and transaction history.
- Accounting postings are append-only through `gl_journal_entries` and `gl_journal_lines`.

## Deferred Boundaries

The following are intentionally not modeled as first-class tables yet:

- bank accounts and bank reconciliation
- cash management and treasury
- full fixed-asset accounting
- budget planning and variance workflow
- multi-entity consolidation
- tax filing workflows
- payroll posting details
- supplier/customer aging dashboards as stored source tables

## Contract Layer

The API and UI should read from the finance tables above, then derive reports and balances from the GL ledger, cost summaries, AP/AR invoices, shipment references, and inventory cost layers.
