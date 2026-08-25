import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AppEntry, AppType, AppStatus } from "./index";
import { projectsApi } from "../api/projects";

interface Props {
  locale: Locale;
  onEdit: (app: AppEntry) => void;
}

const typeIcons: Record<AppType, string> = {
  web: "🌐", service: "⚙️", integration: "🔌", database: "🗄️", "ai-model": "🧠", worker: "🔄",
};

export function ProjectDashboard({ locale, onEdit }: Props) {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    projectsApi.list().then((res) => { setApps(res.items); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const byStatus: Record<AppStatus, number> = { running: 0, stopped: 0, error: 0, maintenance: 0, building: 0 };
  const byType: Record<string, number> = {};
  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
    byType[app.type] = (byType[app.type] ?? 0) + 1;
  }

  if (loading) return <div className="screen-stack"><div className="surface-panel" style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div>;

  const totalApps = apps.length;
  const runningApps = byStatus.running ?? 0;
  const healthPct = totalApps > 0 ? Math.round((runningApps / totalApps) * 100) : 0;

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("project.total", locale)}</span>
          <strong>{totalApps}</strong>
          <span className="badge badge-info">{t("project.registered", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("project.health", locale)}</span>
          <strong>{healthPct}%</strong>
          <span className={`badge badge-${healthPct >= 80 ? "ok" : healthPct >= 50 ? "warning" : "danger"}`}>
            {runningApps}/{totalApps} {t("project.status.running", locale)}
          </span>
        </article>
        <article className="stat-card">
          <span>{t("project.byType", locale)}</span>
          <strong>{Object.keys(byType).length}</strong>
          <span className="badge badge-info">{t("project.categories", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("project.needsAttention", locale)}</span>
          <strong>{(byStatus.error ?? 0) + (byStatus.stopped ?? 0)}</strong>
          <span className={`badge badge-${(byStatus.error ?? 0) > 0 ? "danger" : "warning"}`}>
            {byStatus.error ? `${byStatus.error} ${t("project.status.error", locale)}` : t("common.none", locale)}
          </span>
        </article>
      </div>

      {/* Type breakdown */}
      <div className="surface-panel">
        <div className="section-header"><div><h2>{t("project.byType", locale)}</h2></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, padding: 12 }}>
          {(["web", "service", "integration", "database", "ai-model", "worker"] as AppType[]).map((type) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--nav)", borderRadius: 6 }}>
              <span style={{ fontSize: 18 }}>{typeIcons[type]}</span>
              <div>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{t(`project.type.${type}` as any, locale)}</span>
                <strong style={{ display: "block", fontSize: 18 }}>{byType[type] ?? 0}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent apps */}
      <div className="surface-panel">
        <div className="section-header"><div><h2>{t("project.recent", locale)}</h2></div></div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("project.code", locale)}</th>
                <th>{t("project.name", locale)}</th>
                <th>{t("project.type", locale)}</th>
                <th>{t("project.version", locale)}</th>
                <th>{t("project.status", locale)}</th>
                <th>{t("project.owner", locale)}</th>
                <th>{t("common.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {apps.slice(0, 5).map((app) => (
                <tr key={app.id}>
                  <td><strong style={{ fontFamily: "monospace", fontSize: 13 }}>{app.code}</strong></td>
                  <td>{app.name_zh}</td>
                  <td><span style={{ fontSize: 13 }}>{typeIcons[app.type]} {t(`project.type.${app.type}` as any, locale)}</span></td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{app.version}</td>
                  <td><StatusBadge status={app.status} locale={locale} /></td>
                  <td style={{ fontSize: 13 }}>{app.owner}</td>
                  <td>
                    <button className="badge badge-info" style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} onClick={() => onEdit(app)}>
                      {t("common.edit", locale)}
                    </button>
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

export function StatusBadge({ status, locale }: { status: AppStatus; locale: Locale }) {
  const tone = status === "running" ? "ok" : status === "error" ? "danger" : status === "maintenance" ? "warning" : "muted";
  return <span className={`badge badge-${tone}`}>{t(`project.status.${status}` as any, locale)}</span>;
}
