import type { FactoryModule } from "../_shared/module";

export const adminModule: FactoryModule = {
  key: "admin",
  name: "Security and factory settings",
  owns: ["users", "roles", "permissions", "coding rules", "shifts", "audit logs"],
  routes: [
    {
      method: "GET",
      path: "/admin/users",
      summary: "List factory users and role assignments",
      requiredPermissions: ["admin.users.manage"],
    },
    {
      method: "POST",
      path: "/admin/users",
      summary: "Create a factory user",
      requiredPermissions: ["admin.users.manage"],
    },
    {
      method: "PATCH",
      path: "/admin/users/{userId}",
      summary: "Update user profile, role, locale, or status",
      requiredPermissions: ["admin.users.manage"],
    },
    {
      method: "GET",
      path: "/admin/roles",
      summary: "List role and menu permission matrix",
      requiredPermissions: ["admin.roles.manage"],
    },
    {
      method: "PATCH",
      path: "/admin/roles/{roleKey}",
      summary: "Update a role permission set",
      requiredPermissions: ["admin.roles.manage"],
    },
    {
      method: "GET",
      path: "/admin/audit-logs",
      summary: "Search auditable user and system actions",
      requiredPermissions: ["admin.audit.read"],
    },
    {
      method: "GET",
      path: "/admin/settings",
      summary: "Read factory-wide settings such as shifts, calendars, and code rules",
      requiredPermissions: ["admin.settings.manage"],
    },
    {
      method: "PATCH",
      path: "/admin/settings",
      summary: "Update factory-wide settings",
      requiredPermissions: ["admin.settings.manage"],
    },
  ],
};
