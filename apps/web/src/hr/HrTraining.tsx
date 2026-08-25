import { useState, useEffect } from "react";
import HrCertType from "./HrCertType";
import HrExam from "./HrExam";
import HrApproval from "./HrApproval";
import HrRealtimeAttendance from "./HrRealtimeAttendance";
import HrTracking from "./HrTracking";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { TrainingCourse, TrainingPlan, TrainingSession, TrainingRecord, Employee } from "../api";
import { TrainingVideoCenter } from "./TrainingVideoCenter";
import { W3cTrainingCatalog } from "./W3cTrainingCatalog";
import { MicrosoftAiLearningPath } from "./MicrosoftAiLearningPath";
import { TrainingEvaluations } from "./TrainingEvaluations";
import { LineManagerTrainingEvaluation } from "./LineManagerTrainingEvaluation";

type Tab = "videos" | "w3c" | "aiBasics" | "evaluations" | "managerEvaluation" | "courses" | "plans" | "sessions" | "records" | "certType" | "exam" | "approval" | "realtime" | "tracking";

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e", draft: "#6b7280", scheduled: "#3b82f6",
  in_progress: "#f59e0b", completed: "#22c55e", cancelled: "#ef4444",
  enrolled: "#3b82f6", attended: "#22c55e", passed: "#22c55e",
  failed: "#ef4444", exempted: "#6b7280",
};

function localeName(locale: Locale, zh: string, _en: string, vi: string) {
  return locale === "zh-CN" ? zh : vi;
}

interface Props { locale: Locale; }

export function HrTraining({ locale }: Props) {
  const [tab, setTab] = useState<Tab>("videos");
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollCourseId, setEnrollCourseId] = useState<number>(0);

  useEffect(() => { loadEmployees(); }, []);

  async function loadEmployees() {
    try {
      const res = await hrApi.getEmployees({} as any);
      if (res?.data) setEmployees(res.data as Employee[]);
    } catch {}
  }

  async function loadTab(t: Tab) {
    if (t === "videos") {
      return;
    } else if (t === "courses") {
      const res = await hrApi.getTrainingCourses({});
      if (res?.data) setCourses(res.data as TrainingCourse[]);
    } else if (t === "plans") {
      const res = await hrApi.getTrainingPlans({ year });
      if (res?.data) setPlans(res.data as TrainingPlan[]);
    } else if (t === "sessions") {
      const res = await hrApi.getTrainingSessions({ date_from: year + "-01-01", date_to: year + "-12-31" });
      if (res?.data) setSessions(res.data as TrainingSession[]);
    } else if (t === "records") {
      const res = await hrApi.getTrainingRecords({});
      if (res?.data) setRecords(res.data as TrainingRecord[]);
    }
  }

  useEffect(() => { loadTab(tab); }, [tab, year]);

  async function handleEnroll(employeeId: number) {
    try {
      await hrApi.createTrainingRecord({ employee_id: employeeId, course_id: enrollCourseId });
      setShowEnrollModal(false);
      loadTab("records");
    } catch (e) { console.error(e); }
  }

  async function handleUpdateRecord(id: number, payload: any) {
    try {
      await hrApi.updateTrainingRecord(id, payload);
      loadTab("records");
    } catch (e) { console.error(e); }
  }

  const CATEGORY_MAP: Record<string, string> = {
    safety: "hr.training.category.safety",
    skill: "hr.training.category.skill",
    quality: "hr.training.category.quality",
    hr: "hr.training.category.hr",
    law: "hr.training.category.law",
    equipment: "hr.training.category.equipment",
  };
  const METHOD_MAP: Record<string, string> = {
    offline: "hr.training.method.offline",
    online: "hr.training.method.online",
    on_job: "hr.training.method.on_job",
  };
  const SESSION_STATUS_MAP: Record<string, string> = {
    scheduled: "hr.training.sessionStatus.scheduled",
    in_progress: "hr.training.sessionStatus.in_progress",
    completed: "hr.training.sessionStatus.completed",
    cancelled: "hr.training.sessionStatus.cancelled",
  };
  const RECORD_STATUS_MAP: Record<string, string> = {
    enrolled: "hr.training.recordStatus.enrolled",
    attended: "hr.training.recordStatus.attended",
    passed: "hr.training.recordStatus.passed",
    failed: "hr.training.recordStatus.failed",
    exempted: "hr.training.recordStatus.exempted",
  };

  function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
    const color = STATUS_COLORS[status] || "#6b7280";
    const key = map[status] || status;
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:600, fontSize:12 }}>
        {t(key, locale)}
      </span>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <h2>{t("hr.training.title", locale)}</h2>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["videos","w3c","aiBasics","evaluations","managerEvaluation","courses","plans","sessions","records","certType","exam","approval","realtime","tracking"] as Tab[]).map((k) => (
            <button key={k} className={`btn-ghost ${tab === k ? "btn-active" : ""}`} onClick={() => setTab(k)}>
              {{ videos:t("hr.training.videos", locale), w3c:"W3C Path", aiBasics:"AI Basics", evaluations:"Evaluations", managerEvaluation:"Manager Evaluation", courses:t("hr.training.courses", locale), plans:t("hr.training.plans", locale), sessions:t("hr.training.sessions", locale), records:t("hr.training.records", locale), certType:t("hr.training.certType", locale), exam:t("hr.training.exam", locale), approval:t("hr.training.approval", locale), realtime:t("hr.training.realtime", locale), tracking:t("hr.training.tracking", locale) }[k]}
            </button>
          ))}
        </div>
      </div>

      {tab === "videos" && <TrainingVideoCenter />}
      {tab === "w3c" && <W3cTrainingCatalog locale={locale} />}
      {tab === "aiBasics" && <MicrosoftAiLearningPath locale={locale} />}
      {tab === "evaluations" && <TrainingEvaluations locale={locale} />}
      {tab === "managerEvaluation" && <LineManagerTrainingEvaluation locale={locale} />}

      {tab === "courses" && (
        <table className="data-table">
          <thead><tr><th>{t("hr.training.code", locale)}</th><th>{t("hr.training.courseName", locale)}</th><th>{t("hr.training.category", locale)}</th><th>{t("hr.training.method", locale)}</th><th>{t("hr.training.duration", locale)}</th><th>{t("hr.training.trainer", locale)}</th><th>{t("hr.training.status", locale)}</th></tr></thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td><code>{c.code}</code></td>
                <td>{localeName(locale, c.name_zh, c.name_en, c.name_vi)}</td>
                <td>{t(CATEGORY_MAP[c.category] || c.category, locale)}</td>
                <td>{t(METHOD_MAP[c.method] || c.method, locale)}</td>
                <td>{c.duration_hours}</td>
                <td>{c.trainer_name || "—"}</td>
                <td><StatusBadge status={c.status} map={{ active:"hr.training.status.active",inactive:"hr.training.status.inactive" }} /></td>
              </tr>
            ))}
            {courses.length === 0 && <tr><td colSpan={7} style={{textAlign:"center",color:"#6b7280"}}>{t("hr.training.noData", locale)}</td></tr>}
          </tbody>
        </table>
      )}

      {tab === "plans" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <span>{t("hr.training.year", locale)}:</span>
            <select className="field-input" style={{width:120}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <table className="data-table">
            <thead><tr><th>{t("hr.training.planNo", locale)}</th><th>{t("hr.training.name", locale)}</th><th>{t("hr.training.course", locale)}</th><th>{t("hr.training.category", locale)}</th><th>{t("hr.training.department", locale)}</th><th>{t("hr.training.yearMonth", locale)}</th><th>{t("hr.training.targetCount", locale)}</th><th>{t("hr.training.plannedHours", locale)}</th><th>{t("hr.training.status", locale)}</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.plan_no}</code></td>
                  <td>{localeName(locale, p.name_zh, p.name_en, p.name_vi)}</td>
                  <td>{p.course_name_zh}</td>
                  <td>{p.course_category}</td>
                  <td>{p.department_name_zh || t("hr.training.all", locale)}</td>
                  <td>{p.plan_year}/{p.plan_month || t("hr.training.fullYear", locale)}</td>
                  <td>{p.target_count}</td>
                  <td>{p.planned_hours}</td>
                  <td><StatusBadge status={p.status} map={{}} /></td>
                </tr>
              ))}
              {plans.length === 0 && <tr><td colSpan={9} style={{textAlign:"center",color:"#6b7280"}}>{t("hr.training.noData", locale)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "sessions" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <span>{t("hr.training.year", locale)}:</span>
            <select className="field-input" style={{width:120}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <table className="data-table">
            <thead><tr><th>{t("hr.training.sessionNo", locale)}</th><th>{t("hr.training.course", locale)}</th><th>{t("hr.training.plan", locale)}</th><th>{t("hr.training.date", locale)}</th><th>{t("hr.training.time", locale)}</th><th>{t("hr.training.location", locale)}</th><th>{t("hr.training.method", locale)}</th><th>{t("hr.training.attendees", locale)}</th><th>{t("hr.training.status", locale)}</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.session_no}</code></td>
                  <td>{s.course_name_zh}</td>
                  <td>{s.plan_name_zh}</td>
                  <td>{s.scheduled_date}</td>
                  <td>{s.start_time && s.end_time ? s.start_time + "~" + s.end_time : "—"}</td>
                  <td>{s.location || "—"}</td>
                  <td>{t(METHOD_MAP[s.method] || s.method, locale)}</td>
                  <td>{s.actual_attendees}/{s.max_attendees}</td>
                  <td><StatusBadge status={s.status} map={SESSION_STATUS_MAP} /></td>
                </tr>
              ))}
              {sessions.length === 0 && <tr><td colSpan={9} style={{textAlign:"center",color:"#6b7280"}}>{t("hr.training.noData", locale)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "records" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn-primary" onClick={() => { setEnrollCourseId(courses[0]?.id || 0); setShowEnrollModal(true); }}>{t("hr.training.enroll", locale)}</button>
          </div>
          <table className="data-table">
            <thead><tr><th>{t("hr.training.employeeNo", locale)}</th><th>{t("hr.training.employeeName", locale)}</th><th>{t("hr.training.course", locale)}</th><th>{t("hr.training.enrolled", locale)}</th><th>{t("hr.training.attendance", locale)}</th><th>{t("hr.training.score", locale)}</th><th>{t("hr.training.grade", locale)}</th><th>{t("hr.training.certNo", locale)}</th><th>{t("hr.training.status", locale)}</th><th>{t("hr.training.action", locale)}</th></tr></thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.employee_no}</code></td>
                  <td>{r.employee_name_zh}</td>
                  <td>{r.course_name_zh}</td>
                  <td>{r.enrolled_at?.slice(0,10) || "—"}</td>
                  <td>{r.attended_at?.slice(0,10) || "—"}</td>
                  <td>{r.assessment_score ?? "—"}</td>
                  <td>{r.rating ? <StatusBadge status={r.rating} map={{}} /> : "—"}</td>
                  <td><code style={{fontSize:11}}>{r.certificate_no || "—"}</code></td>
                  <td><StatusBadge status={r.status} map={RECORD_STATUS_MAP} /></td>
                  <td>
                    {r.status === "enrolled" && (
                      <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => handleUpdateRecord(r.id, { status: "attended" })}>{t("hr.training.confirmAttendance", locale)}</button>
                    )}
                    {(r.status === "attended" || r.status === "passed") && (
                      <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => {
                        const score = window.prompt(t("hr.training.enterScorePrompt", locale), r.assessment_score?.toString() || "");
                        if (score !== null) {
                          const s = parseFloat(score);
                          const rating = s >= 90 ? "S" : s >= 80 ? "A" : s >= 70 ? "B" : s >= 60 ? "C" : "D";
                          const certNo = "CERT-" + new Date().getFullYear() + "-" + String(r.id).padStart(6,"0");
                          handleUpdateRecord(r.id, { assessment_score: s, rating, status: "passed", certificate_no: certNo });
                        }
                      }}>{t("hr.training.enterScore", locale)}</button>
                    )}
                  </td>
                </tr>
              ))}
              {records.length === 0 && <tr><td colSpan={10} style={{textAlign:"center",color:"#6b7280"}}>{t("hr.training.noData", locale)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "certType" && <HrCertType locale={locale} />}
      {tab === "exam" && <HrExam locale={locale} />}
      {tab === "approval" && <HrApproval locale={locale} />}
      {tab === "realtime" && <HrRealtimeAttendance locale={locale} />}
      {tab === "tracking" && <HrTracking locale={locale} />}

      {showEnrollModal && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:400,padding:24}}>
            <h3>{t("hr.training.enroll", locale)}</h3>
            <div className="field" style={{marginTop:12}}>
              <span>{t("hr.training.course", locale)}</span>
              <select className="field-input" value={enrollCourseId} onChange={e => setEnrollCourseId(Number(e.target.value))}>
                <option value={0}>— {t("hr.training.selectCourse", locale)} —</option>
                {courses.map(c => <option key={c.id} value={c.id}>{localeName(locale, c.name_zh, c.name_en, c.name_vi)}</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}>
              <span>{t("hr.training.employeeName", locale)}</span>
              <select className="field-input" id="enroll-emp">
                <option value={0}>— {t("hr.training.selectEmployee", locale)} —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowEnrollModal(false)}>{t("hr.training.cancel", locale)}</button>
              <button className="btn-primary" onClick={() => {
                const sel = document.getElementById("enroll-emp") as HTMLSelectElement;
                if (sel && parseInt(sel.value) > 0 && enrollCourseId > 0) handleEnroll(parseInt(sel.value));
              }}>{t("hr.training.confirmEnroll", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
