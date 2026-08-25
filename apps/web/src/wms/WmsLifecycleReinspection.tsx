/**
 * WmsLifecycleReinspection — 超期物料复检测试报告
 * Sheet 3 from 仓库电子元器件寿命管参考
 *
 * Data: GET/POST /api/lifecycle/reinspection
 */

import { useState, useEffect, useCallback } from "react";
import { PermissionGuard } from "../PermissionGuard";
import { wmsApi } from "../api/wms";
import type { LifecycleReinspection } from "../api/wms";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface FormState {
  material_lot_id: string;
  inspected_at: string;
  overdue_days: string;
  sample_qty: string;
  test_items: string;
  test_standards: string;
  test_results: string;
  pass: string; // "true" | "false"
  disposal_advice: string;
  remarks: string;
}

const DEFAULT_FORM: FormState = {
  material_lot_id: "",
  inspected_at: new Date().toISOString().slice(0, 10),
  overdue_days: "",
  sample_qty: "",
  test_items: "",
  test_standards: "",
  test_results: "",
  pass: "",
  disposal_advice: "",
  remarks: "",
};

export function WmsLifecycleReinspection({ permissions, locale }: { permissions: string[]; locale: Locale }) {
  const [records, setRecords] = useState<LifecycleReinspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passFilter, setPassFilter] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { pass?: boolean } = {};
      if (passFilter === "true") params.pass = true;
      else if (passFilter === "false") params.pass = false;
      const records = await wmsApi.getLifecycleReinspection(Object.keys(params).length ? params : undefined);
      setRecords(records ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [passFilter, refreshKey]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const updateForm = (field: keyof FormState, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.material_lot_id || !form.test_items || !form.pass) {
      setMsg({ ok: false, text: t("wms.fillRequiredReinspection", locale) });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const body = {
        material_lot_id: Number(form.material_lot_id),
        inspected_at: form.inspected_at,
        overdue_days: form.overdue_days ? Number(form.overdue_days) : undefined,
        sample_qty: form.sample_qty ? Number(form.sample_qty) : undefined,
        test_items: form.test_items,
        test_standards: form.test_standards,
        test_results: form.test_results,
        pass: form.pass === "true",
        disposal_advice: form.disposal_advice,
        remarks: form.remarks || undefined,
      };
      const res = await wmsApi.postLifecycleReinspection(body);
      if (res.success) {
        setMsg({ ok: true, text: t("wms.reinspectionSuccess", locale) });
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

  const inputStyle = (hasError = false): React.CSSProperties => ({
    padding: "7px 10px", border: `1px solid ${hasError ? "#e74c3c" : "#ddd"}`,
    borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 0 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t("wms.reinspectionTitle", locale)}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>{t("wms.reinspectionSubtitle", locale)}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={passFilter} onChange={e => setPassFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            <option value="">{t("common.all", locale)}</option>
            <option value="true" key="pass-true">合格</option>
            <option value="false" key="pass-false">不合格</option>
          </select>
          <button onClick={() => setRefreshKey(k => k + 1)}
            style={{ padding: "6px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>刷新</button>
          <button onClick={() => { setShowForm(f => !f); setMsg(null); }}
            style={{ padding: "6px 16px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {showForm ? "关闭表单" : "+ 新增报告"}
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, borderBottom: "1px solid #eee", paddingBottom: 8 }}>
            新增复检报告
          </h3>
          {msg && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: msg.ok ? "#d4edda" : "#f8d7da", color: msg.ok ? "#155724" : "#721c24", marginBottom: 14, fontSize: 13 }}>
              {msg.text}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>物料批次ID *</label>
                <input type="number" value={form.material_lot_id} onChange={e => updateForm("material_lot_id", e.target.value)}
                  placeholder="material_lots.id" style={inputStyle(!form.material_lot_id)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>复检日期 *</label>
                <input type="date" value={form.inspected_at} onChange={e => updateForm("inspected_at", e.target.value)} style={inputStyle()} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>超期天数</label>
                <input type="number" value={form.overdue_days} onChange={e => updateForm("overdue_days", e.target.value)} placeholder="0" style={inputStyle()} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>抽检数量</label>
                <input type="number" value={form.sample_qty} onChange={e => updateForm("sample_qty", e.target.value)} placeholder="0" style={inputStyle()} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>复检项目 *</label>
                <input type="text" value={form.test_items} onChange={e => updateForm("test_items", e.target.value)}
                  placeholder="如：阻值、外观、可焊性" style={inputStyle(!form.test_items)} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>检验标准</label>
                <input type="text" value={form.test_standards} onChange={e => updateForm("test_standards", e.target.value)}
                  placeholder="如：阻值±5%，外观无氧化，可焊性良好" style={inputStyle()} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>检验结果</label>
                <input type="text" value={form.test_results} onChange={e => updateForm("test_results", e.target.value)}
                  placeholder="实际观测结果" style={inputStyle()} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>合格判定 *</label>
                <select value={form.pass} onChange={e => updateForm("pass", e.target.value)}
                  style={{ ...inputStyle(!form.pass), padding: "7px 10px" }}>
                  <option value="">— 请选择 —</option>
                  <option value="true" key="form-pass-true">合格</option>
                  <option value="false" key="form-pass-false">不合格</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>处置意见</label>
                <input type="text" value={form.disposal_advice} onChange={e => updateForm("disposal_advice", e.target.value)}
                  placeholder="如：可继续使用，有效期顺延6个月" style={inputStyle()} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "#555", fontWeight: 600, display: "block", marginBottom: 4 }}>备注</label>
                <input type="text" value={form.remarks} onChange={e => updateForm("remarks", e.target.value)} placeholder="备注信息" style={inputStyle()} />
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <PermissionGuard permission="lifecycle.edit" permissions={permissions}>
                <button type="submit" disabled={submitting}
                  style={{ padding: "8px 24px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  {submitting ? "提交中…" : "提交报告"}
                </button>
              </PermissionGuard>
              <button type="button" onClick={resetForm}
                style={{ padding: "8px 24px", background: "#aaa", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                重置
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>加载中…</div>
         : error ? <div style={{ padding: 40, textAlign: "center", color: "#c0392b" }}>
           <div>{error}</div>
           <button onClick={() => fetchRecords()} style={{ marginTop: 12, padding: "6px 20px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>重试</button>
         </div>
         : records.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>暂无复检记录</div>
         : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                  {["报告编号","批次号","物料名称","抽检数量","超期天数","复检项目","检验标准","检验结果","合格判定","处置意见","检验员","品质审核","设备审核","复检日期"].map(h => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600, color: "#555" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace", fontWeight: 600, color: "#2980b9" }}>{r.reportNo}</td>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.lotNo}</td>
                    <td style={{ padding: "7px 10px" }}>{r.materialNameZh}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.sampleQty}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: r.overdueDays > 0 ? "#c0392b" : "#27ae60" }}>{r.overdueDays}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#555" }}>{r.testItems}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#666" }}>{r.testStandards}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#666" }}>{r.testResults}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: r.pass ? "#27ae60" : "#c0392b", color: "#fff" }}>
                        {r.pass ? "合格" : "不合格"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#555" }}>{r.disposalAdvice}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.inspectorName ?? "—"}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.qualityApprover ?? "—"}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11 }}>{r.equipmentApprover ?? "—"}</td>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: 11 }}>{r.inspectedAt ? r.inspectedAt.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
