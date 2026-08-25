import type { FactoryModule } from "../_shared/module";

export const authModule: FactoryModule = {
  key: "auth",
  name: "Authentication, sessions, and access control",
  owns: ["login sessions", "current user contract", "role-based access control", "auth audit events"],
  routes: [
    { method: "POST", path: "/auth/login", summary: "Authenticate a user and issue a session", public: true },
    {
      method: "POST",
      path: "/auth/logout",
      summary: "Revoke the active session and write an audit event",
      requiredPermissions: ["auth.session.manage"],
    },
    {
      method: "GET",
      path: "/auth/session",
      summary: "Return the current authenticated session and user contract",
      requiredPermissions: ["auth.session.read"],
    },
    {
      method: "GET",
      path: "/auth/sessions",
      summary: "List active sessions for the current user or an admin viewer",
      requiredPermissions: ["auth.session.manage"],
    },
    {
      method: "DELETE",
      path: "/auth/sessions/{sessionId}",
      summary: "Revoke a specific session",
      requiredPermissions: ["auth.session.manage"],
    },
    {
      method: "GET",
      path: "/auth/audit-events",
      summary: "Search audit-friendly authentication events",
      requiredPermissions: ["admin.audit.read"],
    },
  ],
};
