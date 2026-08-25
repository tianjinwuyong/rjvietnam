import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface QmsAudit {
  id: number; title: string; type: string; scope: string; standard: string;
  scheduled_date: string; auditor_id: number; auditor_name: string;
  assignee_id: number; assignee_name: string; status: string;
  started_at: string; completed_at: string; factory_id: number;
  created_at: string;
}
interface QmsAuditFinding {
  id: number; audit_id: number; description: string; severity: string;
  category: string; due_date: string; status: string; resolution: string;
  raised_by: number; raised_by_name: string; created_at: string;
}

const STATUS_COLOR: Record<string,string> = {
  planned: "#94a3b8", in_progress: "#fbbf24", completed: "#34d399", cancelled: "#f87171",
};
const SEVERITY_COLOR: Record<string,string> = { critical: "#dc2626", major: "#f97316", minor: "#fbbf24", observation: "#38bdf8" };

export function QmsAudits({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [audits, setAudits] = useState<QmsAudit[]>([]);
  const [findings, setFindings] = useState<QmsAuditFinding[]>([]);
  const [selected, setSelected] = useState<QmsAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", type: "internal", scope: "", standard: "ISO9001:2015", scheduled_date: "", auditor_id: 1, assignee_id: 1 });
  const [showFindings, setShowFindings] = useState(false);
  const [findingForm, setFindingForm] = useState({ description: "", severity: "minor", category: "non_conformance", due_date: "" });

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/qms/audits?factory_id=1", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setAudits(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadFindings = (auditId: number) => {
    fetch(`/api/qms/audits/${auditId}/findings`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setFindings(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => setFindings([]));
  };

  const openDetail = (a: QmsAudit) => { setSelected(a); setShowFindings(false); loadFindings(a.id); };

  const create = () => {
    fetch("/api/qms/audits", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ ...form, factory_id: 1 }),
    }).then(r => r.json()).then(() => { setShowCreate(false); load(); });
  };

  const updateStatus = (id: number, status: string) => {
    fetch(`/api/qms/audits/${id}/status`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ status }),
    }).then(r => r.json()).then(() => load());
  };

  const addFinding = () => {
    if (!selected) return;
    fetch(`/api/qms/audits/${selected.id}/findings`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify(findingForm),
    }).then(r => r.json()).then(() => { loadFindings(selected.id); setFindingForm({ description: "", severity: "minor", category: "non_conformance", due_date: "" }); });
  };

  const resolveFinding = (fid: number, status: string) => {
    fetch(`/api/qms/audits/findings/${fid}/status`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ status, resolution: "Resolved by auditor" }),
    }).then(r => r.json()).then(() => selected && loadFindings(selected.id));
  };

  const inp = (label: string, key: string, type = "text") => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: type === "date" ? e.target.value : e.target.value })}
        style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.auditsTitle")}</h2>
        <button onClick={() => setShowCreate(true)} style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newAudit")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["planned","in_progress","completed","cancelled"].map(s => (
          <button key={s} onClick={() => { const a = audits.find(x => x.status === s); if (a) openDetail(a); }}
            style={{ padding: "4px 12px", background: STATUS_COLOR[s], color: s === "planned" ? "#1e293b" : "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, textTransform: "capitalize" }}>
            {s.replace("_"," ")}
          </button>
        ))}
      </div>

      {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {audits.map(a => (
            <div key={a.id} onClick={() => openDetail(a)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{a.title}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                    <span style={{ background: "#334155", padding: "2px 8px", borderRadius: 4, marginRight: 8 }}>{a.type}</span>
                    <span style={{ background: "#334155", padding: "2px 8px", borderRadius: 4, marginRight: 8 }}>{a.standard}</span>
                    <span style={{ color: STATUS_COLOR[a.status], fontWeight: 600 }}>{a.status.toUpperCase()}</span>
                  </div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>
                    Auditor: {a.auditor_name} | Scheduled: {a.scheduled_date ? new Date(a.scheduled_date).toLocaleDateString() : "-"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {a.status === "planned" && <button onClick={e => { e.stopPropagation(); updateStatus(a.id, "in_progress"); }} style={{ padding: "4px 10px", background: "#d97706", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Start</button>}
                  {a.status === "in_progress" && <button onClick={e => { e.stopPropagation(); updateStatus(a.id, "completed"); }} style={{ padding: "4px 10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Complete</button>}
                  <button onClick={e => { e.stopPropagation(); setSelected(a); setShowFindings(true); loadFindings(a.id); }} style={{ padding: "4px 10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Findings</button>
                </div>
              </div>
            </div>
          ))}
          {audits.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>No audits found</div>}
        </div>
      )}

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 480 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{t("qms.newAudit")}</h3>
            {inp("Title", "title")}
            {inp("Scope", "scope")}
            {inp("Standard", "standard")}
            {inp("Scheduled Date", "scheduled_date", "date")}
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={create} style={{ flex: 1, padding: "10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Create</button>
              <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {selected && !showFindings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 560 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{selected.title}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, color: "#94a3b8", fontSize: 13, marginTop: 12 }}>
              <div>Type: <span style={{ color: "#e2e8f0" }}>{selected.type}</span></div>
              <div>Status: <span style={{ color: STATUS_COLOR[selected.status] }}>{selected.status.toUpperCase()}</span></div>
              <div>Standard: <span style={{ color: "#e2e8f0" }}>{selected.standard}</span></div>
              <div>Scope: <span style={{ color: "#e2e8f0" }}>{selected.scope}</span></div>
              <div>Auditor: <span style={{ color: "#e2e8f0" }}>{selected.auditor_name}</span></div>
              <div>Assignee: <span style={{ color: "#e2e8f0" }}>{selected.assignee_name}</span></div>
            </div>
            <button onClick={() => setSelected(null)} style={{ marginTop: 16, width: "100%", padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}

      {selected && showFindings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 640, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>Findings: {selected.title}</h3>
            <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8 }}>
              <input placeholder="Description" value={findingForm.description} onChange={e => setFindingForm({ ...findingForm, description: e.target.value })}
                style={{ padding: "6px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 }} />
              <select value={findingForm.severity} onChange={e => setFindingForm({ ...findingForm, severity: e.target.value })}
                style={{ padding: "6px 8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 12 }}>
                {["critical","major","minor","observation"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={findingForm.due_date} onChange={e => setFindingForm({ ...findingForm, due_date: e.target.value })}
                style={{ padding: "6px 8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 12 }} />
              <button onClick={addFinding} style={{ padding: "6px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Add</button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {findings.map(f => (
                <div key={f.id} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ color: "#e2e8f0", fontSize: 13 }}>{f.description}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ background: SEVERITY_COLOR[f.severity], padding: "2px 8px", borderRadius: 4, color: "#fff", fontSize: 11, fontWeight: 600 }}>{f.severity}</span>
                      <span style={{ background: f.status === "open" ? "#dc2626" : "#16a34a", padding: "2px 8px", borderRadius: 4, color: "#fff", fontSize: 11 }}>{f.status}</span>
                    </div>
                  </div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>Due: {f.due_date ? new Date(f.due_date).toLocaleDateString() : "-"} | Raised by {f.raised_by_name}</div>
                  {f.status === "open" && <button onClick={() => resolveFinding(f.id, "closed")} style={{ marginTop: 6, padding: "3px 10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>Resolve</button>}
                </div>
              ))}
              {findings.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>No findings yet</div>}
            </div>
            <button onClick={() => { setSelected(null); setShowFindings(false); }} style={{ marginTop: 16, width: "100%", padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
