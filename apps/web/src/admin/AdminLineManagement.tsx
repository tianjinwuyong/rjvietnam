import { useEffect, useState, type ChangeEvent } from "react";
import { t } from "../i18n";
import { mesApi } from "../api";

// /mes/lines answers camelCase (lineCode, nameZh...) while the shared FactoryLine type is
// snake_case; the demo list that used to feed this table is gone, so the rows are mapped
// from the API instead of being invented.
interface LineRow {
  lineCode: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  status?: string;
  stationCount?: number;
  currentWorkOrderCode?: string | null;
}

const lineStatusTone: Record<string, "ok" | "warning" | "info" | "muted"> = {
  running: "ok",
  idle: "warning",
  maintenance: "info",
  closed: "muted",
};

function AdminLineManagement({ locale }: { locale: Locale }) {
  const [filter, setFilter] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    mesApi
      .getLines({ limit: 200 })
      .then((res) => {
        if (!alive) return;
        setLines(
          res.items.map((row) => ({
            lineCode: row.lineCode,
            name_zh: row.nameZh,
            name_en: row.nameEn,
            name_vi: row.nameVi,
            status: row.status,
            stationCount: row.stationCount ?? 0,
            currentWorkOrderCode: row.currentWorkOrderCode ?? null,
          })),
        );
        setError(null);
      })
      .catch((err: unknown) => {
        if (alive) {
          setLines([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = lines.filter(
    (l) =>
      !filter ||
      l.lineCode.includes(filter) ||
      (l.name_zh ?? "").includes(filter) ||
      (l.name_en ?? "").toLowerCase().includes(filter.toLowerCase()) ||
      (l.name_vi ?? "").includes(filter),
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
          {error ? (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {locale === "zh-CN" ? "产线加载失败：" : locale === "vi-VN" ? "Không tải được chuyền: " : "Line list failed: "}
              {error}
            </p>
          ) : null}
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
