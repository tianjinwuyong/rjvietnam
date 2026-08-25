import { useState } from "react";
import { Search, Package, Clock, AlertTriangle, Scissors } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { FullTrace, StationFlowRecord, StagnationLog, ScrapRecord } from "../api/mes";

type SearchMode = "serial" | "pcb" | "workOrder";

const levelColors: Record<string, string> = {
  normal: "var(--ok)",
  warning: "var(--warn)",
  alert: "var(--danger)",
  critical: "var(--critical)",
};

function FlowRow({ record, locale }: { record: StationFlowRecord; locale: Locale }) {
  return (
    <tr style={record.isStagnation ? { background: "rgba(239,68,68,0.08)" } : undefined}>
      <td>{record.stationCode}</td>
      <td>{record.stationType ?? "—"}</td>
      <td>{record.lineCode}</td>
      <td>{new Date(record.arrivalTime).toLocaleString()}</td>
      <td>{record.departureTime ? new Date(record.departureTime).toLocaleString() : "—"}</td>
      <td>{record.dwellMinutes != null ? `${record.dwellMinutes}m` : "—"}</td>
      {record.isStagnation && (
        <td>
          <span
            className="badge badge-danger"
            style={{ color: levelColors[record.stagnationLevel ?? "alert"] }}
          >
            {t(`mes.stagnation.level.${record.stagnationLevel}` as any, locale)}
          </span>
        </td>
      )}
      {!record.isStagnation && <td>—</td>}
      <td>{record.operatorName ?? "—"}</td>
      <td>{record.machineCode ?? "—"}</td>
      <td>{record.nextStationCode ?? "—"}</td>
      <td>{record.qualityCheckResult ?? "—"}</td>
    </tr>
  );
}

export function TraceabilitySearch({ locale }: { locale: Locale }) {
  const [mode, setMode] = useState<SearchMode>("serial");
  const [input, setInput] = useState("");
  const [trace, setTrace] = useState<FullTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleSearch() {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setTrace(null);

    mesApi.getFullTrace(input.trim())
      .then((result) => {
        setTrace(result);
        setLoading(false);
      })
      .catch(() => {
        setError("Trace not found");
        setLoading(false);
      });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  return (
    <div className="screen-stack">
      {/* Search bar */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mes.trace.title" as any, locale)}</h2>
            <p>{t("mes.trace.fullTrace" as any, locale)}</p>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          {([
            { key: "serial", label: "mes.trace.bySerial" },
            { key: "pcb", label: "mes.trace.byPcb" },
            { key: "workOrder", label: "mes.trace.byWorkOrder" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`action-button ${mode === key ? "active" : ""}`}
              onClick={() => setMode(key)}
            >
              {t(label as any, locale)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div className="scanner" style={{ flex: 1 }}>
            <Search size={20} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === "serial"
                  ? t("mes.trace.bySerial" as any, locale)
                  : mode === "pcb"
                    ? t("mes.trace.byPcb" as any, locale)
                    : t("mes.trace.byWorkOrder" as any, locale)
              }
            />
          </div>
          <button type="button" className="action-button" onClick={handleSearch} disabled={loading}>
            {loading ? "..." : t("mes.trace.search" as any, locale)}
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)", marginTop: 8, fontSize: 13 }}>{error}</p>}
      </section>

      {/* Results */}
      {!trace && !loading && (
        <section className="surface-panel">
          <div className="placeholder-view">
            <Search size={40} />
            <p>{t("common.noData" as any, locale)}</p>
          </div>
        </section>
      )}

      {trace && (
        <>
          {/* PCB Info */}
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h2><Package size={18} style={{ marginRight: 8 }} />{t("mes.trace.pcbInfo" as any, locale)}</h2>
              </div>
            </div>
            <div className="status-stack">
              <div className="status-row">
                <span>{t("common.serial" as any, locale)}</span>
                <strong>{trace.pcb.serialNo}</strong>
              </div>
              <div className="status-row">
                <span>{t("common.workOrder" as any, locale)}</span>
                <strong>{trace.pcb.workOrderCode}</strong>
              </div>
              <div className="status-row">
                <span>{t("common.product" as any, locale)}</span>
                <strong>{trace.pcb.productCode ?? "—"}</strong>
              </div>
              <div className="status-row">
                <span>{t("common.line" as any, locale)}</span>
                <strong>{trace.pcb.lineCode ?? "—"}</strong>
              </div>
              <div className="status-row">
                <span>{t("common.status" as any, locale)}</span>
                <span className={`badge badge-${trace.pcb.status === "passed" ? "ok" : trace.pcb.status === "failed" ? "danger" : trace.pcb.status === "scrapped" ? "critical" : "info"}`}>
                  {trace.pcb.status}
                </span>
              </div>
              <div className="status-row">
                <span>{t("mes.stagnation.createdAt" as any, locale)}</span>
                <strong>{new Date(trace.pcb.createdAt).toLocaleString()}</strong>
              </div>
            </div>
          </section>

          {/* Station Flow */}
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h2><Clock size={18} style={{ marginRight: 8 }} />{t("mes.trace.stationFlow" as any, locale)}</h2>
                <p>{trace.flow.length} {t("common.event" as any, locale)}</p>
              </div>
            </div>
            {trace.flow.length === 0 ? (
              <div className="placeholder-view">
                <p>{t("common.noData" as any, locale)}</p>
              </div>
            ) : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("mes.stagnation.station" as any, locale)}</th>
                      <th>Type</th>
                      <th>{t("mes.trace.line" as any, locale) ?? "Line"}</th>
                      <th>{t("mes.trace.arrivalTime" as any, locale)}</th>
                      <th>{t("mes.trace.departureTime" as any, locale)}</th>
                      <th>{t("mes.trace.dwellMinutes" as any, locale)}</th>
                      <th>{t("mes.stagnation.level" as any, locale)}</th>
                      <th>{t("mes.trace.operator" as any, locale)}</th>
                      <th>{t("mes.trace.machine" as any, locale)}</th>
                      <th>{t("mes.trace.nextStation" as any, locale)}</th>
                      <th>{t("mes.trace.qualityResult" as any, locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.flow.map((record) => (
                      <FlowRow key={record.id} record={record} locale={locale} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Stagnation history */}
          {trace.stagnation.length > 0 && (
            <section className="surface-panel">
              <div className="section-header">
                <div>
                  <h2><AlertTriangle size={18} style={{ marginRight: 8 }} />{t("mes.trace.stagnationHistory" as any, locale)}</h2>
                  <p>{trace.stagnation.length} records</p>
                </div>
              </div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("mes.stagnation.sn" as any, locale)}</th>
                      <th>{t("mes.stagnation.station" as any, locale)}</th>
                      <th>{t("mes.stagnation.line" as any, locale)}</th>
                      <th>{t("mes.stagnation.overdueMinutes" as any, locale)}</th>
                      <th>{t("mes.stagnation.level" as any, locale)}</th>
                      <th>{t("mes.stagnation.status" as any, locale)}</th>
                      <th>{t("mes.stagnation.createdAt" as any, locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.stagnation.map((s) => (
                      <tr key={s.id}>
                        <td>{s.sn}</td>
                        <td>{s.stationCode}</td>
                        <td>{s.lineCode}</td>
                        <td>{s.stagnationMinutes}m</td>
                        <td>
                          <span
                            className={`badge badge-${s.stagnationLevel === "critical" ? "critical" : s.stagnationLevel === "alert" ? "danger" : s.stagnationLevel === "warning" ? "warning" : "ok"}`}
                            style={{ color: levelColors[s.stagnationLevel] }}
                          >
                            {t(`mes.stagnation.level.${s.stagnationLevel}` as any, locale)}
                          </span>
                        </td>
                        <td>{t(`mes.stagnation.status.${s.status}` as any, locale)}</td>
                        <td>{new Date(s.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Scrap history */}
          {trace.scraps.length > 0 && (
            <section className="surface-panel">
              <div className="section-header">
                <div>
                  <h2><Scissors size={18} style={{ marginRight: 8 }} />{t("mes.trace.scrapHistory" as any, locale)}</h2>
                  <p>{trace.scraps.length} records</p>
                </div>
              </div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("mes.stagnation.sn" as any, locale)}</th>
                      <th>{t("mes.scrap.station" as any, locale)}</th>
                      <th>{t("mes.scrap.line" as any, locale)}</th>
                      <th>{t("mes.scrap.reason" as any, locale)}</th>
                      <th>{t("mes.scrap.responsible" as any, locale)}</th>
                      <th>{t("mes.scrap.status" as any, locale)}</th>
                      <th>{t("mes.scrap.createdAt" as any, locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.scraps.map((s) => (
                      <tr key={s.id}>
                        <td>{s.sn}</td>
                        <td>{s.scrapStation}</td>
                        <td>{s.lineCode}</td>
                        <td>{s.scrapReasonCode} — {s.scrapReasonName ?? "—"}</td>
                        <td>{s.responsiblePerson ?? "—"}</td>
                        <td>
                          <span className={`badge badge-${s.status === "approved" ? "ok" : s.status === "rejected" ? "danger" : "warning"}`}>
                            {t(`mes.scrap.status.${s.status}` as any, locale)}
                          </span>
                        </td>
                        <td>{new Date(s.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
