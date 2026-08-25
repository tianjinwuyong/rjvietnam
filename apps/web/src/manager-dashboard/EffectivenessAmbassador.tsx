import { useAmbassador, type BusStats, type AmbassadorAlert } from "./useAmbassador";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

interface EffectivenessAlert extends AmbassadorAlert {}

export function deriveEffectivenessAlerts(stats: BusStats): EffectivenessAlert[] {
  const alerts: EffectivenessAlert[] = [];
  const { per_agent, total_messages, pending_count, error_rate } = stats;
  if (total_messages > 20) {
    if (error_rate >= 0.08) {
      alerts.push({ id: "sys-err-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "HIGH_ERROR_RATE", message: `System error rate ${(error_rate * 100).toFixed(1)}% — exceeds 8% critical threshold`, metric: "error_rate", value: error_rate, threshold: 0.08, timestamp: new Date().toISOString() });
    } else if (error_rate >= 0.03) {
      alerts.push({ id: "sys-err-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "HIGH_ERROR_RATE", message: `System error rate ${(error_rate * 100).toFixed(1)}% — exceeds 3% warning threshold`, metric: "error_rate", value: error_rate, threshold: 0.03, timestamp: new Date().toISOString() });
    }
  }
  if (total_messages > 0) {
    const ratio = pending_count / total_messages;
    if (ratio >= 0.30) {
      alerts.push({ id: "sys-pend-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "HIGH_PENDING_RATIO", message: `${pending_count} pending / ${total_messages} total = ${(ratio * 100).toFixed(1)}% — queue overloaded`, metric: "pending_ratio", value: ratio, threshold: 0.30, timestamp: new Date().toISOString() });
    } else if (ratio >= 0.15) {
      alerts.push({ id: "sys-pend-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "HIGH_PENDING_RATIO", message: `${pending_count} pending / ${total_messages} total = ${(ratio * 100).toFixed(1)}% — queue building up`, metric: "pending_ratio", value: ratio, threshold: 0.15, timestamp: new Date().toISOString() });
    }
  }
  for (const agentId of Object.keys(per_agent)) {
    const agent = per_agent[agentId];
    const total = agent.messages_sent + agent.failed_count;
    if (total < 5) continue;
    const successRate = total > 0 ? agent.success_count / total : 1;
    const errRate = total > 0 ? agent.failed_count / total : 0;
    if (successRate < 0.70) {
      alerts.push({ id: `${agentId}-low-success-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "LOW_SUCCESS_RATE", message: `${agent.agent_name} success rate ${(successRate * 100).toFixed(1)}% < 70% critical`, metric: "success_rate", value: successRate, threshold: 0.70, timestamp: new Date().toISOString() });
    } else if (successRate < 0.85) {
      alerts.push({ id: `${agentId}-low-success-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "LOW_SUCCESS_RATE", message: `${agent.agent_name} success rate ${(successRate * 100).toFixed(1)}% < 85% warning`, metric: "success_rate", value: successRate, threshold: 0.85, timestamp: new Date().toISOString() });
    }
    if (errRate >= 0.08) {
      alerts.push({ id: `${agentId}-err-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "HIGH_AGENT_ERROR_RATE", message: `${agent.agent_name} error rate ${(errRate * 100).toFixed(1)}% — ${agent.failed_count} failed / ${total} total`, metric: "agent_error_rate", value: errRate, threshold: 0.08, timestamp: new Date().toISOString() });
    }
  }
  return alerts;
}

const PRIORITY_COLOR = { critical: "#c62828", warning: "#ef6c00", info: "#2e7d32" };
const PRIORITY_BG = { critical: "#ffebee", warning: "#fff3e0", info: "#e8f5e9" };

export function EffectivenessAmbassador({ locale }: { locale: Locale }) {
  const { stats, alerts, loading, filter, setFilter, resolveAlert, criticalCount, warningCount, filteredAlerts } =
    useAmbassador(deriveEffectivenessAlerts, 8000);
  const total = stats?.total_messages ?? 0;
  const successRate = total > 0 && stats ? stats.completed_count / total : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12, padding: "0 0 16px" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>📈</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t("ambassador.effectiveness.title", locale)}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: loading ? "#fff3e0" : "#e8f5e9", color: loading ? "#ef6c00" : "#2e7d32", fontWeight: 600 }}>
            {loading ? "○ LOADING" : "● ONLINE"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["total", "critical", "warning", "info"] as const).map(k => {
            const val = k === "total" ? total : k === "critical" ? criticalCount : k === "warning" ? warningCount : (stats?.completed_count ?? 0);
            const label = k === "total" ? "Total" : k === "critical" ? t("ambassador.critical", locale) : k === "warning" ? t("ambassador.warning", locale) : "Success";
            return (
              <div key={k} style={{ padding: "4px 12px", borderRadius: 8, background: k === "critical" ? "#ffebee" : k === "warning" ? "#fff3e0" : k === "info" ? "#e8f5e9" : "#f5f5f5", border: `1px solid ${k === "critical" ? "#ef9a9a" : k === "warning" ? "#ffcc80" : k === "info" ? "#a5d6a7" : "#bdbdbd"}` }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{val}</span>
                <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>{label}</span>
              </div>
            );
          })}
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#e3f2fd", border: "1px solid #90caf9" }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{(successRate * 100).toFixed(1)}%</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>Success Rate</span>
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
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{t("ambassador.metric", locale)}: {alert.metric} = {(alert.value * 100).toFixed(1)}% | {t("ambassador.threshold", locale)}: {(alert.threshold * 100).toFixed(1)}%<span style={{ marginLeft: 8 }}>{new Date(alert.timestamp).toLocaleTimeString()}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}