import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface QmsDocument {
  id: number; title: string; category: string; version: string;
  file_url: string; status: string; uploaded_by: number;
  uploader_name: string; approved_by: number; approver_name: string;
  approved_at: string; factory_id: number; created_at: string;
}

const CATEGORIES = ["ISO9001", "ISO14001", "IATF16949", "SOP", "WI", "SPEC", "OTHERS"];
const STATUS_COLOR: Record<string,string> = {
  draft: "#94a3b8", pending_review: "#fbbf24", active: "#34d399", obsolete: "#f87171",
};

export function QmsDocuments({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<QmsDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ category: "", status: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", category: "SOP", version: "1.0", file_url: "", status: "draft" });
  const [selected, setSelected] = useState<QmsDocument | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/qms/documents?factory_id=1", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => { setDocs(Array.isArray(data) ? data : data.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = docs.filter(d => {
    if (filter.category && d.category !== filter.category) return false;
    if (filter.status && d.status !== filter.status) return false;
    return true;
  });

  const create = () => {
    fetch("/api/qms/documents", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ ...form, factory_id: 1 }),
    }).then(r => r.json()).then(() => { setShowCreate(false); load(); });
  };

  const approve = (id: number) => {
    fetch(`/api/qms/documents/${id}/approve`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
    }).then(r => r.json()).then(() => load());
  };

  const del = (id: number) => {
    if (!confirm("Delete this document?")) return;
    fetch(`/api/qms/documents/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(() => load());
  };

  const inp = (label: string, key: string) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
        style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
    </div>
  );

  const sel = (label: string, key: string, opts: string[]) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <select value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
        style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }}>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.documentsTitle")}</h2>
        <button onClick={() => setShowCreate(true)} style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newDocument")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <select value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}
          style={{ padding: "6px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
          style={{ padding: "6px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="pending_review">Pending Review</option>
          <option value="active">Active</option>
          <option value="obsolete">Obsolete</option>
        </select>
      </div>

      {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map(d => (
            <div key={d.id} onClick={() => setSelected(d)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 15 }}>{d.title}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                    <span style={{ background: "#334155", padding: "2px 8px", borderRadius: 4, marginRight: 8 }}>{d.category}</span>
                    <span style={{ background: "#334155", padding: "2px 8px", borderRadius: 4, marginRight: 8 }}>v{d.version}</span>
                    <span style={{ color: STATUS_COLOR[d.status] || "#94a3b8", fontWeight: 600 }}>{d.status.toUpperCase()}</span>
                  </div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>
                    Uploaded by {d.uploader_name} | {d.created_at ? new Date(d.created_at).toLocaleDateString() : "-"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {d.status === "draft" || d.status === "pending_review" ? (
                    <button onClick={e => { e.stopPropagation(); approve(d.id); }} style={{ padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Approve</button>
                  ) : null}
                  <button onClick={e => { e.stopPropagation(); del(d.id); }} style={{ padding: "4px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>No documents found</div>}
        </div>
      )}

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 480, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{t("qms.newDocument")}</h3>
            {inp("Title", "title")}
            {sel("Category", "category", CATEGORIES)}
            {inp("Version", "version")}
            {inp("File URL", "file_url")}
            {sel("Status", "status", ["draft", "pending_review"])}
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={create} style={{ flex: 1, padding: "10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Create</button>
              <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 560 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{selected.title}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, color: "#94a3b8", fontSize: 13 }}>
              <div>Category: <span style={{ color: "#e2e8f0" }}>{selected.category}</span></div>
              <div>Version: <span style={{ color: "#e2e8f0" }}>{selected.version}</span></div>
              <div>Status: <span style={{ color: STATUS_COLOR[selected.status] }}>{selected.status.toUpperCase()}</span></div>
              <div>Approved by: <span style={{ color: "#e2e8f0" }}>{selected.approver_name || "-"}</span></div>
              {selected.file_url && <div style={{ gridColumn: "1/-1" }}>File: <a href={selected.file_url} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>{selected.file_url}</a></div>}
            </div>
            <button onClick={() => setSelected(null)} style={{ marginTop: 16, width: "100%", padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
