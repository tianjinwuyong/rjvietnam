import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";

type MaterialBinding = {
  id:number; workOrderCode:string; lineCode:string; machineCode:string;
  channelCode:string; feederCode:string; materialCode:string; materialName?:string;
  materialSn:string; quantityPerRoll:number; rollCount:number; operator?:string;
  status:string; boundAt:string; feederChanged?:boolean; previousFeederCode?:string;
};

export function SmtMaterialBindingTable() {
  const [items,setItems]=useState<MaterialBinding[]>([]);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const [updatedAt,setUpdatedAt]=useState<Date>();
  const [realtimeConnected,setRealtimeConnected]=useState(false);
  const [liveScan,setLiveScan]=useState<{materialSn:string;step:string;result:string;scannedValue:string;expectedValue?:string;at:Date}>();
  const [pdaActivity,setPdaActivity]=useState<{activityType:string;workOrderCode:string;machineCode?:string;channelCode?:string;feederCode?:string;materialSn?:string;result:string;at:Date}>();

  const refresh=async()=>{
    try {
      const response=await apiClient.get<{items?:MaterialBinding[]} | MaterialBinding[]>("/mes/material-roll-bindings",{limit:500});
      setItems(Array.isArray(response)?response:response.items||[]);
      setUpdatedAt(new Date());
    } finally { setLoading(false); }
  };

  useEffect(()=>{const sync=()=>void refresh();sync();const timer=setInterval(sync,10000);window.addEventListener("focus",sync);document.addEventListener("visibilitychange",sync);const types="MATERIAL_BOUND,SMT_FEEDER_BOUND,SMT_REEL_CHANGED,SMT_LOADING_SCAN_VERIFIED,SMT_LOADING_PDA_ACTIVITY";const stream=new EventSource(`/api/pda/events?node=mes_smt_binding_table&replay=1&types=${types}`);stream.onopen=()=>setRealtimeConnected(true);stream.onerror=()=>setRealtimeConnected(false);stream.onmessage=(message)=>{try{const event=JSON.parse(message.data);const p=event.payload||{};if(event.type==="SMT_LOADING_SCAN_VERIFIED"){setLiveScan({materialSn:String(p.materialSn||""),step:String(p.scanStep||"SCAN"),result:String(p.result||"REJECT"),scannedValue:String(p.scannedValue||""),expectedValue:p.expectedValue?String(p.expectedValue):undefined,at:new Date()})}else if(event.type==="SMT_LOADING_PDA_ACTIVITY"){setPdaActivity({activityType:String(p.activityType||""),workOrderCode:String(p.workOrderCode||""),machineCode:p.machineCode?String(p.machineCode):undefined,channelCode:p.channelCode?String(p.channelCode):undefined,feederCode:p.feederCode?String(p.feederCode):undefined,materialSn:p.materialSn?String(p.materialSn):undefined,result:String(p.result||"PASS"),at:new Date()})}}catch{/* recovery polling remains active */}sync()};return()=>{clearInterval(timer);stream.close();window.removeEventListener("focus",sync);document.removeEventListener("visibilitychange",sync)}},[]);
  useEffect(()=>{if(!liveScan?.materialSn)return;window.requestAnimationFrame(()=>{const target=[...document.querySelectorAll<HTMLTableRowElement>(".smt-binding-table tbody tr")].find(row=>row.textContent?.toUpperCase().includes(liveScan.materialSn.toUpperCase()));if(!target)return;const rect=target.getBoundingClientRect();window.scrollBy({top:rect.top+rect.height/2-window.innerHeight/2,behavior:"smooth"})})},[liveScan]);
  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return items;
    return items.filter(item=>[item.workOrderCode,item.lineCode,item.machineCode,item.channelCode,item.feederCode,item.materialCode,item.materialName,item.materialSn,item.operator].some(v=>String(v||"").toLowerCase().includes(needle)));
  },[items,query]);

  return <div className="smt-binding-page">
    <header className="smt-binding-header"><div><p>MES · SMT MATERIAL TRACEABILITY <i className={realtimeConnected?"smt-live-dot":"smt-live-dot offline"}>{realtimeConnected?"LIVE · PDA CONNECTED":"RECONNECTING"}</i></p><h2>SMT 物料绑定表</h2><small>PDA 与 MES 实时事件通讯 · 10 秒查询仅用于断线恢复</small></div><div className="smt-binding-metrics"><span>当前有效绑定<strong>{items.length}</strong></span><span>实机<strong>{new Set(items.map(i=>i.machineCode)).size}</strong></span><span>最近同步<strong>{updatedAt?updatedAt.toLocaleTimeString():"—"}</strong></span></div></header>
    {liveScan&&<div className={`smt-current-scan ${liveScan.result==="PASS"?"pass":"reject"}`}><b>{liveScan.result==="PASS"?"✓ PDA 扫描正确":"✕ PDA 扫描错误"}</b><span>料卷 {liveScan.materialSn} · {liveScan.step} · 扫描 {liveScan.scannedValue}{liveScan.result!=="PASS"&&<> · 应为 {liveScan.expectedValue||"未绑定"}</>}</span><time>{liveScan.at.toLocaleTimeString()}</time></div>}
    {pdaActivity&&<div className={`smt-current-scan ${pdaActivity.result==="PASS"?"pass":"reject"}`}><b>{pdaActivity.activityType==="MACHINE_SELECTED"?"✓ PDA 已选择机位":pdaActivity.activityType==="CHANNEL_SELECTED"?"✓ PDA 已选择通道":pdaActivity.activityType==="FEEDER_SELECTED"?"✓ PDA 已选择 Feeder":"✓ PDA 已扫描料卷"}</b><span>工单 {pdaActivity.workOrderCode} · 机位 {pdaActivity.machineCode||"—"}{pdaActivity.channelCode&&<> · 通道 {pdaActivity.channelCode}</>}{pdaActivity.feederCode&&<> · Feeder {pdaActivity.feederCode}</>}{pdaActivity.materialSn&&<> · 料卷 {pdaActivity.materialSn}</>}</span><time>{pdaActivity.at.toLocaleTimeString()}</time></div>}
    <div className="smt-binding-toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索工单 / 机台 / L-R站位 / 飞达 / 物料 / 料卷SN"/><button onClick={()=>void refresh()}>立即刷新</button></div>
    <div className="table-wrap smt-binding-table"><table><thead><tr><th>#</th><th>工单</th><th>产线</th><th>实机</th><th>左右站位</th><th>飞达</th><th>物料编码</th><th>料卷 SN</th><th>单卷数量</th><th>卷数</th><th>操作员</th><th>绑定时间</th><th>状态</th></tr></thead><tbody>
      {filtered.map((item,index)=>{const scanning=liveScan?.materialSn.toUpperCase()===item.materialSn?.toUpperCase();return <tr key={item.id} className={[item.feederChanged?"feeder-changed":"",index<10?"recent-binding":"",scanning?(liveScan?.result==="PASS"?"pda-scan-pass":"pda-scan-reject"):""].filter(Boolean).join(" ")}><td>{index+1}</td><td><b>{item.workOrderCode}</b></td><td>{item.lineCode||"—"}</td><td><span className="machine-pill">{item.machineCode}</span></td><td><span className={item.channelCode?.startsWith("R")?"side-pill right":"side-pill left"}>{item.channelCode||"—"}</span></td><td><b className={item.feederChanged?"changed-feeder-code":""}>{item.feederCode||"—"}</b>{item.feederChanged&&<small>原飞达：{item.previousFeederCode||"—"}</small>}</td><td><b>{item.materialCode||"—"}</b>{item.materialName&&<small>{item.materialName}</small>}</td><td className="mono">{item.materialSn}</td><td>{Number(item.quantityPerRoll||0).toLocaleString()}</td><td>{item.rollCount||1}</td><td>{item.operator||"—"}</td><td>{item.boundAt?new Date(item.boundAt).toLocaleString():"—"}</td><td>{item.feederChanged?<span className="changed-pill">✓ 已更换飞达</span>:<span className="active-pill">{item.status}</span>}</td></tr>})}
      {!loading&&filtered.length===0&&<tr><td colSpan={13}>暂无有效绑定记录。PDA 完成绑定后会自动出现在这里。</td></tr>}
      {loading&&<tr><td colSpan={13}>正在读取物料绑定表…</td></tr>}
    </tbody></table></div>
  </div>;
}
