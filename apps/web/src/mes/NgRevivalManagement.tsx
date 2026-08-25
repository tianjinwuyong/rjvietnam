import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Revival = {
  revivalId:number; sn:string; batchId?:string; originStation?:string; returnStation?:string;
  repairResult?:string; operator?:string; approvalStatus:string; approvalReason?:string;
  qualityApprover?:string; lineLeaderApprover?:string; approvedAt?:string; revivedAt?:string;
};
type ReturnOrder={transferId:number;batchId:string;sourceStation:string;destinationStation:string;destinationType:string;
  status:string;sentAt:string;receivedAt?:string;acceptedBy?:string;alarmedAt?:string;alarmAcknowledgedAt?:string;
  alarmAcknowledgedBy?:string;motherboard?:{subBoards?:unknown[]}};

const labels:Record<string,Record<Locale,string>>={
  title:{"zh-CN":"NG复活管理","en-US":"NG Revival Management","vi-VN":"Quản lý khôi phục NG"},
  subtitle:{"zh-CN":"维修申请 · 品质批准 · 线长批准 · MES全线解除","en-US":"Repair request · Quality approval · Line-leader approval · MES release","vi-VN":"Yêu cầu sửa chữa · Chất lượng duyệt · Trưởng chuyền duyệt · MES giải phóng"},
};

export function NgRevivalManagement({locale}:{locale:Locale}){
  const [rows,setRows]=useState<Revival[]>([]); const [query,setQuery]=useState("");
  const [interceptions,setInterceptions]=useState<any[]>([]); const [interceptionSummary,setInterceptionSummary]=useState<any[]>([]);
  const [returnOrders,setReturnOrders]=useState<ReturnOrder[]>([]);
  const [status,setStatus]=useState("ALL"); const [busy,setBusy]=useState<number|null>(null);
  const [message,setMessage]=useState("");
  const refresh=useCallback(async()=>{
    const response=await fetch('/api/rework/revival-board');
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data=await response.json(); setRows(data.items||[]);
    const interceptionResponse=await fetch('/api/station/interceptions');
    if(interceptionResponse.ok){const interceptionData=await interceptionResponse.json();setInterceptions(interceptionData.items||[]);setInterceptionSummary(interceptionData.summary||[]);}
    const routeResponse=await fetch('/api/station/handovers');
    if(routeResponse.ok){const routeData=await routeResponse.json();setReturnOrders((routeData.items||[]).filter((r:ReturnOrder)=>r.destinationType==='REPAIR_RETURN'));}
  },[]);
  useEffect(()=>{refresh().catch(e=>setMessage(String(e)));const timer=window.setInterval(()=>refresh().catch(()=>{}),5000);return()=>clearInterval(timer);},[refresh]);
  const approve=async(row:Revival)=>{
    const role=row.approvalStatus==='PENDING_QUALITY'?'QUALITY':'LINE_LEADER';
    const approver=window.prompt(role==='QUALITY'?'请输入品质批准人':'请输入线长批准人'); if(!approver)return;
    const reason=window.prompt('请输入批准理由（必填）'); if(!reason)return;
    setBusy(row.revivalId);setMessage('');
    try{
      const response=await fetch(`/api/rework/revival-board/${row.revivalId}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,approver,reason})});
      const data=await response.json();if(!response.ok)throw new Error(data?.message||`HTTP ${response.status}`);
      await refresh();setMessage(role==='QUALITY'?'品质批准完成，等待线长批准':'线长批准完成，等待维修站执行复活');
    }catch(e){setMessage(`操作失败：${String(e)}`);}finally{setBusy(null);}
  };
  const acknowledgeAlarm=async(row:ReturnOrder)=>{
    const response=await fetch(`/api/station/handovers/${row.transferId}/acknowledge-alarm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor:'MES_MANUAL_RELEASE'})});
    const data=await response.json();if(!response.ok){setMessage(data?.message||`HTTP ${response.status}`);return;}await refresh();
  };
  const filtered=useMemo(()=>rows.filter(row=>(status==='ALL'||row.approvalStatus===status)&&
    `${row.sn} ${row.batchId||''} ${row.originStation||''} ${row.returnStation||''}`.toUpperCase().includes(query.trim().toUpperCase())),[rows,status,query]);
  const count=(s:string)=>rows.filter(r=>r.approvalStatus===s).length;
  return <div className="surface-panel" style={{padding:18}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center'}}>
      <div><h2 style={{margin:0}}>{labels.title[locale]}</h2><div style={{opacity:.7,marginTop:4}}>{labels.subtitle[locale]}</div></div>
      <button className="action-button" onClick={()=>refresh().catch(e=>setMessage(String(e)))}>刷新 / Refresh</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(140px,1fr))',gap:10,margin:'16px 0'}}>
      {[["PENDING_QUALITY",locale==='zh-CN'?"待品质批准":locale==='vi-VN'?"Chờ duyệt chất lượng":"Pending Quality Approval"],["PENDING_LINE_LEADER",locale==='zh-CN'?"待线长批准":locale==='vi-VN'?"Chờ duyệt trưởng line":"Pending Line Leader"],["RETURN_PENDING",locale==='zh-CN'?"待来源工位收料":locale==='vi-VN'?"Chờ nhận từ trạm":"Pending Receipt"],["REVIVED",locale==='zh-CN'?"已复活":locale==='vi-VN'?"Đã hồi sinh":"Revived"]].map(([key,name])=><button key={key} onClick={()=>setStatus(key)} style={{padding:14,border:'1px solid #334155',borderRadius:8,background:status===key?'#075985':'#0f172a',color:'white',textAlign:'left'}}><b>{name}</b><div style={{fontSize:24,marginTop:5}}>{count(key)}</div></button>)}
    </div>
    <div style={{display:'flex',gap:8,marginBottom:12}}><button onClick={()=>setStatus('ALL')}>{locale==='zh-CN'?'全部':locale==='vi-VN'?'Tất cả':'All'}</button><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索 SN / 整盘 / 工位" style={{flex:1,padding:8}}/></div>
    {message&&<div style={{padding:9,marginBottom:10,background:'#172554',color:'#bfdbfe'}}>{message}</div>}
    <div style={{overflow:'auto',maxHeight:'62vh'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['SN','整盘','来源工位','返回工位','维修结果','状态','维修操作员','品质批准','线长批准','批准理由','操作'].map(h=><th key={h} style={{textAlign:'left',padding:8,borderBottom:'1px solid #475569'}}>{h}</th>)}</tr></thead>
      <tbody>{filtered.map(row=><tr key={row.revivalId}><td>{row.sn}</td><td>{row.batchId||'-'}</td><td>{row.originStation||'-'}</td><td>{row.returnStation||'-'}</td><td>{row.repairResult||'-'}</td><td><b>{row.approvalStatus}</b></td><td>{row.operator||'-'}</td><td>{row.qualityApprover||'-'}</td><td>{row.lineLeaderApprover||'-'}</td><td>{row.approvalReason||'-'}</td><td>{['PENDING_QUALITY','PENDING_LINE_LEADER'].includes(row.approvalStatus)?<button disabled={busy===row.revivalId} onClick={()=>approve(row)}>{row.approvalStatus==='PENDING_QUALITY'?'品质批准':'线长批准'}</button>:row.approvalStatus==='APPROVED'?'请维修站执行':'已完成'}</td></tr>)}</tbody>
    </table></div>
    <div style={{marginTop:12,color:'#fbbf24'}}>安全规则：普通 PASS、重测、转站和人工清箱均不能取消确认 NG；只有完成品质与线长批准后，由维修站执行复活。</div>
    <h3 style={{marginTop:24}}>维修返还交工单 / Repair Return Handovers</h3>
    <div style={{overflow:'auto',maxHeight:330}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>
      {['交工单','整盘/SN','送出工位','收料工位','板数','送出时间','2分钟监督','状态','扫码确认','报警'].map(h=><th key={h} style={{textAlign:'left',padding:7,borderBottom:'1px solid #475569'}}>{h}</th>)}
    </tr></thead><tbody>{returnOrders.map(row=>{const elapsed=(Date.now()-new Date(row.sentAt).getTime())/1000;const waiting=row.status==='WAITING_RECEIPT';const timeout=waiting&&elapsed>120;return <tr key={row.transferId} style={{background:timeout&&!row.alarmAcknowledgedAt?'#7f1d1d44':undefined}}>
      <td>{row.transferId}</td><td>{row.batchId}</td><td>{row.sourceStation}</td><td>{row.destinationStation}</td><td>{row.motherboard?.subBoards?.length||0}</td>
      <td>{new Date(row.sentAt).toLocaleString()}</td><td style={{color:timeout?'#f87171':waiting?'#fbbf24':'#86efac'}}>{waiting?(timeout?'已超时':`${Math.max(0,120-Math.floor(elapsed))} 秒`):'已完成'}</td>
      <td>{row.status}</td><td>{row.receivedAt?`${new Date(row.receivedAt).toLocaleString()} ${row.acceptedBy||''}`:'等待收料扫码'}</td>
      <td>{row.alarmedAt&&!row.alarmAcknowledgedAt?<button onClick={()=>acknowledgeAlarm(row)}>解除声光报警</button>:row.alarmAcknowledgedAt?'报警已解除':'-'}</td></tr>})}</tbody></table></div>
    <h3 style={{marginTop:24}}>全线拦截统计 / Line-wide Interceptions</h3>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>{interceptionSummary.map(row=><div key={`${row.interceptionType}-${row.status}`} style={{padding:'8px 12px',background:'#172033',border:'1px solid #475569',borderRadius:7}}><b>{row.interceptionType}</b> · {row.status}: {row.count}</div>)}</div>
    <div style={{overflow:'auto',maxHeight:280}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['时间','SN','整盘','拦截类型','来源工位','目标工位','扫码工位','状态'].map(h=><th key={h} style={{textAlign:'left',padding:7,borderBottom:'1px solid #475569'}}>{h}</th>)}</tr></thead><tbody>{interceptions.slice(0,200).map(row=><tr key={row.interceptionId}><td>{new Date(row.interceptedAt).toLocaleString()}</td><td>{row.sn}</td><td>{row.batchId||'-'}</td><td>{row.interceptionType}</td><td>{row.sourceStation||'-'}</td><td>{row.destinationStation||'-'}</td><td>{row.scannedStation}</td><td>{row.status}</td></tr>)}</tbody></table></div>
  </div>;
}
