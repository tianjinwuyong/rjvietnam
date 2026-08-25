import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { Project, ProjectStatus, ProjectType } from "../api/projectMgmt";
import { projectMgmtApi } from "../api/projectMgmt";

interface Props {
  locale: Locale;
}

const STATUS_ORDER: ProjectStatus[] = ["planning", "in_progress", "on_hold", "completed", "cancelled"];

const TYPE_ORDER: ProjectType[] = ["engineering", "rd", "tech_improvement", "new_product", "cooperation", "cooperation_outsource"];

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

export function ProjectMgmtDashboard({ locale }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectMgmtApi.list().then((res) => { setProjects(res.items); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const byStatus = (s: ProjectStatus) => projects.filter((p) => p.status === s).length;
  const byType = (t: ProjectType) => projects.filter((p) => p.type === t).length;
  const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
  const activeCount = projects.filter((p) => p.status === "in_progress").length;
  const completedCount = projects.filter((p) => p.status === "completed").length;

  if (loading) return <div className="surface-panel" style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>;

  return (
    <div className="surface-panel">
      {/* Metric row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div className="metric-card">
          <div className="metric-value">{projects.length}</div>
          <div className="metric-label">{t("projectMgmt.total", locale)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-value" style={{ color: "var(--info)" }}>{activeCount}</div>
          <div className="metric-label">{t("projectMgmt.active", locale)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-value" style={{ color: "var(--ok)" }}>{completedCount}</div>
          <div className="metric-label">{t("projectMgmt.completed", locale)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{totalBudget >= 1_000_000 ? `${(totalBudget / 1_000_000).toFixed(1)}M` : `${(totalBudget / 1000).toFixed(0)}K`}</div>
          <div className="metric-label">{t("projectMgmt.totalBudget", locale)} (CNY)</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {/* By Status */}
        <div style={{ padding: "16px 20px", borderRight: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{t("projectMgmt.byStatus", locale)}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STATUS_ORDER.map((s) => {
              const count = byStatus(s);
              const pct = projects.length ? (count / projects.length) * 100 : 0;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusBadge status={s} locale={locale} />
                  <div style={{ flex: 1, background: "var(--nav)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--info)", transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 12, minWidth: 20, textAlign: "right" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By Type */}
        <div style={{ padding: "16px 20px" }}>
          <h3 style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{t("projectMgmt.byType", locale)}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TYPE_ORDER.map((pt) => {
              const count = byType(pt);
              const pct = projects.length ? (count / projects.length) * 100 : 0;
              return (
                <div key={pt} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, minWidth: 120, color: "var(--text)" }}>{t(`projectMgmt.type.${pt}` as any, locale)}</span>
                  <div style={{ flex: 1, background: "var(--nav)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--ok)", transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 12, minWidth: 20, textAlign: "right" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent projects */}
      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{t("projectMgmt.recent", locale)}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
              <span style={{ fontFamily: "monospace", fontSize: 12, minWidth: 120 }}>{p.code}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name_zh}</span>
              <StatusBadge status={p.status} locale={locale} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
