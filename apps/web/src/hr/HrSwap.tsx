import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { SwapRequest, SwapRecord, Employee } from "../api";

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b", approved: "#22c55e", rejected: "#ef4444", cancelled: "#6b7280",
};
const STATUS_MAP: Record<string, string> = {
  pending: "待审批", approved: "已批准", rejected: "已拒绝", cancelled: "已取消",
};

interface Props { locale: Locale; }
export function HrSwap({ locale }: Props) {
  const [tab, setTab] = useState<"requests" | "records">("requests");
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [records, setRecords] = useState<SwapRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadEmployees(); loadTab(); }, []);

  async function loadEmployees() {
    try {
      const res = await hrApi.getEmployees({} as any);
      if (res?.data) setEmployees(res.data as Employee[]);
    } catch {}
  }

  async function loadTab() {
    try {
      if (tab === "requests") {
        const res = await hrApi.getSwapRequests({});
        if (res?.items) setRequests(res.items);
      } else {
        const res = await hrApi.getSwapRecords({});
        if (res?.items) setRecords(res.items);
      }
    } catch {}
  }

  useEffect(() => { loadTab(); }, [tab]);

  async function handleCreate(payload: any) {
    try {
      await hrApi.createSwapRequest(payload);
      setShowCreate(false);
      loadTab();
    } catch (e) { console.error(e); }
  }

  async function handleApprove(id: number) {
    try {
      await hrApi.approveSwapRequest(id, {});
      loadTab();
    } catch (e) { console.error(e); }
  }

  async function handleReject(id: number) {
    const remark = window.prompt("请输入拒绝原因:");
    if (remark === null) return;
    try {
      await hrApi.rejectSwapRequest(id, remark);
      loadTab();
    } catch (e) { console.error(e); }
  }

  function StatusBadge({ status }: { status: string }) {
    const color = STATUS_COLORS[status] || "#6b7280";
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:600, fontSize:12 }}>
        {STATUS_MAP[status] || status}
      </span>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        <h2>替班管理</h2>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          <button className={`btn-ghost ${tab==="requests" ? "btn-active" : ""}`} onClick={() => setTab("requests")}>替班申请</button>
          <button className={`btn-ghost ${tab==="records" ? "btn-active" : ""}`} onClick={() => setTab("records")}>替班记录</button>
        </div>
      </div>

      {tab === "requests" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>发起替班</button>
          </div>
          <table className="data-table">
            <thead><tr><th>单号</th><th>申请人</th><th>原班日期</th><th>原班次</th><th>替班日期</th><th>替班次</th><th>替班人</th><th>原因</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id}>
                  <td><code style={{fontSize:11}}>{r.request_no}</code></td>
                  <td>{r.requester_name_zh}</td>
                  <td>{r.original_shift_date}</td>
                  <td>{{ day:"白班", night:"夜班", swing:"轮班" }[r.original_shift_type] || r.original_shift_type}</td>
                  <td>{r.target_shift_date}</td>
                  <td>{{ day:"白班", night:"夜班", swing:"轮班" }[r.target_shift_type] || r.target_shift_type}</td>
                  <td>{r.swap_partner_name_zh || "—"}</td>
                  <td style={{maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.reason_zh || "—"}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    {r.status === "pending" && (
                      <div style={{display:"flex",gap:4}}>
                        <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => handleApprove(r.id)}>批准</button>
                        <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => handleReject(r.id)}>拒绝</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={10} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "records" && (
        <table className="data-table">
          <thead><tr><th>申请人</th><th>原班日期</th><th>原班次</th><th>替班人</th><th>替班日期</th><th>替班次</th><th>实际出勤人</th><th>状态</th></tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td>{r.original_worker_name}</td>
                <td>{r.original_shift_date}</td>
                <td>{{ day:"白班", night:"夜班", swing:"轮班" }[r.original_shift_type] || r.original_shift_type}</td>
                <td>{r.swap_worker_name}</td>
                <td>{r.swap_shift_date}</td>
                <td>{{ day:"白班", night:"夜班", swing:"轮班" }[r.swap_shift_type] || r.swap_shift_type}</td>
                <td>{r.actual_performer_name || "—"}</td>
                <td><StatusBadge status={r.swap_status} /></td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
          </tbody>
        </table>
      )}

      {showCreate && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:480,padding:24}}>
            <h3>发起替班</h3>
            <div className="field" style={{marginTop:12}}><span>申请人</span>
              <select className="field-input" id="swp-req">
                <option value={0}>— 选择申请人 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>替班人</span>
              <select className="field-input" id="swp-partner">
                <option value={0}>— 选择替班人 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
              <div className="field"><span>原班日期</span><input className="field-input" type="date" id="swp-orig-date" /></div>
              <div className="field"><span>原班次</span>
                <select className="field-input" id="swp-orig-type">
                  <option value="day">白班</option><option value="night">夜班</option><option value="swing">轮班</option>
                </select>
              </div>
              <div className="field"><span>替班日期</span><input className="field-input" type="date" id="swp-tgt-date" /></div>
              <div className="field"><span>替班次</span>
                <select className="field-input" id="swp-tgt-type">
                  <option value="day">白班</option><option value="night">夜班</option><option value="swing">轮班</option>
                </select>
              </div>
            </div>
            <div className="field" style={{marginTop:12}}><span>原因</span>
              <input className="field-input" id="swp-reason" placeholder="请输入替班原因" />
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const reqSel = document.getElementById("swp-req") as HTMLSelectElement;
                const partnerSel = document.getElementById("swp-partner") as HTMLSelectElement;
                const origDate = (document.getElementById("swp-orig-date") as HTMLInputElement).value;
                const tgtDate = (document.getElementById("swp-tgt-date") as HTMLInputElement).value;
                const origType = (document.getElementById("swp-orig-type") as HTMLSelectElement).value;
                const tgtType = (document.getElementById("swp-tgt-type") as HTMLSelectElement).value;
                const reason = (document.getElementById("swp-reason") as HTMLInputElement).value;
                if (!parseInt(reqSel.value) || !origDate || !tgtDate) return;
                handleCreate({ requester_id: parseInt(reqSel.value), swap_partner_id: parseInt(partnerSel.value)||undefined,
                  original_shift_date: origDate, original_shift_type: origType, target_shift_date: tgtDate, target_shift_type: tgtType, reason_zh: reason });
              }}>提交申请</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
