import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface QmsQualityCost {
  id: number; cost_type: string; category: string; amount: number;
  currency: string; cost_date: string; description: string;
  related_order_no: string; recorder_name: string;
  factory_id: number; created_at: string;
}
interface CostSummary { byType: { cost_type: string; total: number; count: number }[]; grandTotal: number; }

const COST_TYPE_COLOR: Record<string,string> = {
  prevention: "#34d399", appraisal: "#38bdf8", internal_failure: "#fbbf24", external_failure: "#f87171",
};

export function QmsQualityCosts({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [costs, setCosts] = useState<QmsQualityCost[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ cost_type: "", start_date: "", end_date: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ cost_type: "internal_failure", category: "", amount: 0, currency: "VND", cost_date: "", description: "", related_order_no: "" });

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ factory_id: "1" });
    if (filter.cost_type) params.append("cost_type", filter.cost_type);
    if (filter.start_date) params.append("start_date", filter.start_date);
    if (filter.end_date) params.append("end_date", filter.end_date);
    fetch(`/api/qms/quality-costs?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setCosts(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    const sparams = new URLSearchParams({ factory_id: "1" });
    if (filter.start_date) sparams.append("start_date", filter.start_date);
    if (filter.end_date) sparams.append("end_date", filter.end_date);
    fetch(`/api/qms/quality-costs/summary?${sparams}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setSummary(data))
      .catch(() => {});
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const create = () => {
    fetch("/api/qms/quality-costs", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ ...form, factory_id: 1 }),
    }).then(r => r.json()).then(() => { setShowCreate(false); load(); });
  };

  const formatCurrency = (amount: number, currency: string) => {
    if (currency === "USD") return `$${amount.toLocaleString()}`;
    return `${amount.toLocaleString()} ${currency}`;
  };

  const TYPE_LABELS: Record<string,string> = {
    prevention: "Prevention Cost",
    appraisal: "Appraisal Cost",
    internal_failure: "Internal Failure",
    external_failure: "External Failure",
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.qualityCostsTitle")}</h2>
        <button onClick={() => setShowCreate(true)} style={{ padding: "8px 20px", background: "#0891b2", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newCost")}
        </button>
      </div>

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ color: "#f87171", fontSize: 24, fontWeight: 700 }}>{formatCurrency(summary.grandTotal, "VND")}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>Grand Total</div>
          </div>
          {summary.byType.map(t => (
            <div key={t.cost_type} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ color: COST_TYPE_COLOR[t.cost_type] || "#94a3b8", fontSize: 20, fontWeight: 700 }}>{formatCurrency(t.total, "VND")}</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>{TYPE_LABELS[t.cost_type] || t.cost_type}</div>
              <div style={{ color: "#475569", fontSize: 11 }}>{t.count} records</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["prevention","appraisal","internal_failure","external_failure"].map(type => (
          <button key={type} onClick={() => setFilter({ ...filter, cost_type: filter.cost_type === type ? "" : type })}
            style={{ padding: "4px 12px", background: filter.cost_type === type ? COST_TYPE_COLOR[type] : "#334155", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
            {TYPE_LABELS[type]}
          </button>
        ))}
        <input type="date" value={filter.start_date} onChange={e => setFilter({ ...filter, start_date: e.target.value })} placeholder="Start"
          style={{ padding: "4px 8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 12 }} />
        <input type="date" value={filter.end_date} onChange={e => setFilter({ ...filter, end_date: e.target.value })} placeholder="End"
          style={{ padding: "4px 8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 12 }} />
      </div>

      {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 10 }}>
          {costs.map(c => (
            <div key={c.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: "#e2e8f0", fontWeight: 500, fontSize: 14 }}>{c.description}</div>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                  <span style={{ background: COST_TYPE_COLOR[c.cost_type] || "#334155", padding: "2px 8px", borderRadius: 4, color: "#fff", fontSize: 11 }}>{TYPE_LABELS[c.cost_type] || c.cost_type}</span>
                  {c.category && <span style={{ marginLeft: 8 }}>{c.category}</span>}
                  {c.related_order_no && <span style={{ marginLeft: 8 }}>Order: {c.related_order_no}</span>}
                </div>
                <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>{c.recorder_name} | {c.cost_date ? new Date(c.cost_date).toLocaleDateString() : "-"}</div>
              </div>
              <div style={{ color: COST_TYPE_COLOR[c.cost_type] || "#e2e8f0", fontSize: 18, fontWeight: 700 }}>
                {formatCurrency(c.amount, c.currency)}
              </div>
            </div>
          ))}
          {costs.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>No cost records found</div>}
        </div>
      )}

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 480 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{t("qms.newCost")}</h3>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Cost Type</label>
              <select value={form.cost_type} onChange={e => setForm({ ...form, cost_type: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Category</label>
              <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Amount</label>
                <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
                  style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Currency</label>
                <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
                  {["VND","USD","CNY"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Cost Date</label>
              <input type="date" value={form.cost_date} onChange={e => setForm({ ...form, cost_date: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box", resize: "vertical" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Related Order No</label>
              <input value={form.related_order_no} onChange={e => setForm({ ...form, related_order_no: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={create} style={{ flex: 1, padding: "10px", background: "#0891b2", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Create</button>
              <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
