# MVP Scope

The first version should prove the full factory data flow with the smallest complete set of functions.

## MVP Goal

Track one customer PO from work order creation through material issue, SMT production, inspection, and traceability query.

## Included in MVP

### Admin
- Login placeholder
- Users and roles model
- Basic permission structure
- Audit log foundation

### Master Data
- Customers
- Suppliers
- Products
- Materials
- BOM
- Process routes
- Lines
- Stations
- Defect codes

### PMC
- Customer PO
- Customer PO line
- Work order creation
- 11-digit work order code generation
- Work order release
- Work order status

### WMS
- Material receiving
- Material lot / Reel ID
- IQC status
- Inventory location
- Pick by work order
- Issue to SMT line
- Line return
- Transaction history

### MES
- Start production run
- Feeder and reel binding
- First article confirmation status
- Output reporting
- Station event recording

### Quality
- AOI/ICT/manual inspection record
- Defect record
- Repair record
- Re-inspection result

### Traceability
- Query by work order
- Query by PCB SN
- Query by material reel
- Show complete chain from PO to inspection
- Query by PO line and event ledger

### Reports
- Work order progress
- Inventory balance
- Material consumption
- Yield by work order

## Not Included in MVP

These should be designed but not implemented first:
- Full HR/payroll
- Advanced APS scheduling optimization
- Deep machine protocol integration
- Mobile native apps
- Multi-factory group management

Finance boundary for MVP:
- The schema supports GL masters, AP/AR references, shipment billing, and cost summaries.
- Cash management, bank reconciliation, payroll posting, fixed assets, and consolidation remain deferred.

## MVP Success Criteria

- A work order can be created using the factory coding rule.
- Materials can be received, inspected, stored, picked, and issued.
- SMT operator can bind reel to feeder and report output.
- Quality can record defects and repair.
- Manager can trace one PCB SN back to work order, PO, material reels, station history, and inspection results.
