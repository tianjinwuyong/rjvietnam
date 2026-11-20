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

  it("lets one named person stand at a station without re-opening their role", () => {
    // MO_LI_BIN is the General Manager and holds role `admin`; the factory still
    // needs him to sign in at a terminal, so the exception is per username and is
    // reported as NAMED_OPERATOR so the route can audit it.
    const policy = createStationLoginPolicy({ allowOperators: "MO_LI_BIN" });
    const gm = policy.check("admin", adminPerms, "MO_LI_BIN");
    expect(gm.allowed).toBe(true);
    expect(gm.reason).toBe("NAMED_OPERATOR");

    // Anyone else on the same role stays refused, and the exception is exact.
    expect(policy.check("admin", adminPerms, "admin").allowed).toBe(false);
    expect(policy.check("admin", adminPerms, "MO_LI_BIN_2").allowed).toBe(false);
    expect(policy.check("admin", adminPerms).allowed).toBe(false);
  });

  it("does not need an exception for a floor account", () => {
    const policy = createStationLoginPolicy({ allowOperators: "MO_LI_BIN" });
    expect(policy.check("material_receiver", materialReceiverPerms, "VN_MATERIAL_RECEIVER")).toEqual({
      allowed: true,
      reason: null,
      blocked: [],
    });
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
