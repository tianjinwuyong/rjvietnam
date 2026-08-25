import { useState, type ChangeEvent } from "react";
import type { Locale, FactoryLine } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { lines } from "../data";

const lineStatusTone: Record<string, "ok" | "warning" | "info" | "muted"> = {
  running: "ok",
  idle: "warning",
  maintenance: "info",
  closed: "muted",
};

function AdminLineManagement({ locale }: { locale: Locale }) {
  const [filter, setFilter] = useState("");

  const filtered = lines.filter(
    (l: FactoryLine) =>
      !filter ||
      l.lineCode.includes(filter) ||
      (l.name_zh ?? "").includes(filter) ||
      (l.name_en ?? "").toLowerCase().includes(filter.toLowerCase()) ||
      (l.name_vi ?? "").includes(filter)
  );

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("admin.lineManagement.title", locale)}</h2>
            <p>{t("admin.lineManagement.subtitle", locale)}</p>
          </div>
        </div>
        <div className="toolbar">
          <input
            className="input"
            placeholder={t("admin.lineManagement.search", locale)}
            value={filter}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          />
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("admin.lineManagement.list", locale)}</h2>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.code", locale)}</th>
                <th>{t("common.name", locale)} (ZH)</th>
                <th>{t("common.name", locale)} (EN)</th>
                <th>{t("common.name", locale)} (VI)</th>
                <th>{t("common.status", locale)}</th>
                <th>{t("admin.lineManagement.oee", locale)}</th>
                <th>{t("admin.lineManagement.output", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((line: FactoryLine) => (
                <tr key={line.id}>
                  <td><code>{line.lineCode}</code></td>
                  <td>{line.name_zh}</td>
                  <td>{line.name_en}</td>
                  <td>{line.name_vi}</td>
                  <td><span className={`badge badge-${lineStatusTone[line.status] ?? "muted"}`}>{t(`lineStatus.${line.status}` as any, locale)}</span></td>
                  <td>{line.oee ?? "—"}</td>
                  <td>{(line.outputToday ?? 0).toLocaleString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="empty-state">{t("common.empty", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export { AdminLineManagement };
