# Data Model

## Core Traceability Chain

```text
customer_po_line
  -> work_order
  -> pick_order
  -> line_issue_order
  -> feeder_binding
  -> pcb_serial
  -> station_event
  -> quality_inspection
  -> repair_record
```

## Material Traceability Chain

```text
receiving_order
  -> receiving_order_line
  -> material_lot
  -> iqc_inspection
  -> inventory_transaction
  -> pick_order
  -> line_issue_order
  -> feeder_binding
  -> work_order
```

## Inventory Source Of Truth

```text
inventory_transaction
```

Inventory is derived from transaction history. The schema intentionally avoids a single mutable stock balance as the authoritative value.

## Production Source Of Truth

```text
work_order -> station_event -> quality_inspection -> repair_record
```

`traceability_events` mirrors the same references in a query-friendly ledger so operators can search by PO, work order, PCB SN, reel, or station without reconstructing the entire chain from scratch.

## Finance Source Of Truth

```text
shipments -> ar_invoices -> gl_journal_entries
receiving_orders -> ap_invoices -> gl_journal_entries
work_orders -> work_order_cost_summaries -> gl_journal_entries
inventory_transactions -> inventory_cost_layers -> gl_journal_entries
```

Finance balances are derived from the ledger, invoices, shipment references, and cost summaries. The schema avoids a single mutable accounting balance as the authoritative value.

See [15-data-contract-map.md](./15-data-contract-map.md) for the screen-to-API-to-table mapping and the current contract gaps.
