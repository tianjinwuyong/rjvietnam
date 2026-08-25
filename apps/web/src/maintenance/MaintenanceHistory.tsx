import { useState, useMemo, useEffect } from "react";
import { t } from "../i18n";
import type { Locale, MaintenanceRecord } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";

const typeLabels: Record<string, string> = {
  preventive: "maintenance.preventive",
  corrective: "maintenance.corrective",
  inspection: "maintenance.inspection",
  calibration: "maintenance.calibration",
};

export function MaintenanceHistory({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    maintenanceApi.getRecords({ limit: 200 })
      .then((res) => { setRecords(res.items); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const completed = useMemo(() => records.filter((r) => r.status === "completed" || r.status === "cancelled"), [records]);
  const filtered = useMemo(() => {
    if (typeFilter === "all") return completed;
    return completed.filter((r) => r.type === typeFilter);
  }, [typeFilter, completed]);

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="metric-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <article className="stat-card" key={i}>
              <div className="skeleton" style={{ height: 14, width: "60%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 24, width: "40%" }} />
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("common.total", locale)}</span>
          <strong>{records.length}</strong>
          <span className="badge badge-info">{t("maintenance.subnav.history", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("status.pass", locale)}</span>
          <strong>{records.filter((r) => r.status === "completed").length}</strong>
          <span className="badge badge-ok">{t("maintenance.preventive", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("maintenance.overdueMaintenance", locale)}</span>
          <strong>{records.filter((r) => r.status === "overdue").length}</strong>
          <span className="badge badge-danger">{t("maintenance.corrective", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("maintenance.pendingMaintenance", locale)}</span>
          <strong>{records.filter((r) => r.status === "pending" || r.status === "in_progress").length}</strong>
          <span className="badge badge-warning">{t("maintenance.inspection", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("maintenance.calibration", locale)}</span>
          <strong>{records.filter((r) => r.type === "calibration").length}</strong>
          <span className="badge badge-info">{t("status.pending", locale)}</span>
        </article>
      </div>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("maintenance.subnav.history", locale)}</h2>
            <p>{(completed.length > 1 ? "Completed: " : "") + completed.length}</p>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 12, padding: "8px 16px", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("maintenance.maintenanceType", locale)}:</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ fontSize: 12, padding: "2px 6px" }}>
            <option value="all">{t("ui.filterTabs", locale)}</option>
            {Object.entries(typeLabels).map(([key, label]) => (
              <option key={key} value={key}>{t(label, locale)}</option>
            ))}
          </select>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("maintenance.equipmentNo", locale)}</th>
                <th>{t("maintenance.maintenanceType", locale)}</th>
                <th>{t("maintenance.description", locale)}</th>
                <th>{t("maintenance.scheduledDate", locale)}</th>
                <th>{t("maintenance.completedDate", locale)}</th>
                <th>{t("maintenance.operator", locale)}</th>
                <th>{t("maintenance.result", locale)}</th>
                <th>{t("maintenance.cost", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec) => (
                <tr key={rec.id}>
                  <td><strong>{rec.equipmentNo}</strong></td>
                  <td>{t(typeLabels[rec.type ?? ""] ?? rec.type ?? "", locale)}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.description}</td>
                  <td>{rec.scheduledDate}</td>
                  <td>{rec.completedDate ?? "-"}</td>
                  <td>{rec.operator}</td>
                  <td>{rec.result ?? "-"}</td>
                  <td>{rec.cost != null ? `¥${rec.cost}` : "-"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
