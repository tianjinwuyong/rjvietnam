import { describe, it, expect } from "vitest";
import {
  FREQUENCIES, CADENCE_KIND, cadenceFor, validateFrequencies,
} from "../services/api/src/virtual-employees/frequencies.js";

// Mirrors ve_reporting_lines rows with enabled=true (37 including the commander).
const ENABLED = [
  "OPS-SUPERVISOR-VIRTUAL-01",
  "WMS-SUPERVISOR-VIRTUAL-01", "WMS-RECEIVING-VIRTUAL-01", "WMS-IQC-HANDOFF-VIRTUAL-01",
  "WMS-INVENTORY-VIRTUAL-01", "WMS-COUNT-VIRTUAL-01", "WMS-ISSUE-VIRTUAL-01", "MSD-CONTROL-VIRTUAL-01",
  "PMC-VIRTUAL-01", "PURCHASING-VIRTUAL-01", "SUPPLIER-COLLAB-VIRTUAL-01",
  "MES-VIRTUAL-01", "SMT-LOOP-VIRTUAL-01", "ANDON-VIRTUAL-01", "PACK-VIRTUAL-01",
  "QUALITY-VIRTUAL-01", "IQC-VIRTUAL-01", "OQC-VIRTUAL-01", "TRACE-VIRTUAL-01",
  "MAINTENANCE-VIRTUAL-01", "STATION-EQUIP-VIRTUAL-01", "REPAIR-VIRTUAL-01",
  "FINANCE-VIRTUAL-01", "SALES-VIRTUAL-01", "E-INVOICE-VIRTUAL-01",
  "HR-VIRTUAL-01", "OA-DOCUMENT-CONTROL-VIRTUAL-01", "SAFETY-VIRTUAL-01",
  "APP-OPS-VIRTUAL-01", "INFRA-VIRTUAL-01", "DATABASE-VIRTUAL-01", "INTEGRATION-VIRTUAL-01",
  "SECURITY-VIRTUAL-01", "PDA-FLEET-VIRTUAL-01", "BACKUP-VIRTUAL-01", "RELEASE-VIRTUAL-01",
  "REPORTS-VIRTUAL-01",
];

describe("virtual employee frequencies", () => {
  it("covers every enabled position exactly once", () => {
    expect(Object.keys(FREQUENCIES).sort()).toEqual([...ENABLED].sort());
    expect(validateFrequencies(ENABLED)).toEqual([]);
  });

  it("rejects unknown employees and resolves case-insensitively", () => {
    expect(cadenceFor("iqc-virtual-01")).toBe(FREQUENCIES["IQC-VIRTUAL-01"]);
    expect(cadenceFor("NOT-A-JOB")).toBeNull();
  });

  it("matches cadence class to the nature of the task", () => {
    // Time-critical exposure and station checks watch at minute granularity.
    expect(cadenceFor("MSD-CONTROL-VIRTUAL-01").intervalSeconds).toBe(60);
    expect(cadenceFor("STATION-EQUIP-VIRTUAL-01").intervalSeconds).toBe(60);
    expect(cadenceFor("PDA-FLEET-VIRTUAL-01").intervalSeconds).toBe(60);
    // Near-real-time escalation without LLM polling.
    expect(cadenceFor("ANDON-VIRTUAL-01").maxLatencySeconds).toBe(15);
    expect(cadenceFor("MES-VIRTUAL-01").maxLatencySeconds).toBe(30);
    // Batch and demand jobs never poll.
    expect(cadenceFor("TRACE-VIRTUAL-01").kind).toBe(CADENCE_KIND.DEMAND);
    expect(cadenceFor("RELEASE-VIRTUAL-01").kind).toBe(CADENCE_KIND.DEMAND);
    expect(cadenceFor("WMS-COUNT-VIRTUAL-01").kind).toBe(CADENCE_KIND.BATCH);
    expect(cadenceFor("BACKUP-VIRTUAL-01").cron).toBe("30 2 * * *");
    // Align with the existing OA SLA monitor in server.js:22097 (5 minutes).
    expect(cadenceFor("OA-DOCUMENT-CONTROL-VIRTUAL-01").intervalSeconds).toBe(300);
    expect(cadenceFor("APP-OPS-VIRTUAL-01").intervalSeconds).toBe(60);
  });

  it("keeps every model budget under the approval-throughput ceiling", () => {
    for (const c of Object.values(FREQUENCIES)) expect(c.llmBudgetPerDay).toBeLessThanOrEqual(20);
  });
});
