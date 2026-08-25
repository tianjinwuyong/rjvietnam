import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { RewardProgram, RewardNomination, RewardCategory, PeerRecognition, Employee } from "../api";

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b", approved: "#22c55e", rejected: "#ef4444",
  active: "#22c55e", inactive: "#6b7280", completed: "#3b82f6", cancelled: "#ef4444",
  helpful: "#22c55e", teamwork: "#3b82f6", innovation: "#f59e0b", safety: "#ef4444",
};

const RECOGNITION_TYPE_MAP: Record<string, string> = {
  helpful: "主动协助", teamwork: "团队协作", innovation: "创新建议", safety: "安全模范", other: "其他",
};

const STATUS_MAP: Record<string, string> = {
  pending: "待审批", approved: "已批准", rejected: "已拒绝",
  active: "进行中", inactive: "已停用", completed: "已完成", cancelled: "已取消",
};

interface Props { locale: Locale; }
export function HrRewardPrograms({ locale }: Props) {
  const [tab, setTab] = useState<"programs" | "nominations" | "peer">("programs");
  const [programs, setPrograms] = useState<RewardProgram[]>([]);
  const [nominations, setNominations] = useState<RewardNomination[]>([]);
  const [peerRecognitions, setPeerRecognitions] = useState<PeerRecognition[]>([]);
  const [rewardCats, setRewardCats] = useState<RewardCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showNomination, setShowNomination] = useState(false);
  const [showPeer, setShowPeer] = useState(false);

  useEffect(() => { loadPrograms(); loadRewardCats(); loadEmployees(); }, []);

  async function loadPrograms() {
    try {
      const res = await hrApi.getRewardPrograms({});
      if (res?.items) setPrograms(res.items);
    } catch {}
  }

  async function loadRewardCats() {
    try {
      const res = await hrApi.getRewardCategories();
      if (res?.data) setRewardCats(res.data as RewardCategory[]);
    } catch {}
  }

  async function loadEmployees() {
    try {
      const res = await hrApi.getEmployees({} as any);
      if (res?.data) setEmployees(res.data as Employee[]);
    } catch {}
  }

  async function loadTab() {
    try {
      if (tab === "nominations") {
        const res = await hrApi.getRewardNominations({});
        if (res?.items) setNominations(res.items);
      } else if (tab === "peer") {
        const res = await hrApi.getPeerRecognitions({});
        if (res?.items) setPeerRecognitions(res.items);
      }
    } catch {}
  }

  useEffect(() => { loadTab(); }, [tab]);

  async function handleNominate(payload: any) {
    try {
      await hrApi.createRewardNomination(payload);
      setShowNomination(false);
      loadTab();
    } catch (e) { console.error(e); }
  }

  async function handleApproveNomination(id: number, final_amount: number) {
    try {
      await hrApi.approveRewardNomination(id, { approver_id: 1, approver_name: "HR Admin", final_amount, final_reason: "批准" });
      loadTab();
    } catch (e) { console.error(e); }
  }

  async function handlePeerRecognize(payload: any) {
    try {
      await hrApi.createPeerRecognition(payload);
      setShowPeer(false);
      loadTab();
    } catch (e) { console.error(e); }
  }

  async function handleLike(id: number) {
    try {
      await hrApi.likePeerRecognition(id);
      loadTab();
    } catch (e) { console.error(e); }
  }

  function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
    const color = STATUS_COLORS[status] || "#6b7280";
    return (
      <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:12, background:color+"22", color, fontWeight:600, fontSize:12 }}>
        {(map || STATUS_MAP)[status] || status}
      </span>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        <h2>奖励机制</h2>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          {(["programs","nominations","peer"] as const).map(k => (
            <button key={k} className={`btn-ghost ${tab===k ? "btn-active" : ""}`} onClick={() => setTab(k)}>
              {{ programs:"奖励计划", nominations:"提名审批", peer:"同事互评" }[k]}
            </button>
          ))}
        </div>
      </div>

      {tab === "programs" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",gap:16,marginBottom:16}}>
            {programs.map(p => (
              <div key={p.id} style={{
                border:"1px solid #e5e7eb", borderRadius:12, padding:20,
                borderTop: `4px solid ${p.status==='active'?'#22c55e': p.status==='completed'?'#3b82f6':'#6b7280'}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{p.name_zh}</div>
                    <div style={{fontSize:11,color:"#6b7280"}}><code>{p.program_code}</code></div>
                  </div>
                  <StatusBadge status={p.status} map={STATUS_MAP} />
                </div>
                <div style={{marginTop:12,display:"flex",gap:16,fontSize:13}}>
                  <div>
                    <div style={{color:"#6b7280",fontSize:11}}>类型</div>
                    <div style={{fontWeight:600}}>{{ quarterly:"季度", safety:"安全", innovation:"创新", milestone:"里程碑", annual:"年度" }[p.program_type] || p.program_type}</div>
                  </div>
                  <div>
                    <div style={{color:"#6b7280",fontSize:11}}>预算</div>
                    <div style={{fontWeight:600,color:"#22c55e"}}>{p.budget_total ? p.budget_total.toLocaleString() + " " + p.currency : "—"}</div>
                  </div>
                  <div>
                    <div style={{color:"#6b7280",fontSize:11}}>已使用</div>
                    <div style={{fontWeight:600}}>{p.budget_used ? p.budget_used.toLocaleString() : 0}</div>
                  </div>
                </div>
                <div style={{marginTop:8,fontSize:12,color:"#6b7280"}}>
                  有效期: {p.start_date} ~ {p.end_date || "不限"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "nominations" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn-primary" onClick={() => setShowNomination(true)}>提名奖励</button>
          </div>
          <table className="data-table">
            <thead><tr><th>提名日期</th><th>被提名员工</th><th>奖项类别</th><th>提名原因</th><th>提名者</th><th>状态</th><th>审批金额</th><th>操作</th></tr></thead>
            <tbody>
              {nominations.map(n => (
                <tr key={n.id}>
                  <td>{n.nomination_date}</td>
                  <td>{n.nominee_name || "—"}</td>
                  <td>{n.cat_name_zh || "—"}</td>
                  <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12}}>{n.reason_zh || "—"}</td>
                  <td>{n.nominator_name || "—"}</td>
                  <td><StatusBadge status={n.status} map={STATUS_MAP} /></td>
                  <td style={{color:"#22c55e",fontWeight:600}}>{n.final_amount ? n.final_amount.toLocaleString() : "—"}</td>
                  <td>
                    {n.status === "pending" && (
                      <button className="btn-ghost" style={{padding:"2px 8px",fontSize:12}} onClick={() => {
                        const amt = window.prompt("输入批准金额(VND):", "");
                        if (amt !== null) handleApproveNomination(n.id, parseFloat(amt) || 0);
                      }}>审批</button>
                    )}
                  </td>
                </tr>
              ))}
              {nominations.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",color:"#6b7280"}}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "peer" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn-primary" onClick={() => setShowPeer(true)}>发表扬</button>
            <span style={{marginLeft:8,color:"#6b7280",alignSelf:"center",fontSize:13}}>点赞你欣赏的同事，增强团队凝聚力</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))",gap:12}}>
            {peerRecognitions.map(p => {
              const typeColor = STATUS_COLORS[p.recognition_type] || "#6b7280";
              return (
                <div key={p.id} style={{border:"1px solid #e5e7eb",borderRadius:12,padding:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:"#3b82f6",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <span style={{color:"white",fontWeight:700,fontSize:12}}>{p.recognized_name?.charAt(0) || "?"}</span>
                    </div>
                    <div>
                      <div style={{fontWeight:600,fontSize:14}}>{p.recognized_name}</div>
                      <div style={{fontSize:11,color:"#6b7280"}}>{p.recognized_dept || ""}</div>
                    </div>
                    <span style={{marginLeft:"auto",padding:"2px 8px",borderRadius:8,background:typeColor+"22",color:typeColor,fontWeight:600,fontSize:11}}>
                      {RECOGNITION_TYPE_MAP[p.recognition_type] || p.recognition_type}
                    </span>
                  </div>
                  <div style={{fontSize:13,color:"#374151",marginBottom:8,lineHeight:1.5}}>"{p.message || "..."}"</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:"#6b7280"}}>— {p.recognizing_name || "匿名"}</span>
                    <span style={{marginLeft:"auto",fontSize:11,color:"#6b7280"}}>{p.created_at?.slice(0,10)}</span>
                    <button className="btn-ghost" style={{padding:"1px 6px",fontSize:11,display:"flex",alignItems:"center",gap:2}} onClick={() => handleLike(p.id)}>
                      <span style={{color:"#ef4444"}}>♥</span> {p.likes_count}
                    </button>
                  </div>
                </div>
              );
            })}
            {peerRecognitions.length === 0 && (
              <div style={{gridColumn:"1/-1",textAlign:"center",color:"#6b7280",padding:32}}>暂无互评记录</div>
            )}
          </div>
        </div>
      )}

      {showNomination && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:480,padding:24}}>
            <h3>提名奖励</h3>
            <div className="field" style={{marginTop:12}}><span>被提名员工</span>
              <select className="field-input" id="nom-emp">
                <option value={0}>— 选择员工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>奖励类别</span>
              <select className="field-input" id="nom-cat">
                <option value={0}>— 选择类别 —</option>
                {rewardCats.map(c => <option key={c.id} value={c.id}>{c.name_zh}</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>提名原因</span>
              <textarea className="field-input" id="nom-reason" rows={3} placeholder="请详细描述提名原因..." style={{resize:"vertical"}} />
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowNomination(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const empSel = document.getElementById("nom-emp") as HTMLSelectElement;
                const catSel = document.getElementById("nom-cat") as HTMLSelectElement;
                const reasonSel = document.getElementById("nom-reason") as HTMLTextAreaElement;
                if (!parseInt(empSel.value) || !parseInt(catSel.value) || !reasonSel.value.trim()) return;
                const cat = rewardCats.find(c => c.id === parseInt(catSel.value));
                handleNominate({ nominee_id: parseInt(empSel.value), category_id: parseInt(catSel.value), cat_name_zh: cat?.name_zh || '', nominator_id: 1, nominator_name: "HR Admin", nomination_date: new Date().toISOString().slice(0,10), reason_zh: reasonSel.value.trim() });
              }}>提交</button>
            </div>
          </div>
        </div>
      )}

      {showPeer && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div className="surface-panel" style={{width:480,padding:24}}>
            <h3>表扬同事</h3>
            <div className="field" style={{marginTop:12}}><span>我要表扬</span>
              <select className="field-input" id="peer-to">
                <option value={0}>— 选择同事 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>表扬类型</span>
              <select className="field-input" id="peer-type">
                <option value="helpful">主动协助</option><option value="teamwork">团队协作</option>
                <option value="innovation">创新建议</option><option value="safety">安全模范</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="field" style={{marginTop:12}}><span>表扬留言</span>
              <textarea className="field-input" id="peer-msg" rows={3} placeholder="写下你想说的话..." style={{resize:"vertical"}} />
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={() => setShowPeer(false)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const toSel = document.getElementById("peer-to") as HTMLSelectElement;
                const typeSel = document.getElementById("peer-type") as HTMLSelectElement;
                const msgSel = document.getElementById("peer-msg") as HTMLTextAreaElement;
                if (!parseInt(toSel.value)) return;
                const toEmp = employees.find(e => e.id === parseInt(toSel.value));
                handlePeerRecognize({ recognizing_id: 1, recognizing_name: "我", recognized_id: parseInt(toSel.value), recognized_name: toEmp?.name_zh || '', recognized_dept: toEmp?.department_name_zh || '', recognition_type: typeSel.value, message: msgSel.value });
              }}>发布</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
