import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type CaseRow = { id:number; caseNo:string; complaintText:string; allegationCategory:string; status:string; responseDueAt:string; managerExplanation?:string; reporterName?:string; subjectName?:string; lineCode?:string; hrFinding?:string; hrAction?:string };

export function HrGrievanceCases({ locale: _locale }: { locale: Locale }) {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [message, setMessage] = useState("");
  const reload = () => apiClient.get<CaseRow[]>("/hr/grievance-cases").then((r) => setRows(r ?? [])).catch((e) => setMessage(e.message ?? "MES/HR unavailable"));
  useEffect(() => { void reload(); }, []);
  const requestExplanation = async (id: number) => { await apiClient.post(`/hr/grievance-cases/${id}/request-explanation`); setMessage("已发送给线长，等待说明"); await reload(); };
  const resolveCase = async (row: CaseRow) => {
    const finding = window.prompt("HR调查结论");
    const action = window.prompt("纠正/预防措施");
    if (!finding || !action) return;
    await apiClient.post(`/hr/grievance-cases/${row.id}/resolve`, { payload: { hrFinding: finding, hrAction: action } });
    setMessage("已发送调查结果给员工，等待员工确认或申诉"); await reload();
  };
  return <div className="screen-stack">
    <section className="surface-panel"><div className="section-header"><div><h2>员工申诉 / HR调查闭环</h2><p>举报人信息仅 HR 可见；线长只能说明，不能修改投诉原文。</p></div></div>
      {message && <p>{message}</p>}
      <div className="table-shell"><table><thead><tr><th>案件</th><th>举报员工</th><th>被调查线长</th><th>产线</th><th>状态</th><th>期限</th><th>操作</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}><td><strong>{row.caseNo}</strong><br /><small>{row.allegationCategory}</small></td><td>{row.reporterName ?? "—"}</td><td>{row.subjectName ?? "—"}</td><td>{row.lineCode ?? "—"}</td><td><span className="badge badge-info">{row.status}</span></td><td>{row.responseDueAt}</td><td><button type="button" onClick={() => void requestExplanation(row.id)} disabled={row.status === "AWAITING_MANAGER_EXPLANATION"}>要求线长说明</button> <button type="button" onClick={() => void resolveCase(row)} disabled={row.status !== "HR_REVIEW"}>结案并发送员工</button></td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
