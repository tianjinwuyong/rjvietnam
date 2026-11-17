# Whole-factory management system

## Management principle

Run the factory with a small accountable human organization, role-based Unified PDA execution, deterministic business rules, virtual employees for monitoring and preparation, and human approval for exceptions. Every material, PO, work order, PCB SN, inspection, defect, approval and inventory movement must remain traceable.

## Factory command structure

- Factory director
  - Planning and customer delivery
  - Purchasing and supplier management
  - Warehouse and material control
  - Quality and engineering
  - Production operations
  - Equipment and maintenance
  - Finance, HR and administration

Department managers own decisions and exceptions. Operators execute physical work. Virtual employees prepare data, monitor queues, calculate rules, detect conflicts and route exceptions.

## Core systems

### ERP and commercial control

- Customer, supplier, product and material master data.
- Sales orders, purchase orders, pricing, contracts and invoices.
- Three-way matching: PO, receiving and supplier invoice.
- Approval and audit trail.

### PMC planning

- Demand, customer PO and delivery commitment.
- MPS/MRP, material readiness and shortage calculation.
- Work-order creation, line assignment and schedule simulation.
- Supplier completion and inbound ETA integration.

### Supplier portal and SRM

- Registered supplier accounts and controlled access.
- PO acknowledgement, adjustment requests and approval.
- Production completion, box/sub-box labels and shipment plans.
- Driver, carrier, pallet/hidden-pallet and logistics tracking.
- Receiving/IQC feedback, rejection reason and image evidence.
- Supplier KPI, quality history and corrective action.

### WMS

- Supplier pre-receiving and PDA/OCR label capture.
- Material identity, Ruijing/Vietnam SN and MSL mapping.
- Box QR generation and printing.
- Hidden pallet grouping, position binding and put-away.
- Inventory, FIFO/FEFO, transfer, count and expiry control.
- Material issue, return, production inbound/outbound and traceability.
- Dynamic IQC task generation and moisture-sensitive control.

### QMS / IQC

- ACTIVE Excel-controlled inspection standards.
- Supplier/material inspection history.
- Normal, tightened, reduced and exemption governance.
- Dynamic sample size, Ac/Re and PDA inspection items.
- Photo, tester, measurement and human evidence.
- PASS, FAIL, hold, rejection, MRB, rework and release loops.
- SPC, audits, complaints, 8D, supplier evaluation and quality cost.

### MES

- Work-order release and station routing.
- PCB/product SN genealogy.
- Material loading, feeder/location binding and consumption.
- Station results, test data, repair, NG and exemption control.
- WIP, line status, completion and finished-goods handover.

### Equipment and maintenance

- Equipment registry, status, alarm and downtime.
- Preventive maintenance, repair, spare parts and calibration.
- OEE inputs and station availability.

### Finance, HR and administration

- Cost, invoice, payment and scrap approval.
- Employee, role, shift, attendance, training and qualification.
- OA workflow, documents, notices and approval delegation.

## Human operating organization

- One responsible manager per business domain.
- Multi-skilled operators execute adjacent normal tasks where safe.
- Quality decisions remain independent from receiving and production.
- Supervisors act by exception rather than approving every normal transaction.
- Role separation is enforced by permissions and audit records, not unnecessary headcount.

## Virtual employee organization

- PMC-VIRTUAL-01: demand, readiness, shortage and schedule monitoring.
- PURCHASING-VIRTUAL-01: PO acknowledgement, supplier delay and variance monitoring.
- WMS-RECEIVING-VIRTUAL-01: receiving validation, QR, MSL and location preparation.
- IQC-VIRTUAL-01: history, sample plan, dynamic inspection and evidence validation.
- MES-VIRTUAL-01: work-order, station, WIP and traceability monitoring.
- QUALITY-VIRTUAL-01: defect trends, MRB/8D routing and overdue follow-up.
- MAINTENANCE-VIRTUAL-01: alarm, PM, downtime and spare-parts monitoring.
- FINANCE-VIRTUAL-01: matching exceptions, cost anomalies and approval preparation.

Virtual employees may recommend and prepare actions. They cannot fabricate evidence, overwrite authoritative records, release blocked inventory, approve exemption, change financial authority or bypass human gates.

## Unified PDA

Unified PDA is the Kotlin Android application at `C:\Users\tianj\Desktop\越南工厂瑞晶\统一PDA管理\unifiedpda`.

It provides role-based workspaces for receiving, warehouse, IQC, material loading, production, maintenance, supervisors and managers. WMS/MES/QMS dynamically send the current task and required fields. PDA captures scans, photos, quantities, measurements and confirmations and synchronizes them to authoritative services.

## End-to-end material loop

1. Customer demand creates planning requirements.
2. PMC calculates material demand and purchasing requirements.
3. Purchasing issues PO; supplier portal confirms delivery.
4. Supplier generates compliant box/sub-box labels and pre-receiving data.
5. WMS receiving validates PO, material, SN, quantity and MSL.
6. WMS prints internal QR and binds the physical warehouse position.
7. IQC virtual employee generates a dynamic inspection task.
8. Unified PDA executes the sample inspection and captures evidence.
9. QMS determines PASS/FAIL through approved rules and human gates.
10. Released material enters inventory and is allocated to work orders.
11. MES binds material to station/PCB SN and records consumption.
12. Finished goods return to WMS and are shipped against customer demand.
13. Supplier, quality, production and finance records close the loop.

## Governance

- PostgreSQL/business services are authoritative; browser and PDA are clients.
- Every state change records actor, role, timestamp, source device and reason.
- Rule versions are immutable and only one approved version is ACTIVE.
- Automatic actions must be idempotent and replayable.
- Offline PDA work is queued with conflict detection and reconciliation.
- Dashboards show current state; event ledgers preserve history.
- Alerts are routed only to the role that can resolve them.

## Delivery sequence

1. Stabilize master data, authentication, permissions and audit events.
2. Close supplier PO → receiving → IQC → inventory.
3. Close inventory → material loading → MES consumption → traceability.
4. Close defect → MRB/rework/rejection → supplier feedback.
5. Add planning, equipment, finance and HR exception automation.
6. Add plant command dashboards after source transactions are reliable.
