# Inter-Agent Message Bus

## Overview

All five AI managers communicate via a shared PostgreSQL-backed message queue (`services/_shared/agent-bus.js`). This replaces ad-hoc polling and direct耦合 and enables cross-domain event propagation.

**Agent IDs:** `mes-ai`, `wms-ai`, `bom-ai`, `hr-ai`, `rda-ai`

**Queue table:** `smt_factory.inter_agent_messages` (created automatically by `initAgentBus()`)

## Architecture

```
MES ←→ WMS ←→ BOM
 ↑           ↑
HR          RDA
```

- All managers **poll** their inbox on every patrol cycle
- Outbound messages are **fire-and-forget** async inserts
- Response correlation via `correlationId` for request/response patterns

## Message Subject Catalog

### WMS (wms-ai)

**Inbound:**
| Subject | From | Description |
|---|---|---|
| `material_needed` | MES | MES needs material for a line |
| `line_finished` | MES | Line finished WO, return unused materials |
| `feeder_mismatch` | MES | Material on feeder doesn't match BOM |
| `scrap_at_line` | MES | Scrap generated at line, update inventory |
| `request_issue` | MES | MES requesting emergency issue |
| `bom_updated` | BOM | BOM changed, check affected stock |
| `operator_absent` | HR | Operator absent, might affect issue schedule |
| `shift_change` | HR | Shift changed, update staffing |

**Outbound:**
| Subject | To | Description |
|---|---|---|
| `material_issued` | MES | Material issued to line |
| `iqc_released` | MES | Lot passed IQC |
| `iqc_hold` | MES | Lot on IQC hold |
| `scrap_created` | MES | Scrap recorded |
| `line_return` | MES | Material returned from line |
| `low_stock_warning` | MES | Stock below threshold |
| `msd_alert` | MES | MSD exposure alert |
| `component_failure_rate` | BOM | High failure rate on component |
| `work_order_critical` | HR | Critical WO may need OT/extra shifts |
| `bom_usage_feedback` | RDA | Actual vs BOM consumption data |

---

### BOM (bom-ai)

**Inbound:**
| Subject | From | Description |
|---|---|---|
| `material_substitution_needed` | MES | Feeder mismatch, need substitution BOM |
| `component_failure_rate` | MES | AOI detected high failure rate |
| `bom_usage_feedback` | MES | Actual vs BOM qty consumption |
| `iqc_released` | WMS | New material released, BOM may need update |
| `material_issued` | WMS | Material issued to line, verify BOM match |

**Outbound:**
| Subject | To | Description |
|---|---|---|
| `alternative_available` | MES | Alternative material available |
| `bom_accuracy_alert` | MES | BOM accuracy concern |
| `bom_updated` | MES, HR, WMS | BOM structure changed |
| `training_material_impact` | HR | BOM change may require retraining |

---

### HR (hr-ai)

**Inbound:**
| Subject | From | Description |
|---|---|---|
| `line_understaffed` | MES | Line needs more operators |
| `operator_performance` | MES | Operator yield/defect data for review |
| `station_cert_gap` | MES | Operator missing required certification |
| `training_needed` | MES | Defect trend suggests training gap |
| `work_order_critical` | WMS | Critical WO may need OT/extra shifts |
| `material_shortage_alert` | WMS | Material shortage affecting production |
| `bom_updated` | BOM | BOM change may require retraining |
| `bom_operator_impact` | BOM | ECO impacts operator作业 |
| `material_spec_change` | BOM | Material spec changed |
| `attendance_anomaly_report` | RDA | Attendance anomaly detected |
| `workload_analysis` | RDA | OT hours and workload data |
| `hr_data_request` | RDA | Request HR data for analysis |

**Outbound:**
| Subject | To | Description |
|---|---|---|
| `operator_absent` | MES | Operator absent from shift |
| `shift_change` | MES | Operator shift changed |
| `certification_expiring` | MES | Certification expiring soon |
| `new_operator_assigned` | MES | New operator assigned to line |
| `ot_limit_warning` | MES | OT limit approaching |
| `operator_leave_coverage` | WMS | Operator on leave, coverage needed |
| `training_material_impact` | BOM | Training affects BOM materials |
| `hr_data_for_analysis` | RDA | HR data for analysis |

---

### RDA (rda-ai)

**Inbound:**
| Subject | From | Description |
|---|---|---|
| `analysis_request` | MES | Request deep analysis on data points |
| `defect_pattern_query` | MES | Query defect patterns for material/station |
| `material_substituted` | WMS | Material substitution for defect correlation |
| `operator_performance` | HR | Operator performance data for analysis |

**Outbound:**
| Subject | To | Description |
|---|---|---|
| `report_ready` | MES | Analysis report ready |
| `anomaly_detected` | MES | Anomaly in data (severity: critical/high/normal) |
| `trend_alert` | MES | Trend alert |
| `data_request` | MES | Request more data |
| `bom_usage_feedback` | WMS | BOM vs actual consumption |
| `component_failure_rate` | BOM | Component failure rate data |

---

### PMC (pmc-ai)

PMC manages work order scheduling, kit readiness, delivery risk, and line capacity.

**Inbound:**
| Subject | From | Description |
|---|---|---|
| `line_productivity_update` | MES | Line output/效率 update |
| `material_shortage_resolved` | WMS | Previously reported shortage now resolved |
| `operator_assigned` | HR | New operator assigned to line |
| `delivery_forecast_update` | RDA | Updated delivery risk prediction |
| `data_request` | Any | Cross-manager data request |

**Outbound:**
| Subject | To | Description |
|---|---|---|
| `wo_schedule_changed` | MES | Work order released/on-hold |
| `line_capacity_update` | MES | Line utilization changed |
| `material_shortage` | WMS | Material shortage needs resolution |
| `kit_alert` | WMS | Kit not ready for WO |
| `operator_shortage` | HR | Line needs additional operators |
| `delivery_prediction` | RDA | Delivery risk for specific PO |

---

### SOP Managers (mes-sop-ai, wms-sop-ai)

SOP managers run JSON-defined state-machine workflows and notify on completion/failure.

**Outbound (both sop managers):**
| Subject | To | Description |
|---|---|---|
| `sop_cycle_complete` | MES | SOP cycle finished (outcome: completed/stopped/error) |
| `system_alert` | MES | High-severity SOP step failure |

---

### Broadcast (target='*')

| Subject | From | Description |
|---|---|---|
| `patrol_summary` | Any | Periodic patrol digest |
| `system_alert` | Any | Cross-domain critical issue |
| `line_status_change` | MES | Line started/stopped/paused |

## Usage in Code

```javascript
import { sendAgentMessage, pollAgentMessages, completeAgentMessage } from "../_shared/agent-bus.js";

// Send
await sendAgentMessage("wms-ai", "operator_absent", {
  employee_id: "E001",
  name: "Nguyễn Văn A",
  shift_type: "day",
  line_code: "L001",
});

// Receive (in patrol loop)
const messages = await pollAgentMessages("hr-ai", 20);
for (const msg of messages) {
  if (msg.subject === "line_understaffed") {
    await handleLineUnderstaffed(msg.payload);
    await completeAgentMessage(msg.message_id);
  }
}
```

## Shared Helper

`services/_shared/manager-bus.js` provides `createManagerBus()` for cleaner per-manager wiring:

```javascript
import { createManagerBus } from "../_shared/manager-bus.js";

const bus = createManagerBus({
  agentId: "wms-ai",
  log: console.log,
  handlers: { material_needed, line_finished, ... },
});
await bus.init();
await bus.poll();   // call once per patrol cycle
await bus.send("mes-ai", "material_issued", { lot_no: "LOT001", qty: 100 });
```
