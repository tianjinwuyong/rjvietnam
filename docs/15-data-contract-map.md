# Data Contract Map

This document is the contract layer between the UI and the persisted factory data.

Rules:
- UI and scanner flows send business codes first, not raw foreign keys.
- API resolves business codes to database IDs before persistence.
- Read DTOs may include both IDs and codes so the UI can display and drill down without extra joins.
- Derived fields must be marked as derived; they are not separate source-of-truth columns.
- No hard delete for operational records. Use status, closed, or voided style lifecycle fields.

## Contract Files

- `services/api/openapi.yaml` - route inventory and public API summary
- `packages/shared-types/src/contracts.ts` - request/response DTOs
- `packages/validators/src/index.ts` - boundary validation helpers
- `docs/03-data-model.md` - source-of-truth notes
- `docs/04-api-design.md` - API conventions

## Shared DTO Groups

- Admin: `UserDto`, `RoleDto`, `PermissionDto`, `CreateUserRequest`, `UpsertRoleRequest`
- ERP: `CustomerDto`, `SupplierDto`, `ProductDto`, `MaterialDto`, `BomDto`, `CustomerPoDto`, `CreateCustomerPoRequest`
- PMC: `WorkOrderDto`, `CreateWorkOrderRequest`, `ReleaseWorkOrderRequest`
- WMS: `MaterialLotDto`, `InventoryTransactionDto`, `ReceiveMaterialRequest`, `PutAwayRequest`, `ReserveMaterialRequest`, `PickMaterialRequest`, `IssueToLineRequest`, `ReturnFromLineRequest`, `ScrapMaterialRequest`
- MES: `FeederBindingDto`, `BindFeederRequest`, `PcbSerialDto`, `StationEventDto`, `CreateStationEventRequest`
- Quality: `QualityInspectionDto`, `CreateInspectionRequest`, `RepairRecordDto`, `CreateRepairRequest`
- Traceability: `TraceEventDto`, `TraceabilityQueryRequest`, `TraceabilityQueryResponse`
- Reports: `ReportQueryRequest`, `ReportCardDto`
- Finance: `GlAccountDto`, `CostCenterDto`, `ProfitCenterDto`, `JournalEntryDto`, `ApInvoiceDto`, `ArInvoiceDto`, `ShipmentDto`, `WorkOrderCostSummaryDto`

## UI Screen -> API -> DB Map

| UI screen | API contract | DTOs / payloads | Persisted tables / records |
| --- | --- | --- | --- |
| Login / admin shell | `GET /admin/users`, `GET /admin/roles`, `GET /admin/audit-logs` | `UserDto`, `RoleDto`, `PermissionDto`, `CreateUserRequest`, `UpsertRoleRequest` | `users`, `roles` |
| Customer PO | `GET /erp/customer-pos`, `POST /erp/customer-pos` | `CustomerPoDto`, `CreateCustomerPoRequest` | `customer_pos`, lookup joins to `customers`, `products` |
| Work order list / release | `GET /pmc/work-orders`, `POST /pmc/work-orders`, `PATCH /pmc/work-orders/{code}` | `WorkOrderDto`, `CreateWorkOrderRequest`, `ReleaseWorkOrderRequest` | `work_orders`, `work_order_serial_counters`, lookup joins to `customer_pos`, `products`, `production_lines` |
| Material receiving | `GET /wms/material-lots`, `POST /wms/transactions` with `action=RECEIVE` | `ReceiveMaterialRequest`, `MaterialLotDto`, `InventoryTransactionDto` | `material_lots`, `inventory_transactions`, lookup joins to `materials`, `suppliers`, `storage_locations` |
| IQC | `POST /quality/inspections` with `stationType=IQC` | `CreateInspectionRequest`, `QualityInspectionDto` | `quality_inspections`, update to `material_lots.iqc_status`, trace events |
| Storage / put-away | `GET /wms/storage-locations`, `POST /wms/transactions` with `action=PUT_AWAY` | `PutAwayRequest`, `InventoryTransactionDto`, `MaterialLotDto` | `inventory_transactions`; current lot location is derived from transaction history |
| Pick by work order | `POST /wms/transactions` with `action=RESERVE` or `action=PICK` | `ReserveMaterialRequest`, `PickMaterialRequest`, `InventoryTransactionDto` | `inventory_transactions`, `work_orders`, `material_lots.reservedQty` projection |
| Issue to SMT line | `POST /wms/transactions` with `action=ISSUE_TO_LINE` | `IssueToLineRequest`, `InventoryTransactionDto` | `inventory_transactions`, `work_orders`, line location movement records |
| Line return / scrap | `POST /wms/transactions` with `action=RETURN_FROM_LINE` or `action=SCRAP` | `ReturnFromLineRequest`, `ScrapMaterialRequest`, `InventoryTransactionDto` | `inventory_transactions`, `material_lots`, trace records |
| Feeder binding | `GET /mes/runs`, `POST /mes/events` with feeder-binding payload | `BindFeederRequest`, `FeederBindingDto` | `feeder_bindings`, lookup joins to `work_orders`, `production_lines`, `machines`, `material_lots` |
| Station scan / event | `GET /mes/events`, `POST /mes/events` with station payload | `CreateStationEventRequest`, `StationEventDto`, `PcbSerialDto` | `pcb_serials`, `station_events`, lookup joins to `stations`, `machines`, `work_orders` |
| SPI / AOI / ICT / visual inspection | `POST /quality/inspections` | `CreateInspectionRequest`, `QualityInspectionDto` | `quality_inspections`, `defect_codes`, trace records |
| Repair / re-inspection | `POST /quality/repairs` | `CreateRepairRequest`, `RepairRecordDto` | `repair_records`, lookup joins to `quality_inspections`, `defect_codes` |
| Traceability query | `GET /traceability/{traceKey}` | `TraceabilityQueryRequest`, `TraceabilityQueryResponse`, `TraceEventDto` | `traceability_events` plus joins across PO, WO, lot, binding, station, inspection, repair records |
| Reports | `GET /reports/*` | `ReportQueryRequest`, `ReportCardDto`, `ApiPageResponse<T>` | derived read models from transactional tables; no dedicated source-of-truth table yet |
| Finance / accounting | `GET /finance/accounts`, `GET /finance/journal-entries`, `GET /finance/ap-invoices`, `GET /finance/ar-invoices`, `GET /finance/shipments` | `GlAccountDto`, `CostCenterDto`, `ProfitCenterDto`, `JournalEntryDto`, `ApInvoiceDto`, `ArInvoiceDto`, `ShipmentDto`, `WorkOrderCostSummaryDto` | `gl_accounts`, `cost_centers`, `profit_centers`, `fiscal_periods`, `exchange_rates`, `tax_codes`, `shipments`, `shipment_lines`, `ap_invoices`, `ar_invoices`, `gl_journal_entries`, `gl_journal_lines`, `inventory_cost_layers`, `work_order_cost_summaries` |

## Mapping Notes

- Customer PO is persisted in `customer_pos`; UI may still surface `customerCode` and `productCode` because those are stable business keys.
- Work order code generation is owned by `work_order_serial_counters` and `work_orders.code`.
- `material_lots` stores receipt identity and IQC state. Current location and on-hand quantity are projections from inventory transactions, not separate source-of-truth balances.
- `inventory_transactions` is the audit trail for every material movement. Any UI action that changes stock should end with one transaction record.
- `feeder_bindings`, `station_events`, `quality_inspections`, and `repair_records` are event tables. They should append, not overwrite, for normal flow.
- `traceability_events` is the cross-module search index for PO, WO, lot, reel, PCB, station, and shipment history.

## Unresolved Contract Gaps

- `material_lots.reservedQty` is still a contract field, but the schema does not persist it directly.
- Current lot location remains a derived projection from inventory history, not a single authoritative balance field.
- `station_events` and `quality_inspections` currently rely on lookup joins for full operator and machine names; the schema stores IDs only.
- Bank, cash, payroll, fixed-asset, and consolidation subledgers remain intentionally deferred.
