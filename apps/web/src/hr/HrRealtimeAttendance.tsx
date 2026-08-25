import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import { t } from "../i18n";

export default function HrRealtimeAttendance({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<number>(0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ session_id: 0, employee_id: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (sessionFilter > 0) params.session_id = sessionFilter;
      const [r, s, e] = await Promise.all([
        hrApi.getTrainingAttendance(params),
        hrApi.getTrainingPlanDetails({}),
        hrApi.getEmployees({ status: "active" }),
      ]);
      setRecords(r.data || []);
      setSessions(s.data || []);
      setEmployees(e.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [sessionFilter]);

  const handleSignIn = async () => {
    if (!form.session_id || !form.employee_id) return;
    await hrApi.signInTraining(form.session_id, form.employee_id);
    setShowForm(false);
    setForm({ session_id: 0, employee_id: 0 });
    load();
  };

  const handleSignOut = async (sessionId: number, empId: number) => {
    await hrApi.signOutTraining(sessionId, empId);
    load();
  };

  const l = {
    "zh-CN": { title: t("hr.rtAtt.title", locale), session: t("hr.rtAtt.session", locale), emp: t("hr.rtAtt.emp", locale), signIn: t("hr.rtAtt.signIn", locale), signOut: t("hr.rtAtt.signOut", locale), status: t("hr.rtAtt.status", locale), add: t("hr.rtAtt.add", locale), no: t("hr.rtAtt.empNo", locale), name: t("hr.rtAtt.name", locale), dept: t("hr.rtAtt.dept", locale), course: t("hr.rtAtt.course", locale), signInTime: t("hr.rtAtt.signInTime", locale), signOutTime: t("hr.rtAtt.signOutTime", locale), all: t("hr.rtAtt.allSessions", locale), signInBtn: t("hr.rtAtt.signInBtn", locale), signOutBtn: t("hr.rtAtt.signOutBtn", locale) },
    "en-US": { title: t("hr.rtAtt.title", locale), session: t("hr.rtAtt.session", locale), emp: t("hr.rtAtt.emp", locale), signIn: t("hr.rtAtt.signIn", locale), signOut: t("hr.rtAtt.signOut", locale), status: t("hr.rtAtt.status", locale), add: t("hr.rtAtt.add", locale), no: t("hr.rtAtt.empNo", locale), name: t("hr.rtAtt.name", locale), dept: t("hr.rtAtt.dept", locale), course: t("hr.rtAtt.course", locale), signInTime: t("hr.rtAtt.signInTime", locale), signOutTime: t("hr.rtAtt.signOutTime", locale), all: t("hr.rtAtt.allSessions", locale), signInBtn: t("hr.rtAtt.signInBtn", locale), signOutBtn: t("hr.rtAtt.signOutBtn", locale) },
    "vi-VN": { title: t("hr.rtAtt.title", locale), session: t("hr.rtAtt.session", locale), emp: t("hr.rtAtt.emp", locale), signIn: t("hr.rtAtt.signIn", locale), signOut: t("hr.rtAtt.signOut", locale), status: t("hr.rtAtt.status", locale), add: t("hr.rtAtt.add", locale), no: t("hr.rtAtt.empNo", locale), name: t("hr.rtAtt.name", locale), dept: t("hr.rtAtt.dept", locale), course: t("hr.rtAtt.course", locale), signInTime: t("hr.rtAtt.signInTime", locale), signOutTime: t("hr.rtAtt.signOutTime", locale), all: t("hr.rtAtt.allSessions", locale), signInBtn: t("hr.rtAtt.signInBtn", locale), signOutBtn: t("hr.rtAtt.signOutBtn", locale) },
  }[locale] || { title: t("hr.rtAtt.title", locale), session: t("hr.rtAtt.session", locale), emp: t("hr.rtAtt.emp", locale), signIn: t("hr.rtAtt.signIn", locale), signOut: t("hr.rtAtt.signOut", locale), status: t("hr.rtAtt.status", locale), add: t("hr.rtAtt.add", locale), no: t("hr.rtAtt.empNo", locale), name: t("hr.rtAtt.name", locale), dept: t("hr.rtAtt.dept", locale), course: t("hr.rtAtt.course", locale), signInTime: t("hr.rtAtt.signInTime", locale), signOutTime: t("hr.rtAtt.signOutTime", locale), all: t("hr.rtAtt.allSessions", locale), signInBtn: t("hr.rtAtt.signInBtn", locale), signOutBtn: t("hr.rtAtt.signOutBtn", locale) };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold">{l.title}</h3>
        <div className="flex gap-2 items-center">
          <select className="border rounded px-2 py-1 text-sm" value={sessionFilter} onChange={e => setSessionFilter(Number(e.target.value))}>
            <option value={0}>{l.all}</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.session_no} — {s.course_name_zh} — {s.scheduled_date}</option>)}
          </select>
          <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">+ {l.add}</button>
        </div>
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}

      <table className="w-full text-sm border-collapse">
        <thead><tr className="bg-gray-50">
          <th className="border p-2 text-left">{l.session}</th>
          <th className="border p-2 text-left">{l.no}</th>
          <th className="border p-2 text-left">{l.name}</th>
          <th className="border p-2 text-left">{l.dept}</th>
          <th className="border p-2 text-left">{l.course}</th>
          <th className="border p-2 text-left">{l.signInTime}</th>
          <th className="border p-2 text-left">{l.signOutTime}</th>
          <th className="border p-2 text-left">{l.status}</th>
          <th className="border p-2 text-left">{l.emp}</th>
        </tr></thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id}>
              <td className="border p-2 font-mono text-xs">{r.session_no}</td>
              <td className="border p-2">{r.emp_no}</td>
              <td className="border p-2">{r.emp_name}</td>
              <td className="border p-2">{r.dept_name || ""}</td>
              <td className="border p-2">{r.course_name}</td>
              <td className="border p-2">{r.sign_in_time ? new Date(r.sign_in_time).toLocaleString() : "—"}</td>
              <td className="border p-2">{r.sign_out_time ? new Date(r.sign_out_time).toLocaleString() : "—"}</td>
              <td className="border p-2">
                <span className={`px-2 py-0.5 rounded text-xs ${r.attendance_status === "completed" ? "bg-green-100 text-green-700" : r.attendance_status === "present" ? "bg-blue-100 text-blue-700" : "bg-gray-100"}`}>
                  {r.attendance_status}
                </span>
              </td>
              <td className="border p-2">
                {!r.sign_out_time && r.attendance_status === "present" ? (
                  <button onClick={() => handleSignOut(r.session_id, r.employee_id)} className="bg-orange-500 text-white px-2 py-0.5 rounded text-xs">{l.signOutBtn}</button>
                ) : r.sign_out_time ? (
                  <span className="text-green-600 text-xs">✓</span>
                ) : null}
              </td>
            </tr>
          ))}
          {records.length === 0 && <tr><td colSpan={9} className="border p-4 text-center text-gray-400">—</td></tr>}
        </tbody>
      </table>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-[400px]">
            <h3 className="font-bold mb-4">{l.add}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">{l.session}</label>
                <select className="w-full border rounded p-2" value={form.session_id} onChange={e => setForm({ ...form, session_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.session_no} — {s.course_name_zh} — {s.scheduled_date}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{l.emp}</label>
                <select className="w-full border rounded p-2" value={form.employee_id} onChange={e => setForm({ ...form, employee_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded bg-gray-100">{t("hr.rtAtt.cancel", locale)}</button>
              <button onClick={handleSignIn} className="px-4 py-2 rounded bg-blue-600 text-white">{l.signInBtn}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
