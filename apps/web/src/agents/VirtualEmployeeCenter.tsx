import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, RefreshCw, ShieldCheck } from "lucide-react";

type Employee = {
  id: string; name: string; domain: string; level: string; status: string; mode: string;
  capabilities: string[]; humanGates: string[]; taskCounts: Record<string, number>;
};

export function VirtualEmployeeCenter() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/factory/virtual-employees", { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setEmployees(payload?.data?.items || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(load, 10000); return () => window.clearInterval(timer); }, [load]);

  const active = employees.filter(item => item.mode === "ACTIVE_EXECUTOR").length;
  const open = employees.reduce((sum, item) => sum + Number(item.taskCounts?.OPEN || 0), 0);
  const approvals = employees.reduce((sum, item) => sum + Number(item.taskCounts?.WAITING_APPROVAL || 0), 0);
  return <div className="screen-stack" style={{ padding: 16, gap: 14 }}>
    <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div><h2 style={{ margin: 0 }}>全厂虚拟员工运行中心</h2><p style={{ margin: "4px 0 0", color: "var(--text-3)" }}>统一职责、任务、人工审批和审计；每 10 秒刷新。</p></div>
      <button onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "刷新中" : "刷新"}</button>
    </section>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(130px,1fr))", gap: 10 }}>
      {[["员工总数", employees.length], ["专用执行器", active], ["开放任务", open], ["待人工审批", approvals]].map(([label,value]) =>
        <div key={String(label)} className="surface-panel" style={{ padding: 14 }}><div style={{ color: "var(--text-3)", fontSize: 12 }}>{label}</div><strong style={{ fontSize: 24 }}>{value}</strong></div>)}
    </section>
    {error && <div style={{ color: "var(--danger)" }}>运行中心连接失败：{error}</div>}
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
      {employees.map(employee => <article key={employee.id} className="surface-panel" style={{ padding: 14, display: "grid", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Bot size={18}/><strong>{employee.name}</strong><span style={{ marginLeft: "auto", color: employee.mode === "ACTIVE_EXECUTOR" ? "var(--ok)" : "var(--warning)", fontSize: 11 }}>{employee.mode === "ACTIVE_EXECUTOR" ? "运行执行器" : "受控工作骨架"}</span></div>
        <code style={{ fontSize: 11 }}>{employee.id}</code>
        <div style={{ fontSize: 12 }}><Activity size={13}/> {employee.domain.toUpperCase()} · {employee.level} · {employee.status}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{employee.capabilities.map(item => <span key={item} style={{ padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 10 }}>{item}</span>)}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}><ShieldCheck size={12}/> 人工审批门：{employee.humanGates.join("、") || "无"}</div>
        <div style={{ fontSize: 11 }}>OPEN {employee.taskCounts?.OPEN || 0} · APPROVAL {employee.taskCounts?.WAITING_APPROVAL || 0} · DONE {employee.taskCounts?.DONE || 0}</div>
      </article>)}
    </section>
  </div>;
}
