import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../api/client";

type WorkItem = {
  id: number;
  task_type: string;
  title: string;
  status: string;
  priority: string;
  requires_human: boolean;
  human_gate?: string;
  input?: Record<string, unknown>;
  created_at: string;
};

type LiveStatus = {
  connected: boolean;
  node: string;
  phase: string;
  guidance: string;
  at?: string;
  input?: Record<string, unknown>;
};

const employeeId = "WMS-RECEIVING-VIRTUAL-01";
const employeeApiBase = `${API_BASE}/api/factory`;
const employeeEventUrl = `${API_BASE}/api/pda/events?node=wms_receiving_archify&replay=1&types=WMS_RECEIVING_EMPLOYEE_STATUS,WMS_RECEIVING_PDA_ACTIVITY`;

const stageMap: Record<string, { node: string; phase: string; guidance: string }> = {
  RECEIVING_VALIDATE: { node: "wmsValidate", phase: "核对收料资料", guidance: "核对 PO、供应商、物料、批次和实收数量。" },
  LABEL_PLAN: { node: "masterEnrich", phase: "补齐主数据并生成标签", guidance: "读取物料与 MSL 映射，生成并打印每箱 WMS QR。" },
  LOCATION_BIND: { node: "printAndBind", phase: "绑定仓位", guidance: "依次扫描箱 QR 与仓位 QR，完成库存位置绑定。" },
  IQC_HANDOFF: { node: "iqcHandoff", phase: "交接 IQC", guidance: "收料完成，物料进入 IQC HOLD 等待检验。" },
  WAITING_APPROVAL: { node: "varianceGate", phase: "等待人工处理异常", guidance: "资料或数量存在异常，主管确认前不会自动放行。" },
  PDA_CAPTURE: { node: "pdaCapture", phase: "PDA 采集箱数据", guidance: "扫描供应商标签，确认真实箱数、数量与批次。" },
  SCANNING: { node: "supplierPrepare", phase: "扫描未完成收料", guidance: "虚拟员工正在后台寻找新的收料任务。" },
  IDLE: { node: "supplierPrepare", phase: "后台监控", guidance: "当前没有待处理任务；新 PDA 数据到达后自动继续。" },
};

const workflowSteps = [
  ["supplierPrepare", "到货资料"],
  ["pdaCapture", "PDA采集"],
  ["wmsValidate", "数据校验"],
  ["masterEnrich", "主数据/标签"],
  ["printAndBind", "绑定仓位"],
  ["iqcHandoff", "IQC交接"],
] as const;

const humanActions: Record<string, { actor: string; action: string; done: string; next: string }> = {
  supplierPrepare: { actor: "供应商 / 收料员", action: "提供 PO、送货单和供应商箱标签。", done: "PO 与到货资料可被 WMS 查询。", next: "创建收料任务并推送到目标 PDA。" },
  pdaCapture: { actor: "PDA 收料员", action: "扫描每个箱标签；无法识别时拍照或 OCR，并确认批次与实收数量。", done: "所有箱已采集，箱数和数量已提交 WMS。", next: "自动核对 PO、供应商、物料、批次、数量和重复码。" },
  wmsValidate: { actor: "PDA 收料员", action: "针对差异重新扫描错误标签或修正现场数量。", done: "PO、供应商、物料、批次和数量全部校验通过。", next: "查询物料主数据与 MSL，并生成箱标签计划。" },
  masterEnrich: { actor: "PDA 收料员", action: "保持手持打印机在线，接收并确认打印任务。", done: "每个箱都有唯一 WMS QR，打印数量与箱数一致。", next: "验证打印结果并要求执行箱 QR 与仓位 QR 绑定。" },
  printAndBind: { actor: "PDA 收料员", action: "把 WMS QR 贴到对应箱体，再扫描箱 QR 和仓位 QR。", done: "所有箱 QR 均已绑定有效仓位。", next: "更新库存位置、生成隐藏托盘关系并交接 IQC。" },
  varianceGate: { actor: "收料主管", action: "复核数量差异、重码或缺失主数据，并批准或退回纠正。", done: "主管批准，或现场完成纠正后重新提交。", next: "批准后重新校验；拒绝时保持 RECEIVING_HOLD。" },
  iqcHandoff: { actor: "IQC 人员", action: "在 PDA IQC 队列确认接收该批次。", done: "IQC 已接单。", next: "关闭收料任务并开始监控下一批物料。" },
};

function authHeaders(json = false) {
  const token = sessionStorage.getItem("auth_token");
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function value(input: Record<string, unknown> | undefined, key: string) {
  const result = input?.[key];
  return result == null || result === "" ? "—" : String(result);
}

export function WmsReceivingEmployeeCommunication() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [live, setLive] = useState<LiveStatus>({ connected: false, ...stageMap.IDLE });
  const frameRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${employeeApiBase}/virtual-employees/${employeeId}/work-queue`, { headers: authHeaders() });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) {
        throw new Error(response.status === 401 ? "登录已失效，请重新登录" : `员工 API 不可用 (HTTP ${response.status})`);
      }
      const payload = await response.json();
      const nextItems: WorkItem[] = payload?.data?.items || [];
      setItems(nextItems);
      const active = nextItems.find(item => item.status === "WAITING_APPROVAL") || nextItems.find(item => item.status === "OPEN");
      if (active) {
        const stage = active.status === "WAITING_APPROVAL" ? stageMap.WAITING_APPROVAL : stageMap[active.task_type] || stageMap.IDLE;
        setLive(previous => ({ ...previous, ...stage, input: active.input, at: active.created_at }));
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 5000);
    const stream = new EventSource(employeeEventUrl);
    stream.onopen = () => setLive(previous => ({ ...previous, connected: true }));
    stream.onerror = () => setLive(previous => ({ ...previous, connected: false }));
    stream.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "CONNECTED") return;
        if (message.type === "WMS_RECEIVING_PDA_ACTIVITY") {
          const data = message.payload || {};
          setLive({ connected: true, ...stageMap.PDA_CAPTURE, at: message._ts, input: data });
          return;
        }
        if (message.type !== "WMS_RECEIVING_EMPLOYEE_STATUS") return;
        const data = message.payload || {};
        const stage = data.status === "WAITING_APPROVAL" ? stageMap.WAITING_APPROVAL : stageMap[data.taskType] || stageMap[data.phase] || stageMap.IDLE;
        setLive({ connected: true, ...stage, at: message._ts, input: data.input || data });
        void load();
      } catch { /* ignore unrelated bus traffic */ }
    };
    return () => { window.clearInterval(timer); stream.close(); };
  }, [load]);

  const open = items.filter(item => item.status === "OPEN");
  const approvals = items.filter(item => item.status === "WAITING_APPROVAL");
  const done = items.filter(item => item.status === "DONE");
  const current = useMemo(() => approvals[0] || open[0] || done[0], [approvals, open, done]);
  const effectiveInput = live.input || current?.input;

  useEffect(() => {
    const focus = () => {
      try { if (frameRef.current?.contentWindow) frameRef.current.contentWindow.location.hash = `focus=${live.node}`; } catch { /* same-origin frame may still be loading */ }
    };
    focus();
    const timer = window.setTimeout(focus, 250);
    return () => window.clearTimeout(timer);
  }, [live.node, expanded]);

  const run = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${employeeApiBase}/virtual-employees/${employeeId}/run-now`, { method: "POST", headers: authHeaders(true), body: "{}" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "运行失败"); }
    finally { setBusy(false); }
  };

  const approve = async (id: number) => {
    setBusy(true);
    try {
      const response = await fetch(`${employeeApiBase}/virtual-employees/tasks/${id}/approve`, { method: "POST", headers: authHeaders(true), body: "{}" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审批失败"); }
    finally { setBusy(false); }
  };

  return <section className="surface-panel" style={{ marginBottom: 14, border: "2px solid #0f766e", overflow: "hidden" }}>
    <div style={{ padding: "12px 16px", background: "linear-gradient(90deg,#064e3b,#0f766e)", color: "white", display: "flex", alignItems: "center", gap: 12 }}>
      <img src="/avatars/wms-receiving-employee-2026.png" alt="WMS 收料虚拟员工 林安" style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,.75)" }} />
      <span style={{ width: 10, height: 10, borderRadius: 10, background: error ? "#f87171" : live.connected ? "#4ade80" : "#fbbf24", boxShadow: "0 0 0 4px rgba(255,255,255,.15)" }} />
      <div><strong>林安 · WMS 收料专员</strong><div style={{ fontSize: 11, opacity: .82 }}>{live.connected ? "SSE 实时在线" : "正在重新连接"} · {live.phase}</div></div>
      <button type="button" onClick={() => void run()} disabled={busy} style={{ marginLeft: "auto", background: "white", color: "#065f46", border: 0, borderRadius: 7, padding: "8px 14px", fontWeight: 700 }}>{busy ? "检查中…" : "立即检查收料"}</button>
    </div>

    <div style={{ padding: "12px 16px", background: approvals.length ? "#fff7ed" : "#ecfdf5", borderBottom: `2px solid ${approvals.length ? "#f97316" : "#10b981"}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <span style={{ padding: "5px 9px", borderRadius: 999, background: live.connected ? "#16a34a" : "#d97706", color: "white", fontSize: 12, fontWeight: 900 }}>{live.connected ? "● 实时在线" : "● 正在重连"}</span>
      <div style={{ minWidth: 240 }}><div style={{ fontSize: 11, fontWeight: 900, color: "#475569" }}>虚拟员工当前状态</div><div style={{ fontSize: 20, fontWeight: 900, color: approvals.length ? "#9a3412" : "#064e3b" }}>{busy ? "正在扫描 WMS 收料任务…" : live.phase}</div></div>
      <div style={{ flex: 1, minWidth: 280, color: "#334155" }}>{live.guidance}</div>
      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#334155" }}>PO {value(effectiveInput, "poNo")} · LOT {value(effectiveInput, "lotNo")} · {value(effectiveInput, "materialCode")} · {value(effectiveInput, "receivedQty")} PCS</div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: expanded ? "1fr" : "minmax(420px,1.45fr) minmax(340px,1fr)", gap: 12, padding: 14 }}>
      <div style={{ minWidth: 0, border: "1px solid #99f6e4", borderRadius: 10, overflow: "hidden", background: "#f8fafc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid #ccfbf1" }}>
          <strong style={{ color: "#115e59" }}>Archify 实时收料流程</strong>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#475569" }}>当前节点：{live.phase}</span>
          <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "放大"}</button>
          <a href="/architecture/material-receiving-workflow.html" target="_blank" rel="noreferrer">独立打开</a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(86px,1fr))", gap: 6, padding: "9px 10px", background: "#f0fdfa", borderBottom: "1px solid #99f6e4" }}>
          {workflowSteps.map(([node, label], index) => {
            const active = node === live.node;
            const activeIndex = workflowSteps.findIndex(([candidate]) => candidate === live.node);
            const complete = activeIndex >= 0 && index < activeIndex;
            return <div key={node} style={{ position: "relative", padding: "13px 6px 8px", borderRadius: 7, textAlign: "center", fontSize: 11, fontWeight: 800, color: active ? "white" : complete ? "#166534" : "#64748b", background: active ? "#0f766e" : complete ? "#dcfce7" : "#e2e8f0", boxShadow: active ? "0 0 0 3px rgba(239,68,68,.3)" : "none" }}>{active && <span aria-label="当前工作流位置" style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", color: "#dc2626", fontSize: 22, lineHeight: 1, textShadow: "0 1px 2px white" }}>▼</span>}{index + 1}. {label}{active ? " · 当前" : ""}</div>;
          })}
        </div>
        <iframe ref={frameRef} title="Archify 物料接收实时流程" src={`/architecture/material-receiving-workflow.html#focus=${live.node}`} style={{ width: "100%", height: expanded ? 720 : 470, border: 0, display: "block", background: "#f8fafc" }} />
      </div>

      <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
        <div style={{ padding: 14, borderRadius: 9, background: "#eff6ff", border: "1px solid #93c5fd" }}>
          <div style={{ fontSize: 11, color: "#1e40af", fontWeight: 800 }}>实时执行指导</div>
          <h3 style={{ margin: "8px 0 6px" }}>{current?.title || live.phase}</h3>
          <p style={{ margin: 0, color: "#334155" }}>{live.guidance}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 12, fontSize: 12 }}>
            <span>PO：<b>{value(effectiveInput, "poNo")}</b></span><span>批次：<b>{value(effectiveInput, "lotNo")}</b></span>
            <span>物料：<b>{value(effectiveInput, "materialCode")}</b></span><span>数量：<b>{value(effectiveInput, "receivedQty")}</b></span>
            <span>供应商：<b>{value(effectiveInput, "supplierCode")}</b></span><span>仓位：<b>{value(effectiveInput, "locationCode")}</b></span>
          </div>
          {live.at && <div style={{ marginTop: 9, fontSize: 11, color: "#64748b" }}>最新事件：{new Date(live.at).toLocaleString()}</div>}
        </div>

        <div style={{ padding: 14, borderRadius: 9, background: "#fff7ed", border: "2px solid #f97316" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a3412", fontWeight: 900 }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: "#dc2626", boxShadow: "0 0 0 4px #fee2e2" }} />虚拟员工正在等待的现场输入</div>
          <div style={{ marginTop: 10, fontSize: 13 }}><b>输入提供者：</b>{(humanActions[live.node] || humanActions.supplierPrepare).actor}</div>
          <div style={{ marginTop: 6, fontSize: 13 }}><b>需要提供：</b>{(humanActions[live.node] || humanActions.supplierPrepare).action}</div>
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "white", color: "#166534", fontSize: 13 }}><b>虚拟员工继续执行的触发条件：</b>{(humanActions[live.node] || humanActions.supplierPrepare).done}</div>
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "#ecfdf5", color: "#064e3b", fontSize: 13 }}><b>触发后虚拟员工自动执行：</b>{(humanActions[live.node] || humanActions.supplierPrepare).next}</div>
        </div>

        <div style={{ padding: 14, borderRadius: 9, background: approvals.length ? "#fff7ed" : "#f0fdf4", border: `1px solid ${approvals.length ? "#fdba74" : "#86efac"}` }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: approvals.length ? "#9a3412" : "#166534" }}>人工沟通 / 审批</div>
          {approvals[0] ? <><h3 style={{ margin: "8px 0 5px" }}>{approvals[0].title}</h3><div style={{ fontSize: 12 }}>原因：{String((approvals[0].input?.missing as string[] || []).join("、") || approvals[0].human_gate || "收料差异")}</div><button type="button" disabled={busy} onClick={() => void approve(approvals[0].id)} style={{ marginTop: 10 }}>主管批准继续</button></> : <p style={{ margin: "8px 0 0" }}>没有等待人工批准的异常。</p>}
        </div>

        <div style={{ padding: 14, borderRadius: 9, background: "#f8fafc", border: "1px solid #cbd5e1" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>实时工作队列</div>
          <div style={{ display: "flex", gap: 16, margin: "10px 0" }}><b>待执行 {open.length}</b><b style={{ color: "#c2410c" }}>待审批 {approvals.length}</b><b style={{ color: "#15803d" }}>已交接 {done.length}</b></div>
          <div style={{ maxHeight: 112, overflow: "auto", fontSize: 11 }}>{items.slice(0, 6).map(item => <div key={item.id} style={{ padding: "5px 0", borderTop: "1px solid #e2e8f0" }}><b>{item.status}</b> · {item.title}</div>)}</div>
        </div>
      </div>
    </div>
    {error && <div style={{ padding: "0 14px 12px", color: "#b91c1c" }}>员工通讯异常：{error}</div>}
  </section>;
}
