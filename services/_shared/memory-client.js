/**
 * memory-client.js — Node.js client for the mem0 memory server
 *
 * Thin HTTP wrapper around memory_server.py. Every AI manager
 * (MES, WMS, BOM, HR, Plant, etc.) uses this to persist and
 * recall state across patrol cycles instead of crude *-last-state.json.
 *
 * Usage:
 *   import { createMemoryClient } from "../../_shared/memory-client.js";
 *
 *   const mem = createMemoryClient({ agentId: "mes-ai" });
 *   await mem.store("Line L001 OEE=78.5%, 3 WOs running");
 *   const results = await mem.search("Line L001 performance");
 *   const all = await mem.getAll();
 *
 * Configuration (by priority):
 *   1. MEMORY_SERVER_URL env var (e.g. "http://127.0.0.1:9876")
 *   2. Default: "http://127.0.0.1:9876"
 */

const DEFAULT_MEMORY_URL = "http://127.0.0.1:9876";

// ── Helpers ───────────────────────────────────────────────────────────

function getBaseUrl() {
  return process.env.MEMORY_SERVER_URL || DEFAULT_MEMORY_URL;
}

/**
 * Internal POST helper.
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>}
 */
async function _post(path, body) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Memory server error (${res.status}): ${data.error || JSON.stringify(data)}`);
  }
  if (data.error) {
    throw new Error(`Memory server error: ${data.error}`);
  }
  return data;
}

// ── Health check ──────────────────────────────────────────────────────

/**
 * Check if the memory server is running and responsive.
 * @returns {Promise<{ok: boolean, status: string, memories_total: number}>}
 */
export async function memoryHealth() {
  try {
    const url = `${getBaseUrl()}/health`;
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    return { ok: false, status: `unreachable: ${err.message}`, memories_total: -1 };
  }
}

// ── Client factory ────────────────────────────────────────────────────

/**
 * Create a memory client scoped to an agent.
 *
 * @param {object} opts
 * @param {string} opts.agentId  - Agent identifier (e.g. "mes-ai", "wms-ai", "plant-ai")
 * @returns {{
 *   store,        // (messages, metadata?) => Promise<object>
 *   search,       // (query, top_k?, threshold?) => Promise<object>
 *   getAll,       // (top_k?) => Promise<object>
 *   delete,       // (memoryId?) => Promise<object>
 *   deleteAll,    // () => Promise<object>
 *   health,       // () => Promise<object>
 *   agentId,      // string
 * }}
 */
export function createMemoryClient({ agentId }) {
  if (!agentId) throw new Error("agentId is required for memory client");

  return {
    agentId,

    /**
     * Store a memory for this agent.
     * @param {string|string[]} messages  - Facts or observations to remember
     * @param {object} [metadata={}]       - Extra context (line, type, ts, etc.)
     * @param {object} [opts]             - { infer: true/false }
     * @returns {Promise<object>}          mem0 response with results[]
     */
    async store(messages, metadata = {}, opts = {}) {
      return _post("/store", {
        messages,
        agent_id: agentId,
        metadata,
        infer: opts.infer !== false,
      });
    },

    /**
     * Search memories by semantic similarity.
     * @param {string} query         - Natural language query
     * @param {number} [topK=20]
     * @param {number} [threshold=0.1]
     * @returns {Promise<object>}    { results: [...] }
     */
    async search(query, topK = 20, threshold = 0.1) {
      return _post("/search", {
        query,
        agent_id: agentId,
        top_k: topK,
        threshold,
      });
    },

    /**
     * Search memories across one, multiple, or all agents.
     * @param {string} query              - Natural language query
     * @param {string[]} [agentIds]       - Restrict to these agents; omit = all agents
     * @param {number} [topK=20]
     * @param {number} [threshold=0.1]
     * @returns {Promise<object>}         { results: [...] }
     */
    async searchAll(query, agentIds, topK = 20, threshold = 0.1) {
      return _post("/search_all", {
        query,
        agent_ids: agentIds,
        top_k: topK,
        threshold,
      });
    },

    /**
     * Retrieve all memories for this agent.
     * @param {number} [topK=20]
     * @returns {Promise<object>}    { results: [...], count: N }
     */
    async getAll(topK = 50) {
      return _post("/get_all", {
        agent_id: agentId,
        top_k: topK,
      });
    },

    /**
     * Delete a specific memory by ID, or all memories for this agent.
     * @param {string} [memoryId]   - Specific memory to delete
     * @returns {Promise<object>}
     */
    async delete(memoryId) {
      return _post("/delete", {
        memory_id: memoryId,
        agent_id: memoryId ? undefined : agentId,
      });
    },

    /**
     * Delete ALL memories for this agent.
     * @returns {Promise<object>}
     */
    async deleteAll() {
      return _post("/delete", { agent_id: agentId });
    },

    /**
     * Health check.
     * @returns {Promise<{ok: boolean, status: string}>}
     */
    async health() {
      return memoryHealth();
    },
  };
}

// ── Default export ────────────────────────────────────────────────────

export default { createMemoryClient, memoryHealth };
