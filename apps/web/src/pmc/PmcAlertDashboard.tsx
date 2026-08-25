import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

type AlertLevel = "overdue" | "delay" | "material_risk" | "normal";

interface AlertItem {
  id: number;
  code: string;
  status: string;
  plannedQty: number;
  completedQty: number;
  dueDate: string | null;
  releasedAt: string | null;
  productCode: string;
  productNameZh: string;
  lineCode: string;
  lineNameZh: string;
  poNumber: string | null;
  alertLevel: AlertLevel;
  progressPct: number;
  materialFulfillment: number | null;
  daysUntilDue: number | null;
}

interface Counts {
  overdue: number;
  delay: number;
  material_risk: number;
}

const ALERT_COLORS: Record<AlertLevel, string> = {
  overdue: "badge-danger",
  delay: "badge-warning",
  material_risk: "badge-info",
  normal: "badge-muted",
};

const ALERT_LABEL_KEY: Record<AlertLevel, string> = {
  overdue: "pmc.alert.overdue",
  delay: "pmc.alert.delay",
  material_risk: "pmc.alert.materialRisk",
  normal: "pmc.alert.normal",
};

export function PmcAlertDashboard({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [counts, setCounts] = useState<Counts>({ overdue: 0, delay: 0, material_risk: 0 });
  const [filter, setFilter] = useState<AlertLevel | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pmcApi.getWorkOrderAlerts("all", 100).then((res) => {
      setItems(res.data.items);
      setCounts(res.data.counts);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? items : items.filter((i) => i.alertLevel === filter);
  const totalAlerts = counts.overdue + counts.delay + counts.material_risk;

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
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.alertDashboard", locale)}</h2>
            <p>{t("pmc.alertDashboardDesc", locale)}</p>
          </div>
          {totalAlerts > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="badge badge-danger" style={{ fontSize: 16, padding: "6px 12px" }}>
                {totalAlerts} {t("pmc.alert.pending", locale)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="content-grid three" style={{ gap: 12 }}>
        <div
          className="surface-panel"
          style={{
            padding: "16px 20px",
            cursor: "pointer",
            border: filter === "overdue" ? "2px solid var(--danger)" : "1px solid var(--border)",
          }}
          onClick={() => setFilter(filter === "overdue" ? "all" : "overdue")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "var(--danger)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
                {t("pmc.alert.overdue", locale)}
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: "var(--danger)", marginTop: 4 }}>
                {counts.overdue}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.alert.overdueDesc", locale)}</div>
            </div>
            <div style={{ fontSize: 28, opacity: 0.3 }}>⚠</div>
          </div>
        </div>

        <div
          className="surface-panel"
          style={{
            padding: "16px 20px",
            cursor: "pointer",
            border: filter === "delay" ? "2px solid var(--warning)" : "1px solid var(--border)",
          }}
          onClick={() => setFilter(filter === "delay" ? "all" : "delay")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "var(--warning)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
                {t("pmc.alert.delay", locale)}
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: "var(--warning)", marginTop: 4 }}>
                {counts.delay}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.alert.delayDesc", locale)}</div>
            </div>
            <div style={{ fontSize: 28, opacity: 0.3 }}>�</div>
          </div>
        </div>

        <div
          className="surface-panel"
          style={{
            padding: "16px 20px",
            cursor: "pointer",
            border: filter === "material_risk" ? "2px solid var(--info)" : "1px solid var(--border)",
          }}
          onClick={() => setFilter(filter === "material_risk" ? "all" : "material_risk")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "var(--info)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
                {t("pmc.alert.materialRisk", locale)}
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: "var(--info)", marginTop: 4 }}>
                {counts.material_risk}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.alert.materialRiskDesc", locale)}</div>
            </div>
            <div style={{ fontSize: 28, opacity: 0.3 }}>📦</div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="surface-panel">
        <div style={{ display: "flex", gap: 8 }}>
          {(["all", "overdue", "delay", "material_risk"] as const).map((f) => (
            <button
              key={f}
              className={`badge ${filter === f ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? t("common.all", locale) : t(ALERT_LABEL_KEY[f], locale)}
              {f !== "all" && (
                <span style={{ marginLeft: 6 }}>
                  ({((counts as unknown) as Record<string, number>)[f] ?? 0})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Alert table */}
      <div className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.code", locale)}</th>
                <th>{t("common.product", locale)}</th>
                <th>{t("common.line", locale)}</th>
                <th>{t("common.progress", locale)}</th>
                <th>{t("pmc.dueDate", locale)}</th>
                <th>{t("pmc.daysRemaining", locale)}</th>
                <th>{t("pmc.materialFulfillment", locale)}</th>
                <th>{t("table.status", locale)}</th>
                <th>{t("pmc.alertLevel", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr
                    key={item.id}
                    style={{
                      background:
                        item.alertLevel === "overdue"
                          ? "rgba(200,50,50,0.04)"
                          : item.alertLevel === "material_risk"
                          ? "rgba(0,100,200,0.04)"
                          : item.alertLevel === "delay"
                          ? "rgba(200,150,0,0.04)"
                          : undefined,
                    }}
                  >
                    <td>
                      <strong>{item.code}</strong>
                      {item.poNumber && (
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>PO: {item.poNumber}</div>
                      )}
                    </td>
                    <td>
                      <div>{item.productCode}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.productNameZh}</div>
                    </td>
                    <td>
                      <div>{item.lineCode}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.lineNameZh}</div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 100 }}>
                        <div className="progress" style={{ flex: 1, margin: 0 }}>
                          <span style={{ width: `${item.progressPct}%` }} />
                        </div>
                        <span style={{ fontSize: 11 }}>{item.progressPct}%</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {item.completedQty.toLocaleString()} / {item.plannedQty.toLocaleString()}
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      {item.daysUntilDue !== null ? (
                        <span
                          style={{
                            color:
                              item.daysUntilDue < 0
                                ? "var(--danger)"
                                : item.daysUntilDue <= 3
                                ? "var(--warning)"
                                : "var(--ok)",
                            fontWeight: 600,
                          }}
                        >
                          {item.daysUntilDue < 0
                            ? `${Math.abs(item.daysUntilDue)} ${t("pmc.daysOverdue", locale)}`
                            : `${item.daysUntilDue} ${t("pmc.daysLeft", locale)}`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {item.materialFulfillment !== null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 80 }}>
                          <div className="progress" style={{ flex: 1, margin: 0 }}>
                            <span
                              style={{
                                width: `${item.materialFulfillment}%`,
                                background:
                                  item.materialFulfillment >= 80
                                    ? "var(--ok)"
                                    : item.materialFulfillment >= 50
                                    ? "var(--warning)"
                                    : "var(--danger)",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 11 }}>{item.materialFulfillment}%</span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${item.status === "running" ? "ok" : item.status === "released" ? "info" : "muted"}`}>
                        {t(`workorder.${item.status}`, locale)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${ALERT_COLORS[item.alertLevel]}`}>
                        {t(ALERT_LABEL_KEY[item.alertLevel], locale)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
