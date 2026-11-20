import { describe, it, expect } from "vitest";
import { learnFromCorrections, reviewTrainingRun, allEmployeeIds } from "../services/api/src/agent/learning.js";
import { collectFieldKnowledge, allKnowledgeEmployeeIds, FIELD_QUERIES } from "../services/api/src/agent/knowledge.js";
import { runEmployeeCycle } from "../services/api/src/agent/runner.js";
import {
  knowledgeVerdict, createKnowledgeService, employeeAgentId, DISCARDED_TYPES,
  SHARED_AGENT_ID, SHARED_NAMESPACES, sharedAgentId,
} from "../services/_shared/memory-experience.js";

describe("knowledge policy (one store, per-employee namespace)", () => {
  const good = { type: "exception_signature", sourceType: "supplier-defect-history", sourceId: 12, expiresAt: "2027-01-01T00:00:00Z" };
  const text = "供应商 S1 的物料 M-100 在来料检验中出现 3 次不合格，判定前须先复核该供应商的缺陷特征。";

  it("accepts sourced experience under an employee namespace", () => {
    expect(knowledgeVerdict(employeeAgentId("IQC-VIRTUAL-01"), text, good)).toEqual({ accept: true });
    expect(employeeAgentId("iqc-virtual-01")).toBe("ve/IQC-VIRTUAL-01");
  });

  it("discards runtime state snapshots and unsourced or sensitive content", () => {
    const ve = employeeAgentId("WMS-RECEIVING-VIRTUAL-01");
    expect(knowledgeVerdict(ve, text, { ...good, type: "wms_state" })).toMatchObject({ accept: false, reason: "TRANSIENT_STATE" });
    expect(DISCARDED_TYPES).toContain("wms_state");
    expect(knowledgeVerdict(ve, text, { type: "exception_signature" })).toMatchObject({ accept: false, reason: "SOURCE_REQUIRED" });
    expect(knowledgeVerdict(ve, text, { ...good, expiresAt: undefined, docVersion: undefined }))
      .toMatchObject({ accept: false, reason: "EXPIRY_OR_VERSION_REQUIRED" });
    expect(knowledgeVerdict(ve, "短", good)).toMatchObject({ accept: false, reason: "TOO_SHORT_TO_BE_KNOWLEDGE" });
    expect(knowledgeVerdict(ve, `管理员 password=Factory@123 ${text}`, good)).toMatchObject({ accept: false, reason: "SENSITIVE_CONTENT" });
    expect(knowledgeVerdict("wms-ai", text, good)).toMatchObject({ accept: false, reason: "NAMESPACE_NOT_VE" });
  });

  it("stores through the scoped client with infer disabled", async () => {
    const calls = [];
    const svc = createKnowledgeService({ now: () => Date.parse("2026-11-20T00:00:00Z"),
      clientFactory: ({ agentId }) => ({ store: async (messages, metadata, opts) => { calls.push({ agentId, messages, metadata, opts }); return {}; } }) });
    const out = await svc.remember({ employeeId: "IQC-VIRTUAL-01", type: "exception_signature",
      content: "供应商 S1 的物料 M-100 在来料检验中出现 3 次不合格，判定前须先复核该供应商的缺陷特征。",
      sourceType: "supplier-defect-history", sourceId: 12, expiresAt: "2027-01-01T00:00:00Z" });
    expect(out.stored).toBe(true);
    expect(calls[0].agentId).toBe("ve/IQC-VIRTUAL-01");
    expect(calls[0].opts).toEqual({ infer: false });
    expect(calls[0].metadata.recordedAt).toBe("2026-11-20T00:00:00.000Z");
  });

  it("namespaces the shared corpora without touching employee ids", () => {
    expect(sharedAgentId()).toBe("ve/shared/general");
    expect(sharedAgentId(true)).toBe("ve/shared/general");
    expect(sharedAgentId("controlled-docs")).toBe("ve/shared/controlled-docs");
    expect(sharedAgentId("ve/shared/exception-signatures")).toBe("ve/shared/exception-signatures");
    expect(SHARED_NAMESPACES.every(s => s.startsWith("ve/shared/"))).toBe(true);
  });

  it("recalls own namespace plus every shared corpus, dropping expired hits", async () => {
    const seen = [];
    const svc = createKnowledgeService({ now: () => Date.parse("2026-11-20T00:00:00Z"),
      clientFactory: ({ agentId }) => ({ search: async (q, topK, threshold) => {
        seen.push({ agentId, q, topK, threshold });
        if (agentId === SHARED_AGENT_ID) return { results: [{ id: "sh1", score: 0.91, metadata: { type: "rule_reference" } }] };
        if (agentId === "ve/shared/controlled-docs") return { results: [{ id: "doc1", score: 0.72, metadata: { type: "rule_reference", docVersion: "1.0", sourceType: "oa-doc-system", sourceId: 2229 } }] };
        if (agentId !== "ve/IQC-VIRTUAL-01") return { results: [] };
        return { results: [
          { id: "own-new", score: 0.8, metadata: { type: "exception_signature", expiresAt: "2027-01-01T00:00:00Z", sourceId: 7 } },
          { id: "own-old", score: 0.95, metadata: { type: "exception_signature", expiresAt: "2020-01-01T00:00:00Z" } },
        ] };
      } }) });
    const out = await svc.recall({ employeeId: "IQC-VIRTUAL-01", query: "供应商缺陷", topK: 5 });
    expect(seen.map(s => s.agentId)).toEqual(["ve/IQC-VIRTUAL-01", ...SHARED_NAMESPACES]);
    expect(seen[0].threshold).toBe(0.35);
    expect(out.results.map(r => r.id)).toEqual(["sh1", "own-new", "doc1"]);
    expect(out.cited[1]).toMatchObject({ agentId: "ve/IQC-VIRTUAL-01", sourceId: 7 });
    expect(out.cited[2]).toMatchObject({ agentId: "ve/shared/controlled-docs", docVersion: "1.0", sourceType: "oa-doc-system" });
    // a citation can be narrowed to one corpus, e.g. only controlled documents
    const docsOnly = await svc.recall({ employeeId: "IQC-VIRTUAL-01", query: "检验标准", sharedOnly: "controlled-docs" });
    expect(docsOnly.scopes).toEqual(["ve/shared/controlled-docs"]);
    expect(docsOnly.results.map(r => r.id)).toEqual(["doc1"]);
  });
});

describe("field knowledge collection", () => {
  it("renders sourced items and refuses them without a knowledge service", async () => {
    const { query, calls } = (() => {
      const calls = [];
      return { calls, query: async sql => {
        calls.push(sql);
        if (sql.includes("FROM iqc_inspections")) return { rows: [{ supplier_code: "S1", material_code: "M-100", ng: 3, source_id: 88 }] };
        return { rows: [] };
      } };
    })();
    const remembered = [];
    const knowledge = { remember: async p => { remembered.push(p); return { stored: true, agentId: employeeAgentId(p.employeeId), type: p.type }; } };
    const result = await collectFieldKnowledge({ employeeId: "IQC-VIRTUAL-01", query, knowledge });
    expect(result.collected).toBe(1);
    expect(result.stored).toBe(1);
    expect(remembered[0].content).toContain("S1");
    expect(remembered[0].sourceId).toBe(88);
    expect(calls.some(c => c.includes("KNOWLEDGE_COLLECTED"))).toBe(true);
    const dry = await collectFieldKnowledge({ employeeId: "IQC-VIRTUAL-01", query, dryRun: true });
    expect(dry).toMatchObject({ collected: 1, stored: 0, dryRun: true });
  });

  it("only defines knowledge for employees whose tables actually exist", () => {
    expect(Object.keys(FIELD_QUERIES).every(id => allKnowledgeEmployeeIds().includes(id))).toBe(true);
    expect(FIELD_QUERIES["TRACE-VIRTUAL-01"]).toBeUndefined();
  });
});

describe("runner uses retrieval as evidence", () => {
  const rows = [{ row_key: "INSP-1", lot_no: "LOT-A", material_code: "M-100" }];
  function router(handlers) {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      for (const [needle, fn] of handlers) if (sql.includes(needle)) return fn(params);
      return { rows: [], rowCount: 0 };
    };
    return { query, calls };
  }

  it("attaches cited knowledge to the task input", async () => {
    const { query, calls } = router([
      ["FROM iqc_inspections", () => ({ rows, rowCount: 1 })],
      ["INSERT INTO factory_virtual_employee_tasks", () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    ]);
    const knowledge = { recall: async () => ({ cited: [{ memoryId: "m1", agentId: "ve/shared/general", type: "rule_reference" }] }) };
    const result = await runEmployeeCycle({ employeeId: "IQC-VIRTUAL-01", query, knowledge });
    expect(result.cited).toBe(1);
    const input = JSON.parse(calls.find(c => c.sql.includes("INSERT INTO factory_virtual_employee_tasks")).params[5]);
    expect(input.evidence).toEqual([{ memoryId: "m1", agentId: "ve/shared/general", type: "rule_reference" }]);
  });

  it("records a retrieval failure instead of pretending there is no evidence", async () => {
    const { query, calls } = router([
      ["FROM iqc_inspections", () => ({ rows, rowCount: 1 })],
      ["INSERT INTO factory_virtual_employee_tasks", () => ({ rows: [{ id: 78 }], rowCount: 1 })],
    ]);
    const result = await runEmployeeCycle({ employeeId: "IQC-VIRTUAL-01", query,
      knowledge: { recall: async () => { throw new Error("memory_server 503"); } } });
    expect(result.cited).toBe(1);
    const input = JSON.parse(calls.find(c => c.sql.includes("INSERT INTO factory_virtual_employee_tasks")).params[5]);
    expect(input.evidence[0].recallError).toContain("memory_server 503");
  });
});

describe("self-learning still uses the human training tables", () => {
  const sourceRow = [{
    row_key: "42", event_type: "HUMAN_REJECTED", task_id: 7, created_at: "2026-11-20T00:00:00Z",
    detail: { evidence: ["a", "b"] }, task_type: "RECEIVING_VALIDATE", human_gate: "receive_variance", input: {},
  }];

  it("creates a DRAFT case plus a WAITING_REVIEW run from a human correction", async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("factory_virtual_employee_events e")) return { rows: sourceRow, rowCount: 1 };
      if (sql.includes("INSERT INTO factory_virtual_employee_training_cases")) return { rows: [{ id: 9 }], rowCount: 1 };
      if (sql.includes("INSERT INTO factory_virtual_employee_training_runs")) return { rows: [{ id: 5 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    const result = await learnFromCorrections({ employeeId: "WMS-RECEIVING-VIRTUAL-01", query });
    expect(result).toMatchObject({ scanned: 1, casesCreated: 1 });
    expect(calls.find(c => c.sql.includes("INSERT INTO factory_virtual_employee_training_cases")).params[1]).toBe("AUTO:42:HUMAN_REJECTED");
    expect(await reviewTrainingRun({ query, runId: 5, reviewer: "ve:WMS-RECEIVING-VIRTUAL-01", pass: true }))
      .toMatchObject({ ok: false, code: "VE_CANNOT_APPROVE_TRAINING" });
  });

  it("covers the whole registry", () => {
    expect(allEmployeeIds().length).toBeGreaterThanOrEqual(23);
    expect(allKnowledgeEmployeeIds()).toEqual(allEmployeeIds());
  });
});
