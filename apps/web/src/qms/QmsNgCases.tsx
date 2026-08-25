// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsNgCase } from "../api/qms";

const stColor: Record<string,string> = { OPEN: "#f87171", REPAIRING: "#fb923c", RETEST: "#38bdf8", REPAIRED: "#34d399", SCRAPPED: "#6b7280" };

export function QmsNgCases({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [list, setList] = useState<QmsNgCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ sn: "", wo_code: "", station_code: "", defect_code: "", defect_desc: "", severity: "MAJOR" });
  const [action, setAction] = useState<{ id: number; type: string } | null>(null);
  const [actionText, setActionText] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    qmsApi.listNgCases()
      .then(r => setList(r.data?.items ?? []))
      .catch(e => console.error("NG list:", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = () => {
    qmsApi.createNgCase(form as any)
      .then(() => { setShowCreate(false); load(); })
      .catch(e => alert(e.message));
  };

  const doAction = () => {
    if (!action) return;
    const { id, type } = action;
    const p = type === "repair" ? qmsApi.repairNg(id, { repair_notes: actionText })
      : type === "retest" ? qmsApi.retestNg(id, { retest_result: actionText })
      : qmsApi.scrapNg(id, { scrap_reason: actionText, scrap_approved_by: "QC" });
    p.then(() => { setAction(null); setActionText(""); load(); }).catch(e => alert(e.message));
  };

  const inp = (label: string, key: string) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
        style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.ngTitle")}</h2>
        <button onClick={() => setShowCreate(!showCreate)} style={{ padding: "8px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newNg")}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {inp("SN", "sn")}{inp(t("qms.woCode"), "wo_code")}{inp(t("qms.station"), "station_code")}
            {inp(t("qms.defectCode"), "defect_code")}{inp(t("qms.severity"), "severity")}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{t("qms.defectDesc")}</label>
            <textarea value={form.defect_desc} onChange={e => setForm({ ...form, defect_desc: e.target.value })}
              style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", minHeight: 60, boxSizing: "border-box" }} />
          </div>
          <button onClick={create} style={{ padding: "8px 24px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.submit")}</button>
        </div>
      )}

      {loading ? <div style={{ color: "#94a3b8" }}>{t("qms.loading")}</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {[t("qms.caseNo"), "SN", t("qms.woCode"), t("qms.station"), t("qms.defectCode"), t("qms.severity"), t("qms.repairCount"), t("qms.status"), t("qms.action")].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(c => (
              <tr key={c.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{c.case_no}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{c.sn ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{c.wo_code ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{c.station_code ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{c.defect_code ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: c.severity === "CRITICAL" ? "#f87171" : "#fb923c", fontWeight: 600, fontSize: 12 }}>{c.severity}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{c.repair_count}/2</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: stColor[c.status] ?? "#94a3b8", background: `${stColor[c.status] ?? "#94a3b8"}22`, padding: "2px 10px", borderRadius: 10, fontSize: 12 }}>{c.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {c.status !== "SCRAPPED" && c.status !== "REPAIRED" && (
                      <>
                        <button onClick={() => { setAction({ id: c.id, type: "repair" }); setActionText(""); }} style={{ padding: "3px 8px", background: "#d97706", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>{t("qms.repair")}</button>
                        <button onClick={() => { setAction({ id: c.id, type: "retest" }); setActionText(""); }} style={{ padding: "3px 8px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>{t("qms.retest")}</button>
                        <button onClick={() => { setAction({ id: c.id, type: "scrap" }); setActionText(""); }} style={{ padding: "3px 8px", background: "#6b7280", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>{t("qms.scrap")}</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {action && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#1e293b", borderRadius: 12, padding: 24, width: 400 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>
              {action.type === "repair" ? t("qms.repair") : action.type === "retest" ? t("qms.retest") : t("qms.scrap")} #{action.id}
            </h3>
            <textarea value={actionText} onChange={e => setActionText(e.target.value)} placeholder={action.type === "scrap" ? t("qms.scrapReason") : t("qms.notes")}
              style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", minHeight: 80, boxSizing: "border-box", marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={doAction} style={{ flex: 1, padding: "10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.confirm")}</button>
              <button onClick={() => setAction(null)} style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
