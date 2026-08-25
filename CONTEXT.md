# Factory Order Fulfilment

This context describes the commercial and operational lifecycle from a customer's confirmed demand through production, delivery, settlement, acceptance, and final closure.

## Language

**Customer PO**:
A customer's confirmed demand for a product quantity and delivery date. It is the commercial root of linked production, shipment, billing, and closure records.
_Avoid_: Work order, sales task

**Work Order**:
An authorized production quantity created from an open Customer PO and assigned to a production line.
_Avoid_: Customer order, PO

**Closure Gate**:
A mandatory, auditable condition that must pass before a Customer PO may be closed. System-computed gates cannot be manually forced to pass.
_Avoid_: Checklist item, optional approval

**Customer Acceptance**:
Evidence that the customer accepted the delivered goods. It is the only closure gate completed directly from approved external evidence.
_Avoid_: Shipment confirmation, internal quality release

**PO Closure**:
The terminal state reached only after production, quality release, shipment, financial settlement, and customer acceptance are complete.
_Avoid_: Deletion, cancellation

**System Gate**:
A closure gate derived from canonical operational records such as work orders, OQC, shipments, invoices, and payments.
_Avoid_: Manual override

**Manual Hold**:
An authorized decision that blocks closure despite an otherwise passing system gate.
_Avoid_: Manual pass, system override

**Shipment Balance**:
The completed but not yet shipped quantity of a specific Work Order.
_Avoid_: PO balance

**Unbilled Shipment Quantity**:
The posted shipment quantity not yet represented by an AR invoice.
_Avoid_: Available inventory, outstanding payment

**Financial Settlement**:
The state in which every PO-linked receivable is posted, fully paid, and has no outstanding amount.
_Avoid_: Invoice creation, payment promise

**Customer Master**:
The governed identity used by customer requirements, Customer POs, shipments, receivables, complaints, and traceability. It is not a free-text PO field.
_Avoid_: Contact, PO customer text

**Customer Lifecycle**:
The controlled states DRAFT, PENDING_APPROVAL, ACTIVE, ON_HOLD, REJECTED, and ARCHIVED. Only ACTIVE customers may start new business transactions.
_Avoid_: UI visibility flag

**Customer Product Profile**:
The mapping between a customer's part number/specification and the factory Product, including revision, PPAP/approval status, traceability, packaging, labelling, and change-notification requirements.
_Avoid_: BOM, Product Master

**Customer Complaint**:
A customer-reported nonconformity linked to product and traceability evidence, controlled through containment, root cause, corrective action, verification, and closure.
_Avoid_: Internal NG, service note
## Procurement closed-loop language

- **Purchase Requisition (PR)**: an internal, line-item demand that must be submitted before sourcing begins.
- **RFQ**: a supplier-facing request for quotation created from one submitted PR.
- **Supplier Quote**: a versioned commercial response to an RFQ. It never changes the PR by itself.
- **Quote Comparison**: the traceable price, delivery, quality, and commercial-term evaluation used to select a supplier.
- **Award**: the explicit sourcing decision that selects one quote and permits PO creation.
- **Purchase Order (PO)**: the commercial order created from an awarded quote. Its lifecycle is draft, sent, acknowledged, partially received, received, closed, or cancelled.
- **Three-Way Match**: PO ordered quantities/values, WMS received quantities, and the supplier AP invoice must agree before financial closure.
- **Procurement Closure**: the final PO transition allowed only after supplier acknowledgement, complete receipt, IQC release, three-way match, and payment settlement.
- WMS owns physical receipt and stock; QMS/IQC owns quality disposition; Finance owns invoice posting and payment; Procurement owns PR, sourcing, award, PO, and closure decisions.
- Every procurement transition is immutable in `procurement_action_history`; operational rows hold current state, history rows hold who did what and when.
