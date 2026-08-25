import { useState, useEffect, useMemo } from "react";
import { t } from "../i18n";
import type { Locale, InspectionAbnormal } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";

interface Props {
  locale: Locale;
}

export function FaultReportList({ locale }: Props) {
  const [abnormals, setAbnormals] = useState<InspectionAbnormal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    maintenanceApi.getInspectionAbnormals({})
      .then((res) => { setAbnormals(res.items); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return abnormals;
    return abnormals.filter((a) => a.status === statusFilter);
  }, [statusFilter, abnormals]);

  const severityTone = (s: InspectionAbnormal["severity"]) => {
    if (s === "critical") return "danger";
    if (s === "high") return "warning";
    if (s === "medium") return "info";
    return "muted";
  };

  const statusTone = (s: InspectionAbnormal["status"]) => {
    if (s === "resolved" || s === "closed") return "ok";
    if (s === "acknowledged") return "warning";
    return "danger";
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("fault.reportNo", locale)}</th><th>{t("maintenance.equipmentNo", locale)}</th><th>{t("fault.type", locale)}</th><th>{t("fault.severity", locale)}</th><th>{t("table.status", locale)}</th></tr></thead>
              <tbody>
                {[1,2,3,4,5].map((i) => (
                  <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 14, width: "80%" }} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("maintenance.subnav.faultReport", locale)}</h2>
            <p>{t("fault.subtitle", locale)}</p>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 12, padding: "8px 16px", alignItems: "center" }}>
          {["all", "reported", "acknowledged", "resolved", "closed"].map((s) => (
            <button
              key={s}
              className={`badge badge-${statusFilter === s ? "info" : "muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? t("ui.filterTabs", locale) : t(`fault.status.${s}` as any, locale)}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("fault.reportNo", locale)}</th>
                <th>{t("maintenance.equipmentNo", locale)}</th>
                <th>{t("fault.type", locale)}</th>
                <th>{t("fault.description", locale)}</th>
                <th>{t("fault.severity", locale)}</th>
                <th>{t("fault.reportedBy", locale)}</th>
                <th>{t("fault.reportedAt", locale)}</th>
                <th>{t("maintenance.responsible", locale)}</th>
                <th>{t("table.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
              )}
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.abnormalNo}</strong></td>
                  <td>{a.machineCode ?? a.machineId}</td>
                  <td>
                    <span className="badge badge-muted">
                      {t(`fault.type.${a.abnormalityType}` as any, locale)}
                    </span>
                  </td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.description}>
                    {a.description}
                  </td>
                  <td>
                    <span className={`badge badge-${severityTone(a.severity)}`}>
                      {t(`fault.severity.${a.severity}` as any, locale)}
                    </span>
                  </td>
                  <td>{a.reportedBy ?? "—"}</td>
                  <td>{a.reportedAt ? a.reportedAt.slice(0, 16) : "—"}</td>
                  <td>{a.assignedTo ?? "—"}</td>
                  <td>
                    <span className={`badge badge-${statusTone(a.status)}`}>
                      {t(`fault.status.${a.status}` as any, locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
