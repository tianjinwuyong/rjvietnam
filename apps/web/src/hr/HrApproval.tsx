import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t as i18n } from "../i18n";
import { hrApi } from "../api";

type AppTab = "pending" | "all" | "new";
const labels: Record<string, Record<AppTab, string>> = {
  zh: { pending: "待我审批", all: "全部单据", new: "新建审批" },
  en: { pending: "My Pending", all: "All", new: "New" },
  vi: { pending: "Chờ duyệt", all: "Tất cả", new: "Tạo mới" },
};

// Map short locale to i18n locale
const toI18nLocale = (l: string): Locale => {
  if (l === "vi") return "vi-VN";
  if (l === "en") return "en-US";
  return "zh-CN";
};

export default function HrApproval({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<AppTab>("pending");
  const [approvals, setApprovals] = useState<any[]>([]);
  const [certTypes, setCertTypes] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ employee_id: 0, cert_type_id: 0, cert_type_name: "", request_type: "new", request_reason: "", exam_enrollment_id: 0, exam_score: 0 });

  const load = async (statusFilter?: string) => {
    setLoading(true);
    try {
      const params = statusFilter ? { current_status: statusFilter } : {};
      const [a, ct, em] = await Promise.all([
        hrApi.getCertApprovals(params as any),
        hrApi.getCertTypes({ is_active: 1 }),
        hrApi.getEmployees({ status: "active" }),
      ]);
      setApprovals(a.data || []);
      setCertTypes(ct.data || []);
      setEmployees(em.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (tab === "pending") load("pending");
    else load();
  }, [tab]);

  const loadSteps = async (id: number) => {
    const s = await hrApi.getCertApprovalSteps(id);
    setSteps(s.data || []);
  };

  const handleApprove = async (approvalId: number, stepNo: number, decision: string, remarks: string) => {
    await hrApi.approveCertStep(approvalId, { step_no: stepNo, decision, remarks });
    await loadSteps(approvalId);
    const updated = await hrApi.getCertApprovals({});
    const up = (updated.data || []).find((x: any) => x.id === approvalId);
    if (up) setSelected(up);
  };

  const handleNew = async () => {
    if (!form.employee_id || !form.cert_type_id) return;
    const ct = certTypes.find(t => t.id === form.cert_type_id);
    await hrApi.createCertApproval({ ...form, cert_type_name: ct?.name_zh || "" });
    setShowNew(false);
    load();
  };

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-green-100 text-green-700";
    if (s === "rejected") return "bg-red-100 text-red-700";
    if (s === "pending") return "bg-yellow-100 text-yellow-700";
    return "bg-gray-50";
  };

  const L = labels[locale] || labels.zh;
  const il = toI18nLocale(locale);
  const T = (k: string) => i18n(k, il);

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        {(["pending", "all", "new"] as AppTab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setSelected(null); }} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === t ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>
            {L[t]}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}

      <div className="flex gap-4">
        {/* Left: list */}
        <div className="flex-1">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50">
              <th className="border p-2 text-left">{T("hr.approval.appNo")}</th>
              <th className="border p-2 text-left">{T("hr.approval.employee")}</th>
              <th className="border p-2 text-left">{T("hr.approval.certType")}</th>
              <th className="border p-2 text-left">{T("hr.approval.requestType")}</th>
              <th className="border p-2 text-left">{T("hr.approval.step")}</th>
              <th className="border p-2 text-left">{T("hr.approval.status")}</th>
            </tr></thead>
            <tbody>
              {approvals.filter(a => tab !== "pending" || a.current_status === "pending").map(a => (
                <tr key={a.id} className={`cursor-pointer hover:bg-blue-50 ${selected?.id === a.id ? "bg-blue-100" : ""}`} onClick={() => { setSelected(a); loadSteps(a.id); }}>
                  <td className="border p-2 font-mono text-xs">{a.approval_no}</td>
                  <td className="border p-2">{a.emp_name}</td>
                  <td className="border p-2">{a.cert_type_name}</td>
                  <td className="border p-2">{a.request_type}</td>
                  <td className="border p-2">{a.current_step}/{a.total_steps}</td>
                  <td className="border p-2"><span className={`px-2 py-0.5 rounded text-xs ${statusColor(a.current_status)}`}>{a.current_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right: detail */}
        {selected && (
          <div className="w-96 border rounded p-4 bg-gray-50">
            <h3 className="font-bold mb-3">{T("hr.approval.detail")}</h3>
            <div className="text-sm space-y-2 mb-4">
              <p><span className="text-gray-500">{T("hr.approval.no")}:</span> {selected.approval_no}</p>
              <p><span className="text-gray-500">{T("hr.approval.emp")}:</span> {selected.emp_name} ({selected.emp_no})</p>
              <p><span className="text-gray-500">{T("hr.approval.dept")}:</span> {selected.dept_name}</p>
              <p><span className="text-gray-500">{T("hr.approval.cert")}:</span> {selected.cert_type_name}</p>
              <p><span className="text-gray-500">{T("hr.approval.type")}:</span> {selected.request_type}</p>
              {selected.request_reason && <p><span className="text-gray-500">{T("hr.approval.reason")}:</span> {selected.request_reason}</p>}
              {selected.exam_score > 0 && <p><span className="text-gray-500">{T("hr.approval.examScore")}:</span> {selected.exam_score}</p>}
            </div>

            <h4 className="font-semibold text-sm mb-2">{T("hr.approval.approvalSteps")}</h4>
            <div className="space-y-2">
              {steps.map(s => (
                <div key={s.id} className={`border rounded p-2 text-xs ${s.decision === "approved" ? "bg-green-50 border-green-200" : s.decision === "rejected" ? "bg-red-50 border-red-200" : "bg-white"}`}>
                  <div className="flex justify-between">
                    <span className="font-medium">{s.step_name_zh}</span>
                    <span className={s.decision === "approved" ? "text-green-600" : s.decision === "rejected" ? "text-red-500" : "text-yellow-500"}>
                      {s.decision || (s.step_no === selected.current_step ? T("hr.approval.pendingStep") : T("hr.approval.notYet"))}
                    </span>
                  </div>
                  {s.approver_name_zh && <p className="text-gray-500">{T("hr.approval.approver")}: {s.approver_name_zh} {s.decision_at && new Date(s.decision_at).toLocaleDateString()}</p>}
                  {s.remarks && <p className="text-gray-400">{T("hr.approval.notes")}: {s.remarks}</p>}
                  {selected.current_status === "pending" && s.step_no === selected.current_step && (
                    <div className="flex gap-1 mt-2">
                      <button onClick={() => handleApprove(selected.id, s.step_no, "approved", "")} className="flex-1 bg-green-600 text-white py-1 rounded text-xs">{T("hr.approval.approve")}</button>
                      <button onClick={() => { const r = window.prompt(T("hr.approval.rejectReason") + ":"); if (r !== null) handleApprove(selected.id, s.step_no, "rejected", r); }} className="flex-1 bg-red-500 text-white py-1 rounded text-xs">{T("hr.approval.reject")}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-[480px]">
            <h3 className="font-bold mb-4">{T("hr.approval.newApproval")}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">{T("hr.approval.employee")}</label>
                <select className="w-full border rounded p-2" value={form.employee_id} onChange={e => setForm({ ...form, employee_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{T("hr.approval.certType")}</label>
                <select className="w-full border rounded p-2" value={form.cert_type_id} onChange={e => setForm({ ...form, cert_type_id: Number(e.target.value), cert_type_name: certTypes.find(t => t.id === Number(e.target.value))?.name_zh || "" })}>
                  <option value={0}>—</option>
                  {certTypes.map(t => <option key={t.id} value={t.id}>{t.name_zh} [{t.code}]</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{T("hr.approval.requestTypeLabel")}</label>
                <select className="w-full border rounded p-2" value={form.request_type} onChange={e => setForm({ ...form, request_type: e.target.value })}>
                  <option value="new">{T("hr.approval.newCert")}</option>
                  <option value="renewal">{T("hr.approval.renewal")}</option>
                  <option value="upgrade">{T("hr.approval.upgrade")}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{T("hr.approval.reason")}</label>
                <textarea className="w-full border rounded p-2" rows={2} value={form.request_reason} onChange={e => setForm({ ...form, request_reason: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded bg-gray-100">{T("hr.approval.cancel")}</button>
              <button onClick={handleNew} className="px-4 py-2 rounded bg-blue-600 text-white">{T("hr.approval.submit")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
