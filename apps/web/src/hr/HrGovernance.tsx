import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type GovernanceData = {
  metrics: { pending: number; appealed: number; approved: number; executed_today: number };
  responsibilities: Array<{
    id: number;
    versionNo: number;
    title: string;
    status: string;
    positionCode: string;
    positionName: string;
    acknowledged: number;
  }>;
  actions: Array<{
    id: number;
    actionNo: string;
    actionType: string;
    employeeCode: string;
    employeeName: string;
    reasonCode: string;
    riskLevel: string;
    status: string;
    requestedAt: string;
    requiredApprovals: string[];
    approvals: Array<{ role: string; decision: string }>;
  }>;
};

const actionTypes = [
  "REWARD", "WARNING", "PERFORMANCE_IMPROVEMENT", "PROMOTION", "DEMOTION",
  "SALARY_INCREASE", "SALARY_DECREASE", "TRANSFER", "OVERTIME", "LEAVE",
  "SUSPENSION", "TERMINATION", "RESIGNATION",
];

const labels = {
  "zh-CN": {
    title: "员工岗位责任与人事治理",
    subtitle: "岗位责任书、考核、奖励、晋升、调岗、调薪、加班、休假与离职闭环",
    search: "员工 / 单号 / 岗位",
    find: "查找",
    pending: "待审批",
    appealed: "申诉中",
    approved: "已批准",
    executed: "今日执行",
    create: "发起人事事项",
    employee: "员工数据库 ID",
    reasonCode: "原因代码",
    reason: "事实、依据和说明",
    submit: "提交审批",
    actions: "人事事项",
    noActions: "暂无事项",
    actionNo: "单号",
    action: "事项",
    risk: "风险",
    status: "状态",
    operation: "操作",
    approve: "批准",
    reject: "驳回",
    execute: "执行",
    responsibilities: "岗位责任书版本",
    position: "岗位",
    version: "版本",
    acknowledged: "已签收",
    noResponsibilities: "尚未发布责任书",
    submitted: "已提交审批",
  },
  "en-US": {
    title: "Job Responsibility & Personnel Governance",
    subtitle: "Controlled workflow for duties, appraisal, reward, promotion, transfer, pay, overtime, leave and separation",
    search: "Employee / action / position",
    find: "Search",
    pending: "Pending",
    appealed: "Appealed",
    approved: "Approved",
    executed: "Executed today",
    create: "Create personnel action",
    employee: "Employee database ID",
    reasonCode: "Reason code",
    reason: "Facts, evidence and explanation",
    submit: "Submit",
    actions: "Personnel actions",
    noActions: "No actions",
    actionNo: "Action No.",
    action: "Action",
    risk: "Risk",
    status: "Status",
    operation: "Operation",
    approve: "Approve",
    reject: "Reject",
    execute: "Execute",
    responsibilities: "Responsibility versions",
    position: "Position",
    version: "Version",
    acknowledged: "Acknowledged",
    noResponsibilities: "No responsibility document published",
    submitted: "Submitted for approval",
  },
  "vi-VN": {
    title: "Trách nhiệm công việc & quản trị nhân sự",
    subtitle: "Quy trình trách nhiệm, đánh giá, thưởng, thăng chức, điều chuyển, lương, tăng ca, nghỉ phép và thôi việc",
    search: "Nhân viên / phiếu / vị trí",
    find: "Tìm",
    pending: "Chờ duyệt",
    appealed: "Khiếu nại",
    approved: "Đã duyệt",
    executed: "Thực hiện hôm nay",
    create: "Tạo nghiệp vụ nhân sự",
    employee: "ID nhân viên",
    reasonCode: "Mã lý do",
    reason: "Sự việc, bằng chứng và giải thích",
    submit: "Gửi duyệt",
    actions: "Nghiệp vụ nhân sự",
    noActions: "Chưa có nghiệp vụ",
    actionNo: "Mã phiếu",
    action: "Nghiệp vụ",
    risk: "Rủi ro",
    status: "Trạng thái",
    operation: "Thao tác",
    approve: "Duyệt",
    reject: "Từ chối",
    execute: "Thực hiện",
    responsibilities: "Phiên bản trách nhiệm",
    position: "Vị trí",
    version: "Phiên bản",
    acknowledged: "Đã xác nhận",
    noResponsibilities: "Chưa phát hành tài liệu trách nhiệm",
    submitted: "Đã gửi duyệt",
  },
} as const;

export function HrGovernance({ locale }: { locale: Locale }) {
  const text = labels[locale];
  const [data, setData] = useState<GovernanceData | null>(null);
  const [queryText, setQueryText] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    employeeId: "",
    actionType: "REWARD",
    reasonCode: "",
    reasonDetail: "",
    effectiveDate: "",
  });

  const load = useCallback(async () => {
    try {
      const suffix = queryText ? `?q=${encodeURIComponent(queryText)}` : "";
      setData(await apiClient.get<GovernanceData>(`/hr/governance/dashboard${suffix}`));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [queryText]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      await apiClient.post("/hr/personnel-actions", {
        employeeId: Number(form.employeeId),
        actionType: form.actionType,
        reasonCode: form.reasonCode,
        reasonDetail: form.reasonDetail,
        effectiveDate: form.effectiveDate || null,
        actor: "HR",
      });
      setMessage(text.submitted);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const decide = async (id: number, role: string, decision: "APPROVE" | "REJECT") => {
    try {
      await apiClient.post(`/hr/personnel-actions/${id}/decision`, {
        decision,
        approvalRole: role,
        comment: "Dashboard review",
        actor: role,
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const execute = async (id: number) => {
    try {
      await apiClient.post(`/hr/personnel-actions/${id}/execute`, { actor: "HR" });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{text.title}</h2><p>{text.subtitle}</p></div>
          <div className="toolbar">
            <input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder={text.search} />
            <button onClick={() => void load()}>{text.find}</button>
          </div>
        </div>
        {message && <p>{message}</p>}
        <div className="metric-grid">
          {[
            [text.pending, data?.metrics.pending ?? 0],
            [text.appealed, data?.metrics.appealed ?? 0],
            [text.approved, data?.metrics.approved ?? 0],
            [text.executed, data?.metrics.executed_today ?? 0],
          ].map(([label, value]) => (
            <div className="metric-card" key={String(label)}><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><h3>{text.create}</h3></div>
        <div className="toolbar">
          <input value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} placeholder={text.employee} />
          <select value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value })}>
            {actionTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
          <input value={form.reasonCode} onChange={(event) => setForm({ ...form, reasonCode: event.target.value })} placeholder={text.reasonCode} />
          <input value={form.reasonDetail} onChange={(event) => setForm({ ...form, reasonDetail: event.target.value })} placeholder={text.reason} />
          <input type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} />
          <button className="action-button" onClick={() => void create()}>{text.submit}</button>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><h3>{text.actions}</h3></div>
        <div className="table-shell"><table>
          <thead><tr><th>{text.actionNo}</th><th>{text.employee}</th><th>{text.action}</th><th>{text.reasonCode}</th><th>{text.risk}</th><th>{text.status}</th><th>{text.operation}</th></tr></thead>
          <tbody>{data?.actions.length ? data.actions.map((item) => (
            <tr key={item.id}>
              <td>{item.actionNo}</td><td>{item.employeeCode} {item.employeeName}</td><td>{item.actionType}</td>
              <td>{item.reasonCode}</td><td>{item.riskLevel}</td><td><span className="badge badge-info">{item.status}</span></td>
              <td>
                {item.status === "PENDING_APPROVAL" && item.requiredApprovals
                  .filter((role) => !item.approvals.some((approval) => approval.role === role))
                  .map((role) => <span key={role}>
                    <button onClick={() => void decide(item.id, role, "APPROVE")}>{text.approve} · {role}</button>{" "}
                    <button onClick={() => void decide(item.id, role, "REJECT")}>{text.reject}</button>{" "}
                  </span>)}
                {item.status === "APPROVED" && <button onClick={() => void execute(item.id)}>{text.execute}</button>}
              </td>
            </tr>
          )) : <tr><td colSpan={7}>{text.noActions}</td></tr>}</tbody>
        </table></div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><h3>{text.responsibilities}</h3></div>
        <div className="table-shell"><table>
          <thead><tr><th>{text.position}</th><th>{text.title}</th><th>{text.version}</th><th>{text.status}</th><th>{text.acknowledged}</th></tr></thead>
          <tbody>{data?.responsibilities.length ? data.responsibilities.map((item) => (
            <tr key={item.id}><td>{item.positionCode} {item.positionName}</td><td>{item.title}</td><td>V{item.versionNo}</td><td>{item.status}</td><td>{item.acknowledged}</td></tr>
          )) : <tr><td colSpan={5}>{text.noResponsibilities}</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
