// Capability contract API: what each virtual employee may do, on which real
// permission key, through which MCP server, and behind which human gate.
//
// Runtime rule that matters: `write` skills are never self-executable. The
// approval endpoint already refuses a `ve:` actor (service-identity.js
// VE_CANNOT_APPROVE), so a write skill here means "produce a gated draft",
// not "touch the business table". `canUseSkill` is the check the agent tool
// surface must call before dispatching anything.

import { SKILLS } from "./skills-catalog.js";
import { ROLE_CAPABILITIES } from "./role-capabilities.js";
import { MCP_SERVERS, PERMISSION_CODES } from "./mcp-catalog.js";

export { SKILLS, ROLE_CAPABILITIES, MCP_SERVERS, PERMISSION_CODES };

export const SKILL_BY_ID = new Map(SKILLS.map(s => [s.id, s]));
export const ALL_ROLE_IDS = Object.freeze(Object.keys(ROLE_CAPABILITIES));

const MEMORY_MCP = "smt-memory";
const normalize = id => String(id || "").toUpperCase();

export function skillsFor(roleId) {
  return ROLE_CAPABILITIES[normalize(roleId)] || null;
}

function resolvedSkills(roleId) {
  const ids = skillsFor(roleId);
  if (!ids) return null;
  return ids.map(id => SKILL_BY_ID.get(id)).filter(Boolean);
}

export function mcpFor(roleId) {
  const skills = resolvedSkills(roleId);
  if (!skills) return null;
  const set = new Set(skills.flatMap(s => s.mcp));
  set.add(MEMORY_MCP); // every employee recalls and records its own experience
  return [...set];
}

export function permissionsFor(roleId) {
  const skills = resolvedSkills(roleId);
  if (!skills) return null;
  return [...new Set(skills.map(s => s.permission))];
}

// Gates that belong to the role itself: only `write` skills make their gate
// the role's own. `draft` skills name the gate their output will land in, which
// may be another role's (OA drafting a WMS release is the standing example).
export function gatesFor(roleId) {
  const skills = resolvedSkills(roleId);
  if (!skills) return null;
  return [...new Set(skills.filter(s => s.kind === "write" && s.gate).map(s => s.gate))];
}

export function capabilitiesFor(roleId) {
  const skills = resolvedSkills(roleId);
  if (!skills) return null;
  return {
    roleId: normalize(roleId),
    skills,
    skillIds: skills.map(s => s.id),
    mcpServers: mcpFor(roleId),
    permissions: permissionsFor(roleId),
    gates: gatesFor(roleId),
    counts: {
      read: skills.filter(s => s.kind === "read").length,
      draft: skills.filter(s => s.kind === "draft").length,
      write: skills.filter(s => s.kind === "write").length,
      mcp: mcpFor(roleId).length,
    },
  };
}

export function canUseSkill(roleId, skillId) {
  const ids = skillsFor(roleId);
  if (!ids) return { ok: false, code: "ROLE_NOT_DECLARED", roleId: normalize(roleId) };
  const skill = SKILL_BY_ID.get(skillId);
  if (!skill) return { ok: false, code: "SKILL_UNKNOWN", skillId };
  if (!ids.includes(skillId)) return { ok: false, code: "SKILL_NOT_DECLARED_FOR_ROLE", roleId: normalize(roleId), skillId };
  if (skill.kind === "write") {
    return { ok: true, skill, mode: "GATED_DRAFT", gate: skill.gate,
      note: "写技能只能产出带人工门的草稿任务，执行需具名人类批准" };
  }
  return { ok: true, skill, mode: skill.kind === "draft" ? "DRAFT" : "READ" };
}

// Static self-audit. Returns a list of problems; empty means the contract is
// internally consistent (the live-DB parity checks live in the check script).
/**
 * @param {{ registryEntries?: readonly any[] }} [options]
 */
export function auditCapabilities({ registryEntries = [] } = {}) {
  const problems = [];
  const warnings = [];
  const push = (code, detail) => problems.push({ code, ...detail });

  const seen = new Set();
  for (const skill of SKILLS) {
    if (seen.has(skill.id)) push("DUPLICATE_SKILL_ID", { skillId: skill.id });
    seen.add(skill.id);
    if (!PERMISSION_CODES.includes(skill.permission)) {
      push("PERMISSION_NOT_IN_CATALOG", { skillId: skill.id, permission: skill.permission });
    }
    for (const m of skill.mcp) {
      if (!MCP_SERVERS[m]) push("MCP_NOT_IN_CATALOG", { skillId: skill.id, mcp: m });
    }
    if (skill.kind === "write" && !skill.gate) push("WRITE_WITHOUT_GATE", { skillId: skill.id });
    if (skill.kind !== "write" && skill.permission.endsWith(".manage") && skill.kind === "read") {
      push("READ_ON_MANAGE_PERMISSION", { skillId: skill.id, permission: skill.permission });
    }
  }

  for (const [roleId, ids] of Object.entries(ROLE_CAPABILITIES)) {
    if (!/^[A-Z0-9-]+$/.test(roleId)) push("ROLE_ID_MALFORMED", { roleId });
    if (!ids.length) push("ROLE_WITHOUT_SKILLS", { roleId });
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) push("ROLE_DUPLICATE_SKILLS", { roleId, skills: [...new Set(dup)] });
    for (const id of ids) {
      if (!SKILL_BY_ID.has(id)) push("SKILL_NOT_DEFINED", { roleId, skillId: id });
    }
  }

  for (const entry of registryEntries) {
    const roleId = normalize(entry.id);
    const declared = ROLE_CAPABILITIES[roleId];
    if (!declared) { push("REGISTRY_ROLE_UNDECLARED", { roleId }); continue; }
    const missing = (entry.capabilities || []).filter(c => !declared.includes(c));
    if (missing.length) push("REGISTRY_CAPABILITY_MISSING", { roleId, skills: missing });
    // The enforceable direction: a write skill whose gate is not registered on
    // the role is refused at runtime by validateGateForApproval (GATE_NOT_
    // REGISTERED), so the contract must not promise it.
    const humanGates = new Set(entry.humanGates || []);
    const owned = (resolvedSkills(roleId) || []).filter(s => s.kind === "write" && s.gate);
    const unregistered = owned.filter(s => !humanGates.has(s.gate));
    if (unregistered.length) {
      push("WRITE_GATE_NOT_IN_REGISTRY", { roleId, gates: unregistered.map(s => `${s.id}→${s.gate}`) });
    }
    // A registered gate with no write skill behind it is only informational:
    // some gates exist so a human can approve work this role drafted (OPS
    // coordinating another domain's release is the standing example).
    const unexercised = [...humanGates].filter(g => !owned.some(s => s.gate === g));
    if (unexercised.length) warnings.push({ code: "HUMAN_ONLY_GATE", roleId, gates: unexercised });
  }

  const unused = SKILLS.filter(s => !Object.values(ROLE_CAPABILITIES).some(ids => ids.includes(s.id)));
  for (const s of unused) push("SKILL_ASSIGNED_TO_NOBODY", { skillId: s.id });

  return { problems, warnings, skills: SKILLS.length, roles: ALL_ROLE_IDS.length };
}
