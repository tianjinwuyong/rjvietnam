/**
 * llm-router.js — Shared multi-LLM routing for all managers
 *
 * Routes LLM calls to the best model for each task type.
 * Supports local Ollama models, Ollama cloud models, and OpenAI-compatible APIs.
 *
 * Task types:
 *   local tier (default, no API key needed):
 *     analysis  → Ornith-9B         (domain expert for factory data)
 *     validator → phi4:14b           (strong reasoning, stable output)
 *     reasoning → deepseek-r1:8b     (chain-of-thought)
 *     quick     → llama3.2:3b        (fast, cheap)
 *     sql       → qwen2.5:7b         (tools + SQL capable)
 *     vision    → minicpm-v4.5:8b    (image understanding)
 *     general   → qwen2.5:7b         (fallback)
 *
 *   premium tier (Ollama cloud, needs internet):
 *     premium   → minimax-m3:cloud   (524K context, reasoning+vision)
 *     long_doc  → glm-5.2:cloud      (1M context, 756B params)
 *
 *   cloud tier (OpenAI, needs OPENAI_API_KEY):
 *     openai    → gpt-4o / gpt-4o-mini
 *
 * Usage:
 *   import { askLLM, askLLMWithFallback } from "../_shared/llm-router.js";
 *
 *   // Single model
 *   const text = await askLLM("analysis", prompt);
 *
 *   // Auto-fallback: try Ornith → phi4 → qwen2.5
 *   const text = await askLLMWithFallback("analysis", prompt);
 *
 *   // Force premium tier (Ollama cloud)
 *   const text = await askLLMWithFallback("analysis", prompt, { tier: "premium" });
 *
 *   // Force OpenAI
 *   const text = await askLLMWithFallback("analysis", prompt, { tier: "cloud" });
 */

import { appendFileSync } from "fs";

// ── Model routing table ───────────────────────────────────────────────
const MODEL_FOR_TASK = {
  // Local models
  analysis:  "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M",
  validator: "phi4:14b",
  reasoning: "deepseek-r1:8b",
  quick:     "llama3.2:3b",
  sql:       process.env.QWEN_MODEL || "qwen2.5:7b",
  vision:    "minicpm-v4.5:8b",
  general:   process.env.QWEN_MODEL || "qwen2.5:7b",

  // Ollama cloud models (premium tier)
  premium:   process.env.MINIMAX_MODEL || "MiniMax-M2.7",
  long_doc:  "glm-5.2:cloud",
};

const OLLAMA_BASE = "http://localhost:11434";

// ── Tier definitions (ordered fallback chains) ─────────────────────────
// Each tier defines which task types to try in order.
const TIERS = {
  local:   { tasks: ["analysis", "validator", "general"],             desc: "Ornith → phi4 → qwen2.5" },
  premium: { tasks: ["premium", "analysis", "validator", "general"],  desc: "MiniMax-M2.7 → Ornith → phi4 → qwen2.5" },
  cloud:   { tasks: ["openai", "premium", "analysis", "validator"],   desc: "GPT-4o → minimax-m3 → Ornith → phi4" },
};

// ── Logging ───────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] [LLM] ${msg}`;
  console.log(line);
}

// ── Low-level Ollama call ──────────────────────────────────────────────
async function ollamaComplete(model, body, timeoutMs = 300000) {
  const endpoint = `${OLLAMA_BASE}/api/generate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, ...body, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Ollama ${res.status} ${res.statusText}`);
    return (await res.json()).response || "";
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`Ollama timeout (${timeoutMs}ms) for model ${model}`);
    throw err;
  }
}

// ── OpenAI-compatible API call ─────────────────────────────────────────
async function openAIComplete(model, prompt, timeoutMs = 120000) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const endpoint = `${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || process.env.OPENAI_MODEL || "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`OpenAI timeout (${timeoutMs}ms)`);
    throw err;
  }
}

async function minimaxComplete(model, prompt, timeoutMs = 120000) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not set");
  const endpoint = `${process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1"}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || "MiniMax-M2.7", messages: [{ role: "user", content: prompt }], stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`MiniMax ${res.status}: ${res.statusText}`);
    return (await res.json()).choices?.[0]?.message?.content || "";
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`MiniMax timeout (${timeoutMs}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Route a single LLM call ───────────────────────────────────────────
/**
 * Call an LLM with the model mapped to the given task type.
 *
 * @param {string} taskType  - analysis|validator|reasoning|premium|openai|quick|sql|vision|general
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.model]       - override model name
 * @param {number} [opts.temperature]
 * @param {object} [opts.options]     - extra Ollama params
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>}
 */
export async function askLLM(taskType, prompt, opts = {}) {
  const model = opts.model || MODEL_FOR_TASK[taskType] || MODEL_FOR_TASK.general;

  log("INFO", `Task=${taskType} → Model=${model} chars=${prompt.length}`);

  try {
    let response;
    if (process.env.LLM_ROUTER_PROVIDER === "omniroute") {
      response = await openAIComplete(process.env.OMNIROUTE_MODEL || model || "auto/coding", prompt, opts.timeoutMs || 120000);
    } else if (taskType === "premium" || taskType === "minimax" || model.startsWith("MiniMax-")) {
      response = await minimaxComplete(model, prompt, opts.timeoutMs || 120000);
    } else if (taskType === "openai" || opts.model?.startsWith("gpt-") || opts.model?.startsWith("o")) {
      response = await openAIComplete(model, prompt, opts.timeoutMs || 120000);
    } else {
      const body = {
        prompt,
        ...(opts.temperature !== undefined && { temperature: opts.temperature }),
        ...opts.options,
      };
      response = await ollamaComplete(model, body, opts.timeoutMs);
    }
    log("INFO", `Model=${model} responded ${response.length} chars`);
    return response;
  } catch (err) {
    log("ERROR", `Model=${model} failed: ${err.message}`);
    throw err;
  }
}

// ── Tier-based call with automatic fallback ────────────────────────────

/**
 * Call with automatic fallback across models in the specified tier.
 *
 * @param {string} taskType  - base task type (used for the first attempt)
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.tier]       - "local" (default) | "premium" | "cloud"
 * @param {string[]} [opts.fallbackChain] - explicit chain of task types to try
 * @param {number} [opts.temperature]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{text: string, model: string}>}
 */
export async function askLLMWithFallback(taskType, prompt, opts = {}) {
  const tier = opts.tier || "local";
  const chain = opts.fallbackChain || TIERS[tier]?.tasks || TIERS.local.tasks;

  log("INFO", `Tier=${tier} chain=${TIERS[tier]?.desc || chain.join("→")} chars=${prompt.length}`);

  let lastError = null;
  for (const t of chain) {
    try {
      const text = await askLLM(t, prompt, opts);
      return { text, model: MODEL_FOR_TASK[t] || t, tier, taskUsed: t };
    } catch (err) {
      lastError = err;
      log("WARN", `Fallback from ${t} (${MODEL_FOR_TASK[t] || t}): ${err.message}`);
    }
  }

  throw lastError || new Error(`All models failed for tier=${tier}`);
}

/**
 * Call two models in parallel and return both results.
 * Useful for cross-validation.
 *
 * @param {string} taskType
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string[]} [opts.models]  - two task types to run in parallel
 * @returns {Promise<{primary: {text,model}, secondary: {text,model}}>}
 */
export async function askLLMPair(taskType, prompt, opts = {}) {
  const chain = opts.models || [TIERS.local.tasks[0], TIERS.local.tasks[1]];

  log("INFO", `Pair call: ${chain[0]} + ${chain[1]} (parallel)`);

  const [a, b] = await Promise.allSettled([
    askLLM(chain[0], prompt, opts),
    askLLM(chain[1], prompt, opts),
  ]);

  const primary = a.status === "fulfilled"
    ? { text: a.value, model: MODEL_FOR_TASK[chain[0]] || chain[0] }
    : { text: null, model: MODEL_FOR_TASK[chain[0]] || chain[0], error: a.reason?.message };

  const secondary = b.status === "fulfilled"
    ? { text: b.value, model: MODEL_FOR_TASK[chain[1]] || chain[1] }
    : { text: null, model: MODEL_FOR_TASK[chain[1]] || chain[1], error: b.reason?.message };

  return { primary, secondary };
}

/**
 * Check which Ollama models are available.
 * @returns {Promise<string[]>}
 */
export async function listModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map(m => m.name);
  } catch {
    return [];
  }
}

/**
 * Quick quality check on Ornith output — detects empty/low-quality responses.
 * Returns score 0-10. Score < 4 means should retry with fallback.
 */
export function scoreResponse(text) {
  if (!text || text.trim().length < 50) return 0;

  let score = 5;

  // Has a JSON block
  if (text.includes("{") && text.includes("}")) score += 2;

  // Has structured decisions
  if (text.includes("alerts") || text.includes("summary")) score += 1;

  // Has content density (not just whitespace/formatting)
  const content = text.replace(/[\s{}[\]"']/g, "");
  if (content.length > 200) score += 1;

  // No error indicators
  if (text.includes("(no summary)") || text.includes("I cannot")) score -= 3;

  // Reasonable length
  if (text.length < 100) score -= 2;

  return Math.max(0, Math.min(10, score));
}
