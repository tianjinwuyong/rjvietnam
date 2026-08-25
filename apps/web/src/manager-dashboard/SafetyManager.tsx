import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { useAmbassador, type AmbassadorAlert } from "./useAmbassador";

// ── Types ────────────────────────────────────────────────────────────
type Priority = "critical" | "warning" | "info";

interface SafetyAlert extends AmbassadorAlert {
  // extends AmbassadorAlert — no extra fields needed
}

// ── Alert derivation (safety-specific) ─────────────────────────────
const SAFETY_CRITICAL = new Set([
  "SCAN_ERROR", "WRONG_MATERIAL", "QTY_OVERFLOW", "OPERATION_HALT",
  "UNAUTHORIZED_SCAN", "IQC_REJECTED", "MATERIAL_EXPIRED",
  "FEEDER_FAULT", "LINE_STOP",
]);

const SAFETY_WARNING = new Set([
  "MATERIAL_SHORTAGE", "PARTIAL_LOAD", "SCAN_RETRY", "IQC_HOLD",
  "LOW_STOCK", "BOM_MISMATCH", "LOT_EXPIRY_SOON",
]);

const PRIORITY_MAP: Record<string, Priority> = {};
for (const t of SAFETY_CRITICAL) PRIORITY_MAP[t] = "critical";
for (const t of SAFETY_WARNING) PRIORITY_MAP[t] = "warning";

export function deriveSafetyAlerts(stats: { messages: Array<{ id: string; from_agent: string; to_agent: string; type: string; priority: string; status: string; latency_ms: number; created_at: string; subject: string }> }): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];
  const now = Date.now();
  for (const msg of stats.messages) {
    const p = PRIORITY_MAP[msg.type];
    if (!p) continue;
    const alertId = `safety_${msg.id}_${msg.type}`;
    const payload = { subject: msg.subject };
    alerts.push({
      id: alertId,
      agentId: msg.from_agent,
      agentName: msg.from_agent,
      severity: p,
      type: msg.type,
      message: buildSafetyMessage(msg.type, payload),
      metric: "safety_event",
      value: 1,
      threshold: 0,
      timestamp: msg.created_at,
    });
  }
  return alerts;
}

function buildSafetyMessage(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "SCAN_ERROR": return `❌ Scan failed | Device: ${payload.subject ?? "?"}`;
    case "WRONG_MATERIAL": return `🚨 Wrong material: ${payload.subject ?? "?"}`;
    case "QTY_OVERFLOW": return `⚠️ Quantity overflow: ${payload.subject ?? "?"}`;
    case "MATERIAL_SHORTAGE": return `📦 Material shortage: ${payload.subject ?? "?"}`;
    case "OPERATION_HALT": return `🛑 OPERATION HALTED: ${payload.subject ?? "manual stop"}`;
    case "UNAUTHORIZED_SCAN": return `🔒 Unauthorized scan attempt`;
    case "IQC_REJECTED": return `❌ IQC rejected: ${payload.subject ?? "?"}`;
    case "MATERIAL_EXPIRED": return `⏰ Expired material: ${payload.subject ?? "?"}`;
    case "FEEDER_FAULT": return `⚙️ Feeder fault: ${payload.subject ?? "?"}`;
    case "LINE_STOP": return `🛑 Line stopped: ${payload.subject ?? "?"}`;
    default: return `⚠️ Safety event: ${type}`;
  }
}

// ── Component ────────────────────────────────────────────────────────
const PRIORITY_COLOR: Record<Priority, string> = {
  critical: "#c62828",
  warning: "#ef6c00",
  info: "#2e7d32",
};

const PRIORITY_BG: Record<Priority, string> = {
  critical: "#ffebee",
  warning: "#fff3e0",
  info: "#e8f5e9",
};

export function SafetyManager({ locale }: { locale: Locale }) {
  const { alerts, loading, filter, setFilter, resolveAlert, criticalCount, warningCount, filteredAlerts } =
    useAmbassador<SafetyAlert>(deriveSafetyAlerts, 8000);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12, padding: "0 0 16px" }}>
      {/* ── Header + Stats ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>🛡️</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t("ambassador.safety.title", locale)}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: loading ? "#fff3e0" : "#e8f5e9", color: loading ? "#ef6c00" : "#2e7d32", fontWeight: 600 }}>
            {loading ? "○ LOADING" : "● ONLINE"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#ffebee", border: "1px solid #ef9a9a" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#c62828" }}>{criticalCount}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>Critical</span>
          </div>
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#fff3e0", border: "1px solid #ffcc80" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#ef6c00" }}>{warningCount}</span>
            <span style={{ fontSize: 11, marginLeft: 4, color: "#666" }}>Warning</span>
          </div>
        </div>
        {criticalCount > 0 && (
          <div style={{ padding: "4px 12px", borderRadius: 8, background: "#c62828", color: "#fff", fontWeight: 700, fontSize: 13 }}>
            🚨 {criticalCount} ACTIVE ALERT{criticalCount > 1 ? "S" : ""}
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#666" }}>{t("ambassador.filter", locale)}:</span>
        {(["all", "critical", "warning"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: filter === f ? "#1565c0" : "#e0e0e0", color: filter === f ? "#fff" : "#333" }}>
            {f === "all" ? t("ambassador.filterAll", locale) : f === "critical" ? t("ambassador.filterCritical", locale) : t("ambassador.filterWarning", locale)}
          </button>
        ))}
      </div>

      {/* ── Alert List ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filteredAlerts.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#aaa", fontSize: 14 }}>
            ✅ {t("ambassador.noAlerts", locale)}
          </div>
        )}
        {filteredAlerts.map(alert => (
          <div key={alert.id} style={{ marginBottom: 8, padding: 12, borderRadius: 8, background: PRIORITY_BG[alert.severity], borderLeft: `4px solid ${PRIORITY_COLOR[alert.severity]}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: PRIORITY_COLOR[alert.severity], textTransform: "uppercase" }}>
                  [{alert.severity}] {alert.type}
                </span>
                <span style={{ fontSize: 12, marginLeft: 8, color: "#1565c0", fontWeight: 600 }}>
                  {alert.agentName}
                </span>
              </div>
              <button onClick={() => resolveAlert(alert.id)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #999", cursor: "pointer", background: "#fff" }}>
                {t("ambassador.resolve", locale)}
              </button>
            </div>
            <div style={{ fontSize: 13, color: "#333", marginTop: 4 }}>{alert.message}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              {new Date(alert.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}