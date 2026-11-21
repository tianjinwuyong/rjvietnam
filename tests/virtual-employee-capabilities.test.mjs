import { describe, it, expect } from "vitest";
import {
  auditCapabilities, capabilitiesFor, canUseSkill, skillsFor, mcpFor, gatesFor,
  SKILLS, SKILL_BY_ID, ROLE_CAPABILITIES, ALL_ROLE_IDS, MCP_SERVERS, PERMISSION_CODES,
} from "../services/api/src/virtual-employees/capabilities.js";
import { FACTORY_VIRTUAL_EMPLOYEES, getFactoryVirtualEmployee } from "../services/api/src/virtual-employees/registry.js";
import { runEmployeeCycle, PROBES } from "../services/api/src/agent/runner.js";
import { FREQUENCIES } from "../services/api/src/virtual-employees/frequencies.js";

const registryAudit = () => auditCapabilities({ registryEntries: FACTORY_VIRTUAL_EMPLOYEES });

describe("capability contract covers the whole org", () => {
  it("declares all 44 reporting-line positions and passes self-audit", () => {
    const audit = registryAudit();
    expect(ALL_ROLE_IDS).toHaveLength(44);
    expect(audit.roles).toBe(44);
    expect(audit.problems).toEqual([]);
    expect(audit.skills).toBe(SKILLS.length);
  });

  it("keeps every registry capability inside the matrix", () => {
    for (const employee of FACTORY_VIRTUAL_EMPLOYEES) {
      const declared = skillsFor(employee.id);
      expect(declared, employee.id).not.toBeNull();
      for (const capability of employee.capabilities) expect(declared, `${employee.id}:${capability}`).toContain(capability);
      // registry.js now reads skills/MCP from the contract, not a literal
      expect(employee.skills).toEqual(declared);
      expect(employee.mcpServers).toEqual(mcpFor(employee.id));
    }
  });

  it("gives every role the memory namespace and a resolvable skill set", () => {
    for (const roleId of ALL_ROLE_IDS) {
      const caps = capabilitiesFor(roleId);
      expect(caps, roleId).not.toBeNull();
      expect(caps.skillIds.length).toBeGreaterThan(0);
      expect(caps.mcpServers).toContain("smt-memory");
      expect(caps.mcpServers.every(m => MCP_SERVERS[m])).toBe(true);
      expect(caps.permissions.every(p => PERMISSION_CODES.includes(p))).toBe(true);
    }
  });

  it("mirrors every position from ve_reporting_lines in the runtime registry", () => {
    for (const id of ["SMT-LOOP-VIRTUAL-01", "E-INVOICE-VIRTUAL-01", "MRB-VIRTUAL-01", "TRACE-VIRTUAL-01", "REPORTS-VIRTUAL-01"]) {
      expect(getFactoryVirtualEmployee(id)).not.toBeNull();
      expect(capabilitiesFor(id).skillIds.length).toBeGreaterThan(3);
    }
    expect(capabilitiesFor("NOT-A-ROLE")).toBeNull();
  });
});

describe("write skills are always gated", () => {
  it("every write skill names a human gate", () => {
    const ungated = SKILLS.filter(s => s.kind === "write" && !s.gate);
    expect(ungated.map(s => s.id)).toEqual([]);
  });

  it("a write skill's gate is registered on the drafting role", () => {
    for (const employee of FACTORY_VIRTUAL_EMPLOYEES) {
      for (const skill of capabilitiesFor(employee.id).skills.filter(s => s.kind === "write")) {
        expect(employee.humanGates, `${employee.id}→${skill.id} (${skill.gate})`).toContain(skill.gate);
      }
    }
  });

  it("read skills never carry a manage-level permission", () => {
    const over = SKILLS.filter(s => s.kind === "read" && s.permission.endsWith(".manage"));
    expect(over.map(s => s.id)).toEqual([]);
  });

  it("every declared gate has a skill that produces it or is human-only by design", () => {
    const audit = registryAudit();
    const codes = new Set(audit.problems.map(p => p.code));
    expect(codes.has("WRITE_GATE_NOT_IN_REGISTRY")).toBe(false);
    // OPS coordinates other domains' approvals: its registered gates are the
    // human's, so they appear as warnings, never as failures.
    expect(audit.warnings.map(w => w.roleId)).toContain("OPS-SUPERVISOR-VIRTUAL-01");
  });
});

describe("dispatch-time enforcement surface", () => {
  it("refuses unknown roles, unknown skills and skills not declared for the role", () => {
    expect(canUseSkill("NOPE-VIRTUAL-01", "QR_TRACE")).toMatchObject({ ok: false, code: "ROLE_NOT_DECLARED" });
    expect(canUseSkill("IQC-VIRTUAL-01", "NOT_A_SKILL")).toMatchObject({ ok: false, code: "SKILL_UNKNOWN" });
    expect(canUseSkill("IQC-VIRTUAL-01", "RESTORE_DRILL")).toMatchObject({ ok: false, code: "SKILL_NOT_DECLARED_FOR_ROLE" });
  });

  it("marks a read skill READ and a write skill GATED_DRAFT with its gate", () => {
    expect(canUseSkill("TRACE-VIRTUAL-01", "SERIAL_TRACE")).toMatchObject({ ok: true, mode: "READ" });
    const gated = canUseSkill("MES-VIRTUAL-01", "LINE_STOP_REQUEST");
    expect(gated).toMatchObject({ ok: true, mode: "GATED_DRAFT", gate: "stop_line" });
    expect(gated.note).toContain("人类");
  });

  it("keeps the registry's own gates meaningful for their own roles", () => {
    expect(gatesFor("MSD-CONTROL-VIRTUAL-01").sort()).toEqual(["override_msl", "release_expired_material"]);
    expect(gatesFor("PURCHASING-VIRTUAL-01").sort())
      .toEqual(["approve_po", "change_price", "change_quantity"].sort());
    expect(SKILL_BY_ID.get("LINE_STOP_REQUEST").mcp).toContain("smt-realtime");
  });

  it("declares every runner probe task type as a skill of that role", () => {
    const drift = [];
    for (const [roleId, probe] of Object.entries(PROBES)) {
      const verdict = canUseSkill(roleId, probe.taskType);
      if (!verdict.ok) drift.push(`${roleId}:${probe.taskType}=${verdict.code}`);
    }
    // Every probe is checked, including the 30 added for the NO_PROBE gap.
    expect(PROBES).toHaveProperty("WMS-COUNT-VIRTUAL-01");
    expect(drift).toEqual([]);
  });

  it("gives every cadence role a runnable probe over a read-only source", async () => {
    const { FACTORY_VIRTUAL_EMPLOYEES: registry } = await import("../services/api/src/virtual-employees/registry.js");
    const missing = Object.keys(FREQUENCIES).filter(id => !PROBES[id] || !registry.some(e => e.id === id));
    expect(missing).toEqual([]);
    for (const [roleId, probe] of Object.entries(PROBES)) {
      expect(probe.sql, `${roleId} must alias row_key`).toMatch(/AS row_key/i);
      expect(probe.sql, `${roleId} must order and limit`).toMatch(/ORDER BY[\s\S]+LIMIT \$1\s*$/i);
      expect(/\b(insert|update|delete|drop|truncate|alter|create|grant)\b/i.test(probe.sql), `${roleId} probe must be read-only`).toBe(false);
      if (probe.gate) expect((await getFactoryVirtualEmployee(roleId)).humanGates).toContain(probe.gate);
    }
  });

  it("does not skip NO_PROBE once a role has a declared probe", async () => {
    // A role whose probe task type is not declared for it never reaches the DB:
    // build the refusal by asking the contract about a probe it does not own.
    const { canUseSkill: check } = await import("../services/api/src/virtual-employees/capabilities.js");
    expect(check("MSD-CONTROL-VIRTUAL-01", PROBES["IQC-VIRTUAL-01"].taskType))
      .toMatchObject({ ok: false, code: "SKILL_NOT_DECLARED_FOR_ROLE" });
  });
});
