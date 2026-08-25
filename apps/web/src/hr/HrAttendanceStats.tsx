import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import { t } from "../i18n";
import type {
  AttendanceMonthlyStat, AttendanceRule, PerfKpiTemplate, PerfKpiTemplateItem,
  EmpKpiResult, PerfScoreSummary, RewardCategory, EmployeeReward, PeriodicBonus,
  Employee,
} from "../api";

type Tab = "attStats" | "kpi" | "rewards" | "bonus";

const RATING_COLORS: Record<string, string> = {
  S:"#22c55e", A:"#3b82f6", B:"#f59e0b", C:"#f97316", D:"#ef4444",
};
const STATUS_COLORS: Record<string, string> = {
  pending:"#6b7280", in_progress:"#f59e0b", completed:"#22c55e",
  draft:"#6b7280", approved:"#3b82f6", paid:"#22c55e", cancelled:"#ef4444",
  unpaid:"#f59e0b",
};

interface Props { locale: Locale; }

export function HrAttendanceStats({ locale }: Props) {
  const [tab, setTab] = useState<Tab>("attStats");
  const [stats, setStats] = useState<AttendanceMonthlyStat[]>([]);
  const [rules, setRules] = useState<AttendanceRule[]>([]);
  const [kpiTemplates, setKpiTemplates] = useState<PerfKpiTemplate[]>([]);
  const [kpiItems, setKpiItems] = useState<PerfKpiTemplateItem[]>([]);
  const [kpiResults, setKpiResults] = useState<EmpKpiResult[]>([]);
  const [perfSummary, setPerfSummary] = useState<PerfScoreSummary[]>([]);
  const [rewardCats, setRewardCats] = useState<RewardCategory[]>([]);
  const [rewards, setRewards] = useState<EmployeeReward[]>([]);
  const [bonuses, setBonuses] = useState<PeriodicBonus[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);

  useEffect(() => { loadEmployees(); loadRules(); loadRewardCats(); }, []);

  async function loadEmployees() {
    try {
      const res = await hrApi.getEmployees({} as any);
      if (res?.data) setEmployees(res.data as Employee[]);
    } catch {}
  }

  async function loadRules() {
    try {
      const res = await hrApi.getAttendanceRules();
      if (res?.data) setRules(res.data as AttendanceRule[]);
    } catch {}
  }

  async function loadRewardCats() {
    try {
      const res = await hrApi.getRewardCategories();
      if (res?.data) setRewardCats(res.data as RewardCategory[]);
    } catch {}
  }

  async function loadTab(t: Tab) {
    if (t === "attStats") {
      const res = await hrApi.getAttendanceStats({ year, month });
      if (res?.data) setStats(res.data as AttendanceMonthlyStat[]);
    } else if (t === "kpi") {
      const [tRes, sRes] = await Promise.all([
        hrApi.getPerfKpiTemplates(),
        hrApi.getPerfSummary({ year, month }),
      ]);
      if (tRes?.data) setKpiTemplates(tRes.data as PerfKpiTemplate[]);
      if (sRes?.data) setPerfSummary(sRes.data as PerfScoreSummary[]);
    } else if (t === "rewards") {
      const res = await hrApi.getRewards({ year, month: month || undefined });
      if (res?.data) setRewards(res.data as EmployeeReward[]);
    } else if (t === "bonus") {
      const res = await hrApi.getPeriodicBonuses({ year });
      if (res?.data) setBonuses(res.data as PeriodicBonus[]);
    }
  }

  useEffect(() => { loadTab(tab); }, [tab, year, month]);

  async function computeAttStats() {
    try {
      await hrApi.computeAttendanceStats(year, month);
      loadTab("attStats");
    } catch (e) { console.error(e); }
  }

  async function computePerfSummary() {
    try {
      await hrApi.computePerfSummary(year, month);
      loadTab("kpi");
    } catch (e) { console.error(e); }
  }

  async function handleCreateReward(payload: any) {
    try {
      await hrApi.createReward(payload);
      setShowRewardModal(false);
      loadTab("rewards");
    } catch (e) { console.error(e); }
  }

  async function handleUpdateRewardPayment(id: number, payment_status: string) {
    try {
      await hrApi.updateRewardPayment(id, payment_status);
      loadTab("rewards");
    } catch (e) { console.error(e); }
  }

  async function handleCreateBonus(payload: any) {
    try {
      await hrApi.createPeriodicBonus(payload);
      setShowBonusModal(false);
      loadTab("bonus");
    } catch (e) { console.error(e); }
  }

  async function handleUpdateBonusStatus(id: number, status: string) {
    try {
      await hrApi.updatePeriodicBonusStatus(id, status);
      loadTab("bonus");
    } catch (e) { console.error(e); }
  }

  function RatingBadge({ rating }: { rating: string }) {
    const color = RATING_COLORS[rating] || "#6b7280";
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:700, fontSize:12 }}>
        {rating}
      </span>
    );
  }

  function StatusBadge({ status, map }: { status: string; map?: Record<string, string> }) {
    const color = STATUS_COLORS[status] || "#6b7280";
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:600, fontSize:12 }}>
        {(map || {})[status] || status}
      </span>
    );
  }

  const PAYMENT_MAP: Record<string, string> = { unpaid: t("hr.attStats.unpaid", locale), paid: t("hr.attStats.paid", locale), cancelled: t("hr.attStats.cancelled", locale) };
  const BONUS_STATUS_MAP: Record<string, string> = { pending: t("hr.attStats.pending", locale), approved: t("hr.attStats.approved", locale), paid: t("hr.attStats.paid", locale), cancelled: t("hr.attStats.cancelled", locale) };
  const BONUS_TYPE_MAP: Record<string, string> = { quarter: t("hr.attStats.quarter", locale), year: t("hr.attStats.yearEnd", locale), project: t("hr.attStats.project", locale), performance: t("hr.attStats.performance", locale) };

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <h2>{t("hr.attStats.title", locale)}</h2>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["attStats","kpi","rewards","bonus"] as Tab[]).map((k) => (
            <button key={k} className={`btn-ghost ${tab === k ? "btn-active" : ""}`} onClick={() => setTab(k)}>
              {k === "attStats" ? t("hr.attStats.tabAtt", locale) : k === "kpi" ? t("hr.attStats.tabKpi", locale) : k === "rewards" ? t("hr.attStats.tabRewards", locale) : t("hr.attStats.tabBonus", locale)}
            </button>
          ))}
        </div>
      </div>

      {tab === "attStats" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
            </select>
            <button className="btn-primary" style={{marginLeft:8}} onClick={computeAttStats}>计算统计</button>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>正常</th><th>缺勤</th><th>迟到</th><th>早退</th><th>加班(h)</th><th>出勤率%</th><th>准时率%</th></tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.employee_no}</code></td>
                  <td>{s.emp_name}</td>
                  <td>{s.dept_name}</td>
                  <td>{s.normal_days}</td>
                  <td style={{color: s.absent_days > 0 ? "#ef4444" : undefined}}>{s.absent_days}</td>
                  <td style={{color: s.late_count > 0 ? "#f59e0b" : undefined}}>{s.late_count}次/{s.late_minutes}分</td>
                  <td>{s.early_count}次</td>
                  <td>{s.ot_hours}</td>
                  <td style={{color: s.attendance_rate < 95 ? "#f59e0b" : "#22c55e"}}>{s.attendance_rate}</td>
                  <td style={{color: s.punctuality_rate < 95 ? "#f59e0b" : "#22c55e"}}>{s.punctuality_rate}</td>
                </tr>
              ))}
              {stats.length === 0 && <tr><td colSpan={10} style={{textAlign:"center",color:"#6b7280"}}>暂无数据，点击"计算统计"生成</td></tr>}
            </tbody>
          </table>

          <h3 style={{marginTop:24,marginBottom:8}}>考勤规则</h3>
          <table className="data-table">
            <thead><tr><th>规则代码</th><th>规则名称</th><th>类型</th><th>阈值</th><th>金额/方式</th><th>生效日期</th><th>状态</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.rule_code}</code></td>
                  <td>{r.name_zh}</td>
                  <td>{r.rule_type}</td>
                  <td>{r.threshold_value != null ? r.threshold_value + (r.threshold_unit || "") : "—"}</td>
                  <td>{r.amount_type === "fixed" ? r.amount.toLocaleString() + " " + r.currency : r.amount_type}</td>
                  <td>{r.effective_from}</td>
                  <td><StatusBadge status={r.is_active ? "active" : "inactive"} map={{ active:"启用", inactive:"停用" }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "kpi" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
            </select>
            <button className="btn-primary" style={{marginLeft:8}} onClick={computePerfSummary}>计算汇总</button>
          </div>

          <h3 style={{marginTop:16,marginBottom:8}}>KPI模板</h3>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            {kpiTemplates.map((t) => (
              <div key={t.id} style={{
                border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 12px",
                background: selectedTemplateId === t.id ? "#eff6ff" : "white", cursor:"pointer",
              }} onClick={async () => {
                setSelectedTemplateId(t.id);
                const res = await hrApi.getPerfKpiTemplateItems(t.id);
                if (res?.data) setKpiItems(res.data as PerfKpiTemplateItem[]);
              }}>
                <strong>{t.name_zh}</strong>
                <div style={{fontSize:12,color:"#6b7280"}}>{t.category} | {t.period_type}</div>
              </div>
            ))}
          </div>

          {selectedTemplateId > 0 && kpiItems.length > 0 && (
            <table className="data-table" style={{marginBottom:16}}>
              <thead><tr><th>指标名称</th><th>类别</th><th>目标类型</th><th>目标值</th><th>权重%</th><th>数据来源</th></tr></thead>
              <tbody>
                {kpiItems.map((i) => (
                  <tr key={i.id}>
                    <td>{i.kpi_name_zh}</td>
                    <td>{i.category}</td>
                    <td>{{ higher_better:"越高越好", lower_better:"越低越好", fixed:"固定值" }[i.target_type] || i.target_type}</td>
                    <td>{i.target_value}{i.target_max ? "~" + i.target_max : ""}</td>
                    <td>{i.weight}</td>
                    <td>{{ attendance:"考勤", quality:"质量", mes:"MES", manual:"手动", safety:"安全", training:"培训" }[i.data_source || ""] || i.data_source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{marginTop:16,marginBottom:8}}>绩效汇总</h3>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>总分</th><th>评级</th><th>部门排名</th><th>审核状态</th></tr></thead>
            <tbody>
              {perfSummary.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.employee_no}</code></td>
                  <td>{s.emp_name}</td>
                  <td>{s.dept_name}</td>
                  <td><strong>{s.total_score}</strong></td>
                  <td><RatingBadge rating={s.rating} /></td>
                  <td>{s.rank_in_dept || "—"}</td>
                  <td><StatusBadge status={s.review_status} map={{ pending:"待自评", self_done:"自评完成", manager_done:"经理完成", published:"已发布" }} /></td>
                </tr>
              ))}
              {perfSummary.length === 0 && <tr><td colSpan={7} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "rewards" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年月:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span>/</span>
            <select className="field-input" style={{width:80}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              <option value={0}>全部</option>
              {Array.from({length:12},(_,i) => i+1).map(m => <option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
            </select>
            <button className="btn-primary" style={{marginLeft:8}} onClick={() => setShowRewardModal(true)}>新增奖励</button>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>奖励类别</th><th>奖励日期</th><th>金额</th><th>颁奖级别</th><th>原因</th><th>发放状态</th><th>操作</th></tr></thead>
            <tbody>
              {rewards.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.employee_no}</code></td>
                  <td>{r.emp_name}</td>
                  <td>{r.dept_name}</td>
                  <td>{r.cat_name_zh}</td>
                  <td>{r.reward_date}</td>
                  <td style={{color:"#22c55e",fontWeight:600}}>{r.amount > 0 ? r.amount.toLocaleString() + " " + r.currency : "荣誉"}</td>
                  <td>{{ unit:"单位", department:"部门", company:"公司", group:"集团" }[r.award_level || ""] || r.award_level || "—"}</td>
                  <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.reason_zh}</td>
                  <td><StatusBadge status={r.payment_status} map={PAYMENT_MAP} /></td>
                  <td>
                    {r.payment_status === "unpaid" && (
                      <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => handleUpdateRewardPayment(r.id, "paid")}>确认发放</button>
                    )}
                  </td>
                </tr>
              ))}
              {rewards.length === 0 && <tr><td colSpan={10} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bonus" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <span>年份:</span>
            <select className="field-input" style={{width:100}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn-primary" style={{marginLeft:8}} onClick={() => setShowBonusModal(true)}>新增奖金</button>
          </div>
          <table className="data-table">
            <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>奖金类型</th><th>期间</th><th>基本金额</th><th>系数</th><th>实发金额</th><th>绩效评级</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {bonuses.map((b) => (
                <tr key={b.id}>
                  <td><code>{b.employee_no}</code></td>
                  <td>{b.emp_name}</td>
                  <td>{b.dept_name}</td>
                  <td>{BONUS_TYPE_MAP[b.bonus_type] || b.bonus_type}</td>
                  <td>{b.period_year}{b.period_quarter ? " Q" + b.period_quarter : ""}</td>
                  <td>{b.base_amount.toLocaleString()}</td>
                  <td>{b.coefficient}x</td>
                  <td style={{color:"#22c55e",fontWeight:600}}>{b.final_amount.toLocaleString()}</td>
                  <td>{b.performance_rating ? <RatingBadge rating={b.performance_rating} /> : "—"}</td>
                  <td><StatusBadge status={b.status} map={BONUS_STATUS_MAP} /></td>
                  <td>
                    {b.status === "pending" && (
                      <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => handleUpdateBonusStatus(b.id, "paid")}>确认发放</button>
                    )}
                  </td>
                </tr>
              ))}
              {bonuses.length === 0 && <tr><td colSpan={11} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showRewardModal && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:460,padding:24}}>
            <h3>新增员工奖励</h3>
            <div className="field" style={{marginTop:12}}><span>员工</span>
              <select className="field-input" id="rw-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>奖励类别</span>
              <select className="field-input" id="rw-cat">
                <option value={0}>— 选择类别 —</option>
                {rewardCats.map(c => <option key={c.id} value={c.id}>{c.name_zh}</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>奖励日期</span>
              <input className="field-input" type="date" id="rw-date" defaultValue={new Date().toISOString().slice(0,10)} />
            </div>
            <div className="field" style={{marginTop:12}}><span>金额 (VND)</span>
              <input className="field-input" type="number" id="rw-amount" placeholder="0" />
            </div>
            <div className="field" style={{marginTop:12}}><span>原因</span>
              <input className="field-input" id="rw-reason" placeholder="奖励原因" />
            </div>
            <div className="field" style={{marginTop:12}}><span>颁奖级别</span>
              <select className="field-input" id="rw-level">
                <option value="unit">单位</option><option value="department">部门</option>
                <option value="company">公司</option><option value="group">集团</option>
              </select>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowRewardModal(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const empSel = document.getElementById("rw-emp") as HTMLSelectElement;
                const catSel = document.getElementById("rw-cat") as HTMLSelectElement;
                const dateSel = document.getElementById("rw-date") as HTMLInputElement;
                const amtSel = document.getElementById("rw-amount") as HTMLInputElement;
                const reasonSel = document.getElementById("rw-reason") as HTMLInputElement;
                const levelSel = document.getElementById("rw-level") as HTMLSelectElement;
                if (!parseInt(empSel.value) || !parseInt(catSel.value) || !reasonSel.value) return;
                handleCreateReward({
                  employee_id: parseInt(empSel.value), category_id: parseInt(catSel.value),
                  reward_date: dateSel.value, amount: parseFloat(amtSel.value) || 0,
                  reason_zh: reasonSel.value, award_level: levelSel.value,
                  period_year: year, period_month: month,
                });
              }}>确认</button>
            </div>
          </div>
        </div>
      )}

      {showBonusModal && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:460,padding:24}}>
            <h3>新增定期奖金</h3>
            <div className="field" style={{marginTop:12}}><span>员工</span>
              <select className="field-input" id="bn-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>奖金类型</span>
              <select className="field-input" id="bn-type">
                <option value="quarter">季度奖</option><option value="year">年终奖</option>
                <option value="project">项目奖</option><option value="performance">绩效奖</option>
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>基本金额 (VND)</span>
              <input className="field-input" type="number" id="bn-base" placeholder="0" />
            </div>
            <div className="field" style={{marginTop:12}}><span>系数</span>
              <input className="field-input" type="number" id="bn-coef" value="1.0" step="0.1" />
            </div>
            <div className="field" style={{marginTop:12}}><span>绩效评级</span>
              <select className="field-input" id="bn-rating">
                <option value="">— 无 —</option>
                {["S","A","B","C","D"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowBonusModal(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const empSel = document.getElementById("bn-emp") as HTMLSelectElement;
                const typeSel = document.getElementById("bn-type") as HTMLSelectElement;
                const baseSel = document.getElementById("bn-base") as HTMLInputElement;
                const coefSel = document.getElementById("bn-coef") as HTMLInputElement;
                const ratingSel = document.getElementById("bn-rating") as HTMLSelectElement;
                if (!parseInt(empSel.value)) return;
                const base = parseFloat(baseSel.value) || 0;
                const coef = parseFloat(coefSel.value) || 1;
                handleCreateBonus({
                  employee_id: parseInt(empSel.value), bonus_type: typeSel.value,
                  period_year: year, base_amount: base, coefficient: coef,
                  final_amount: base * coef, performance_rating: ratingSel.value || undefined,
                });
              }}>确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
