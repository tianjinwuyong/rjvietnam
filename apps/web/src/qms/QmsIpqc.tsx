// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsIpqcInspection, QmsIpqcItem } from "../api/qms";

const typeColor: Record<string,string> = {
  FIRST_ARTICLE: "#a78bfa", PATROL: "#38bdf8", SPI: "#fbbf24", AOI: "#fb923c", FCT: "#34d399", REFLOW: "#f87171",
};
const stColor: Record<string,string> = { PENDING: "#fbbf24", INSPECTING: "#38bdf8", PASSED: "#34d399", FAILED: "#f87171" };

export function QmsIpqc({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [list, setList] = useState<QmsIpqcInspection[]>([]);
  const [sel, setSel] = useState<QmsIpqcInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ wo_code: "", line_code: "", station_code: "", inspection_type: "PATROL", inspector_name: "" });
  const [itemForm, setItemForm] = useState({ item_name: "", category: "APPEARANCE", upper_limit: "", lower_limit: "", measured_value: "", result: "PASS" });

  const load = useCallback(() => {
    setLoading(true);
    qmsApi.listIpqc()
      .then(r => setList(r.data?.data ?? r.data ?? []))
      .catch(e => console.error("IPQC list:", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (r: QmsIpqcInspection) => {
    qmsApi.getIpqc(r.id)
      .then(res => setSel(res.data?.data ?? res.data))
      .catch(() => setSel(r));
  };

  const create = () => {
    qmsApi.createIpqc(form)
      .then(() => { setShowCreate(false); load(); })
      .catch(e => alert(e.message));
  };

  const addItem = () => {
    if (!sel) return;
    const d: any = { ...itemForm };
    if (d.upper_limit) d.upper_limit = Number(d.upper_limit);
    if (d.lower_limit) d.lower_limit = Number(d.lower_limit);
    if (d.measured_value) d.measured_value = Number(d.measured_value);
    qmsApi.addIpqcItem(sel.id, d)
      .then(() => open(sel))
      .catch(e => alert(e.message));
  };

  const setStatus = (status: string) => {
    if (!sel) return;
    qmsApi.updateIpqc(sel.id, { status })
      .then(() => { open(sel); load(); })
      .catch(e => alert(e.message));
  };

  const inp = (label: string, key: string, val: any, setter: any) => (
    <div style={{ marginBottom: 8 }}>
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 3 }}>{label}</label>
      <input value={val} onChange={e => setter({ ...setter.__proto__, [key]: e.target.value })}
        style={{ width: "100%", padding: "7px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.ipqcTitle")}</h2>
        <button onClick={() => setShowCreate(!showCreate)} style={{ padding: "8px 20px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newIpqc")}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label style={{ color: "#94a3b8", fontSize: 12 }}>{t("qms.woCode")}</label>
              <input value={form.wo_code} onChange={e => setForm({...form, wo_code: e.target.value})} style={{ width: "100%", padding: "7px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} /></div>
            <div><label style={{ color: "#94a3b8", fontSize: 12 }}>{t("qms.line")}</label>
              <input value={form.line_code} onChange={e => setForm({...form, line_code: e.target.value})} style={{ width: "100%", padding: "7px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} /></div>
            <div><label style={{ color: "#94a3b8", fontSize: 12 }}>{t("qms.station")}</label>
              <input value={form.station_code} onChange={e => setForm({...form, station_code: e.target.value})} style={{ width: "100%", padding: "7px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} /></div>
            <div><label style={{ color: "#94a3b8", fontSize: 12 }}>{t("qms.type")}</label>
              <select value={form.inspection_type} onChange={e => setForm({...form, inspection_type: e.target.value})} style={{ width: "100%", padding: "7px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
                {["PATROL","FIRST_ARTICLE","SPI","AOI","FCT","REFLOW"].map(v => <option key={v} value={v}>{v}</option>)}
              </select></div>
            <div><label style={{ color: "#94a3b8", fontSize: 12 }}>{t("qms.inspector")}</label>
              <input value={form.inspector_name} onChange={e => setForm({...form, inspector_name: e.target.value})} style={{ width: "100%", padding: "7px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} /></div>
          </div>
          <button onClick={create} style={{ marginTop: 12, padding: "8px 24px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.submit")}</button>
        </div>
      )}

      {loading ? <div style={{ color: "#94a3b8" }}>{t("qms.loading")}</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: "1px solid #334155" }}>
            {[t("qms.inspNo"), t("qms.woCode"), t("qms.line"), t("qms.type"), t("qms.inspector"), t("qms.status"), t("qms.action")].map(h => (
              <th key={h} style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, textAlign: "left" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }} onClick={() => open(r)}>
                <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{r.inspection_no}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{r.wo_code ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{r.line_code ?? "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: typeColor[r.inspection_type] ?? "#94a3b8", fontSize: 12, fontWeight: 600 }}>{r.inspection_type}</span>
                </td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{r.inspector_name ?? "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: stColor[r.status] ?? "#94a3b8", background: `${stColor[r.status] ?? "#94a3b8"}22`, padding: "2px 10px", borderRadius: 10, fontSize: 12 }}>{r.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button onClick={e => { e.stopPropagation(); open(r); }} style={{ padding: "4px 12px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>{t("qms.detail")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 520, background: "#0f172a", borderLeft: "1px solid #334155", padding: 24, overflowY: "auto", zIndex: 100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ color: "#e2e8f0", margin: 0 }}>{sel.inspection_no}</h3>
            <button onClick={() => setSel(null)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>x</button>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>
            {sel.wo_code} | {sel.line_code} | {sel.inspection_type} | <span style={{ color: stColor[sel.status] }}>{sel.status}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {sel.status === "PENDING" && <button onClick={() => setStatus("INSPECTING")} style={{ flex: 1, padding: "8px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.startInsp")}</button>}
            {sel.status === "INSPECTING" && <>
              <button onClick={() => setStatus("PASSED")} style={{ flex: 1, padding: "8px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>PASS</button>
              <button onClick={() => setStatus("FAILED")} style={{ flex: 1, padding: "8px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>FAIL</button>
            </>}
          </div>
          <h4 style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>{t("qms.addItem")}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <input placeholder={t("qms.itemName")} value={itemForm.item_name} onChange={e => setItemForm({...itemForm, item_name: e.target.value})} style={{ padding: "7px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }} />
            <select value={itemForm.category} onChange={e => setItemForm({...itemForm, category: e.target.value})} style={{ padding: "7px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
              {["APPEARANCE","DIMENSION","FUNCTION","SOLDER","PASTE"].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <input placeholder="USL" value={itemForm.upper_limit} onChange={e => setItemForm({...itemForm, upper_limit: e.target.value})} style={{ padding: "7px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }} />
            <input placeholder="LSL" value={itemForm.lower_limit} onChange={e => setItemForm({...itemForm, lower_limit: e.target.value})} style={{ padding: "7px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }} />
            <input placeholder={t("qms.measured")} value={itemForm.measured_value} onChange={e => setItemForm({...itemForm, measured_value: e.target.value})} style={{ padding: "7px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }} />
            <select value={itemForm.result} onChange={e => setItemForm({...itemForm, result: e.target.value})} style={{ padding: "7px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
              <option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="NA">NA</option>
            </select>
          </div>
          <button onClick={addItem} style={{ width: "100%", padding: "8px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", marginBottom: 16 }}>{t("qms.addItem")}</button>
          <h4 style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>{t("qms.inspectionItems")} ({sel.items?.length ?? 0})</h4>
          {(sel.items ?? []).map(it => (
            <div key={it.id} style={{ padding: "8px 12px", background: "#1e293b", borderRadius: 6, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ color: "#e2e8f0", fontSize: 13 }}>{it.item_name ?? it.item_code ?? `#${it.id}`}</span>
                <span style={{ color: "#64748b", fontSize: 11, marginLeft: 8 }}>{it.category}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {it.measured_value != null && <span style={{ color: "#94a3b8", fontSize: 12 }}>{it.measured_value}</span>}
                <span style={{ color: it.result === "PASS" ? "#34d399" : it.result === "FAIL" ? "#f87171" : "#6b7280", fontSize: 12, fontWeight: 600 }}>{it.result}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
