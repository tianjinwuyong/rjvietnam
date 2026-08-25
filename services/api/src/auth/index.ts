/**
 * auth/index.ts — Factory authentication utilities.
 */

import type { AuthDirectoryRecord } from "../../../../packages/shared-types/src/factory";

// ── AuthError ────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly auditEvent: {
      eventType: string;
      actor?: string;
      source?: string;
      occurredAt?: Date;
    },
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ── Types ─────────────────────────────────────────────────────────────

interface Credentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

interface AuditContext {
  actor?: string;
  source?: string;
  occurredAt?: Date;
}

interface SessionUser {
  username: string;
  permissions: string[];
  locale?: string;
}

interface Session {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
  rememberMe: boolean;
}

interface LoginResult {
  session: Session;
  auditEvent: {
    eventType: "login_success" | "login_failure";
    actor?: string;
    source?: string;
    occurredAt?: Date;
  };
}

interface CurrentUserResponse {
  session: {
    sessionId: string;
    user: {
      username: string;
      permissions: string[];
      locale?: string;
    };
    expiresAt: string;
  };
  permissions: string[];
  token?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateSessionId(): string {
  return "sess_" + Date.now().toString() + "_" + Math.random().toString(36).slice(2, 11);
}

function base64url(input: string): string {
  const b64 = Buffer.from(input).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateToken(sessionId: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sid: sessionId, iat: Math.floor(Date.now() / 1000) }));
  const sig = base64url("fake-sig-" + sessionId);
  return header + "." + payload + "." + sig;
}

// ── Permission Resolution ────────────────────────────────────────────

const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin: [
    "admin.users.manage", "admin.roles.manage", "admin.audit.read", "admin.settings.manage",
    "traceability.view", "wms.view", "wms.issue", "wms.receive", "wms.putaway",
    "mes.view", "mes.scan", "quality.view", "pmc.view", "reports.view", "erp.view",
    "hr.employee.view", "hr.attendance.edit", "hr.leave.view", "hr.leave.approve",
    "maintenance.view", "maintenance.manage",
  ],
  management: [
    "dashboard.view", "wms.view", "wms.issue", "traceability.view",
    "mes.view", "quality.view", "pmc.view", "reports.view",
    "hr.employee.view", "hr.attendance.view", "hr.leave.view",
    "maintenance.view",
  ],
  engineer: [
    "dashboard.view", "mes.view", "mes.scan", "quality.view", "traceability.view",
    "pmc.view", "reports.view", "maintenance.view", "maintenance.manage",
  ],
  operator: [
    "mes.scan", "mes.view",
  ],
  warehouse: [
    "wms.view", "wms.issue", "wms.receive", "wms.putaway", "traceability.view",
  ],
};

export function resolvePermissionsForRole(roleKey: string): string[] {
  return ROLE_DEFAULT_PERMISSIONS[roleKey] ?? [];
}

export function canAccessModule(permissions: string[], moduleKey: string): boolean {
  return permissions.some((p) => p.startsWith(moduleKey + ".") || p === moduleKey + ".view");
}

// ── Authenticate ─────────────────────────────────────────────────────

export function authenticateFactoryUser(
  credentials: Credentials,
  directory: AuthDirectoryRecord[],
  validatePassword: (password: string) => boolean,
  auditContext: AuditContext,
): LoginResult {
  const { username, password, rememberMe = false } = credentials;

  const record = directory.find(
    (u) => u.username.toLowerCase() === username.toLowerCase(),
  );

  if (!record || record.status !== "active") {
    const event = {
      eventType: "login_failure" as const,
      actor: auditContext.actor,
      source: auditContext.source,
      occurredAt: auditContext.occurredAt ?? new Date(),
    };
    throw new AuthError("Invalid credentials for user: " + username, event);
  }

  if (!validatePassword(password)) {
    const event = {
      eventType: "login_failure" as const,
      actor: auditContext.actor,
      source: auditContext.source,
      occurredAt: auditContext.occurredAt ?? new Date(),
    };
    throw new AuthError("Invalid password", event);
  }

  const permissions = resolvePermissionsForRole(record.roleKey);
  const sessionId = generateSessionId();
  const ms = (rememberMe ? 7 : 1) * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ms);

  return {
    session: {
      sessionId,
      user: {
        username: record.username,
        permissions,
        locale: record.locale,
      },
      expiresAt,
      rememberMe,
    },
    auditEvent: {
      eventType: "login_success",
      actor: auditContext.actor,
      source: auditContext.source,
      occurredAt: auditContext.occurredAt ?? new Date(),
    },
  };
}

// ── Current User Response ─────────────────────────────────────────────

export function buildCurrentUserResponse(session: Session): CurrentUserResponse {
  return {
    session: {
      sessionId: session.sessionId,
      user: {
        username: session.user.username,
        permissions: session.user.permissions,
        locale: session.user.locale,
      },
      expiresAt: session.expiresAt.toISOString(),
    },
    permissions: session.user.permissions,
    token: generateToken(session.sessionId),
  };
}
