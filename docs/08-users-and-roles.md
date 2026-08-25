# Users and Roles

## Admin

Responsibilities:
- Maintain users, roles, permissions, factory settings, and coding rules
- View audit logs and module access configuration

Dependency note:
- The UI already expects permission keys from the auth layer.
- Audit logging still needs a dedicated backend table and API.

## Management

Responsibilities:
- View factory dashboard
- View delivery, output, quality, OEE, inventory, and cost reports
- Approve major exceptions if required

## PMC / Production Planning

Responsibilities:
- Maintain customer PO demand
- Create and release work orders
- Assign production lines and due dates
- Track delivery risk

## Warehouse

Responsibilities:
- Receive supplier materials
- Print and scan material labels
- Put away to storage or smart shelf
- Pick by work order
- Issue material to SMT line
- Handle line returns, scrap, and stock adjustment

## IQC

Responsibilities:
- Inspect incoming materials
- Mark material lot as accepted, rejected, or hold
- Record inspection result and defect reason

## SMT Operator

Responsibilities:
- Start production run
- Scan work order, PCB SN, material reel, feeder, and station
- Follow setup and anti-error checks
- Report output, downtime, and abnormal events

## Engineering

Responsibilities:
- Maintain process route and machine programs
- Confirm first article when required
- Analyze production and quality abnormalities

## Quality

Responsibilities:
- Manage SPI, AOI, ICT, visual inspection, repair, and re-inspection
- Create and close quality issues
- Maintain defect codes
- Analyze yield and defect trends

## Finance / Cost

Responsibilities:
- View material consumption by work order
- View stock value and scrap
- Reconcile work order usage and finished goods

## Finance / Accounting

Responsibilities:
- Maintain chart of accounts, cost centers, profit centers, fiscal periods, currencies, exchange rates, and tax codes
- Post AP/AR references tied to suppliers, customers, shipments, and POs
- Review inventory valuation and work order cost accumulation
- Close periods and keep audit-visible posting history

Key screens:
- GL accounts
- Journal entries
- AP invoices
- AR invoices
- Shipment billing
- Cost center setup
