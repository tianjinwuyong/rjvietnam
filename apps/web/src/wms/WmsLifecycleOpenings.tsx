/**
 * WmsLifecycleOpenings — 物料开封日期登记记录表
 * Sheet 4 from 仓库电子元器件寿命管参考
 *
 * Data: GET/POST /api/lifecycle/openings
 */

import { useState, useEffect, useCallback } from "react";
import { PermissionGuard } from "../PermissionGuard";
import { wmsApi } from "../api/wms";
import type { LifecycleOpening } from "../api/wms";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface FormState {
  material_lot_id: string;
  opened_at: string;
  opened_shelf_life_days: string;
  opened_qty: string;
  department: string;
  operator: string;
}

const DEFAULT_FORM: FormState = {
  material_lot_id: "",
  opened_at: new Date().toISOString().slice(0, 10),
  opened_shelf_life_days: "",
  opened_qty: "",
  department: "",
  operator: "",
};

function getStatusConfig(locale: Locale): Record<string, { color: string; bg: string }> {
  return {
    [t("wms.normalUse", locale)]:     { color: "#fff", bg: "#27ae60" },
    [t("wms.nearExpiry", locale)]:       { color: "#000", bg: "#f39c12" },
    [t("wms.expiredIsolated", locale)]:   { color: "#fff", bg: "#c0392b" },
  };
}

export function WmsLifecycleOpenings({ permissions, locale }: { permissions: string[]; locale: Locale }) {
  const [records, setRecords] = useState<LifecycleOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await wmsApi.getLifecycleOpenings({ limit: 100 });
      setRecords(records ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateForm = (field: keyof FormState, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.material_lot_id || !form.opened_at || !form.opened_shelf_life_days) {
      setMsg({ ok: false, text: t("wms.fillRequiredOpening", locale) });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const body = {
        material_lot_id: Number(form.material_lot_id),
        opened_at: form.opened_at,
        opened_shelf_life_days: Number(form.opened_shelf_life_days),
        opened_qty: form.opened_qty ? Number(form.opened_qty) : undefined,
        department: form.department || undefined,
        operator: form.operator || undefined,
      };
      const res = await wmsApi.postLifecycleOpening(body);
      if (res.success) {
        setMsg({ ok: true, text: t("wms.openingSuccess", locale) });
        resetForm();
        setShowForm(false);
        setRefreshKey(k => k + 1);
      } else {
        setMsg({ ok: false, text: t("wms.submitFailed", locale) });
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 0 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>物料开封日期登记记录表</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>Sheet 4 · 开封后有效期追踪</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setRefreshKey(k => k + 1)}
            style={{ padding: "6px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>刷新</button>
          <button onClick={() => { setShowForm(f => !f); setMsg(null); }}
            style={{ padding: "6px 16px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {showForm ? "关闭表单" : "+ 登记开封"}
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, borderBottom: "1px solid #eee", paddingBottom: 8 }}>
            登记开封记录
          </h3>
          {msg && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: msg.ok ? "#d4edda" : "#f8d7da", color: msg.ok ? "#155724" : "#721c24", marginBottom: 14, fontSize: 13 }}>
              {msg.text}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>物料批次ID *</label>
                <input type="number" value={form.material_lot_id} onChange={e => updateForm("material_lot_id", e.target.value)}
                  placeholder="material_lots.id" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>开封日期 *</label>
                <input type="date" value={form.opened_at} onChange={e => updateForm("opened_at", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>开封有效期(天) *</label>
                <input type="number" value={form.opened_shelf_life_days} onChange={e => updateForm("opened_shelf_life_days", e.target.value)}
                  placeholder="如：30" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>开封数量</label>
                <input type="number" value={form.opened_qty} onChange={e => updateForm("opened_qty", e.target.value)} placeholder="开封数量" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>领用部门</label>
                <input type="text" value={form.department} onChange={e => updateForm("department", e.target.value)} placeholder="SMT车间" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>操作员</label>
                <input type="text" value={form.operator} onChange={e => updateForm("operator", e.target.value)} placeholder="操作员姓名" style={inputStyle} />
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <PermissionGuard permission="lifecycle.edit" permissions={permissions}>
                <button type="submit" disabled={submitting}
                  style={{ padding: "8px 24px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  {submitting ? "提交中…" : "登记"}
                </button>
              </PermissionGuard>
              <button type="button" onClick={resetForm}
                style={{ padding: "8px 24px", background: "#aaa", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>重置</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>加载中…</div>
         : error ? <div style={{ padding: 40, textAlign: "center", color: "#c0392b" }}>
           <div>{error}</div>
           <button onClick={() => fetchData()} style={{ marginTop: 12, padding: "6px 20px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>重试</button>
         </div>
         : records.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>暂无开封记录</div>
         : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                  {["批次号","物料编码","物料名称","单位","开封日期","开封有效期(天)","到期日期","开封数量","原始数量","剩余数量","领用部门","操作员","状态"].map(h => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600, color: "#555" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => {
                  const cfg = getStatusConfig(locale)[r.status] ?? { color: "#fff", bg: "#888" };
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace", fontWeight: 600 }}>{r.lotNo}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.materialCode}</td>
                      <td style={{ padding: "7px 10px" }}>{r.materialNameZh}</td>
                      <td style={{ padding: "7px 10px", textAlign: "center" }}>{r.uom}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.openedAt ? r.openedAt.slice(0, 10) : "—"}</td>
                      <td style={{ padding: "7px 10px", textAlign: "center" }}>{r.openedShelfLifeDays}天</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.expiryDate ? r.expiryDate.slice(0, 10) : "—"}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.openedQty ?? "—"}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.originalQty}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600 }}>{r.remainingQty}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.department ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.operator ?? "—"}</td>
                      <td style={{ padding: "7px 10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: cfg.color, background: cfg.bg }}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
