# Agent Guidance: Vietnam SMT Factory Integrated Management System

## Mission

Build one integrated management system for the new manufacturing factory in Vietnam. The system must support the full operating flow of an SMT-based electronics factory, from customer demand to shipment, with strong traceability, material control, production execution, quality closure, and management reporting.

This is not a collection of separate ERP, WMS, MES, and Quality tools. It is one unified factory platform with shared master data, shared permissions, shared transaction records, and one traceability chain.

## Language Strategy

The system must support Chinese, English, and Vietnamese.

Primary language requirements:
- Chinese: used by China-side management, engineering, and some factory leaders.
- Vietnamese: used by local Vietnam operators, warehouse staff, and production staff.
- English: used for customer-facing fields, cross-border management, supplier/customer documents, and technical integrations.

Implementation rules:
- All UI text must use i18n keys, not hard-coded display text.
- Database business codes must be language-neutral.
- Master data should support multilingual names where useful.
- Reports should be exportable in Chinese, English, and Vietnamese where possible.
- Operator screens should use short, clear Vietnamese labels first, with Chinese/English available by user preference.
- Technical logs may use English keys, but user-facing error messages must be translatable.

Recommended language fields:

```text
name_zh
name_en
name_vi
description_zh
description_en
description_vi
```

Recommended locale codes:

```text
zh-CN
en-US
vi-VN
```

## Factory Scope

The system should cover:

- Customer PO and product data
- BOM and material master
- Production planning and work orders
- Warehouse receiving, IQC status, storage, picking, and line issue
- Smart shelf control
- SMT production execution
- Feeder and material reel binding
- SPI, AOI, ICT, visual inspection, repair, and rework
- PCB serial number traceability
- Finished goods and shipment
- Production, inventory, quality, delivery, and OEE reports
- Users, roles, permissions, audit logs, and factory settings

## Core Business Modules

### ERP / Business

Purpose: manage customer demand and commercial master data.

Functions:
- Customer master
- Supplier master
- Product master
- BOM
- Customer PO
- Delivery plan

### PMC / Planning

Purpose: convert customer demand into executable production plans.

Functions:
- Work order creation
- 11-digit work order code generation
- Production schedule
- Line assignment
- Work order release
- Delivery risk tracking

### WMS / Warehouse

Purpose: control material and finished goods movement.

Functions:
- Material receiving
- Label printing
- IQC hold/release
- Storage location
- Smart shelf control
- Picking by work order
- Issue to SMT line
- Return from line
- Scrap and stock adjustment
- Finished goods storage

### MES / SMT Production

Purpose: control and record shop-floor execution.

Functions:
- Work order start/stop
- SMT line setup
- Feeder setup
- Material reel binding
- Material anti-error check
- First article confirmation
- Production output
- WIP tracking
- Downtime and abnormal event records

### Quality

Purpose: manage inspection, defect, repair, and abnormal closure.

Functions:
- IQC inspection
- SPI result
- AOI result
- ICT result
- Visual inspection
- Defect records
- Repair/rework records
- Re-inspection
- CAPA / abnormal closure

### Traceability

Purpose: answer what happened to any PO, work order, PCB, material reel, or shipment.

Trace chain:

```text
Customer PO
  -> Work Order
  -> PCB Serial Number
  -> Station Event
  -> Machine / Operator / Time
  -> Material Reel / Feeder
  -> Inspection Result
  -> Repair Record
  -> Finished Goods
  -> Shipment
```

### Reports

Purpose: give management clear operating visibility.

Reports:
- Work order progress
- Production output
- Yield and defect Pareto
- OEE and downtime
- Inventory balance
- Material usage
- WIP
- Delivery risk
- Quality loss
- Supplier quality

### Admin

Purpose: maintain security and factory configuration.

Functions:
- Users
- Roles
- Permissions
- Menu access
- Factory calendar
- Shift definitions
- Coding rules
- Audit logs

## User Groups

The system must serve different user groups with role-based screens.

- Management: dashboard, reports, approvals, delivery and quality overview
- PMC: PO, work order, schedule, delivery tracking
- Warehouse: receiving, put-away, picking, issue, return, inventory
- IQC: incoming inspection and supplier quality
- SMT operators: line start, feeder scan, PCB scan, output, downtime
- Engineering: process route, first article, abnormal analysis
- Quality: inspection, defect, repair, closure, yield analysis
- Finance/cost: inventory value, material consumption, work order cost
- Admin: users, permissions, settings

## Work Order Coding Rule

Use the factory work order coding rule from `dc/工单编码规则.doc`.

Format:

```text
YY + MM + work_order_type + line_code + serial_no
```

Total length: 11 digits.

Fields:
- `YY`: last two digits of year
- `MM`: month, 01-12
- `work_order_type`: 1 mass production, 2 sample/trial, 3 rework/repair
- `line_code`: 2-digit production line code
- `serial_no`: 4-digit monthly serial number

Rules:
- Numeric only
- No customer, product model, day, letters, or symbols in the work order code
- Serial number resets by month, work order type, and line
- Voided codes are preserved and never reused
- Emergency orders use the next available serial number

Important note:
- If line master data uses internal codes like `L001`, keep those as internal line IDs.
- The work order code should still use the 2-digit numeric line code, such as `01`, `02`, or `99`.

## Master Data Principles

Master data must be designed before transaction screens.

Required master data:
- Customers
- Suppliers
- Products
- Materials
- BOM
- Process routes
- Lines
- Stations
- Machines
- Storage locations
- Smart shelves
- Shifts
- Users
- Roles
- Defect codes
- Coding rules

Rules:
- Use stable business codes.
- Do not encode changing business meaning into primary keys.
- Keep multilingual display names separate from business codes.
- All downstream transactions must reference master data IDs/codes.

## Transaction Principles

All important factory actions must create transaction records.

Inventory:
- Receiving creates material lot and inventory transaction.
- Put-away changes location through transaction.
- Picking reserves or moves stock by work order.
- Issue to line records material consumption responsibility.
- Return and scrap must be traceable.

Production:
- Work order release starts MES availability.
- Line start creates production run.
- Feeder binding links material reel to line, machine, feeder, and work order.
- Station scan creates station event.
- Output creates production output record.

Quality:
- Inspection creates inspection result.
- Defect creates quality issue.
- Repair creates repair record.
- Re-inspection closes or continues the quality loop.

Traceability:
- Traceability must be written during normal transactions.
- Do not try to reconstruct traceability only from reports later.

## System Architecture Guidance

Recommended structure:

```text
smt-factory-system/
  apps/
    web/
    scanner-terminal/
    display-board/
  services/
    api/
    worker/
    realtime/
  packages/
    shared-types/
    business-rules/
    validators/
    ui-kit/
  database/
    migrations/
    seeds/
  integrations/
    barcode-scanner/
    label-printer/
    smart-shelf/
    spi/
    aoi/
    ict/
    smt-machine/
  docs/
  operations/
  tests/
```

Recommended technical direction:
- Browser-based web application for office users
- Scanner/tablet optimized web app for operators
- Backend API with clear module boundaries
- PostgreSQL or MySQL database
- Realtime channel for line status and dashboard updates
- Background worker for imports, reports, and scheduled checks

## UI / UX Guidance

The UI must be practical for factory operations.

General rules:
- Do not build a marketing-style landing page.
- First screen should be a useful dashboard or working module.
- Use dense but readable operational layouts.
- Support barcode-first workflows.
- Operator screens need large controls and clear pass/fail states.
- Avoid unnecessary decoration.
- Tables must be scannable and filterable.
- Critical status colors must be consistent.
- Chinese, English, and Vietnamese text must fit without overlap.

Important screens:
- Factory dashboard
- Work order list
- Production schedule
- Material receiving
- IQC inspection
- Inventory and storage
- Pick by work order
- Issue to line
- SMT line execution
- Feeder setup
- First article
- AOI/SPI/ICT records
- Repair
- Traceability query
- Reports
- Admin settings

## Integration Guidance

Integrations should be adapters, not business logic containers.

Planned integrations:
- Barcode scanner
- Label printer
- Smart shelf
- SPI import
- AOI import
- ICT import
- SMT machine output import

Rules:
- Convert device data into standard internal API commands.
- Keep raw import files or raw payloads for audit where practical.
- Normalize imported machine results into inspection and traceability tables.
- Device failure must not corrupt core transaction data.

## Data and Audit Requirements

The factory system must preserve reliable history.

Rules:
- Do not hard-delete operational records.
- Use status fields for cancelled, voided, closed, or scrapped records.
- Keep created_by, created_at, updated_by, updated_at where useful.
- Keep operator, machine, station, and timestamp for production events.
- Inventory balance must be derived from auditable transactions.
- Traceability records must remain available after work order closure.

## MVP Priority

The first build should prove one complete factory flow:

```text
Customer PO
  -> Work Order
  -> Material Receiving
  -> IQC
  -> Storage
  -> Picking
  -> Issue to SMT Line
  -> Feeder Binding
  -> SMT Production
  -> Inspection
  -> Repair if needed
  -> Traceability Query
```

Build order:
1. Master data and permissions
2. PO and work order coding
3. WMS receiving, IQC, inventory, picking, line issue
4. MES line execution, feeder binding, output, WIP
5. Quality inspection, defect, repair
6. Traceability query
7. Reports and integrations

## Engineering Standards

When building the system:
- Prefer clear module boundaries over clever abstractions.
- Keep business rules in shared packages when frontend and backend both need them.
- Use database migrations from the beginning.
- Add test data for realistic SMT workflows.
- Use typed API contracts.
- Keep scanner workflows fast and resilient.
- Validate codes and scans at API boundaries.
- Write tests for work order coding, inventory transactions, material binding, and traceability.

## Non-Goals for the First Version

Do not build these first unless the user explicitly changes priority:
- Full financial accounting
- Payroll and HR
- Advanced APS optimization
- Native mobile apps
- Complex multi-factory group control
- Deep proprietary machine protocol integration

Design room for them, but keep the MVP focused on factory execution and traceability.

