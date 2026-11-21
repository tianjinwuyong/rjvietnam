// Scoped identity for virtual employees and the human-gate contract.
//
// A service token is NOT a login session: authenticateJWT would reject it
// because its userId is not in the account-state map. It is an additional,
// independently signed credential passed in `x-ve-token`, and it is accepted
// only by virtual-employee routes that explicitly opt in.
//
// The signing key is derived from JWT_SECRET so no new environment variable is
// needed. Changing JWT_SECRET invalidates all service tokens, which is the
// desired behaviour.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const SERVICE_SCOPE = "factory-virtual-employee/v1";
const DEFAULT_TTL_SECONDS = 3600;

function signingKey() {
  const secret = String(process.env.JWT_SECRET ?? "").trim();
  if (!secret || secret === "change_me_in_production") {
    throw new Error("JWT_SECRET must be configured before issuing a virtual-employee token");
  }
  return createHmac("sha256", secret).update(SERVICE_SCOPE).digest();
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function mintServiceToken(employeeId, scope = "task:create", ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now()) {
  if (!employeeId || typeof employeeId !== "string") throw new Error("employeeId is required");
  const allowed = ["task:create"];
  const scopes = String(scope).split(/\s+/).filter(Boolean);
  if (!scopes.length || scopes.some(s => !allowed.includes(s))) throw new Error(`unsupported scope: ${scope}`);
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error("ttlSeconds must be between 60 and 86400");
  return sign({ ve: employeeId.toUpperCase(), scope: scopes, exp: now + ttl * 1000, jti: randomUUID() });
}

export function verifyServiceToken(token, now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac, ...extra] = token.split(".");
  if (extra.length || !body || !mac) return null;
  let expected;
  try {
    expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  } catch {
    return null;
  }
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.ve || !Array.isArray(payload.scope) || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= now) return null;
  return payload;
}

export function serviceActorFor(req, employeeId) {
  const token = req?.headers?.["x-ve-token"];
  if (!token) return { ok: true, actor: req?.user?.username || "system", service: false };
  const payload = verifyServiceToken(Array.isArray(token) ? token[0] : token);
  if (!payload) return { ok: false, code: "VE_TOKEN_INVALID" };
  if (payload.ve !== String(employeeId || "").toUpperCase()) return { ok: false, code: "VE_TOKEN_EMPLOYEE_MISMATCH" };
  if (!payload.scope.includes("task:create")) return { ok: false, code: "VE_TOKEN_SCOPE_DENIED" };
  return { ok: true, actor: `ve:${payload.ve}`, service: true };
}

export function hasServiceToken(req) {
  return Boolean(req?.headers?.["x-ve-token"]);
}

// Pure gate contract. The approval route must call this before UPDATE, so a
// stale task or a gate that is not registered can never be "approved" into an
// executable task.
export function validateGateForApproval(employee, task) {
  if (!task) return { ok: false, code: "TASK_NOT_FOUND" };
  if (task.status !== "WAITING_APPROVAL") return { ok: false, code: "TASK_NOT_WAITING" };
  if (!task.requires_human) return { ok: false, code: "NOT_A_HUMAN_GATE" };
  const gate = String(task.human_gate || task.input?.action || "").trim();
  if (!gate) return { ok: false, code: "GATE_NOT_SPECIFIED" };
  if (!employee) return { ok: false, code: "EMPLOYEE_NOT_FOUND" };
  if (!Array.isArray(employee.humanGates) || !employee.humanGates.includes(gate)) {
    return { ok: false, code: "GATE_NOT_REGISTERED" };
  }
  return { ok: true, gate };
}

// Permission keys below are the real ones present in the seeded role catalog
// (admin carries wms.execute, finance.manage, procurement.manage, qms.execute).
// Domains without a matching key keep the pre-existing "any authenticated
// human" rule. A virtual employee can never act as the human principal.
const DOMAIN_PERMISSION = {
  wms: "wms.execute",
  procurement: "procurement.manage",
  finance: "finance.manage",
  quality: "quality.write",
  qms: "qms.execute",
};

export function humanDomainPermission(req, employee) {
  if (hasServiceToken(req)) return { ok: false, code: "VE_CANNOT_ACT_AS_HUMAN" };
  if (!req?.user?.username) return { ok: false, code: "UNAUTHORIZED" };
  const required = DOMAIN_PERMISSION[employee?.domain];
  if (required && !req.user.permissions?.includes("*") && !req.user.permissions?.includes(required)) {
    return { ok: false, code: "FORBIDDEN", required };
  }
  return { ok: true, actor: req.user.username };
}

export function canHumanApprove(req, employee) {
  const human = humanDomainPermission(req, employee);
  if (!human.ok && human.code === "VE_CANNOT_ACT_AS_HUMAN") return { ok: false, code: "VE_CANNOT_APPROVE" };
  return human;
}
