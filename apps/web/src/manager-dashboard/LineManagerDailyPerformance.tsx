import { useEffect, useMemo, useState } from "react";
import { hrApi, type AttendanceRecord, type Employee, type PerformanceReview, type PerformanceReviewItem } from "../api";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const DIMENSIONS = [
  { key: "attendance", en: "Attendance", weight: 34 },
  { key: "cooperation", en: "Cooperation", weight: 33 },
  { key: "skillLevel", en: "Skill level", weight: 33 },
];

function ratingFor(score: number) { return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : "F"; }

function attendanceScore(record: AttendanceRecord) {
  switch (record.status) {
    case "normal": return 10;
    case "late": return 7;
    case "early": return 6;
    case "leave":
    case "holiday": return 8;
    case "ot": return 10;
    case "absent": return 1;
    default: return 5;
  }
}

export function LineManagerDailyPerformance({ locale }: { locale: Locale }) {
  const today = new Date().toISOString().slice(0, 10);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [employeeId, setEmployeeId] = useState(0);
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({ attendance: 10, cooperation: 10, skillLevel: 10 });
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const [employeeResult, reviewResult] = await Promise.all([
        hrApi.getEmployees({ limit: 500 }),
        hrApi.getPerformanceReviews({ period_type: "daily", period_value: today }),
      ]);
      setEmployees(employeeResult.items || []);
      setReviews(reviewResult.items || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load daily performance data"); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!employeeId) { setAttendance(null); return; }
    let cancelled = false;
    setLoadingAttendance(true);
    hrApi.getAttendance({ date: today, employeeId, limit: 1 })
      .then((result) => {
        if (cancelled) return;
        const record = result.items?.[0] || null;
        setAttendance(record);
        if (record) setScores((current) => ({ ...current, attendance: attendanceScore(record) }));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load HR attendance"); })
      .finally(() => { if (!cancelled) setLoadingAttendance(false); });
    return () => { cancelled = true; };
  }, [employeeId, today]);

  const scoreOutOfTen = useMemo(() => DIMENSIONS.reduce((total, dimension) => total + (scores[dimension.key] || 0) * dimension.weight / 100, 0), [scores]);
  const score = scoreOutOfTen * 10;
  const selectedReview = reviews.find((review) => review.employee_id === employeeId);
  const labels = locale === "vi-VN"
    ? { title: "Danh gia hieu suat hang ngay", employee: "Nhan vien", score: "Diem tong", submit: "Xac nhan danh gia", comment: "Nhan xet quan ly", existing: "Da danh gia hom nay", confirm: "Luu danh gia hieu suat hang ngay nay?" }
    : locale === "zh-CN"
      ? { title: "Daily Management Performance Evaluation", employee: "Employee", score: "Overall score", submit: "Confirm evaluation", comment: "Manager comment", existing: "Already evaluated today", confirm: "Save this daily performance evaluation?" }
      : { title: "Daily Management Performance Evaluation", employee: "Employee", score: "Overall score", submit: "Confirm evaluation", comment: "Manager comment", existing: "Already evaluated today", confirm: "Save this daily performance evaluation?" };

  async function save() {
    if (!employeeId) { setError("Select an employee"); return; }
    if (!attendance) { setError("HR attendance record is required before a daily performance evaluation can be saved"); return; }
    if (!window.confirm(labels.confirm)) return;
    setSaving(true); setError(""); setNotice("");
    const items: PerformanceReviewItem[] = DIMENSIONS.map((dimension) => ({
      kpi_name_zh: dimension.en, kpi_name_en: dimension.en, kpi_name_vi: dimension.en,
      target: 10, actual: scores[dimension.key] || 0, unit: "score (1-10)", weight: dimension.weight,
      score: (scores[dimension.key] || 0) * 10, comment,
    }));
    try {
      if (selectedReview) {
        await hrApi.updatePerformanceReview(selectedReview.id, { total_score: score, rating: ratingFor(score), status: "draft", overall_comment: comment, items });
      } else {
        await hrApi.createPerformanceReview({ employee_id: employeeId, period_type: "daily", period_value: today, review_date: today, items });
      }
      setNotice("Daily evaluation saved");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save daily evaluation"); }
    finally { setSaving(false); }
  }

  async function sendToHr() {
    if (!selectedReview) return;
    if (!window.confirm("Submit this evaluation to HR for promotion-appraisal documentation?")) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await hrApi.updatePerformanceReview(selectedReview.id, { status: "submitted" });
      setNotice("Evaluation sent to HR for appraisal documentation");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to submit evaluation to HR"); }
    finally { setSaving(false); }
  }

  return <section className="surface-panel" style={{ padding: 18 }}>
    <h3 style={{ margin: "0 0 5px" }}>{labels.title}</h3>
    <p style={{ color: "#94a3b8", margin: "0 0 16px" }}>{today} · Attendance is read-only from HR Attendance Management. Managers score cooperation and skill level from 1 to 10.</p>
    {error && <div style={{ color: "#fecaca", background: "#7f1d1d", padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
    {notice && <div style={{ color: "#bbf7d0", background: "#14532d", padding: 10, borderRadius: 8, marginBottom: 12 }}>{notice}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(230px, 35%) 1fr", gap: 18 }}>
      <div>
        <label>{labels.employee}</label>
        <select className="field-input" value={employeeId} onChange={(event) => { const id = Number(event.target.value); setEmployeeId(id); const current = reviews.find((review) => review.employee_id === id); setComment(current?.overall_comment || ""); }} style={{ width: "100%", marginTop: 6 }}>
          <option value={0}>Select employee</option>
          {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name_zh || employee.displayName} ({employee.code})</option>)}
        </select>
        {employeeId && <p style={{ color: attendance ? "#86efac" : "#fbbf24", fontSize: 12, marginBottom: 0 }}>
          {loadingAttendance ? "Loading attendance from HR Attendance Management..." : attendance
            ? `HR Attendance Management: ${attendance.status} (${attendance.clockIn || "--"} - ${attendance.clockOut || "--"}) → ${attendanceScore(attendance)}/10`
            : "No HR attendance record for this employee and date. Evaluation cannot be saved."}
        </p>}
        {selectedReview && <p style={{ color: "#fbbf24", fontSize: 12 }}>{labels.existing}: {selectedReview.total_score?.toFixed(1)} / {selectedReview.rating}</p>}
      </div>
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          {DIMENSIONS.map((dimension) => <label key={dimension.key} style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#111827" }}>
            <span style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>{dimension.en}</span>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>{dimension.weight}% weight · 1–10</span>
            <input className="field-input" type="number" min="1" max="10" step="1" value={scores[dimension.key] ?? 1} disabled={dimension.key === "attendance"} onChange={(event) => setScores({ ...scores, [dimension.key]: Math.max(1, Math.min(10, Number(event.target.value))) })} style={{ width: "100%", marginTop: 8 }} />
            {dimension.key === "attendance" && <span style={{ display: "block", color: "#94a3b8", fontSize: 11, marginTop: 6 }}>Read-only: calculated from HR Attendance Management.</span>}
          </label>)}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <strong>{labels.score}: <span style={{ color: score >= 75 ? "#4ade80" : score >= 60 ? "#fbbf24" : "#f87171" }}>{scoreOutOfTen.toFixed(1)} / 10 ({ratingFor(score)})</span></strong>
          <button className="btn-primary" onClick={save} disabled={saving || !attendance}>{saving ? "Saving..." : labels.submit}</button>
          {selectedReview && selectedReview.status !== "submitted" && selectedReview.status !== "confirmed" && <button className="btn-ghost" onClick={sendToHr} disabled={saving}>Send to HR</button>}
        </div>
        <label style={{ display: "block", marginTop: 14 }}>{labels.comment}<textarea className="field-input" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} style={{ width: "100%", marginTop: 6 }} /></label>
      </div>
    </div>
  </section>;
}
