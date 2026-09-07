import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Save, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Employee = {
  id:string;name:string;domain:string;level:string;enabled:boolean;mode:string;status:string;
  provider?:string;model?:string;interval_seconds?:number;owner?:string;notes?:string;
  base_url?:string;credential_env?:string;timeout_ms?:number;temperature?:number;
  display_name?:string;avatar_url?:string;preferred_language?:string;communication_tone?:string;personality?:string;
  jobDescription?:string;capabilities:string[];skills?:string[];humanGates:string[];taskCounts:Record<string,number>;
};
const apiBase=(location.hostname==="127.0.0.1"||location.hostname==="localhost")?"http://127.0.0.1:8081/api/factory":"/api/factory";
const headers=()=>{const token=sessionStorage.getItem("auth_token");return{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})};};

export function VirtualEmployeeManagement(){
  const [items,setItems]=useState<Employee[]>([]),[selectedId,setSelectedId]=useState(""),[search,setSearch]=useState(""),[domain,setDomain]=useState("ALL"),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const load=useCallback(async()=>{try{const r=await fetch(`${apiBase}/virtual-employees`,{headers:headers()});if(!r.ok)throw new Error(`HTTP ${r.status}`);const p=await r.json(),rows=p?.data?.items||[];setItems(rows);setSelectedId(id=>id||rows[0]?.id||"");setMessage("");}catch(e){setMessage(`读取失败：${e instanceof Error?e.message:e}`);}},[]);
  useEffect(()=>{void load();},[load]);
  const selected=items.find(x=>x.id===selectedId);
  const domains=useMemo(()=>["ALL",...Array.from(new Set(items.map(x=>x.domain)))],[items]);
  const filtered=items.filter(x=>(domain==="ALL"||x.domain===domain)&&`${x.id} ${x.name} ${x.domain}`.toLowerCase().includes(search.toLowerCase()));
  const update=(field:keyof Employee,value:unknown)=>setItems(xs=>xs.map(x=>x.id===selectedId?{...x,[field]:value}:x));
  const save=async()=>{if(!selected)return;setBusy(true);try{const r=await fetch(`${apiBase}/virtual-employees/${selected.id}/config`,{method:"PUT",headers:headers(),body:JSON.stringify({enabled:selected.enabled,provider:selected.provider||"minimax",model:selected.model||"MiniMax-M2.7",baseUrl:selected.base_url||"",credentialEnv:selected.credential_env||"",timeoutMs:selected.timeout_ms||120000,temperature:selected.temperature??0.2,displayName:selected.display_name||selected.name,avatarUrl:selected.avatar_url||"",preferredLanguage:selected.preferred_language||"zh-CN",communicationTone:selected.communication_tone||"professional",personality:selected.personality||"",intervalSeconds:selected.interval_seconds||300,owner:selected.owner||"",notes:selected.notes||""})});if(!r.ok){const p=await r.json().catch(()=>null);throw new Error(p?.error?.message||`HTTP ${r.status}`);}setMessage("");toast.success("员工配置已保存",{description:selected.display_name||selected.name});await load();}catch(e){const detail=e instanceof Error?e.message:String(e);setMessage(`保存失败：${detail}`);toast.error("员工配置保存失败",{description:detail});}finally{setBusy(false);}};
  return <div style={{display:"grid",gridTemplateColumns:"minmax(330px,.85fr) minmax(520px,1.4fr)",gap:14,padding:16}}>
    <section className="surface-panel" style={{padding:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索员工、编号或部门" style={{flex:1}}/></div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"10px 0"}}>{domains.map(x=><button key={x} onClick={()=>setDomain(x)} style={{fontWeight:domain===x?800:400}}>{x}</button>)}</div>
      <div style={{maxHeight:650,overflow:"auto",display:"grid",gap:7}}>{filtered.map(x=><button key={x.id} onClick={()=>setSelectedId(x.id)} style={{textAlign:"left",padding:10,border:x.id===selectedId?"2px solid #2563eb":"1px solid var(--border)",borderRadius:8,background:x.id===selectedId?"#eff6ff":"var(--surface-2)"}}>
        <div style={{display:"flex",gap:7,alignItems:"center"}}><Bot size={15}/><strong>{x.name}</strong><span style={{marginLeft:"auto",color:x.enabled?"#15803d":"#b91c1c"}}>{x.enabled?"已启用":"已停用"}</span></div><code style={{fontSize:10}}>{x.id}</code><div style={{fontSize:11,color:"var(--text-3)"}}>{x.domain.toUpperCase()} · OPEN {x.taskCounts?.OPEN||0} · APPROVAL {x.taskCounts?.WAITING_APPROVAL||0}</div>
      </button>)}</div>
    </section>
    <section className="surface-panel" style={{padding:18}}>{selected?<>
      <div style={{display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid var(--border)",paddingBottom:12}}>{selected.avatar_url?<img src={selected.avatar_url} alt="" style={{width:58,height:58,borderRadius:14,objectFit:"cover"}}/>:<Bot size={32}/>}<div><h2 style={{margin:0}}>{selected.display_name||selected.name}</h2><div style={{fontSize:12,color:"var(--text-3)"}}>{selected.name}</div><code>{selected.id}</code></div><label style={{marginLeft:"auto",fontWeight:700}}><input type="checkbox" checked={selected.enabled!==false} onChange={e=>update("enabled",e.target.checked)}/> 启用员工</label></div>
      <div style={{padding:"12px 0"}}><b>岗位使命</b><p style={{color:"var(--text-2)"}}>{selected.jobDescription||"该员工已建立受控工作骨架，等待连接领域执行器。"}</p></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <label>员工姓名<input value={selected.display_name||selected.name} onChange={e=>update("display_name",e.target.value)}/></label>
        <label>头像地址<input value={selected.avatar_url||""} onChange={e=>update("avatar_url",e.target.value)} placeholder="/avatars/employee.png"/></label>
        <label>首选语言<select value={selected.preferred_language||"zh-CN"} onChange={e=>update("preferred_language",e.target.value)}><option value="zh-CN">中文</option><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select></label>
        <label>沟通风格<select value={selected.communication_tone||"professional"} onChange={e=>update("communication_tone",e.target.value)}><option value="professional">专业直接</option><option value="friendly">友好协作</option><option value="concise">简洁指令</option><option value="coach">教练指导</option></select></label>
        <label>LLM 提供商<select value={selected.provider||"minimax"} onChange={e=>update("provider",e.target.value)}><option value="minimax">MiniMax（工厂默认）</option><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option><option value="ollama">Ollama</option><option value="hermes">Hermes</option><option value="rules">Rules only</option></select></label>
        <label>模型<input value={selected.model||"MiniMax-M2.7"} onChange={e=>update("model",e.target.value)}/></label>
        <label>Base URL<input value={selected.base_url||""} onChange={e=>update("base_url",e.target.value)} placeholder="https://api.minimax.io/v1"/></label>
        <label>密钥环境变量<input value={selected.credential_env||""} onChange={e=>update("credential_env",e.target.value.toUpperCase())} placeholder="MINIMAX_API_KEY"/></label>
        <label>超时（毫秒）<input type="number" min={5000} max={300000} value={selected.timeout_ms||120000} onChange={e=>update("timeout_ms",Number(e.target.value))}/></label>
        <label>温度（0–1）<input type="number" min={0} max={1} step={0.05} value={selected.temperature??0.2} onChange={e=>update("temperature",Number(e.target.value))}/></label>
        <label>检查周期（秒，最低60）<input type="number" min={60} value={selected.interval_seconds||300} onChange={e=>update("interval_seconds",Number(e.target.value))}/></label>
        <label>负责人<input value={selected.owner||""} onChange={e=>update("owner",e.target.value)} placeholder="实体负责人/部门"/></label>
      </div>
      <label style={{display:"grid",marginTop:14}}>性格与行为说明<textarea rows={3} value={selected.personality||""} onChange={e=>update("personality",e.target.value)} placeholder="例如：耐心、谨慎；先说明事实，再给建议；不责备现场人员。"/></label>
      <div style={{marginTop:14}}><b>工作能力</b><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:7}}>{selected.capabilities.map(x=><span key={x} className="badge badge-info">{x}</span>)}</div></div>
      <div style={{marginTop:14}}><b>已分配专业技能</b><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:7}}>{selected.skills?.length?selected.skills.map(x=><span key={x} style={{padding:"5px 9px",borderRadius:999,background:"#ecfdf5",border:"1px solid #a7f3d0",color:"#065f46",fontSize:12,fontWeight:700}}>{x}</span>):<span style={{color:"var(--text-3)"}}>尚未分配技能</span>}</div></div>
      <div style={{marginTop:14,padding:12,background:"#fff7ed",border:"1px solid #fdba74",borderRadius:8}}><b><ShieldCheck size={14}/> 人工审批门</b><div style={{marginTop:5}}>{selected.humanGates.join("、")||"无"}</div></div>
      <label style={{display:"grid",marginTop:14}}>管理备注<textarea rows={4} value={selected.notes||""} onChange={e=>update("notes",e.target.value)} placeholder="交接说明、限制或维护备注"/></label>
      <div style={{display:"flex",alignItems:"center",gap:10,marginTop:14}}><button onClick={()=>void save()} disabled={busy} style={{padding:"9px 18px",background:"#2563eb",color:"white",border:0,borderRadius:7,fontWeight:800}}><Save size={14}/> {busy?"保存中…":"保存配置"}</button><span style={{color:message.startsWith("保存失败")||message.startsWith("读取失败")?"#b91c1c":"#15803d"}}>{message}</span></div>
    </>:<div>请选择虚拟员工。</div>}</section>
  </div>;
}
