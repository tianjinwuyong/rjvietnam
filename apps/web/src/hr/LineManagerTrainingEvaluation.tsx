import { useEffect, useMemo, useState } from "react";
import { hrApi, type TrainingRecord } from "../api";
import type { Locale } from "../../../../packages/shared-types/src/factory";

function ratingFor(score: number) {
  return score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D";
}

function evaluationOutcomeFor(status: string) {
  return (["passed", "failed", "needs_training", "not_fit"] as const).includes(status as "passed" | "failed" | "needs_training" | "not_fit")
    ? status as "passed" | "failed" | "needs_training" | "not_fit"
    : "passed";
}

export function LineManagerTrainingEvaluation({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [score, setScore] = useState("");
  const [outcome, setOutcome] = useState<"passed" | "failed" | "needs_training" | "not_fit">("passed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setError("");
    try {
      const result = await hrApi.getTrainingRecords({});
      setRecords(result?.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load training records");
    }
  };

  useEffect(() => { load(); }, []);

  const employees = useMemo(() => {
    const entries = new Map<number, { id: number; name: string; code: string; total: number; pending: number }>();
    records.forEach((record) => {
      const current = entries.get(record.employee_id) || { id: record.employee_id, name: record.employee_name_zh, code: record.employee_no, total: 0, pending: 0 };
      current.total += 1;
      if (record.assessment_score === null) current.pending += 1;
      entries.set(record.employee_id, current);
    });
    return [...entries.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  }, [records]);
  const selected = records.find((record) => record.id === selectedId) || null;
  const selectedEmployee = selected ? employees.find((employee) => employee.id === selected.employee_id) : null;
  const employeeRecords = selectedEmployee ? records.filter((record) => record.employee_id === selectedEmployee.id) : [];
  const labels = locale === "zh-CN"
    ? { title: "线长培训评估", queue: "员工培训队列", select: "选择一门课程进行评估", score: "成绩（0–100）", outcome: "结果", pass: "通过", fail: "不通过", moreTraining: "需要更多培训", notFit: "不适合该岗位", save: "确认提交评估", required: "请输入 0–100 的成绩", confirm: "确认保存这项员工培训评估？" }
    : locale === "vi-VN"
      ? { title: "Đánh giá đào tạo trưởng chuyền", queue: "Hàng đợi đào tạo nhân viên", select: "Chọn một khóa học để đánh giá", score: "Điểm (0–100)", outcome: "Kết quả", pass: "Đạt", fail: "Không đạt", moreTraining: "Cần đào tạo thêm", notFit: "Không phù hợp vị trí", save: "Xác nhận gửi đánh giá", required: "Nhập điểm từ 0 đến 100", confirm: "Xác nhận lưu đánh giá đào tạo này?" }
      : { title: "Line Manager Training Evaluation", queue: "Employee training queue", select: "Select a course to evaluate", score: "Score (0–100)", outcome: "Outcome", pass: "Pass", fail: "Not pass", moreTraining: "Needs more training", notFit: "Not fit for this position", save: "Confirm evaluation", required: "Enter a score from 0 to 100", confirm: "Save this employee training evaluation?" };

  async function save() {
    if (!selected) return;
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > 100) { setError(labels.required); return; }
    if (!window.confirm(labels.confirm)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const passed = outcome === "passed";
      await hrApi.updateTrainingRecord(selected.id, {
        assessment_score: value,
        rating: ratingFor(value),
        status: outcome,
        ...(passed ? { certificate_no: `CERT-${new Date().getFullYear()}-${String(selected.id).padStart(6, "0")}` } : {}),
      });
      setNotice("Evaluation saved");
      setScore("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save evaluation");
    } finally { setSaving(false); }
  }

  return <section className="surface-panel" style={{ padding: 18 }}>
    <h3 style={{ margin: "0 0 6px" }}>{labels.title}</h3>
    <p style={{ color: "#94a3b8", margin: "0 0 16px" }}>Evaluate each assigned course. Only users with HR training-edit access can submit results.</p>
    {error && <div style={{ background: "#7f1d1d", color: "#fecaca", padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
    {notice && <div style={{ background: "#14532d", color: "#bbf7d0", padding: 10, borderRadius: 8, marginBottom: 12 }}>{notice}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 34%) minmax(420px, 1fr)", gap: 16 }}>
      <div>
        <h4 style={{ marginTop: 0 }}>{labels.queue}</h4>
        <div style={{ display: "grid", gap: 8, maxHeight: 500, overflowY: "auto" }}>
          {employees.map((employee) => <button key={employee.id} type="button" onClick={() => { const first = records.find((record) => record.employee_id === employee.id && record.assessment_score === null) || records.find((record) => record.employee_id === employee.id); setSelectedId(first?.id || null); setScore(first?.assessment_score?.toString() || ""); setOutcome(evaluationOutcomeFor(first?.status || "")); }} style={{ textAlign: "left", background: selectedEmployee?.id === employee.id ? "#164e63" : "#111827", color: "#f8fafc", border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            <strong>{employee.name}</strong> <span style={{ color: "#94a3b8" }}>({employee.code})</span>
            <div style={{ color: employee.pending ? "#fbbf24" : "#4ade80", fontSize: 12, marginTop: 4 }}>{employee.pending} pending / {employee.total} courses</div>
          </button>)}
          {employees.length === 0 && <div style={{ color: "#94a3b8" }}>No assigned training records.</div>}
        </div>
      </div>
      <div>
        {!selectedEmployee ? <div style={{ color: "#94a3b8", padding: 32 }}>{labels.select}</div> : <>
          <h4 style={{ marginTop: 0 }}>{selectedEmployee.name} — {selectedEmployee.code}</h4>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {employeeRecords.map((record) => <button key={record.id} type="button" onClick={() => { setSelectedId(record.id); setScore(record.assessment_score?.toString() || ""); setOutcome(evaluationOutcomeFor(record.status)); }} style={{ textAlign: "left", background: selected?.id === record.id ? "#164e63" : "#111827", color: "#f8fafc", border: selected?.id === record.id ? "1px solid #22d3ee" : "1px solid #334155", borderRadius: 8, padding: 10 }}>
              <strong>{record.course_name_zh}</strong><div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3 }}>Score: {record.assessment_score ?? "—"} · Status: {record.status}</div>
            </button>)}
          </div>
          {selected && <div style={{ borderTop: "1px solid #334155", paddingTop: 14 }}>
            <strong>{selected.course_name_zh}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <label>{labels.score} <input className="field-input" type="number" min="0" max="100" value={score} onChange={(event) => setScore(event.target.value)} style={{ width: 110, marginLeft: 8 }} /></label>
              <label>{labels.outcome} <select className="field-input" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} style={{ width: 200, marginLeft: 8 }}><option value="passed">{labels.pass}</option><option value="failed">{labels.fail}</option><option value="needs_training">{labels.moreTraining}</option><option value="not_fit">{labels.notFit}</option></select></label>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : labels.save}</button>
            </div>
          </div>}
        </>}
      </div>
    </div>
  </section>;
}
