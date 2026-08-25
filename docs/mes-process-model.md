# MES Process Model

See the complete [MES Structure Map](./MES-STRUCTURE-MAP.md).

MES recognizes explicit processes rather than treating every scan or material event as the same workflow.

| Domain | Process | Accepted facts | MES responsibility | External authority |
|---|---|---|---|---|
| Manual line | `MANUAL_LINE_MATERIAL_LOADING` | loading scanned, loading confirmed | Validate route/work order and record loading | WMS inventory |
| Manual line | `MANUAL_LINE_MATERIAL_USAGE` | usage reported, usage corrected | Attribute usage to WO/Product and preserve trace | WMS reconciliation |
| SMT | `SMT_FEEDER_LOADING` | feeder binding validated, loading confirmed | Four-way anti-error and feeder trace | WMS inventory |
| SMT | `SMT_MACHINE_CONSUMPTION` | machine consumption reported/reconciled | Attribute equipment facts | WMS reconciliation |
| Auto line | `AUTO_LINE_MATERIAL_USAGE` | usage reported, usage corrected | Attribute usage to auto-line execution | WMS reconciliation |

Every submitted fact must carry `processCode`, `processDomain`, `factType`, station, device, host IP, operator, work order, event time, trace ID, and idempotency key. MES rejects unknown processes, domain mismatches, and facts not owned by the selected process. There is no automatic fallback between domains.

## Process Supervisor

The MES Process Supervisor continuously evaluates process instances for domain-contract violations, stuck work/SLA breach, missing MES→WMS/QMS handoffs, and terminal states without closure evidence. It produces `HEALTHY`, `AT_RISK`, or `BLOCKED` with an owner and required action. It never changes production truth automatically.
