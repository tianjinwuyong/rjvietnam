import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { TeamworkMetric, EmployeeTeamworkRating, Employee } from "../api";

const LIGHT_CONFIG = {
  green: { label: "绿灯", color: "#22c55e", bg: "#22c55e22", desc: "表现良好，继续保持" },
  yellow: { label: "黄灯", color: "#f59e0b", bg: "#f59e0b22", desc: "部分指标需改善" },
  red: { label: "红灯", color: "#ef4444", bg: "#ef444422", desc: "多项指标未达标，需重点关注" },
};

interface Props { locale: Locale; }
export function HrTeamwork({ locale }: Props) {
  const [tab, setTab] = useState<"lightboard" | "ratings" | "metrics" | "assess">("lightboard");
  const [metrics, setMetrics] = useState<TeamworkMetric[]>([]);
  const [ratings, setRatings] = useState<EmployeeTeamworkRating[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [showAssess, setShowAssess] = useState(false);
  const [scoreInputs, setScoreInputs] = useState<Record<number, number>>({});

  useEffect(() => { loadMetrics(); loadEmployees(); loadRatings(); }, []);

  async function loadMetrics() {
    try {
      const res = await hrApi.getTeamworkMetrics();
      if (res?.items) setMetrics(res.items);
    } catch {}
  }

  async function loadEmployees() {
    try {
      const res = await hrApi.getEmployees({} as any);
      if (res?.data) setEmployees(res.data as Employee[]);
    } catch {}
  }

  async function loadRatings() {
    try {
      const res = await hrApi.getTeamworkRatings({ year, month });
      if (res?.items) setRatings(res.items);
    } catch {}
  }

  useEffect(() => { loadRatings(); }, [year, month]);

  async function handleAssess(employeeId: number) {
    const details = metrics.map(m => ({
      metric_id: m.id,
      metric_name_zh: m.name_zh,
      target_value: m.target_value || 0,
      actual_value: scoreInputs[m.id] ?? 0,
      metric_score: Math.min(100, (scoreInputs[m.id] ?? 0) / (m.target_value || 1) * 100),
    }));
    try {
      await hrApi.createTeamworkRating({ employee_id: employeeId, period_year: year, period_month: month, details });
      setShowAssess(false);
      setScoreInputs({});
      loadRatings();
    } catch (e) { console.error(e); }
  }

  const lightCounts = { green: 0, yellow: 0, red: 0 };
  for (const r of ratings) {
    if (r.light_status === "green") lightCounts.green++;
    else if (r.light_status === "yellow") lightCounts.yellow++;
    else if (r.light_status === "red") lightCounts.red++;
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        <h2>合作能力灯</h2>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          {(["lightboard","ratings","metrics","assess"] as const).map(k => (
            <button key={k} className={`btn-ghost ${tab===k ? "btn-active" : ""}`} onClick={() => setTab(k)}>
              {{ lightboard:"能力灯板", ratings:"评定记录", metrics:"指标定义", assess:"发起评定" }[k]}
            </button>
          ))}
        </div>
      </div>

      {tab === "lightboard" && (
        <div>
          {/* Light summary cards */}
          <div style={{display:"flex",gap:16,marginBottom:20}}>
            {(["green","yellow","red"] as const).map(light => (
              <div key={light} style={{
                flex:1, padding:"20px 24px", borderRadius:12,
                background: LIGHT_CONFIG[light].bg, border: `2px solid ${LIGHT_CONFIG[light].color}`,
                display:"flex", alignItems:"center", gap:16,
              }}>
                <div style={{width:48,height:48,borderRadius:"50%", background: LIGHT_CONFIG[light].color,
                  boxShadow: `0 0 20px ${LIGHT_CONFIG[light].color}88`, display:"flex", alignItems:"center", justifyContent:"center"}}>
                  <span style={{color:"white",fontWeight:700,fontSize:18}}>{lightCounts[light]}</span>
                </div>
                <div>
                  <div style={{color: LIGHT_CONFIG[light].color, fontWeight:700, fontSize:20}}>{LIGHT_CONFIG[light].label}</div>
                  <div style={{color:"#6b7280",fontSize:12}}>{LIGHT_CONFIG[light].desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Employee light grid */}
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
            </select>
            <span style={{marginLeft:8,color:"#6b7280"}}>{ratings.length} 人已评定</span>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:12}}>
            {ratings.map(r => {
              const lc = LIGHT_CONFIG[r.light_status as keyof typeof LIGHT_CONFIG] || LIGHT_CONFIG.green;
              return (
                <div key={r.id} style={{
                  border:"1px solid #e5e7eb", borderRadius:12, padding:16, textAlign:"center",
                  borderLeft: `4px solid ${lc.color}`,
                }}>
                  <div style={{
                    width:40, height:40, borderRadius:"50%", margin:"0 auto 8px",
                    background: lc.color, boxShadow: `0 0 12px ${lc.color}66`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    <span style={{color:"white",fontWeight:700,fontSize:14}}>{Math.round(r.overall_score)}</span>
                  </div>
                  <div style={{fontWeight:600,fontSize:14}}>{r.emp_name || "—"}</div>
                  <div style={{fontSize:11,color:"#6b7280"}}>{r.emp_no}</div>
                  <div style={{marginTop:4,fontSize:11,color:lc.color,fontWeight:600}}>{lc.label}</div>
                  <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{r.light_reason || ""}</div>
                </div>
              );
            })}
            {ratings.length === 0 && (
              <div style={{gridColumn:"1/-1",textAlign:"center",color:"#6b7280",padding:32}}>
                暂无评定数据，请在"发起评定"中创建
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ratings" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
            </select>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>总分</th><th>灯状态</th><th>说明</th><th>评定人</th><th>评定时间</th></tr></thead>
            <tbody>
              {ratings.map(r => {
                const lc = LIGHT_CONFIG[r.light_status as keyof typeof LIGHT_CONFIG] || LIGHT_CONFIG.green;
                return (
                  <tr key={r.id}>
                    <td><code>{r.emp_no}</code></td>
                    <td>{r.emp_name}</td>
                    <td><strong>{r.overall_score}</strong></td>
                    <td>
                      <span style={{ display:"inline-flex",alignItems:"center",gap:6, padding:"2px 10px", borderRadius:12, background:lc.bg, color:lc.color, fontWeight:700, fontSize:12 }}>
                        <span style={{width:8,height:8,borderRadius:"50%",background:lc.color}} />
                        {lc.label}
                      </span>
                    </td>
                    <td style={{fontSize:12,color:"#6b7280"}}>{r.light_reason || "—"}</td>
                    <td>{r.rater_name || "—"}</td>
                    <td>{r.rated_at ? r.rated_at.slice(0,16) : "—"}</td>
                  </tr>
                );
              })}
              {ratings.length === 0 && <tr><td colSpan={7} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "metrics" && (
        <table className="data-table">
          <thead><tr><th>指标代码</th><th>指标名称</th><th>描述</th><th>数据来源</th><th>目标值</th><th>最大</th><th>排序</th></tr></thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.id}>
                <td><code>{m.metric_code}</code></td>
                <td><strong>{m.name_zh}</strong></td>
                <td style={{fontSize:12,color:"#6b7280",maxWidth:300}}>{m.description || "—"}</td>
                <td>{{ manual:"手动", attendance:"考勤", mes:"MES", quality:"质量" }[m.data_source] || m.data_source}</td>
                <td>{m.target_value ?? "—"}</td>
                <td>{m.target_max ?? "—"}</td>
                <td>{m.sort_order}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "assess" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
            </select>
            <button className="btn-primary" style={{marginLeft:8}} onClick={() => setShowAssess(true)}>发起评定</button>
          </div>
          <table className="data-table">
            <thead><tr><th>指标</th><th>描述</th><th>数据来源</th><th>目标</th><th>最大值</th><th>实际值</th><th>得分</th></tr></thead>
            <tbody>
              {metrics.map(m => {
                const actual = scoreInputs[m.id] ?? 0;
                const target = m.target_value || 1;
                const sc = Math.min(100, Math.round((actual / target) * 100));
                return (
                  <tr key={m.id}>
                    <td><strong>{m.name_zh}</strong></td>
                    <td style={{fontSize:12,color:"#6b7280"}}>{m.description || "—"}</td>
                    <td>{m.data_source}</td>
                    <td>{m.target_value ?? "—"}</td>
                    <td>{m.target_max ?? "—"}</td>
                    <td>
                      <input type="number" className="field-input" style={{width:80}} min={0}
                        value={scoreInputs[m.id] ?? ""}
                        onChange={e => setScoreInputs(prev => ({...prev, [m.id]: parseFloat(e.target.value)||0}))}
                        placeholder="0" />
                    </td>
                    <td style={{color: sc >= 75 ? "#22c55e" : sc >= 60 ? "#f59e0b" : "#ef4444", fontWeight:700}}>{sc}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{marginTop:8,color:"#6b7280",fontSize:12}}>
            * 得分 = min(100, 实际值/目标值 × 100)，总分 = 平均得分，绿≥75/黄≥60/红&lt;60
          </div>
        </div>
      )}

      {showAssess && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:400,padding:24}}>
            <h3>选择评定员工</h3>
            <div className="field" style={{marginTop:12}}>
              <span>员工</span>
              <select className="field-input" id="tw-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowAssess(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const sel = document.getElementById("tw-emp") as HTMLSelectElement;
                if (!parseInt(sel.value)) return;
                handleAssess(parseInt(sel.value));
              }}>提交评定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
