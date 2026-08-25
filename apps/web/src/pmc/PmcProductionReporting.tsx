import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";

export function PmcProductionReporting({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWoCode, setSelectedWoCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [outputQty, setOutputQty] = useState(0);
  const [ngQty, setNgQty] = useState(0);
  const [stationCode, setStationCode] = useState("");
  const [recentReports, setRecentReports] = useState<Array<{ wo: string; qty: number; ng: number; ts: string }>>([]);

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((r) => {
      const items = r.items.filter((w) => w.status === "running" || w.status === "released");
      setWorkOrders(items);
      if (items.length > 0 && !selectedWoCode) setSelectedWoCode(items[0].code);
      setLoading(false);
    });
  }, []);

  const wo = workOrders.find((w) => w.code === selectedWoCode);
  const progress = wo && wo.plannedQty > 0 ? (wo.completedQty / wo.plannedQty) * 100 : 0;

  async function handleSubmit() {
    if (!selectedWoCode || outputQty <= 0) return;
    setSubmitting(true);
    try {
      const res: any = await pmcApi.completeWorkOrder(selectedWoCode, {
        outputQty,
        ngQty,
        stationCode,
        operator: "VN_OP_001",
      });
      // Update local WO completed_qty
      if (wo) {
        const updated = res.data;
        wo.completedQty = updated.completedQty;
        if (updated.status) wo.status = updated.status;
        setWorkOrders((prev) => prev.map((w) => (w.code === selectedWoCode ? { ...w } : w)));
        setSelectedWoCode(selectedWoCode); // refresh
      }
      setRecentReports((prev) => [
        { wo: selectedWoCode, qty: outputQty, ng: ngQty, ts: new Date().toISOString() },
        ...prev.slice(0, 9),
      ]);
      setOutputQty(0);
      setNgQty(0);
    } catch (e: any) {
      alert(`${t("pmc.reporting.failed", locale)}: ${e?.message ?? t("pmc.reporting.unknownError", locale)}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="screen-stack"><div className="surface-panel"><div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div></div>;
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.productionReporting", locale)}</h2>
            <p>{t("pmc.productionReportingDesc", locale)}</p>
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
              className={`badge ${w.code === selectedWoCode ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setSelectedWoCode(w.code)}
            >
              {w.code} — {w.productCode} ({t(`workorder.${w.status}`, locale)})
            </button>
          ))}
        </div>
        {wo && (
          <div className="status-stack" style={{ marginTop: 12 }}>
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("common.product", locale)}</span>
              <span>{wo.productCode} / {wo.productNameZh}</span>
            </div>
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("common.line", locale)}</span>
              <span>{wo.lineCode} / {wo.lineNameZh}</span>
            </div>
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("common.progress", locale)}</span>
              <strong>{wo.completedQty.toLocaleString()} / {wo.plannedQty.toLocaleString()} ({progress.toFixed(1)}%)</strong>
            </div>
            <div className="progress" style={{ margin: "8px 0", width: "100%" }}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Report form */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.reportOutput", locale)}</h3></div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="field">
            <label>{t("pmc.outputQty", locale)}</label>
            <input type="number" min={1} value={outputQty} onChange={(e) => setOutputQty(Math.max(0, parseInt(e.target.value || "0")))} />
          </div>
          <div className="field">
            <label>{t("pmc.ngQty", locale)}</label>
            <input type="number" min={0} value={ngQty} onChange={(e) => setNgQty(Math.max(0, parseInt(e.target.value || "0")))} />
          </div>
          <div className="field">
            <label>{t("pmc.stationCode", locale)}</label>
            <input type="text" value={stationCode} placeholder="AUTO-01" onChange={(e) => setStationCode(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="action-button" onClick={handleSubmit} disabled={submitting || outputQty <= 0}>
            {submitting ? t("common.loading", locale) : t("pmc.submitReport", locale)}
          </button>
          {wo && (
            <span style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
              {t("pmc.totalReported", locale)}: <strong style={{ color: "var(--ok)" }}>{wo.completedQty.toLocaleString()}</strong> / {wo.plannedQty.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Recent reports */}
      {recentReports.length > 0 && (
        <div className="surface-panel">
          <div className="section-header"><h3>{t("pmc.reportHistory", locale)}</h3></div>
          <div className="table-shell">
            <table>
              <thead>
                <tr><th>#</th><th>{t("pmc.workOrder", locale)}</th><th>{t("pmc.outputQty", locale)}</th><th>{t("pmc.ngQty", locale)}</th><th>{t("pmc.reportedAt", locale)}</th></tr>
              </thead>
              <tbody>
                {recentReports.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><strong>{r.wo}</strong></td>
                    <td style={{ color: "var(--ok)" }}>+{r.qty}</td>
                    <td style={{ color: r.ng > 0 ? "var(--danger)" : "var(--muted)" }}>{r.ng}</td>
                    <td style={{ fontSize: 12 }}>{new Date(r.ts).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
