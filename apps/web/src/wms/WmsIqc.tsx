import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ClipboardCheck, CheckCircle, XCircle, AlertTriangle, Search,
  Plus, X, Camera, Clock, FileText, ChevronDown
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface IncomingRecord {
  id: number; lot_no: string; material_code: string; material_name: string;
  supplier_code: string; supplier_name: string; received_qty: number;
  uom_code: string; received_at: string; packaging_status: string;
  msd_level: string; iqc_status: string;
}

interface IqcInspection {
  id: number; incoming_record_id: number; lot_no: string; material_code: string;
  supplier_code: string; batch_size: number; sample_size: number; aql_level: string;
  inspector_id: string; inspection_types: string[]; result: string;
  submitted_at: string; completed_at: string; defects: IqcDefect[];
}
interface IqcDefect {
  id: number; defect_type: string; defect_location: string;
  defect_count: number; severity: string; photo_url: string;
}
interface IqcAqlRule {
  id: number; material_category: string; supplier_grade: string;
  aql_critical: number; aql_major: number; aql_minor: number;
}

type View = "pending" | "submitted" | "history";

const f = (key: string, locale: Locale) => t("wms.iqc." + key, locale);

function resultBadge(r: string, locale: Locale) {
  const m: Record<string, { bg: string; text: string; icon: any }> = {
    pass:      { bg: "#d1fae5", text: "#065f46", icon: CheckCircle },
    fail:      { bg: "#fee2e2", text: "#991b1b", icon: XCircle },
    conditional_pass: { bg: "#fef3c7", text: "#92400e", icon: AlertTriangle },
    pending:   { bg: "#f3f4f6", text: "#374151", icon: Clock },
  };
  const s = m[r] || m.pending;
  const Icon = s.icon;
  const labels: Record<string, string> = {
    pass: locale === "vi-VN" ? "Dat" : locale === "en-US" ? "Pass" : "合格",
    fail: locale === "vi-VN" ? "Khong dat" : locale === "en-US" ? "Fail" : "不合格",
    conditional_pass: locale === "vi-VN" ? "Dac biet" : locale === "en-US" ? "Conditional" : "特采",
    pending: locale === "vi-VN" ? "Cho" : locale === "en-US" ? "Pending" : "待检",
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: s.bg, color: s.text, padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
      <Icon size={12} /> {labels[r] || r}
    </span>
  );
}

export function WmsIqc({ locale }: { locale: Locale }) {
  const [view, setView] = useState<View>("pending");
  const [pending, setPending] = useState<IncomingRecord[]>([]);
  const [submitted, setSubmitted] = useState<IqcInspection[]>([]);
  const [history, setHistory] = useState<IqcInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IncomingRecord | IqcInspection | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showJudgeModal, setShowJudgeModal] = useState<IqcInspection | null>(null);
  const [rules, setRules] = useState<IqcAqlRule[]>([]);
  const [defects, setDefects] = useState<IqcDefect[]>([]);
  const [submitForm, setSubmitForm] = useState({ batch_size: "", inspector_id: "", inspection_types: [] as string[] });
  const [judgeForm, setJudgeForm] = useState({ defect_type: "", defect_location: "", defect_count: "1", severity: "major", photo_url: "" });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, h, r] = await Promise.all([
        wmsApi.getIncomingRecords({ iqc_status: "pending", limit: 200 }),
        wmsApi.getIncomingRecords({ iqc_status: "submitted", limit: 200 }),
        wmsApi.getIqcInspections({ limit: 200 }),
        wmsApi.getIqcRules(),
      ]);
      setPending(p.items || []);
      setSubmitted([]); // submitted items are tracked in iqc_inspections
      setHistory(h.items || []);
      setRules(r || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const pendingCount = pending.length;
  const submittedCount = submitted.length;
  const historyCount = history.length;

  const showFeedback = (ok: boolean, msg: string) => {
    setFeedback({ ok, msg });
    setTimeout(() => setFeedback(null), 3000);
  };

  // Submit for inspection
  const handleSubmit = async () => {
    if (!selected || !submitForm.batch_size) return;
    setSaving(true);
    try {
      const rec = selected as IncomingRecord;
      await wmsApi.createIqcInspection({
        incoming_record_id: rec.id,
        lot_no: rec.lot_no,
        material_code: rec.material_code,
        supplier_code: rec.supplier_code,
        batch_size: parseInt(submitForm.batch_size),
        inspector_id: submitForm.inspector_id || "IQC_USER",
        inspection_types: submitForm.inspection_types,
      });
      setShowSubmitModal(false);
      setSelected(null);
      setSubmitForm({ batch_size: "", inspector_id: "", inspection_types: [] });
      loadAll();
      showFeedback(true, locale === "vi-VN" ? "Da gui kiem" : locale === "en-US" ? "Inspection submitted" : "已提交检验");
    } catch (e: any) {
      showFeedback(false, e?.message || "Error");
    }
    setSaving(false);
  };

  // Add defect record
  const handleAddDefect = async () => {
    if (!showJudgeModal || !judgeForm.defect_type || !judgeForm.defect_count) return;
    setSaving(true);
    try {
      await wmsApi.addIqcDefect(showJudgeModal.id, {
        defect_type: judgeForm.defect_type,
        defect_location: judgeForm.defect_location,
        defect_count: parseInt(judgeForm.defect_count),
        severity: judgeForm.severity,
        photo_url: judgeForm.photo_url,
      });
      // Reload inspection with defects
      const updated = await wmsApi.getIqcInspection(showJudgeModal.id);
      setShowJudgeModal(updated as IqcInspection);
      setJudgeForm({ defect_type: "", defect_location: "", defect_count: "1", severity: "major", photo_url: "" });
    } catch (e: any) {
      showFeedback(false, e?.message || "Error");
    }
    setSaving(false);
  };

  // Complete inspection (submit judgment)
  const handleComplete = async () => {
    if (!showJudgeModal) return;
    setSaving(true);
    try {
      await wmsApi.completeIqcInspection(showJudgeModal.id);
      setShowJudgeModal(null);
      loadAll();
      showFeedback(true, locale === "vi-VN" ? "Da hoan thanh" : locale === "en-US" ? "Judgment submitted" : "判定已提交");
    } catch (e: any) {
      showFeedback(false, e?.message || "Error");
    }
    setSaving(false);
  };

  const inspectionTypeLabels: Record<string, string> = {
    visual: locale === "vi-VN" ? "外观检验" : locale === "en-US" ? "Visual" : "外观",
    dimension: locale === "vi-VN" ? "尺寸测量" : locale === "en-US" ? "Dimension" : "尺寸",
    msd: locale === "vi-VN" ? "MSD验证" : locale === "en-US" ? "MSD" : "MSD",
    functional: locale === "vi-VN" ? "功能测试" : locale === "en-US" ? "Functional" : "功能",
  };

  return (
    <div style={{ padding: "0 24px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <ClipboardCheck size={22} style={{ color: "#3b82f6" }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {locale === "vi-VN" ? "IQC Kiem tra chat luong" : locale === "en-US" ? "IQC Quality Inspection" : "IQC 来料质量检验"}
        </h2>
        {feedback && (
          <span style={{
            marginLeft: "auto", padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: feedback.ok ? "#d1fae5" : "#fee2e2",
            color: feedback.ok ? "#065f46" : "#991b1b",
          }}>{feedback.msg}</span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: 20, gap: 0 }}>
        {([
          { key: "pending" as View, label: f("pending", locale) || "待检", count: pendingCount },
          { key: "submitted" as View, label: locale === "vi-VN" ? "Dang kiem" : locale === "en-US" ? "Inspecting" : "检验中", count: submittedCount },
          { key: "history" as View, label: locale === "vi-VN" ? "Lich su" : locale === "en-US" ? "History" : "历史", count: historyCount },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)} style={{
            padding: "8px 20px", border: "none", borderBottom: view === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
            background: "none", cursor: "pointer", fontWeight: view === tab.key ? 700 : 400, color: view === tab.key ? "#3b82f6" : "#6b7280",
            fontSize: 14, marginBottom: -2,
          }}>
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading...</div> : (
        <>
          {/* PENDING: Incoming records not yet submitted */}
          {view === "pending" && (
            <>
              {pending.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>
                  {locale === "vi-VN" ? "Khong co phieu cho" : locale === "en-US" ? "No pending items" : "无待检批次"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      {[
                        locale === "vi-VN" ? "So lo" : locale === "en-US" ? "Lot No." : "批次号",
                        locale === "vi-VN" ? "Ma vat tu" : locale === "en-US" ? "Material Code" : "物料编码",
                        locale === "vi-VN" ? "NCC" : locale === "en-US" ? "Supplier" : "供应商",
                        locale === "vi-VN" ? "SL" : locale === "en-US" ? "Qty" : "数量",
                        locale === "vi-VN" ? "Tinh trang" : locale === "en-US" ? "Status" : "包装状态",
                        locale === "vi-VN" ? "MSD" : "MSD Level",
                        locale === "vi-VN" ? "Han tao" : locale === "en-US" ? "Received" : "到货时间",
                        "",
                      ].map((h, i) => (
                        <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(r => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{r.lot_no}</td>
                        <td style={{ padding: "8px 12px" }}>{r.material_code}</td>
                        <td style={{ padding: "8px 12px", color: "#374151" }}>{r.supplier_name || r.supplier_code}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.received_qty} {r.uom_code}</td>
                        <td style={{ padding: "8px 12px" }}>
                          {r.packaging_status === "good" ? (
                            <span style={{ background: "#d1fae5", color: "#065f46", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                              {locale === "vi-VN" ? "Tot" : "完好"}
                            </span>
                          ) : r.packaging_status === "minor_damage" ? (
                            <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                              {locale === "vi-VN" ? "Hao nhe" : "轻微破损"}
                            </span>
                          ) : (
                            <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                              {locale === "vi-VN" ? "Hao nang" : "严重破损"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {r.msd_level && <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>MSD {r.msd_level}</span>}
                        </td>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{r.received_at?.slice(0, 10)}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <button onClick={() => { setSelected(r); setShowSubmitModal(true); }}
                            style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            {f("submitInspection", locale) || "送检"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* SUBMITTED: Inspections in progress */}
          {view === "submitted" && (
            <>
              {submitted.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>
                  {locale === "vi-VN" ? "Khong co phieu dang kiem" : locale === "en-US" ? "No items in inspection" : "无检验中批次"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      {[
                        locale === "vi-VN" ? "So lo" : "批次号",
                        locale === "vi-VN" ? "Ma vat tu" : "物料编码",
                        locale === "vi-VN" ? "NCC" : "供应商",
                        locale === "vi-VN" ? "Nguoi kiem" : "检验员",
                        locale === "vi-VN" ? "Mau" : "抽样数",
                        locale === "vi-VN" ? "Thoi gian" : "送检时间",
                        locale === "vi-VN" ? "Ket qua" : "结果",
                        "",
                      ].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {submitted.map(s => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{s.lot_no}</td>
                        <td style={{ padding: "8px 12px" }}>{s.material_code}</td>
                        <td style={{ padding: "8px 12px" }}>{s.supplier_code}</td>
                        <td style={{ padding: "8px 12px" }}>{s.inspector_id}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{s.sample_size}/{s.batch_size}</td>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{s.submitted_at?.slice(0, 16)}</td>
                        <td style={{ padding: "8px 12px" }}>{resultBadge(s.result, locale)}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <button onClick={() => setShowJudgeModal(s as IqcInspection)}
                            style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            {f("judge", locale) || "判定"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* HISTORY */}
          {view === "history" && (
            <>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>
                  {locale === "vi-VN" ? "Chua co lich su" : "No history"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      {[
                        locale === "vi-VN" ? "So lo" : "批次号",
                        locale === "vi-VN" ? "Ma vat tu" : "物料编码",
                        locale === "vi-VN" ? "NCC" : "供应商",
                        locale === "vi-VN" ? "Ket qua" : "判定结果",
                        locale === "vi-VN" ? "Hoan thanh" : "完成时间",
                      ].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }} onClick={() => setShowJudgeModal(h)}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{h.lot_no}</td>
                        <td style={{ padding: "8px 12px" }}>{h.material_code}</td>
                        <td style={{ padding: "8px 12px" }}>{h.supplier_code}</td>
                        <td style={{ padding: "8px 12px" }}>{resultBadge(h.result, locale)}</td>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{h.completed_at?.slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}

      {/* Submit Inspection Modal */}
      {showSubmitModal && selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { setShowSubmitModal(false); setSelected(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "90%", maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{f("submitInspection", locale) || "送检"}</h3>
              <button onClick={() => { setShowSubmitModal(false); setSelected(null); }} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            {/* Record info */}
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"So lo":(locale==="en-US")?"Lot:":"批次号"}</span> {(selected as IncomingRecord).lot_no}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"Ma VT":(locale==="en-US")?"Mat.Cd:":"物料"}</span> {(selected as IncomingRecord).material_code}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"NCC":(locale==="en-US")?"Supplier:":"供应商"}</span> {(selected as IncomingRecord).supplier_name || (selected as IncomingRecord).supplier_code}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"SL":(locale==="en-US")?"Qty:":"数量"}</span> {(selected as IncomingRecord).received_qty}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{(locale==="vi-VN")?"Kich thuoc lo *":(locale==="en-US")?"Batch Size *":"批量大小 *"}</label>
              <input type="number" value={submitForm.batch_size} onChange={e => setSubmitForm(p => ({ ...p, batch_size: e.target.value }))}
                placeholder={locale==="vi-VN"?"Nhap so luong":(locale==="en-US")?"Enter qty":"输入批量大小"}
                style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>{(locale==="vi-VN")?"Loai kiem tra":(locale==="en-US")?"Inspection Type":"检验类型"}</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["visual", "dimension", "msd", "functional"].map(tp => (
                  <label key={tp} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", border: `1px solid ${submitForm.inspection_types.includes(tp) ? "#3b82f6" : "#d1d5db"}`, borderRadius: 6, cursor: "pointer", background: submitForm.inspection_types.includes(tp) ? "#eff6ff" : "#fff", fontSize: 12 }}>
                    <input type="checkbox" checked={submitForm.inspection_types.includes(tp)}
                      onChange={e => setSubmitForm(p => ({
                        ...p, inspection_types: e.target.checked ? [...p.inspection_types, tp] : p.inspection_types.filter(x => x !== tp)
                      }))} style={{ display: "none" }} />
                    {inspectionTypeLabels[tp]}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowSubmitModal(false); setSelected(null); }}
                style={{ padding: "8px 20px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>
                {locale === "vi-VN" ? "Huy" : locale === "en-US" ? "Cancel" : "取消"}
              </button>
              <button onClick={handleSubmit} disabled={saving || !submitForm.batch_size}
                style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: saving ? "#9ca3af" : "#3b82f6", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {saving ? "..." : f("submitInspection", locale) || "送检"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Judge / Defect Entry Modal */}
      {showJudgeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowJudgeModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "90%", maxWidth: 580 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>
                {showJudgeModal.result === "pending"
                  ? (locale === "vi-VN" ? "Danh gia" : locale === "en-US" ? "Judge" : "判定")
                  : (locale === "vi-VN" ? "Chi tiet" : locale === "en-US" ? "Details" : "详情")}
              </h3>
              <button onClick={() => setShowJudgeModal(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* Inspection info */}
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"So lo":(locale==="en-US")?"Lot:":"批次号"}</span> {showJudgeModal.lot_no}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"AQL:":":AQL"}</span> {showJudgeModal.aql_level}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"Mau:":(locale==="en-US")?"Sample:":"抽样"}</span> {showJudgeModal.sample_size}/{showJudgeModal.batch_size}</div>
            </div>

            {/* AQL reference */}
            <div style={{ background: "#eff6ff", borderRadius: 6, padding: 10, marginBottom: 16, fontSize: 12, color: "#1e40af" }}>
              AQL | Critical: AC={showJudgeModal.ac_critical}/{showJudgeModal.re_critical} | Major: AC={showJudgeModal.ac_major}/{showJudgeModal.re_major} | Minor: AC={showJudgeModal.ac_minor}/{showJudgeModal.re_minor}
            </div>

            {showJudgeModal.result === "pending" && (
              <>
                {/* Add defect form */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("defectType", locale)} *</label>
                    <input value={judgeForm.defect_type} onChange={e => setJudgeForm(p => ({ ...p, defect_type: e.target.value }))}
                      placeholder={locale==="vi-VN"?"VD: Chan oxit":(locale==="en-US")?"e.g. Pin oxide":"引脚氧化"}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("defectLocation", locale)}</label>
                    <input value={judgeForm.defect_location} onChange={e => setJudgeForm(p => ({ ...p, defect_location: e.target.value }))}
                      placeholder={locale==="vi-VN"?"VD: Chan #3":(locale==="en-US")?"e.g. Pin #3":"引脚#3"}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("defectCount", locale)} *</label>
                    <input type="number" value={judgeForm.defect_count} onChange={e => setJudgeForm(p => ({ ...p, defect_count: e.target.value }))}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("severity", locale)}</label>
                    <select value={judgeForm.severity} onChange={e => setJudgeForm(p => ({ ...p, severity: e.target.value }))}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
                      <option value="critical">{f("critical", locale) || "严重"}</option>
                      <option value="major">{f("major", locale) || "主要"}</option>
                      <option value="minor">{f("minor", locale) || "次要"}</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <button onClick={handleAddDefect} disabled={saving || !judgeForm.defect_type || !judgeForm.defect_count}
                    style={{ padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13 }}>
                    + {f("addDefect", locale) || "添加不良"}
                  </button>
                </div>
              </>
            )}

            {/* Defect list */}
            {(showJudgeModal.defects || []).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{locale === "vi-VN" ? "Danh sach loi" : locale === "en-US" ? "Defects" : "不良记录"}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Type","Location","Count","Severity"].map(h => (
                        <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: "#6b7280" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(showJudgeModal.defects || []).map(d => (
                      <tr key={d.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "5px 8px" }}>{d.defect_type}</td>
                        <td style={{ padding: "5px 8px", color: "#6b7280" }}>{d.defect_location || "-"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: "#dc2626" }}>{d.defect_count}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{ color: d.severity === "critical" ? "#991b1b" : d.severity === "major" ? "#b45309" : "#374151", fontSize: 11, fontWeight: 600 }}>
                            {d.severity.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showJudgeModal.result === "pending" && (
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button onClick={() => setShowJudgeModal(null)}
                  style={{ padding: "8px 20px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>
                  {locale === "vi-VN" ? "Huy" : "Cancel"}
                </button>
                <button onClick={handleComplete} disabled={saving}
                  style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#3b82f6", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                  {saving ? "..." : f("submitJudgment", locale) || "提交判定"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
