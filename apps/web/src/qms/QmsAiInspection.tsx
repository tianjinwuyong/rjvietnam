import { useCallback, useEffect, useState } from "react";
import { visualInspectionApi, type AiVisualInspection } from "../api/visualInspection";

const text = {
  zh:{title:"AI 视觉质检",send:"提交推理结果",refresh:"刷新",station:"工位",sn:"产品 SN",pass:"良品分数",defect:"缺陷分数",latency:"延迟(ms)",code:"缺陷代码",yes:"确认良品",no:"确认不良",empty:"暂无记录",note:"AI 疑似缺陷不能自动判废，必须由质量人员复核。"},
  vi:{title:"Kiểm tra ngoại quan AI",send:"Gửi kết quả",refresh:"Làm mới",station:"Trạm",sn:"SN sản phẩm",pass:"Điểm đạt",defect:"Điểm lỗi",latency:"Độ trễ(ms)",code:"Mã lỗi",yes:"Xác nhận đạt",no:"Xác nhận lỗi",empty:"Chưa có dữ liệu",note:"AI không được tự động loại bỏ sản phẩm nghi lỗi; nhân viên chất lượng phải xác nhận."},
  en:{title:"AI Visual Inspection",send:"Submit inference",refresh:"Refresh",station:"Station",sn:"Product SN",pass:"Pass score",defect:"Defect score",latency:"Latency(ms)",code:"Defect code",yes:"Confirm pass",no:"Confirm fail",empty:"No records",note:"AI never scraps a suspected defect automatically; Quality must review it."},
};

export function QmsAiInspection({locale="zh"}:{locale?:string}) {
  const c=text[locale.startsWith("vi")?"vi":locale.startsWith("en")?"en":"zh"];
  const [items,setItems]=useState<AiVisualInspection[]>([]);
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({stationCode:"manu_aoi",lineCode:"SMT-L001",workOrderCode:"",sn:"",
    modelName:"edge-vision-baseline",modelVersion:"1.0.0",passScore:0.95,defectScore:0.05,defectCode:"",latencyMs:120});
  const load=useCallback(async()=>{try{setError("");setItems((await visualInspectionApi.list()).items??[])}catch(e){setError(e instanceof Error?e.message:String(e))}},[]);
  useEffect(()=>{void load()},[load]);
  const submit=async()=>{if(!form.sn.trim())return setError("SN required");try{setBusy(true);await visualInspectionApi.submit(form);setForm(v=>({...v,sn:""}));await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  const review=async(id:number,d:"PASS"|"FAIL")=>{try{setBusy(true);await visualInspectionApi.review(id,d);await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  const inp={background:"#0f172a",color:"#e2e8f0",border:"1px solid #475569",borderRadius:6,padding:"8px",width:140};
  return <div style={{padding:24,color:"#e2e8f0"}}><div style={{display:"flex",justifyContent:"space-between"}}><h2>{c.title}</h2><button onClick={load}>{c.refresh}</button></div>
    <div style={{padding:12,border:"1px solid #f59e0b",borderRadius:8,color:"#fbbf24",marginBottom:16}}>{c.note}</div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",padding:16,background:"#1e293b",borderRadius:10,marginBottom:18}}>
      {[[c.station,"stationCode","text"],[c.sn,"sn","text"],[c.pass,"passScore","number"],[c.defect,"defectScore","number"],[c.latency,"latencyMs","number"],[c.code,"defectCode","text"]].map(([l,k,t])=>
        <label key={k} style={{display:"grid",gap:5,fontSize:12,color:"#94a3b8"}}>{l}<input style={inp} type={t} step={t==="number"?"0.01":undefined} value={(form as any)[k]} onChange={e=>setForm(v=>({...v,[k]:t==="number"?Number(e.target.value):e.target.value}))}/></label>)}
      <button disabled={busy} onClick={submit} style={{alignSelf:"end",padding:"9px 16px",background:"#2563eb",color:"white",border:0,borderRadius:6}}>{c.send}</button>
    </div>{error&&<div style={{color:"#f87171"}}>{error}</div>}
    <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["No.",c.station,c.sn,"Model","Confidence","Result","Status",""].map(x=><th key={x} style={{textAlign:"left",padding:9,borderBottom:"1px solid #334155"}}>{x}</th>)}</tr></thead>
      <tbody>{items.map(x=><tr key={x.id}><td style={{padding:9}}>{x.inspection_no}</td><td>{x.station_code}</td><td>{x.sn}</td><td>{x.model_name}@{x.model_version}<small> {x.inference_latency_ms}ms</small></td><td>{(Number(x.confidence)*100).toFixed(1)}%</td><td>{x.final_result??x.proposed_result}</td><td>{x.status}</td><td>{x.status==="PENDING_REVIEW"&&<><button onClick={()=>review(x.id,"PASS")}>{c.yes}</button><button onClick={()=>review(x.id,"FAIL")}>{c.no}</button></>}</td></tr>)}</tbody>
    </table>{!items.length&&<div style={{padding:24,color:"#64748b"}}>{c.empty}</div>}</div>;
}
