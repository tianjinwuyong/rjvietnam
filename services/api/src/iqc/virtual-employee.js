import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { IQC_VIRTUAL_HARNESS } from "./virtual-employee-harness.js";
import { IQC_VIRTUAL_CHANNELS, IQC_VIRTUAL_JOB, IQC_VIRTUAL_KNOWLEDGE, IQC_VIRTUAL_PERSONALITY, IQC_VIRTUAL_PROMPTS, IQC_VIRTUAL_SPECIAL_KNOWLEDGE } from "./virtual-employee-profile.js";
import { askConfiguredIqcAgent, configuredIqcProvider } from "./virtual-employee-llm.js";

const State = Annotation.Root({
  stage: Annotation({ reducer: (_, value) => value, default: () => "IDLE" }),
  lotNo: Annotation({ reducer: (_, value) => value, default: () => "" }),
  materialCode: Annotation({ reducer: (_, value) => value, default: () => "" }),
  batchSize: Annotation({ reducer: (_, value) => value, default: () => 0 }),
  guidance: Annotation({ reducer: (_, value) => value, default: () => null }),
  history: Annotation({ reducer: (_, value) => value, default: () => [] }),
  sampleSize: Annotation({ reducer: (_, value) => value, default: () => null }),
  inspectionItems: Annotation({ reducer: (_, value) => value, default: () => [] }),
  procedureIdeas: Annotation({ reducer: (_, value) => value, default: () => [] }),
  realResults: Annotation({ reducer: (_, value) => value, default: () => [] }),
  decision: Annotation({ reducer: (_, value) => value, default: () => "WAITING_REAL_DATA" }),
  message: Annotation({ reducer: (_, value) => value, default: () => "" }),
});

function readSampleSize(batchSize, rows = []) {
  for (const row of rows) {
    const cell = row.map(value => String(value ?? "")).find(value => /\d+\s*[~～至]\s*\d+/.test(value));
    const match = cell?.match(/(\d+)\s*[~～至]\s*(\d+)/);
    if (!match || batchSize < Number(match[1]) || batchSize > Number(match[2])) continue;
    const values = [row[3], ...row.slice(2)].map(value => Number(String(value ?? "").replace(/[^0-9.]/g, ""))).filter(value => Number.isFinite(value) && value > 0);
    return values[0] ?? null;
  }
  return null;
}

const graph = new StateGraph(State)
  .addNode("read_history", state => ({ stage: "HISTORY_READ", message: `Material history loaded: ${(state.history || []).length} records` }))
  .addNode("read_guidance", state => ({ stage: "GUIDANCE_READ", sampleSize: readSampleSize(state.batchSize, state.guidance?.samplingRows), inspectionItems: state.guidance?.inspectionItems ?? [], message: "ACTIVE IQC guidance loaded" }))
  .addNode("generate_plan", state => ({ stage: "PLAN_READY", procedureIdeas: (state.inspectionItems || []).map(item => ({ item, sequence: "Verify identity and traceability, perform the required measurement or visual check, record real evidence, compare with the ACTIVE Excel limit, then mark PASS/FAIL", evidence: "PDA/tester measurement, photo, document, or authorized operator confirmation as applicable", source: state.guidance?.fileName || "ACTIVE IQC guidance" })), decision: state.sampleSize ? "WAITING_REAL_DATA" : "BLOCKED_GUIDANCE", message: state.sampleSize ? ((state.history || []).length ? "Supplier/material history loaded; use the approved inspection level" : "No supplier/material history; start with standard inspection") : "Lot size does not match the ACTIVE sampling guidance" }))
  .addNode("validate_results", state => {
    const results = Array.isArray(state.realResults) ? state.realResults : [];
    const valid = results.length > 0 && results.every(row => ["PASS", "FAIL"].includes(String(row.result ?? row).toUpperCase()));
    return { stage: valid ? "RESULTS_VALIDATED" : "WAITING_REAL_DATA", decision: valid ? "READY_FOR_DETERMINISTIC_IQC_RULES" : "WAITING_REAL_DATA", message: valid ? "Real results validated; existing IQC rules must decide PASS/FAIL" : "No complete real measurement result received" };
  })
  .addEdge(START, "read_history")
  .addEdge("read_history", "read_guidance")
  .addEdge("read_guidance", "generate_plan")
  .addEdge("generate_plan", "validate_results")
  .addEdge("validate_results", END)
  .compile();

export async function runIqcVirtualEmployee(input = {}) {
  return graph.invoke({
    stage: "IDLE", lotNo: String(input.lotNo ?? ""), materialCode: String(input.materialCode ?? ""),
    batchSize: Number(input.batchSize ?? 0), guidance: input.guidance ?? null, history: input.history ?? [], realResults: input.realResults ?? [],
  });
}

export async function askIqcLlm(input = {}) {
  const systemPrompt = `You are IQC-VIRTUAL-01, a controlled virtual IQC employee operating inside the WMS IQC page. Your name is ${IQC_VIRTUAL_PERSONALITY.displayName}. Personality: ${IQC_VIRTUAL_PERSONALITY.traits.join(", ")}. ${IQC_VIRTUAL_PERSONALITY.workingStyle.join(" ")} Operating prompts: ${Object.values(IQC_VIRTUAL_PROMPTS).join(" ")} Work step by step: (1) read the ACTIVE Excel guidance only; (2) identify the lot and match its batch size to the sampling table; (3) generate the required inspection checklist and parameters; (4) inspect the current page context and use only approved tools; (5) accept only real PDA, tester, measurement, or authorized human evidence; (6) validate completeness; (7) send PASS/FAIL to the deterministic IQC rules engine; (8) continue to the next allowed WMS step or stop for human approval. Special knowledge: ${IQC_VIRTUAL_SPECIAL_KNOWLEDGE.principles.join(" ")} Evidence priority: ${IQC_VIRTUAL_SPECIAL_KNOWLEDGE.evidenceHierarchy.join(" > ")}. Memory is supporting context, never an authority source: do not turn a memory or suggestion into an IQC requirement unless it is in ACTIVE guidance or an approved rule. Never invent or infer a measurement, never change AQL/Ac/Re or 8.2.1-8.2.5 rules, never release inventory without evidence, never approve exemption, never confirm complaints or supplier improvement, and never activate/delete Excel versions. When blocked, state the exact missing evidence or human decision. Return JSON fields: summary, requiredTests, missingEvidence, recommendation, nextAction, actionArguments, humanApprovalRequired, blockedReason.`;
  const provider = String(input.llmConfig?.provider || configuredIqcProvider()).toLowerCase();
  if (provider !== "ollama") {
    return askConfiguredIqcAgent({ provider, config: input.llmConfig || {}, prompt: `${systemPrompt}\n\nINPUT:\n${JSON.stringify({ lotNo: input.lotNo || "", materialCode: input.materialCode || "", supplierCode: input.supplierCode || "", materialHistory: input.history || [], guidance: input.guidance || null, memoryContext: input.memoryContext || [], pageContext: input.pageContext || "", question: input.question || "", realResults: input.realResults || [], currentLevel: input.currentLevel || "NORMAL" })}` });
  }
  const controller = new AbortController();
  // Vision/quality guidance questions may need model loading time on the
  // local Ollama instance; five seconds caused valid answers to be aborted.
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(String(input.llmConfig?.baseUrl || process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "") + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ model: input.llmConfig?.model || process.env.IQC_LLM_MODEL || "qwen2.5:7b", stream: false, format: "json", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify({ lotNo: input.lotNo || "", materialCode: input.materialCode || "", supplierCode: input.supplierCode || "", materialHistory: input.history || [], guidance: input.guidance || null, memoryContext: input.memoryContext || [], pageContext: input.pageContext || "", question: input.question || "", realResults: input.realResults || [], currentLevel: input.currentLevel || "NORMAL" }) }] }) });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  const body = await response.json();
  const ollamaModel = input.llmConfig?.model || process.env.IQC_LLM_MODEL || "qwen2.5:7b";
  try { return { provider: "ollama", model: ollamaModel, output: JSON.parse(body.message?.content || "{}") }; } catch { return { provider: "ollama", model: ollamaModel, output: { summary: body.message?.content || "", humanApprovalRequired: true } }; }
}

export const IQC_VIRTUAL_EMPLOYEE = { id: "IQC-VIRTUAL-01", name: IQC_VIRTUAL_PERSONALITY.displayName, role: IQC_VIRTUAL_JOB.title, workflow: "LangGraph.js", provider: configuredIqcProvider(), model: process.env.IQC_LLM_MODEL || process.env.IQC_AGENT_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M2.7", authority: "controlled", harness: IQC_VIRTUAL_HARNESS.id, skills: IQC_VIRTUAL_HARNESS.skills.map(skill => skill.id), personality: IQC_VIRTUAL_PERSONALITY, job: IQC_VIRTUAL_JOB, knowledge: IQC_VIRTUAL_KNOWLEDGE, specialKnowledge: IQC_VIRTUAL_SPECIAL_KNOWLEDGE, prompts: IQC_VIRTUAL_PROMPTS, channels: IQC_VIRTUAL_CHANNELS };
