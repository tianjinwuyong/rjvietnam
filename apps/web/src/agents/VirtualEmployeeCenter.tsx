import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, RefreshCw, ShieldCheck } from "lucide-react";
import { authHeaders } from "../api/client";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Employee = {
  id: string; name: string; domain: string; level: string; status: string; mode: string;
  enabled?: boolean;
  capabilities: string[]; humanGates: string[]; taskCounts: Record<string, number>;
};

export function VirtualEmployeeCenter({ locale }: { locale: Locale }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/factory/virtual-employees", { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setEmployees(payload?.data?.items || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(load, 10000); return () => window.clearInterval(timer); }, [load]);

  const active = employees.filter(item => item.mode === "ACTIVE_EXECUTOR").length;
  const open = employees.reduce((sum, item) => sum + Number(item.taskCounts?.OPEN || 0), 0);
  const approvals = employees.reduce((sum, item) => sum + Number(item.taskCounts?.WAITING_APPROVAL || 0), 0);
  return <section className="screen-stack" aria-label={t("agents.center.heading", locale)} data-testid="agents.run-center">
    <div className="page-header">
      <div>
        <h2>{t("agents.center.heading", locale)}</h2>
        <p>{t("agents.center.desc", locale)}</p>
      </div>
      <button type="button" className="action-button" onClick={() => void load()} disabled={loading} title={t("agents.center.refresh", locale)} data-testid="agents.refresh">
        <RefreshCw size={14} /> {loading ? t("agents.center.refreshing", locale) : t("agents.center.refresh", locale)}
      </button>
    </div>
    <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4,minmax(130px,1fr))" }} data-testid="agents.kpis">
      <article className="stat-tile"><span>{t("agents.center.totalEmployees", locale)}</span><strong>{employees.length}</strong></article>
      <article className="stat-tile"><span>{t("agents.center.activeExecutors", locale)}</span><strong>{active}</strong></article>
      <article className="stat-tile"><span>{t("agents.center.openTasks", locale)}</span><strong>{open}</strong></article>
      <article className="stat-tile"><span>{t("agents.center.pendingApprovals", locale)}</span><strong>{approvals}</strong></article>
    </div>
    {error && <p className="error-note" role="alert" data-testid="agents.error">{t("agents.center.loadFailed", locale)}: {error}</p>}
    {employees.length === 0 && !loading && !error ? (
      <div className="empty-state" data-testid="agents.empty"><strong>{t("agents.center.empty", locale)}</strong></div>
    ) : (
      <div className="card-grid">
        {employees.map(employee => <article key={employee.id} className="employee-card" data-testid={`agents.card.${employee.id}`} style={employee.enabled === false ? { opacity: 0.55 } : undefined}>
          <header>
            <Bot size={18} aria-hidden="true" />
            <strong>{employee.name}</strong>
            <span style={{ marginLeft: "auto" }}>
              {employee.enabled === false
                ? <span className="badge badge-danger" title={t("veManage.disabled", locale)}>{t("veManage.disabled", locale)}</span>
                : employee.mode === "ACTIVE_EXECUTOR"
                  ? <span className="badge badge-ok" title={t("agents.mode.activeExecutor", locale)}>{t("agents.mode.activeExecutor", locale)}</span>
                  : <span className="badge badge-warning" title={t("agents.mode.controlledSkeleton", locale)}>{t("agents.mode.controlledSkeleton", locale)}</span>}
            </span>
          </header>
          <code>{employee.id}</code>
          <div className="meta"><Activity size={13} aria-hidden="true" /> {employee.domain.toUpperCase()} · {employee.level} · {employee.status}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{employee.capabilities.map(item => <span key={item} className="chip">{item}</span>)}</div>
          <div className="gates"><ShieldCheck size={12} aria-hidden="true" /> {t("agents.center.humanGates", locale)}: {employee.humanGates.join(", ") || t("agents.center.none", locale)}</div>
          <div className="counts">OPEN {employee.taskCounts?.OPEN || 0} · APPROVAL {employee.taskCounts?.WAITING_APPROVAL || 0} · CLOSED {["DONE", "RESOLVED", "COMPLETED", "CLOSED", "HANDED_OFF"].reduce((sum, key) => sum + Number(employee.taskCounts?.[key] || 0), 0)}</div>
        </article>)}
      </div>
    )}
  </section>;
}
