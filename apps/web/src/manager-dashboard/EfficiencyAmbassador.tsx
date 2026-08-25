import { useAmbassador, type BusStats, type AmbassadorAlert } from "./useAmbassador";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

interface EfficiencyAlert extends AmbassadorAlert {}

export function deriveEfficiencyAlerts(stats: BusStats): EfficiencyAlert[] {
  const alerts: EfficiencyAlert[] = [];
  const { throughput, queue_depth, avg_latency_ms, per_agent, total_messages } = stats;

  if (throughput > 0 && throughput <= 5) {
    alerts.push({ id: "sys-tput-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "LOW_THROUGHPUT", message: `Throughput ${throughput.toFixed(1)} msg/min — below critical 5 msg/min`, metric: "throughput", value: throughput, threshold: 5, timestamp: new Date().toISOString() });
  } else if (throughput > 0 && throughput <= 15) {
    alerts.push({ id: "sys-tput-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "LOW_THROUGHPUT", message: `Throughput ${throughput.toFixed(1)} msg/min — below warning 15 msg/min`, metric: "throughput", value: throughput, threshold: 15, timestamp: new Date().toISOString() });
  }

  if (queue_depth >= 60) {
    alerts.push({ id: "sys-queue-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "QUEUE_OVERLOAD", message: `${queue_depth} messages queued — system overloaded (>60 critical)`, metric: "queue_depth", value: queue_depth, threshold: 60, timestamp: new Date().toISOString() });
  } else if (queue_depth >= 30) {
    alerts.push({ id: "sys-queue-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "QUEUE_BUILDUP", message: `${queue_depth} messages queued — building up (>30 warning)`, metric: "queue_depth", value: queue_depth, threshold: 30, timestamp: new Date().toISOString() });
  }

  if (avg_latency_ms >= 1500) {
    alerts.push({ id: "sys-lat-crit", agentId: "SYSTEM", agentName: "System", severity: "critical", type: "HIGH_LATENCY", message: `Avg latency ${avg_latency_ms.toFixed(0)}ms — extremely slow (>1500ms critical)`, metric: "avg_latency_ms", value: avg_latency_ms, threshold: 1500, timestamp: new Date().toISOString() });
  } else if (avg_latency_ms >= 500) {
    alerts.push({ id: "sys-lat-warn", agentId: "SYSTEM", agentName: "System", severity: "warning", type: "HIGH_LATENCY", message: `Avg latency ${avg_latency_ms.toFixed(0)}ms — elevated (>500ms warning)`, metric: "avg_latency_ms", value: avg_latency_ms, threshold: 500, timestamp: new Date().toISOString() });
  }

  for (const agentId of Object.keys(per_agent)) {
    const agent = per_agent[agentId];
    if (agent.messages_sent < 2 && total_messages > 20) {
      alerts.push({ id: `${agentId}-idle-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "AGENT_IDLE", message: `${agent.agent_name} sent only ${agent.messages_sent} messages — agent may be offline/stuck`, metric: "messages_sent", value: agent.messages_sent, threshold: 2, timestamp: new Date().toISOString() });
    } else if (agent.messages_sent < 5 && total_messages > 20) {
      alerts.push({ id: `${agentId}-idle-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "AGENT_LOW_VOLUME", message: `${agent.agent_name} low activity: ${agent.messages_sent} messages sent`, metric: "messages_sent", value: agent.messages_sent, threshold: 5, timestamp: new Date().toISOString() });
    }
    if (agent.avg_latency_ms >= 1500) {
      alerts.push({ id: `${agentId}-lat-crit`, agentId, agentName: agent.agent_name, severity: "critical", type: "AGENT_HIGH_LATENCY", message: `${agent.agent_name} avg latency ${agent.avg_latency_ms.toFixed(0)}ms — slow (>1500ms)`, metric: "agent_avg_latency_ms", value: agent.avg_latency_ms, threshold: 1500, timestamp: new Date().toISOString() });
    } else if (agent.avg_latency_ms >= 500) {
      alerts.push({ id: `${agentId}-lat-warn`, agentId, agentName: agent.agent_name, severity: "warning", type: "AGENT_ELEVATED_LATENCY", message: `${agent.agent_name} avg latency ${agent.avg_latency_ms.toFixed(0)}ms — elevated (>500ms)`, metric: "agent_avg_latency_ms", value: agent.avg_latency_ms, threshold: 500, timestamp: new Date().toISOString() });
    }
  }

  return alerts;
}

const PRIORITY_COLOR = { critical: "#c62828", warning: "#ef6c00", info: "#2e7d32" };
const PRIORITY_BG = { critical: "#ffebee", warning: "#fff3e0", info: "#e8f5e9" };

export function EfficiencyAmbassador({ locale }: { locale: Locale }) {
  const { stats, alerts, loading, filter, setFilter, resolveAlert, criticalCount, warningCount, filteredAlerts } =
    useAmbassador(deriveEfficiencyAlerts, 8000);
  const stats_ = stats ?? { throughput: 0, queue_depth: 0, avg_latency_ms: 0 };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12, padding: "0 0 16px" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t("ambassador.efficiency.title", locale)}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: loading ? "#fff3e0" : "#e8f5e9", color: loading ? "#ef6c00" : "#2e7d32", fontWeight: 600 }}>
            {loading ? "○ LOADING" : "● ONLINE"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#e3f2fd", border: "1px solid #90caf9" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#1565c0" }}>{stats_.throughput.toFixed(1)}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>msg/min</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#fff3e0", border: "1px solid #ffcc80" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#e65100" }}>{stats_.queue_depth}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>Queue</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#f5f5f5", border: "1px solid #bdbdbd" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#333" }}>{stats_.avg_latency_ms.toFixed(0)}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>ms avg</span>
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