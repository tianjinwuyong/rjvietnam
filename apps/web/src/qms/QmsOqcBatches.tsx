// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsOqcBatch, QmsOqcItem } from "../api/qms";

const statusColor: Record<string,string> = {
  PENDING: "var(--warn)", INSPECTING: "var(--info)", PASSED: "var(--ok)", FAILED: "var(--danger)", HOLD: "var(--warn)",
};

export function canCompleteOqcBatch(items: Array<{ result?: string }>): boolean {
  return items.length > 0 && items.every(item => item.result === "PASS");
}

export function QmsOqcBatches({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [batches, setBatches] = useState<QmsOqcBatch[]>([]);
  const [items, setItems] = useState<QmsOqcItem[]>([]);
  const [selected, setSelected] = useState<QmsOqcBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ customer_code: "", customer_name: "", customer_po_no: "", inspection_type: "FQC", total_qty: 0, sample_size: 0, aql_level: "II" });

  const load = useCallback(() => {
    setLoading(true);
    qmsApi.listOqcBatches()
      .then(r => setBatches(r.data?.items ?? []))
      .catch(e => console.error("OQC list:", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = (b: QmsOqcBatch) => {
    setSelected(b);
    qmsApi.listOqcItems({ batch_id: String(b.id) })
      .then(r => setItems(r.data?.items ?? []))
      .catch(() => setItems([]));
  };

  const create = () => {
    qmsApi.createOqcBatch(form as any)
      .then(() => { setShowCreate(false); load(); })
      .catch(e => alert(e.message));
  };

  const recordItem = (result: string) => {
    if (!selected) return;
    qmsApi.recordOqcItem({ batch_id: selected.id, result, inspector_name: "QC" })
      .then(() => openDetail(selected))
      .catch(e => alert(e.message));
  };

  const completeBatch = () => {
    if (!selected) return;
    if (!canCompleteOqcBatch(items)) {
      alert("OQC batch requires at least one inspection item and all items must PASS");
      return;
    }
    qmsApi.updateOqcBatch(selected.id, { status: "PASSED" })
      .then(() => { setSelected(null); load(); })
      .catch(e => alert(e.message));
  };

  const inp = (label: string, key: string, type = "text") => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: 'var(--muted)', fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
        style={{ width: "100%", padding: "8px 12px", background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div className="surface-panel" style={{ padding: 16 }} role="region" aria-label={t("qms.oqcTitle")} data-testid="qms.oqc">
      <div className="page-header">
        <h2>{t("qms.oqcTitle")}</h2>
        <button onClick={() => setShowCreate(!showCreate)} style={{ padding: "8px 20px", background: "var(--info)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newBatch")}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: 'var(--panel)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {inp(t("qms.customerCode"), "customer_code")}
            {inp(t("qms.customerName"), "customer_name")}
            {inp(t("qms.poNo"), "customer_po_no")}
            {inp(t("qms.totalQty"), "total_qty", "number")}
            {inp(t("qms.sampleSize"), "sample_size", "number")}
            {inp("AQL", "aql_level")}
          </div>
          <button onClick={create} style={{ marginTop: 12, padding: "8px 24px", background: "var(--ok)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            {t("qms.submit")}
          </button>
        </div>
      )}

      {loading ? <div style={{ color: 'var(--muted)' }}>{t("qms.loading")}</div> : (
        <table className="data-table">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              {[t("qms.batchNo"), t("qms.customer"), t("qms.type"), t("qms.qty"), t("qms.passFail"), t("qms.status"), t("qms.action")].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: 'var(--muted)', fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.id} style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => openDetail(b)}>
                <td style={{ padding: "10px 12px", color: "var(--info)" }}>{b.batch_no}</td>
                <td style={{ padding: "10px 12px", color: 'var(--text)' }}>{b.customer_name ?? b.customer_code ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: 'var(--muted)' }}>{b.inspection_type}</td>
                <td style={{ padding: "10px 12px", color: 'var(--text)' }}>{b.total_qty}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: "var(--ok)" }}>{b.passed_qty}</span> / <span style={{ color: "var(--danger)" }}>{b.failed_qty}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: statusColor[b.status] ?? "var(--muted)", background: `${statusColor[b.status] ?? "var(--muted)"}22`, padding: "2px 10px", borderRadius: 10, fontSize: 12 }}>{b.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button onClick={e => { e.stopPropagation(); openDetail(b); }} style={{ padding: "4px 12px", background: 'var(--nav)', color: '#eef8fa', border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
                    {t("qms.detail")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: 'var(--surface-2)', borderLeft: "1px solid var(--line)", padding: 24, overflowY: "auto", zIndex: 100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ color: 'var(--text)', margin: 0 }}>{selected.batch_no}</h3>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: 'var(--muted)', cursor: "pointer", fontSize: 20 }}>x</button>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            {selected.customer_name} | {selected.inspection_type} | AQL: {selected.aql_level} | {selected.status}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => recordItem("PASS")} style={{ flex: 1, padding: "10px", background: "var(--ok)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>PASS</button>
            <button onClick={() => recordItem("FAIL")} style={{ flex: 1, padding: "10px", background: "var(--danger)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>FAIL</button>
            <button onClick={() => recordItem("HOLD")} style={{ flex: 1, padding: "10px", background: "var(--warn)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>HOLD</button>
          </div>
          <button onClick={completeBatch} style={{ width: "100%", padding: "10px", background: "var(--info)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", marginBottom: 16 }}>
            {t("qms.completeInspection")}
          </button>
          <h4 style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>{t("qms.inspectionItems")} ({items.length})</h4>
          {items.map(it => (
            <div key={it.id} style={{ padding: "8px 12px", background: 'var(--panel)', borderRadius: 6, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: 'var(--text)', fontSize: 13 }}>{it.sn ?? it.material_code ?? `#${it.id}`}</span>
              <span style={{ color: it.result === "PASS" ? "var(--ok)" : it.result === "FAIL" ? "var(--danger)" : "var(--warn)", fontSize: 13, fontWeight: 600 }}>{it.result}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
