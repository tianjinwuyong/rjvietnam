import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Manager = { code:string; name:string; status:"working"|"attention"; metrics:Record<string,number>; lastActivity?:string; reportedAt:number };
type Instruction = { instructionId:number; managerCode:string; command:string; instructedBy:string; note?:string; status:string; createdAt:string; completedAt?:string };
type BalanceRow = { stationCode:string; sequenceOrder:number; totalIn:number; totalOut:number; currentWip:number; approvedOrExceptional:number; discrepancy:number; missingNextReceipt:number };

export function MesManagerConsole({ locale }: { locale: Locale }) {
  const [managers,setManagers]=useState<Manager[]>([]),[instructions,setInstructions]=useState<Instruction[]>([]);
  const [target,setTarget]=useState("ROUTE_MANAGER"),[command,setCommand]=useState("REPORT_NOW");
  const [operator,setOperator]=useState(""),[note,setNote]=useState(""),[message,setMessage]=useState("");
  const [balance,setBalance]=useState<BalanceRow[]>([]),[balanced,setBalanced]=useState(false),[openAlerts,setOpenAlerts]=useState<any[]>([]);
  const [identity,setIdentity]=useState(""),[lineage,setLineage]=useState<any>(null),[lineageMessage,setLineageMessage]=useState("");
  const refresh=async()=>{
    const [statusResponse,instructionResponse,balanceResponse]=await Promise.all([
      fetch("/api/mes/managers/status"),fetch("/api/mes/managers/instructions"),fetch("/api/mes/overall-balance")]);
    if(statusResponse.ok)setManagers((await statusResponse.json()).managers||[]);
    if(instructionResponse.ok)setInstructions((await instructionResponse.json()).items||[]);
    if(balanceResponse.ok){const data=await balanceResponse.json();setBalance(data.stations||[]);setBalanced(Boolean(data.balanced));setOpenAlerts(data.openAlerts||[])}
  };
  useEffect(()=>{refresh().catch(()=>{});const timer=window.setInterval(()=>refresh().catch(()=>{}),5000);return()=>window.clearInterval(timer)},[]);
  const send=async()=>{
    if(!operator.trim()){setMessage("Enter your name / 请输入姓名 / Nhập tên");return;}
    const response=await fetch("/api/mes/managers/instructions",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({managerCode:target,command,instructedBy:operator.trim(),note:note.trim()})});
    const data=await response.json();
    if(!response.ok){setMessage(data?.error?.message||`HTTP ${response.status}`);return;}
    setMessage(`Instruction accepted #${data.instructionId}`);setNote("");await refresh();
  };
  const searchLineage=async()=>{const value=identity.trim().toUpperCase();if(!value)return;setLineageMessage("Searching MES lineage…");const response=await fetch(`/api/mes/lineage/${encodeURIComponent(value)}`);const data=await response.json().catch(()=>({}));if(!response.ok){setLineage(null);setLineageMessage(data?.error?.message||`HTTP ${response.status}`);return}setLineage(data);setLineageMessage(data.provenanceComplete?"Complete provenance":"PROVENANCE GAP — integrity review required")};
  const title=locale==="zh-CN"?"MES 管理器监控中心":locale==="vi-VN"?"Trung tâm giám sát quản lý MES":"MES Manager Control Center";
  return <div className="screen-stack" style={{padding:16,color:"#e2e8f0",background:"#07111f",minHeight:"calc(100vh - 160px)"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><h2 style={{margin:0,color:"#7dd3fc"}}>{title}</h2>
      <p style={{color:"#94a3b8"}}>Live supervision, audited instructions, and strict route protection. No command can bypass sequence or release NG.</p></div>
      <div style={{color:managers.length?"#4ade80":"#f87171",fontWeight:800}}>{managers.length} / 6 REPORTING ●</div></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(240px,1fr))",gap:12}}>{managers.map(manager=><div key={manager.code}
      style={{background:"#0f243b",border:`2px solid ${manager.status==="attention"?"#ef4444":"#22c55e"}`,borderRadius:10,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",fontWeight:900}}><span>{manager.name}</span><span style={{color:manager.status==="attention"?"#f87171":"#4ade80"}}>● {manager.status.toUpperCase()}</span></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginTop:12}}>{Object.entries(manager.metrics||{}).map(([key,value])=><div key={key} style={{background:"#071827",padding:8,borderRadius:6}}><div style={{fontSize:10,color:"#94a3b8"}}>{key}</div><b style={{fontSize:20}}>{value}</b></div>)}</div>
      <div style={{fontSize:11,color:"#64748b",marginTop:9}}>Last activity: {manager.lastActivity?new Date(manager.lastActivity).toLocaleString():"waiting"}</div></div>)}</div>
    <section style={{marginTop:16,background:"#0f243b",border:`2px solid ${balanced?"#22c55e":"#ef4444"}`,borderRadius:10,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h3 style={{margin:0}}>Whole-line IN / OUT balance</h3><b style={{color:balanced?"#4ade80":"#f87171"}}>{balanced?"BALANCED · NO DISCREPANCY":`UNBALANCED · ${openAlerts.length} OPEN ALERT(S)`}</b></div>
      <div style={{overflow:"auto",marginTop:10}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr>{["Seq","Station","IN","OUT","WIP","Approved hold/loss","Discrepancy","Missing receipt"].map(x=><th key={x} style={{textAlign:"left",padding:7,borderBottom:"1px solid #475569"}}>{x}</th>)}</tr></thead><tbody>{balance.map(row=><tr key={row.stationCode} style={{color:Number(row.discrepancy)||Number(row.missingNextReceipt)?"#f87171":"#d1fae5"}}>{[row.sequenceOrder,row.stationCode,row.totalIn,row.totalOut,row.currentWip,row.approvedOrExceptional,row.discrepancy,row.missingNextReceipt].map((value,index)=><td key={index} style={{padding:7,borderBottom:"1px solid #1e293b",fontFamily:"monospace"}}>{value}</td>)}</tr>)}</tbody></table></div>
    </section>
    <section style={{marginTop:16,background:"#0f243b",border:"1px solid #38bdf8",borderRadius:10,padding:14}}><h3 style={{marginTop:0}}>Where did it come from? Where does it go?</h3><div style={{display:"flex",gap:8}}><input style={{flex:1}} value={identity} onChange={e=>setIdentity(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter')void searchLineage()}} placeholder="Scan/search product SN, shell, case, pallet or batch"/><button className="action-button" onClick={()=>void searchLineage()}>TRACE</button></div>{lineageMessage&&<div style={{marginTop:8,color:lineage?.provenanceComplete?"#4ade80":"#fbbf24"}}>{lineageMessage}</div>}{lineage&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:10}}>{[["Root SN",lineage.rootSn],["Origin",lineage.origin?.stationCode||"UNKNOWN"],["Current",lineage.currentLocation?.stationCode||"BETWEEN STATIONS / COMPLETE"],["Next",lineage.nextExpectedStation?.stationCode||"FINAL / UNKNOWN"],["Route events",lineage.route?.length||0],["Handovers",lineage.handovers?.length||0],["Containers",lineage.containers?.map((x:any)=>x.containerId).join(', ')||"—"],["Pallets",lineage.pallets?.map((x:any)=>x.palletCode).join(', ')||"—"]].map(([label,value])=><div key={String(label)} style={{background:"#071827",padding:9,borderRadius:7}}><small style={{color:"#94a3b8"}}>{label}</small><b style={{display:"block",wordBreak:"break-all"}}>{value}</b></div>)}</div>}</section>
    <div style={{marginTop:16,background:"#0f243b",border:"1px solid #38bdf8",borderRadius:10,padding:14}}><h3 style={{marginTop:0}}>Give an audited instruction / 下达审计指令</h3>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><select value={target} onChange={event=>setTarget(event.target.value)}>{managers.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select>
      <select value={command} onChange={event=>setCommand(event.target.value)}><option value="REPORT_NOW">Report now</option><option value="RUN_AUDIT">Run audit</option><option value="RECONCILE">Reconcile</option></select>
      <input value={operator} onChange={event=>setOperator(event.target.value)} placeholder="Your name / 姓名"/><input style={{flex:1,minWidth:260}} value={note} onChange={event=>setNote(event.target.value)} placeholder="Instruction and reason"/>
      <button className="action-button" onClick={send}>SEND INSTRUCTION</button></div>{message&&<div style={{marginTop:8,color:"#fbbf24"}}>{message}</div>}</div>
    <div style={{marginTop:16,background:"#0f243b",borderRadius:10,padding:14,overflow:"auto"}}><h3 style={{marginTop:0}}>Instruction audit history</h3><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["ID","Manager","Command","By","Note","Status","Time"].map(x=><th key={x} style={{textAlign:"left",padding:7,borderBottom:"1px solid #334155"}}>{x}</th>)}</tr></thead>
      <tbody>{instructions.map(row=><tr key={row.instructionId}>{[row.instructionId,row.managerCode,row.command,row.instructedBy,row.note||"-",row.status,new Date(row.createdAt).toLocaleString()].map((value,index)=><td key={index} style={{padding:7,borderBottom:"1px solid #1e293b"}}>{value}</td>)}</tr>)}</tbody></table></div>
  </div>;
}
