// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsOqcBatch, QmsOqcItem } from "../api/qms";

const statusColor: Record<string,string> = {
  PENDING: "#fbbf24", INSPECTING: "#38bdf8", PASSED: "#34d399", FAILED: "#f87171", HOLD: "#fb923c",
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
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
        style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.oqcTitle")}</h2>
        <button onClick={() => setShowCreate(!showCreate)} style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newBatch")}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {inp(t("qms.customerCode"), "customer_code")}
            {inp(t("qms.customerName"), "customer_name")}
            {inp(t("qms.poNo"), "customer_po_no")}
            {inp(t("qms.totalQty"), "total_qty", "number")}
            {inp(t("qms.sampleSize"), "sample_size", "number")}
            {inp("AQL", "aql_level")}
          </div>
          <button onClick={create} style={{ marginTop: 12, padding: "8px 24px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            {t("qms.submit")}
          </button>
        </div>
      )}

      {loading ? <div style={{ color: "#94a3b8" }}>{t("qms.loading")}</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {[t("qms.batchNo"), t("qms.customer"), t("qms.type"), t("qms.qty"), t("qms.passFail"), t("qms.status"), t("qms.action")].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }} onClick={() => openDetail(b)}>
                <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{b.batch_no}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{b.customer_name ?? b.customer_code ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{b.inspection_type}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{b.total_qty}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: "#34d399" }}>{b.passed_qty}</span> / <span style={{ color: "#f87171" }}>{b.failed_qty}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: statusColor[b.status] ?? "#94a3b8", background: `${statusColor[b.status] ?? "#94a3b8"}22`, padding: "2px 10px", borderRadius: 10, fontSize: 12 }}>{b.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button onClick={e => { e.stopPropagation(); openDetail(b); }} style={{ padding: "4px 12px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
                    {t("qms.detail")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: "#0f172a", borderLeft: "1px solid #334155", padding: 24, overflowY: "auto", zIndex: 100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ color: "#e2e8f0", margin: 0 }}>{selected.batch_no}</h3>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>x</button>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>
            {selected.customer_name} | {selected.inspection_type} | AQL: {selected.aql_level} | {selected.status}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => recordItem("PASS")} style={{ flex: 1, padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>PASS</button>
            <button onClick={() => recordItem("FAIL")} style={{ flex: 1, padding: "10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>FAIL</button>
            <button onClick={() => recordItem("HOLD")} style={{ flex: 1, padding: "10px", background: "#d97706", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>HOLD</button>
          </div>
          <button onClick={completeBatch} style={{ width: "100%", padding: "10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", marginBottom: 16 }}>
            {t("qms.completeInspection")}
          </button>
          <h4 style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>{t("qms.inspectionItems")} ({items.length})</h4>
          {items.map(it => (
            <div key={it.id} style={{ padding: "8px 12px", background: "#1e293b", borderRadius: 6, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#e2e8f0", fontSize: 13 }}>{it.sn ?? it.material_code ?? `#${it.id}`}</span>
              <span style={{ color: it.result === "PASS" ? "#34d399" : it.result === "FAIL" ? "#f87171" : "#fbbf24", fontSize: 13, fontWeight: 600 }}>{it.result}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
