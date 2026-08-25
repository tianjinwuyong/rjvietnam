import { useState, useEffect, useMemo } from "react";
import { t } from "../i18n";
import type { Locale, PmScheduleAssignment } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";

interface Props {
  locale: Locale;
}

export function PmSchedule({ locale }: Props) {
  const [assignments, setAssignments] = useState<PmScheduleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    maintenanceApi.getPmScheduleAssignments({})
      .then((res) => { setAssignments(res.items); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return assignments;
    if (statusFilter === "overdue") return assignments.filter((a) => a.isActive && a.nextDueDate < today);
    if (statusFilter === "active") return assignments.filter((a) => a.isActive);
    return assignments;
  }, [statusFilter, assignments, today]);

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("pm.scheduleNo", locale)}</th><th>{t("maintenance.equipmentNo", locale)}</th><th>{t("pm.template", locale)}</th><th>{t("pm.frequency", locale)}</th><th>{t("pm.nextDueDate", locale)}</th><th>{t("table.status", locale)}</th></tr></thead>
              <tbody>
                {[1,2,3,4,5].map((i) => (
                  <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 14, width: "80%" }} /></td></tr>
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
            <h2>{t("pm.schedule", locale)}</h2>
            <p>{t("pm.scheduleSubtitle", locale)}</p>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 12, padding: "8px 16px", alignItems: "center" }}>
          {["all", "active", "overdue"].map((s) => (
            <button
              key={s}
              className={`badge badge-${statusFilter === s ? "info" : "muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? t("ui.filterTabs", locale) : t(`maintenance.status.${s}` as any, locale)}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("pm.scheduleNo", locale)}</th>
                <th>{t("maintenance.equipmentNo", locale)}</th>
                <th>{t("maintenance.equipmentType", locale)}</th>
                <th>{t("pm.template", locale)}</th>
                <th>{t("pm.frequency", locale)}</th>
                <th>{t("pm.nextDueDate", locale)}</th>
                <th>{t("pm.lastCompleted", locale)}</th>
                <th>{t("maintenance.responsible", locale)}</th>
                <th>{t("table.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
              )}
              {filtered.map((a) => {
                const isOverdue = a.isActive && a.nextDueDate < today;
                return (
                  <tr key={a.id}>
                    <td><strong>{a.assetCode ?? a.assetId}</strong></td>
                    <td>{a.machineCode ?? "—"}</td>
                    <td>{a.machineType ?? "—"}</td>
                    <td>{a.templateName ?? "—"}</td>
                    <td>{a.frequencyName ?? a.frequencyCode}</td>
                    <td>
                      <span style={{ color: isOverdue ? "var(--danger)" : undefined, fontWeight: isOverdue ? 600 : undefined }}>
                        {a.nextDueDate}
                      </span>
                    </td>
                    <td>{a.lastCompletedDate ?? "—"}</td>
                    <td>{a.assignedTeam}</td>
                    <td>
                      <span className={`badge badge-${isOverdue ? "danger" : a.isActive ? "ok" : "muted"}`}>
                        {isOverdue ? t("maintenance.status.overdue", locale) : a.isActive ? t("maintenance.status.active", locale) : t("common.inactive", locale)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
