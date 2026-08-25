import { useAmbassador, type BusStats, type AmbassadorAlert } from "./useAmbassador";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

interface CollaborationAlert extends AmbassadorAlert {}

export function deriveCollaborationAlerts(stats: BusStats): CollaborationAlert[] {
  const alerts: CollaborationAlert[] = [];
  const { failed_count, per_agent, messages } = stats;
  const orphanRequests = messages.filter(m => m.status === "pending" && m.type === "request").length;

  if (failed_count >= 5) {
    alerts.push({ id: "sys-failed-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "HIGH_SYSTEM_FAILURE", message: `${failed_count} failed deliveries — possible network issue or target agent down`, metric: "failed_count", value: failed_count, threshold: 5, timestamp: new Date().toISOString() });
  } else if (failed_count >= 2) {
    alerts.push({ id: "sys-failed-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "ELEVATED_SYSTEM_FAILURE", message: `${failed_count} failed deliveries — some targets unreachable`, metric: "failed_count", value: failed_count, threshold: 2, timestamp: new Date().toISOString() });
  }

  if (orphanRequests >= 8) {
    alerts.push({ id: "sys-orphan-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "ORPHAN_REQUESTS", message: `${orphanRequests} unanswered requests — targets may be unreachable`, metric: "orphan_request_count", value: orphanRequests, threshold: 8, timestamp: new Date().toISOString() });
  } else if (orphanRequests >= 3) {
    alerts.push({ id: "sys-orphan-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "UNANSWERED_REQUESTS", message: `${orphanRequests} request messages pending without response`, metric: "orphan_request_count", value: orphanRequests, threshold: 3, timestamp: new Date().toISOString() });
  }

  for (const agentId of Object.keys(per_agent)) {
    const agent = per_agent[agentId];
    if (agent.messages_sent === 0 && agent.messages_received === 0 && stats.total_messages > 20) {
      alerts.push({ id: `${agentId}-silent-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "AGENT_SILENT", message: `${agent.agent_name} has sent and received 0 messages — agent may be offline/disconnected`, metric: "messages_sent", value: 0, threshold: 0, timestamp: new Date().toISOString() });
    }
    const total = agent.messages_sent + agent.messages_received;
    if (total > 10) {
      const ratio = agent.messages_sent > 0 ? agent.messages_received / agent.messages_sent : 0;
      if (ratio < 0.2 && agent.messages_sent > 5) {
        alerts.push({ id: `${agentId}-imbalance-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "SEND_RECEIVE_IMBALANCE", message: `${agent.agent_name} sent ${agent.messages_sent} but received only ${agent.messages_received} — very one-directional`, metric: "recv_sent_ratio", value: ratio, threshold: 0.2, timestamp: new Date().toISOString() });
      }
    }
    if (agent.failed_count >= 5) {
      alerts.push({ id: `${agentId}-failed-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "AGENT_HIGH_FAILURE", message: `${agent.agent_name} has ${agent.failed_count} failed deliveries — target unreachable or service down`, metric: "agent_failed_count", value: agent.failed_count, threshold: 5, timestamp: new Date().toISOString() });
    } else if (agent.failed_count >= 2) {
      alerts.push({ id: `${agentId}-failed-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "AGENT_ELEVATED_FAILURE", message: `${agent.agent_name} has ${agent.failed_count} failed deliveries`, metric: "agent_failed_count", value: agent.failed_count, threshold: 2, timestamp: new Date().toISOString() });
    }
  }

  return alerts;
}

const PRIORITY_COLOR = { critical: "#c62828", warning: "#ef6c00", info: "#2e7d32" };
const PRIORITY_BG = { critical: "#ffebee", warning: "#fff3e0", info: "#e8f5e9" };

export function CollaborationAmbassador({ locale }: { locale: Locale }) {
  const { stats, alerts, loading, filter, setFilter, resolveAlert, criticalCount, warningCount, filteredAlerts } =
    useAmbassador(deriveCollaborationAlerts, 8000);
  const stats_ = stats ?? { failed_count: 0 };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12, padding: "0 0 16px" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>🤝</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t("ambassador.collaboration.title", locale)}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: loading ? "#fff3e0" : "#e8f5e9", color: loading ? "#ef6c00" : "#2e7d32", fontWeight: 600 }}>
            {loading ? "○ LOADING" : "● ONLINE"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#ffebee", border: "1px solid #ef9a9a" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#c62828" }}>{stats_.failed_count}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>Failed</span>
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