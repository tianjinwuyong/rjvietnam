// Minimal working runner: turns real business rows into gated task drafts.
// It writes ONLY to factory_virtual_employee_tasks / _events; business tables
// are read-only here. Every task carries a task_key and a `ve:` actor, and a
// human must approve via POST /tasks/:taskId/approve before any downstream
// write happens.

import { getFactoryVirtualEmployee } from "../virtual-employees/registry.js";
import { cadenceFor } from "../virtual-employees/frequencies.js";
import { canUseSkill } from "../virtual-employees/capabilities.js";
import { EXTRA_PROBES } from "./probe-library.js";

// A probe is the smallest unit of "work" for one employee: one read-only SQL
// query over real business data plus a task template. Adding a position means
// adding one probe, not copying a runner. `gate` MUST be in that employee's
// registry.humanGates or the runner refuses to create the task.
export const PROBES = Object.freeze({
  ...EXTRA_PROBES,
  "IQC-VIRTUAL-01": {
    taskType: "IQC_INSPECT",
    sql: `SELECT inspection_no AS row_key, lot_no, material_code, supplier_code, supplier_name
          FROM iqc_inspections
          WHERE inspection_result IS NULL
          ORDER BY id ASC LIMIT $1`,
    gate: "final_iqc_decision",
    title: r => `IQC 待判定：${r.lot_no || r.inspection_no || r.material_code || "批次"}`,
  },
  "WMS-RECEIVING-VIRTUAL-01": {
    taskType: "RECEIVING_VALIDATE",
    sql: `SELECT receipt_no AS row_key, material_code, supplier_code, batch_no, quantity, unit
          FROM wms_receipt_orders
          WHERE status = 'pending_iqc'
          ORDER BY id ASC LIMIT $1`,
    gate: "receive_variance",
    title: r => `收料待核验：${r.batch_no || r.material_code || r.row_key}`,
  },
  "WMS-INVENTORY-VIRTUAL-01": {
    taskType: "PACKAGE_SIGNATURE_WATCH",
    sql: `SELECT package_no AS row_key, work_order_code, line_code, total_qty, delivery_due_at
          FROM wms_fetch_packages
          WHERE status = 'PREPARED' AND received_at IS NULL
          ORDER BY id ASC LIMIT $1`,
    gate: "hand_over_package",
    title: r => `包裹待签收：${r.package_no || r.work_order_code || "包裹"}`,
  },
  "MAINTENANCE-VIRTUAL-01": {
    taskType: "WEAR_ALERT_TRIAGE",
    sql: `SELECT id AS row_key, part_id, equipment_id, alert_type, severity, message
          FROM parts_wear_alerts
          WHERE resolved_at IS NULL
          ORDER BY id ASC LIMIT $1`,
    gate: "return_machine_to_service",
    title: r => `备件磨损告警：${r.alert_type || r.part_id || r.row_key}`,
  },
  "OA-DOCUMENT-CONTROL-VIRTUAL-01": {
    taskType: "APPROVAL_PACKAGE_CHECK",
    sql: `SELECT order_no AS row_key, work_order_no, total_qty, total_amount, created_at
          FROM over_picking_orders
          WHERE status = 'pending'
          ORDER BY id ASC LIMIT $1`,
    gate: "approve_document",
    title: r => `超领审批包待核验：${r.order_no || r.work_order_no || "审批包"}`,
  },
  "SUPPLIER-COLLAB-VIRTUAL-01": {
    taskType: "SUPPLIER_RETURN_WATCH",
    sql: `SELECT return_no AS row_key, supplier_code, batch_no, total_qty, status
          FROM supplier_return_order
          WHERE status NOT IN ('out', 'completed')
          ORDER BY id ASC LIMIT $1`,
    gate: "publish_rejection",
    title: r => `供应商退货待处理：${r.return_no || r.batch_no || "退货单"}`,
  },
  "OPS-SUPERVISOR-VIRTUAL-01": {
    taskType: "APPROVAL_ESCALATION",
    sql: `SELECT id AS row_key, employee_id, task_type, human_gate, created_at
          FROM factory_virtual_employee_tasks
          WHERE status = 'WAITING_APPROVAL'
          ORDER BY created_at ASC LIMIT $1`,
    gate: null, // a reminder needs no human gate; only business writes do
    title: r => `待审批升级：${r.employee_id} / ${r.task_type}`,
  },
});

export async function runEmployeeCycle({ employeeId, query, limit = 5, dryRun = false, trigger = null, knowledge = null }) {
  const cadence = cadenceFor(employeeId);
  if (!cadence) return { employeeId, skipped: "NO_CADENCE" };
  if (cadence.kind === "DEMAND" && !trigger) return { employeeId, skipped: "DEMAND_NO_TRIGGER" };

  const probe = PROBES[employeeId];
  if (!probe) return { employeeId, skipped: "NO_PROBE", cadence: cadence.kind };
  // The capability contract decides whether this employee may do this work at
  // all. An undeclared task type is drift between the probes and the org chart,
  // and drift must be reported, never quietly executed.
  const allowed = canUseSkill(employeeId, probe.taskType);
  if (!allowed.ok) return { employeeId, skipped: allowed.code, taskType: probe.taskType };
  const employee = getFactoryVirtualEmployee(employeeId);
  if (!employee) return { employeeId, skipped: "EMPLOYEE_NOT_FOUND" };
  if (probe.gate && !employee.humanGates?.includes(probe.gate)) {
    return { employeeId, skipped: "GATE_NOT_REGISTERED", gate: probe.gate };
  }

  let rows;
  try {
    rows = (await query(probe.sql, [limit])).rows;
  } catch (err) {
    // Schema drift in one domain must not abort the whole scheduler tick.
    return { employeeId, skipped: "PROBE_ERROR", error: String(err.message || err) };
  }
  // RAG in the loop: recall the employee's own namespace plus the shared
  // corpus, and attach what was actually cited to each task. A retrieval
  // failure is recorded, never silently turned into "no evidence needed".
  let cited = [];
  if (knowledge) {
    try {
      const recalled = await knowledge.recall({
        employeeId: employee.id, topK: 5,
        query: `${employee.name_zh} ${probe.taskType} 处理经验与例外`,
      });
      cited = recalled.cited || [];
    } catch (err) {
      cited = [{ recallError: String(err.message || err) }];
    }
  }
  const actor = `ve:${employee.id}`;
  let created = 0, duplicate = 0;
  const taskKeys = [];

  for (const row of rows) {
    const taskKey = `${employee.id}:${probe.taskType}:${row.row_key}`;
    taskKeys.push(taskKey);
    if (dryRun) { created++; continue; }

    const inserted = await query(
      `INSERT INTO factory_virtual_employee_tasks
        (employee_id, task_type, title, domain, status, priority, input, requires_human, human_gate, requested_by, task_key)
       VALUES ($1,$2,$3,$4,$5,'NORMAL',$6::jsonb,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [employee.id, probe.taskType, probe.title(row), employee.domain,
        probe.gate ? "WAITING_APPROVAL" : "OPEN",
        JSON.stringify({ ...row, action: probe.gate || "ESCALATE", cadence: cadence.kind, evidence: cited }),
        Boolean(probe.gate), probe.gate, actor, taskKey],
    );
    if (!inserted.rowCount) { duplicate++; continue; }
    created++;
    await query(
      `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
       VALUES ($1,$2,'AGENT_TOOL_CALL',$3::jsonb,$4)`,
      [employee.id, inserted.rows[0].id,
        JSON.stringify({ toolId: `${probe.taskType.toLowerCase()}_draft`, taskKey, status: "DRAFT",
          veActor: actor, gate: probe.gate, cadence: cadence.kind }),
        actor],
    );
  }
  return { employeeId, cadence: cadence.kind, scanned: rows.length, created, duplicate, gate: probe.gate, taskKeys, cited: cited.length };
}

export async function runAllCycles({ employeeIds, query, limit = 5, dryRun = false, trigger = null, knowledge = null }) {
  const results = [];
  for (const id of employeeIds) {
    results.push(await runEmployeeCycle({ employeeId: id, query, limit, dryRun, trigger, knowledge }));
  }
  return results;
}
