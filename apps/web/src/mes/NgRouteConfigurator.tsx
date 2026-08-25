import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, History, LockKeyhole, Route, ShieldCheck } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi, type Station } from "../api/mes";

type Lifecycle = "DRAFT" | "APPROVED" | "PUBLISHED";
type Action = "MARK_ONLY" | "SEND_REPAIR" | "REMOVE_IMMEDIATELY" | "RETEST_AUTH" | "SCRAP_REVIEW";

type Copy = {
  title: string; subtitle: string; boundary: string; policies: string; newDraft: string; unsaved: string;
  lifecycle: string; version: string; source: string; condition: string; target: string; action: string;
  result: string; failCount: string; age: string; defect: string; anyDefect: string; targetStation: string;
  authorization: string; role: string; deviation: string; deviationHelp: string; reason: string;
  preview: string; previewHint: string; history: string; noHistory: string; save: string; submit: string;
  publish: string; unavailable: string; loading: string; loadError: string; selectStation: string;
  required: string; immutable: string; approvalChain: string; configOwner: string; effective: string;
  states: Record<Lifecycle, string>; actions: Record<Action, string>;
};

const COPY: Record<Locale, Copy> = {
  "zh-CN": {
    title:"NG 路由配置器", subtitle:"统一配置来源工站、触发条件、目标和处置动作；MES 审批发布后才可成为生产规则。",
    boundary:"当前没有 NG 路由策略 API。此页面仅编辑本地未保存草稿；不会写入 MES，也不会显示虚假保存成功。",
    policies:"策略列表", newDraft:"新建草稿", unsaved:"未保存草稿", lifecycle:"生命周期", version:"版本", source:"来源工站",
    condition:"触发条件", target:"目标与动作", action:"动作", result:"结果", failCount:"连续失败次数", age:"NG 滞留分钟",
    defect:"缺陷代码", anyDefect:"任意缺陷", targetStation:"目标工站", authorization:"需要授权", role:"授权角色",
    deviation:"偏离报警", deviationHelp:"产品未按已发布策略到达目标工站时产生新事件报警。", reason:"配置原因",
    preview:"流程预览", previewHint:"预览只解释当前草稿，不代表已批准或已发布。", history:"不可变历史", noHistory:"尚无服务端审计历史；发布后必须由 MES 返回版本、操作者、原因和时间。",
    save:"保存草稿", submit:"提交审批", publish:"发布", unavailable:"缺少后端策略合约", loading:"正在读取工站…", loadError:"工站读取失败", selectStation:"请选择工站",
    required:"必填", immutable:"已发布版本不可原地修改；变更必须创建新版本。", approvalChain:"审批链", configOwner:"配置负责人", effective:"生效时间",
    states:{DRAFT:"草稿",APPROVED:"已批准",PUBLISHED:"已发布"},
    actions:{MARK_ONLY:"仅标记/报警",SEND_REPAIR:"送维修站",REMOVE_IMMEDIATELY:"立即取出",RETEST_AUTH:"复测授权",SCRAP_REVIEW:"报废评审"},
  },
  "en-US": {
    title:"NG Route Configurator", subtitle:"Configure source station, trigger, destination, and disposition. A rule becomes production authority only after MES approval and publication.",
    boundary:"No NG-route policy API exists yet. This screen edits one unsaved local draft only; it never writes MES data or reports a false save.",
    policies:"Policies", newDraft:"New draft", unsaved:"Unsaved draft", lifecycle:"Lifecycle", version:"Version", source:"Source station",
    condition:"Trigger condition", target:"Destination & action", action:"Action", result:"Result", failCount:"Consecutive failures", age:"NG age (minutes)",
    defect:"Defect code", anyDefect:"Any defect", targetStation:"Target station", authorization:"Authorization required", role:"Required role",
    deviation:"Deviation alarm", deviationHelp:"Create a new event when the product does not reach the target defined by the published policy.", reason:"Configuration reason",
    preview:"Flow preview", previewHint:"The preview explains this draft; it is not approved or published.", history:"Immutable history", noHistory:"No server audit history is available. MES must return version, actor, reason, and time after publication.",
    save:"Save draft", submit:"Submit approval", publish:"Publish", unavailable:"Backend policy contract is missing", loading:"Loading stations…", loadError:"Stations could not be loaded", selectStation:"Select station",
    required:"Required", immutable:"Published versions cannot be edited in place; every change creates a new version.", approvalChain:"Approval chain", configOwner:"Configuration owner", effective:"Effective at",
    states:{DRAFT:"Draft",APPROVED:"Approved",PUBLISHED:"Published"},
    actions:{MARK_ONLY:"Mark / alarm only",SEND_REPAIR:"Send to repair",REMOVE_IMMEDIATELY:"Remove immediately",RETEST_AUTH:"Authorize retest",SCRAP_REVIEW:"Scrap review"},
  },
  "vi-VN": {
    title:"Cấu hình tuyến NG", subtitle:"Cấu hình trạm nguồn, điều kiện, đích và hành động. Chỉ quy tắc được MES phê duyệt và phát hành mới có hiệu lực sản xuất.",
    boundary:"Chưa có API chính sách tuyến NG. Màn hình chỉ sửa một bản nháp cục bộ chưa lưu; không ghi MES và không báo lưu thành công giả.",
    policies:"Danh sách chính sách", newDraft:"Tạo bản nháp", unsaved:"Bản nháp chưa lưu", lifecycle:"Vòng đời", version:"Phiên bản", source:"Trạm nguồn",
    condition:"Điều kiện kích hoạt", target:"Đích và hành động", action:"Hành động", result:"Kết quả", failCount:"Số lần lỗi liên tiếp", age:"Thời gian NG (phút)",
    defect:"Mã lỗi", anyDefect:"Mọi lỗi", targetStation:"Trạm đích", authorization:"Yêu cầu ủy quyền", role:"Vai trò yêu cầu",
    deviation:"Cảnh báo sai tuyến", deviationHelp:"Tạo sự kiện mới khi sản phẩm không đến đích theo chính sách đã phát hành.", reason:"Lý do cấu hình",
    preview:"Xem trước luồng", previewHint:"Bản xem trước chỉ giải thích bản nháp; chưa được duyệt hoặc phát hành.", history:"Lịch sử bất biến", noHistory:"Chưa có lịch sử kiểm toán máy chủ. MES phải trả về phiên bản, người thao tác, lý do và thời gian sau khi phát hành.",
    save:"Lưu bản nháp", submit:"Gửi phê duyệt", publish:"Phát hành", unavailable:"Thiếu hợp đồng chính sách backend", loading:"Đang tải trạm…", loadError:"Không thể tải trạm", selectStation:"Chọn trạm",
    required:"Bắt buộc", immutable:"Không sửa trực tiếp phiên bản đã phát hành; mọi thay đổi tạo phiên bản mới.", approvalChain:"Chuỗi phê duyệt", configOwner:"Người phụ trách", effective:"Thời điểm hiệu lực",
    states:{DRAFT:"Bản nháp",APPROVED:"Đã duyệt",PUBLISHED:"Đã phát hành"},
    actions:{MARK_ONLY:"Chỉ đánh dấu / cảnh báo",SEND_REPAIR:"Chuyển sửa chữa",REMOVE_IMMEDIATELY:"Lấy ra ngay",RETEST_AUTH:"Cho phép kiểm tra lại",SCRAP_REVIEW:"Xét phế"},
  },
};

const lifecycleTone: Record<Lifecycle, string> = { DRAFT:"var(--muted)", APPROVED:"var(--ok)", PUBLISHED:"var(--info)" };

export function NgRouteConfigurator({ locale }: { locale: Locale }) {
  const c = COPY[locale];
  const [stations,setStations]=useState<Station[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState("");
  const [source,setSource]=useState(""),[target,setTarget]=useState(""),[action,setAction]=useState<Action>("SEND_REPAIR");
  const [failCount,setFailCount]=useState(1),[ageMinutes,setAgeMinutes]=useState(0),[defect,setDefect]=useState("");
  const [requiresAuth,setRequiresAuth]=useState(true),[role,setRole]=useState("QUALITY_ENGINEER"),[deviationAlarm,setDeviationAlarm]=useState(true);
  const [reason,setReason]=useState(""),[owner,setOwner]=useState("");

  useEffect(()=>{let active=true;mesApi.getStations().then(result=>{if(active)setStations(result.items??[])}).catch(error=>{if(active)setLoadError(error instanceof Error?error.message:c.loadError)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[c.loadError]);
  const stationName=(item: Station | undefined)=>{
    if(!item)return "";
    if(locale==="vi-VN")return item.nameVi||item.nameEn||item.code;
    if(locale==="en-US")return item.nameEn||item.nameZh||item.code;
    return item.nameZh||item.nameEn||item.code;
  };
  const sourceName=useMemo(()=>stationName(stations.find(item=>item.code===source))||source||c.selectStation,[c.selectStation,locale,source,stations]);
  const targetName=useMemo(()=>stationName(stations.find(item=>item.code===target))||target||c.selectStation,[c.selectStation,locale,target,stations]);
  const disabledTip=`${c.unavailable}. ${c.boundary}`;
  const validity = source && target && reason.trim() && owner.trim();

  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header"><div><div style={{color:"var(--danger)",fontSize:11,fontWeight:800,letterSpacing:".08em"}}>MES / NG GOVERNANCE</div><h2>{c.title}</h2><p>{c.subtitle}</p></div>
        <div style={{display:"flex",gap:7}}>{(["DRAFT","APPROVED","PUBLISHED"] as Lifecycle[]).map(state=><span key={state} className="badge" title={`${c.lifecycle}: ${c.states[state]}`} style={{borderColor:lifecycleTone[state],color:lifecycleTone[state]}}>{state} / {c.states[state]}</span>)}</div></div>
      <div role="status" style={{display:"flex",gap:9,alignItems:"flex-start",padding:11,border:"1px solid var(--warn)",borderRadius:8,background:"rgba(242,184,75,.08)",color:"var(--warn)"}}><AlertTriangle size={17}/><span>{c.boundary}</span></div>
    </section>

    <div style={{display:"grid",gridTemplateColumns:"250px minmax(520px,1fr) 340px",gap:12,alignItems:"start"}}>
      <aside className="surface-panel" style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:12,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}><strong>{c.policies}</strong><button type="button" title={`${c.newDraft}: ${c.unavailable}`} disabled>+</button></div>
        <button type="button" title={c.previewHint} style={{width:"100%",padding:13,textAlign:"left",border:0,borderLeft:"4px solid var(--muted)",background:"rgba(158,176,188,.08)",color:"var(--text)"}}><b style={{display:"block"}}>{c.unsaved}</b><small style={{color:"var(--muted)"}}>DRAFT / v0.1-local</small></button>
        <div style={{padding:12,color:"var(--muted)",fontSize:11,borderTop:"1px solid var(--border)"}}><History size={14} style={{verticalAlign:"middle",marginRight:5}}/>{c.immutable}</div>
      </aside>

      <main className="surface-panel">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <label>{c.source} <span style={{color:"var(--danger)"}}>*</span><select value={source} onChange={e=>setSource(e.target.value)} title={c.source} disabled={loading}>{loading?<option>{c.loading}</option>:<><option value="">{c.selectStation}</option>{stations.map(s=><option key={s.code} value={s.code}>{s.code} / {stationName(s)}</option>)}</>}</select></label>
          <label>{c.version}<input value="v0.1-local" readOnly title={`${c.version}: ${c.unsaved}`} /></label>
        </div>{loadError&&<div style={{color:"var(--danger)",fontSize:12,marginTop:5}}>{c.loadError}: {loadError}</div>}

        <fieldset style={{marginTop:14,border:"1px solid var(--border)",borderRadius:9,padding:12}}><legend style={{padding:"0 6px",fontWeight:700}}>{c.condition}</legend>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}><label>{c.result}<select title={c.result}><option>NG / FAIL</option></select></label><label>{c.failCount}<input type="number" min={1} value={failCount} onChange={e=>setFailCount(Math.max(1,Number(e.target.value)))} title={c.failCount}/></label><label>{c.age}<input type="number" min={0} value={ageMinutes} onChange={e=>setAgeMinutes(Math.max(0,Number(e.target.value)))} title={c.age}/></label></div>
          <label style={{marginTop:9}}>{c.defect}<input value={defect} onChange={e=>setDefect(e.target.value.toUpperCase())} placeholder={c.anyDefect} title={c.defect}/></label>
        </fieldset>

        <fieldset style={{marginTop:14,border:"1px solid var(--border)",borderRadius:9,padding:12}}><legend style={{padding:"0 6px",fontWeight:700}}>{c.target}</legend>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label>{c.targetStation} <span style={{color:"var(--danger)"}}>*</span><select value={target} onChange={e=>setTarget(e.target.value)} title={c.targetStation}><option value="">{c.selectStation}</option>{stations.map(s=><option key={s.code} value={s.code}>{s.code} / {stationName(s)}</option>)}</select></label><label>{c.action}<select value={action} onChange={e=>setAction(e.target.value as Action)} title={c.action}>{(Object.keys(c.actions) as Action[]).map(value=><option key={value} value={value}>{c.actions[value]}</option>)}</select></label></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:9}}><label><input type="checkbox" checked={requiresAuth} onChange={e=>setRequiresAuth(e.target.checked)} title={c.authorization}/> {c.authorization}</label><label>{c.role}<select value={role} onChange={e=>setRole(e.target.value)} disabled={!requiresAuth} title={!requiresAuth?`${c.role}: ${c.authorization}`:c.role}><option>QUALITY_ENGINEER</option><option>LINE_LEADER</option><option>PRODUCTION_MANAGER</option><option>MES_ADMIN</option></select></label></div>
          <label style={{marginTop:9}}><input type="checkbox" checked={deviationAlarm} onChange={e=>setDeviationAlarm(e.target.checked)} title={c.deviationHelp}/> {c.deviation}</label><small style={{display:"block",color:"var(--muted)",marginTop:4}}>{c.deviationHelp}</small>
        </fieldset>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:14}}><label>{c.configOwner} <span style={{color:"var(--danger)"}}>*</span><input value={owner} onChange={e=>setOwner(e.target.value)} title={c.configOwner}/></label><label>{c.effective}<input value="-" readOnly title={`${c.effective}: ${c.publish}`} /></label></div>
        <label style={{marginTop:9}}>{c.reason} <span style={{color:"var(--danger)"}}>*</span><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3} title={c.reason}/></label>
        {!validity&&<div style={{color:"var(--warn)",fontSize:11,marginTop:6}}>{c.required}: {c.source}, {c.targetStation}, {c.configOwner}, {c.reason}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>{[c.save,c.submit,c.publish].map(label=><button key={label} type="button" disabled title={disabledTip}>{label}</button>)}</div>
      </main>

      <aside style={{display:"grid",gap:12}}>
        <section className="surface-panel"><h3 style={{marginTop:0}}><Route size={16} style={{verticalAlign:"middle",marginRight:6}}/>{c.preview}</h3><p style={{color:"var(--muted)",fontSize:11}}>{c.previewHint}</p>
          <div style={{display:"grid",gap:9}}><div style={{padding:10,border:"1px solid var(--info)",borderRadius:8}}><small>{c.source}</small><b style={{display:"block"}}>{sourceName}</b></div><ArrowRight style={{justifySelf:"center",color:"var(--muted)"}}/><div style={{padding:10,border:"1px solid var(--warn)",borderRadius:8}}><small>{c.condition}</small><b style={{display:"block"}}>NG/FAIL x {failCount}{ageMinutes?` / ${ageMinutes}m or more`:""}</b><span style={{fontSize:11,color:"var(--muted)"}}>{defect||c.anyDefect}</span></div><ArrowRight style={{justifySelf:"center",color:"var(--muted)"}}/><div style={{padding:10,border:"1px solid var(--danger)",borderRadius:8}}><small>{c.actions[action]}</small><b style={{display:"block"}}>{targetName}</b></div></div>
          <div style={{marginTop:10,fontSize:11,color:requiresAuth?"var(--warn)":"var(--muted)"}}><LockKeyhole size={13} style={{verticalAlign:"middle",marginRight:4}}/>{requiresAuth?`${c.authorization}: ${role}`:`${c.authorization}: -`}</div>{deviationAlarm&&<div style={{marginTop:6,fontSize:11,color:"var(--danger)"}}><AlertTriangle size={13} style={{verticalAlign:"middle",marginRight:4}}/>{c.deviation}</div>}
        </section>
        <section className="surface-panel"><h3 style={{marginTop:0}}><ShieldCheck size={16} style={{verticalAlign:"middle",marginRight:6}}/>{c.approvalChain}</h3><div style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}><span>DRAFT</span><ArrowRight size={13}/><span>APPROVED</span><ArrowRight size={13}/><span>PUBLISHED</span></div><p style={{fontSize:11,color:"var(--muted)"}}>{c.immutable}</p></section>
        <section className="surface-panel"><h3 style={{marginTop:0}}><History size={16} style={{verticalAlign:"middle",marginRight:6}}/>{c.history}</h3><p style={{fontSize:11,color:"var(--muted)"}}>{c.noHistory}</p></section>
      </aside>
    </div>
  </div>;
}
