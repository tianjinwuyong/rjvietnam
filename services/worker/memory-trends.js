/**
 * memory-trends.js — Trend detection & incident recall across AI agents
 *
 * Uses the mem0 memory server to query past agent states, detect
 * patterns, and recall incidents via natural language queries.
 *
 * Usage:
 *   import { queryIncidents, detectTrends, getAgentTimeline } from "./memory-trends.js";
 *
 *   // Natural language recall across all agents
 *   const incidents = await queryIncidents("OEE drops on L001 last week");
 *
 *   // Trend analysis for specific agents
 *   const trends = await detectTrends(["wms-ai", "pmc-ai"], 7);
 *
 *   // Timeline for one agent
 *   const timeline = await getAgentTimeline("plant-ai", 3);
 */

import { createMemoryClient } from "../_shared/memory-client.js";

// ── Shared unauthenticated client for cross-agent queries ─────────────────
const _mem = createMemoryClient({ agentId: "__trends__" });

// ── Known agent IDs ───────────────────────────────────────────────────────
const ALL_AGENTS = [
  "plant-ai", "mes-ai", "wms-ai", "bom-ai",
  "hr-ai", "pmc-ai", "procurement-ai", "finance-ai",
];

/**
 * Search memories across all agents with a natural language query.
 * Best for: "what happened on line L003 yesterday", "any incidents last week"
 *
 * @param {string} query        - Natural language question
 * @param {object} [opts]
 * @param {number} [opts.topK=20]
 * @param {string[]} [opts.agentIds] - Restrict to these agents (default: all)
 * @returns {Promise<{results: Array, summary: string}>}
 */
export async function queryIncidents(query, opts = {}) {
  const { topK = 20, agentIds = ALL_AGENTS } = opts;

  const result = await _mem.searchAll(query, agentIds, topK);
  return {
    results: result.results || [],
    summary: result.results?.length
      ? `Found ${result.results.length} relevant memory entries`
      : "No relevant memories found",
  };
}

/**
 * Analyze recent memories for trends across agents.
 * Groups memories by type and flags recurring patterns.
 *
 * @param {string[]} [agentIds]  - Agents to analyze (default: all)
 * @param {number}  [days=7]     - Lookback period
 * @returns {Promise<{trends: Array, agents: object}>}
 */
export async function detectTrends(agentIds = ALL_AGENTS, days = 7) {
  const results = [];

  for (const agentId of agentIds) {
    const mem = createMemoryClient({ agentId });
    const data = await mem.getAll(50);
    const memories = data.results || [];
    if (memories.length === 0) continue;

    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const recent = memories.filter(m =>
      m.metadata?.ts >= cutoff || m.created_at >= cutoff
    );

    // Categorize by metadata type
    const byType = {};
    for (const m of recent) {
      const type = m.metadata?.type || "unknown";
      if (!byType[type]) byType[type] = [];
      byType[type].push(m);
    }

    results.push({
      agentId,
      recentCount: recent.length,
      totalCount: memories.length,
      byType,
    });
  }

  // Detect cross-agent patterns: same issues appearing in multiple agents
  const crossAgentFlags = detectCrossAgentFlags(results);

  return { trends: results, crossAgentFlags };
}

/**
 * Get a chronological timeline of state changes for one agent.
 *
 * @param {string} agentId     - e.g. "plant-ai", "wms-ai"
 * @param {number} [days=7]    - Lookback period
 * @returns {Promise<{timeline: Array, agentId: string}>}
 */
export async function getAgentTimeline(agentId, days = 7) {
  const mem = createMemoryClient({ agentId });
  const data = await mem.getAll(100);
  const memories = data.results || [];

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const filtered = memories.filter(m =>
    m.metadata?.ts >= cutoff || m.created_at >= cutoff
  );

  // Sort chronologically
  filtered.sort((a, b) => {
    const ta = a.metadata?.ts || a.created_at || "";
    const tb = b.metadata?.ts || b.created_at || "";
    return ta.localeCompare(tb);
  });

  return {
    agentId,
    timeline: filtered.map(m => ({
      ts: m.metadata?.ts || m.created_at,
      type: m.metadata?.type || "unknown",
      text: m.messages || m.text || "",
      state: m.metadata?.state,
    })),
    total: filtered.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function detectCrossAgentFlags(trends) {
  const flags = [];

  // Check for agents with zero recent data (potential downtime)
  const silentAgents = trends.filter(t => t.recentCount === 0);
  if (silentAgents.length > 0) {
    flags.push({
      type: "silent_agents",
      severity: "warning",
      detail: `${silentAgents.map(t => t.agentId).join(", ")} have no recent memory data`,
      agents: silentAgents.map(t => t.agentId),
    });
  }

  return flags;
}

// ── CLI entry point ───────────────────────────────────────────────────────
// node memory-trends.js query "what happened on L001"
// node memory-trends.js trends --days 7
// node memory-trends.js timeline plant-ai --days 3

const COMMANDS = {
  async query(args) {
    const q = args[0];
    if (!q) { console.log("Usage: memory-trends.js query \"<question>\""); return; }
    const result = await queryIncidents(q);
    console.log(JSON.stringify(result, null, 2));
  },

  async trends(args) {
    const daysIdx = args.indexOf("--days");
    const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 7;
    const result = await detectTrends(ALL_AGENTS, days);
    console.log(JSON.stringify(result, null, 2));
  },

  async timeline(args) {
    const agentId = args[0];
    if (!agentId) { console.log("Usage: memory-trends.js timeline <agentId> [--days N]"); return; }
    const daysIdx = args.indexOf("--days");
    const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 7;
    const result = await getAgentTimeline(agentId, days);
    console.log(JSON.stringify(result, null, 2));
  },
};

const cmd = process.argv[2];
if (cmd && COMMANDS[cmd]) {
  COMMANDS[cmd](process.argv.slice(3)).catch(e => console.error("Error:", e.message));
}
