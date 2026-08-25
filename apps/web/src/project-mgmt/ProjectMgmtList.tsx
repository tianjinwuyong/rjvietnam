import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { Project, ProjectStatus, ProjectType } from "../api/projectMgmt";
import { projectMgmtApi } from "../api/projectMgmt";

interface Props {
  locale: Locale;
  onEdit: (p: Project) => void;
}

function StatusBadge({ status, locale }: { status: ProjectStatus; locale: Locale }) {
  const tones: Record<ProjectStatus, string> = {
    planning: "badge-muted",
    in_progress: "badge-info",
    on_hold: "badge-warning",
    completed: "badge-ok",
    cancelled: "badge-danger",
  };
  return <span className={`badge ${tones[status]}`}>{t(`projectMgmt.status.${status}` as any, locale)}</span>;
}

function TypeBadge({ type, locale }: { type: ProjectType; locale: Locale }) {
  const colors: Record<ProjectType, string> = {
    engineering: "badge-info",
    rd: "badge-warning",
    tech_improvement: "badge-muted",
    new_product: "badge-ok",
    cooperation: "badge-danger",
    cooperation_outsource: "badge-danger",
  };
  return <span className={`badge ${colors[type]}`}>{t(`projectMgmt.type.${type}` as any, locale)}</span>;
}

export function ProjectMgmtList({ locale, onEdit }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ProjectType>("all");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = () => {
    projectMgmtApi.list().then((res) => { setProjects(res.items); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = projects.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (typeFilter !== "all" && p.type !== typeFilter) return false;
    return true;
  });

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      await projectMgmtApi.remove(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) { console.error(err); }
    setDeleting(null);
    setConfirmDelete(null);
  };

  const formatDate = (d: string) => d ? d.slice(0, 10) : "—";

  if (loading) return <div className="surface-panel" style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>;

  return (
    <div className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{t("projectMgmt.list.title", locale)}</h2>
          <p>{t("projectMgmt.list.subtitle", locale)}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 16px 12px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.filter", locale)}:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ fontSize: 12, padding: "3px 8px" }}>
          <option value="all">{t("common.all", locale)} {t("common.status", locale)}</option>
          {(["planning", "in_progress", "on_hold", "completed", "cancelled"] as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>{t(`projectMgmt.status.${s}` as any, locale)}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={{ fontSize: 12, padding: "3px 8px" }}>
          <option value="all">{t("common.all", locale)} {t("projectMgmt.type.label", locale)}</option>
          {(["engineering", "rd", "tech_improvement", "new_product", "cooperation", "cooperation_outsource"] as ProjectType[]).map((pt) => (
            <option key={pt} value={pt}>{t(`projectMgmt.type.${pt}` as any, locale)}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          {filtered.length} / {projects.length}
        </span>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>{t("projectMgmt.code", locale)}</th>
              <th>{t("projectMgmt.name", locale)}</th>
              <th>{t("projectMgmt.type.label", locale)}</th>
              <th>{t("common.status", locale)}</th>
              <th>{t("projectMgmt.department", locale)}</th>
              <th>{t("projectMgmt.manager", locale)}</th>
              <th>{t("projectMgmt.budget", locale)}</th>
              <th>{t("projectMgmt.startDate", locale)}</th>
              <th>{t("projectMgmt.endDate", locale)}</th>
              <th>{t("common.actions", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id}>
                <td><strong style={{ fontFamily: "monospace", fontSize: 12 }}>{p.code}</strong></td>
                <td>
                  <div>{p.name_zh}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.name_en}</div>
                </td>
                <td><TypeBadge type={p.type} locale={locale} /></td>
                <td><StatusBadge status={p.status} locale={locale} /></td>
                <td style={{ fontSize: 13 }}>{p.department}</td>
                <td style={{ fontSize: 13 }}>{p.manager}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.budget.toLocaleString()} {p.currency}</td>
                <td style={{ fontSize: 12 }}>{formatDate(p.startDate)}</td>
                <td style={{ fontSize: 12 }}>{formatDate(p.endDate)}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="badge badge-info" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} onClick={() => onEdit(p)}>
                      {t("common.edit", locale)}
                    </button>
                    {confirmDelete === p.id ? (
                      <>
                        <button className="badge badge-danger" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} disabled={deleting === p.id} onClick={() => handleDelete(p.id)}>
                          {t("common.confirm", locale)}
                        </button>
                        <button className="badge badge-muted" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} onClick={() => setConfirmDelete(null)}>
                          {t("common.cancel", locale)}
                        </button>
                      </>
                    ) : (
                      <button className="badge badge-danger" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} onClick={() => setConfirmDelete(p.id)}>
                        {t("common.delete", locale)}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
