/**
 * WmsLifecycleScrapping — 过期物料隔离报废申请单
 * Sheet 5 from 仓库电子元器件寿命管参考
 *
 * Data: GET/POST/PATCH /api/lifecycle/scrapping
 */

import { useState, useEffect, useCallback } from "react";
import { PermissionGuard } from "../PermissionGuard";
import { wmsApi } from "../api/wms";
import type { LifecycleScrapping } from "../api/wms";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface FormState {
  material_lot_id: string;
  department: string;
  scrap_qty: string;
  unit: string;
  overdue_days: string;
  scrap_reason: string;
  isolation_status: string;
  disposal_method: string;
}

function getDefaultForm(locale: Locale): FormState {
  return {
    material_lot_id: "",
    department: t("wms.departmentWarehouse", locale),
    scrap_qty: "",
    unit: "PCS",
    overdue_days: "",
    scrap_reason: "",
    isolation_status: t("wms.isolated", locale),
    disposal_method: "",
  };
}

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  "PENDING":   { color: "#fff", bg: "#f39c12" },
  "APPROVED":  { color: "#fff", bg: "#27ae60" },
  "REJECTED":  { color: "#fff", bg: "#c0392b" },
};

function getDisposalMethods(locale: Locale): string[] {
  return [t("wms.disposalDestruction", locale), t("wms.disposalResell", locale), t("wms.disposalReturnSupplier", locale)];
}
function getIsolationStatuses(locale: Locale): string[] {
  return [t("wms.isolated", locale), t("wms.pendingIsolation", locale)];
}

export function WmsLifecycleScrapping({ permissions, locale }: { permissions: string[]; locale: Locale }) {
  const [records, setRecords] = useState<LifecycleScrapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(getDefaultForm(locale));
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter ? { status: statusFilter } : undefined;
      const records = await wmsApi.getLifecycleScrapping(params);
      setRecords(records ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateForm = (field: keyof FormState, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const resetForm = () => {
    setForm(getDefaultForm(locale));
    setMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.material_lot_id || !form.scrap_qty || !form.scrap_reason || !form.disposal_method) {
      setMsg({ ok: false, text: t("wms.fillRequiredScrapping", locale) });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const body = {
        material_lot_id: Number(form.material_lot_id),
        department: form.department,
        scrap_qty: Number(form.scrap_qty),
        unit: form.unit,
        overdue_days: form.overdue_days ? Number(form.overdue_days) : undefined,
        scrap_reason: form.scrap_reason,
        isolation_status: form.isolation_status,
        disposal_method: form.disposal_method,
      };
      const res = await wmsApi.postLifecycleScrapping(body);
      if (res.success) {
        setMsg({ ok: true, text: t("wms.scrappingSuccess", locale) });
        resetForm();
        setShowForm(false);
        setRefreshKey(k => k + 1);
      } else {
        setMsg({ ok: false, text: "提交失败" });
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (id: number | string) => {
    try {
      await wmsApi.patchLifecycleScrapping(id, { status: "APPROVED" });
      setRefreshKey(k => k + 1);
    } catch (e) {
      alert("审批失败: " + String(e));
    }
  };

  const reject = async (id: number | string) => {
    try {
      await wmsApi.patchLifecycleScrapping(id, { status: "REJECTED" });
      setRefreshKey(k => k + 1);
    } catch (e) {
      alert("驳回失败: " + String(e));
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 0 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>过期物料隔离报废申请单</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>Sheet 5 · 报废申请与审批</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            <option value="">全部状态</option>
            <option value="PENDING" key="status-PENDING">待审批</option>
            <option value="APPROVED" key="status-APPROVED">已批准</option>
            <option value="REJECTED" key="status-REJECTED">已驳回</option>
          </select>
          <button onClick={() => setRefreshKey(k => k + 1)}
            style={{ padding: "6px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>刷新</button>
          <button onClick={() => { setShowForm(f => !f); setMsg(null); }}
            style={{ padding: "6px 16px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {showForm ? "关闭表单" : "+ 新增申请"}
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, borderBottom: "1px solid #eee", paddingBottom: 8 }}>
            新增报废申请
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
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>申请部门</label>
                <input type="text" value={form.department} onChange={e => updateForm("department", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>报废数量 *</label>
                <input type="number" value={form.scrap_qty} onChange={e => updateForm("scrap_qty", e.target.value)} placeholder="0" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>单位</label>
                <input type="text" value={form.unit} onChange={e => updateForm("unit", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>超期天数</label>
                <input type="number" value={form.overdue_days} onChange={e => updateForm("overdue_days", e.target.value)} placeholder="0" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>隔离状态</label>
                <select value={form.isolation_status} onChange={e => updateForm("isolation_status", e.target.value)} style={{ ...inputStyle, padding: "7px 10px" }}>
                  {getIsolationStatuses(locale).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>报废原因 *</label>
                <input type="text" value={form.scrap_reason} onChange={e => updateForm("scrap_reason", e.target.value)}
                  placeholder="如：超期复检不合格，反向漏电超标" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>处置方式 *</label>
                <select value={form.disposal_method} onChange={e => updateForm("disposal_method", e.target.value)}
                  style={{ ...inputStyle, padding: "7px 10px" }}>
                  <option value="">— 请选择 —</option>
                  {getDisposalMethods(locale).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <PermissionGuard permission="lifecycle.edit" permissions={permissions}>
                <button type="submit" disabled={submitting}
                  style={{ padding: "8px 24px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  {submitting ? "提交中…" : "提交申请"}
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
         : records.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>暂无报废申请</div>
         : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                  {["申请单号","批次号","物料名称","报废数量","单位","超期天数","报废原因","隔离状态","处置方式","申请人","仓库审核","品质审核","状态","操作"].map(h => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600, color: "#555" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => {
                  const st = STATUS_STYLE[r.status] ?? { color: "#fff", bg: "#888" };
                  const statusLabel = r.status === "PENDING" ? "待审批" : r.status === "APPROVED" ? "已批准" : r.status === "REJECTED" ? "已驳回" : r.status;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace", fontWeight: 600, color: "#2980b9" }}>{r.requestNo}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.lotNo}</td>
                      <td style={{ padding: "7px 10px" }}>{r.materialNameZh}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600 }}>{r.scrapQty}</td>
                      <td style={{ padding: "7px 10px", textAlign: "center" }}>{r.uom}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", color: (r.overdueDays ?? 0) > 0 ? "#c0392b" : "#27ae60" }}>{r.overdueDays ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11, color: "#555" }}>{r.scrapReason}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.isolationStatus}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.disposalMethod}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.applicantName ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.warehouseApprover ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.qualityApprover ?? "—"}</td>
                      <td style={{ padding: "7px 10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: st.color, background: st.bg }}>
                          {statusLabel}
                        </span>
                      </td>
                      <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                        {r.status === "PENDING" && (
                          <PermissionGuard permission="lifecycle.approve" permissions={permissions}>
                            <>
                              <button onClick={() => approve(r.id)}
                                style={{ padding: "3px 10px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11, marginRight: 4 }}>
                                批准
                              </button>
                              <button onClick={() => reject(r.id)}
                                style={{ padding: "3px 10px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>
                                驳回
                              </button>
                            </>
                          </PermissionGuard>
                        )}
                        {r.status !== "PENDING" && <span style={{ color: "#aaa", fontSize: 11 }}>—</span>}
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
