import { useState, useEffect, useCallback } from "react";
import {
  Package, Plus, X, Eye, Clock, CheckCircle, AlertTriangle, Search, RefreshCw, FileText
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface MrbReview {
  id: number;
  mrb_no: string;
  source_inspection_no: string | null;
  material_code: string;
  material_name: string | null;
  batch_no: string | null;
  quantity: string;
  unit: string;
  fail_reason: string | null;
  status: string;
  final_decision: string | null;
  final_remark: string | null;
  created_at: string;
  reviewers?: MrbReviewer[];
  dispositions?: MrbDisposition[];
}

interface MrbReviewer {
  id: number;
  reviewer_id: number;
  review_result: string | null;
  review_opinion: string | null;
  review_time: string | null;
}

interface MrbDisposition {
  id: number;
  disposition_type: string;
  other_type: string | null;
  quantity: string;
  unit: string;
  exec_status: string;
  remark: string | null;
}

interface ReviewerCandidate { id: number; username: string; displayName?: string }

export function WmsMrb({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<MrbReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [loading, setLoading] = useState(true);
  const [mrbNo, setMrbNo] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<MrbReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<ReviewerCandidate[]>([]);
  const [form, setForm] = useState({
    materialCode: "", materialName: "", batchNo: "", quantity: 0, unit: "PCS",
    failReason: "", sourceInspectionNo: "", submit: true,
  });
  const [assignIds, setAssignIds] = useState<number[]>([]);
  const [reviewResult, setReviewResult] = useState("pass");
  const [reviewOpinion, setReviewOpinion] = useState("");
  const [dispositions, setDispositions] = useState([{ disposition_type: "rework", quantity: 0, unit: "PCS" }]);
  const [planDispositions, setPlanDispositions] = useState<MrbDisposition[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wmsApi.getMrbList({
        page: page + 1, pageSize: LIMIT,
        mrbNo: mrbNo || undefined,
        materialCode: materialCode || undefined,
        status: status || undefined,
      });
      // 服务端返回 { items, total }（listEnvelope），旧客户端契约写的是 { list }，两种都收
      const payload = res as unknown as { items?: unknown[]; list?: unknown[]; total?: number };
      setRows((payload.items ?? payload.list ?? []) as unknown as MrbReview[]);
      setTotal(payload.total || 0);
    } catch { setRows([]); }
    setLoading(false);
  }, [page, mrbNo, materialCode, status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    wmsApi.getMrbReviewerCandidates()
      .then(res => setCandidates(res.items || []))
      .catch(() => setCandidates([]));
  }, []);

  const openDetail = async (id: number) => {
    try {
      const d = await wmsApi.getMrbDetail(id);
      setDetail(d as unknown as MrbReview);
      setAssignIds(((d.reviewers || []) as MrbReviewer[]).map(r => Number(r.reviewer_id)));
      const loadedDispositions = (d.dispositions || []) as MrbDisposition[];
      setPlanDispositions(loadedDispositions);
      setDispositions(
        loadedDispositions.map(x => ({
          disposition_type: x.disposition_type,
          quantity: Number(x.quantity),
          unit: x.unit,
        }))
      );
    } catch { /* ignore */ }
  };

  const refreshDetail = async (id: number) => { await openDetail(id); await load(); };

  const handleCreate = async () => {
    if (!form.materialCode || form.quantity <= 0) return;
    setSaving(true);
    try {
      await wmsApi.createMrb(form);
      setShowNew(false);
      setForm({ materialCode: "", materialName: "", batchNo: "", quantity: 0, unit: "PCS", failReason: "", sourceInspectionNo: "", submit: true });
      await load();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  // 处置执行：退回客户确认提走 / 报废销毁（货须已在不良品仓，否则后端 409）
  const runDisposition = async (id: number, kind: "out" | "destroy") => {
    if (!detail) return;
    setSaving(true);
    try {
      if (kind === "out") await wmsApi.confirmMrbOut(id);
      else await wmsApi.destroyMrbScrap(id);
      await refreshDetail(detail.id);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleAction = async (path: string, payload: Record<string, unknown>) => {
    if (!detail) return;
    setSaving(true);
    try {
      if (path === "assign") await wmsApi.assignMrbReviewers({ mrbId: detail.id, reviewers: assignIds });
      else if (path === "submitReview") await wmsApi.submitMrbReview({ mrbId: detail.id, result: reviewResult, reviewOpinion });
      else if (path === "preApprove") await wmsApi.preApproveMrb({ mrbId: detail.id, result: "pass" });
      else if (path === "finalApprove") await wmsApi.finalApproveMrb({ mrbId: detail.id, finalResult: "rework", dispositions });
      else if (path === "reject") await wmsApi.rejectMrb({ mrbId: detail.id, reason: reviewOpinion || "rejected" });
      else if (path === "cancel") await wmsApi.cancelMrb({ mrbId: detail.id, reason: reviewOpinion || "cancelled" });
      else if (path === "submit") await wmsApi.submitMrb(detail.id);
      await refreshDetail(detail.id);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const statusColor = (s: string) =>
    s === "approved" ? "var(--ok)" :
    s === "rejected" || s === "cancelled" ? "var(--danger)" :
    s === "pending_final" || s === "pending_approval" ? "var(--warn)" : "var(--info)";

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.mrb", locale)}</h2>
            <p>{t("wms.mrb.title", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input className="input" style={{ padding: "4px 10px", width: 150 }} placeholder={t("wms.mrb.mrbNo", locale)} value={mrbNo} onChange={e => setMrbNo(e.target.value)} />
            <input className="input" style={{ padding: "4px 10px", width: 150 }} placeholder={t("wms.mrb.materialCode", locale)} value={materialCode} onChange={e => setMaterialCode(e.target.value)} />
            <select className="input" style={{ padding: "4px 10px", width: 130 }} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">{t("common.all", locale)}</option>
              {["draft", "pending_review", "reviewing", "pending_approval", "pending_final", "approved", "rejected", "cancelled"].map(s => (
                <option key={s} value={s}>{t(`wms.mrb.status.${s}`, locale)}</option>
              ))}
            </select>
            <button className="action-button" type="button" onClick={load}><Search size={14} /> {t("common.search", locale)}</button>
            <button className="action-button" type="button" style={{ background: "var(--info)" }} onClick={() => setShowNew(true)}>
              <Plus size={14} /> {t("wms.mrb.new", locale)}
            </button>
          </div>
        </div>
      </section>

      {showNew && (
        <section className="surface-panel">
          <div className="section-header"><div><h3>{t("wms.mrb.new", locale)}</h3></div></div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input className="input" style={{ padding: "4px 10px", width: 150 }} placeholder={t("wms.mrb.materialCode", locale)} value={form.materialCode} onChange={e => setForm(p => ({ ...p, materialCode: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 150 }} placeholder={t("wms.mrb.materialName", locale)} value={form.materialName} onChange={e => setForm(p => ({ ...p, materialName: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 130 }} placeholder={t("wms.mrb.batchNo", locale)} value={form.batchNo} onChange={e => setForm(p => ({ ...p, batchNo: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 100 }} type="number" placeholder={t("wms.mrb.quantity", locale)} value={form.quantity || ""} onChange={e => setForm(p => ({ ...p, quantity: Number(e.target.value) || 0 }))} />
            <input className="input" style={{ padding: "4px 10px", width: 80 }} placeholder={t("common.unit", locale)} value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 160 }} placeholder={t("wms.mrb.sourceInspectionNo", locale)} value={form.sourceInspectionNo} onChange={e => setForm(p => ({ ...p, sourceInspectionNo: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 200 }} placeholder={t("wms.mrb.failReason", locale)} value={form.failReason} onChange={e => setForm(p => ({ ...p, failReason: e.target.value }))} />
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={form.submit} onChange={e => setForm(p => ({ ...p, submit: e.target.checked }))} /> {t("common.submit", locale)}
            </label>
            <button className="action-button" type="button" style={{ background: "var(--ok)" }} onClick={handleCreate} disabled={saving}>
              {saving ? <Clock size={14} /> : <CheckCircle size={14} />}{t("common.submit", locale)}
            </button>
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.mrb.list", locale)} ({total})</h3></div></div>
        {loading && <p style={{ textAlign: "center", padding: 40 }}>{t("common.loading", locale)}</p>}
        {!loading && rows.length === 0 && <p style={{ textAlign: "center", padding: 40 }}>{t("common.noData", locale)}</p>}
        {!loading && rows.length > 0 && (
          <div className="table-shell">
            <table>
              <thead><tr>
                <th>{t("wms.mrb.mrbNo", locale)}</th>
                <th>{t("wms.mrb.materialCode", locale)}</th>
                <th>{t("wms.mrb.materialName", locale)}</th>
                <th>{t("wms.mrb.batchNo", locale)}</th>
                <th>{t("wms.mrb.quantity", locale)}</th>
                <th>{t("wms.mrb.status", locale)}</th>
                <th>{t("wms.mrb.finalDecision", locale)}</th>
                <th>{t("wms.mrb.createdAt", locale)}</th>
                <th>{t("common.actions", locale)}</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td><code style={{ fontSize: 11 }}>{r.mrb_no}</code></td>
                    <td><code style={{ fontSize: 11 }}>{r.material_code}</code></td>
                    <td>{r.material_name || "—"}</td>
                    <td>{r.batch_no || "—"}</td>
                    <td>{Number(r.quantity).toLocaleString()} {r.unit}</td>
                    <td><span className="badge" style={{ background: statusColor(r.status), color: "#fff" }}>{t(`wms.mrb.status.${r.status}`, locale)}</span></td>
                    <td>{r.final_decision || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{String(r.created_at || "").slice(0, 10)}</td>
                    <td>
                      <button className="action-button" type="button" style={{ background: "var(--info)", width: 30, height: 30, padding: 0 }} onClick={() => openDetail(Number(r.id))}>
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="action-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("common.prev", locale)}</button>
              <span>{t("common.page", locale)} {page + 1}</span>
              <button className="action-button" type="button" disabled={rows.length < LIMIT} onClick={() => setPage(page + 1)}>{t("common.next", locale)}</button>
            </div>
          </div>
        )}
      </section>

      {detail && (
        <section className="surface-panel">
          <div className="section-header">
            <div><h3>{t("wms.mrb.detail", locale)} — <code>{detail.mrb_no}</code></h3></div>
            <button className="action-button" type="button" style={{ background: "var(--danger)" }} onClick={() => setDetail(null)}><X size={14} /> {t("common.close", locale)}</button>
          </div>
          <div className="toolbar" style={{ gap: 20, flexWrap: "wrap" }}>
            <div><div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.mrb.materialCode", locale)}</div><div>{detail.material_code}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.mrb.quantity", locale)}</div><div>{Number(detail.quantity).toLocaleString()} {detail.unit}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.mrb.status", locale)}</div><span className="badge" style={{ background: statusColor(detail.status), color: "#fff" }}>{t(`wms.mrb.status.${detail.status}`, locale)}</span></div>
            <div><div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.mrb.failReason", locale)}</div><div>{detail.fail_reason || "—"}</div></div>
          </div>

          <div className="table-shell" style={{ marginTop: 14 }}>
            <table><thead><tr><th>{t("wms.mrb.reviewers", locale)}</th><th>{t("wms.mrb.reviewResult", locale)}</th><th>{t("wms.mrb.reviewOpinion", locale)}</th></tr></thead>
              <tbody>
                {(detail.reviewers || []).map(r => (
                  <tr key={r.id}><td>{r.reviewer_id}</td><td>{r.review_result || "—"}</td><td>{r.review_opinion || "—"}</td></tr>
                ))}
                {(!detail.reviewers || detail.reviewers.length === 0) && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)" }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="toolbar" style={{ marginTop: 14, gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{t("wms.mrb.assignReviewers", locale)}</div>
              <select className="input" multiple style={{ width: 220, minHeight: 70 }} value={assignIds.map(String)} onChange={e => setAssignIds(Array.from(e.target.selectedOptions).map(o => Number(o.value)))}>
                {candidates.map(c => <option key={c.id} value={c.id}>{c.displayName || c.username}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{t("wms.mrb.reviewResult", locale)}</div>
              <select className="input" style={{ padding: 4 }} value={reviewResult} onChange={e => setReviewResult(e.target.value)}>
                {["pass", "rework", "return", "scrap"].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <input className="input" style={{ padding: "4px 8px", width: 180, marginTop: 6 }} placeholder={t("wms.mrb.reviewOpinion", locale)} value={reviewOpinion} onChange={e => setReviewOpinion(e.target.value)} />
            </div>
            <div style={{ minWidth: 260 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{t("wms.mrb.dispositions", locale)}</div>
              {dispositions.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <select className="input" style={{ padding: 4, width: 100 }} value={d.disposition_type} onChange={e => setDispositions(prev => prev.map((x, j) => j === i ? { ...x, disposition_type: e.target.value } : x))}>
                    {["rework", "return", "scrap", "reject"].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <input className="input" style={{ padding: 4, width: 80 }} type="number" value={d.quantity || ""} onChange={e => setDispositions(prev => prev.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x))} />
                  <button className="action-button" type="button" onClick={() => setDispositions(prev => [...prev, { disposition_type: "rework", quantity: 0, unit: "PCS" }])}><Plus size={12} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="table-shell" style={{ marginTop: 14 }}>
            <table><thead><tr><th>{t("wms.mrb.dispositions", locale)}</th><th>{t("wms.mrb.quantity", locale)}</th><th>{t("wms.mrb.status", locale)}</th><th /></tr></thead>
              <tbody>
                {planDispositions.map(d => (
                  <tr key={d.id}>
                    <td>{d.disposition_type}{d.other_type ? ` / ${d.other_type}` : ""}</td>
                    <td>{Number(d.quantity).toLocaleString()} {d.unit}</td>
                    <td>{d.exec_status}</td>
                    <td style={{ textAlign: "right" }}>
                      {d.exec_status === "pending" && d.disposition_type === "other" && d.other_type === "customer_return" && (
                        <button className="action-button" type="button" disabled={saving} onClick={() => runDisposition(d.id, "out")}>{t("wms.mrb.confirmOut", locale)}</button>
                      )}
                      {d.exec_status === "pending" && d.disposition_type === "scrap" && (
                        <button className="action-button" type="button" style={{ background: "var(--danger)" }} disabled={saving} onClick={() => runDisposition(d.id, "destroy")}>{t("wms.mrb.destroy", locale)}</button>
                      )}
                    </td>
                  </tr>
                ))}
                {planDispositions.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="toolbar" style={{ marginTop: 16, justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            {detail.status === "draft" && <button className="action-button" type="button" style={{ background: "var(--info)" }} disabled={saving} onClick={() => handleAction("submit", {})}><FileText size={14} /> {t("common.submit", locale)}</button>}
            <button className="action-button" type="button" style={{ background: "var(--info)" }} disabled={saving} onClick={() => handleAction("assign", {})}>{t("wms.mrb.assignReviewers", locale)}</button>
            <button className="action-button" type="button" style={{ background: "var(--info)" }} disabled={saving} onClick={() => handleAction("submitReview", {})}>{t("wms.mrb.submitReview", locale)}</button>
            <button className="action-button" type="button" style={{ background: "var(--info)" }} disabled={saving} onClick={() => handleAction("preApprove", {})}>{t("wms.mrb.preApprove", locale)}</button>
            <button className="action-button" type="button" style={{ background: "var(--ok)" }} disabled={saving} onClick={() => handleAction("finalApprove", {})}>{t("wms.mrb.finalApprove", locale)}</button>
            <button className="action-button" type="button" style={{ background: "var(--warn)" }} disabled={saving} onClick={() => handleAction("reject", {})}>{t("wms.mrb.reject", locale)}</button>
            <button className="action-button" type="button" style={{ background: "var(--danger)" }} disabled={saving} onClick={() => handleAction("cancel", {})}>{t("wms.mrb.cancel", locale)}</button>
          </div>
        </section>
      )}
    </div>
  );
}
