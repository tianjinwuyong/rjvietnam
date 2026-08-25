import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";

type Station={code:string;zh:string;en:string;vi:string;x:number;kind:string;duties:string[]};
type EventRow={type:string;stationCode:string;sn:string;result:string;time:number};
const STATIONS:Station[]=[
 {code:"smt_pda_loading",zh:"PD扫码上料",en:"PDA Loading",vi:"Quét cấp liệu",x:-9,kind:"pda",duties:["物料识别","工单绑定","操作员追溯"]},
 {code:"smt_laser_marking",zh:"镭雕机",en:"Laser Marking",vi:"Khắc laser",x:-6,kind:"laser",duties:["单元初始化","二维码个性化","雕刻结果"]},
 {code:"smt_auto_insertion",zh:"AI插件机",en:"AI Insertion",vi:"Cắm linh kiện AI",x:-3,kind:"insertion",duties:["物料追溯","工具追溯","插件结果"]},
 {code:"smt_printer",zh:"印刷机",en:"Paste Printer",vi:"Máy in kem hàn",x:0,kind:"printer",duties:["印刷结果","钢网追溯","锡膏追溯"]},
 {code:"smt_spi",zh:"SPI锡膏检测",en:"SPI",vi:"Kiểm tra SPI",x:3,kind:"inspection",duties:["锡膏检测","测量值","缺陷追溯"]},
 {code:"smt_placement",zh:"贴片机",en:"Pick & Place",vi:"Máy gắn linh kiện",x:6,kind:"placement",duties:["精确物料","飞达与工具","贴装与取料失败"]},
 {code:"smt_aoi",zh:"SMT-AOI",en:"SMT AOI",vi:"Kiểm tra AOI",x:9,kind:"inspection",duties:["光学检测","元件偏移","缺陷追溯"]},
];

function Machine({s,online,last,selected}:{s:Station;online:boolean;last?:EventRow;selected:boolean}){
 const bad=["NG","FAIL","ERROR","CRITICAL"].includes(String(last?.result||"").toUpperCase());
 const accent=bad?"#ef4444":online?"#22c55e":"#64748b", width=s.kind==="placement"?2.7:s.kind==="insertion"?2.35:2.05;
 return <group position={[s.x,0,0]}>
  <RoundedBox args={[width,1.85,1.7]} radius={.12} position={[0,1.02,0]} castShadow>
   <meshStandardMaterial color={bad?"#991b1b":online?"#155e75":"#334155"} metalness={.42} roughness={.38}/>
  </RoundedBox>
  <mesh position={[0,1.2,.87]}><boxGeometry args={[width*.65,.62,.06]}/><meshStandardMaterial color="#071b27" emissive={accent} emissiveIntensity={selected?.7:.18}/></mesh>
  {s.kind==="laser"&&<mesh position={[0,.75,.91]}><cylinderGeometry args={[.025,.025,.7,10]}/><meshStandardMaterial color="#ff3344" emissive="#ff0011"/></mesh>}
  {["placement","insertion"].includes(s.kind)&&[-.72,-.36,0,.36,.72].map(o=><mesh key={o} position={[o,.65,.92]}><boxGeometry args={[.12,.55,.1]}/><meshStandardMaterial color="#7dd3fc"/></mesh>)}
  {s.kind==="inspection"&&<mesh position={[0,1.2,.94]}><torusGeometry args={[.23,.045,12,28]}/><meshStandardMaterial color="#a5f3fc" emissive="#0891b2"/></mesh>}
  {s.kind==="printer"&&<mesh position={[0,.42,.92]}><boxGeometry args={[1.3,.16,.12]}/><meshStandardMaterial color="#f59e0b"/></mesh>}
  {s.kind==="pda"&&<mesh position={[0,1.34,.94]} rotation={[0,0,-.18]}><boxGeometry args={[.48,.76,.09]}/><meshStandardMaterial color="#111827" emissive="#06b6d4"/></mesh>}
  <mesh position={[0,.1,0]}><boxGeometry args={[width+.45,.12,1.05]}/><meshStandardMaterial color="#64748b"/></mesh>
  <Text position={[0,2.25,0]} fontSize={.27} color={selected?"#fef08a":"#e2e8f0"}>{s.zh}</Text>
  <Text position={[0,1.94,0]} fontSize={.14} color="#94a3b8">{s.en}</Text>
  <mesh position={[width/2-.16,1.75,.72]}><sphereGeometry args={[.09,14,14]}/><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={online||bad?1.8:0}/></mesh>
 </group>
}

export function SmtStationAgents3d(){
 const requested=typeof window==="undefined"?"":new URLSearchParams(window.location.search).get("station");
 const [selected,setSelected]=useState(STATIONS.some(s=>s.code===requested)?String(requested):STATIONS[0].code);
 const [beats,setBeats]=useState<Record<string,number>>({}),[events,setEvents]=useState<EventRow[]>([]);
 const [open,setOpen]=useState(true),[locale,setLocale]=useState<"zh"|"en"|"vi">("zh");
 useEffect(()=>{const load=()=>fetch("/api/pda/heartbeats",{cache:"no-store"}).then(r=>r.json()).then(d=>{const n:Record<string,number>={};(d.heartbeats||d.items||[]).forEach((b:any)=>{const c=String(b.stationCode||"");if(c.startsWith("smt_")&&b.online!==false)n[c]=Number(b.receivedAt||b.lastSeen||Date.now())});setBeats(n)}).catch(()=>{});load();const id=setInterval(load,5000);return()=>clearInterval(id)},[]);
 useEffect(()=>{const types="AGENT_HEARTBEAT,SCAN_GUARD_CHECK,SN_SCAN,NG_DEFECT,SMT_STATION_ACTIVITY,STATION_FAULT_OCCURRED,STATION_FAULT_ACKNOWLEDGED,STATION_FAULT_CLEARED,DUPLICATE_SN,STATION_ROUTE_SELECTED,ROUTE_REQUEST_ACCEPTED,TRANSFER_RECEIVED,REPAIR_WORK_ORDER_CREATED,REPAIR_RECEIVED,REPAIR_COMPLETED,REPAIR_RETURN_SENT,NG_REVIVED";const es=new EventSource(`/api/pda/events?node=smt_agents_3d&replay=1&types=${types}`);es.onmessage=e=>{try{const x=JSON.parse(e.data),p=x.payload||x,c=String(x.stationCode||p.stationCode||"");if(!c.startsWith("smt_")&&!String(p.sourceStation||p.originStation||"").startsWith("smt_"))return;if(x.type==="AGENT_HEARTBEAT")setBeats(v=>({...v,[c]:Date.now()}));else setEvents(v=>[{type:String(x.type||"EVENT"),stationCode:c||String(p.sourceStation||p.originStation||""),sn:String(p.sn||p.mainSn||p.ngSn||"—"),result:String(p.result||p.decision||p.activityType||p.severity||p.status||""),time:Date.now()},...v].slice(0,150))}catch{}};return()=>es.close()},[]);
 const online=useMemo(()=>new Set(Object.entries(beats).filter(([,t])=>Date.now()-t<45000).map(([c])=>c)),[beats]);
 const latest=useMemo(()=>Object.fromEntries(STATIONS.map(s=>[s.code,events.find(e=>e.stationCode===s.code)])),[events]);
 const current=STATIONS.find(s=>s.code===selected)||STATIONS[0], rows=events.filter(e=>e.stationCode===selected).slice(0,30);
 const label=(s:Station)=>locale==="zh"?s.zh:locale==="vi"?s.vi:s.en;
 return <div style={{height:"100vh",background:"#020617",color:"#e2e8f0",position:"relative",overflow:"hidden"}}>
  <Canvas shadows camera={{position:[0,10.5,18],fov:49}}><ambientLight intensity={.75}/><directionalLight position={[4,12,8]} intensity={2.3} castShadow/>
   <mesh rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[29,11]}/><meshStandardMaterial color="#0f172a"/></mesh><gridHelper args={[28,28,"#164e63","#1e293b"]}/>
   {STATIONS.slice(0,-1).map((s,i)=><mesh key={s.code} position={[(s.x+STATIONS[i+1].x)/2,.2,0]}><boxGeometry args={[2.7,.09,.55]}/><meshStandardMaterial color="#475569" metalness={.5}/></mesh>)}
   {STATIONS.map(s=><Machine key={s.code} s={s} online={online.has(s.code)} last={latest[s.code]} selected={selected===s.code}/>)}
   <OrbitControls makeDefault minDistance={8} maxDistance={34} maxPolarAngle={Math.PI/2.05}/><Environment preset="warehouse"/>
  </Canvas>
  <header style={{position:"absolute",top:14,left:18,right:18,display:"flex",justifyContent:"space-between",pointerEvents:"none"}}><div><h1 style={{margin:0,fontSize:24}}>SMT L001 · 3D STATION AGENTS</h1><div style={{color:"#67e8f9"}}>Station → MES → 3D · read-only monitoring</div></div><div style={{pointerEvents:"auto",display:"flex",gap:6}}>{(["zh","en","vi"] as const).map(l=><button key={l} onClick={()=>setLocale(l)} style={{background:locale===l?"#0e7490":"#0f172acc",color:"white",border:"1px solid #155e75",padding:"7px 10px"}}>{l.toUpperCase()}</button>)}<div style={{background:"#0f172add",padding:10,border:"1px solid #155e75"}}>ONLINE {online.size}/7</div></div></header>
  <nav style={{position:"absolute",left:16,bottom:16,right:open?390:16,display:"flex",gap:6,flexWrap:"wrap"}}>{STATIONS.map(s=><button key={s.code} onClick={()=>setSelected(s.code)} style={{background:selected===s.code?"#0e7490":"#0f172add",color:"white",border:`1px solid ${online.has(s.code)?"#22c55e":"#475569"}`,padding:"8px 10px"}}>{label(s)}</button>)}</nav>
  <button onClick={()=>setOpen(v=>!v)} style={{position:"absolute",right:open?374:16,top:83,zIndex:2,padding:"7px 10px"}}>{open?"关闭详情":"打开详情"}</button>
  {open&&<aside style={{position:"absolute",right:12,top:74,bottom:12,width:345,background:"#07111ff2",border:"1px solid #164e63",padding:14,overflow:"auto"}}><h2 style={{margin:"0 0 5px"}}>{label(current)}</h2><div style={{color:online.has(current.code)?"#4ade80":"#f59e0b",marginBottom:10}}>{online.has(current.code)?"ONLINE":"OFFLINE / WAITING"}</div><small style={{color:"#94a3b8"}}>RESPONSIBILITIES</small><ul>{current.duties.map(x=><li key={x}>{x}</li>)}</ul><small style={{color:"#94a3b8"}}>LIVE EVENTS</small>{rows.length?rows.map((e,i)=><div key={`${e.time}-${i}`} style={{padding:"8px 0",borderBottom:"1px solid #1e293b",fontSize:12}}><b style={{color:["NG","FAIL","ERROR","CRITICAL"].includes(e.result.toUpperCase())?"#f87171":"#22d3ee"}}>{e.type}</b><div>{e.sn} · {e.result}</div></div>):<div style={{color:"#64748b",marginTop:8}}>Waiting for station Agent data…</div>}</aside>}
 </div>
}
