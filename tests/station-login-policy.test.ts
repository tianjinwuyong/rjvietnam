import { describe, expect, it } from "vitest";
import { createStationLoginPolicy } from "../services/api/src/auth/station-login-policy";

// Permission sets copied from the seeded roles (probed live 2026-11-20), so the
// test fails if the rule starts disagreeing with the data it was written against.
const adminPerms = ["admin.audit.read", "admin.view", "finance.manage", "hr.admin", "hr.attendance", "wms.view"];
const managementPerms = ["hr.admin", "hr.salary", "hr.leave", "wms.view", "mes.view"];
const materialReceiverPerms = ["wms.receive", "wms.view", "iqc.handover", "traceability.view"];
const qualityPerms = ["quality.view", "lifecycle.approve", "smt.loading.approve", "wms.view"];

describe("station login policy", () => {
  it("refuses a role that can administer access control, HR or money", () => {
    const policy = createStationLoginPolicy();
    const admin = policy.check("admin", adminPerms);
    expect(admin.allowed).toBe(false);
    expect(admin.reason).toBe("PRIVILEGED_ROLE");
    expect(admin.blocked).toContain("admin.view");

    const management = policy.check("management", managementPerms);
    expect(management.allowed).toBe(false);
    expect(management.blocked).toEqual(expect.arrayContaining(["hr.admin", "hr.salary"]));
  });

  it("allows the role the floor harness signs in with", () => {
    // J1 in harness/END-TO-END.md posts VN_MATERIAL_RECEIVER at AC-CABLE-01.
    const policy = createStationLoginPolicy();
    expect(policy.check("material_receiver", materialReceiverPerms)).toEqual({
      allowed: true,
      reason: null,
      blocked: [],
    });
  });

  it("does not block floor-level approvals held by quality and warehouse", () => {
    // `*.approve` is a shop-floor signature, not an administration right; treating
    // it as privileged would lock the QC stations out of station login.
    const policy = createStationLoginPolicy();
    expect(policy.check("quality", qualityPerms).allowed).toBe(true);
  });

  it("lets the owner re-open one role on purpose", () => {
    const policy = createStationLoginPolicy({ allowRoles: "admin, plant_manager" });
    expect(policy.check("admin", adminPerms).allowed).toBe(true);
    expect(policy.check("plant_manager", ["admin.audit"]).allowed).toBe(true);
    // Only the listed role: the allow-list never widens into a prefix match.
    expect(policy.check("admin2", adminPerms).allowed).toBe(false);
  });

  it("treats a wildcard permission as privileged", () => {
    const policy = createStationLoginPolicy();
    expect(policy.check("test", ["*"]).allowed).toBe(false);
  });

  it("answers for a role with no permissions at all", () => {
    const policy = createStationLoginPolicy();
    expect(policy.check("rework", []).allowed).toBe(true);
    expect(policy.check("rework", null as unknown as string[]).allowed).toBe(true);
  });
});
