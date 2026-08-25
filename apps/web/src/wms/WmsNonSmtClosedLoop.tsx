import {useCallback,useEffect,useState} from "react";
import type {Locale} from "../../../../packages/shared-types/src/factory";
import {apiClient} from "../api/client";

type Data={
  summary:{classified_materials:number;configured_materials:number;active_unit_bindings:number;pending_returns:number;open_exceptions:number;failed_reconciliations:number};
  events:Array<{id:number;event_type:string;tracking_mode:string;work_order_code:string;station_code?:string;material_code:string;material_sn?:string;lot_no?:string;product_sn?:string;qty:number;occurred_at:string}>;
  exceptions:Array<{id:number;exception_no:string;exception_type:string;severity:string;work_order_code?:string;material_code?:string;material_sn?:string;status:string;detected_at:string}>;
  returns:Array<{id:number;handover_no:string;work_order_code:string;material_code:string;theoretical_qty:number;actual_qty?:number;status:string;sent_at:string}>;
};
const words={
  "zh-CN":{title:"非SMT物料闭环",sub:"逐件SN · 批次计量 · 包装绑定 · 间接耗材 — 从领料到BOM核销",classified:"已分类物料",configured:"已配置规则",bindings:"有效逐件绑定",returns:"待收退料",exceptions:"开放异常",failed:"核销失败",flow:"物料接力记录",alerts:"异常队列",handover:"退料交接",empty:"暂无数据",refresh:"刷新"},
  "en-US":{title:"Non-SMT Material Closed Loop",sub:"Unit SN · Lot quantity · Packaging binding · Indirect consumables — issue through BOM reconciliation",classified:"Classified",configured:"Configured",bindings:"Active bindings",returns:"Pending returns",exceptions:"Open exceptions",failed:"Failed reconciliation",flow:"Material event ledger",alerts:"Exception queue",handover:"Return handovers",empty:"No data",refresh:"Refresh"},
  "vi-VN":{title:"Vòng kín vật liệu ngoài SMT",sub:"SN từng chiếc · Theo lô · Liên kết đóng gói · Vật tư gián tiếp",classified:"Đã phân loại",configured:"Đã cấu hình",bindings:"Liên kết hiệu lực",returns:"Chờ nhận trả",exceptions:"Ngoại lệ mở",failed:"Đối soát lỗi",flow:"Luồng vật liệu",alerts:"Hàng đợi ngoại lệ",handover:"Bàn giao trả liệu",empty:"Không có dữ liệu",refresh:"Làm mới"}
} as const;
export function WmsNonSmtClosedLoop({locale}:{locale:Locale}){
  const w=words[locale],[data,setData]=useState<Data|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{try{setData(await apiClient.get<Data>("/api/wms/non-smt/dashboard"));setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}},[]);
  useEffect(()=>{void load();const id=setInterval(()=>void load(),15000);return()=>clearInterval(id);},[load]);
  const metrics=[[w.classified,data?.summary.classified_materials??0],[w.configured,data?.summary.configured_materials??0],[w.bindings,data?.summary.active_unit_bindings??0],[w.returns,data?.summary.pending_returns??0],[w.exceptions,data?.summary.open_exceptions??0],[w.failed,data?.summary.failed_reconciliations??0]];
  return <div className="screen-stack">
    <section className="surface-panel"><div className="section-header"><div><h2>{w.title}</h2><p>{w.sub}</p></div><button onClick={()=>void load()}>{w.refresh}</button></div>{error&&<p style={{color:"#dc2626"}}>{error}</p>}
      <div className="metric-grid">{metrics.map(([x,n],i)=><div className="metric-card" key={String(x)} style={{borderTop:`4px solid ${i>3?"#dc2626":"#2563eb"}`}}><span>{x}</span><strong>{n}</strong></div>)}</div>
    </section>
    <section className="surface-panel"><h3>{w.alerts}</h3><div className="table-shell"><table><thead><tr><th>No.</th><th>Severity</th><th>Type</th><th>WO</th><th>Material/SN</th><th>Status</th><th>Time</th></tr></thead><tbody>
      {data?.exceptions.length?data.exceptions.map(x=><tr key={x.id}><td>{x.exception_no}</td><td style={{fontWeight:800,color:x.severity==="CRITICAL"?"#dc2626":"#d97706"}}>{x.severity}</td><td>{x.exception_type}</td><td>{x.work_order_code||"-"}</td><td>{x.material_code||x.material_sn||"-"}</td><td>{x.status}</td><td>{new Date(x.detected_at).toLocaleString()}</td></tr>):<tr><td colSpan={7}>{w.empty}</td></tr>}
    </tbody></table></div></section>
    <section className="surface-panel"><h3>{w.handover}</h3><div className="table-shell"><table><thead><tr><th>No.</th><th>WO</th><th>Material</th><th>Theoretical</th><th>Actual</th><th>Status</th><th>Sent</th></tr></thead><tbody>
      {data?.returns.length?data.returns.map(x=><tr key={x.id}><td>{x.handover_no}</td><td>{x.work_order_code}</td><td>{x.material_code}</td><td>{x.theoretical_qty}</td><td>{x.actual_qty??"-"}</td><td>{x.status}</td><td>{new Date(x.sent_at).toLocaleString()}</td></tr>):<tr><td colSpan={7}>{w.empty}</td></tr>}
    </tbody></table></div></section>
    <section className="surface-panel"><h3>{w.flow}</h3><div className="table-shell"><table><thead><tr><th>Event</th><th>Mode</th><th>WO / Station</th><th>Material</th><th>SN/Lot/Product</th><th>Qty</th><th>Time</th></tr></thead><tbody>
      {data?.events.length?data.events.map(x=><tr key={x.id}><td>{x.event_type}</td><td>{x.tracking_mode}</td><td>{x.work_order_code} / {x.station_code||"-"}</td><td>{x.material_code}</td><td>{x.material_sn||x.lot_no||"-"} / {x.product_sn||"-"}</td><td>{x.qty}</td><td>{new Date(x.occurred_at).toLocaleString()}</td></tr>):<tr><td colSpan={7}>{w.empty}</td></tr>}
    </tbody></table></div></section>
  </div>;
}
