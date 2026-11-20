import { describe, it, expect } from "vitest";
import { localParts, cronMatches, dueNow, dueJobs, JOBS, loadLastRun, recordTick, acquireSchedulerLock, SCHEDULER_TICK_EVENT } from "../services/api/src/agent/scheduler.js";
import { planWriteback, applyWriteback, auditWritebackCoverage, GATE_EFFECTS } from "../services/api/src/agent/writeback.js";
import { approveTask, humanActor } from "../services/api/src/agent/approval.js";
import { FACTORY_VIRTUAL_EMPLOYEES } from "../services/api/src/virtual-employees/registry.js";
import { SKILLS } from "../services/api/src/virtual-employees/capabilities.js";
import { FREQUENCIES } from "../services/api/src/virtual-employees/frequencies.js";

const at = (iso) => new Date(iso);
const parts = iso => localParts(at(iso));

describe("cadence scheduler", () => {
  it("converts to Asia/Ho_Chi_Minh without a tz database", () => {
    expect(parts("2026-11-20T17:00:00Z")).toMatchObject({ hour: 0, minute: 0, day: 21 });
    expect(parts("2026-11-20T16:59:00Z")).toMatchObject({ hour: 23, minute: 59, day: 20 });
  });

  it("matches the cron shapes frequencies.js actually uses", () => {
    expect(cronMatches("0 22 * * *", parts("2026-11-20T15:00:00Z"))).toBe(true);   // 22:00 local
    expect(cronMatches("0 22 * * *", parts("2026-11-20T14:59:00Z"))).toBe(false);
    expect(cronMatches("0 6,12,18,0 * * *", parts("2026-11-20T05:00:00Z"))).toBe(true);  // 12:00 local
    expect(cronMatches("0 6 * * 1", parts("2026-11-22T23:00:00Z"))).toBe(true);   // Mon 06:00 local
    expect(cronMatches("0 6 * * 1", parts("2026-11-23T23:00:00Z"))).toBe(false);  // Tue
    expect(cronMatches("30 22 * * *", parts("2026-11-20T15:30:00Z"))).toBe(true);
    expect(cronMatches("0 22-2 * * *", parts("2026-11-20T19:00:00Z"))).toBe(true); // 02:00 wrap-over
    expect(cronMatches("0 22-2 * * *", parts("2026-11-20T12:00:00Z"))).toBe(false); // 19:00 local
    expect(cronMatches("broken", parts("2026-11-20T15:00:00Z"))).toBe(false);
  });

  it("fires EVENT/WATCH on elapsed time, DEMAND never, BATCH once per minute", () => {
    const now = at("2026-11-20T10:00:00Z");
    const recent = new Date(now.getTime() - 30_000).toISOString();
    const stale = new Date(now.getTime() - 3600_000).toISOString();
    const due = dueNow({ now, employeeIds: ["IQC-VIRTUAL-01", "OPS-SUPERVISOR-VIRTUAL-01", "TRACE-VIRTUAL-01", "WMS-COUNT-VIRTUAL-01"],
      lastRun: { "IQC-VIRTUAL-01": recent, "OPS-SUPERVISOR-VIRTUAL-01": stale } });
    const ids = due.map(d => d.employeeId);
    expect(ids).not.toContain("IQC-VIRTUAL-01");             // ran 30s ago, interval 300s
    expect(ids).toContain("OPS-SUPERVISOR-VIRTUAL-01");      // stale → bounded sweep
    expect(ids).not.toContain("TRACE-VIRTUAL-01");            // DEMAND is never scheduled
    expect(ids).not.toContain("WMS-COUNT-VIRTUAL-01");        // BATCH 22:00, it is 17:00 local
    const onDemand = dueNow({ now, employeeIds: ["TRACE-VIRTUAL-01"], allowDemand: true });
    expect(onDemand[0]).toMatchObject({ kind: "DEMAND", reason: "manual dispatch" });
  });

  it("never schedules an employee whose cadence is undeclared, and says so", () => {
    const due = dueNow({ now: at("2026-11-20T10:00:00Z"), employeeIds: ["NO-SUCH-VIRTUAL-01"] });
    expect(due).toEqual([{ employeeId: "NO-SUCH-VIRTUAL-01", kind: "UNDECLARED", reason: "FREQUENCY_NOT_DECLARED" }]);
  });

  it("gives the inventory employee its 6-hourly second cycle", () => {
    const due = dueNow({ now: at("2026-11-20T05:00:00Z"), employeeIds: ["WMS-INVENTORY-VIRTUAL-01"], lastRun: {} });
    expect(due.map(d => d.kind)).toEqual(["WATCH", "BATCH"]);
    expect(due[1]).toMatchObject({ secondary: true });
    const later = dueNow({ now: at("2026-11-20T05:00:30Z"), employeeIds: ["WMS-INVENTORY-VIRTUAL-01"],
      lastRun: { "WMS-INVENTORY-VIRTUAL-01": "2026-11-20T05:00:10Z", "WMS-INVENTORY-VIRTUAL-01#secondary": "2026-11-20T05:00:10Z" } });
    expect(later).toEqual([]);
  });

  it("compares cron in local minutes, not raw UTC strings", () => {
    // 22:30 local == 15:30Z; a lastRun stored as UTC must not look like a
    // different minute than the local cron key.
    expect(dueJobs({ now: at("2026-11-20T15:30:40Z"), lastRun: { learn: "2026-11-20T15:30:05Z" } })).toEqual([]);
    expect(dueJobs({ now: at("2026-11-20T15:30:00Z"), lastRun: { learn: "2026-11-19T15:30:00Z" } })
      .map(j => j.job)).toEqual(["learn"]);
  });

  it("covers every declared employee and keeps batch jobs off business hours", () => {
    for (const id of Object.keys(FREQUENCIES)) {
      expect(["EVENT", "WATCH", "BATCH", "DEMAND"], id).toContain(FREQUENCIES[id].kind);
    }
    expect(Object.fromEntries(Object.entries(JOBS).map(([name, job]) => [name, cronMatches(job.cron, parts("2026-11-20T15:30:00Z"))])))
      .toMatchObject({ learn: true, knowledge: false, competency: false, report: false });
  });
});

describe("scheduler state survives a restart without a schema change", () => {
  it("rehydrates last-run from SCHEDULER_TICK events", async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [
        { key: "IQC-VIRTUAL-01", last_run: new Date("2026-11-20T10:00:00Z") },
        { key: "learn", last_run: new Date("2026-11-19T15:30:00Z") },
        { key: null, last_run: new Date() },
      ] };
    };
    const lastRun = await loadLastRun({ query, hours: 24 });
    expect(lastRun).toEqual({ "IQC-VIRTUAL-01": "2026-11-20T10:00:00.000Z", learn: "2026-11-19T15:30:00.000Z" });
    expect(calls[0].params).toContain(SCHEDULER_TICK_EVENT);
    expect(dueNow({ now: at("2026-11-20T10:00:30Z"), employeeIds: ["IQC-VIRTUAL-01"], lastRun })).toEqual([]);
    expect(dueNow({ now: at("2026-11-20T10:06:00Z"), employeeIds: ["IQC-VIRTUAL-01"], lastRun }).length).toBe(1);
  });

  it("never writes a tick without an owning employee", async () => {
    const calls = [];
    const query = async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; };
    await recordTick({ query, key: "WMS-RECEIVING-VIRTUAL-01", detail: { created: 2 } });
    await recordTick({ query, key: "learn", employeeId: "OPS-SUPERVISOR-VIRTUAL-01", detail: { cases: 1 } });
    expect(calls[0].sql).toContain("employee_id");
    expect(calls.map(c => c.params[0])).toEqual(["OPS-SUPERVISOR-VIRTUAL-01", "OPS-SUPERVISOR-VIRTUAL-01"]);
    expect(JSON.parse(calls[1].params[2])).toMatchObject({ key: "learn", cases: 1 });
  });
});

describe("approval writeback advances the workflow, not the stock ledger", () => {
  it("maps an approved gate to the successor role's declared draft skill", () => {
    const plan = planWriteback({ gate: "receive_variance", rowKey: "RCV-9" });
    expect(plan).toMatchObject({ code: null, taskKey: "WB:receive_variance:RCV-9", mode: "DRAFT" });
    expect(plan.target).toMatchObject({ employeeId: "WMS-IQC-HANDOFF-VIRTUAL-01", taskType: "IQC_SUBMIT" });
    expect(plan.title).toContain("RCV-9");
  });

  it("refuses to hand a gated write to the successor and refuses unknown gates", () => {
    expect(planWriteback({ gate: "no_such_gate", rowKey: "x" })).toMatchObject({ code: "WRITEBACK_NO_SUCH_GATE" });
    const forbidden = planWriteback({ gate: "approve_payment", rowKey: "x" });
    expect(forbidden).toMatchObject({ code: "WRITEBACK_UNSUPPORTED" });
    expect(forbidden.reason).toContain("具名");
  });

  it("every registered gate has a defined outcome and no advance lands on a write skill", () => {
    const known = new Set([...FACTORY_VIRTUAL_EMPLOYEES.flatMap(e => e.humanGates || []),
      ...SKILLS.map(s => s.gate).filter(Boolean)]);
    const audit = auditWritebackCoverage(known);
    expect(audit.missing).toEqual([]);
    expect(audit.advancesToWrite).toEqual([]);
    expect(audit.advances).toBeGreaterThan(10);
    expect(Object.values(GATE_EFFECTS).every(e => Boolean(e.advance) !== Boolean(e.unsupported))).toBe(true);
  });

  function recorder() {
    const calls = [];
    return { calls, query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO factory_virtual_employee_tasks")) return { rows: [{ id: 900 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    } };
  }

  it("creates one idempotent OPEN successor task and records the decision", async () => {
    const { query, calls } = recorder();
    const task = { id: 500, employee_id: "WMS-RECEIVING-VIRTUAL-01", task_type: "RECEIVING_VALIDATE",
      human_gate: "receive_variance", input: { row_key: "RCV-9", evidence: [{ memoryId: "m1" }] } };
    const employee = FACTORY_VIRTUAL_EMPLOYEES.find(e => e.id === task.employee_id);
    const result = await applyWriteback({ query, task, employee, reviewer: "admin" });
    expect(result).toMatchObject({ applied: true, targetTaskId: 900, duplicate: false });
    const insert = calls.find(c => c.sql.includes("INSERT INTO factory_virtual_employee_tasks"));
    expect(insert.params.slice(0, 2)).toEqual(["WMS-IQC-HANDOFF-VIRTUAL-01", "IQC_SUBMIT"]);
    expect(insert.params[6]).toBe("WB:receive_variance:RCV-9");
    expect(insert.params[5]).toBe("ve:writeback");
    expect(JSON.parse(insert.params[4])).toMatchObject({ originTaskId: 500, gate: "receive_variance", writeback: true });
    expect(JSON.parse(insert.params[4]).evidence).toEqual([{ memoryId: "m1" }]);
    // the successor is coordination work, not a second human gate
    expect(insert.sql).toContain("requires_human");
    expect(insert.sql).toContain("FALSE,NULL");
    expect(calls.some(c => c.sql.includes("'WRITEBACK_APPLIED'"))).toBe(true);
  });

  it("records an unsupported gate instead of silently doing nothing", async () => {
    const { query, calls } = recorder();
    const result = await applyWriteback({ query,
      task: { id: 501, employee_id: "FINANCE-VIRTUAL-01", human_gate: "approve_payment", input: { row_key: "PAY-1" } },
      employee: FACTORY_VIRTUAL_EMPLOYEES.find(e => e.id === "FINANCE-VIRTUAL-01"), reviewer: "admin" });
    expect(result).toMatchObject({ applied: false, code: "WRITEBACK_UNSUPPORTED" });
    const event = calls.find(c => c.sql.includes("WRITEBACK_DECIDED"));
    expect(JSON.parse(event.params[2])).toMatchObject({ gate: "approve_payment", reason: expect.any(String) });
    expect(calls.some(c => c.sql.includes("INSERT INTO factory_virtual_employee_tasks"))).toBe(false);
  });
});

describe("one approval path for HTTP and CLI", () => {
  const gated = { id: 700, employee_id: "WMS-RECEIVING-VIRTUAL-01", task_type: "RECEIVING_VALIDATE",
    status: "WAITING_APPROVAL", requires_human: true, human_gate: "receive_variance", input: { row_key: "RCV-7" } };
  const employee = FACTORY_VIRTUAL_EMPLOYEES.find(e => e.id === "WMS-RECEIVING-VIRTUAL-01");

  it("refuses virtual identities as approvers", () => {
    expect(humanActor({ actor: "ve:WMS-RECEIVING-VIRTUAL-01" })).toMatchObject({ ok: false, code: "VE_CANNOT_APPROVE" });
    expect(humanActor({ actor: "admin", serviceToken: true })).toMatchObject({ ok: false, code: "VE_CANNOT_APPROVE" });
    expect(humanActor({ actor: "" })).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  function harness(rows = [gated]) {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("UPDATE factory_virtual_employee_tasks")) return { rows: rows.map(r => ({ ...r, status: "OPEN", approved_by: params[0] })), rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    return { calls, query };
  }

  it("refuses a human without the domain permission before touching the row", async () => {
    const { query, calls } = harness();
    const result = await approveTask({ query, task: gated, employee, actor: "shift_lead", permissions: ["mes.read"] });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN", required: "wms.execute" });
    expect(calls.some(c => c.sql.includes("UPDATE"))).toBe(false);
  });

  it("refuses a gate the employee does not carry", async () => {
    const { query } = harness();
    const result = await approveTask({ query, task: { ...gated, human_gate: "approve_payment", input: { action: "approve_payment" } },
      employee, actor: "admin", permissions: ["wms.execute"] });
    expect(result).toMatchObject({ ok: false, code: "GATE_NOT_REGISTERED" });
  });

  it("approves, logs the human, and advances the flow", async () => {
    const { query, calls } = harness();
    const result = await approveTask({ query, task: gated, employee, actor: "admin", permissions: ["wms.execute"] });
    expect(result).toMatchObject({ ok: true, gate: "receive_variance", actor: "admin" });
    expect(result.writeback).toMatchObject({ applied: true });
    expect(calls.find(c => c.sql.includes("'HUMAN_APPROVED'")).params[3]).toBe("admin");
    expect(calls.find(c => c.sql.includes("UPDATE factory_virtual_employee_tasks")).sql).toContain("status='WAITING_APPROVAL'");
  });

  it("keeps the human decision when the advance fails", async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("UPDATE factory_virtual_employee_tasks")) return { rows: [{ ...gated, status: "OPEN" }], rowCount: 1 };
      if (sql.includes("INSERT INTO factory_virtual_employee_tasks")) throw new Error("deadlock 40P01");
      return { rows: [], rowCount: 1 };
    };
    const result = await approveTask({ query, task: gated, employee, actor: "admin", permissions: ["wms.execute"] });
    expect(result.ok).toBe(true);
    expect(result.writeback).toMatchObject({ applied: false, code: "WRITEBACK_FAILED" });
    expect(calls.some(c => c.sql.includes("WRITEBACK_FAILED"))).toBe(true);
  });

  it("never approves a task that is no longer waiting", async () => {
    const { query, calls } = harness();
    const result = await approveTask({ query, task: { ...gated, status: "OPEN" }, employee, actor: "admin", permissions: ["wms.execute"] });
    expect(result).toMatchObject({ ok: false, code: "TASK_NOT_WAITING" });
    expect(calls.length).toBe(0);
  });
});

describe("one scheduler per database", () => {
  const client = (answers) => {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        return { rows: [{ acquired: answers, released: answers }] };
      },
    };
  };

  it("takes and releases the session lock on the connection it was handed", async () => {
    const c = client(true);
    const lock = await acquireSchedulerLock({ client: c, key: 1234 });
    expect(lock.acquired).toBe(true);
    expect(await lock.release()).toBe(true);
    expect(c.seen.map(s => s.sql)).toEqual([
      "SELECT pg_try_advisory_lock($1::int) AS acquired",
      "SELECT pg_advisory_unlock($1::int) AS released",
    ]);
    expect(c.seen.every(s => s.params[0] === 1234)).toBe(true);
  });

  it("reports no lock, and therefore no release, when another process holds it", async () => {
    const c = client(false);
    const lock = await acquireSchedulerLock({ client: c });
    expect(lock.acquired).toBe(false);
    expect(lock.release).toBeUndefined();
    expect(c.seen.length).toBe(1);
  });
});
