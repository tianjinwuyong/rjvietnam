import { describe, expect, it } from "vitest";
import { roleMatrix, ALL_PERMISSIONS } from "../apps/web/src/data";

// All FactoryPermissionKey values that exist in the system
const ALL_PERMISSION_KEYS = [
  "dashboard.view", "erp.view",
  "pmc.view", "pmc.manage",
  "wms.view", "wms.receive", "wms.iqc", "wms.issue",
  "mes.view", "mes.execute",
  "quality.view", "quality.review",
  "traceability.view", "reports.view",
  "finance.view", "finance.manage",
  "sales.view", "sales.manage",
  "service.view", "service.manage",
  "admin.view", "admin.users.manage", "admin.roles.manage",
  "admin.audit.read", "admin.settings.manage",
  "auth.session.read", "auth.session.manage",
  "lifecycle.view", "lifecycle.edit", "lifecycle.approve",
] as const;

describe("Admin role — full rights", () => {
  it("admin has every FactoryPermissionKey in the system", () => {
    const adminPerms = roleMatrix.admin;
    for (const key of ALL_PERMISSION_KEYS) {
      expect(adminPerms, `admin should have "${key}"`).toContain(key);
    }
  });

  it("admin permission count equals the total permission set", () => {
    expect(roleMatrix.admin.length).toBe(ALL_PERMISSIONS.length);
  });

  it("admin permission count equals the total permission set", () => {
    // 修复点：将测试断言从硬编码的21更改为基于ALL_PERMISSION_KEYS定义的长度来匹配roleMatrix.admin的实时状态。
    expect(roleMatrix.admin.length).toBe(ALL_PERMISSION_KEYS.length);
  });

  it("admin permissions are unique (no duplicates)", () => {
    const adminPerms = roleMatrix.admin;
    expect(new Set(adminPerms).size).toBe(adminPerms.length);
  });

  it("other roles are properly scoped (not equal to admin)", () => {
    const adminCount = roleMatrix.admin.length;
    for (const [role, perms] of Object.entries(roleMatrix)) {
      if (role === "admin") continue;
      // 验证：其他角色的权限数量应该显著少于Admin的完整集合。
      expect(perms.length).toBeLessThan(adminCount);
    }
  });

  it("admin has the critical write permissions (pmc.manage, wms.receive, wms.issue, mes.execute, quality.review)", () => {
    const adminPerms = roleMatrix.admin;
    const criticalWrites = ["pmc.manage", "wms.receive", "wms.issue", "mes.execute", "quality.review"];
    for (const key of criticalWrites) {
      expect(adminPerms, `admin should have write permission "${key}"`).toContain(key);
    }
  });
});