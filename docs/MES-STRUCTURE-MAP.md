# MES Structure Map

MES converts a released Work Order into traceable Products. Its two primary management themes are **Product execution** and **NG closure**. The surrounding Level-3 structure follows ISA-95 Manufacturing Operations Management: production, quality, maintenance, and material/inventory operations, supported by security, configuration, documentation, and incident management. Pages, Agents, PDAs, and 3D views are clients or projections; they are not independent sources of production truth.

```mermaid
flowchart TB
    PMC["PMC<br/>Released Work Order + Route"] --> DM
    WMS["WMS<br/>Material release + inventory authority"] <--> MH
    QMS["QMS<br/>Quality standards + disposition authority"] <--> NG

    subgraph MES["MES Production Execution"]
        direction TB

        DM["Domain Management<br/>manual-line · SMT · auto-line<br/>owners · versions · policies"]
        PR["MES Process Registry<br/>process code · accepted facts<br/>domain guard · handoff contract"]
        PS["MES Process Supervisor<br/>contract · sequence · SLA<br/>handoff · closure evidence"]

        DM --> PR
        PR --> PS

        subgraph DOMAINS["Execution Domains"]
            direction LR
            MAN["Manual Line Processes<br/>Product route<br/>material loading<br/>material usage"]
            SMT["SMT Processes<br/>feeder loading<br/>machine consumption<br/>inspection facts"]
            AUTO["Auto Line Processes<br/>Product route<br/>equipment facts<br/>material usage"]
        end

        PR --> MAN
        PR --> SMT
        PR --> AUTO
        PS -. "supervises; never edits truth" .-> MAN
        PS -. "supervises; never edits truth" .-> SMT
        PS -. "supervises; never edits truth" .-> AUTO

        subgraph MOM["ISA-95 Level 3 — Manufacturing Operations Management"]
            direction LR
            POM["Production Operations<br/>dispatch · execute · track<br/>Product + Work Order"]
            QOM["Quality Operations<br/>inspection · NG · disposition<br/>repair + retest"]
            MOMM["Maintenance Operations<br/>asset condition · downtime<br/>maintenance handoff"]
            IOM["Material Operations<br/>loading · usage · return<br/>WMS reconciliation"]
        end

        MAN --> POM
        SMT --> POM
        AUTO --> POM

        subgraph CORE["MES Execution Core — Source of Production Truth"]
            direction LR
            WO["Production Run<br/>released WO + route revision"]
            PRODUCT["Product Aggregate Root<br/>PCBA SN · Shell SN<br/>properties · lifecycle"]
            ATT["Product Attendance<br/>expected station<br/>route position · completion"]
            GATE["Product Gate<br/>ALLOW · HOLD · REJECT<br/>REPAIR_ROUTE · COMPLETED"]
            BIND["Binding Relationships<br/>Product · case · pallet · QR"]
            MH["Material Execution<br/>loading + usage facts<br/>WO/Product attribution"]
            LEDGER["Execution Event Ledger<br/>immutable facts + decisions"]
        end

        POM --> WO
        WO --> PRODUCT
        PRODUCT --> ATT
        ATT --> GATE
        PRODUCT --> BIND
        PRODUCT --> MH
        GATE --> LEDGER
        BIND --> LEDGER
        MH --> LEDGER
        QOM --> NG
        MOMM --> LEDGER
        IOM --> MH

        subgraph QUALITY["NG and Repair Closed Loop"]
            direction LR
            NG["Confirmed NG<br/>permanent history"]
            RC["Repair Case<br/>dispatch · receipt · repair"]
            RET["Repair Return<br/>authorized station return"]
            RT["Retest Authorization<br/>PASS or repeat NG"]
            CLOSE["Closure<br/>revived · scrapped · destroyed"]
            NG --> RC --> RET --> RT --> CLOSE
            RT -->|"NG again"| NG
        end

        PRODUCT --> NG
        GATE -->|"active NG"| NG
        CLOSE --> ATT
        NG --> LEDGER
        CLOSE --> LEDGER

        subgraph CONTROL["Supporting Operations"]
            direction LR
            AUTH["Operator Auth<br/>roles + approvals"]
            ALARM["Alarm Lifecycle<br/>new event · ack · handle · close"]
            CFG["Versioned Configuration<br/>reason · owner · effective time"]
            SLA["SLA Clocks<br/>start · pause · breach · resolve"]
            DOC["Documentation + Evidence<br/>definitions · SOP · audit"]
            INCIDENT["Incident Management<br/>owner · action · escalation"]
        end
    end

    AGENT["Station Agents<br/>capture machine/scan facts"] --> GATE
    PDA["One PDA APK<br/>profiled modules<br/>machine → channel → feeder → material"] --> PR
    PR -->|"explicit process decision"| PDA
    GATE -->|"MES decision"| AGENT

    LEDGER --> TRACE["Traceability + Reports"]
    LEDGER --> PROJ["Read Projections<br/>dashboards · 3D · boards"]
    PS --> MGMT["MES Management<br/>process health · owners<br/>exceptions · closure"]

    AUTH -.-> GATE
    AUTH -.-> NG
    CFG -.-> DOMAINS
    SLA -.-> PS
    ALARM -.-> PS
    DOC -.-> LEDGER
    INCIDENT -.-> PS
```

## Management hierarchy

```text
MES
├─ Domain Management
│  ├─ Manual Line
│  ├─ SMT
│  └─ Auto Line
├─ Process Registry
│  ├─ process ownership
│  ├─ accepted Station Facts
│  ├─ domain guard
│  └─ WMS/QMS handoff contract
├─ Process Supervisor
│  ├─ sequence and state health
│  ├─ SLA and stuck-process detection
│  ├─ missing handoff detection
│  └─ evidence-backed closure checks
├─ Manufacturing Operations Management (ISA-95 Level 3)
│  ├─ Production Operations
│  ├─ Quality Operations
│  ├─ Maintenance Operations
│  └─ Material/Inventory Operations
├─ Product Execution
│  ├─ Product and typed identifiers
│  ├─ Product Attendance
│  ├─ Product Gate
│  ├─ bindings and containers
│  └─ material loading and usage facts
├─ NG and Repair
│  ├─ Confirmed NG
│  ├─ Repair Case
│  ├─ Repair Return
│  ├─ Retest Authorization
│  └─ revival, scrap, or destruction closure
└─ Evidence
   ├─ Execution Event Ledger
   ├─ traceability
   ├─ reports
   └─ read-only dashboards and 3D views
```

## Process contract

Every MES process must declare:

1. Process code and domain.
2. Business purpose and accountable owner.
3. Trigger and accepted Station Facts.
4. Required Work Order, Product, operator, station, device, host IP, event time, trace ID, and idempotency key.
5. Permitted decisions and state transitions.
6. NG and dependent-sequence behavior.
7. WMS/QMS/PMC handoffs and acknowledgements.
8. SLA, escalation, closure rule, and closure evidence.
9. Configuration version, reason, owner, and effective period.
10. Immutable audit and read projections.

## Non-negotiable ownership

- MES owns Product execution, route position, Product Gate decisions, production usage attribution, NG state, repair workflow, and closure.
- WMS owns physical material location and inventory balance.
- QMS owns quality standards and disposition authority.
- PMC owns Work Order release and production authorization.
- Station Agents and the PDA capture facts and execute acknowledged decisions; they do not redefine MES processes.
- The Process Supervisor detects and escalates problems but never silently changes production truth.

## Reference basis

- [ISA-95 Standard — Enterprise-Control System Integration](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard)
- [Siemens — ISA-95 framework and layers](https://www.siemens.com/en-us/technology/isa-95-framework-layers/)
- [MESA Smart Manufacturing Model](https://mesa.org/topics-resources/mesa-model/)

ISA-95 defines MES/MOM at Level 3 and describes production, quality, maintenance, and inventory/material operations. MESA adds lifecycle views including Product, Production, Production Asset, Supply Chain, Workforce, and Order-to-Cash. This MES uses Product as the execution aggregate while keeping the cross-system lifecycle handoffs explicit.
