/**
 * Wms8DReport — 8D/QRQC 报告管理
 *
 * Excel 菜单项: "质量管理" — 8D报告
 * Tab: eightD
 *
 * Flow: 创建8D → 填写D1-D8 → 关闭
 * DB: qms_8d_reports
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "../api/wms";

interface EightDReport {
  id: string;
  report_no: string;
  title: string;
  source: string;
  severity: string;
  status: string;
  customer_code: string | null;
  customer_name: string | null;
  wo_code: string | null;
  batch_no: string | null;
  defect_code: string | null;
  defect_desc: string | null;
  ng_qty: number;
  d1_team: string | null;
  d2_problem: string | null;
  d3_containment: string | null;
  d4_root_cause: string | null;
  d5_corrective: string | null;
  d6_implement: string | null;
  d7_preventive: string | null;
  d8_congratulate: string | null;
  opened_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

const sevColor: Record<string, string> = { CRITICAL: "#f87171", MAJOR: "#fb923c", MINOR: "#fbbf24" };
const stColor: Record<string, string> = { OPEN: "#f87171", IN_PROGRESS: "#38bdf8", CLOSED: "#34d399" };

const D_FIELDS = [
  { key: "d1_team", label: "D1 团队" },
  { key: "d2_problem", label: "D2 问题描述" },
  { key: "d3_containment", label: "D3 临时措施" },
  { key: "d4_root_cause", label: "D4 根本原因" },
  { key: "d5_corrective", label: "D5 纠正措施" },
  { key: "d6_implement", label: "D6 实施验证" },
  { key: "d7_preventive", label: "D7 预防措施" },
  { key: "d8_congratulate", label: "D8 总结表彰" },
] as const;

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", background: "#0f172a",
  border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", boxSizing: "border-box",
};

export function Wms8DReport() {
  const [list, setList] = useState<EightDReport[]>([]);
  const [sel, setSel] = useState<EightDReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", source: "OQC", severity: "MAJOR", customer_code: "", wo_code: "", defect_desc: "", ng_qty: 0 });
  const [editD, setEditD] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    api.get("/qms/8d")
      .then((r: any) => setList(r?.data ?? r ?? []))
      .catch((e: any) => console.error("8D list:", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (r: EightDReport) => {
    setSel(r);
    const d: Record<string, string> = {};
    D_FIELDS.forEach(f => { d[f.key] = (r as any)[f.key] ?? ""; });
    setEditD(d);
  };

  const create = () => {
    api.post("/qms/8d", form)
      .then(() => { setShowCreate(false); load(); })
      .catch((e: any) => alert(e.message));
  };

  const saveD = () => {
    if (!sel) return;
    api.put(`/qms/8d/${sel.id}`, editD)
      .then(() => { load(); })
      .catch((e: any) => alert(e.message));
  };

  const close8d = () => {
    if (!sel) return;
    api.put(`/qms/8d/${sel.id}/close`, {})
      .then(() => { setSel(null); load(); })
      .catch((e: any) => alert(e.message));
  };

  const inp = (label: string, key: string, type = "text") => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={(form as any)[key]}
        onChange={e => setForm({ ...form, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
        style={inputStyle} />
    </div>
  );

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>📋 8D/QRQC 报告</h2>
        <button onClick={() => setShowCreate(!showCreate)}
          style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          + 新建8D
        </button>
      </div>

      {showCreate && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {inp("标题", "title")}
            {inp("来源", "source")}
            {inp("严重度", "severity")}
            {inp("客户代码", "customer_code")}
            {inp("工单号", "wo_code")}
            {inp("NG数量", "ng_qty", "number")}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>不良描述</label>
            <textarea value={form.defect_desc} onChange={e => setForm({ ...form, defect_desc: e.target.value })}
              style={{ ...inputStyle, minHeight: 60 }} />
          </div>
          <button onClick={create}
            style={{ padding: "8px 24px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            提交
          </button>
        </div>
      )}

      {loading ? <div style={{ color: "#94a3b8" }}>加载中...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["报告号", "标题", "严重度", "来源", "NG数", "状态", "操作"].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, color: "#64748b", textAlign: "center" }}>暂无数据</td></tr>
            )}
            {list.map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }} onClick={() => open(r)}>
                <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{r.report_no}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{r.title}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: sevColor[r.severity] ?? "#94a3b8", fontSize: 12, fontWeight: 600 }}>{r.severity}</span>
                </td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{r.source}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{r.ng_qty}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    color: stColor[r.status] ?? "#94a3b8",
                    background: `${stColor[r.status] ?? "#94a3b8"}22`,
                    padding: "2px 10px", borderRadius: 10, fontSize: 12,
                  }}>{r.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button onClick={e => { e.stopPropagation(); open(r); }}
                    style={{ padding: "4px 12px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
          background: "#0f172a", borderLeft: "1px solid #334155",
          padding: 24, overflowY: "auto", zIndex: 100,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ color: "#e2e8f0", margin: 0 }}>{sel.report_no} — {sel.title}</h3>
            <button onClick={() => setSel(null)}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>✕</button>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>
            {sel.severity} | {sel.source} | {sel.status} | NG: {sel.ng_qty}
            {sel.customer_code && ` | 客户: ${sel.customer_code}`}
            {sel.wo_code && ` | 工单: ${sel.wo_code}`}
          </div>
          {sel.defect_desc && (
            <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 16, padding: 12, background: "#1e293b", borderRadius: 8 }}>
              不良描述: {sel.defect_desc}
            </div>
          )}
          {D_FIELDS.map((f) => (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <label style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>{f.label}</label>
              <textarea value={editD[f.key] ?? ""} onChange={e => setEditD({ ...editD, [f.key]: e.target.value })}
                style={{ ...inputStyle, minHeight: 50, background: "#1e293b" }} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={saveD}
              style={{ flex: 1, padding: "10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              保存
            </button>
            {sel.status !== "CLOSED" && (
              <button onClick={close8d}
                style={{ flex: 1, padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                关闭8D
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
