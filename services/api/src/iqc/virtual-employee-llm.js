import { spawn } from "node:child_process";

const DEFAULT_PROVIDER = String(process.env.IQC_AGENT_PROVIDER || "minimax").toLowerCase();
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

// OpenAI-compatible providers: credential env, default base URL, default model.
const OPENAI_COMPATIBLE_PROVIDERS = {
  minimax: {
    credentialEnv: "MINIMAX_API_KEY",
    baseUrl: () => process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
    model: () => process.env.MINIMAX_MODEL || DEFAULT_MINIMAX_MODEL,
    fallbackModel: DEFAULT_MINIMAX_MODEL,
  },
  deepseek: {
    credentialEnv: "DEEPSEEK_API_KEY",
    baseUrl: () => process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: () => process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    fallbackModel: DEFAULT_DEEPSEEK_MODEL,
  },
  "openai-compatible": {
    credentialEnv: "OPENAI_API_KEY",
    baseUrl: () => process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: () => process.env.OPENAI_MODEL || "gpt-4o-mini",
    fallbackModel: "gpt-4o-mini",
  },
};

function commandFor(provider) {
  if (provider === "hermes") return { command: "hermes.cmd", args: ["chat", "--query", "", "--quiet"] };
  if (provider === "opencode") return { command: "opencode.cmd", args: ["run", "--format", "json"] };
  if (provider === "pi") return { command: "pi.cmd", args: ["--print", "--mode", "json", "--no-session", "--no-tools"] };
  return null;
}

function extractJson(text) {
  const source = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1].trim()).reverse();
  for (const candidate of fenced) {
    try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch { /* try plain response */ }
  }
  const candidates = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const candidate of candidates) {
    try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch { /* try the next event */ }
  }
  const match = source.match(/\{[\s\S]*\}/);
  if (match) {
    try { const parsed = JSON.parse(match[0]); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch { /* caller receives a gated text result */ }
  }
  return null;
}

function runAgent(command, args, prompt, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args, prompt], { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${command} exited with ${code}: ${stderr.trim().slice(-500)}`));
      resolve(stdout.trim());
    });
  });
}

async function askOpenAiCompatible(prompt, config = {}) {
  const provider = String(config.provider || "minimax").toLowerCase();
  const spec = OPENAI_COMPATIBLE_PROVIDERS[provider] || OPENAI_COMPATIBLE_PROVIDERS["openai-compatible"];
  const credentialEnv = String(config.credentialEnv || spec.credentialEnv);
  const apiKey = String(process.env[credentialEnv] || "").trim();
  if (!apiKey) throw new Error(`${credentialEnv} is required for the IQC ${provider} provider`);
  const baseUrl = String(config.baseUrl || spec.baseUrl()).replace(/\/$/, "");
  const model = String(config.model || process.env.IQC_LLM_MODEL || process.env.IQC_AGENT_MODEL || spec.model() || spec.fallbackModel);
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(config.timeoutMs || process.env.IQC_LLM_TIMEOUT_MS || 120000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", name: "IQC-VIRTUAL-01", content: prompt }],
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${provider} request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body = await response.json();
  const raw = String(body.choices?.[0]?.message?.content || "").trim();
  if (!raw) throw new Error(`${provider} returned an empty response`);
  const output = extractJson(raw) || { summary: raw, humanApprovalRequired: true, blockedReason: `${provider} did not return valid JSON` };
  return { provider, model, output };
}

export function configuredIqcProvider() {
  return DEFAULT_PROVIDER;
}

export async function askConfiguredIqcAgent({ provider = DEFAULT_PROVIDER, prompt, config = {} }) {
  const normalized = String(config.provider || provider).toLowerCase();
  if (["minimax", "deepseek", "openai-compatible"].includes(normalized)) return askOpenAiCompatible(prompt, { ...config, provider: normalized });
  const spec = commandFor(normalized);
  if (!spec) throw new Error(`Unsupported IQC agent provider: ${normalized}`);
  const args = [...spec.args];
  if (normalized === "hermes") args[2] = prompt;
  const configuredModel = config.model || process.env.IQC_AGENT_MODEL;
  if (normalized === "opencode" && configuredModel) args.push("--model", configuredModel);
  if (normalized === "pi" && configuredModel) args.push("--model", configuredModel);
  const raw = await runAgent(spec.command, args, normalized === "hermes" ? "" : prompt);
  const output = extractJson(raw) || { summary: raw, humanApprovalRequired: true, blockedReason: "Agent did not return valid JSON" };
  return { provider: normalized, model: configuredModel || "configured-default", output };
}
