import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Save, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { locales, localeLabels, t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Employee = {
  id:string;name:string;domain:string;level:string;enabled:boolean;mode:string;status:string;
  provider?:string;model?:string;interval_seconds?:number;owner?:string;notes?:string;
  base_url?:string;credential_env?:string;timeout_ms?:number;temperature?:number;
  display_name?:string;avatar_url?:string;preferred_language?:string;communication_tone?:string;personality?:string;
  jobDescription?:string;capabilities:string[];skills?:string[];humanGates:string[];taskCounts:Record<string,number>;
};
// Same-origin (see VirtualEmployeeDevelopment.tsx): :8081 is the realtime
// server and serves none of these routes.
const apiBase="/api/factory";
const headers=()=>{const token=sessionStorage.getItem("auth_token");return{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})};};
const labelStyle={display:"grid",gap:4} as const;
const toneKeys:Record<string,string>={professional:"veManage.tone.professional",friendly:"veManage.tone.friendly",concise:"veManage.tone.concise",coach:"veManage.tone.coach"};

export function VirtualEmployeeManagement({ locale }: { locale: Locale }){
  const [items,setItems]=useState<Employee[]>([]),[selectedId,setSelectedId]=useState(""),[search,setSearch]=useState(""),[domain,setDomain]=useState("ALL"),[busy,setBusy]=useState(false);
  const [failure,setFailure]=useState<{key:string;detail:string}|null>(null);
  const load=useCallback(async()=>{try{const r=await fetch(`${apiBase}/virtual-employees`,{headers:headers()});if(!r.ok)throw new Error(`HTTP ${r.status}`);const p=await r.json(),rows=p?.data?.items||[];setItems(rows);setSelectedId(id=>id||rows[0]?.id||"");setFailure(null);}catch(e){setFailure({key:"veManage.loadFailed",detail:e instanceof Error?e.message:String(e)});}},[]);
  useEffect(()=>{void load();},[load]);
  const selected=items.find(x=>x.id===selectedId);
  const domains=useMemo(()=>["ALL",...Array.from(new Set(items.map(x=>x.domain)))],[items]);
  const filtered=items.filter(x=>(domain==="ALL"||x.domain===domain)&&`${x.id} ${x.name} ${x.domain}`.toLowerCase().includes(search.toLowerCase()));
  const update=(field:keyof Employee,value:unknown)=>setItems(xs=>xs.map(x=>x.id===selectedId?{...x,[field]:value}:x));
  const save=async()=>{if(!selected)return;setBusy(true);try{const r=await fetch(`${apiBase}/virtual-employees/${selected.id}/config`,{method:"PUT",headers:headers(),body:JSON.stringify({enabled:selected.enabled,provider:selected.provider||"minimax",model:selected.model||"MiniMax-M2.7",baseUrl:selected.base_url||"",credentialEnv:selected.credential_env||"",timeoutMs:selected.timeout_ms||120000,temperature:selected.temperature??0.2,displayName:selected.display_name||selected.name,avatarUrl:selected.avatar_url||"",preferredLanguage:selected.preferred_language||"zh-CN",communicationTone:selected.communication_tone||"professional",personality:selected.personality||"",intervalSeconds:selected.interval_seconds||300,owner:selected.owner||"",notes:selected.notes||""})});if(!r.ok){const p=await r.json().catch(()=>null);throw new Error(p?.error?.message||`HTTP ${r.status}`);}setFailure(null);toast.success(t("veManage.savedToast",locale),{description:selected.display_name||selected.name});await load();}catch(e){const detail=e instanceof Error?e.message:String(e);setFailure({key:"veManage.saveFailed",detail});toast.error(t("veManage.saveFailedToast",locale),{description:detail});}finally{setBusy(false);}};
  return <div className="screen-stack" data-testid="veManage.page" style={{gridTemplateColumns:"minmax(330px,.85fr) minmax(520px,1.4fr)"}}>
    <section className="surface-panel" data-testid="veManage.listPanel">
      <div className="page-header">
        <div>
          <h2>{t("veManage.title",locale)}</h2>
          <p>{t("veManage.subtitle",locale)}</p>
        </div>
      </div>
      <div className="toolbar" style={{marginTop:10}}>
        <Search size={16} aria-hidden="true"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("veManage.searchPlaceholder",locale)} title={t("veManage.searchPlaceholder",locale)} aria-label={t("veManage.searchPlaceholder",locale)} data-testid="veManage.search" style={{flex:1}}/>
      </div>
      <div className="toolbar" style={{margin:"10px 0"}} role="group" aria-label={t("veManage.domainAll",locale)}>
        {domains.map(x=><button type="button" key={x} className={domain===x?"active":""} onClick={()=>setDomain(x)} title={x==="ALL"?t("veManage.domainAll",locale):x} data-testid={`veManage.domain.${x}`}>{x==="ALL"?t("veManage.domainAll",locale):x}</button>)}
      </div>
      <div style={{maxHeight:650,overflow:"auto",display:"grid",gap:7}} data-testid="veManage.list" aria-label={t("veManage.listAria",locale)}>
        {filtered.length?filtered.map(x=><button type="button" key={x.id} className="employee-card" onClick={()=>setSelectedId(x.id)} aria-pressed={x.id===selectedId} title={`${x.display_name||x.name} (${x.id})`} data-testid={`veManage.item.${x.id}`} style={{textAlign:"left",cursor:"pointer",borderColor:x.id===selectedId?"var(--info)":undefined,background:x.id===selectedId?"var(--info-bg)":undefined}}>
          <header><Bot size={15} aria-hidden="true"/><strong>{x.name}</strong><span style={{marginLeft:"auto"}} className={x.enabled?"badge badge-ok":"badge badge-danger"} title={x.enabled?t("veManage.enabled",locale):t("veManage.disabled",locale)}>{x.enabled?t("veManage.enabled",locale):t("veManage.disabled",locale)}</span></header>
          <code>{x.id}</code>
          <div className="meta">{x.domain.toUpperCase()} · OPEN {x.taskCounts?.OPEN||0} · APPROVAL {x.taskCounts?.WAITING_APPROVAL||0}</div>
        </button>):<div className="empty-state" data-testid="veManage.empty"><strong>{t("veManage.empty",locale)}</strong></div>}
      </div>
    </section>
    <section className="surface-panel" data-testid="veManage.detail">{selected?<>
      <div className="page-header" style={{borderBottom:"1px solid var(--line)",paddingBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {selected.avatar_url?<img src={selected.avatar_url} alt="" style={{width:58,height:58,borderRadius:14,objectFit:"cover"}}/>:<Bot size={32} aria-hidden="true"/>}
          <div><h2>{selected.display_name||selected.name}</h2><p>{selected.name}</p><code>{selected.id}</code></div>
        </div>
        <label title={t("veManage.enableEmployee",locale)} style={{fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
          <input type="checkbox" checked={selected.enabled!==false} onChange={e=>update("enabled",e.target.checked)} title={t("veManage.enableEmployee",locale)} data-testid="veManage.enabledToggle"/> {t("veManage.enableEmployee",locale)}
        </label>
      </div>
      <div style={{padding:"12px 0"}}><b>{t("veManage.jobMission",locale)}</b><p style={{color:"var(--text-2)"}}>{selected.jobDescription||t("veManage.jobMissionFallback",locale)}</p></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <label style={labelStyle}>{t("veManage.displayName",locale)}<input value={selected.display_name||selected.name} onChange={e=>update("display_name",e.target.value)} title={t("veManage.displayName",locale)} data-testid="veManage.field.displayName"/></label>
        <label style={labelStyle}>{t("veManage.avatarUrl",locale)}<input value={selected.avatar_url||""} onChange={e=>update("avatar_url",e.target.value)} placeholder="/avatars/employee.png" title={t("veManage.avatarUrl",locale)}/></label>
        <label style={labelStyle}>{t("veManage.preferredLanguage",locale)}<select value={selected.preferred_language||"zh-CN"} onChange={e=>update("preferred_language",e.target.value)} title={t("veManage.preferredLanguage",locale)}>{locales.map(l=><option key={l} value={l}>{localeLabels[l]}</option>)}</select></label>
        <label style={labelStyle}>{t("veManage.communicationTone",locale)}<select value={selected.communication_tone||"professional"} onChange={e=>update("communication_tone",e.target.value)} title={t("veManage.communicationTone",locale)}>{Object.entries(toneKeys).map(([value,key])=><option key={value} value={value}>{t(key,locale)}</option>)}</select></label>
        <label style={labelStyle}>{t("veManage.provider",locale)}<select value={selected.provider||"minimax"} onChange={e=>update("provider",e.target.value)} title={t("veManage.provider",locale)}>
          <option value="minimax">{t("veManage.provider.minimax",locale)}</option>
          <option value="deepseek">DeepSeek</option>
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="ollama">Ollama</option>
          <option value="hermes">Hermes</option>
          <option value="rules">{t("veManage.provider.rules",locale)}</option>
        </select></label>
        <label style={labelStyle}>{t("veManage.model",locale)}<input value={selected.model||"MiniMax-M2.7"} onChange={e=>update("model",e.target.value)} title={t("veManage.model",locale)}/></label>
        <label style={labelStyle}>{t("veManage.baseUrl",locale)}<input value={selected.base_url||""} onChange={e=>update("base_url",e.target.value)} placeholder="https://api.minimax.io/v1" title={t("veManage.baseUrl",locale)}/></label>
        <label style={labelStyle}>{t("veManage.credentialEnv",locale)}<input value={selected.credential_env||""} onChange={e=>update("credential_env",e.target.value.toUpperCase())} placeholder="MINIMAX_API_KEY" title={t("veManage.credentialEnv",locale)}/></label>
        <label style={labelStyle}>{t("veManage.timeoutMs",locale)}<input type="number" min={5000} max={300000} value={selected.timeout_ms||120000} onChange={e=>update("timeout_ms",Number(e.target.value))} title={t("veManage.timeoutMs",locale)}/></label>
        <label style={labelStyle}>{t("veManage.temperature",locale)}<input type="number" min={0} max={1} step={0.05} value={selected.temperature??0.2} onChange={e=>update("temperature",Number(e.target.value))} title={t("veManage.temperature",locale)}/></label>
        <label style={labelStyle}>{t("veManage.intervalSeconds",locale)}<input type="number" min={60} value={selected.interval_seconds||300} onChange={e=>update("interval_seconds",Number(e.target.value))} title={t("veManage.intervalSeconds",locale)}/></label>
        <label style={labelStyle}>{t("veManage.owner",locale)}<input value={selected.owner||""} onChange={e=>update("owner",e.target.value)} placeholder={t("veManage.ownerPlaceholder",locale)} title={t("veManage.owner",locale)}/></label>
      </div>
      <label style={{...labelStyle,marginTop:14}}>{t("veManage.personality",locale)}<textarea rows={3} value={selected.personality||""} onChange={e=>update("personality",e.target.value)} placeholder={t("veManage.personalityPlaceholder",locale)} title={t("veManage.personality",locale)}/></label>
      <div style={{marginTop:14}}><b>{t("veManage.capabilities",locale)}</b><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:7}}>{selected.capabilities.map(x=><span key={x} className="badge badge-info">{x}</span>)}</div></div>
      <div style={{marginTop:14}}><b>{t("veManage.skills",locale)}</b><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:7}}>{selected.skills?.length?selected.skills.map(x=><span key={x} className="chip">{x}</span>):<span style={{color:"var(--text-3)"}}>{t("veManage.noSkills",locale)}</span>}</div></div>
      <div style={{marginTop:14,padding:12,background:"var(--warn-bg)",border:"1px solid var(--warn)",borderRadius:8}}><b><ShieldCheck size={14} aria-hidden="true"/> {t("veManage.humanGates",locale)}</b><div style={{marginTop:5}}>{selected.humanGates.join("、")||t("veManage.none",locale)}</div></div>
      <label style={{...labelStyle,marginTop:14}}>{t("veManage.notes",locale)}<textarea rows={4} value={selected.notes||""} onChange={e=>update("notes",e.target.value)} placeholder={t("veManage.notesPlaceholder",locale)} title={t("veManage.notes",locale)}/></label>
      {failure&&<p className="error-note" role="alert" data-testid="veManage.error" style={{marginTop:14}}>{t(failure.key,locale)}: {failure.detail}</p>}
      <div className="toolbar" style={{marginTop:14}}>
        <button type="button" className="action-button" onClick={()=>void save()} disabled={busy} title={busy?t("veManage.saving",locale):t("veManage.save",locale)} data-testid="veManage.save"><Save size={14} aria-hidden="true"/> {busy?t("veManage.saving",locale):t("veManage.save",locale)}</button>
      </div>
    </>:<div className="empty-state" data-testid="veManage.noSelection"><strong>{t("veManage.selectEmployee",locale)}</strong></div>}</section>
  </div>;
}
