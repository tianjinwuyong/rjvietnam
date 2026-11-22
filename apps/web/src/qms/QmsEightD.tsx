// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, type QmsEightD as QmsEightDRecord } from "../api/qms";

const sevColor: Record<string,string> = { CRITICAL: "var(--danger)", MAJOR: "var(--warn)", MINOR: "var(--warn)" };
const stColor: Record<string,string> = { OPEN: "var(--danger)", IN_PROGRESS: "var(--info)", CLOSED: "var(--ok)" };

const D_FIELDS = ["d1_team","d2_problem","d3_containment","d4_root_cause","d5_corrective","d6_implement","d7_preventive","d8_congratulate"] as const;

export function QmsEightD({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [list, setList] = useState<QmsEightDRecord[]>([]);
  const [sel, setSel] = useState<QmsEightDRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", source: "OQC", severity: "MAJOR", customer_code: "", wo_code: "", defect_desc: "", ng_qty: 0 });
  const [editD, setEditD] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    qmsApi.list8d()
      .then(r => setList(r.data?.items ?? []))
      .catch(e => console.error("8D list:", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (r: QmsEightDRecord) => {
    setSel(r);
    const d: Record<string,string> = {};
    D_FIELDS.forEach(f => { d[f] = (r as any)[f] ?? ""; });
    setEditD(d);
  };

  const create = () => {
    qmsApi.create8d(form as any)
      .then(() => { setShowCreate(false); load(); })
      .catch(e => alert(e.message));
  };

  const saveD = () => {
    if (!sel) return;
    qmsApi.update8d(sel.id, editD)
      .then(() => { load(); })
      .catch(e => alert(e.message));
  };

  const close = () => {
    if (!sel) return;
    qmsApi.close8d(sel.id)
      .then(() => { setSel(null); load(); })
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
    <div className="surface-panel" style={{ padding: 16 }} role="region" aria-label={t("qms.8dTitle")} data-testid="qms.8d">
      <div className="page-header">
        <h2>{t("qms.eightDTitle")}</h2>
        <button onClick={() => setShowCreate(!showCreate)} style={{ padding: "8px 20px", background: "var(--info)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.new8d")}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: 'var(--panel)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {inp(t("qms.title"), "title")}
            {inp(t("qms.source"), "source")}
            {inp(t("qms.severity"), "severity")}
            {inp(t("qms.customerCode"), "customer_code")}
            {inp(t("qms.woCode"), "wo_code")}
            {inp(t("qms.ngQty"), "ng_qty", "number")}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ color: 'var(--muted)', fontSize: 12, display: "block", marginBottom: 4 }}>{t("qms.defectDesc")}</label>
            <textarea value={form.defect_desc} onChange={e => setForm({ ...form, defect_desc: e.target.value })}
              style={{ width: "100%", padding: "8px 12px", background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', minHeight: 60, boxSizing: "border-box" }} />
          </div>
          <button onClick={create} style={{ padding: "8px 24px", background: "var(--ok)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.submit")}</button>
        </div>
      )}

      {loading ? <div style={{ color: 'var(--muted)' }}>{t("qms.loading")}</div> : (
        <table className="data-table">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              {[t("qms.reportNo"), t("qms.title"), t("qms.severity"), t("qms.source"), t("qms.ngQty"), t("qms.status"), t("qms.action")].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: 'var(--muted)', fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => open(r)}>
                <td style={{ padding: "10px 12px", color: "var(--info)" }}>{r.report_no}</td>
                <td style={{ padding: "10px 12px", color: 'var(--text)' }}>{r.title}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: sevColor[r.severity] ?? "var(--muted)", fontSize: 12, fontWeight: 600 }}>{r.severity}</span>
                </td>
                <td style={{ padding: "10px 12px", color: 'var(--muted)' }}>{r.source}</td>
                <td style={{ padding: "10px 12px", color: 'var(--text)' }}>{r.ng_qty}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: stColor[r.status] ?? "var(--muted)", background: `${stColor[r.status] ?? "var(--muted)"}22`, padding: "2px 10px", borderRadius: 10, fontSize: 12 }}>{r.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button onClick={e => { e.stopPropagation(); open(r); }} style={{ padding: "4px 12px", background: 'var(--nav)', color: '#eef8fa', border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>{t("qms.detail")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 520, background: 'var(--surface-2)', borderLeft: "1px solid var(--line)", padding: 24, overflowY: "auto", zIndex: 100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ color: 'var(--text)', margin: 0 }}>{sel.report_no} — {sel.title}</h3>
            <button onClick={() => setSel(null)} style={{ background: "none", border: "none", color: 'var(--muted)', cursor: "pointer", fontSize: 20 }}>x</button>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            {sel.severity} | {sel.source} | {sel.status} | NG: {sel.ng_qty}
          </div>
          {D_FIELDS.map((f, i) => (
            <div key={f} style={{ marginBottom: 10 }}>
              <label style={{ color: "var(--info)", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>D{i + 1}: {t(`qms.${f}`)}</label>
              <textarea value={editD[f] ?? ""} onChange={e => setEditD({ ...editD, [f]: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', minHeight: 50, boxSizing: "border-box" }} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={saveD} style={{ flex: 1, padding: "10px", background: "var(--info)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.save")}</button>
            {sel.status !== "CLOSED" && (
              <button onClick={close} style={{ flex: 1, padding: "10px", background: "var(--ok)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.close8d")}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
