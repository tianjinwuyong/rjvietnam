import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { SkillCategory, SkillLevel, SkillItem, EmployeeSkillRating, Employee } from "../api";

const LEVEL_COLORS: Record<string, string> = {
  "SMT-L1":"#6b7280", "QA-L1":"#6b7280", "MNT-L1":"#6b7280", "SAF-L1":"#6b7280", "LEAD-L1":"#6b7280",
  "SMT-L2":"#3b82f6", "QA-L2":"#3b82f6", "MNT-L2":"#3b82f6", "SAF-L2":"#3b82f6", "LEAD-L2":"#3b82f6",
  "SMT-L3":"#f59e0b", "QA-L3":"#f59e0b", "MNT-L3":"#f59e0b", "SAF-L3":"#22c55e",
  "SMT-L4":"#22c55e", "QA-L4":"#22c55e", "MNT-L4":"#22c55e",
  "LEAD-L3":"#22c55e",
};

interface Props { locale: Locale; }
export function HrSkillRating({ locale }: Props) {
  const [tab, setTab] = useState<"categories" | "ratings" | "rate">("categories");
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [levels, setLevels] = useState<SkillLevel[]>([]);
  const [items, setItems] = useState<SkillItem[]>([]);
  const [ratings, setRatings] = useState<EmployeeSkillRating[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number>(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [showRateModal, setShowRateModal] = useState(false);
  const [scoreInputs, setScoreInputs] = useState<Record<number, number>>({});

  useEffect(() => { loadCategories(); loadEmployees(); loadRatings(); }, []);

  async function loadCategories() {
    try {
      const res = await hrApi.getSkillCategories();
      if (res?.items) { setCategories(res.items); if (res.items.length > 0) setSelectedCatId(res.items[0].id); }
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
      const res = await hrApi.getSkillRatings({ year, month });
      if (res?.items) setRatings(res.items);
    } catch {}
  }

  async function loadLevelsAndItems(catId: number) {
    try {
      const [lRes, iRes] = await Promise.all([
        hrApi.getSkillLevels(catId),
        hrApi.getSkillItems(catId),
      ]);
      if (lRes?.items) setLevels(lRes.items);
      if (iRes?.items) { setItems(iRes.items); setScoreInputs({}); }
    } catch {}
  }

  useEffect(() => {
    if (selectedCatId > 0) loadLevelsAndItems(selectedCatId);
  }, [selectedCatId]);

  useEffect(() => { loadRatings(); }, [year, month]);

  async function handleRate(employeeId: number) {
    const details = items.map(item => ({
      skill_item_id: item.id,
      item_name_zh: item.item_name_zh,
      max_score: item.max_score,
      actual_score: scoreInputs[item.id] ?? 0,
      weight: item.weight,
      data_source: item.data_source || "manual",
    }));
    try {
      await hrApi.createSkillRating({ employee_id: employeeId, category_id: selectedCatId, period_year: year, period_month: month, details });
      setShowRateModal(false);
      loadRatings();
    } catch (e) { console.error(e); }
  }

  function LevelBadge({ levelName }: { levelName: string }) {
    const color = LEVEL_COLORS[levelName] || "#6b7280";
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:700, fontSize:12 }}>
        {levelName || "未评级"}
      </span>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        <h2>技能评分</h2>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          {(["categories","ratings","rate"] as const).map(k => (
            <button key={k} className={`btn-ghost ${tab===k ? "btn-active" : ""}`} onClick={() => setTab(k)}>
              {{ categories:"等级标准", ratings:"评定记录", rate:"发起评定" }[k]}
            </button>
          ))}
        </div>
      </div>

      {tab === "categories" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            {categories.map(c => (
              <div key={c.id} style={{
                border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 16px",cursor:"pointer",
                background: selectedCatId === c.id ? "#eff6ff" : "white",
                borderColor: selectedCatId === c.id ? "#3b82f6" : "#e5e7eb",
              }} onClick={() => setSelectedCatId(c.id)}>
                <strong>{c.name_zh}</strong>
                <div style={{fontSize:12,color:"#6b7280"}}>{c.item_count || 0}项指标</div>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:16}}>
            <div>
              <h3>技能等级</h3>
              <table className="data-table">
                <thead><tr><th>等级代码</th><th>等级名称</th><th>分数区间</th><th>薪资系数</th><th>说明</th></tr></thead>
                <tbody>
                  {levels.map(l => (
                    <tr key={l.id}>
                      <td><strong>{l.level_code}</strong></td>
                      <td>{l.level_name_zh}</td>
                      <td>{l.score_min} - {l.score_max}</td>
                      <td style={{color:"#22c55e",fontWeight:700}}>{l.salary_ratio}x</td>
                      <td style={{fontSize:12,color:"#6b7280"}}>{l.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>评定指标 (权重)</h3>
              <table className="data-table">
                <thead><tr><th>工位</th><th>指标名称</th><th>指标英文</th><th>满分</th><th>权重</th><th>数据来源</th></tr></thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.id}>
                      <td>{i.station_name_zh || "通用"}</td>
                      <td>{i.item_name_zh}</td>
                      <td style={{fontSize:11,color:"#6b7280"}}>{i.item_name_en || "—"}</td>
                      <td>{i.max_score}</td>
                      <td>{i.weight}</td>
                      <td>{{ mes:"MES", manual:"手动", attendance:"考勤", safety:"安全", quality:"质量" }[i.data_source||""] || i.data_source || "manual"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <thead><tr><th>工号</th><th>姓名</th><th>技能类别</th><th>总分</th><th>等级</th><th>评定人</th><th>评定时间</th><th>状态</th></tr></thead>
            <tbody>
              {ratings.map(r => (
                <tr key={r.id}>
                  <td><code>{r.emp_no}</code></td>
                  <td>{r.emp_name}</td>
                  <td>{r.category_name_zh}</td>
                  <td><strong>{r.total_score}</strong></td>
                  <td><LevelBadge levelName={r.skill_level_name || ""} /></td>
                  <td>{r.rater_name || "—"}</td>
                  <td>{r.rated_at ? r.rated_at.slice(0,16) : "—"}</td>
                  <td><span style={{ display:"inline-block", padding:"2px 8px", borderRadius:12, background: r.status==='published'?'#22c55e22':'#f59e0b22', color: r.status==='published'?'#22c55e':'#f59e0b', fontWeight:600, fontSize:12 }}>{r.status}</span></td>
                </tr>
              ))}
              {ratings.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",color:"#6b7280"}}>暂无评定记录</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "rate" && (
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
            <span style={{marginLeft:16}}>类别:</span>
            <select className="field-input" style={{width:160}} value={selectedCatId} onChange={e => setSelectedCatId(Number(e.target.value))}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name_zh}</option>)}
            </select>
            <button className="btn-primary" style={{marginLeft:8}} onClick={() => setShowRateModal(true)}>评定</button>
          </div>
          <table className="data-table">
            <thead><tr><th>指标名称</th><th>工位</th><th>满分</th><th>权重</th><th>数据来源</th><th>得分</th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td>{i.item_name_zh}</td>
                  <td>{i.station_name_zh || "通用"}</td>
                  <td>{i.max_score}</td>
                  <td>{i.weight}</td>
                  <td>{{ mes:"MES", manual:"手动", attendance:"考勤", safety:"安全", quality:"质量" }[i.data_source||""] || "manual"}</td>
                  <td>
                    <input type="number" className="field-input" style={{width:80}} min={0} max={i.max_score}
                      value={scoreInputs[i.id] ?? ""}
                      onChange={e => setScoreInputs(prev => ({...prev, [i.id]: parseFloat(e.target.value)||0}))}
                      placeholder="0" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:8,color:"#6b7280",fontSize:12}}>
            * 加权总分 = Σ(得分 × 权重)，系统自动根据分数匹配等级
          </div>
        </div>
      )}

      {showRateModal && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:400,padding:24}}>
            <h3>选择评定员工</h3>
            <div className="field" style={{marginTop:12}}>
              <span>员工</span>
              <select className="field-input" id="skill-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowRateModal(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const sel = document.getElementById("skill-emp") as HTMLSelectElement;
                if (!parseInt(sel.value)) return;
                handleRate(parseInt(sel.value));
              }}>提交评定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
