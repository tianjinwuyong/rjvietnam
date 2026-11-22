import { useCallback, useEffect, useState } from "react";
import { Award, BookOpen, CheckCircle2, Plus, Target, X } from "lucide-react";
import { toast } from "sonner";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Employee={id:string;name:string;display_name?:string;domain:string};
type Run={id:number;response:string;score:number|null;result:string;feedback?:string};
type Case={id:number;title:string;scenario:string;expected_behavior:string;acceptance_criteria:string[];status:string;runs:Run[]};
type Evaluation={id:number;period_start:string;period_end:string;employment_stage:string;total_score:number;grade:string;status:string;strengths?:string;improvement_plan?:string};
// Shapes returned by GET /virtual-employees/:id/evaluations (metrics / training
// aggregates in services/api/src/routes/virtual-employees.js). average_score is
// a PG numeric, which the pg driver may hand back as a string.
type TaskMetrics={total_tasks?:number;completed_tasks?:number;failed_tasks?:number;gated_tasks?:number;waiting_approval?:number};
type TrainingStats={total_runs?:number;passed_runs?:number;average_score?:number|string};
// Same-origin: the API's /api/factory routes are reached through the vite
// dev proxy / nginx like every other call. The old hardcoded :8081 pointed at
// the realtime server, which serves no /api/factory routes at all.
const apiBase="/api/factory";
const headers=()=>{const token=sessionStorage.getItem("auth_token");return{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})};};
const today=new Date().toISOString().slice(0,10);
const monthStart=`${today.slice(0,7)}-01`;
const labelStyle={display:"grid",gap:4} as const;
const stageKeys:Record<string,string>={PROBATION:"veDev.stage.probation",REGULAR:"veDev.stage.regular",COACHING:"veDev.stage.coaching"};
const stageLabel=(stage:string,locale:Locale)=>stageKeys[stage]?t(stageKeys[stage],locale):stage;
const runResultClass=(result:string)=>result==="PASSED"?"badge badge-ok":result==="FAILED"?"badge badge-danger":"badge badge-warning";
const runResultLabel=(result:string,locale:Locale)=>result==="PASSED"?t("veDev.runResult.passed",locale):result==="FAILED"?t("veDev.runResult.failed",locale):result==="WAITING_REVIEW"?t("veDev.runResult.waitingReview",locale):result;
const evalStatusLabel=(status:string,locale:Locale)=>status==="DRAFT"?t("veDev.evalStatus.draft",locale):status==="APPROVED"?t("veDev.evalStatus.approved",locale):status;

export function VirtualEmployeeDevelopment({ locale }: { locale: Locale }){
  const [employees,setEmployees]=useState<Employee[]>([]),[employeeId,setEmployeeId]=useState("");
  const [cases,setCases]=useState<Case[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[metrics,setMetrics]=useState<TaskMetrics>({}),[training,setTraining]=useState<TrainingStats>({});
  const [tab,setTab]=useState<"training"|"evaluation">("training"),[message,setMessage]=useState("");
  const [draft,setDraft]=useState({title:"",scenario:"",expectedBehavior:"",criteria:""});
  const [evaluation,setEvaluation]=useState({periodStart:monthStart,periodEnd:today,employmentStage:"REGULAR",taskCompletionScore:80,qualityScore:80,efficiencyScore:80,complianceScore:90,collaborationScore:80,supervisorScore:80,strengths:"",improvementPlan:""});
  const [runCase,setRunCase]=useState<Case|null>(null),[runResponse,setRunResponse]=useState(""),[runBusy,setRunBusy]=useState(false);
  const [reviewRun,setReviewRun]=useState<Run|null>(null),[reviewScore,setReviewScore]=useState("80"),[reviewFeedback,setReviewFeedback]=useState(""),[reviewBusy,setReviewBusy]=useState(false);
  const loadEmployees=useCallback(async()=>{try{const r=await fetch(`${apiBase}/virtual-employees`,{headers:headers()});if(!r.ok)throw new Error(`HTTP ${r.status}`);const p=await r.json();const rows=p?.data?.items||[];setEmployees(rows);setEmployeeId(x=>x||rows[0]?.id||"");}catch(e){setMessage(e instanceof Error?e.message:String(e));}},[]);
  const load=useCallback(async()=>{if(!employeeId)return;try{const [a,b]=await Promise.all([fetch(`${apiBase}/virtual-employees/${employeeId}/training-cases`,{headers:headers()}),fetch(`${apiBase}/virtual-employees/${employeeId}/evaluations`,{headers:headers()})]);if(!a.ok)throw new Error(`HTTP ${a.status}`);if(!b.ok)throw new Error(`HTTP ${b.status}`);const pa=await a.json(),pb=await b.json();setCases(pa?.data?.items||[]);setEvaluations(pb?.data?.items||[]);setMetrics(pb?.data?.metrics||{});setTraining(pb?.data?.training||{});setMessage("");}catch(e){setMessage(e instanceof Error?e.message:String(e));}},[employeeId]);
  useEffect(()=>{void loadEmployees();},[loadEmployees]);useEffect(()=>{void load();},[load]);
  const post=async(url:string,body:Record<string,unknown>)=>{const r=await fetch(`${apiBase}${url}`,{method:"POST",headers:headers(),body:JSON.stringify(body)});const p=await r.json().catch(()=>null) as {error?:{message?:string}}|null;if(!r.ok)throw new Error(p?.error?.message||`HTTP ${r.status}`);return p;};
  const addCase=async()=>{try{await post(`/virtual-employees/${employeeId}/training-cases`,{...draft,acceptanceCriteria:draft.criteria.split("\n").map(x=>x.trim()).filter(Boolean)});setDraft({title:"",scenario:"",expectedBehavior:"",criteria:""});setMessage("");toast.success(t("veDev.caseSaved",locale),{description:t("veDev.caseSavedDesc",locale)});await load();}catch(e){setMessage(String(e));toast.error(t("veDev.caseSaveFailed",locale),{description:e instanceof Error?e.message:String(e)});}};
  const addRun=(c:Case)=>{setRunCase(c);setRunResponse("");};
  const submitRun=async()=>{if(!runCase||!runResponse.trim())return;setRunBusy(true);try{await post(`/virtual-employees/training-cases/${runCase.id}/runs`,{response:runResponse});setRunCase(null);setRunResponse("");await load();}catch(e){toast.error(t("veDev.runSaveFailed",locale),{description:e instanceof Error?e.message:String(e)});}finally{setRunBusy(false);}};
  const review=(run:Run)=>{setReviewRun(run);setReviewScore("80");setReviewFeedback("");};
  const reviewScoreValue=Number(reviewScore);
  const reviewScoreValid=Number.isFinite(reviewScoreValue)&&reviewScoreValue>=0&&reviewScoreValue<=100;
  const submitReview=async()=>{if(!reviewRun||!reviewScoreValid)return;setReviewBusy(true);try{await post(`/virtual-employees/training-runs/${reviewRun.id}/review`,{score:reviewScoreValue,feedback:reviewFeedback,passScore:80});toast.success(reviewScoreValue>=80?t("veDev.reviewPassedToast",locale):t("veDev.reviewFailedToast",locale),{description:`${t("veDev.reviewScoreDesc",locale)}: ${reviewScoreValue} ${t("veDev.points",locale)}`});setReviewRun(null);await load();}catch(e){toast.error(t("veDev.reviewSaveFailed",locale),{description:e instanceof Error?e.message:String(e)});}finally{setReviewBusy(false);}};
  const addEvaluation=async()=>{try{await post(`/virtual-employees/${employeeId}/evaluations`,evaluation);setMessage("");toast.success(t("veDev.evalDraftToast",locale),{description:t("veDev.evalDraftDesc",locale)});await load();}catch(e){setMessage(String(e));toast.error(t("veDev.evalCreateFailed",locale),{description:e instanceof Error?e.message:String(e)});}};
  const approve=async(id:number)=>{try{await post(`/virtual-employees/evaluations/${id}/approve`,{});toast.success(t("veDev.approvedToast",locale));await load();}catch(e){setMessage(e instanceof Error?e.message:String(e));toast.error(t("veDev.approveFailed",locale),{description:e instanceof Error?e.message:String(e)});}};
  const selected=employees.find(x=>x.id===employeeId);
  return <div className="employee-development screen-stack" data-testid="veDev.page">
    <section className="surface-panel">
      <div className="page-header">
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Target size={28} aria-hidden="true"/>
          <div><h2>{t("veDev.title",locale)}</h2><p>{t("veDev.subtitle",locale)}</p></div>
        </div>
        <select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} title={t("veDev.employeeSelect",locale)} aria-label={t("veDev.employeeSelect",locale)} data-testid="veDev.employeeSelect" style={{marginLeft:"auto",minWidth:280,maxWidth:360}}>{employees.map(x=><option key={x.id} value={x.id}>{x.display_name||x.name} · {x.domain}</option>)}</select>
      </div>
    </section>
    <div className="employee-development__metrics metric-grid" style={{gridTemplateColumns:"repeat(4,minmax(140px,1fr))"}} data-testid="veDev.metrics">
      <article className="stat-tile"><span>{t("veDev.metric.tasks",locale)}</span><strong>{metrics.completed_tasks||0}/{metrics.total_tasks||0}</strong></article>
      <article className="stat-tile"><span>{t("veDev.metric.trainingPass",locale)}</span><strong>{training.passed_runs||0}/{training.total_runs||0}</strong></article>
      <article className="stat-tile"><span>{t("veDev.metric.avgScore",locale)}</span><strong>{training.average_score||0}</strong></article>
      <article className="stat-tile"><span>{t("veDev.metric.pendingApproval",locale)}</span><strong>{metrics.waiting_approval||0}</strong></article>
    </div>
    <nav className="toolbar" aria-label={t("veDev.title",locale)} data-testid="veDev.tabs">
      <button type="button" onClick={()=>setTab("training")} className={tab==="training"?"active":""} title={t("veDev.tab.training",locale)} data-testid="veDev.tab.training"><BookOpen size={15} aria-hidden="true"/> {t("veDev.tab.training",locale)}</button>
      <button type="button" onClick={()=>setTab("evaluation")} className={tab==="evaluation"?"active":""} title={t("veDev.tab.evaluation",locale)} data-testid="veDev.tab.evaluation"><Award size={15} aria-hidden="true"/> {t("veDev.tab.evaluation",locale)}</button>
    </nav>
    {tab==="training"?<div className="employee-development__split" style={{display:"grid",gridTemplateColumns:"minmax(360px,.8fr) minmax(540px,1.2fr)",gap:14}}>
      <section className="surface-panel" style={{display:"grid",gap:10,alignContent:"start"}}>
        <h3 style={{margin:0}}><Plus size={16} aria-hidden="true"/> {t("veDev.newCase",locale)}</h3>
        <label style={labelStyle}>{t("veDev.caseTitle",locale)}<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} title={t("veDev.caseTitle",locale)} data-testid="veDev.case.title"/></label>
        <label style={labelStyle}>{t("veDev.scenario",locale)}<textarea rows={5} value={draft.scenario} onChange={e=>setDraft({...draft,scenario:e.target.value})} title={t("veDev.scenario",locale)} data-testid="veDev.case.scenario"/></label>
        <label style={labelStyle}>{t("veDev.expectedBehavior",locale)}<textarea rows={5} value={draft.expectedBehavior} onChange={e=>setDraft({...draft,expectedBehavior:e.target.value})} title={t("veDev.expectedBehavior",locale)} data-testid="veDev.case.expected"/></label>
        <label style={labelStyle}>{t("veDev.criteria",locale)}<textarea rows={4} value={draft.criteria} onChange={e=>setDraft({...draft,criteria:e.target.value})} title={t("veDev.criteria",locale)} data-testid="veDev.case.criteria"/></label>
        <button type="button" className="action-button" onClick={()=>void addCase()} disabled={!draft.title||!draft.scenario||!draft.expectedBehavior} title={t("veDev.saveCase",locale)} data-testid="veDev.case.save">{t("veDev.saveCase",locale)}</button>
        <small style={{color:"var(--muted)"}}>{t("veDev.caseHint",locale)}</small>
      </section>
      <section className="surface-panel">
        <h3 style={{marginTop:0}}>{selected?.display_name||selected?.name} · {t("veDev.trainingProfile",locale)}</h3>
        <div style={{display:"grid",gap:10}}>{cases.length?cases.map(c=><article key={c.id} className="employee-card" data-testid={`veDev.case.${c.id}`}>
          <b>{c.title}</b>
          <p style={{margin:0}}>{c.scenario}</p>
          <div style={{background:"var(--ok-bg)",padding:8,borderRadius:6}}><b>{t("veDev.expected",locale)}:</b> {c.expected_behavior}</div>
          <div className="toolbar">
            <button type="button" onClick={()=>addRun(c)} title={t("veDev.trialAnswer",locale)} data-testid={`veDev.trialAnswer.${c.id}`}>{t("veDev.trialAnswer",locale)}</button>
            <span style={{fontSize:12,color:"var(--muted)"}}>{c.runs?.length||0} {t("veDev.runsUnit",locale)}</span>
          </div>
          {c.runs?.length?<table className="data-table" data-testid={`veDev.runs.${c.id}`}>
            <thead><tr><th>{t("veDev.col.result",locale)}</th><th>{t("veDev.col.score",locale)}</th><th>{t("veDev.col.response",locale)}</th><th>{t("veDev.col.action",locale)}</th></tr></thead>
            <tbody>{c.runs.map(r=><tr key={r.id}>
              <td><span className={runResultClass(r.result)} title={runResultLabel(r.result,locale)}>{runResultLabel(r.result,locale)}</span></td>
              <td>{r.score!=null?`${r.score} ${t("veDev.points",locale)}`:t("veDev.pendingScore",locale)}</td>
              <td>{r.response.slice(0,100)}</td>
              <td>{r.result==="WAITING_REVIEW"?<button type="button" onClick={()=>review(r)} title={t("veDev.review",locale)} data-testid={`veDev.review.${r.id}`}>{t("veDev.review",locale)}</button>:null}</td>
            </tr>)}</tbody>
          </table>:null}
        </article>):<div className="empty-state" data-testid="veDev.cases.empty"><strong>{t("veDev.noCases",locale)}</strong></div>}</div>
      </section>
    </div>:<div className="employee-development__split" style={{display:"grid",gridTemplateColumns:"minmax(420px,.9fr) minmax(500px,1.1fr)",gap:14}}>
      <section className="surface-panel">
        <h3 style={{marginTop:0}}>{t("veDev.newEvaluation",locale)}</h3>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <label style={labelStyle}>{t("veDev.periodStart",locale)}<input type="date" value={evaluation.periodStart} onChange={e=>setEvaluation({...evaluation,periodStart:e.target.value})} title={t("veDev.periodStart",locale)}/></label>
          <label style={labelStyle}>{t("veDev.periodEnd",locale)}<input type="date" value={evaluation.periodEnd} onChange={e=>setEvaluation({...evaluation,periodEnd:e.target.value})} title={t("veDev.periodEnd",locale)}/></label>
          <label style={labelStyle}>{t("veDev.stage",locale)}<select value={evaluation.employmentStage} onChange={e=>setEvaluation({...evaluation,employmentStage:e.target.value})} title={t("veDev.stage",locale)}>{Object.entries(stageKeys).map(([value,key])=><option key={value} value={value}>{t(key,locale)}</option>)}</select></label>
          {([["taskCompletionScore","veDev.score.taskCompletion"],["qualityScore","veDev.score.quality"],["efficiencyScore","veDev.score.efficiency"],["complianceScore","veDev.score.compliance"],["collaborationScore","veDev.score.collaboration"],["supervisorScore","veDev.score.supervisor"]] as const).map(([k,key])=><label key={k} style={labelStyle}>{t(key,locale)}<input type="number" min={0} max={100} value={evaluation[k]} onChange={e=>setEvaluation({...evaluation,[k]:Number(e.target.value)})} title={t(key,locale)}/></label>)}
        </div>
        <label style={{...labelStyle,marginTop:10}}>{t("veDev.strengths",locale)}<textarea rows={3} value={evaluation.strengths} onChange={e=>setEvaluation({...evaluation,strengths:e.target.value})} title={t("veDev.strengths",locale)}/></label>
        <label style={{...labelStyle,marginTop:10}}>{t("veDev.improvementPlan",locale)}<textarea rows={4} value={evaluation.improvementPlan} onChange={e=>setEvaluation({...evaluation,improvementPlan:e.target.value})} title={t("veDev.improvementPlan",locale)}/></label>
        <button type="button" className="action-button" style={{marginTop:10}} onClick={()=>void addEvaluation()} title={t("veDev.createDraft",locale)} data-testid="veDev.eval.create">{t("veDev.createDraft",locale)}</button>
      </section>
      <section className="surface-panel">
        <h3 style={{marginTop:0}}>{t("veDev.history",locale)}</h3>
        {evaluations.length?<table className="data-table" data-testid="veDev.evaluations">
          <thead><tr><th>{t("veDev.col.grade",locale)}</th><th>{t("veDev.col.period",locale)}</th><th>{t("veDev.col.stageStatus",locale)}</th><th>{t("veDev.col.plan",locale)}</th><th>{t("veDev.col.action",locale)}</th></tr></thead>
          <tbody>{evaluations.map(x=><tr key={x.id} data-testid={`veDev.eval.${x.id}`}>
            <td><strong style={{fontSize:20}}>{x.grade}</strong> <small>{x.total_score}</small></td>
            <td>{x.period_start} — {x.period_end}</td>
            <td>{stageLabel(x.employment_stage,locale)} · <span className={x.status==="APPROVED"?"badge badge-ok":x.status==="DRAFT"?"badge badge-warning":"badge badge-muted"} title={evalStatusLabel(x.status,locale)}>{evalStatusLabel(x.status,locale)}</span></td>
            <td><small>{x.improvement_plan||t("veDev.noImprovementPlan",locale)}</small></td>
            <td>{x.status==="DRAFT"?<button type="button" onClick={()=>void approve(x.id)} title={t("veDev.approve",locale)} data-testid={`veDev.approve.${x.id}`}>{t("veDev.approve",locale)}</button>:<span title={t("veDev.evalStatus.approved",locale)}><CheckCircle2 size={16} color="var(--ok)" aria-label={t("veDev.evalStatus.approved",locale)}/></span>}</td>
          </tr>)}</tbody>
        </table>:<div className="empty-state" data-testid="veDev.evaluations.empty"><strong>{t("veDev.noEvaluations",locale)}</strong></div>}
      </section>
    </div>}
    {message&&<p className="error-note" role="alert" data-testid="veDev.error">{message}</p>}
    {runCase&&<div className="modal-overlay" onClick={()=>!runBusy&&setRunCase(null)}>
      <div className="surface-panel" role="dialog" aria-modal="true" aria-labelledby="ve-dev-run-title" onClick={e=>e.stopPropagation()} style={{maxWidth:520,width:"90vw",boxShadow:"0 8px 32px rgba(0,0,0,.18)"}}>
        <div className="section-header">
          <h3 id="ve-dev-run-title" style={{margin:0}}>{t("veDev.runModalTitle",locale)}</h3>
          <button type="button" className="modal-close" onClick={()=>setRunCase(null)} aria-label={t("veDev.close",locale)} title={t("veDev.close",locale)}><X size={16} aria-hidden="true"/></button>
        </div>
        <div style={{display:"grid",gap:10,padding:"12px 0"}}>
          <p style={{margin:0,color:"var(--muted)",fontSize:12}}>{runCase.title}</p>
          <label style={labelStyle}>{t("veDev.runResponseLabel",locale)}<textarea rows={6} value={runResponse} onChange={e=>setRunResponse(e.target.value)} title={t("veDev.runResponseLabel",locale)} data-testid="veDev.run.response"/></label>
          <small style={{color:"var(--muted)"}}>{t("veDev.runResponseHint",locale)}</small>
        </div>
        <div className="toolbar" style={{justifyContent:"flex-end"}}>
          <button type="button" onClick={()=>setRunCase(null)} title={t("veDev.cancel",locale)}>{t("veDev.cancel",locale)}</button>
          <button type="button" className="action-button" onClick={()=>void submitRun()} disabled={runBusy||!runResponse.trim()} title={t("veDev.runSubmit",locale)} data-testid="veDev.run.submit">{t("veDev.runSubmit",locale)}</button>
        </div>
      </div>
    </div>}
    {reviewRun&&<div className="modal-overlay" onClick={()=>!reviewBusy&&setReviewRun(null)}>
      <div className="surface-panel" role="dialog" aria-modal="true" aria-labelledby="ve-dev-review-title" onClick={e=>e.stopPropagation()} style={{maxWidth:520,width:"90vw",boxShadow:"0 8px 32px rgba(0,0,0,.18)"}}>
        <div className="section-header">
          <h3 id="ve-dev-review-title" style={{margin:0}}>{t("veDev.reviewModalTitle",locale)}</h3>
          <button type="button" className="modal-close" onClick={()=>setReviewRun(null)} aria-label={t("veDev.close",locale)} title={t("veDev.close",locale)}><X size={16} aria-hidden="true"/></button>
        </div>
        <div style={{display:"grid",gap:10,padding:"12px 0"}}>
          <label style={labelStyle}>{t("veDev.reviewScore",locale)}<input type="number" min={0} max={100} value={reviewScore} onChange={e=>setReviewScore(e.target.value)} title={t("veDev.reviewScore",locale)} data-testid="veDev.review.score"/></label>
          <label style={labelStyle}>{t("veDev.reviewFeedback",locale)}<textarea rows={4} value={reviewFeedback} onChange={e=>setReviewFeedback(e.target.value)} title={t("veDev.reviewFeedback",locale)} data-testid="veDev.review.feedback"/></label>
        </div>
        <div className="toolbar" style={{justifyContent:"flex-end"}}>
          <button type="button" onClick={()=>setReviewRun(null)} title={t("veDev.cancel",locale)}>{t("veDev.cancel",locale)}</button>
          <button type="button" className="action-button" onClick={()=>void submitReview()} disabled={reviewBusy||!reviewScoreValid} title={t("veDev.reviewSubmit",locale)} data-testid="veDev.review.submit">{t("veDev.reviewSubmit",locale)}</button>
        </div>
      </div>
    </div>}
  </div>;
}
