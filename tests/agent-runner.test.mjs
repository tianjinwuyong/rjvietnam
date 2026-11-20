import { describe, it, expect } from "vitest";
import { getFactoryVirtualEmployee } from "../services/api/src/virtual-employees/registry.js";
import { runEmployeeCycle, PROBES } from "../services/api/src/agent/runner.js";

function fakeQuery({ rows = [], taskRowCount = 1 } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*SELECT/.test(sql)) return { rows, rowCount: rows.length };
    if (sql.includes("INSERT INTO factory_virtual_employee_tasks")) {
      return { rowCount: taskRowCount, rows: taskRowCount ? [{ id: 77 }] : [] };
    }
    return { rowCount: 1, rows: [] };
  };
  return { query, calls };
}

const inspectionRow = [{ row_key: "INSP-1", lot_no: "LOT-A", material_code: "M-100" }];

describe("virtual-employee runner", () => {
  it("turns a real IQC row into one gated draft with a ve: actor", async () => {
    const { query, calls } = fakeQuery({ rows: inspectionRow });
    const result = await runEmployeeCycle({ employeeId: "IQC-VIRTUAL-01", query });
    expect(result).toMatchObject({ created: 1, duplicate: 0, scanned: 1, gate: "final_iqc_decision" });
    const insert = calls.find(c => c.sql.includes("INSERT INTO factory_virtual_employee_tasks"));
    expect(insert.params[3]).toBe("quality");
    expect(insert.params[4]).toBe("WAITING_APPROVAL");
    expect(insert.params[6]).toBe(true);
    expect(insert.params[7]).toBe("final_iqc_decision");
    expect(insert.params[8]).toBe("ve:IQC-VIRTUAL-01");
    expect(insert.params[9]).toBe("IQC-VIRTUAL-01:IQC_INSPECT:INSP-1");
    expect(calls.some(c => c.sql.includes("AGENT_TOOL_CALL"))).toBe(true);
  });

  it("skips duplicates without writing an audit event", async () => {
    const { query, calls } = fakeQuery({ rows: inspectionRow, taskRowCount: 0 });
    const result = await runEmployeeCycle({ employeeId: "IQC-VIRTUAL-01", query });
    expect(result).toMatchObject({ created: 0, duplicate: 1 });
    expect(calls.some(c => c.sql.includes("AGENT_TOOL_CALL"))).toBe(false);
  });

  it("never writes in dry-run mode", async () => {
    const { query, calls } = fakeQuery({ rows: inspectionRow });
    const result = await runEmployeeCycle({ employeeId: "IQC-VIRTUAL-01", query, dryRun: true });
    expect(result.created).toBe(1);
    expect(calls.every(c => c.sql.startsWith("SELECT"))).toBe(true);
  });

  it("creates an ungated OPEN reminder for OPS escalation", async () => {
    const { query, calls } = fakeQuery({ rows: [{ row_key: "11", employee_id: "X", task_type: "T" }] });
    const result = await runEmployeeCycle({ employeeId: "OPS-SUPERVISOR-VIRTUAL-01", query });
    expect(result.gate).toBeNull();
    const insert = calls.find(c => c.sql.includes("INSERT INTO factory_virtual_employee_tasks"));
    expect(insert.params[4]).toBe("OPEN");
    expect(insert.params[6]).toBe(false);
  });

  it("respects cadence classes and missing probes", async () => {
    const { query } = fakeQuery();
    expect(await runEmployeeCycle({ employeeId: "TRACE-VIRTUAL-01", query }))
      .toMatchObject({ skipped: "DEMAND_NO_TRIGGER" });
    expect(await runEmployeeCycle({ employeeId: "NOT-A-JOB", query }))
      .toMatchObject({ skipped: "NO_CADENCE" });
    expect(await runEmployeeCycle({ employeeId: "SAFETY-VIRTUAL-01", query })).toMatchObject({ skipped: "NO_PROBE" });
    expect(Object.keys(PROBES).sort()).toEqual([
      "IQC-VIRTUAL-01", "MAINTENANCE-VIRTUAL-01", "OA-DOCUMENT-CONTROL-VIRTUAL-01",
      "OPS-SUPERVISOR-VIRTUAL-01", "SUPPLIER-COLLAB-VIRTUAL-01",
      "WMS-INVENTORY-VIRTUAL-01", "WMS-RECEIVING-VIRTUAL-01",
    ]);
  });

  it("keeps every probe gate inside the employee's registered humanGates", () => {
    for (const [id, probe] of Object.entries(PROBES)) {
      const employee = getFactoryVirtualEmployee(id);
      expect(employee, `missing registry entry for ${id}`).toBeTruthy();
      if (probe.gate) expect(employee.humanGates, `${id}/${probe.gate}`).toContain(probe.gate);
    }
  });
});
