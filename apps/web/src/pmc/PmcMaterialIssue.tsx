import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";

interface IssueRecord {
  id: number;
  workOrderCode: string;
  lineCode: string;
  materialCode: string;
  materialName: string;
  issuedQty: number;
  lotNo: string;
  locationCode: string;
  operator: string;
  issuedAt: string;
}

export function PmcMaterialIssue({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWoCode, setSelectedWoCode] = useState("");
  const [materials, setMaterials] = useState<any[]>([]);
  const [records, setRecords] = useState<IssueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Issue form
  const [materialCode, setMaterialCode] = useState("");
  const [qty, setQty] = useState(0);
  const [lotNo, setLotNo] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((r) => {
      const items = r.items.filter((w) => w.status !== "closed");
      setWorkOrders(items);
      if (items.length > 0) setSelectedWoCode(items[0].code);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedWoCode) return;
    pmcApi.getWorkOrderRequirements(selectedWoCode).then((r) => {
      setMaterials(r.items ?? []);
    });
  }, [selectedWoCode]);

  async function handleIssue() {
    if (!selectedWoCode || !materialCode || qty <= 0) {
      setFeedback({ ok: false, msg: String(t("pmc.validationRequired", locale)) });
      return;
    }
    const wo = workOrders.find((w) => w.code === selectedWoCode);
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/mes/material-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderCode: selectedWoCode,
          lineCode: wo?.lineCode ?? "",
          materialCode,
          qty,
          lotNo,
          locationCode,
          operator: "VN_OP_001",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      setRecords((prev) => [
        {
          id: Date.now(),
          workOrderCode: selectedWoCode,
          lineCode: wo?.lineCode ?? "",
          materialCode,
          materialName: materials.find((m) => m.materialCode === materialCode)?.materialName?.name_zh ?? "",
          issuedQty: qty,
          lotNo,
          locationCode,
          operator: "VN_OP_001",
          issuedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setFeedback({ ok: true, msg: String(t("pmc.submitOK", locale)) });
      setMaterialCode("");
      setQty(0);
      setLotNo("");
      setLocationCode("");
    } catch (e: any) {
      setFeedback({ ok: false, msg: String(e?.message ?? t("common.error", locale)) });
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
            <h2>{t("pmc.materialIssue", locale)}</h2>
            <p>{t("pmc.materialIssueDesc", locale)}</p>
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
              className={`badge badge-${w.code === selectedWoCode ? "info" : "muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setSelectedWoCode(w.code)}
            >
              {w.code}
            </button>
          ))}
        </div>
      </div>

      {/* Material requirement sheet for this WO */}
      {selectedWoCode && materials.length > 0 && (
        <div className="surface-panel">
          <div className="section-header">
            <h3>{t("pmc.materialRequirementSheet", locale)}</h3>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("table.material", locale)}</th>
                  <th>{t("pmc.requiredQty", locale)}</th>
                  <th>{t("pmc.pickedQty", locale)}</th>
                  <th>{t("pmc.shortfall", locale)}</th>
                  <th>{t("table.status", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const shortfall = m.requiredQty - m.pickedQty;
                  return (
                    <tr
                      key={m.id}
                      style={{ cursor: "pointer", background: shortfall > 0 ? "rgba(200,50,50,0.04)" : "rgba(0,128,0,0.04)" }}
                      onClick={() => { setMaterialCode(m.materialCode); }}
                    >
                      <td><strong>{m.materialCode}</strong></td>
                      <td>{m.requiredQty.toLocaleString()}</td>
                      <td style={{ color: "var(--ok)" }}>{m.pickedQty.toLocaleString()}</td>
                      <td style={{ color: shortfall > 0 ? "var(--danger)" : "var(--ok)" }}>
                        {shortfall > 0 ? shortfall.toLocaleString() : "—"}
                      </td>
                      <td><span className={`badge badge-${m.status === "fulfilled" ? "ok" : m.status === "partial" ? "info" : "warning"}`}>{t(`pmc.matStatus.${m.status}`, locale)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issue form */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.issueToLine", locale)}</h3></div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          <div className="field">
            <label>{t("table.material", locale)} *</label>
            <input type="text" value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder="e.g. RES-1005-10K" />
          </div>
          <div className="field">
            <label>{t("common.qty", locale)} *</label>
            <input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value || "0"))} />
          </div>
          <div className="field">
            <label>{t("pmc.lotNo", locale)}</label>
            <input type="text" value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="LOT-XXXX" />
          </div>
          <div className="field">
            <label>{t("pmc.location", locale)}</label>
            <input type="text" value={locationCode} onChange={(e) => setLocationCode(e.target.value)} placeholder="L001-A-01" />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="action-button" onClick={handleIssue} disabled={submitting || !materialCode || qty <= 0}>
            {submitting ? t("common.loading", locale) : t("pmc.submitIssue", locale)}
          </button>
        </div>
        {feedback && (
          <div style={{ marginTop: 8, fontSize: 13, color: feedback.ok ? "var(--ok)" : "var(--danger)" }}>
            {feedback.msg}
          </div>
        )}
      </div>

      {/* Issue history */}
      <div className="surface-panel">
        <div className="section-header">
          <h3>{t("pmc.issueHistory", locale)}</h3>
          <span className="badge badge-info">{records.length}</span>
        </div>
        {records.length === 0 ? (
          <div className="placeholder-view"><p>{t("common.noData", locale)}</p></div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("pmc.workOrder", locale)}</th>
                  <th>{t("table.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("pmc.lotNo", locale)}</th>
                  <th>{t("pmc.location", locale)}</th>
                  <th>{t("pmc.operator", locale)}</th>
                  <th>{t("pmc.reportedAt", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td><strong>{r.workOrderCode}</strong></td>
                    <td>{r.materialCode}</td>
                    <td style={{ color: "var(--ok)" }}>{r.issuedQty.toLocaleString()}</td>
                    <td>{r.lotNo}</td>
                    <td>{r.locationCode}</td>
                    <td>{r.operator}</td>
                    <td style={{ fontSize: 12 }}>{new Date(r.issuedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
