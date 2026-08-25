import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { OnboardingEmployee, OnboardingTaskInstance, OffboardingEmployee, OffboardingTaskInstance, OnboardingTemplate, Employee } from "../api";

type Tab = "onboarding" | "offboarding";

const STATUS_COLORS: Record<string, string> = {
  pending: "#6b7280", in_progress: "#f59e0b", completed: "#22c55e", extended: "#3b82f6",
};

function localeName(locale: Locale, zh: string, _en: string, vi: string) {
  return locale === "zh-CN" ? zh : vi;
}

interface Props { locale: Locale; }

export function HrLifecycle({ locale }: Props) {
  const [tab, setTab] = useState<Tab>("onboarding");
  const [onboardingEmps, setOnboardingEmps] = useState<OnboardingEmployee[]>([]);
  const [offboardingEmps, setOffboardingEmps] = useState<OffboardingEmployee[]>([]);
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<number>(0);
  const [onbTasks, setOnbTasks] = useState<OnboardingTaskInstance[]>([]);
  const [offTasks, setOffTasks] = useState<OffboardingTaskInstance[]>([]);
  const [showStartModal, setShowStartModal] = useState(false);
  const [startType, setStartType] = useState<"on" | "off">("on");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [tRes, eRes] = await Promise.all([
        hrApi.getOnboardingTemplates(),
        hrApi.getEmployees({} as any),
      ]);
      if (tRes?.data) setTemplates(tRes.data as OnboardingTemplate[]);
      if (eRes?.data) setEmployees(eRes.data as Employee[]);
    } catch {}
    loadOnboarding();
    loadOffboarding();
  }

  async function loadOnboarding() {
    try {
      const res = await hrApi.getOnboardingEmployees({});
      if (res?.data) setOnboardingEmps(res.data as OnboardingEmployee[]);
    } catch {}
  }

  async function loadOffboarding() {
    try {
      const res = await hrApi.getOffboardingEmployees({});
      if (res?.data) setOffboardingEmps(res.data as OffboardingEmployee[]);
    } catch {}
  }

  async function loadOnbTasks(empId: number) {
    setSelectedEmpId(empId);
    try {
      const res = await hrApi.getOnboardingTasks(empId);
      if (res?.data) setOnbTasks(res.data as OnboardingTaskInstance[]);
    } catch {}
  }

  async function loadOffTasks(empId: number) {
    setSelectedEmpId(empId);
    try {
      const res = await hrApi.getOffboardingTasks(empId);
      if (res?.data) setOffTasks(res.data as OffboardingTaskInstance[]);
    } catch {}
  }

  async function handleStartOnboarding(empId: number, templateId: number | undefined, joinDate: string, mentorId: number | undefined) {
    try {
      await hrApi.startOnboarding(empId, { template_id: templateId, join_date: joinDate, mentor_id: mentorId });
      setShowStartModal(false);
      loadOnboarding();
    } catch (e) { console.error(e); }
  }

  async function handleStartOffboarding(empId: number, templateId: number | undefined, terminationType: string, lastWorkDate: string) {
    try {
      await hrApi.startOffboarding(empId, { template_id: templateId, termination_type: terminationType, last_work_date: lastWorkDate });
      setShowStartModal(false);
      loadOffboarding();
    } catch (e) { console.error(e); }
  }

  async function handleCompleteTask(taskId: number, type: "on" | "off") {
    try {
      if (type === "on") {
        await hrApi.completeOnboardingTask(taskId, {});
        if (selectedEmpId) loadOnbTasks(selectedEmpId);
        loadOnboarding();
      } else {
        await hrApi.completeOffboardingTask(taskId, {});
        if (selectedEmpId) loadOffTasks(selectedEmpId);
        loadOffboarding();
      }
    } catch (e) { console.error(e); }
  }

  function TaskRow({ task, type, onComplete }: { task: any; type: "on" | "off"; onComplete: (id: number) => void }) {
    const color = STATUS_COLORS[task.status] || "#6b7280";
    const isPending = task.status === "pending";
    return (
      <tr>
        <td>{task.task_name_zh}</td>
        <td>{{ paperwork:" paperwork",system:"系统",equipment:"设备",training:"培训",access:"权限",orientation:" orientation",other:"其他",knowledge:"知识",finance:"财务",hr:"HR",it:"IT" }[task.task_category] || task.task_category}</td>
        <td>{task.assignee_name || task.assignee_role}</td>
        <td>{task.due_date}</td>
        <td>
          <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:600, fontSize:12 }}>
            {{ pending:"待处理",in_progress:"进行中",completed:"已完成",skipped:"已跳过" }[task.status] || task.status}
          </span>
        </td>
        <td>{task.completed_at ? task.completed_at.slice(0,10) : "—"}</td>
        <td>{task.remarks || "—"}</td>
        <td>
          {isPending && (
            <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => onComplete(task.id)}>完成</button>
          )}
        </td>
      </tr>
    );
  }

  const ONBOARDING_STATUS_MAP: Record<string, string> = { pending:"待入职", in_progress:"入职中", completed:"已完成", extended:"延期" };
  const OFFBOARDING_STATUS_MAP: Record<string, string> = { pending:"办理中", in_progress:"办理中", completed:"已完成" };
  const TERMINATION_MAP: Record<string, string> = { voluntary:"主动离职", dismissal:"辞退", retirement:"退休" };

  function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
    const color = STATUS_COLORS[status] || "#6b7280";
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:600, fontSize:12 }}>
        {map[status] || status}
      </span>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <h2>入离职管理</h2>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          <button className={`btn-ghost ${tab === "onboarding" ? "btn-active" : ""}`} onClick={() => { setTab("onboarding"); setSelectedEmpId(0); }}>
            入职
          </button>
          <button className={`btn-ghost ${tab === "offboarding" ? "btn-active" : ""}`} onClick={() => { setTab("offboarding"); setSelectedEmpId(0); }}>
            离职
          </button>
        </div>
      </div>

      {tab === "onboarding" && !selectedEmpId && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn-primary" onClick={() => { setStartType("on"); setShowStartModal(true); }}>发起入职</button>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>入职日期</th><th>导师</th><th>试用期结束</th><th>总体状态</th><th>详情</th></tr></thead>
            <tbody>
              {onboardingEmps.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.employee_no}</code></td>
                  <td>{e.employee_name_zh}</td>
                  <td>{e.dept_name_zh}</td>
                  <td>{e.join_date}</td>
                  <td>{e.mentor_name_zh || "—"}</td>
                  <td>{e.probation_end_date || "—"}</td>
                  <td><StatusBadge status={e.overall_status} map={ONBOARDING_STATUS_MAP} /></td>
                  <td>
                    <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => loadOnbTasks(e.employee_id)}>查看任务</button>
                  </td>
                </tr>
              ))}
              {onboardingEmps.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",color:"#6b7280"}}>暂无入职记录</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "onboarding" && selectedEmpId > 0 && (
        <div>
          <button className="btn-ghost" style={{marginBottom:12}} onClick={() => setSelectedEmpId(0)}>← 返回列表</button>
          <table className="data-table">
            <thead><tr><th>任务名称</th><th>类别</th><th>负责人</th><th>截止日期</th><th>状态</th><th>完成时间</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>
              {onbTasks.map(t => <TaskRow key={t.id} task={t} type="on" onComplete={id => handleCompleteTask(id, "on")} />)}
              {onbTasks.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",color:"#6b7280"}}>暂无任务</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "offboarding" && !selectedEmpId && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn-primary" onClick={() => { setStartType("off"); setShowStartModal(true); }}>发起离职</button>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>离职类型</th><th>最后工作日</th><th>离职面谈</th><th>结算日期</th><th>总体状态</th><th>详情</th></tr></thead>
            <tbody>
              {offboardingEmps.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.employee_no}</code></td>
                  <td>{e.employee_name_zh}</td>
                  <td>{e.dept_name_zh}</td>
                  <td>{TERMINATION_MAP[e.termination_type] || e.termination_type}</td>
                  <td>{e.last_work_date}</td>
                  <td>{e.exit_interview_date || "—"}</td>
                  <td>{e.final_settlement_date || "—"}</td>
                  <td><StatusBadge status={e.overall_status} map={OFFBOARDING_STATUS_MAP} /></td>
                  <td>
                    <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => loadOffTasks(e.employee_id)}>查看任务</button>
                  </td>
                </tr>
              ))}
              {offboardingEmps.length === 0 && <tr><td colSpan={9} style={{textAlign:"center",color:"#6b7280"}}>暂无离职记录</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "offboarding" && selectedEmpId > 0 && (
        <div>
          <button className="btn-ghost" style={{marginBottom:12}} onClick={() => setSelectedEmpId(0)}>← 返回列表</button>
          <table className="data-table">
            <thead><tr><th>任务名称</th><th>类别</th><th>负责人</th><th>截止日期</th><th>状态</th><th>完成时间</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>
              {offTasks.map(t => <TaskRow key={t.id} task={t} type="off" onComplete={id => handleCompleteTask(id, "off")} />)}
              {offTasks.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",color:"#6b7280"}}>暂无任务</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showStartModal && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:420,padding:24}}>
            <h3>{startType === "on" ? "发起入职" : "发起离职"}</h3>
            <div className="field" style={{marginTop:12}}>
              <span>员工</span>
              <select className="field-input" id="lc-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}>
              <span>模板</span>
              <select className="field-input" id="lc-tpl">
                <option value={0}>— 无模板 —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{localeName(locale, t.name_zh, t.name_en, t.name_vi)}</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}>
              <span>{startType === "on" ? "入职日期" : "最后工作日"}</span>
              <input className="field-input" type="date" id="lc-date" defaultValue={new Date().toISOString().slice(0,10)} />
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowStartModal(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const empSel = document.getElementById("lc-emp") as HTMLSelectElement;
                const tplSel = document.getElementById("lc-tpl") as HTMLSelectElement;
                const dateInput = document.getElementById("lc-date") as HTMLInputElement;
                const empId = parseInt(empSel.value);
                if (!empId) return;
                const tplId = parseInt(tplSel.value) || undefined;
                const date = dateInput.value;
                if (startType === "on") handleStartOnboarding(empId, tplId, date, undefined);
                else handleStartOffboarding(empId, tplId, "voluntary", date);
              }}>确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// @ts-nocheck
