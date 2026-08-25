import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";

export function PmcWoQualityReport({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((r) => {
      setWorkOrders(r.items.filter((w) => w.status !== "draft"));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedCode) return;
    setFetching(true);
    pmcApi.getWorkOrderQcReport(selectedCode).then((r: any) => {
      setReport(r.data);
      setFetching(false);
    }).catch(() => { setReport(null); setFetching(false); });
  }, [selectedCode]);

  if (loading) {
    return <div className="screen-stack"><div className="surface-panel"><div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div></div>;
  }

  const wo = workOrders.find((w) => w.code === selectedCode);

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.woQualityReport", locale)}</h2>
            <p>{t("pmc.woQualityReportDesc", locale)}</p>
          </div>
        </div>
      </div>

      {/* WO selector */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.selectWorkOrder", locale)}</h3></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {workOrders.map((w) => (
            <button
              key={w.id}
              className={`badge ${w.code === selectedCode ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setSelectedCode(w.code)}
            >
              {w.code} — {w.productCode}
            </button>
          ))}
        </div>
      </div>

      {!report || fetching ? (
        <div className="surface-panel">
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            {fetching ? t("common.loading", locale) : t("common.noData", locale)}
          </div>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="content-grid three" style={{ gap: 12 }}>
            <div className="surface-panel" style={{ padding: "16px 20px" }}>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.totalOutput", locale)}</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: "var(--ok)" }}>{report.totalOutput.toLocaleString()}</div>
            </div>
            <div className="surface-panel" style={{ padding: "16px 20px" }}>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.totalNG", locale)}</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: report.totalNG > 0 ? "var(--danger)" : "var(--ok)" }}>{report.totalNG}</div>
            </div>
            <div className="surface-panel" style={{ padding: "16px 20px" }}>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.yieldRate", locale)}</div>
              <div style={{
                fontSize: 36, fontWeight: 700,
                color: report.yieldPct >= 98 ? "var(--ok)" : report.yieldPct >= 95 ? "var(--warning)" : "var(--danger)"
              }}>
                {report.yieldPct}%
              </div>
            </div>
          </div>

          {/* NG by station */}
          {Object.keys(report.ngByStation ?? {}).length > 0 && (
            <div className="surface-panel">
              <div className="section-header"><h3>{t("pmc.ngByStation", locale)}</h3></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(report.ngByStation as Record<string, number>).map(([station, count]) => (
                  <div key={station} className="surface-panel" style={{ padding: "8px 16px", minWidth: 100 }}>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>{station}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--danger)" }}>{count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NG records */}
          {report.ngRecords?.length > 0 && (
            <div className="surface-panel">
              <div className="section-header"><h3>{t("pmc.ngRecordList", locale)}</h3></div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("pmc.stationCode", locale)}</th>
                      <th>{t("pmc.line", locale)}</th>
                      <th>{t("pmc.ngReason", locale)}</th>
                      <th>{t("pmc.operator", locale)}</th>
                      <th>{t("pmc.ngTime", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.ngRecords.map((r: any, i: number) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><strong>{r.stationCode}</strong><div style={{ fontSize: 11, color: "var(--muted)" }}>{r.stationNameZh}</div></td>
                        <td>{r.lineName}</td>
                        <td style={{ color: "var(--danger)", fontWeight: 600 }}>{r.result}</td>
                        <td>{r.operatorName ?? "—"}</td>
                        <td style={{ fontSize: 12 }}>{new Date(r.ngTime).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
