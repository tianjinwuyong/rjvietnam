import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AppEntry, AppType, AppStatus } from "./index";
import { projectsApi } from "../api/projects";
import { StatusBadge } from "./ProjectDashboard";

interface Props {
  locale: Locale;
  onEdit: (app: AppEntry) => void;
}

const typeIcons: Record<AppType, string> = {
  web: "🌐", service: "⚙️", integration: "🔌", database: "🗄️", "ai-model": "🧠", worker: "🔄",
};

export function ProjectList({ locale, onEdit }: Props) {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | AppStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | AppType>("all");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = () => {
    projectsApi.list().then((res) => { setApps(res.items); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = apps.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    return true;
  });

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      await projectsApi.remove(id);
      setApps((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error(err);
    }
    setDeleting(null);
    setConfirmDelete(null);
  };

  const handleStatusToggle = async (app: AppEntry) => {
    const nextStatus: AppStatus = app.status === "running" ? "stopped" : "running";
    try {
      await projectsApi.updateStatus(app.id, nextStatus);
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: nextStatus, lastHeartbeat: nextStatus === "running" ? new Date().toISOString() : a.lastHeartbeat } : a));
    } catch (err) { console.error(err); }
  };

  if (loading) return <div className="screen-stack"><div className="surface-panel" style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div>;

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("project.list.title", locale)}</h2>
            <p>{t("project.list.subtitle", locale)}</p>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 16px 12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.filter", locale)}:</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} style={{ fontSize: 12, padding: "3px 8px" }}>
            <option value="all">{t("common.all", locale)}</option>
            {(["running", "stopped", "error", "maintenance", "building"] as AppStatus[]).map((s) => (
              <option key={s} value={s}>{t(`project.status.${s}` as any, locale)}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={{ fontSize: 12, padding: "3px 8px" }}>
            <option value="all">{t("common.all", locale)} {t("project.type", locale)}</option>
            {(["web", "service", "integration", "database", "ai-model", "worker"] as AppType[]).map((at) => (
              <option key={at} value={at}>{t(`project.type.${at}` as any, locale)}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
            {filtered.length} / {apps.length}
          </span>
        </div>

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("project.code", locale)}</th>
                <th>{t("project.name", locale)}</th>
                <th>{t("project.type", locale)}</th>
                <th>{t("project.version", locale)}</th>
                <th>{t("project.status", locale)}</th>
                <th>{t("project.endpoint", locale)}</th>
                <th>{t("project.lastHeartbeat", locale)}</th>
                <th>{t("project.owner", locale)}</th>
                <th>{t("common.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
              ) : filtered.map((app) => (
                <tr key={app.id}>
                  <td><strong style={{ fontFamily: "monospace", fontSize: 13 }}>{app.code}</strong></td>
                  <td>
                    <div>{app.name_zh}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{app.name_en}</div>
                  </td>
                  <td><span style={{ fontSize: 13 }}>{typeIcons[app.type]} {t(`project.type.${app.type}` as any, locale)}</span></td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{app.version}</td>
                  <td><StatusBadge status={app.status} locale={locale} /></td>
                  <td style={{ fontSize: 12, fontFamily: "monospace", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {app.endpoint || "—"}
                  </td>
                  <td style={{ fontSize: 12, color: app.lastHeartbeat ? "var(--muted)" : "var(--danger)" }}>
                    {app.lastHeartbeat ? formatTimeAgo(app.lastHeartbeat, locale) : t("common.never", locale)}
                  </td>
                  <td style={{ fontSize: 13 }}>{app.owner}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <button className="badge badge-info" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} onClick={() => onEdit(app)}>
                        {t("common.edit", locale)}
                      </button>
                      <button className={`badge ${app.status === "running" ? "badge-warning" : "badge-ok"}`}
                        style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }}
                        onClick={() => handleStatusToggle(app)}>
                        {app.status === "running" ? t("common.stop", locale) : t("common.start", locale)}
                      </button>
                      {confirmDelete === app.id ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="badge badge-danger" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} disabled={deleting === app.id} onClick={() => handleDelete(app.id)}>
                            {t("common.confirm", locale)}
                          </button>
                          <button className="badge badge-muted" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} onClick={() => setConfirmDelete(null)}>
                            {t("common.cancel", locale)}
                          </button>
                        </div>
                      ) : (
                        <button className="badge badge-danger" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }}
                          onClick={() => setConfirmDelete(app.id)}>
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
    </div>
  );
}

function formatTimeAgo(iso: string, locale: Locale): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("project.justNow", locale);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
