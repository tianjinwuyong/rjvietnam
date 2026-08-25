import { useState, useMemo, useEffect } from "react";
import { t } from "../i18n";
import type { Locale, InspectionAssignment } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import { Calendar, CheckCircle2, Clock, XCircle } from "lucide-react";

const statusConfig: Record<string, { label: string; badge: string }> = {
  pending: { label: "inspection.pending", badge: "info" },
  in_progress: { label: "status.running", badge: "warning" },
  completed: { label: "status.pass", badge: "ok" },
  skipped: { label: "status.skipped", badge: "muted" },
};

export function InspectionPlan({ locale }: { locale: Locale }) {
  const [assignments, setAssignments] = useState<InspectionAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    maintenanceApi.getInspectionAssignments({ limit: 200 })
      .then((res) => { setAssignments(res.items); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => {
    return assignments.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (dateFilter && a.shiftDate !== dateFilter) return false;
      return true;
    });
  }, [statusFilter, dateFilter, assignments]);

  const counts = useMemo(() => {
    const byDate = assignments.filter((a) => a.shiftDate === (dateFilter || today));
    return {
      all: byDate.length,
      pending: byDate.filter((a) => a.status === "pending").length,
      in_progress: byDate.filter((a) => a.status === "in_progress").length,
      completed: byDate.filter((a) => a.status === "completed").length,
      skipped: byDate.filter((a) => a.status === "skipped").length,
    };
  }, [assignments, dateFilter, today]);

  const handleStatusChange = (id: string, newStatus: string) => {
    maintenanceApi.updateInspectionAssignment(id, { status: newStatus }).then(() => {
      setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, status: newStatus as any } : a));
    });
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header">
            <h2>{t("inspection.plan", locale)}</h2>
            <p>{t("inspection.planDesc", locale)}</p>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("inspection.assignmentNo", locale)}</th>
                  <th>{t("inspection.machine", locale)}</th>
                  <th>{t("inspection.template", locale)}</th>
                  <th>{t("inspection.shiftType", locale)}</th>
                  <th>{t("inspection.assignee", locale)}</th>
                  <th>{t("table.status", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td><div className="skeleton" style={{ height: 14, width: 120 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 80 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 100 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 60 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 80 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 70 }} /></td>
                  </tr>
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
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("inspection.plan", locale)}</h2>
            <p>{t("inspection.planDesc", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Calendar size={16} style={{ color: "var(--muted)" }} />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{ fontSize: 13, padding: "4px 8px" }}
            />
          </div>
        </div>

        <div className="filter-row" style={{ display: "flex", gap: 8, padding: "8px 16px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("table.status", locale)}:</span>
          {(["all", "pending", "in_progress", "completed", "skipped"] as const).map((s) => {
            const cfg = s === "all" ? null : statusConfig[s];
            const count = s === "all" ? counts.all : counts[s as keyof typeof counts];
            return (
              <button
                key={s}
                className={`badge badge-${statusFilter === s ? "info" : "muted"}`}
                style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? t("ui.filterTabs", locale) : t(cfg?.label ?? s, locale)}
                {count > 0 && <span style={{ marginLeft: 4, opacity: 0.8 }}>({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("inspection.assignmentNo", locale)}</th>
                <th>{t("inspection.machine", locale)}</th>
                <th>{t("inspection.template", locale)}</th>
                <th>{t("inspection.shiftType", locale)}</th>
                <th>{t("inspection.shiftDate", locale)}</th>
                <th>{t("inspection.assignee", locale)}</th>
                <th>{t("table.status", locale)}</th>
                <th>{t("common.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const cfg = statusConfig[a.status] ?? statusConfig.pending;
                return (
                  <tr key={a.id}>
                    <td><strong>{a.assignmentNo}</strong></td>
                    <td>
                      <span>{a.machineCode}</span>
                      {a.machineType && <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 4 }}>{a.machineType}</span>}
                    </td>
                    <td>{a.templateName ?? a.templateId}</td>
                    <td>
                      <span className="badge badge-muted">{t(`inspection.shiftType.${a.shiftType}`, locale)}</span>
                    </td>
                    <td>{a.shiftDate}</td>
                    <td>{a.assignedToName ?? a.assignedTo ?? "-"}</td>
                    <td>
                      <span className={`badge badge-${cfg.badge}`}>
                        {t(cfg.label, locale)}
                      </span>
                    </td>
                    <td>
                      {a.status === "pending" && (
                        <button
                          className="badge badge-warning"
                          style={{ cursor: "pointer", border: "none" }}
                          onClick={() => handleStatusChange(a.id, "in_progress")}
                        >
                          {t("inspection.start", locale)}
                        </button>
                      )}
                      {a.status === "in_progress" && (
                        <button
                          className="badge badge-ok"
                          style={{ cursor: "pointer", border: "none" }}
                          onClick={() => handleStatusChange(a.id, "completed")}
                        >
                          {t("inspection.complete", locale)}
                        </button>
                      )}
                      {(a.status === "pending" || a.status === "in_progress") ? (
                        <button
                          className="badge badge-muted"
                          style={{ cursor: "pointer", border: "none", marginLeft: 4 }}
                          onClick={() => handleStatusChange(a.id, "skipped")}
                        >
                          {t("status.skipped", locale)}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
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
