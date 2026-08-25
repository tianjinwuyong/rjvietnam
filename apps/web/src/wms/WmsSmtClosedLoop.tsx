import {useCallback,useEffect,useState} from "react";
import type {Locale} from "../../../../packages/shared-types/src/factory";
import {apiClient} from "../api/client";

type Dashboard={
  summary:{classified_materials:number;active_loading_sessions:number;active_bindings:number;placed_qty:number;unmatched_consumption:number;open_exceptions:number};
  events:Array<{id:number;event_type:string;work_order_code?:string;machine_code?:string;slot_no?:string;material_code?:string;material_sn?:string;qty:number;occurred_at:string}>;
  exceptions:Array<{id:number;exception_no:string;exception_type:string;severity:string;work_order_code?:string;material_code?:string;material_sn?:string;status:string;detected_at:string}>;
};

const text={
  "zh-CN":{title:"SMT 物料闭环",sub:"WMS库存 → PDA上料 → 机台/槽位/Feeder绑定 → NPM消耗 → 退料/报废 → BOM核销",materials:"SMT物料",sessions:"上料中",bindings:"有效绑定",placed:"贴装数量",unmatched:"未匹配消耗",exceptions:"未关闭异常",flow:"实时物料接力",alerts:"异常处理队列",empty:"暂无数据",refresh:"刷新"},
  "en-US":{title:"SMT Material Closed Loop",sub:"WMS stock → PDA loading → Machine/slot/feeder → NPM consumption → Return/scrap → BOM reconciliation",materials:"SMT materials",sessions:"Loading",bindings:"Active bindings",placed:"Placed qty",unmatched:"Unmatched",exceptions:"Open exceptions",flow:"Material flow ledger",alerts:"Exception queue",empty:"No data",refresh:"Refresh"},
  "vi-VN":{title:"Vòng kín vật liệu SMT",sub:"Kho WMS → PDA cấp liệu → Máy/khe/feeder → NPM tiêu hao → Trả/phế → Đối soát BOM",materials:"Vật liệu SMT",sessions:"Đang cấp liệu",bindings:"Liên kết hiệu lực",placed:"SL đã gắn",unmatched:"Chưa khớp",exceptions:"Ngoại lệ mở",flow:"Luồng vật liệu",alerts:"Hàng đợi ngoại lệ",empty:"Không có dữ liệu",refresh:"Làm mới"}
} as const;

export function WmsSmtClosedLoop({locale}:{locale:Locale}){
  const w=text[locale], [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{try{setData(await apiClient.get<Dashboard>("/api/wms/smt-loop/dashboard"));setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}},[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
  const metrics=[
    [w.materials,data?.summary.classified_materials??0,"#2563eb"],[w.sessions,data?.summary.active_loading_sessions??0,"#7c3aed"],
    [w.bindings,data?.summary.active_bindings??0,"#059669"],[w.placed,data?.summary.placed_qty??0,"#0891b2"],
    [w.unmatched,data?.summary.unmatched_consumption??0,"#d97706"],[w.exceptions,data?.summary.open_exceptions??0,"#dc2626"]
  ];
  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header"><div><h2>{w.title}</h2><p>{w.sub}</p></div><button onClick={()=>void load()}>{w.refresh}</button></div>
      {error&&<p style={{color:"#dc2626"}}>{error}</p>}
      <div className="metric-grid">{metrics.map(([label,value,color])=><div className="metric-card" key={String(label)} style={{borderTop:`4px solid ${color}`}}><span>{label}</span><strong>{value}</strong></div>)}</div>
    </section>
    <section className="surface-panel"><h3>{w.alerts}</h3><div className="table-shell"><table><thead><tr><th>No.</th><th>Severity</th><th>Type</th><th>WO</th><th>Material/SN</th><th>Status</th><th>Time</th></tr></thead><tbody>
      {data?.exceptions.length?data.exceptions.map(x=><tr key={x.id}><td>{x.exception_no}</td><td style={{color:x.severity==="CRITICAL"?"#dc2626":"#d97706",fontWeight:800}}>{x.severity}</td><td>{x.exception_type}</td><td>{x.work_order_code||"-"}</td><td>{x.material_code||x.material_sn||"-"}</td><td>{x.status}</td><td>{new Date(x.detected_at).toLocaleString()}</td></tr>):<tr><td colSpan={7}>{w.empty}</td></tr>}
    </tbody></table></div></section>
    <section className="surface-panel"><h3>{w.flow}</h3><div className="table-shell"><table><thead><tr><th>Event</th><th>WO</th><th>Machine/Slot</th><th>Material SN</th><th>Qty</th><th>Time</th></tr></thead><tbody>
      {data?.events.length?data.events.map(x=><tr key={x.id}><td>{x.event_type}</td><td>{x.work_order_code||"-"}</td><td>{x.machine_code||"-"} / {x.slot_no||"-"}</td><td>{x.material_sn||x.material_code||"-"}</td><td>{x.qty}</td><td>{new Date(x.occurred_at).toLocaleString()}</td></tr>):<tr><td colSpan={6}>{w.empty}</td></tr>}
    </tbody></table></div></section>
  </div>;
}
