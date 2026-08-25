import { useState, useEffect, useMemo } from "react";
import { t } from "../i18n";
import type { Locale, PmExecutionLog } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";

interface Props {
  locale: Locale;
}

export function PmExecution({ locale }: Props) {
  const [logs, setLogs] = useState<PmExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<string>("all");

  useEffect(() => {
    maintenanceApi.getPmExecutionLogs({ limit: 200 })
      .then((res) => { setLogs(res.items); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (resultFilter === "all") return logs;
    return logs.filter((l) => l.result === resultFilter);
  }, [resultFilter, logs]);

  const resultTone = (r: PmExecutionLog["result"]) => {
    if (r === "pass") return "ok";
    if (r === "conditional") return "warning";
    if (r === "fail") return "danger";
    return "muted";
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("pm.logNo", locale)}</th><th>{t("pm.template", locale)}</th><th>{t("maintenance.equipmentNo", locale)}</th><th>{t("pm.scheduledDate", locale)}</th><th>{t("pm.result", locale)}</th></tr></thead>
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
            <h2>{t("pm.execution", locale)}</h2>
            <p>{t("pm.executionSubtitle", locale)}</p>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 12, padding: "8px 16px", alignItems: "center" }}>
          {["all", "pass", "conditional", "fail", "pending"].map((s) => (
            <button
              key={s}
              className={`badge badge-${resultFilter === s ? "info" : "muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setResultFilter(s)}
            >
              {s === "all" ? t("ui.filterTabs", locale) : t(`pm.result.${s}` as any, locale)}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("pm.logNo", locale)}</th>
                <th>{t("pm.template", locale)}</th>
                <th>{t("maintenance.equipmentNo", locale)}</th>
                <th>{t("pm.scheduledDate", locale)}</th>
                <th>{t("pm.completedDate", locale)}</th>
                <th>{t("pm.executedBy", locale)}</th>
                <th>{t("pm.tasks", locale)}</th>
                <th>{t("pm.result", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.logNo}</strong></td>
                  <td>{l.templateName ?? "—"}</td>
                  <td>{l.assetCode ?? l.assetId}</td>
                  <td>{l.scheduledDate}</td>
                  <td>{l.completedDate ?? "—"}</td>
                  <td>{l.executedByName ?? l.executedBy ?? "—"}</td>
                  <td>
                    <span style={{ color: l.failedTasks > 0 ? "var(--danger)" : l.completedTasks < l.totalTasks ? "var(--warn)" : "var(--ok)" }}>
                      {l.completedTasks}/{l.totalTasks}
                    </span>
                    {l.failedTasks > 0 && <span style={{ color: "var(--danger)", marginLeft: 8 }}>✗{l.failedTasks}</span>}
                  </td>
                  <td>
                    <span className={`badge badge-${resultTone(l.result)}`}>
                      {t(`pm.result.${l.result}` as any, locale)}
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
