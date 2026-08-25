import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { OtPayRule, OtRecord, Employee } from "../api";

const OT_TYPE_MAP: Record<string, string> = {
  weekday: "平日加班", weekday_excess: "平日超2h", weekend: "周末加班", holiday: "节假日加班", night: "夜班补贴", legal_holiday: "法定节假日调休"
};

interface Props { locale: Locale; }
export function HrOtPay({ locale }: Props) {
  const [rules, setRules] = useState<OtPayRule[]>([]);
  const [records, setRecords] = useState<OtRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<"records" | "rules">("records");

  useEffect(() => { loadRules(); loadEmployees(); }, []);

  async function loadRules() {
    try {
      const res = await hrApi.getOtRules();
      if (res?.items) setRules(res.items);
    } catch {}
  }

  async function loadEmployees() {
    try {
      const res = await hrApi.getEmployees({} as any);
      if (res?.data) setEmployees(res.data as Employee[]);
    } catch {}
  }

  async function loadRecords() {
    try {
      const res = await hrApi.getOtRecords({ applied_month: `${year}-${String(month).padStart(2,'0')}` });
      if (res?.items) setRecords(res.items);
    } catch {}
  }

  useEffect(() => { if (tab === "records") loadRecords(); }, [tab, year, month]);

  async function handleCreate(payload: any) {
    try {
      await hrApi.createOtRecord(payload);
      setShowCreate(false);
      loadRecords();
    } catch (e) { console.error(e); }
  }

  const totalOtPay = records.reduce((sum, r) => sum + (r.total_pay || 0), 0);
  const totalOtHours = records.reduce((sum, r) => sum + (r.ot_hours || 0), 0);

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        <h2>加班薪资</h2>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          <button className={`btn-ghost ${tab==="records" ? "btn-active" : ""}`} onClick={() => setTab("records")}>加班记录</button>
          <button className={`btn-ghost ${tab==="rules" ? "btn-active" : ""}`} onClick={() => setTab("rules")}>加班规则</button>
        </div>
      </div>

      {tab === "records" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
            </select>
            <div style={{marginLeft:16,display:"flex",gap:16}}>
              <span style={{color:"#f59e0b",fontWeight:600}}>总加班: {totalOtHours}h</span>
              <span style={{color:"#22c55e",fontWeight:600}}>总加班费: {totalOtPay.toLocaleString()} VND</span>
            </div>
            <button className="btn-primary" style={{marginLeft:"auto"}} onClick={() => setShowCreate(true)}>新增加班记录</button>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>加班日期</th><th>加班类型</th><th>加班小时</th><th>时基薪资</th><th>倍数</th><th>加班费</th><th>夜班补贴</th><th>合计</th><th>状态</th></tr></thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}>
                  <td><code>{r.emp_no}</code></td>
                  <td>{r.emp_name}</td>
                  <td>{r.ot_date}</td>
                  <td><span style={{color: r.ot_type==='holiday'?'#ef4444': r.ot_type==='weekend'?'#3b82f6':'#6b7280',fontWeight:600}}>{OT_TYPE_MAP[r.ot_type] || r.ot_type}</span></td>
                  <td>{r.ot_hours}h</td>
                  <td>{r.hourly_base.toLocaleString()}</td>
                  <td>{r.multiplier}x</td>
                  <td style={{color:"#22c55e"}}>{r.ot_pay_amount.toLocaleString()}</td>
                  <td style={{color:"#f59e0b"}}>{r.night_allowance > 0 ? r.night_allowance.toLocaleString() : "—"}</td>
                  <td style={{color:"#22c55e",fontWeight:700}}>{r.total_pay.toLocaleString()}</td>
                  <td><span style={{ display:"inline-block", padding:"2px 8px", borderRadius:12, background: r.status==='approved'?'#22c55e22':'#f59e0b22', color: r.status==='approved'?'#22c55e':'#f59e0b', fontWeight:600, fontSize:12 }}>{r.status==='approved'?"已批准":"待审批"}</span></td>
                </tr>
              ))}
              {records.length === 0 && <tr><td colSpan={11} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "rules" && (
        <div>
          <h3 style={{marginBottom:12}}>加班薪资规则</h3>
          <table className="data-table">
            <thead><tr><th>规则代码</th><th>规则名称</th><th>加班类型</th><th>倍数</th><th>夜班补贴</th><th>最小小时</th><th>生效日期</th><th>状态</th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td><code>{r.rule_code}</code></td>
                  <td>{r.name_zh}</td>
                  <td><span style={{fontWeight:600}}>{OT_TYPE_MAP[r.ot_type] || r.ot_type}</span></td>
                  <td><strong style={{color:"#22c55e"}}>{r.multiplier}x</strong></td>
                  <td style={{color:"#f59e0b"}}>{r.night_allowance > 0 ? r.night_allowance.toLocaleString() + " VND" : "—"}</td>
                  <td>{r.min_hours > 0 ? r.min_hours + "h" : "无限制"}</td>
                  <td>{r.effective_from}</td>
                  <td><span style={{ display:"inline-block", padding:"2px 8px", borderRadius:12, background: r.is_active?"#22c55e22":"#ef444422", color: r.is_active?"#22c55e":"#ef4444", fontWeight:600, fontSize:12 }}>{r.is_active?"启用":"停用"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:480,padding:24}}>
            <h3>新增加班记录</h3>
            <div className="field" style={{marginTop:12}}><span>员工</span>
              <select className="field-input" id="ot-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>加班日期</span>
              <input className="field-input" type="date" id="ot-date" defaultValue={new Date().toISOString().slice(0,10)} />
            </div>
            <div className="field" style={{marginTop:12}}><span>加班类型</span>
              <select className="field-input" id="ot-type">
                <option value="weekday">平日加班</option><option value="weekend">周末加班</option><option value="holiday">节假日加班</option>
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
              <div className="field"><span>加班小时</span><input className="field-input" type="number" id="ot-hours" step="0.5" placeholder="0" /></div>
              <div className="field"><span>时基薪资(VND)</span><input className="field-input" type="number" id="ot-base" placeholder="30000" /></div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const empSel = document.getElementById("ot-emp") as HTMLSelectElement;
                const dateSel = (document.getElementById("ot-date") as HTMLInputElement).value;
                const typeSel = (document.getElementById("ot-type") as HTMLSelectElement).value;
                const hoursSel = parseFloat((document.getElementById("ot-hours") as HTMLInputElement).value) || 0;
                const baseSel = parseFloat((document.getElementById("ot-base") as HTMLInputElement).value) || 30000;
                if (!parseInt(empSel.value) || !dateSel || hoursSel <= 0) return;
                handleCreate({ employee_id: parseInt(empSel.value), ot_date: dateSel, ot_type: typeSel, ot_hours: hoursSel, hourly_base: baseSel });
              }}>确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
