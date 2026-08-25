import { useEffect, useState, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { bomApi } from "../api/bom";

type Props = { locale: Locale };

interface AlertEntry {
  id: string;
  type: string;
  severity: string;
  message: string;
  time: string;
  resolved: boolean;
}

const SEVERITY_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  high: { bg: "#fef2f2", color: "#b91c1c", label: "bom.alert.critical" },
  medium: { bg: "#fffbeb", color: "#b45309", label: "bom.alert.medium" },
  low: { bg: "#f0f9ff", color: "#0369a1", label: "bom.alert.low" },
};

const TYPE_I18N: Record<string, string> = {
  phantom: "bom.alerts.type.phantom",
  duplicate: "bom.alerts.type.duplicate",
  zeroQty: "bom.alerts.type.zeroQty",
  orphan: "bom.alerts.type.orphan",
  costAnomaly: "bom.alerts.type.costAnomaly",
};

export function BomAlerts({ locale }: Props) {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await bomApi.bomAlerts();
      setAlerts(data);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleResolve = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, resolved: !a.resolved } : a))
    );
  };

  const handleClear = () => {
    setAlerts([]);
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("bom.alerts.title", locale)}</h2>
            <p>{t("bom.alert.empty", locale)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {alerts.length} {t("bom.history.totalEntries", locale)}
            </span>
            {alerts.length > 0 && (
              <button type="button" className="action-button" onClick={handleClear}>
                🗑️ {t("bom.alerts.clearAll", locale)}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="content-grid three" style={{ gap: 12 }}>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
            {t("bom.alert.critical", locale)}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--danger)" }}>
            {alerts.filter((a) => a.severity === "high" && !a.resolved).length}
          </div>
        </div>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
            {t("bom.alert.medium", locale)}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--warning)" }}>
            {alerts.filter((a) => a.severity === "medium" && !a.resolved).length}
          </div>
        </div>
        <div className="surface-panel" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
            {t("bom.alert.low", locale)}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--info)" }}>
            {alerts.filter((a) => a.severity === "low" && !a.resolved).length}
          </div>
        </div>
      </div>

      {/* Alerts Table */}
      {alerts.length === 0 ? (
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
            {t("bom.alerts.noData", locale)}
          </div>
        </div>
      ) : (
        <div className="surface-panel">
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("bom.alerts.time", locale)}</th>
                  <th>{t("bom.alerts.type", locale)}</th>
                  <th>{t("bom.alerts.severity", locale)}</th>
                  <th>{t("bom.alerts.message", locale)}</th>
                  <th>{t("bom.history.col.action", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const severity = SEVERITY_BADGE[alert.severity] ?? SEVERITY_BADGE.low;
                  return (
                    <tr
                      key={alert.id}
                      style={{
                        opacity: alert.resolved ? 0.5 : 1,
                        background: alert.resolved ? undefined : alert.severity === "high" ? "rgba(200,50,50,0.03)" : undefined,
                      }}
                    >
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {new Date(alert.time).toLocaleString()}
                      </td>
                      <td>
                        <span
                          className="badge badge-muted"
                          title={t(TYPE_I18N[alert.type] ?? alert.type, locale)}
                        >
                          {t(TYPE_I18N[alert.type] ?? alert.type, locale)}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            background: severity.bg,
                            color: severity.color,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          {t(severity.label, locale)}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {alert.message}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="action-button"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => handleResolve(alert.id)}
                        >
                          {alert.resolved
                            ? `🔄 ${t("bom.history.revert", locale)}`
                            : `✅ ${t("bom.alert.markResolved", locale)}`}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
