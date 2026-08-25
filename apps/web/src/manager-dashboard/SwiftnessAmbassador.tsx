import { useAmbassador, type BusStats, type AmbassadorAlert } from "./useAmbassador";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

interface SwiftnessAlert extends AmbassadorAlert {}

export function deriveSwiftnessAlerts(stats: BusStats): SwiftnessAlert[] {
  const alerts: SwiftnessAlert[] = [];
  const { avg_latency_ms, pending_count, messages } = stats;
  const now = Date.now();
  const staleMessages = messages.filter(m => m.status === "pending" && (now - new Date(m.created_at).getTime()) / 1000 >= 60);

  if (avg_latency_ms >= 1000) {
    alerts.push({ id: "sys-lat-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "SLOW_SYSTEM", message: `Avg latency ${avg_latency_ms.toFixed(0)}ms — sluggish (>1000ms critical)`, metric: "avg_latency_ms", value: avg_latency_ms, threshold: 1000, timestamp: new Date().toISOString() });
  } else if (avg_latency_ms >= 300) {
    alerts.push({ id: "sys-lat-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "ELEVATED_LATENCY", message: `Avg latency ${avg_latency_ms.toFixed(0)}ms — above 300ms warning threshold`, metric: "avg_latency_ms", value: avg_latency_ms, threshold: 300, timestamp: new Date().toISOString() });
  }

  if (staleMessages.length >= 3) {
    alerts.push({ id: "sys-stale-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "STALE_PENDING", message: `${staleMessages.length} messages stuck > 60s — targets may be unreachable`, metric: "stale_pending_count", value: staleMessages.length, threshold: 3, timestamp: new Date().toISOString() });
  } else if (staleMessages.length >= 1) {
    alerts.push({ id: "sys-stale-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "AGING_PENDING", message: `${staleMessages.length} pending message(s) aging > 60s`, metric: "stale_pending_count", value: staleMessages.length, threshold: 1, timestamp: new Date().toISOString() });
  }

  for (const agentId of Object.keys(stats.per_agent)) {
    const agent = stats.per_agent[agentId];
    if (agent.avg_latency_ms >= 1000) {
      alerts.push({ id: `${agentId}-slow-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "AGENT_SLOW_RESPONSE", message: `${agent.agent_name} avg ${agent.avg_latency_ms.toFixed(0)}ms — slow (>1000ms)`, metric: "agent_avg_latency_ms", value: agent.avg_latency_ms, threshold: 1000, timestamp: new Date().toISOString() });
    } else if (agent.avg_latency_ms >= 300) {
      alerts.push({ id: `${agentId}-slow-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "AGENT_ELEVATED_LATENCY", message: `${agent.agent_name} avg ${agent.avg_latency_ms.toFixed(0)}ms — elevated (>300ms)`, metric: "agent_avg_latency_ms", value: agent.avg_latency_ms, threshold: 300, timestamp: new Date().toISOString() });
    }
    if (agent.failed_count >= 5) {
      alerts.push({ id: `${agentId}-repeat-fail-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "REPEATED_FAILURES", message: `${agent.agent_name} has ${agent.failed_count} failures — may be stuck in retry loop`, metric: "failed_count", value: agent.failed_count, threshold: 5, timestamp: new Date().toISOString() });
    } else if (agent.failed_count >= 3) {
      alerts.push({ id: `${agentId}-repeat-fail-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "REPEATED_FAILURES", message: `${agent.agent_name} has ${agent.failed_count} failures — check if agent is processing correctly`, metric: "failed_count", value: agent.failed_count, threshold: 3, timestamp: new Date().toISOString() });
    }
  }

  return alerts;
}

const PRIORITY_COLOR = { critical: "#c62828", warning: "#ef6c00", info: "#2e7d32" };
const PRIORITY_BG = { critical: "#ffebee", warning: "#fff3e0", info: "#e8f5e9" };

export function SwiftnessAmbassador({ locale }: { locale: Locale }) {
  const { stats, alerts, loading, filter, setFilter, resolveAlert, criticalCount, warningCount, filteredAlerts } =
    useAmbassador(deriveSwiftnessAlerts, 8000);
  const stats_ = stats ?? { avg_latency_ms: 0, pending_count: 0, throughput: 0 };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12, padding: "0 0 16px" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>🚀</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t("ambassador.swiftness.title", locale)}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: loading ? "#fff3e0" : "#e8f5e9", color: loading ? "#ef6c00" : "#2e7d32", fontWeight: 600 }}>
            {loading ? "○ LOADING" : "● ONLINE"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#f5f5f5", border: "1px solid #bdbdbd" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#333" }}>{stats_.avg_latency_ms.toFixed(0)}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>ms avg</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#fff3e0", border: "1px solid #ffcc80" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#e65100" }}>{stats_.pending_count}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>Pending</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#e8f5e9", border: "1px solid #a5d6a7" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#2e7d32" }}>{stats_.throughput.toFixed(1)}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>msg/min</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#ffebee", border: "1px solid #ef9a9a" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#c62828" }}>{criticalCount}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>{t("ambassador.critical", locale)}</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#fff3e0", border: "1px solid #ffcc80" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#ef6c00" }}>{warningCount}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>{t("ambassador.warning", locale)}</span>
          </div>
        </div>
        {criticalCount > 0 && (
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#c62828", color: "#fff", fontWeight: 700, fontSize: 13 }}>
            🚨 {criticalCount} CRITICAL
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#666" }}>{t("ambassador.filter", locale)}:</span>
        {(["all", "critical", "warning"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: filter === f ? "#1565c0" : "#e0e0e0", color: filter === f ? "#fff" : "#333" }}>
            {f === "all" ? t("ambassador.filterAll", locale) : f === "critical" ? t("ambassador.filterCritical", locale) : t("ambassador.filterWarning", locale)}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filteredAlerts.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#aaa", fontSize: 14 }}>✅ {t("ambassador.noAlerts", locale)}</div>
        )}
        {filteredAlerts.map(alert => (
          <div key={alert.id} style={{ marginBottom: 8, padding: 12, borderRadius: 8, background: PRIORITY_BG[alert.severity], borderLeft: `4px solid ${PRIORITY_COLOR[alert.severity]}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: PRIORITY_COLOR[alert.severity], textTransform: "uppercase" }}>[{alert.severity}] {alert.type}</span>
                <span style={{ fontSize: 12, marginLeft: 8, color: "#1565c0", fontWeight: 600 }}>{alert.agentName}</span>
              </div>
              <button onClick={() => resolveAlert(alert.id)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #999", cursor: "pointer", background: "#fff" }}>{t("ambassador.resolve", locale)}</button>
            </div>
            <div style={{ fontSize: 13, color: "#333", marginTop: 4 }}>{alert.message}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{t("ambassador.metric", locale)}: {alert.metric} = {alert.value.toFixed(1)} | {t("ambassador.threshold", locale)}: {alert.threshold}<span style={{ marginLeft: 8 }}>{new Date(alert.timestamp).toLocaleTimeString()}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}