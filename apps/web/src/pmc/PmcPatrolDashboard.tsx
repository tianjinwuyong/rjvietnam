import { useEffect, useState, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

/** Patrol node states */
export type PatrolNodeState = "firing" | "warning" | "idle" | "disabled";

export interface PatrolNode {
  state: PatrolNodeState;
  detail: string;
  escalations: number;
}

export interface PatrolState {
  cycle: number;
  timestamp: string;
  nodes: Record<string, PatrolNode>;
  total_escalations: number;
  overdue_count: number;
  patrol_duration_ms: number;
}

const STATE_COLORS: Record<PatrolNodeState, { fill: string; stroke: string; text: string; glow: string }> = {
  firing:   { fill: "#f87171", stroke: "#b91c1c", text: "#fff", glow: "0 0 12px #f8717188" },
  warning:  { fill: "#fbbf24", stroke: "#b45309", text: "#000", glow: "0 0 8px #fbbf2488" },
  idle:     { fill: "#4ade80", stroke: "#15803d", text: "#000", glow: "0 0 6px #4ade8044" },
  disabled: { fill: "#94a3b8", stroke: "#475569", text: "#fff", glow: "none" },
};

const NODE_ICONS: Record<string, string> = {
  delivery_watch:     "📦",
  rate_check:         "⚡",
  abnormal_detector:  "⚙️",
  material_shortage:  "📋",
  notification_router:"📱",
};

function NodeCard({ id, label, node }: { id: string; label: string; node: PatrolNode }) {
  const colors = STATE_COLORS[node.state];
  const icon = NODE_ICONS[id] ?? "🔔";

  return (
    <div
      style={{
        background: colors.fill,
        border: `2px solid ${colors.stroke}`,
        borderRadius: 10,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        boxShadow: colors.glow,
        minWidth: 160,
        transition: "all 0.3s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            color: colors.text,
            letterSpacing: "0.05em",
            opacity: 0.8,
          }}
        >
          {node.state}
        </span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{label}</div>
      <div style={{ fontSize: 11, color: colors.text, opacity: 0.85 }}>{node.detail}</div>
      {node.escalations > 0 && (
        <div
          style={{
            marginTop: 4,
            background: "rgba(0,0,0,0.15)",
            borderRadius: 20,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 700,
            color: colors.text,
            alignSelf: "flex-start",
          }}
        >
          {node.escalations} alert{node.escalations !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        fontSize: 11,
        gap: 2,
        padding: "0 4px",
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
      {label && <span style={{ whiteSpace: "nowrap" }}>{label}</span>}
    </div>
  );
}

function PatrolFlowChart({ state }: { state: PatrolState }) {
  const { nodes } = state;

  const deliveryWatch = nodes["delivery_watch"];
  const rateCheck = nodes["rate_check"];
  const abnormal = nodes["abnormal_detector"];
  const material = nodes["material_shortage"];
  const notify = nodes["notification_router"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        alignItems: "center",
        padding: "16px 0",
        overflowX: "auto",
      }}
    >
      {/* Patrol Start */}
      <div
        style={{
          background: "var(--nav)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 12,
        }}
      >
        🔄 Patrol Start · Cycle #{state.cycle} · {new Date(state.timestamp).toLocaleTimeString()}
      </div>

      {/* Row 1: Delivery Watch */}
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <NodeCard id="delivery_watch" label="Delivery Watch" node={deliveryWatch ?? { state: "disabled", detail: "not checked", escalations: 0 }} />
        <FlowArrow label="OVERDUE/WARNING?" />
        <NodeCard id="rate_check" label="Rate Check" node={rateCheck ?? { state: "disabled", detail: "not checked", escalations: 0 }} />
      </div>

      <FlowArrow label="anomaly?" />

      {/* Row 2: Abnormal Detector */}
      <NodeCard id="abnormal_detector" label="Abnormal Detector" node={abnormal ?? { state: "disabled", detail: "not checked", escalations: 0 }} />

      <FlowArrow label="shortage?" />

      {/* Row 3: Material Shortage */}
      <NodeCard id="material_shortage" label="Material Shortage" node={material ?? { state: "disabled", detail: "not checked", escalations: 0 }} />

      <FlowArrow label="log + notify" />

      {/* Row 4: Notification Router */}
      <NodeCard id="notification_router" label="Notification Router" node={notify ?? { state: "disabled", detail: "not checked", escalations: 0 }} />

      {/* Patrol Complete */}
      <div
        style={{
          background: "var(--surface-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 12,
          color: "var(--muted)",
          marginTop: 12,
        }}
      >
        ✅ Patrol complete · {state.patrol_duration_ms}ms · {state.total_escalations} total alerts
      </div>
    </div>
  );
}

function EscalationBadge({ type, count }: { type: string; count: number }) {
  const colorMap: Record<string, string> = {
    delivery_watch: "var(--danger)",
    wo_delay: "var(--warning)",
    wo_frozen: "var(--info)",
    ng_spike: "var(--danger)",
    material_shortage: "var(--warning)",
    bom_incomplete: "var(--info)",
    rate_deficit: "var(--warning)",
  };
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "var(--surface-panel)",
        border: `1px solid ${colorMap[type] ?? "var(--border)"}`,
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorMap[type] ?? "var(--muted)", display: "inline-block" }} />
      <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{count}</span>
      <span style={{ color: "var(--muted)" }}>{type}</span>
    </div>
  );
}

export function PmcPatrolDashboard({ locale }: { locale: Locale }) {
  const [patrolState, setPatrolState] = useState<PatrolState | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchPatrolState = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8080/pmc/patrol-state");
      if (res.ok) {
        const data: PatrolState = await res.json();
        setPatrolState(data);
        setLastRefresh(new Date());
      } else {
        // Fallback: try reading from file via API endpoint that reads the temp JSON
        const fileRes = await pmcApi.getPatrolState();
        if (fileRes) {
          setPatrolState(fileRes);
          setLastRefresh(new Date());
        }
      }
    } catch {
      // If both fail, use mock data for demo
      setPatrolState({
        cycle: 0,
        timestamp: new Date().toISOString(),
        nodes: {
          delivery_watch:    { state: "idle", detail: "No delivery alerts", escalations: 0 },
          rate_check:        { state: "idle", detail: "All WOs within rate", escalations: 0 },
          abnormal_detector: { state: "idle", detail: "No abnormal events", escalations: 0 },
          material_shortage: { state: "idle", detail: "All materials ready", escalations: 0 },
          notification_router: { state: "idle", detail: "No notifications needed", escalations: 0 },
        },
        total_escalations: 0,
        overdue_count: 0,
        patrol_duration_ms: 0,
      });
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatrolState();
    const interval = setInterval(fetchPatrolState, 30_000);
    return () => clearInterval(interval);
  }, [fetchPatrolState]);

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        </div>
      </div>
    );
  }

  const nodes = patrolState?.nodes ?? {};
  const firingNodes = Object.entries(nodes).filter(([, n]) => n.state === "firing" || n.state === "warning");
  const totalEscalations = Object.values(nodes).reduce((s, n) => s + n.escalations, 0);

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.patrolDashboard", locale)}</h2>
            <p>{t("pmc.patrolDashboardDesc", locale)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastRefresh && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("pmc.lastRefresh", locale)}: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              className="action-button"
              onClick={fetchPatrolState}
            >
              🔄 {t("pmc.refreshPatrol", locale)}
            </button>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="content-grid four" style={{ gap: 12 }}>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Cycle #</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--info)" }}>{patrolState?.cycle ?? "—"}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("pmc.currentCycle", locale)}</div>
        </div>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Total Alerts</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: totalEscalations > 0 ? "var(--danger)" : "var(--ok)" }}>
            {totalEscalations}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("pmc.thisCycle", locale)}</div>
        </div>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Overdue WOs</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: (patrolState?.overdue_count ?? 0) > 0 ? "var(--danger)" : "var(--ok)" }}>
            {patrolState?.overdue_count ?? 0}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("pmc.immediateAction", locale)}</div>
        </div>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Duration</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--muted)" }}>
            {patrolState?.patrol_duration_ms ?? 0}ms
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("pmc.patrolDuration", locale)}</div>
        </div>
      </div>

      {/* Firing Alerts Banner */}
      {firingNodes.length > 0 && (
        <div className="surface-panel" style={{ borderLeft: "4px solid var(--danger)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>🚨</span>
            <span style={{ fontWeight: 700, color: "var(--danger)" }}>
              {firingNodes.length} node{firingNodes.length !== 1 ? "s" : ""} firing
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {firingNodes.map(([key, node]) => (
              <EscalationBadge key={key} type={key} count={node.escalations} />
            ))}
          </div>
        </div>
      )}

      {/* Flow Chart */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.nodeFlow", locale)}</h2>
            <p>{t("pmc.nodeFlowDesc", locale)}</p>
          </div>
        </div>
        <PatrolFlowChart state={patrolState ?? {
          cycle: 0, timestamp: new Date().toISOString(),
          nodes: {
            delivery_watch:    { state: "disabled", detail: "—", escalations: 0 },
            rate_check:        { state: "disabled", detail: "—", escalations: 0 },
            abnormal_detector: { state: "disabled", detail: "—", escalations: 0 },
            material_shortage: { state: "disabled", detail: "—", escalations: 0 },
            notification_router: { state: "disabled", detail: "—", escalations: 0 },
          },
          total_escalations: 0, overdue_count: 0, patrol_duration_ms: 0,
        }} />
      </div>

      {/* Node Detail Table */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.nodeStatus", locale)}</h2>
            <p>{t("pmc.nodeStatusDesc", locale)}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("pmc.nodeName", locale)}</th>
                <th>{t("pmc.nodeState", locale)}</th>
                <th>{t("pmc.nodeDetail", locale)}</th>
                <th>{t("pmc.escalations", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(nodes).map(([key, node]) => (
                <tr
                  key={key}
                  style={{
                    background: node.state === "firing"
                      ? "rgba(200,50,50,0.05)"
                      : node.state === "warning"
                      ? "rgba(200,150,0,0.05)"
                      : undefined,
                  }}
                >
                  <td>
                    <strong>{NODE_ICONS[key] ?? "🔔"} {key.replace(/_/g, " ")}</strong>
                  </td>
                  <td>
                    <span
                      className={`badge badge-${
                        node.state === "firing" ? "danger" : node.state === "warning" ? "warning" : node.state === "idle" ? "ok" : "muted"
                      }`}
                    >
                      {node.state.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{node.detail}</td>
                  <td>
                    {node.escalations > 0 ? (
                      <span style={{ fontWeight: 700, color: "var(--danger)" }}>{node.escalations}</span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
