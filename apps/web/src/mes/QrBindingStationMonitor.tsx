import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Environment, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Row = Record<string, unknown>;
const API = "/api";
const patternMatches = (pattern: string, value: string) => {
  try { return new RegExp(pattern).test(value); } catch { return false; }
};

const words = {
  "zh-CN": { title:"PCBA 外壳绑码 3D 工位",sub:"2D/3D 共用 MES 生产引擎",board:"板码",shell:"外壳码",waiting:"等待扫码",bindings:"绑定记录",online:"在线",offline:"离线",guard:"MES 重码 / NG 拦截",source:"扫码枪 · 本地 SQLite · MES",scanBoard:"模拟 PCBA 扫码",scanShell:"模拟外壳扫码",success:"绑码成功",failed:"模拟失败",allResults:"查看全部测试结果",close:"关闭",operator:"操作员",time:"时间",result:"结果" },
  "en-US": { title:"PCBA Shell Binding 3D Station",sub:"2D/3D share the MES production engine",board:"Board SN",shell:"Shell SN",waiting:"Waiting for scan",bindings:"Bindings",online:"ONLINE",offline:"OFFLINE",guard:"MES duplicate / NG guard",source:"Scanner · local SQLite · MES",scanBoard:"Simulate PCBA Scan",scanShell:"Simulate Shell Scan",success:"Binding successful",failed:"Simulation failed",allResults:"View All Test Results",close:"Close",operator:"Operator",time:"Time",result:"Result" },
  "vi-VN": { title:"Trạm 3D ghép mã bo-vỏ",sub:"2D/3D dùng chung MES",board:"Mã bo",shell:"Mã vỏ",waiting:"Chờ quét",bindings:"Bản ghi ghép",online:"TRỰC TUYẾN",offline:"NGOẠI TUYẾN",guard:"MES chặn trùng / NG",source:"Máy quét · SQLite · MES",scanBoard:"Mô phỏng quét PCBA",scanShell:"Mô phỏng quét vỏ",success:"Ghép mã thành công",failed:"Mô phỏng thất bại",allResults:"Xem tất cả kết quả",close:"Đóng",operator:"Người thao tác",time:"Thời gian",result:"Kết quả" },
} as const;

function Fixture({board,shell}:{board:string;shell:string}) {
  const group = useRef<Group>(null);
  useFrame(({clock}) => { if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime*.45)*.05; });
  return <group ref={group} rotation={[-.12,0,0]}>
    <RoundedBox args={[8,.35,4.5]} radius={.2} position={[0,-.25,0]}><meshStandardMaterial color="#14253b" metalness={.5}/></RoundedBox>
    <RoundedBox args={[3.25,.5,3.25]} radius={.22} position={[-2,.15,0]}><meshStandardMaterial color={board?"#1677a3":"#26384d"} emissive={board?"#063b52":"#000"} emissiveIntensity={board?.12:0} roughness={.72}/></RoundedBox>
    <RoundedBox args={[3.25,.65,3.25]} radius={.45} position={[2,.22,0]}><meshStandardMaterial color={shell?"#2f855a":"#3a2c4d"} emissive={shell?"#0f4229":"#000"} emissiveIntensity={shell?.1:0} roughness={.78}/></RoundedBox>
    <Billboard position={[-2,1.15,0]}><Text fontSize={.34} color="#ffffff" outlineWidth={.035} outlineColor="#075985" anchorX="center">{board||"BOARD SN"}</Text></Billboard>
    <Billboard position={[2,1.25,0]}><Text fontSize={.34} color="#ffffff" outlineWidth={.035} outlineColor="#166534" anchorX="center">{shell||"SHELL SN"}</Text></Billboard>
    <Text position={[0,.15,1.95]} rotation={[-Math.PI/2,0,0]} fontSize={.24} color="#67e8f9">SCAN → VALIDATE → BIND</Text>
  </group>;
}

export function QrBindingStationMonitor({locale,viewMode="3d"}:{locale:Locale;viewMode?:"2d"|"3d"}) {
  const w=words[locale];
  const [online,setOnline]=useState(false),[rows,setRows]=useState<Row[]>([]);
  const [board,setBoard]=useState(""),[shell,setShell]=useState(""),[result,setResult]=useState("");
  const [stationBoard,setStationBoard]=useState(""),[stationShell,setStationShell]=useState("");
  const [boardInput,setBoardInput]=useState(""),[shellInput,setShellInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [showAll,setShowAll]=useState(false);
  const [showRules,setShowRules]=useState(false);
  const [showRetest,setShowRetest]=useState(false);
  const [retestSn,setRetestSn]=useState("");
  const [retestStatus,setRetestStatus]=useState<Row|null>(null);
  const [retestMessage,setRetestMessage]=useState("");
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [logs,setLogs]=useState<string[]>([]);
  const [pcbaPattern,setPcbaPattern]=useState(()=>localStorage.getItem("qrbinding_pcba_pattern")||"^5G\\d{7}[A-Z]$");
  const [shellPattern,setShellPattern]=useState(()=>localStorage.getItem("qrbinding_shell_pattern")||"^NV18A[A-Z0-9]{9}$");
  const boardCounter=useRef(Date.now()%10_000_000);
  const shellCounter=useRef(Date.now()%1_000_000_000);
  async function refresh(){
    try{
      const [heartbeat,snapshot,bindingData]=await Promise.all([fetch(`${API}/pda/heartbeats`).then(r=>r.json()),fetch(`${API}/station/bucket-snapshots`).then(r=>r.json()),fetch(`${API}/station/shell-bindings?limit=500`).then(r=>r.json())]);
      const beats=Array.isArray(heartbeat?.heartbeats)?heartbeat.heartbeats:[];
      setOnline(beats.some((x:Row)=>x.stationCode==="manu_shellbinding"&&x.online!==false));
      const all=Array.isArray(snapshot?.items)?snapshot.items:Array.isArray(snapshot?.snapshots)?snapshot.snapshots:Array.isArray(snapshot)?snapshot:[];
      const liveSnapshot=all.find((x:Row)=>x.stationCode==="manu_shellbinding"&&x.bucketName==="live_scan");
      const live=Array.isArray(liveSnapshot?.payload)?liveSnapshot.payload[0]:null;
      if(live&&typeof live==="object"){
        setBoard(String((live as Row).boardSn||""));
        setShell(String((live as Row).shellSn||""));
        setBoardInput(String((live as Row).boardSn||""));
        setShellInput(String((live as Row).shellSn||""));
      }
      const own=all.filter((x:Row)=>x.stationCode==="manu_shellbinding").sort((a:Row,b:Row)=>String(b.bucketName??"").localeCompare(String(a.bucketName??"")));
      const flat=own.flatMap((x:Row)=>Array.isArray(x.payload)?x.payload:[]).filter((x:unknown):x is Row=>!!x&&typeof x==="object");
      const saved=Array.isArray(bindingData?.items)?bindingData.items:[];
      const latest=saved[0];
      if(latest){setStationBoard(String(latest.pcbaSn||latest.sn||""));setStationShell(String(latest.shellSn||""));}
      setRows([...saved,...flat.filter((item:Row)=>!saved.some((savedItem:Row)=>savedItem.pcbaSn===item.pcbaSn&&savedItem.shellSn===item.shellSn))]);
    }catch{setOnline(false);}
  }
  useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),2000);return()=>window.clearInterval(id);},[]);
  async function guard(sn:string,bindingPhase:"board"|"shell"){
    const response=await fetch(`${API}/pda/events`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from:"qrbinding_agent",to:"mes_server",type:"SCAN_GUARD_CHECK",stationCode:"manu_shellbinding",priority:"info",payload:{sn,bindingPhase,result:"CLEAR",operator:"REMOTE_TEST_OPERATOR"}})});
    const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.code||body.error?.message||`HTTP ${response.status}`);
  }
  const addLog=(message:string)=>setLogs(current=>[`${new Date().toLocaleTimeString()} ${message}`,...current].slice(0,100));
  async function simulateBoard(){boardCounter.current=(boardCounter.current+1)%10_000_000;const scanned=`5G${String(boardCounter.current).padStart(7,"0")}A`;setBoardInput(scanned);setBusy(true);setResult("");try{await guard(scanned,"board");setBoard(scanned);setShell("");setShellInput("");addLog(`PCBA SCAN ${scanned}`);}catch(error){const message=error instanceof Error?error.message:String(error);setResult(`${w.failed}: ${message}`);addLog(`BLOCK ${scanned} ${message}`);}finally{setBusy(false);}}
  async function simulateShell(){
    if(!board){setResult(locale==="zh-CN"?"请先模拟 PCBA 扫码":"Simulate PCBA scan first");return;}shellCounter.current=(shellCounter.current+1)%1_000_000_000;const shellSn=`NV18A${String(shellCounter.current).padStart(9,"0")}`;setShellInput(shellSn);setBusy(true);setResult("");
    try{await guard(shellSn,"shell");setShell(shellSn);const response=await fetch(`${API}/station/shell-bindings/commit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pcbaSn:board,shellSn,stationCode:"manu_shellbinding",operator:"REMOTE_192.168.6.94_TEST"})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.code||body.error?.message||`HTTP ${response.status}`);setResult(w.success);addLog(`BIND PASS ${board} → ${shellSn}`);const audio=new Audio("/audio/binding-success.wav");audio.play().catch(()=>{if(window.speechSynthesis){const voice=new SpeechSynthesisUtterance("绑码成功");voice.lang="zh-CN";voice.rate=.9;voice.volume=1;window.speechSynthesis.cancel();window.speechSynthesis.speak(voice);}});await refresh();}
    catch(error){const message=error instanceof Error?error.message:String(error);setResult(`${w.failed}: ${message}`);addLog(`BIND BLOCK ${board} → ${shellSn} ${message}`);}finally{setBusy(false);}
  }
  function reset(){setBoard("");setShell("");setBoardInput("");setShellInput("");setResult("");addLog("RESET");}
  function exportCsv(){const lines=["PCBA SN,Shell SN,Operator,Time,Result",...rows.map(r=>[r.pcbaSn??r.sn??"",r.shellSn??"",r.operator??"",r.boundAt??"",r.result??"PASS"].map(v=>`"${String(v).replaceAll('"','""')}"`).join(","))];const url=URL.createObjectURL(new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`qr-binding-${Date.now()}.csv`;link.click();URL.revokeObjectURL(url);addLog("EXPORT CSV");}
  async function deleteSelected(){for(const key of selected){const [pcbaSn,shellSn]=key.split("\u0000");await fetch(`${API}/station/shell-bindings`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({pcbaSn,shellSn})});}setSelected(new Set());addLog("DELETE SELECTED");await refresh();}
  async function clearTestRecords(){await fetch(`${API}/station/shell-bindings/all?operatorPrefix=REMOTE_192.168.6.94_TEST`,{method:"DELETE"});setSelected(new Set());addLog("CLEAR TEST RECORDS");await refresh();}
  function saveRules(){localStorage.setItem("qrbinding_pcba_pattern",pcbaPattern);localStorage.setItem("qrbinding_shell_pattern",shellPattern);setShowRules(false);addLog("STATION RULES SAVED");}
  async function queryRetest(){const sn=retestSn.trim().toUpperCase();if(!sn){setRetestMessage("请输入 SN");return;}const response=await fetch(`${API}/station/retest/status?stationCode=manu_shellbinding&sn=${encodeURIComponent(sn)}`);const body=await response.json();setRetestStatus(body.item||null);setRetestMessage(body.item?`已使用 ${body.item.attemptsUsed||0}/${body.item.maxAttempts||0} 次；${body.item.armed?"已授权":"未授权"}`:"没有待复检记录");}
  async function armRetest(){const sn=retestSn.trim().toUpperCase();if(!sn){setRetestMessage("请输入 SN");return;}const response=await fetch(`${API}/station/retest/arm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stationCode:"manu_shellbinding",sn,actor:"QR_BINDING_3D_OPERATOR"})});const body=await response.json().catch(()=>({}));setRetestMessage(response.ok?`复检已授权：第 ${body.attempt||1} 次，剩余 ${body.remaining??0} 次`:String(body.code||body.error?.message||"复检授权失败"));if(response.ok){addLog(`RETEST ARMED ${sn}`);await queryRetest();}}
  return <div style={{height:"100vh",background:"linear-gradient(135deg,#050b14,#0b1f35)",color:"#e2e8f0",display:"grid",gridTemplateRows:"76px 1fr 230px",fontFamily:"Segoe UI"}}>
    <header style={{display:"flex",alignItems:"center",padding:"0 24px",borderBottom:"1px solid #24415f",gap:10}}><div><b style={{fontSize:22}}>{w.title}</b><div style={{color:"#7dd3fc",fontSize:12}}>{w.sub}</div></div><button onClick={reset} style={{marginLeft:"auto"}}>重置</button><button onClick={()=>setShowRules(true)}>规则 / 测试规则</button><button onClick={()=>{setRetestSn(boardInput||board);setRetestMessage("");setRetestStatus(null);setShowRetest(true);}}>复检</button><button onClick={()=>setShowAll(true)}>记录</button><span style={{color:online?"#22c55e":"#ef4444",fontWeight:800}}>● {online?w.online:w.offline}</span></header>
    <main style={{position:"relative"}}>{viewMode==="3d"?<Canvas camera={{position:[8,7,9],fov:42}} shadows><ambientLight intensity={.7}/><directionalLight position={[5,9,4]} intensity={2} castShadow/><Fixture board={board} shell={shell}/><OrbitControls makeDefault/><Environment preset="warehouse"/></Canvas>:<div style={{height:"100%",display:"grid",placeItems:"center",background:"linear-gradient(135deg,#071827,#102b46)"}}><div style={{width:"min(900px,88vw)",display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:24,alignItems:"center"}}><div style={{padding:28,border:"2px solid #0ea5e9",borderRadius:16,background:"#0c2138",textAlign:"center"}}><div style={{fontSize:18,color:"#7dd3fc"}}>PCBA BOARD</div><strong style={{display:"block",marginTop:18,fontSize:24}}>{board||w.waiting}</strong></div><div style={{fontSize:38,color:board&&shell?"#22c55e":"#64748b"}}>→</div><div style={{padding:28,border:"2px solid #22c55e",borderRadius:16,background:"#0c2138",textAlign:"center"}}><div style={{fontSize:18,color:"#86efac"}}>SHELL</div><strong style={{display:"block",marginTop:18,fontSize:24}}>{shell||w.waiting}</strong></div></div></div>}<div style={{position:"absolute",left:20,top:20,padding:"10px 14px",background:"#07111fdd",border:"1px solid #155e75",borderRadius:8}}>{w.source}<br/><span style={{color:"#fbbf24"}}>🛡 {w.guard}</span><div style={{marginTop:8,fontSize:11,maxHeight:80,overflow:"hidden"}}>{logs.slice(0,3).map((line,i)=><div key={i}>{line}</div>)}</div></div></main>
    <section style={{display:"grid",gridTemplateColumns:"1fr 1fr 1.4fr",gap:12,padding:14,borderTop:"1px solid #24415f"}}>
      <div style={{background:"#10243b",border:"1px solid #0ea5e9",borderRadius:10,padding:14}}><b>{w.board}</b><input value={boardInput} onChange={e=>setBoardInput(e.target.value)} placeholder={w.waiting} style={{width:"100%",boxSizing:"border-box",margin:"14px 0 8px",padding:10}}/><div style={{fontSize:16,marginBottom:8,color:board?"#7dd3fc":"#64748b"}}>{board||w.waiting}</div><button onClick={()=>void simulateBoard()} disabled={busy} style={{background:"#0284c7",color:"white",fontWeight:800,padding:"10px 16px",border:"1px solid #38bdf8",borderRadius:7,opacity:1}}>{w.scanBoard}</button></div>
      <div style={{background:"#10243b",border:"1px solid #22c55e",borderRadius:10,padding:14}}><b>{w.shell}</b><input value={shellInput} onChange={e=>setShellInput(e.target.value)} placeholder={w.waiting} style={{width:"100%",boxSizing:"border-box",margin:"14px 0 8px",padding:10}}/><div style={{fontSize:16,marginBottom:8,color:shell?"#86efac":"#64748b"}}>{shell||w.waiting}</div><button onClick={()=>void simulateShell()} disabled={busy} style={{background:"#059669",color:"white",fontWeight:800,padding:"10px 16px",border:"1px solid #34d399",borderRadius:7,opacity:1}}>{w.scanShell}</button></div>
      <div style={{background:"#10243b",border:`2px solid ${result===w.success?"#22c55e":"#64748b"}`,borderRadius:10,padding:14,overflow:"auto"}}><b>{result||`${w.bindings} (${rows.length})`}</b>{result===w.success&&<div style={{fontSize:22,color:"#86efac",fontWeight:800,marginTop:12}}>{board} → {shell}</div>}{!result&&rows.slice(0,5).map((r,i)=><div key={i} style={{fontFamily:"monospace",fontSize:12,paddingTop:8}}>{String(r.pcbaSn??r.boardSn??r.sn??"")} → {String(r.shellSn??r.shell_sn??"")}</div>)}<button onClick={()=>setShowAll(true)} style={{marginTop:12,background:"#475569",color:"white",padding:"8px 12px",borderRadius:6,border:"1px solid #94a3b8"}}>{w.allResults}</button></div>
    </section>
    {showAll&&<div style={{position:"fixed",inset:0,zIndex:20,background:"#020617eF",padding:28,display:"grid",gridTemplateRows:"auto auto 1fr",color:"white"}}><div style={{display:"flex",alignItems:"center",marginBottom:14}}><h2 style={{margin:0}}>{w.allResults} ({rows.length})</h2><span style={{marginLeft:18}}>今日: {rows.filter(r=>r.boundAt&&new Date(String(r.boundAt)).toDateString()===new Date().toDateString()).length} / 总计: {rows.length}</span><button onClick={()=>setShowAll(false)} style={{marginLeft:"auto",padding:"9px 18px"}}>{w.close}</button></div><div style={{display:"flex",gap:8,marginBottom:12}}><button onClick={()=>void refresh()}>刷新</button><button onClick={exportCsv}>导出 CSV</button><button onClick={()=>void deleteSelected()} disabled={!selected.size}>删除选中</button><button onClick={()=>void clearTestRecords()}>清空测试记录</button></div><div style={{overflow:"auto",background:"#0f172a",border:"1px solid #334155",borderRadius:10}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th></th><th style={{padding:10}}>{w.board}</th><th>{w.shell}</th><th>{w.operator}</th><th>{w.time}</th><th>{w.result}</th></tr></thead><tbody>{rows.map((r,i)=>{const key=`${String(r.pcbaSn??r.sn??"")}\u0000${String(r.shellSn??"")}`;return <tr key={`${key}-${i}`}><td style={{padding:10,borderTop:"1px solid #334155"}}><input type="checkbox" checked={selected.has(key)} onChange={e=>setSelected(current=>{const next=new Set(current);e.target.checked?next.add(key):next.delete(key);return next;})}/></td><td style={{padding:10,borderTop:"1px solid #334155"}}>{String(r.pcbaSn??r.boardSn??r.sn??"")}</td><td style={{borderTop:"1px solid #334155"}}>{String(r.shellSn??r.shell_sn??"")}</td><td style={{borderTop:"1px solid #334155"}}>{String(r.operator??"—")}</td><td style={{borderTop:"1px solid #334155"}}>{r.boundAt?new Date(String(r.boundAt)).toLocaleString():"—"}</td><td style={{borderTop:"1px solid #334155",color:"#86efac"}}>{String(r.result??"PASS")}</td></tr>})}</tbody></table></div></div>}
    {showRules&&<div style={{position:"fixed",inset:0,zIndex:30,background:"#020617eF",display:"grid",placeItems:"center"}}><div style={{width:"min(720px,90vw)",background:"#0f172a",border:"1px solid #475569",borderRadius:12,padding:22}}><h2>站点条码规则与测试</h2><label>PCBA 正则<input value={pcbaPattern} onChange={e=>setPcbaPattern(e.target.value)} style={{display:"block",width:"100%",boxSizing:"border-box",padding:10,margin:"6px 0 14px"}}/></label><label>外壳正则<input value={shellPattern} onChange={e=>setShellPattern(e.target.value)} style={{display:"block",width:"100%",boxSizing:"border-box",padding:10,margin:"6px 0 14px"}}/></label><div>PCBA 测试: {boardInput||"—"} → {boardInput?(new RegExp(pcbaPattern).test(boardInput)?"PASS":"FAIL"):"—"}</div><div>外壳测试: {shellInput||"—"} → {shellInput?(new RegExp(shellPattern).test(shellInput)?"PASS":"FAIL"):"—"}</div><div style={{display:"flex",gap:8,marginTop:18}}><button onClick={saveRules}>保存</button><button onClick={()=>setShowRules(false)}>取消</button></div></div></div>}
    {showRetest&&<div style={{position:"fixed",inset:0,zIndex:31,background:"#020617eF",display:"grid",placeItems:"center"}}><div style={{width:"min(620px,90vw)",background:"#0f172a",border:"1px solid #f59e0b",borderRadius:12,padding:22}}><h2>复检控制</h2><label>产品 SN<input value={retestSn} onChange={e=>setRetestSn(e.target.value)} style={{display:"block",width:"100%",boxSizing:"border-box",padding:11,margin:"7px 0 14px"}}/></label><div style={{minHeight:48,padding:10,background:"#1e293b",borderRadius:7,color:retestStatus?.armed?"#86efac":"#fbbf24"}}>{retestMessage||"输入或扫描 SN 后查询 MES 复检状态"}</div><div style={{display:"flex",gap:8,marginTop:18}}><button onClick={()=>void queryRetest()}>查询状态</button><button onClick={()=>void armRetest()} style={{background:"#d97706",color:"white"}}>授权复检</button><button onClick={()=>setShowRetest(false)}>关闭</button></div></div></div>}
  </div>;
}
