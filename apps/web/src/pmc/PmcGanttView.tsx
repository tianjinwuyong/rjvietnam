import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";

const PRIORITY_COLORS: Record<number, string> = { 1: "badge-danger", 2: "badge-warning", 3: "badge-info", 4: "badge-muted" };
const PRIORITY_LABELS: Record<number, string> = { 1: "pmc.priority.critical", 2: "pmc.priority.high", 3: "pmc.priority.normal", 4: "pmc.priority.low" };

export function PmcGanttView({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLine, setSelectedLine] = useState("");

  useEffect(() => {
    pmcApi.getWorkOrderGantt(selectedLine || undefined).then((r: any) => {
      setItems(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [selectedLine]);

  if (loading) {
    return <div className="screen-stack"><div className="surface-panel"><div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div></div>;
  }

  // Calculate bar widths relative to a 30-day window
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 30);
  const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

  function dateToX(dateStr: string | null) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    return Math.max(0, Math.min(100, ((d.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100));
  }

  function barWidth(releasedAt: string | null, dueDate: string | null) {
    const s = dateToX(releasedAt);
    const e = dueDate ? dateToX(dueDate) : 100;
    return Math.max(1, e - s);
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.ganttView", locale)}</h2>
            <p>{t("pmc.ganttViewDesc", locale)}</p>
          </div>
          <input
            type="text"
            placeholder={t("common.line", locale)}
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            style={{ width: 120 }}
          />
        </div>
      </div>

      {/* Timeline header */}
      <div className="surface-panel" style={{ padding: "8px 16px", overflowX: "auto" }}>
        <div style={{ display: "flex", minWidth: 900, position: "relative", height: 32, alignItems: "center" }}>
          {Array.from({ length: Math.ceil(totalDays / 7) }).map((_, i) => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i * 7);
            return (
              <div key={i} style={{ position: "absolute", left: `${(i * 7 / totalDays) * 100}%`, fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {d.toLocaleDateString()}
              </div>
            );
          })}
          <div style={{ position: "absolute", left: `${((today.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100}%`, width: 2, height: 40, background: "red", top: -4, zIndex: 10 }} />
        </div>
      </div>

      {/* Gantt rows */}
      <div className="surface-panel">
        {items.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>{t("common.noData", locale)}</div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{t("common.code", locale)}</th>
                  <th style={{ width: 80 }}>{t("common.line", locale)}</th>
                  <th style={{ width: 60 }}>{t("pmc.priority", locale)}</th>
                  <th>{t("pmc.ganttBar", locale)}</th>
                  <th style={{ width: 80 }}>{t("pmc.dueDate", locale)}</th>
                  <th style={{ width: 60 }}>{t("common.progress", locale)}</th>
                  <th style={{ width: 80 }}>{t("common.status", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((wo) => {
                  const pct = wo.plannedQty > 0 ? Math.round(wo.completedQty / wo.plannedQty * 100) : 0;
                  const isOverdue = wo.dueDate && new Date(wo.dueDate) < today;
                  return (
                    <tr key={wo.workOrderCode}>
                      <td><strong>{wo.workOrderCode}</strong><div style={{ fontSize: 10, color: "var(--muted)" }}>{wo.productCode}</div></td>
                      <td>{wo.lineCode}</td>
                      <td>
                        <span className={`badge ${PRIORITY_COLORS[wo.priority ?? 3] ?? "badge-muted"}`}>
                          {t(PRIORITY_LABELS[wo.priority ?? 3] ?? "pmc.priority.normal", locale)}
                        </span>
                      </td>
                      <td>
                        <div style={{ position: "relative", height: 24, background: "var(--bg-subtle)", borderRadius: 4 }}>
                          {/* Planned bar (background) */}
                          <div style={{
                            position: "absolute",
                            left: `${dateToX(wo.releasedAt)}%`,
                            width: `${barWidth(wo.releasedAt, wo.dueDate)}%`,
                            height: "100%",
                            background: "rgba(0,100,200,0.15)",
                            borderRadius: 4,
                          }} />
                          {/* Actual progress (foreground) */}
                          <div style={{
                            position: "absolute",
                            left: `${dateToX(wo.releasedAt)}%`,
                            width: `${(pct / 100) * barWidth(wo.releasedAt, wo.dueDate)}%`,
                            height: "100%",
                            background: wo.status === "completed" ? "var(--ok)" : wo.status === "running" ? "var(--info)" : "var(--muted)",
                            borderRadius: 4,
                          }} />
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: isOverdue ? "var(--danger)" : "var(--muted)" }}>
                        {wo.dueDate ? new Date(wo.dueDate).toLocaleDateString() : "—"}
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{pct}%</td>
                      <td><span className={`badge badge-${wo.status === "running" ? "ok" : wo.status === "released" ? "info" : "muted"}`}>{t(`workorder.${wo.status}`, locale)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
