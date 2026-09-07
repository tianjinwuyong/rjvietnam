import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiClient } from "../api/client";

type ProviderOption = { value: string; label: string; defaultModel: string; credentialEnv?: string | null };
type EmployeeConfig = { enabled: boolean; provider: string; model: string; baseUrl: string; timeoutMs: number; credentialConfigured: boolean; credentialEnv?: string };

const flow = ["扫描待检队列", "读取收料批次", "读取 PO / 箱 QR", "加载供应商历史", "计算风险与样本量", "选择检验等级", "PDA 执行动态检验", "证据与最终判定"];
const baseNodes: Node[] = flow.map((label, index) => ({ id: String(index), position: { x: index * 205, y: 80 }, data: { label }, style: { width: 178, borderRadius: 8, padding: 12, fontWeight: 600 } }));
const edges: Edge[] = flow.slice(1).map((_, index) => ({ id: `${index}-${index + 1}`, source: String(index), target: String(index + 1), animated: true, style: { stroke: "#6366f1" } }));

function currentStep(task: any) {
  if (!task) return 0;
  const type = String(task.task_type || "").toUpperCase();
  if (task.status === "DONE") return 7;
  if (/EVIDENCE|RESULT|DECISION|APPROVAL/.test(type)) return 7;
  if (/INSPECT|PDA|PHOTO|TEST/.test(type)) return 6;
  if (/LEVEL|STRICT|EXEMPT/.test(type)) return 5;
  if (/SAMPLE|RISK|OVERDUE|REVIEW/.test(type)) return 4;
  if (/HISTORY|SUPPLIER/.test(type)) return 3;
  if (/PO|QR|LOT/.test(type)) return 2;
  return 1;
}

export function IqcEmployeeStructure() {
  const [profile, setProfile] = useState<any>(null);
  const [config, setConfig] = useState<EmployeeConfig | null>(null);
  const [options, setOptions] = useState<ProviderOption[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [liveTask, setLiveTask] = useState<any>(null);

  const load = async () => { const response: any = await apiClient.get("/qms/iqc/virtual-employee"); const item = response.item ?? response.data?.item ?? response; setProfile(item); setConfig(item.llmConfig); setOptions(item.providerOptions ?? []); };
  useEffect(() => { void load().catch(error => setMessage(error instanceof Error ? error.message : String(error))); }, []);
  useEffect(() => { let disposed = false; const poll = async () => { try { const response: any = await apiClient.get("/qms/iqc/virtual-employee/tasks?status="); const rows = response.items ?? response.data?.items ?? []; if (!disposed) setLiveTask(rows[0] || null); } catch { /* keep last known state */ } }; void poll(); const timer = window.setInterval(poll, 4000); return () => { disposed = true; window.clearInterval(timer); }; }, []);
  const selected = useMemo(() => options.find(option => option.value === config?.provider), [options, config?.provider]);
  const update = <K extends keyof EmployeeConfig>(key: K, value: EmployeeConfig[K]) => setConfig(current => current ? { ...current, [key]: value } : current);
  const changeProvider = (provider: string) => { const option = options.find(item => item.value === provider); setConfig(current => current ? { ...current, provider, model: option?.defaultModel || current.model, baseUrl: provider === "minimax" ? "https://api.minimaxi.com/v1" : provider === "ollama" ? "http://127.0.0.1:11434" : current.baseUrl } : current); };
  const save = async () => { if (!config) return; setSaving(true); setMessage(""); try { await apiClient.put("/qms/iqc/virtual-employee/llm-config", config); await load(); setMessage("员工配置已保存"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); } };
  if (!config) return <section className="panel"><strong>IQC 虚拟员工</strong><div>{message || "正在加载员工结构…"}</div></section>;

  const activeIndex = currentStep(liveTask);
  const payload = liveTask?.payload || {};
  const nodes = baseNodes.map(node => { const active = Number(node.id) === activeIndex; return { ...node, data: { label: active ? `🔴 当前 → ${node.data.label}` : node.data.label }, style: { ...node.style, color: active ? "#991b1b" : "#0f172a", border: active ? "3px solid #dc2626" : "1px solid #6366f1", boxShadow: active ? "0 0 0 5px rgba(239,68,68,.18)" : "none", background: active ? "#fff1f2" : Number(node.id) < activeIndex ? "#dcfce7" : "#eef2ff" } }; });
  const expectations = [
    ["WMS", "出现已完成收料并进入 IQC HOLD 的批次", "读取收料批次、PO 与箱 QR"],
    ["WMS", "批次具有物料、数量、供应商与收料证据", "核对 PO 与物料身份"],
    ["WMS", "PO、箱 QR、Material SN 可查询", "加载供应商与该物料的历史批次"],
    ["无需人工输入", "历史读取完成；无历史时采用标准检验", "按 ACTIVE Excel 计算抽样数量"],
    ["无需人工输入", "批量大小与 Excel 抽样规则匹配", "根据历史风险选择检验严格度"],
    ["无需人工输入", "检验等级和样本量已经确定", "向 IQC PDA 下发动态检验项目"],
    ["IQC PDA 操作员", `完成 ${payload.sampleSize || liveTask?.sample_size || "规定"} 个样本并上传照片与测试值`, "验证证据完整性并计算 PASS/FAIL"],
    ["IQC 主管", "真实结果、NG 数量、缺陷原因和照片齐全", "保存判定，更新供应商历史并通知 WMS/供应商门户"],
  ];
  const expectation = expectations[activeIndex];
  const skills = profile?.harness?.skills ?? [];

  return <section className="panel" style={{ marginBottom: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}><div><strong>{profile?.name || "IQC-VIRTUAL-01"}</strong><div style={{ color: "#64748b", fontSize: 12 }}>{profile?.role || "受控 IQC 虚拟员工"}</div></div><label><input type="checkbox" checked={config.enabled} onChange={event => update("enabled", event.target.checked)} /> 员工已启用</label></div>
    <div aria-live="polite" style={{ marginTop: 12, padding: "12px 14px", border: "2px solid #dc2626", borderRadius: 10, background: "#fff1f2", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><span style={{ width: 14, height: 14, borderRadius: "50%", background: "#dc2626", boxShadow: "0 0 0 5px #fecaca" }} /><div><small style={{ fontWeight: 900, color: "#7f1d1d" }}>IQC 虚拟员工当前状态</small><div style={{ fontSize: 19, fontWeight: 900, color: "#991b1b" }}>{flow[activeIndex]}</div></div><div style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 12 }}>PO {liveTask?.po_no || liveTask?.purchase_order || "—"} · LOT {liveTask?.lot_no || "—"} · {liveTask?.material_code || "—"}</div></div>
    <div style={{ height: 265, marginTop: 12, border: "1px solid #c7d2fe", borderRadius: 8, overflow: "hidden" }}><ReactFlowProvider><ReactFlow nodes={nodes} edges={edges} fitView attributionPosition="bottom-left"><Background color="#c7d2fe" gap={18} /><Controls /><MiniMap /></ReactFlow></ReactFlowProvider></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 6, marginTop: 10 }}>{flow.map((item, index) => <div key={item} style={{ padding: 8, borderRadius: 6, border: index === activeIndex ? "2px solid #dc2626" : "1px solid transparent", background: index < activeIndex ? "#f0fdf4" : index === activeIndex ? "#fff1f2" : "#f8fafc", fontSize: 11 }}><strong style={{ color: index === activeIndex ? "#b91c1c" : undefined }}>{index === activeIndex ? "🔴 " : ""}{index + 1}. {item}</strong><div>{index < activeIndex ? "COMPLETED" : index === activeIndex ? "RUNNING" : "PENDING"}</div></div>)}</div>
    <div style={{ marginTop: 10, padding: 12, border: "2px solid #f97316", borderRadius: 9, background: "#fff7ed", fontSize: 12 }}><strong style={{ color: "#9a3412" }}>虚拟员工正在等待的输入</strong><div style={{ marginTop: 7 }}><b>输入提供者：</b>{expectation[0]}</div><div style={{ marginTop: 5 }}><b>触发条件：</b>{expectation[1]}</div><div style={{ marginTop: 7, padding: 8, borderRadius: 6, background: "#ecfdf5", color: "#166534" }}><b>触发后员工自动执行：</b>{expectation[2]}</div></div>
    <div style={{ marginTop: 10, padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 11, background: "#fff" }}><strong>执行明细</strong><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6, marginTop: 6 }}><span>PO: {liveTask?.po_no || liveTask?.purchase_order || "—"}</span><span>Material SN: {liveTask?.material_sn || liveTask?.sn || "—"}</span><span>物料: {liveTask?.material_code || "—"}</span><span>批量: {liveTask?.quantity || liveTask?.batch_size || "—"}</span><span>结果: {liveTask?.result || liveTask?.decision || "PENDING"}</span><span>历史批次: {liveTask?.history_count ?? "—"}</span></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 14 }}><label>LLM provider<select value={config.provider} onChange={event => changeProvider(event.target.value)} style={{ width: "100%" }}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Model<input value={config.model} onChange={event => update("model", event.target.value)} style={{ width: "100%" }} /></label><label>Base URL<input value={config.baseUrl || ""} onChange={event => update("baseUrl", event.target.value)} disabled={["hermes", "opencode", "pi"].includes(config.provider)} style={{ width: "100%" }} /></label><label>Timeout (ms)<input type="number" min={5000} max={300000} value={config.timeoutMs} onChange={event => update("timeoutMs", Number(event.target.value))} style={{ width: "100%" }} /></label></div>
    <div style={{ fontSize: 12, marginTop: 10 }}><strong>Skills:</strong> {skills.map((skill: any) => skill.name || skill.id).join(" · ") || "Inspection planning · evidence validation"}</div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}><span style={{ fontSize: 12, color: selected?.credentialEnv && !config.credentialConfigured ? "#b91c1c" : "#475569" }}>{selected?.credentialEnv ? `${selected.credentialEnv}: ${config.credentialConfigured ? "configured" : "not configured"}` : "No API credential required"}</span><button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存员工配置"}</button></div>{message && <div style={{ marginTop: 8, fontSize: 12 }}>{message}</div>}
  </section>;
}
