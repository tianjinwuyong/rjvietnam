import { describe, expect, it } from "vitest";
import { superviseMesProcess, superviseMesProcesses } from "../services/api/src/mes-process-supervisor.js";

const base = {
  processInstanceId: "PROC-1",
  processCode: "MANUAL_LINE_MATERIAL_USAGE",
  domain: "manual-line",
  lastFactType: "MATERIAL_USAGE_REPORTED",
  status: "ACTIVE",
  owner: "MANUAL_LINE_SUPERVISOR",
  lastActivityAt: "2026-08-04T01:00:00Z",
  slaMinutes: 30,
  blocking: false,
  completedHandoffs: ["WMS_USAGE_RECONCILIATION"],
  expectedHandoff: "WMS_USAGE_RECONCILIATION",
};

describe("MES Process Supervisor", () => {
  it("reports a healthy manual-line process", () => {
    expect(superviseMesProcess(base, new Date("2026-08-04T01:10:00Z"))).toMatchObject({ health: "HEALTHY", issues: [] });
  });

  it("blocks cross-domain contamination", () => {
    const result = superviseMesProcess({ ...base, domain: "smt" }, new Date("2026-08-04T01:10:00Z"));
    expect(result).toMatchObject({ health: "BLOCKED", issues: [expect.objectContaining({ issueType: "PROCESS_CONTRACT_VIOLATION" })] });
  });

  it("detects SLA and missing handoff without changing production truth", () => {
    const result = superviseMesProcess({ ...base, completedHandoffs: [] }, new Date("2026-08-04T02:00:00Z"));
    expect(result.health).toBe("AT_RISK");
    expect(result.issues.map((issue) => issue.issueType)).toEqual(expect.arrayContaining(["PROCESS_SLA_BREACH", "MISSING_PROCESS_HANDOFF"]));
  });

  it("returns a portfolio summary across domains", () => {
    const result = superviseMesProcesses([base, { ...base, processInstanceId: "PROC-2", domain: "smt" }], new Date("2026-08-04T01:10:00Z"));
    expect(result.summary).toEqual({ total: 2, healthy: 1, atRisk: 0, blocked: 1 });
  });
});
