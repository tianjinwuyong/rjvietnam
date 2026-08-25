import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import { t } from "../i18n";

type ExamTab = "list" | "enroll" | "questions";

export default function HrExam({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<ExamTab>("list");
  const [exams, setExams] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [certTypes, setCertTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showExamForm, setShowExamForm] = useState(false);
  const [showQForm, setShowQForm] = useState(false);
  const [examForm, setExamForm] = useState({ cert_type_id: 0, exam_name_zh: "", exam_date: "", exam_time_start: "", exam_time_end: "", location: "", exam_type: "written", total_score: 100, passing_score: 60, duration_minutes: 60, max_attendees: 30 });
  const [qForm, setQForm] = useState({ cert_type_id: 0, question_no: "", question_type: "single", question_text_zh: "", options_zh: "", correct_answer: "", score_per_q: 5, difficulty: "medium", topic: "" });
  const [gradeMap, setGradeMap] = useState<Record<number, { score: number; passed: boolean; remarks: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [e, en, q, ct] = await Promise.all([
        hrApi.getExams({}),
        hrApi.getExamEnrollments({}),
        hrApi.getExamQuestions({ is_active: 1 }),
        hrApi.getCertTypes({ is_active: 1 }),
      ]);
      setExams(e.data || []);
      setEnrollments(en.data || []);
      setQuestions(q.data || []);
      setCertTypes(ct.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleExamSave = async () => {
    if (!examForm.cert_type_id || !examForm.exam_name_zh || !examForm.exam_date) return;
    await hrApi.createExam(examForm);
    setShowExamForm(false);
    load();
  };

  const handleQSave = async () => {
    if (!qForm.cert_type_id || !qForm.question_text_zh || !qForm.correct_answer) return;
    await hrApi.createExamQuestion(qForm);
    setShowQForm(false);
    load();
  };

  const handleGrade = async (enrollmentId: number) => {
    const g = gradeMap[enrollmentId];
    if (!g) return;
    await hrApi.gradeExamEnrollment(enrollmentId, { score_obtained: g.score, is_passed: g.passed, result_remarks: g.remarks });
    load();
  };

  const today = new Date().toISOString().slice(0, 10);

  const statusColor = (s: string) => {
    if (s === "completed") return "bg-green-100 text-green-700";
    if (s === "scheduled") return "bg-blue-100 text-blue-700";
    if (s === "cancelled") return "bg-gray-100 text-gray-500";
    return "bg-gray-50";
  };

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        {(["list", "enroll", "questions"] as ExamTab[]).map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === tabKey ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>
            {tabKey === "list" ? t("hr.exam.tabList", locale) : tabKey === "enroll" ? t("hr.exam.tabEnroll", locale) : t("hr.exam.tabQuestions", locale)}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-500">{t("hr.exam.loading", locale)}</p>}

      {tab === "list" && (
        <div>
          <div className="flex justify-between mb-3">
            <h3 className="font-bold">{t("hr.exam.tabList", locale)}</h3>
            <button onClick={() => { setExamForm({ cert_type_id: 0, exam_name_zh: "", exam_date: today, exam_time_start: "", exam_time_end: "", location: "", exam_type: "written", total_score: 100, passing_score: 60, duration_minutes: 60, max_attendees: 30 }); setShowExamForm(true); }} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">+ {t("hr.exam.createExam", locale)}</button>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50">
              <th className="border p-2 text-left">{t("hr.exam.examNo", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.examName", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.certType", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.examDate", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.location", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.examType", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.enrolledCount", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.status", locale)}</th>
            </tr></thead>
            <tbody>
              {exams.map(e => (
                <tr key={e.id}>
                  <td className="border p-2 font-mono text-xs">{e.exam_no}</td>
                  <td className="border p-2">{e.exam_name_zh}</td>
                  <td className="border p-2">{e.cert_type_name}</td>
                  <td className="border p-2">{e.exam_date}</td>
                  <td className="border p-2">{e.location || "—"}</td>
                  <td className="border p-2">{e.exam_type}</td>
                  <td className="border p-2 text-center">{e.enrolled_count}</td>
                  <td className="border p-2"><span className={`px-2 py-0.5 rounded text-xs ${statusColor(e.status)}`}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "enroll" && (
        <div>
          <h3 className="font-bold mb-3">{t("hr.exam.tabEnroll", locale)}</h3>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50">
              <th className="border p-2 text-left">{t("hr.exam.empName", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.empNo", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.exam", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.examDate", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.score", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.result", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.action", locale)}</th>
            </tr></thead>
            <tbody>
              {enrollments.map(en => (
                <tr key={en.id}>
                  <td className="border p-2">{en.emp_name}</td>
                  <td className="border p-2">{en.emp_no}</td>
                  <td className="border p-2">{en.exam_name_zh}</td>
                  <td className="border p-2">{en.exam_date}</td>
                  <td className="border p-2">{en.score_obtained ?? "—"}</td>
                  <td className="border p-2">
                    {en.is_passed === 1 ? <span className="text-green-600 font-bold">✓</span> : en.is_passed === 0 ? <span className="text-red-500 font-bold">✗</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="border p-2">
                    {en.exam_status !== "graded" && en.exam_status !== "absent" ? (
                      <div className="flex gap-1 items-center">
                        <input type="number" placeholder={t("hr.exam.inputScore", locale)} className="border rounded px-1 w-16 text-xs" value={gradeMap[en.id]?.score ?? ""} onChange={e => setGradeMap({ ...gradeMap, [en.id]: { ...gradeMap[en.id], score: Number(e.target.value) } })} />
                        <select className="border rounded px-1 text-xs" value={gradeMap[en.id]?.passed ? "1" : "0"} onChange={e => setGradeMap({ ...gradeMap, [en.id]: { ...gradeMap[en.id], passed: e.target.value === "1" } })}>
                          <option value="">{t("hr.exam.resultLabel", locale)}</option>
                          <option value="1">{t("hr.exam.pass", locale)}</option>
                          <option value="0">{t("hr.exam.fail", locale)}</option>
                        </select>
                        <button onClick={() => handleGrade(en.id)} className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs">{t("hr.exam.save", locale)}</button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">{t("hr.exam.graded", locale)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "questions" && (
        <div>
          <div className="flex justify-between mb-3">
            <h3 className="font-bold">{t("hr.exam.tabQuestions", locale)}</h3>
            <button onClick={() => { setQForm({ cert_type_id: 0, question_no: "", question_type: "single", question_text_zh: "", options_zh: "", correct_answer: "", score_per_q: 5, difficulty: "medium", topic: "" }); setShowQForm(true); }} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">+ {t("hr.exam.addQuestion", locale)}</button>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50">
              <th className="border p-2 text-left">{t("hr.exam.qNo", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.certType", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.question", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.correctAnswer", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.scorePerQ", locale)}</th>
              <th className="border p-2 text-left">{t("hr.exam.difficulty", locale)}</th>
            </tr></thead>
            <tbody>
              {questions.map(q => (
                <tr key={q.id}>
                  <td className="border p-2 font-mono text-xs">{q.question_no}</td>
                  <td className="border p-2">{q.cert_type_name}</td>
                  <td className="border p-2 max-w-xs truncate">{q.question_text_zh}</td>
                  <td className="border p-2">{q.correct_answer}</td>
                  <td className="border p-2 text-center">{q.score_per_q}</td>
                  <td className="border p-2"><span className={`px-2 py-0.5 rounded text-xs ${q.difficulty === "easy" ? "bg-green-100" : q.difficulty === "hard" ? "bg-red-100" : "bg-yellow-100"}`}>{q.difficulty}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showExamForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-[500px]">
            <h3 className="font-bold mb-4">{t("hr.exam.examTitle", locale)}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.exam.certTypeLabel", locale)}</label>
                <select className="w-full border rounded p-2" value={examForm.cert_type_id} onChange={e => setExamForm({ ...examForm, cert_type_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {certTypes.map(t => <option key={t.id} value={t.id}>{t.name_zh} [{t.code}]</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.exam.examNameLabel", locale)}</label>
                <input className="w-full border rounded p-2" value={examForm.exam_name_zh} onChange={e => setExamForm({ ...examForm, exam_name_zh: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.examDateLabel", locale)}</label>
                <input type="date" className="w-full border rounded p-2" value={examForm.exam_date} onChange={e => setExamForm({ ...examForm, exam_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.examLocation", locale)}</label>
                <input className="w-full border rounded p-2" value={examForm.location} onChange={e => setExamForm({ ...examForm, location: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.duration", locale)}</label>
                <input type="number" className="w-full border rounded p-2" value={examForm.duration_minutes} onChange={e => setExamForm({ ...examForm, duration_minutes: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.maxAttendees", locale)}</label>
                <input type="number" className="w-full border rounded p-2" value={examForm.max_attendees} onChange={e => setExamForm({ ...examForm, max_attendees: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowExamForm(false)} className="px-4 py-2 rounded bg-gray-100">{t("hr.exam.cancel", locale)}</button>
              <button onClick={handleExamSave} className="px-4 py-2 rounded bg-blue-600 text-white">{t("hr.exam.save", locale)}</button>
            </div>
          </div>
        </div>
      )}

      {showQForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-[520px]">
            <h3 className="font-bold mb-4">{t("hr.exam.addQuestionTitle", locale)}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.exam.certTypeLabelQ", locale)}</label>
                <select className="w-full border rounded p-2" value={qForm.cert_type_id} onChange={e => setQForm({ ...qForm, cert_type_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {certTypes.map(t => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.qNoLabel", locale)}</label>
                <input className="w-full border rounded p-2" value={qForm.question_no} onChange={e => setQForm({ ...qForm, question_no: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.questionType", locale)}</label>
                <select className="w-full border rounded p-2" value={qForm.question_type} onChange={e => setQForm({ ...qForm, question_type: e.target.value })}>
                  <option value="single">{t("hr.exam.single", locale)}</option>
                  <option value="multi">{t("hr.exam.multi", locale)}</option>
                  <option value="truefalse">{t("hr.exam.truefalse", locale)}</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.exam.questionContent", locale)}</label>
                <textarea className="w-full border rounded p-2" rows={2} value={qForm.question_text_zh} onChange={e => setQForm({ ...qForm, question_text_zh: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.exam.options", locale)}</label>
                <input className="w-full border rounded p-2" placeholder="A. xxx | B. xxx | C. xxx | D. xxx" value={qForm.options_zh} onChange={e => setQForm({ ...qForm, options_zh: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.correctAnswerLabel", locale)}</label>
                <input className="w-full border rounded p-2" placeholder="A" value={qForm.correct_answer} onChange={e => setQForm({ ...qForm, correct_answer: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.scorePerQ", locale)}</label>
                <input type="number" className="w-full border rounded p-2" value={qForm.score_per_q} onChange={e => setQForm({ ...qForm, score_per_q: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.difficultyLabel", locale)}</label>
                <select className="w-full border rounded p-2" value={qForm.difficulty} onChange={e => setQForm({ ...qForm, difficulty: e.target.value })}>
                  <option value="easy">{t("hr.exam.easy", locale)}</option>
                  <option value="medium">{t("hr.exam.medium", locale)}</option>
                  <option value="hard">{t("hr.exam.hard", locale)}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.exam.topic", locale)}</label>
                <input className="w-full border rounded p-2" value={qForm.topic} onChange={e => setQForm({ ...qForm, topic: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowQForm(false)} className="px-4 py-2 rounded bg-gray-100">{t("hr.exam.cancel", locale)}</button>
              <button onClick={handleQSave} className="px-4 py-2 rounded bg-blue-600 text-white">{t("hr.exam.save", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
