import { useEffect, useMemo, useState } from "react";
import { hrApi, type TrainingRecord } from "../api";
import type { Locale } from "../../../../packages/shared-types/src/factory";

function scoreState(score: number | null) {
  if (score === null) return { label: "Not assessed", color: "#94a3b8" };
  if (score >= 80) return { label: "Meets target", color: "#22c55e" };
  if (score >= 60) return { label: "Needs follow-up", color: "#f59e0b" };
  return { label: "Needs retraining", color: "#ef4444" };
}

export function TrainingEvaluations({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    hrApi.getTrainingRecords({})
      .then((result) => { if (active) setRecords(result?.data || []); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Unable to load training evaluations"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const summary = useMemo(() => {
    const assessed = records.filter((record) => record.assessment_score !== null);
    const passed = records.filter((record) => record.status === "passed").length;
    const needsFollowUp = assessed.filter((record) => (record.assessment_score ?? 0) < 80).length;
    const average = assessed.length ? assessed.reduce((total, record) => total + (record.assessment_score ?? 0), 0) / assessed.length : null;
    return { assessed: assessed.length, passed, needsFollowUp, average };
  }, [records]);

  const labels = locale === "zh-CN"
    ? { title: "培训评估", intro: "只读评估概览。请使用培训记录或考试页面进行已授权的更新。", assessed: "已评估记录", passed: "通过培训", followUp: "需要跟进", average: "平均成绩" }
    : locale === "vi-VN"
      ? { title: "Đánh giá đào tạo", intro: "Tổng quan đánh giá chỉ đọc. Sử dụng Hồ sơ đào tạo hoặc Kỳ thi để cập nhật khi được ủy quyền.", assessed: "Hồ sơ đã đánh giá", passed: "Đã hoàn thành", followUp: "Cần theo dõi", average: "Điểm trung bình" }
      : { title: "Training Evaluations", intro: "Read-only assessment overview. Use Training Records or Exams to make authorized updates.", assessed: "Assessed records", passed: "Passed training", followUp: "Needs follow-up", average: "Average score" };

  return (
    <section className="surface-panel" style={{ padding: 18 }}>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>{labels.title}</h3>
        <p style={{ color: "#94a3b8", margin: "6px 0 0" }}>{labels.intro}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
        {[
          [labels.assessed, summary.assessed],
          [labels.passed, summary.passed],
          [labels.followUp, summary.needsFollowUp],
          [labels.average, summary.average === null ? "—" : `${summary.average.toFixed(1)}%`],
        ].map(([label, value]) => (
          <div key={String(label)} style={{ border: "1px solid #334155", borderRadius: 10, padding: 14, background: "#111827" }}>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>{label}</div>
            <div style={{ color: "#f8fafc", fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      {loading && <p style={{ color: "#94a3b8" }}>Loading evaluations…</p>}
      {error && <p style={{ color: "#fecaca", background: "#7f1d1d", borderRadius: 8, padding: 12 }}>{error}</p>}
      {!loading && !error && (
        <table className="data-table">
          <thead><tr><th>Employee</th><th>Course</th><th>Score</th><th>Rating</th><th>Outcome</th><th>Certificate</th></tr></thead>
          <tbody>
            {records.map((record) => {
              const state = scoreState(record.assessment_score);
              return <tr key={record.id}>
                <td>{record.employee_name_zh} <span style={{ color: "#94a3b8" }}>({record.employee_no})</span></td>
                <td>{record.course_name_zh}</td>
                <td>{record.assessment_score === null ? "—" : `${record.assessment_score}%`}</td>
                <td>{record.rating || "—"}</td>
                <td><span style={{ color: state.color, fontWeight: 700 }}>{state.label}</span></td>
                <td><code style={{ fontSize: 11 }}>{record.certificate_no || "—"}</code></td>
              </tr>;
            })}
            {records.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "#94a3b8" }}>No training records available.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
