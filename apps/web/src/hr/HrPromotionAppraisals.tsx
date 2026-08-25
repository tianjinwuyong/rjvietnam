import { useEffect, useState } from "react";
import { hrApi, type PerformanceReview } from "../api";
import type { Locale } from "../../../../packages/shared-types/src/factory";

export function HrPromotionAppraisals({ locale }: { locale: Locale }) {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [levels, setLevels] = useState<Record<number, number>>({});
  const [gates, setGates] = useState<Record<number, any[]>>({});
  const [evidence, setEvidence] = useState<Record<number, string>>({});

  const labels = locale === "zh-CN"
    ? { title: "晋升评估档案", intro: "线长提交的绩效评估，供 HR 归档和晋升评审。确认归档不等于批准晋升。", document: "确认归档", employee: "员工", period: "周期", score: "得分", rating: "等级", comment: "主管评语" }
    : locale === "vi-VN"
      ? { title: "Hồ sơ đánh giá thăng chức", intro: "Đánh giá hiệu suất do trưởng chuyền gửi để HR lưu hồ sơ và xem xét thăng chức. Xác nhận lưu hồ sơ không có nghĩa là phê duyệt thăng chức.", document: "Xác nhận lưu hồ sơ", employee: "Nhân viên", period: "Kỳ", score: "Điểm", rating: "Xếp loại", comment: "Nhận xét quản lý" }
      : { title: "Promotion Appraisal Documentation", intro: "Performance evaluations submitted by line managers for HR documentation and promotion review. Documenting an appraisal does not approve a promotion.", document: "Document review", employee: "Employee", period: "Period", score: "Score", rating: "Rating", comment: "Manager comment" };

  async function load() {
    setLoading(true); setError("");
    try {
      const [submitted, documented] = await Promise.all([
        hrApi.getPerformanceReviews({ status: "submitted" }),
        hrApi.getPerformanceReviews({ status: "confirmed" }),
      ]);
      setReviews([...(submitted.items || []), ...(documented.items || [])]);
    }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load submitted appraisals"); }
    finally { setLoading(false); }
  }

  async function loadGates(reviewId: number) {
    try {
      const result = await hrApi.getPromotionAppraisalGates(reviewId);
      setGates({ ...gates, [reviewId]: result.items || [] });
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load promotion gates"); }
  }

  async function updateGate(reviewId: number, gate: any, status: "passed" | "failed" | "waived") {
    try {
      await hrApi.updatePromotionAppraisalGate(reviewId, gate.id, { status, evidence_note: evidence[gate.id] || "" });
      setNotice("Promotion gate updated");
      await loadGates(reviewId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to update promotion gate"); }
  }
  useEffect(() => { load(); }, []);

  async function documentReview(review: PerformanceReview) {
    if (!window.confirm("Document this appraisal for HR promotion review?")) return;
    setError(""); setNotice("");
    try {
      await hrApi.updatePerformanceReview(review.id, { status: "confirmed", promotion_recommendation_level: levels[review.id] || review.promotion_recommendation_level || 1 });
      setNotice("Appraisal documented for HR review");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to document appraisal"); }
  }

  return <section className="surface-panel" style={{ padding: 18 }}>
    <h2 style={{ margin: 0 }}>{labels.title}</h2>
    <p style={{ color: "#94a3b8", margin: "6px 0 16px" }}>{labels.intro}</p>
    <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 14, marginBottom: 16, background: "#111827" }}>
      <strong>Growth ladder and promotion factors</strong>
      <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 7, display: "grid", gap: 4 }}>
        <span>Level 1: attendance review and basic skills test.</span>
        <span>Level 2: role skills test and quality/process audit.</span>
        <span>Level 3: advanced skills, teamwork/leadership, and quality audit.</span>
        <span><strong style={{ color: "#fbbf24" }}>Level 4 — highest:</strong> sustained high performance, senior skills test, leadership panel, cross-functional compliance audit, and HR promotion audit.</span>
      </div>
      <p style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0" }}>Daily factors use 1–10 scores for attendance, cooperation, and skill level. All required gates must pass before HR can treat a Level 4 appraisal as complete.</p>
    </div>
    {error && <div style={{ background: "#7f1d1d", color: "#fecaca", padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
    {notice && <div style={{ background: "#14532d", color: "#bbf7d0", padding: 10, borderRadius: 8, marginBottom: 12 }}>{notice}</div>}
    {loading ? <p style={{ color: "#94a3b8" }}>Loading…</p> : <table className="data-table">
      <thead><tr><th>{labels.employee}</th><th>{labels.period}</th><th>{labels.score}</th><th>{labels.rating}</th><th>Growth level</th><th>{labels.comment}</th><th>Action</th></tr></thead>
      <tbody>
        {reviews.map((review) => <tr key={review.id}>
          <td>{review.name_zh} <span style={{ color: "#94a3b8" }}>({review.employee_no})</span></td>
          <td>{review.period_type} · {review.period_value}</td><td>{review.total_score?.toFixed(1)}</td><td>{review.rating}</td><td><select className="field-input" value={levels[review.id] || review.promotion_recommendation_level || 1} onChange={(event) => setLevels({ ...levels, [review.id]: Number(event.target.value) })}><option value={1}>Level 1</option><option value={2}>Level 2</option><option value={3}>Level 3</option><option value={4}>Level 4 — Highest</option></select></td><td>{review.overall_comment || "—"}</td>
          <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {review.status === "submitted" && <button className="btn-primary" onClick={() => documentReview(review)}>{labels.document}</button>}
            {review.status === "confirmed" && <button className="btn-ghost" onClick={() => loadGates(review.id)}>Tests & audits</button>}
          </td>
        </tr>)}
        {!reviews.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "#94a3b8" }}>No submitted appraisals.</td></tr>}
      </tbody>
    </table>}
    {Object.entries(gates).map(([reviewId, gateRows]) => <div key={reviewId} style={{ marginTop: 16, borderTop: "1px solid #334155", paddingTop: 14 }}>
      <h3 style={{ margin: "0 0 10px" }}>Required tests & audits — appraisal #{reviewId}</h3>
      <table className="data-table"><thead><tr><th>Type</th><th>Requirement</th><th>Status</th><th>Evidence / notes</th><th>Record</th></tr></thead><tbody>
        {gateRows.map((gate: any) => <tr key={gate.id}>
          <td>{gate.gate_type}</td><td>{gate.gate_name}</td><td>{gate.status}</td>
          <td><input className="field-input" value={evidence[gate.id] ?? gate.evidence_note ?? ""} onChange={(event) => setEvidence({ ...evidence, [gate.id]: event.target.value })} /></td>
          <td><div style={{ display: "flex", gap: 4 }}><button className="btn-primary" onClick={() => updateGate(Number(reviewId), gate, "passed")}>Pass</button><button className="btn-ghost" onClick={() => updateGate(Number(reviewId), gate, "failed")}>Fail</button></div></td>
        </tr>)}
      </tbody></table>
    </div>)}
  </section>;
}
