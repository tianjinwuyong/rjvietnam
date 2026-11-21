// Knowledge policy for the single shared RAG service (mem0 :9876, one Qdrant
// collection). One store, logical namespace per employee — never one index per
// employee: the embedding model, dims, backup and the leak surface are shared,
// so the isolation has to be enforced at write and read time, here.
//
// Namespaces:
//   ve/<EMPLOYEE_ID>   an employee's own experience
//   ve/shared/*        cross-employee knowledge, supervisor-approved
//   worker/<domain>    existing runtime managers

import { createMemoryClient } from "./memory-client.js";

export const SHARED_AGENT_ID = "ve/shared/general";
export const SHARED_PREFIX = "ve/shared/";

// The shared corpus is split so a citation says what kind of authority it is:
// supervisor-approved practice, controlled documents (versioned), or exception
// signatures. All three are readable by every employee; none of them is
// somebody's private experience.
export const SHARED_NAMESPACES = Object.freeze([
  "ve/shared/general", "ve/shared/controlled-docs", "ve/shared/exception-signatures",
]);

// Callers pass either a namespace name or `true` for the default shared one
// (`remember({ shared: true })`), so the parameter accepts both.
/** @param {string | boolean} [which] */
export function sharedAgentId(which = "general") {
  const name = String(which === true ? "general" : which || "general");
  return name.startsWith(SHARED_PREFIX) ? name : `${SHARED_PREFIX}${name}`;
}

// Transient runtime snapshots belong in the JSON state file or PostgreSQL, not
// in the vector index. They were the bulk of the old collection and made
// retrieval return "last cycle's counts" instead of lessons.
export const DISCARDED_TYPES = Object.freeze([
  "wms_state", "bom_state", "hr_state", "finance_state", "pmc_state",
  "mes_state", "plant_state", "procurement_state", "agv_state",
]);

export const ALLOWED_TYPES = Object.freeze([
  "correction", "approved_decision", "exception_signature", "rule_reference",
]);

// Cross-employee queries (supervisor, memory-trends) must name the
// namespaces explicitly — a plain /search_all over every agent would mix the
// runtime managers' corpora into an employee's judgement.
export function veAgentIds(employeeIds, { includeShared = true } = {}) {
  const ids = [...new Set(employeeIds.map(employeeAgentId))];
  return includeShared ? [...ids, ...SHARED_NAMESPACES] : ids;
}
export function employeeAgentId(employeeId) {
  return `ve/${String(employeeId).toUpperCase()}`;
}

function hasSource(meta) {
  return Boolean(meta?.sourceType && (meta.sourceId !== undefined && meta.sourceId !== null));
}

// Pure decision: store, or refuse with a reason. Never a silent drop.
export function knowledgeVerdict(agentId, content, meta = {}) {
  if (!agentId || !String(agentId).startsWith("ve/")) return { accept: false, reason: "NAMESPACE_NOT_VE" };
  if (!/^[A-Z0-9-]+$/.test(String(agentId).split("/")[1] || "")) {
    if (agentId !== SHARED_AGENT_ID && !agentId.startsWith("ve/shared/")) return { accept: false, reason: "NAMESPACE_MALFORMED" };
  }
  if (DISCARDED_TYPES.includes(meta.type)) return { accept: false, reason: "TRANSIENT_STATE" };
  if (!ALLOWED_TYPES.includes(meta.type)) return { accept: false, reason: "TYPE_NOT_ALLOWED" };
  const text = String(content || "").trim();
  if (text.length < 24) return { accept: false, reason: "TOO_SHORT_TO_BE_KNOWLEDGE" };
  if (/(password|secret|token|身份证号|身份证|薪资本金)/i.test(text)) return { accept: false, reason: "SENSITIVE_CONTENT" };
  if (!hasSource(meta)) return { accept: false, reason: "SOURCE_REQUIRED" };
  if (!meta.expiresAt && !meta.docVersion) return { accept: false, reason: "EXPIRY_OR_VERSION_REQUIRED" };
  return { accept: true };
}

export function createKnowledgeService({ clientFactory = createMemoryClient, now = () => Date.now() } = {}) {
  const cache = new Map();
  const clientFor = agentId => {
    if (!cache.has(agentId)) cache.set(agentId, clientFactory({ agentId }));
    return cache.get(agentId);
  };

  return {
    async remember({ employeeId, type, content, sourceType, sourceId, docVersion, expiresAt, shared = false }) {
      const agentId = shared ? sharedAgentId(shared) : employeeAgentId(employeeId);
      const meta = { type, sourceType, sourceId, docVersion, expiresAt, employeeId: shared ? null : employeeId };
      const verdict = knowledgeVerdict(agentId, content, meta);
      if (!verdict.accept) return { stored: false, reason: verdict.reason, agentId };
      await clientFor(agentId).store(content, { ...meta, recordedAt: new Date(now()).toISOString() }, { infer: false });
      return { stored: true, agentId, type };
    },

    // Scoped retrieval: own namespace + the shared corpora. Another employee's
    // private experience is never pulled into a colleague's context; only the
    // supervisor-approved and controlled-document spaces are.
    async recall({ employeeId, query, topK = 5, threshold = 0.35, sharedOnly = null }) {
      const scopes = sharedOnly
        ? (Array.isArray(sharedOnly) ? sharedOnly.map(sharedAgentId) : [sharedAgentId(sharedOnly)])
        : [employeeAgentId(employeeId), ...SHARED_NAMESPACES];
      const cut = now();
      const buckets = await Promise.all(scopes.map(agentId =>
        clientFor(agentId).search(query, topK, threshold)
          .then(r => (r.results || []).map(x => ({ ...x, agent_id: x.agent_id || agentId })))
          .catch(() => [])));
      const merged = buckets.flat()
        .filter(x => !x.metadata?.expiresAt || Date.parse(x.metadata.expiresAt) > cut)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, topK);
      return { employeeId, scopes, results: merged, cited: merged.map(x => ({
        memoryId: x.id, agentId: x.agent_id, type: x.metadata?.type || null,
        docVersion: x.metadata?.docVersion || null, sourceType: x.metadata?.sourceType || null,
        sourceId: x.metadata?.sourceId ?? null, score: x.score ?? null,
      })) };
    },
  };
}
