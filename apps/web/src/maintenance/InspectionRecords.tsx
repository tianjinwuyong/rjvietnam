import { useState, useMemo, useEffect } from "react";
import { t } from "../i18n";
import type { Locale, InspectionRecord } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import { AlertTriangle } from "lucide-react";

const resultConfig: Record<string, { label: string; badge: string }> = {
  pass: { label: "status.pass", badge: "ok" },
  fail: { label: "inspection.abnormal", badge: "danger" },
  conditional: { label: "inspection.partial", badge: "warning" },
};

export function InspectionRecords({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    maintenanceApi.getInspectionRecords({ limit: 200 })
      .then((res) => { setRecords(res.items); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const byDate: Record<string, InspectionRecord[]> = {};
    records.forEach((r) => {
      const d = r.shiftDate ?? "unknown";
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(r);
    });
    return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a));
  }, [records]);

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header">
            <h2>{t("inspection.records", locale)}</h2>
            <p>{t("inspection.recordsDesc", locale)}</p>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("inspection.recordNo", locale)}</th>
                  <th>{t("inspection.machine", locale)}</th>
                  <th>{t("inspection.shiftType", locale)}</th>
                  <th>{t("inspection.inspectedBy", locale)}</th>
                  <th>{t("inspection.totalItems", locale)}</th>
                  <th>{t("inspection.passItems", locale)}</th>
                  <th>{t("inspection.result", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td><div className="skeleton" style={{ height: 14, width: 140 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 80 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 60 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 80 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 40 }} /></td>
                    <td><div className="skeleton" style={{ height: 14, width: 40 }} /></td>
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
            <h2>{t("inspection.records", locale)}</h2>
            <p>{t("inspection.recordsDesc", locale)}</p>
          </div>
        </div>
      </div>

      {grouped.length === 0 && (
        <section className="surface-panel">
          <p style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</p>
        </section>
      )}

      {grouped.map(([date, recs]) => (
        <section key={date} className="surface-panel">
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: "var(--muted)" }}>{date}</strong>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("inspection.recordNo", locale)}</th>
                  <th>{t("inspection.machine", locale)}</th>
                  <th>{t("inspection.template", locale)}</th>
                  <th>{t("inspection.shiftType", locale)}</th>
                  <th>{t("inspection.inspectedBy", locale)}</th>
                  <th>{t("inspection.totalItems", locale)}</th>
                  <th>{t("inspection.passItems", locale)}</th>
                  <th>{t("inspection.failedItems", locale)}</th>
                  <th>{t("inspection.result", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => {
                  const cfg = resultConfig[r.overallResult] ?? resultConfig.pass;
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.recordNo}</strong></td>
                      <td>
                        <span>{r.machineCode ?? "-"}</span>
                        {r.machineType && <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 4 }}>{r.machineType}</span>}
                      </td>
                      <td>{r.templateName ?? r.templateId}</td>
                      <td>
                        <span className="badge badge-muted">{t(`inspection.shiftType.${r.shiftType}`, locale)}</span>
                      </td>
                      <td>{r.inspectorName ?? r.inspectorId ?? "-"}</td>
                      <td>{r.totalItems}</td>
                      <td>{r.passedItems}</td>
                      <td>
                        {r.failedItems > 0 ? (
                          <span className="badge badge-danger">
                            <AlertTriangle size={12} style={{ marginRight: 4 }} />
                            {r.failedItems}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>0</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${cfg.badge}`}>
                          {t(cfg.label, locale)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}