import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/client";

type Binding = { id?: string; workOrderCode?: string; materialSn?: string; machineCode?: string; channelCode?: string; feederCode?: string; qtyPerRoll?: number; rollCount?: number; status?: string };
type ScanEvent = { id:number; eventId:string; workOrderCode:string; materialSn:string; scanStep:"MACHINE"|"CHANNEL"|"FEEDER"; scannedValue:string; expectedValue:string; result:"PASS"|"REJECT"; reason?:string; operator?:string; deviceId?:string; occurredAt:string };
type PdaActivity = { activityType:string; workOrderCode?:string; materialSn?:string; machineCode?:string; channelCode?:string; feederCode?:string; result?:"PASS"|"REJECT"; at:Date };
type MachineKpi = { rolls:number; pass:number; reject:number; active:boolean };

const registeredMachines = ["NPM-01", "NPM-02", "NPM-03", "NPM-04", "NPM-05", "NPM-06"];
const recipeMachines = registeredMachines;
// Fixed physical NPM map, independent of the Excel recipe layout.
const fixedChannelLayout = { left: Array.from({length:17}, (_, i) => i + 1), right: Array.from({length:17}, (_, i) => i + 1) };
// Compatibility alias for the existing list renderer; values are no longer
// read from Excel and always represent the physical 17+17 machine banks.
const excelLayout: Record<string,{left:number[];right:number[]}> = Object.fromEntries(registeredMachines.map(code => [code, fixedChannelLayout]));

function channelIndex(code?: string) {
  const match = String(code || "").toUpperCase().match(/(\d+)/);
  return match ? Math.max(0, (Number(match[1]) - 1) % 34) : -1;
}

function channelSide(code?: string) {
  return String(code || "").trim().toUpperCase().startsWith("R") ? "right" : "left";
}

function QrMarker({ position, title, value, state }: { position:[number,number,number]; title:string; value?:string; state:"idle"|"flash"|"wrong"|"ok" }) {
  return <Html position={position} center distanceFactor={8}>
    <div className={`smt3d-qr ${state}`}><b>{title}</b><strong>{value || "—"}</strong></div>
  </Html>;
}

function NpmFleet3d({activeMachine,wrong,machineKpi}:{activeMachine:string;wrong:boolean;machineKpi:Record<string,MachineKpi>}) {
  const positions:[string,[number,number,number],number][]=[
    ["NPM-01",[-1.38,.55,-3.3],-Math.PI/2],["NPM-03",[-1.38,.55,0],-Math.PI/2],["NPM-05",[-1.38,.55,3.3],-Math.PI/2],
    ["NPM-02",[1.38,.55,-3.3],Math.PI/2],["NPM-04",[1.38,.55,0],Math.PI/2],["NPM-06",[1.38,.55,3.3],Math.PI/2],
  ];
  return <>
    <color attach="background" args={["#e8eff2"]}/><ambientLight intensity={1.8}/><directionalLight position={[2,10,4]} intensity={2.4}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.12,0]}><planeGeometry args={[14,12]}/><meshStandardMaterial color="#9aa9af"/></mesh>
    {([[-3.3,"第1排 · NPM-01 / NPM-02"],[0,"第2排 · NPM-03 / NPM-04"],[3.3,"第3排 · NPM-05 / NPM-06"]] as [number,string][]).map(([z,label])=><group key={label}>
      <mesh position={[0,.55,z]}><boxGeometry args={[.22,1.38,1.08]}/><meshStandardMaterial color="#54666e" metalness={.55}/></mesh>
      <mesh position={[0,1.38,z]}><boxGeometry args={[.1,.12,.82]}/><meshStandardMaterial color="#17c985" emissive="#0b8057" emissiveIntensity={.35}/></mesh>
      <Html position={[0,1.05,z]} center><div className="smt3d-pair-label">{label}</div></Html>
    </group>)}
    {[-1.65,1.65].map(z=><group key={`flow-${z}`} position={[0,.16,z]}>
      <mesh rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.14,.14,1.85,22]}/><meshStandardMaterial color="#e21d2f" emissive="#b00018" emissiveIntensity={.8}/></mesh>
      <mesh position={[0,0,1.16]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[.38,.68,24]}/><meshStandardMaterial color="#ff2438" emissive="#c4001b" emissiveIntensity={1}/></mesh>
    </group>)}
    <Html position={[0,.18,-4.65]} center><div className="smt3d-flow-label">IN · PCB 进料</div></Html>
    <Html position={[0,.18,4.65]} center><div className="smt3d-flow-label">OUT · PCB 出料 →</div></Html>
    {positions.map(([code,position,rotation])=>{const active=code===activeMachine;const color=active?(wrong?"#ef3340":"#17c985"):"#dce2e4";const kpi=machineKpi[code]||{rolls:0,pass:0,reject:0,active:false};return <group key={code} position={position} rotation={[0,rotation,0]}>
      <RoundedBox args={[2.7,1.5,1.25]} radius={.12}><meshStandardMaterial color={color} emissive={active?color:"#000"} emissiveIntensity={active?.85:0} metalness={.2}/></RoundedBox>
      <mesh position={[0,.15,.64]}><boxGeometry args={[1.9,.55,.05]}/><meshStandardMaterial color="#13232b"/></mesh>
      <mesh position={[0,-.58,.78]}><boxGeometry args={[2.35,.38,.42]}/><meshStandardMaterial color="#394950"/></mesh>
      <Html position={[0,1.05,0]} center><div className={`smt3d-fleet-label ${active?(wrong?"wrong":"active"):""}`}><b>{code}</b><small>{Number(code.slice(-2))%2===1?"产线左侧":"产线右侧"}</small><small className="smt3d-machine-kpi">ROLLS {kpi.rolls} · P {kpi.pass} · NG {kpi.reject}</small>{active&&<strong>{wrong?"扫描错误":"当前扫描"}</strong>}</div></Html>
    </group>})}
    <Html position={[0,.15,-5.25]} center><div className="smt3d-aisle-label">三组左右背靠背 NPM 机组 / 3 BACK-TO-BACK PAIRS</div></Html>
    <OrbitControls makeDefault target={[0,0,0]} minDistance={9} maxDistance={19}/>
  </>;
}

function NpmD3aMachine({ binding, step, wrong }: { binding:Binding; step:number; wrong:boolean }) {
  const activeSlot = channelIndex(binding.channelCode);
  const activeSide = channelSide(binding.channelCode);
  const machineCode = binding.machineCode || "NPM-01";
  const machineLayout = fixedChannelLayout;
  const stateFor = (target:number):"idle"|"flash"|"wrong"|"ok" => step === target ? (wrong ? "wrong" : "flash") : step > target ? "ok" : "idle";
  const colorFor = (target:number) => stateFor(target) === "wrong" ? "#ef3340" : stateFor(target) === "flash" ? "#ffc928" : stateFor(target) === "ok" ? "#17c985" : "#34434c";
  return <>
    <color attach="background" args={["#edf3f5"]}/>
    <ambientLight intensity={1.7}/><directionalLight position={[5,9,7]} intensity={2.2}/><directionalLight position={[-5,4,2]} intensity={.8}/>
    <group rotation={[0,-0.16,0]} position={[0,-.15,0]}>
      {/* NPM-D3A main frame and white service doors */}
      <RoundedBox args={[7.6,4.25,2.65]} radius={0.16} position={[0,1.45,0]}><meshStandardMaterial color="#e9ecec" metalness={.18} roughness={.42}/></RoundedBox>
      <mesh position={[0,2.04,1.34]}><boxGeometry args={[6.35,1.45,.08]}/><meshStandardMaterial color="#101b21" roughness={.28}/></mesh>
      <mesh position={[-1.55,2.04,1.39]}><boxGeometry args={[.035,1.35,.03]}/><meshStandardMaterial color="#8c9aa0"/></mesh>
      <mesh position={[1.55,2.04,1.39]}><boxGeometry args={[.035,1.35,.03]}/><meshStandardMaterial color="#8c9aa0"/></mesh>
      {/* visible gantries / two independent heads behind smoked windows */}
      {[-1.65,1.65].map((x)=><group key={x} position={[x,2.05,1.42]}>
        <mesh><boxGeometry args={[1.6,.16,.08]}/><meshStandardMaterial color="#9bb0b8" metalness={.7}/></mesh>
        <mesh position={[0,-.28,.08]}><boxGeometry args={[.42,.45,.22]}/><meshStandardMaterial color="#d7e1e4" metalness={.5}/></mesh>
        <mesh position={[0,-.54,.12]}><cylinderGeometry args={[.11,.11,.3,16]}/><meshStandardMaterial color="#8ad3e0"/></mesh>
      </group>)}
      {/* dual PCB conveyor lanes */}
      {[-.23,.23].map((z,i)=><group key={z} position={[0,.95,1.42+z]}>
        <mesh><boxGeometry args={[5.9,.09,.18]}/><meshStandardMaterial color="#53656d" metalness={.65}/></mesh>
        <mesh position={[0,.08,0]}><boxGeometry args={[2.2,.035,.15]}/><meshStandardMaterial color={i ? "#2cbb71" : "#39d47d"}/></mesh>
      </group>)}
      {/* lower grey fascia and feeder-cart dock */}
      <mesh position={[0,.36,1.38]}><boxGeometry args={[6.6,.76,.2]}/><meshStandardMaterial color="#56656b"/></mesh>
      <mesh position={[0,-.56,1.58]}><boxGeometry args={[6.85,1.16,.72]}/><meshStandardMaterial color="#3e4b51" metalness={.3}/></mesh>
      {/* Site position codes are split into left (L) and right (R) feeder banks. */}
      {(["left","right"] as const).flatMap(sideName=>machineLayout[sideName].map(slot=>{
        const i=slot-1;
        const x=(sideName==="left"?-3.2:.12)+i*.19;
        const active=i===activeSlot&&activeSide===sideName;
        const c=active?colorFor(2):"#202c31";
        return <group key={`${sideName}-${slot}`} position={[x,-.45,2.02]}>
          <mesh><boxGeometry args={[.14,1.28,.54]}/><meshStandardMaterial color={c} emissive={active?c:"#000"} emissiveIntensity={active?1.1:0}/></mesh>
          <mesh position={[0,.45,.31]}><boxGeometry args={[.1,.12,.1]}/><meshStandardMaterial color={active?"#fff3a6":"#64757c"}/></mesh>
          <Html position={[0,-.7,.34]} center><span className="smt3d-slot-number">{sideName==="left"?"L":"R"}{slot}</span></Html>
        </group>;
      }))}
      <Html position={[-2.15,-1.2,2.28]} center><div className="smt3d-bank-label">L · LEFT · {machineLayout.left.length} EXCEL POSITIONS</div></Html>
      <Html position={[2.15,-1.2,2.28]} center><div className="smt3d-bank-label">R · RIGHT · {machineLayout.right.length} EXCEL POSITIONS</div></Html>
      {/* active physical feeder and material reel */}
      {activeSlot >= 0 && <group position={[(activeSide==="left"?-3.2:.12)+activeSlot*.19,-.32,2.52]}>
        <mesh><boxGeometry args={[.16,1.45,.82]}/><meshStandardMaterial color={colorFor(3)} emissive={colorFor(3)} emissiveIntensity={step===3?1.1:.08}/></mesh>
        <mesh position={[0,.45,.48]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.36,.075,16,40]}/><meshStandardMaterial color={colorFor(4)} emissive={colorFor(4)} emissiveIntensity={step===4?1.15:.08} metalness={.35}/></mesh>
        <QrMarker position={[0,.9,.7]} title="MATERIAL ROLL QR" value={binding.materialSn} state={stateFor(4)}/>
      </group>}
      {/* operator console */}
      <group position={[3.35,1.42,1.68]} rotation={[0,-.2,0]}>
        <mesh><boxGeometry args={[.95,1.02,.24]}/><meshStandardMaterial color="#303c42"/></mesh>
        <mesh position={[0,.08,.14]}><boxGeometry args={[.72,.62,.04]}/><meshStandardMaterial color="#1d7790" emissive="#0b5b75" emissiveIntensity={.65}/></mesh>
        <mesh position={[.3,-.39,.16]}><cylinderGeometry args={[.09,.09,.08,20]}/><meshStandardMaterial color="#e33434"/></mesh>
      </group>
      {/* Panasonic/NPM identification and tower light */}
      <Html position={[-2.8,3.18,1.4]} center><div className="smt3d-brand"><b>Panasonic</b><span>NPM-D3A · NM-EJM6E</span></div></Html>
      <group position={[3.24,3.95,.42]}><mesh><cylinderGeometry args={[.08,.08,.65,16]}/><meshStandardMaterial color="#58666c"/></mesh>{["#21d07a","#ffd333","#ef3b48"].map((c,i)=><mesh key={c} position={[0,.42+i*.17,0]}><cylinderGeometry args={[.13,.13,.15,18]}/><meshStandardMaterial color={c} emissive={c} emissiveIntensity={.35}/></mesh>)}</group>
      <QrMarker position={[0,3.16,1.56]} title="MACHINE QR" value={machineCode} state={stateFor(1)}/>
      <QrMarker position={[activeSide==="left"?-2.05:2.05,.16,2.82]} title="CHANNEL QR" value={binding.channelCode} state={stateFor(2)}/>
      <QrMarker position={[activeSide==="left"?-1.25:1.25,.02,3.12]} title="FEEDER QR" value={binding.feederCode} state={stateFor(3)}/>
    </group>
    <gridHelper args={[20,20,"#8fa2aa","#cad5d9"]}/><OrbitControls makeDefault target={[0,1,0]} minDistance={7} maxDistance={16}/>
  </>;
}

export function SmtLoading3dSimulator() {
  const [bindings,setBindings]=useState<Binding[]>([]), [events,setEvents]=useState<ScanEvent[]>([]), [activity,setActivity]=useState<PdaActivity|null>(null), [selected,setSelected]=useState(0), [viewMachine,setViewMachine]=useState("NPM-01"), [step,setStep]=useState(1), [wrong,setWrong]=useState(false), [loading,setLoading]=useState(true);
  const bindingRows=useRef<Record<string,HTMLButtonElement|null>>({});
  const machineRows=useRef<Record<string,HTMLButtonElement|null>>({});
  const current=bindings[selected]||{};
  const displayBinding={...current,...(activity?.workOrderCode?{workOrderCode:activity.workOrderCode}:{}),...(activity?.materialSn?{materialSn:activity.materialSn}:{}),...(activity?.machineCode?{machineCode:activity.machineCode}:{}),...(activity?.channelCode?{channelCode:activity.channelCode}:{}),...(activity?.feederCode?{feederCode:activity.feederCode}:{}),machineCode:activity?.machineCode||current.machineCode||viewMachine};
  const refresh=()=>{setLoading(true);apiClient.get<{items?:Binding[]} | Binding[]>("/mes/material-roll-bindings",{limit:100}).then(r=>setBindings(Array.isArray(r)?r:r.items||[])).catch(()=>setBindings([])).finally(()=>setLoading(false));};
  useEffect(refresh,[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      document.querySelectorAll(".smt3d-grid h3").forEach(node=>{ if (node.textContent?.includes("Excel")) node.textContent="NPM machine layout"; });
      document.querySelectorAll<HTMLElement>(".smt3d-bank-label").forEach(node=>{ node.textContent=node.textContent?.startsWith("L")?"L · LEFT · L01–L17":"R · RIGHT · R01–R17"; });
    },0);
    return()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{let disposed=false;const poll=()=>apiClient.get<{items:ScanEvent[]}>("/mes/smt-loading/scan-verifications",{limit:100}).then(r=>{if(!disposed)setEvents(r.items||[])}).catch(()=>{});void poll();const timer=setInterval(poll,2000);return()=>{disposed=true;clearInterval(timer)}},[]);
  useEffect(()=>{const stream=new EventSource("/api/pda/events?node=mes_smt_loading_3d&replay=1&types=SMT_LOADING_PDA_ACTIVITY,SMT_LOADING_SCAN_VERIFIED");stream.onmessage=(message)=>{try{const event=JSON.parse(message.data);const p=event.payload||{};if(event.type==="SMT_LOADING_PDA_ACTIVITY"){
      const next:PdaActivity={activityType:String(p.activityType||""),workOrderCode:p.workOrderCode?String(p.workOrderCode):undefined,materialSn:p.materialSn?String(p.materialSn):undefined,machineCode:p.machineCode?String(p.machineCode):undefined,channelCode:p.channelCode?String(p.channelCode):undefined,feederCode:p.feederCode?String(p.feederCode):undefined,result:p.result==="REJECT"?"REJECT":"PASS",at:new Date()};
      setActivity(next);setWrong(next.result==="REJECT");if(next.machineCode)setViewMachine(next.machineCode);
      const activityStep:Record<string,number>={CYCLE_STARTED:1,MACHINE_SELECTED:1,CHANNEL_SELECTED:2,FEEDER_SELECTED:3,MATERIAL_SCANNED:4};setStep(activityStep[next.activityType]||1);
      if(next.materialSn)setSelected(index=>{const found=bindings.findIndex(b=>b.materialSn===next.materialSn);return found>=0?found:index});
    }else if(event.type==="SMT_LOADING_SCAN_VERIFIED"){
      const scanStep=String(p.scanStep||"");setWrong(String(p.result||"")==="REJECT");setStep(scanStep==="MACHINE"?1:scanStep==="CHANNEL"?2:scanStep==="FEEDER"?3:4);
    }}catch{/* polling remains as recovery */}};return()=>stream.close()},[bindings]);
  useEffect(()=>{const latest=events.find(e=>e.workOrderCode===current.workOrderCode&&e.materialSn===current.materialSn);if(!latest)return;setWrong(latest.result==="REJECT");if(latest.result==="PASS")setStep(latest.scanStep==="MACHINE"?2:latest.scanStep==="CHANNEL"?3:4);else setStep(latest.scanStep==="MACHINE"?1:latest.scanStep==="CHANNEL"?2:3)},[events,current.workOrderCode,current.materialSn]);
  useEffect(()=>{const materialSn=activity?.materialSn;if(!materialSn)return;requestAnimationFrame(()=>bindingRows.current[materialSn]?.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"}))},[activity?.materialSn,bindings]);
  useEffect(()=>{const machineCode=activity?.machineCode;if(!machineCode)return;requestAnimationFrame(()=>machineRows.current[machineCode]?.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"}))},[activity?.machineCode]);
  const title=useMemo(()=>current.workOrderCode?`${current.workOrderCode} · ${current.materialSn||""}`:"No binding selected",[current]);
  const lineKpi=useMemo(()=>({
    bindings: bindings.length,
    pass: events.filter(e=>e.result==="PASS").length,
    reject: events.filter(e=>e.result==="REJECT").length,
    scanned: new Set(events.map(e=>e.materialSn).filter(Boolean)).size,
    online: activity ? 1 : 0,
  }),[bindings,events,activity]);
  const machineKpi=useMemo<Record<string,MachineKpi>>(()=>{
    const next:Record<string,MachineKpi>=Object.fromEntries(registeredMachines.map(code=>[code,{rolls:0,pass:0,reject:0,active:false}]));
    bindings.forEach(binding=>{const code=String(binding.machineCode||"");if(next[code])next[code].rolls+=1;});
    events.forEach(event=>{const code=String(bindings.find(binding=>binding.materialSn===event.materialSn)?.machineCode||"");if(!next[code])return;if(event.result==="PASS")next[code].pass+=1;else next[code].reject+=1;});
    if(activity?.machineCode&&next[activity.machineCode])next[activity.machineCode].active=true;
    return next;
  },[bindings,events,activity]);
  const preview=(valid:boolean)=>{if(!valid){setWrong(true);return;}setWrong(false);setStep(s=>Math.min(5,s+1));};
  return <div className="smt3d-page">
    <div className="smt3d-toolbar"><div><p>MES · SMT MATERIAL CONTROL</p><h2>Panasonic NPM-D3A 3D Loading Verification</h2><small>{title}</small></div><button onClick={refresh}>Refresh real-time bindings</button></div>
    <section className="smt3d-fleet-overview"><div className="smt3d-kpi-ribbon" aria-label="SMT 3D manual line KPI"><div><small>MES SYNC</small><b className="live">LIVE</b></div><div><small>REGISTERED ROLLS</small><b>{lineKpi.bindings}</b></div><div><small>PDA PASS</small><b className="pass">{lineKpi.pass}</b></div><div><small>REJECT</small><b className={lineKpi.reject?"reject":"muted"}>{lineKpi.reject}</b></div><div><small>SCANNED ROLLS</small><b>{lineKpi.scanned}</b></div><div><small>ACTIVE MACHINE</small><b className="machine">{activity?.machineCode||"—"}</b></div></div><header><div><b>6 台 NPM · 三排左右背靠背</b><small>第1排 01/02 · 第2排 03/04 · 第3排 05/06</small></div><strong>{activity?.machineCode?`当前：${activity.machineCode}`:"等待 PDA 扫描机器 QR"}</strong></header><div className="smt3d-fleet-canvas"><Canvas camera={{position:[9,10,12],fov:44}}><NpmFleet3d activeMachine={activity?.machineCode||viewMachine} wrong={wrong} machineKpi={machineKpi}/></Canvas></div></section>
    <div className="smt3d-machine-source"><b>现场 3D 布局：</b> 6 台 NPM · 第1排 01/02 · 第2排 03/04 · 第3排 05/06 · 每排左右背靠背 · 红色宽箭头表示生产流向</div>
    <div className="smt3d-grid"><aside><h3>Excel machine layout</h3><div className="smt3d-machine-picker">{recipeMachines.map(code=><button ref={node=>{machineRows.current[code]=node}} key={code} className={`${viewMachine===code?"selected":""} ${activity?.machineCode===code?`live-machine ${wrong?"live-machine-error":""}`:""}`} onClick={()=>{setViewMachine(code);setStep(1);setWrong(false)}}><b>{code}</b>{activity?.machineCode===code&&<em>{wrong?"机位错误":"当前扫描机位"}</em>}<small>L {excelLayout[code].left.join(", ")||"—"}</small><small>R {excelLayout[code].right.join(", ")||"—"}</small></button>)}</div><h3>Active material bindings</h3>{loading?<p>Loading…</p>:bindings.length===0?<p>No MES binding records.</p>:bindings.map((b,i)=><button ref={node=>{if(b.materialSn)bindingRows.current[b.materialSn]=node}} className={`${i===selected?"selected":""} ${activity?.materialSn===b.materialSn?`live-material ${wrong?"live-material-error":""}`:""}`} onClick={()=>{setSelected(i);setViewMachine(b.machineCode||"NPM-01");setStep(1);setWrong(false)}} key={b.id||i}><b>{b.materialSn||"Material roll"}</b>{activity?.materialSn===b.materialSn&&<em>{wrong?"校验错误":"当前上料"}</em>}<span>{b.machineCode} / {b.channelCode} / {b.feederCode}</span><small>{b.workOrderCode} · {b.qtyPerRoll||0} pcs × {b.rollCount||1}</small></button>)}</aside>
      <main><div className="smt3d-canvas"><Canvas camera={{position:[8,5.8,10],fov:42}}><NpmD3aMachine binding={displayBinding} step={step} wrong={wrong}/></Canvas></div>
      <div className={`smt3d-status ${wrong?"danger":""}`}>{wrong?"⚠ 扫码错误：MES 已拒绝，请重新扫描红色目标。":step>=5?"✓ 机器、通道、Feeder 与料卷均已验证，可以上料。":`步骤 ${step}/4：请扫描闪烁的${step===1?"机器":step===2?"通道":step===3?"Feeder":"料卷"}二维码。`}</div>
      {activity&&<div className={`smt3d-live-focus ${wrong?"danger":""}`}><b>当前 PDA 扫描</b><span>{activity.workOrderCode||"—"} · {activity.machineCode||"—"} / {activity.channelCode||"—"} / {activity.feederCode||"—"} · {activity.materialSn||"等待料卷"}</span><small>{activity.at.toLocaleTimeString()} · {activity.activityType}</small></div>}
      <div className="smt3d-actions"><button disabled={!displayBinding.machineCode||step>4} onClick={()=>preview(true)}>预览正确扫码</button><button disabled={!displayBinding.machineCode||step>4} className="danger" onClick={()=>preview(false)}>预览错误扫码</button><button onClick={()=>{setStep(1);setWrong(false)}}>重置预览</button></div></main></div>
    <section className="smt3d-live-events"><h3>PDA scan verification · live</h3><div className="table-wrap"><table><thead><tr><th>Time</th><th>WO</th><th>Roll SN</th><th>Step</th><th>Scanned</th><th>MES expected</th><th>Result</th><th>Device / operator</th></tr></thead><tbody>{events.slice(0,50).map(e=><tr key={e.eventId} className={e.result==="REJECT"?"rejected":"passed"}><td>{new Date(e.occurredAt).toLocaleTimeString()}</td><td>{e.workOrderCode}</td><td>{e.materialSn}</td><td>{e.scanStep}</td><td>{e.scannedValue}</td><td>{e.expectedValue||"—"}</td><td><strong>{e.result}</strong>{e.reason&&<small>{e.reason}</small>}</td><td>{e.deviceId||"—"} / {e.operator||"—"}</td></tr>)}{events.length===0&&<tr><td colSpan={8}>Waiting for the first PDA scan result…</td></tr>}</tbody></table></div></section>
  </div>;
}
