import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface QmsComplaint {
  id: number; complaint_no: string; customer: string; product: string;
  quantity: number; defect_desc: string; priority: string;
  defect_images: string; status: string; root_cause: string;
  corrective_action: string; preventive_action: string;
  creator_name: string; factory_id: number; created_at: string;
}
interface QmsComplaintResponse {
  id: number; complaint_id: number; respondent_id: number;
  respondent_name: string; response_text: string; created_at: string;
}
interface QmsComplaintStats { total: number; open: number; highPriority: number; avgResolutionDays: number; }

const STATUS_COLOR: Record<string,string> = { received: "#fbbf24", investigating: "#38bdf8", resolved: "#34d399", closed: "#94a3b8" };
const PRIORITY_COLOR: Record<string,string> = { low: "#94a3b8", medium: "#fbbf24", high: "#f97316", critical: "#dc2626" };

export function QmsComplaints({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [complaints, setComplaints] = useState<QmsComplaint[]>([]);
  const [stats, setStats] = useState<QmsComplaintStats | null>(null);
  const [selected, setSelected] = useState<QmsComplaint | null>(null);
  const [responses, setResponses] = useState<QmsComplaintResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ complaint_no: "", customer: "", product: "", quantity: 0, defect_desc: "", priority: "medium", defect_images: "" });
  const [responseText, setResponseText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ root_cause: "", corrective_action: "", preventive_action: "", status: "" });

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/qms/complaints?factory_id=1", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setComplaints(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/qms/complaints/stats", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = (c: QmsComplaint) => {
    setSelected(c);
    setEditing(false);
    setEditForm({ root_cause: c.root_cause || "", corrective_action: c.corrective_action || "", preventive_action: c.preventive_action || "", status: c.status });
    fetch(`/api/qms/complaints/${c.id}/responses`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setResponses(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => setResponses([]));
  };

  const create = () => {
    fetch("/api/qms/complaints", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ ...form, factory_id: 1 }),
    }).then(r => r.json()).then(() => { setShowCreate(false); load(); });
  };

  const saveEdit = () => {
    if (!selected) return;
    fetch(`/api/qms/complaints/${selected.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify(editForm),
    }).then(r => r.json()).then(() => { setEditing(false); load(); });
  };

  const addResponse = () => {
    if (!selected || !responseText.trim()) return;
    fetch(`/api/qms/complaints/${selected.id}/respond`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ response_text: responseText }),
    }).then(r => r.json()).then(() => {
      setResponseText("");
      fetch(`/api/qms/complaints/${selected.id}/responses`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
        .then(r => r.json())
        .then(data => setResponses(Array.isArray(data) ? data : data.data ?? []));
    });
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
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.complaintsTitle")}</h2>
        <button onClick={() => setShowCreate(true)} style={{ padding: "8px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newComplaint")}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Total", value: stats.total, color: "#38bdf8" },
            { label: "Open", value: stats.open, color: "#fbbf24" },
            { label: "High Priority", value: stats.highPriority, color: "#f97316" },
            { label: "Avg Days", value: stats.avgResolutionDays, color: "#34d399" },
          ].map(s => (
            <div key={s.label} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ color: s.color, fontSize: 28, fontWeight: 700 }}>{s.value}</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {complaints.map(c => (
            <div key={c.id} onClick={() => openDetail(c)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, cursor: "pointer", borderLeft: `4px solid ${PRIORITY_COLOR[c.priority]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>[{c.complaint_no}] {c.customer} — {c.product}</div>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>{c.defect_desc.substring(0, 80)}{c.defect_desc.length > 80 ? "…" : ""}</div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>
                    {c.creator_name} | {c.created_at ? new Date(c.created_at).toLocaleDateString() : "-"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span style={{ background: STATUS_COLOR[c.status], padding: "2px 10px", borderRadius: 4, color: "#fff", fontSize: 12, fontWeight: 600 }}>{c.status}</span>
                  <span style={{ background: PRIORITY_COLOR[c.priority], padding: "2px 10px", borderRadius: 4, color: "#fff", fontSize: 11 }}>{c.priority}</span>
                </div>
              </div>
            </div>
          ))}
          {complaints.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>No complaints found</div>}
        </div>
      )}

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 480, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{t("qms.newComplaint")}</h3>
            {inp("Complaint No", "complaint_no")}
            {inp("Customer", "customer")}
            {inp("Product", "product")}
            {inp("Quantity", "quantity", "number")}
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Defect Description</label>
              <textarea value={form.defect_desc} onChange={e => setForm({ ...form, defect_desc: e.target.value })} rows={3}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box", resize: "vertical" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Priority</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
                {["low","medium","high","critical"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={create} style={{ flex: 1, padding: "10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Create</button>
              <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 640, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>[{selected.complaint_no}] {selected.customer}</h3>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ background: STATUS_COLOR[selected.status], padding: "2px 10px", borderRadius: 4, color: "#fff", fontSize: 12 }}>{selected.status}</span>
                <span style={{ background: PRIORITY_COLOR[selected.priority], padding: "2px 10px", borderRadius: 4, color: "#fff", fontSize: 12 }}>{selected.priority}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, color: "#94a3b8", fontSize: 13, margin: "12px 0" }}>
              <div>Product: <span style={{ color: "#e2e8f0" }}>{selected.product}</span></div>
              <div>Quantity: <span style={{ color: "#e2e8f0" }}>{selected.quantity}</span></div>
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>Defect: <span style={{ color: "#e2e8f0" }}>{selected.defect_desc}</span></div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setEditing(!editing)} style={{ padding: "6px 16px", background: editing ? "#475569" : "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{editing ? "Cancel Edit" : "Edit Root Cause / CA"}</button>
            </div>

            {editing && (
              <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#94a3b8", fontSize: 12 }}>Root Cause</label>
                  <textarea value={editForm.root_cause} onChange={e => setEditForm({ ...editForm, root_cause: e.target.value })} rows={2}
                    style={{ width: "100%", padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#94a3b8", fontSize: 12 }}>Corrective Action</label>
                  <textarea value={editForm.corrective_action} onChange={e => setEditForm({ ...editForm, corrective_action: e.target.value })} rows={2}
                    style={{ width: "100%", padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#94a3b8", fontSize: 12 }}>Preventive Action</label>
                  <textarea value={editForm.preventive_action} onChange={e => setEditForm({ ...editForm, preventive_action: e.target.value })} rows={2}
                    style={{ width: "100%", padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                    style={{ width: "100%", padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
                    {["received","investigating","resolved","closed"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <button onClick={saveEdit} style={{ width: "100%", padding: "8px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Save</button>
              </div>
            )}

            <div style={{ borderTop: "1px solid #334155", paddingTop: 12 }}>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>Responses</div>
              {responses.map(r => (
                <div key={r.id} style={{ background: "#0f172a", borderRadius: 6, padding: 10, marginBottom: 6 }}>
                  <div style={{ color: "#e2e8f0", fontSize: 13 }}>{r.response_text}</div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>{r.respondent_name} | {new Date(r.created_at).toLocaleString()}</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input placeholder="Add response…" value={responseText} onChange={e => setResponseText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addResponse()}
                  style={{ flex: 1, padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 }} />
                <button onClick={addResponse} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Send</button>
              </div>
            </div>

            <button onClick={() => setSelected(null)} style={{ marginTop: 16, width: "100%", padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
