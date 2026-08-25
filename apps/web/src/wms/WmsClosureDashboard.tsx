import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi, type WmsClosureDashboardData } from "../api/wms";

const copy={
  "zh-CN":{title:"WMS 闭环控制中心",sub:"异常、审批、冻结、交接与超时统一监管",badge:"员工工号 / 扫码",refresh:"刷新",cases:"未闭环事项",handovers:"在途交接",none:"当前没有记录",action:"操作",send:"发起交接",receive:"扫码接收"},
  "en-US":{title:"WMS Closed-loop Control",sub:"Unified exceptions, approvals, freezes, handovers and SLA monitoring",badge:"Employee badge / scan",refresh:"Refresh",cases:"Open cases",handovers:"Custody handovers",none:"No records",action:"Action",send:"Send",receive:"Scan receive"},
  "vi-VN":{title:"Trung tâm kiểm soát vòng kín WMS",sub:"Giám sát ngoại lệ, phê duyệt, khóa, bàn giao và SLA",badge:"Mã nhân viên / quét",refresh:"Làm mới",cases:"Hồ sơ đang mở",handovers:"Bàn giao",none:"Không có dữ liệu",action:"Thao tác",send:"Bàn giao",receive:"Quét nhận"},
} as const;

const processCopy={
  "zh-CN":{title:"端到端闭环关卡",receiving:"收货登记",iqc:"IQC 判定",putaway:"上架入库",issue:"领料发料",consumption:"生产消耗",returns:"退料接收",reconciliation:"盘点与差异",audit:"审计追踪",done:"24小时完成",open:"待处理",controlled:"受控",attention:"需处理",owner:"责任方",sla:"SLA",openPage:"处理",overdue:"超时",queue:"闭环处理队列",entity:"批次/对象",state:"当前状态",qty:"数量",age:"等待分钟"},
  "en-US":{title:"End-to-end closure gates",receiving:"Receiving",iqc:"IQC disposition",putaway:"Put-away",issue:"Material issue",consumption:"Consumption",returns:"Returns",reconciliation:"Reconciliation",audit:"Audit trail",done:"Completed 24h",open:"Open",controlled:"Controlled",attention:"Attention",owner:"Owner",sla:"SLA",openPage:"Resolve",overdue:"Overdue",queue:"Closure action queue",entity:"Lot / Entity",state:"State",qty:"Quantity",age:"Age (min)"},
  "vi-VN":{title:"Cổng khép kín đầu-cuối",receiving:"Tiếp nhận",iqc:"Phán định IQC",putaway:"Cất hàng",issue:"Cấp vật liệu",consumption:"Tiêu hao",returns:"Trả vật liệu",reconciliation:"Kiểm kê và đối soát",audit:"Dấu vết kiểm toán",done:"Hoàn tất 24h",open:"Chờ xử lý",controlled:"Được kiểm soát",attention:"Cần xử lý",owner:"Phụ trách",sla:"SLA",openPage:"Xử lý",overdue:"Quá hạn",queue:"Hàng đợi xử lý",entity:"Lô / Đối tượng",state:"Trạng thái",qty:"Số lượng",age:"Phút chờ"},
} as const;

export function WmsClosureDashboard({locale}:{locale:Locale}){
  const c=copy[locale]??copy["zh-CN"];
  const p=processCopy[locale]??processCopy["zh-CN"];
  const [data,setData]=useState<WmsClosureDashboardData|null>(null);
  const [actor,setActor]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState<number|null>(null);
  const load=useCallback(async()=>{try{setData(await wmsApi.getClosureDashboard());setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}},[]);
  useEffect(()=>{void load();const timer=setInterval(load,15000);return()=>clearInterval(timer);},[load]);
  const run=async(id:number,fn:()=>Promise<unknown>)=>{
    if(!actor.trim()){setError(c.badge);return;}
    try{setBusy(id);await fn();await load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(null);}
  };
  const approve=(x:WmsClosureDashboardData["cases"][number])=>run(x.id,()=>wmsApi.decideClosureCase(x.id,{decision:"APPROVE",approvalRole:"WAREHOUSE_SUPERVISOR",actorBadge:actor.trim(),comment:"Dashboard approval"}));
  const reject=(x:WmsClosureDashboardData["cases"][number])=>run(x.id,()=>wmsApi.decideClosureCase(x.id,{decision:"REJECT",approvalRole:"WAREHOUSE_SUPERVISOR",actorBadge:actor.trim(),comment:"Dashboard rejection"}));
  const send=(x:WmsClosureDashboardData["cases"][number])=>run(x.id,()=>wmsApi.createClosureHandover({caseId:x.id,entityType:x.entityType,entityKey:x.entityKey,quantity:Math.max(1,Number(x.actualQty??1)),fromDomain:"WMS",toDomain:x.caseType==="LINE_RETURN"?"QUALITY":"WAREHOUSE_CONTROL",senderBadge:actor.trim(),dueMinutes:15}));
  const receive=(id:number)=>run(id,()=>wmsApi.receiveClosureHandover(id,actor.trim()));
  const m=data?.metrics;
  const metrics=[["Pending",m?.pending_approval??0],["In transit",m?.in_transit??0],["Overdue",m?.overdue_cases??0],["Handover overdue",m?.overdue_handovers??0],["Frozen",m?.active_freezes??0],["Closed today",m?.closed_today??0]];
  return <div className="screen-stack">
    <section className="surface-panel"><div className="section-header"><div><h2>{c.title}</h2><p>{c.sub}</p></div><div className="toolbar"><input value={actor} onChange={e=>setActor(e.target.value)} placeholder={c.badge}/><button className="btn btn-secondary" onClick={()=>void load()}>{c.refresh}</button></div></div>{error&&<div className="badge badge-danger">{error}</div>}</section>
    <div className="metric-grid">{metrics.map(([name,value])=><article className="stat-card" key={String(name)}><span>{name}</span><strong>{value}</strong></article>)}</div>
    <section className="surface-panel"><div className="section-header"><div><h2>{p.title}</h2><p>Receiving → IQC → Put-away → Issue → Consumption → Return → Reconciliation → Audit</p></div></div>
      <div className="metric-grid">{(data?.processes??[]).map(item=><article className="stat-card" key={item.key} style={{borderTop:`4px solid ${item.status==="ATTENTION"?"var(--danger)":"var(--ok)"}`}}>
        <span>{p[item.key]}</span><strong>{item.openCount}</strong>
        <small>{p.open} · {p.done}: {item.completed24h}</small>
        <small>{p.owner}: {item.owner} · {p.sla}: {item.slaMinutes} min</small>
        <small style={{color:item.overdueCount?"var(--danger)":undefined}}>{p.overdue}: {item.overdueCount}</small>
        <span className={`badge badge-${item.status==="ATTENTION"?"danger":"ok"}`}>{item.status==="ATTENTION"?p.attention:p.controlled}</span>
        <button className="btn btn-secondary" onClick={()=>window.location.assign(`/?view=wms&wmsTab=${encodeURIComponent(item.tab)}`)}>{p.openPage}</button>
      </article>)}</div>
    </section>
    <section className="surface-panel"><div className="section-header"><h2>{p.queue}</h2></div><div className="table-shell"><table><thead><tr><th>{p.entity}</th><th>Gate</th><th>{p.state}</th><th>{p.qty}</th><th>{p.age}</th><th>{c.action}</th></tr></thead><tbody>
      {(data?.gateItems??[]).length?(data?.gateItems??[]).map(item=><tr key={`${item.processKey}-${item.entityKey}`}><td>{item.entityKey}</td><td>{p[item.processKey]}</td><td><span className={`badge badge-${item.overdue?"danger":"warning"}`}>{item.state}{item.overdue?` · ${p.overdue}`:""}</span></td><td>{item.quantity}</td><td>{item.ageMinutes}</td><td><button className="btn btn-primary" onClick={()=>window.location.assign(`/?view=wms&wmsTab=${item.processKey==="iqc"?"iqcClosedLoop":"putaway"}`)}>{p.openPage}</button></td></tr>):<tr><td colSpan={6}>{c.none}</td></tr>}
    </tbody></table></div></section>
    <section className="surface-panel"><div className="section-header"><h2>{c.cases}</h2></div><div className="table-shell"><table><thead><tr><th>No.</th><th>Type</th><th>Entity</th><th>Status</th><th>Owner</th><th>Time</th><th>{c.action}</th></tr></thead><tbody>
      {data?.cases?.length?data.cases.map(x=><tr key={x.id}><td>{x.caseNo}</td><td>{x.caseType}</td><td>{x.entityKey}</td><td><span className={`badge badge-${x.riskLevel==="CRITICAL"?"danger":"warning"}`}>{x.status}</span></td><td>{x.requestedBy}</td><td>{new Date(x.requestedAt).toLocaleString()}</td><td><div className="toolbar">{x.status==="PENDING_APPROVAL"&&<><button disabled={busy===x.id} className="btn btn-primary" onClick={()=>void approve(x)}>Approve</button><button disabled={busy===x.id} className="btn btn-secondary" onClick={()=>void reject(x)}>Reject</button></>}{x.status==="APPROVED"&&<button disabled={busy===x.id} className="btn btn-primary" onClick={()=>void send(x)}>{c.send}</button>}</div></td></tr>):<tr><td colSpan={7}>{c.none}</td></tr>}
    </tbody></table></div></section>
    <section className="surface-panel"><div className="section-header"><h2>{c.handovers}</h2></div><div className="table-shell"><table><thead><tr><th>No.</th><th>Entity</th><th>Route</th><th>Qty</th><th>Status</th><th>Due / Action</th></tr></thead><tbody>
      {data?.handovers.length?data.handovers.map(x=><tr key={x.id}><td>{x.handoverNo}</td><td>{x.entityKey}</td><td>{x.fromDomain} → {x.toDomain}</td><td>{x.quantity}</td><td><span className={`badge badge-${x.overdue?"danger":"info"}`}>{x.overdue?"OVERDUE":x.status}</span></td><td>{new Date(x.dueAt).toLocaleString()} {x.status==="IN_TRANSIT"&&<button disabled={busy===x.id} className="btn btn-primary" onClick={()=>void receive(x.id)}>{c.receive}</button>}</td></tr>):<tr><td colSpan={6}>{c.none}</td></tr>}
    </tbody></table></div></section>
  </div>;
}
