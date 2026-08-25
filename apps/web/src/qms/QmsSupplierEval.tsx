import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface QmsSupplierEval {
  id: number; supplier_id: number; supplier_name: string;
  evaluation_date: string; quality_score: number; delivery_score: number;
  service_score: number; communication_score: number;
  overall_score: number; grade: string; remarks: string;
  evaluator_name: string; factory_id: number; created_at: string;
}
interface Supplier { id: number; name: string; }
interface SupplierStats { totalSuppliers: number; avgOverallScore: number; gradeDistribution: { grade: string; count: number }[]; }

const GRADE_COLOR: Record<string,string> = { A: "#16a34a", B: "#38bdf8", C: "#fbbf24", D: "#f97316", F: "#dc2626" };

export function QmsSupplierEval({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [evals, setEvals] = useState<QmsSupplierEval[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stats, setStats] = useState<SupplierStats | null>(null);
  const [selected, setSelected] = useState<QmsSupplierEval | null>(null);
  const [history, setHistory] = useState<QmsSupplierEval[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ supplier_id: 1, evaluation_date: "", quality_score: 80, delivery_score: 80, service_score: 80, communication_score: 80, overall_score: 80, grade: "B", remarks: "" });

  const calcOverall = (f: typeof form) => {
    const avg = (Number(f.quality_score) + Number(f.delivery_score) + Number(f.service_score) + Number(f.communication_score)) / 4;
    const score = Math.round(avg * 10) / 10;
    let grade = "D";
    if (score >= 90) grade = "A"; else if (score >= 75) grade = "B"; else if (score >= 60) grade = "C"; else if (score >= 40) grade = "D"; else grade = "F";
    return { score, grade };
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/qms/supplier-evaluations?factory_id=1", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setEvals(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/qms/supplier-evaluations/suppliers", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setSuppliers(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => {});
    fetch("/api/qms/supplier-evaluations/stats", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = (e: QmsSupplierEval) => {
    setSelected(e);
    fetch(`/api/qms/supplier-evaluations/history/${e.supplier_id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.json())
      .then(data => setHistory(Array.isArray(data) ? data : data.data ?? []))
      .catch(() => setHistory([]));
  };

  const create = () => {
    const { score, grade } = calcOverall(form);
    fetch("/api/qms/supplier-evaluations", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ ...form, overall_score: score, grade, factory_id: 1 }),
    }).then(r => r.json()).then(() => { setShowCreate(false); load(); });
  };

  const scoreBar = (score: number) => {
    const color = score >= 75 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, background: "#0f172a", borderRadius: 4, height: 6 }}>
          <div style={{ width: `${score}%`, background: color, borderRadius: 4, height: 6 }} />
        </div>
        <span style={{ color: "#e2e8f0", fontSize: 12, width: 36, textAlign: "right" }}>{score}</span>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>{t("qms.supplierEvalTitle")}</h2>
        <button onClick={() => setShowCreate(true)} style={{ padding: "8px 20px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + {t("qms.newEval")}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ color: "#38bdf8", fontSize: 28, fontWeight: 700 }}>{stats.totalSuppliers}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>Suppliers Evaluated</div>
          </div>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ color: "#34d399", fontSize: 28, fontWeight: 700 }}>{stats.avgOverallScore}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>Avg Overall Score</div>
          </div>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 12, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
            {stats.gradeDistribution.slice(0, 4).map(g => (
              <div key={g.grade} style={{ textAlign: "center" }}>
                <div style={{ color: GRADE_COLOR[g.grade] || "#94a3b8", fontSize: 20, fontWeight: 700 }}>{g.grade}</div>
                <div style={{ color: "#64748b", fontSize: 11 }}>{g.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {evals.map(e => (
            <div key={e.id} onClick={() => openDetail(e)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{e.supplier_name}</div>
                  <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>{e.evaluation_date ? new Date(e.evaluation_date).toLocaleDateString() : "-"} | By {e.evaluator_name}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ color: "#64748b", fontSize: 13 }}>Overall: </span>
                  <span style={{ color: GRADE_COLOR[e.grade], fontSize: 22, fontWeight: 700 }}>{e.overall_score}</span>
                  <span style={{ background: GRADE_COLOR[e.grade], padding: "2px 10px", borderRadius: 4, color: "#fff", fontSize: 14, fontWeight: 700 }}>{e.grade}</span>
                </div>
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                {[
                  { label: "Quality", value: e.quality_score },
                  { label: "Delivery", value: e.delivery_score },
                  { label: "Service", value: e.service_score },
                  { label: "Communication", value: e.communication_score },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ color: "#64748b", fontSize: 10, marginBottom: 2 }}>{s.label}</div>
                    {scoreBar(s.value)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {evals.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>No evaluations found</div>}
        </div>
      )}

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 480 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{t("qms.newEval")}</h3>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Supplier</label>
              <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: Number(e.target.value) })}
                style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0" }}>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {inp("Evaluation Date", "evaluation_date", "date")}
            {[
              { label: "Quality Score", key: "quality_score" },
              { label: "Delivery Score", key: "delivery_score" },
              { label: "Service Score", key: "service_score" },
              { label: "Communication Score", key: "communication_score" },
            ].map(({ label, key }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}: {form[key as keyof typeof form]}</label>
                <input type="range" min="0" max="100" value={form[key as keyof typeof form]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })}
                  style={{ width: "100%" }} />
              </div>
            ))}
            {(() => { const { score, grade } = calcOverall(form); return (
              <div style={{ background: "#0f172a", borderRadius: 8, padding: 12, textAlign: "center", marginBottom: 10 }}>
                <div style={{ color: "#94a3b8", fontSize: 12 }}>Calculated Overall: <span style={{ color: GRADE_COLOR[grade], fontSize: 20, fontWeight: 700 }}>{score}</span> → Grade <span style={{ color: GRADE_COLOR[grade], fontWeight: 700 }}>{grade}</span></div>
              </div>
            ); })()}
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={create} style={{ flex: 1, padding: "10px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Create</button>
              <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 560, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>{selected.supplier_name} — Evaluation Detail</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, color: "#94a3b8", fontSize: 13, margin: "12px 0" }}>
              <div>Date: <span style={{ color: "#e2e8f0" }}>{selected.evaluation_date ? new Date(selected.evaluation_date).toLocaleDateString() : "-"}</span></div>
              <div>Evaluator: <span style={{ color: "#e2e8f0" }}>{selected.evaluator_name}</span></div>
              <div>Overall: <span style={{ color: GRADE_COLOR[selected.grade], fontWeight: 700 }}>{selected.overall_score} ({selected.grade})</span></div>
              {selected.remarks && <div style={{ gridColumn: "1/-1" }}>Remarks: <span style={{ color: "#e2e8f0" }}>{selected.remarks}</span></div>}
            </div>
            <div style={{ borderTop: "1px solid #334155", paddingTop: 12 }}>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>Score Breakdown</div>
              {[
                { label: "Quality", value: selected.quality_score },
                { label: "Delivery", value: selected.delivery_score },
                { label: "Service", value: selected.service_score },
                { label: "Communication", value: selected.communication_score },
              ].map(s => (
                <div key={s.label} style={{ marginBottom: 8 }}>
                  <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                    <span>{s.label}</span><span style={{ color: "#e2e8f0" }}>{s.value}</span>
                  </div>
                  {scoreBar(s.value)}
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #334155", paddingTop: 12, marginTop: 12 }}>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>History (Last 12)</div>
              {history.map(h => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                  <span style={{ color: "#64748b", fontSize: 12 }}>{h.evaluation_date ? new Date(h.evaluation_date).toLocaleDateString() : "-"}</span>
                  <span style={{ color: GRADE_COLOR[h.grade], fontWeight: 700 }}>{h.overall_score} ({h.grade})</span>
                </div>
              ))}
              {history.length === 0 && <div style={{ color: "#475569", fontSize: 12 }}>No history</div>}
            </div>
            <button onClick={() => setSelected(null)} style={{ marginTop: 16, width: "100%", padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function inp(label: string, key: string, type = "text") {
  return null; // helper, defined inline above
}
