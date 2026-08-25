import { useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const COPY={
  "zh-CN":{ready:"扫码器就绪",scanning:"正在扫描",scan:"扫码",placeholder:"扫描产品序列号",accepted:"已接收",received:"交接已收货",blocked:"已拦截"},
  "en-US":{ready:"Scanner ready",scanning:"Scanning",scan:"SCAN",placeholder:"SCAN PRODUCT SN",accepted:"accepted",received:"transfer received",blocked:"BLOCKED"},
  "vi-VN":{ready:"Máy quét sẵn sàng",scanning:"Đang quét",scan:"QUÉT",placeholder:"QUÉT SỐ SN SẢN PHẨM",accepted:"đã nhận",received:"đã nhận bàn giao",blocked:"ĐÃ CHẶN"},
} as const;

const STATIONS=[
  ["manu_pda","PDA Load"],["manu_aoi","AOI"],["manu_ict","ICT"],["manu_fct","FCT"],
  ["manu_depanel","Depanel"],["manu_shellbinding","Shell Binding"],["manu_assem_ate","Assembly ATE"],
  ["manu_supersonic","Ultrasonic"],["manu_agingcab","Aging"],["manu_hivolt_ate","High-voltage ATE"],
  ["manu_package_ate","Packaging ATE"],["manu_outer_box_binding","Outer-box Binding"],
  ["manu_pallet_binding","Pallet Binding"],["manu_rework","Maintenance / Rework"],
] as const;

export function StationScannerControl({stationCode,compact=false,locale="en-US"}:{stationCode?:string;compact?:boolean;locale?:Locale}){
  const words=COPY[locale]||COPY["en-US"];
  const[selectedStation,setSelectedStation]=useState(stationCode||STATIONS[0][0]);
  const[sn,setSn]=useState(""),[status,setStatus]=useState<string>(words.ready);
  const inputRef=useRef<HTMLInputElement>(null);
  const target=stationCode||selectedStation;
  async function submit(){const value=sn.trim().toUpperCase();if(!value){inputRef.current?.focus();return;}setStatus(`${words.scanning} ${value}…`);try{
    const token=localStorage.getItem("token");const response=await fetch("/api/pda/events",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({from:target,to:"mes_server",type:"SCAN_GUARD_CHECK",stationCode:target,payload:{sn:value,pcbSerial:value,result:"CLEAR",scannedAt:Date.now(),operator:"STATION_SCANNER"}})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||body.error?.message||body.code||`HTTP ${response.status}`);setSn("");
    setStatus(body.autoReceipt?`${value} · ${words.received}`:`${value} · ${words.accepted}`);
  }catch(reason){setStatus(`${value} · ${words.blocked} · ${reason instanceof Error?reason.message:"scan failed"}`)}inputRef.current?.focus()}
  return <div style={{display:"grid",gridTemplateColumns:stationCode?"minmax(220px,1fr) 72px":"170px minmax(220px,1fr) 72px",gap:6,padding:compact?6:9,border:"2px solid #22d3ee",borderRadius:10,background:"#062033ee",boxShadow:"0 0 24px #22d3ee33",color:"#a5f3fc"}}>
    {!stationCode&&<select value={selectedStation} onChange={event=>setSelectedStation(event.target.value)} style={{background:"#020617",color:"#e2e8f0",border:"1px solid #475569",borderRadius:6,padding:"0 8px"}}>{STATIONS.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select>}
    <input ref={inputRef} value={sn} onChange={event=>setSn(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void submit()}} placeholder={words.placeholder} autoFocus style={{height:34,boxSizing:"border-box",background:"#020617",color:"#e0f2fe",border:"1px solid #475569",borderRadius:6,padding:"0 10px",font:"800 13px ui-monospace,monospace",textTransform:"uppercase"}}/>
    <button type="button" onClick={()=>void submit()} style={{border:"1px solid #67e8f9",borderRadius:6,background:"#0e7490",color:"white",fontWeight:900,cursor:"pointer"}}>{words.scan}</button>
    <div style={{gridColumn:"1/-1",fontSize:9,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{target} · {status}</div>
  </div>;
}
