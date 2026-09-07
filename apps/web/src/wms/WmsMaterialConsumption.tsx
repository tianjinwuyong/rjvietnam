import { useCallback, useEffect, useState } from "react";
import { Boxes, Factory, RefreshCw, Search, TrendingDown, Warehouse } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { wmsApi, type MaterialConsumptionSummary } from "../api/wms";

const EMPTY:MaterialConsumptionSummary={summary:{consumedQty:0,totalLeftQty:0,warehouseQty:0,lineSideQty:0,materialCount:0,consumptionCount:0},items:[],records:[]};

export function WmsMaterialConsumption({locale}:{locale:Locale}) {
  const [data,setData]=useState(EMPTY),[query,setQuery]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState(""),[updatedAt,setUpdatedAt]=useState<Date>(),[selectedCode,setSelectedCode]=useState("");
  const load=useCallback(async()=>{try{setError("");const response=await wmsApi.getMaterialConsumption({q:query,limit:5000});setData(response.item);setSelectedCode(current=>response.item.items.some(x=>x.materialCode===current)?current:(response.item.items[0]?.materialCode||""));setUpdatedAt(new Date());}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}},[query]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),15000);return()=>window.clearInterval(timer);},[load]);
  const displayName=(row:{nameZh:string;nameEn:string;nameVi:string})=>locale==="zh-CN"?row.nameZh:locale==="vi-VN"?row.nameVi:row.nameEn;
  const metrics=[
    ["wms.consumption.consumed",data.summary.consumedQty,TrendingDown,"var(--danger)"],
    ["wms.consumption.left",data.summary.totalLeftQty,Boxes,"var(--ok)"],
    ["wms.consumption.warehouse",data.summary.warehouseQty,Warehouse,"var(--info)"],
    ["wms.consumption.lineSide",data.summary.lineSideQty,Factory,"var(--warn)"],
  ] as const;
  const selected=data.items.find(x=>x.materialCode===selectedCode);
  const selectedRecords=data.records.filter(x=>x.materialCode===selectedCode).slice().reverse();
  let running=0;
  const trend=selectedRecords.map(x=>({time:new Date(x.occurredAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),qty:x.qty,total:(running+=x.qty)}));
  const stockSplit=selected?[{name:t("wms.consumption.warehouse",locale),value:selected.warehouseQty,color:"#2563eb"},{name:t("wms.consumption.lineSide",locale),value:selected.lineSideQty,color:"#f59e0b"}]:[];
  const usedLeft=selected?[{name:selected.materialCode,consumed:selected.consumedQty,left:selected.totalLeftQty}]:[];
  return <div className="screen-stack">
    <section className="surface-panel"><div className="section-header"><div><h2>{t("wms.consumption.title",locale)}</h2><p>{t("wms.consumption.desc",locale)}</p></div><div className="page-tools"><span className="badge badge-ok" title={t("wms.consumption.realtimeTip",locale)}>{t("wms.consumption.realtime",locale)} · 15s</span>{updatedAt&&<small>{t("wms.consumption.updated",locale)} {updatedAt.toLocaleTimeString()}</small>}<button className="action-button" onClick={()=>void load()} title={t("wms.consumption.refreshTip",locale)}><RefreshCw size={15}/></button></div></div>
      <div className="field-input" style={{maxWidth:620}}><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void load()} placeholder={t("wms.consumption.search",locale)} title={t("wms.consumption.searchTip",locale)}/></div>
      {error&&<div className="notice danger">{error}</div>}<div className="metric-grid">{metrics.map(([key,value,Icon,color])=><div className="metric-card" key={key}><Icon size={20} style={{color}}/><span>{t(key,locale)}</span><strong>{Number(value).toLocaleString()}</strong></div>)}</div>
    </section>
    <section className="surface-panel"><div className="section-header"><div><h2>{t("wms.consumption.byMaterial",locale)}</h2><p>{t("wms.consumption.balanceRule",locale)}</p></div><strong>{data.summary.materialCount} {t("wms.consumption.materials",locale)}</strong></div><div className="table-shell"><table><thead><tr><th>{t("common.material",locale)}</th><th>{t("common.name",locale)}</th><th>{t("wms.consumption.consumed",locale)}</th><th>{t("wms.consumption.left",locale)}</th><th>{t("wms.consumption.warehouse",locale)}</th><th>{t("wms.consumption.lineSide",locale)}</th><th>{t("wms.consumption.events",locale)}</th><th>{t("wms.consumption.last",locale)}</th></tr></thead><tbody>{!loading&&data.items.length===0?<tr><td colSpan={8}>{t("common.noData",locale)}</td></tr>:data.items.map(x=><tr key={x.materialId} onClick={()=>setSelectedCode(x.materialCode)} title={t("wms.consumption.charts",locale)} style={{cursor:"pointer",background:x.materialCode===selectedCode?"var(--info-bg)":undefined}}><td><strong>{x.materialCode}</strong></td><td>{displayName(x)}</td><td>{x.consumedQty.toLocaleString()} {x.uom}</td><td><strong>{x.totalLeftQty.toLocaleString()} {x.uom}</strong></td><td>{x.warehouseQty.toLocaleString()}</td><td>{x.lineSideQty.toLocaleString()}</td><td>{x.consumptionCount}</td><td>{x.lastConsumedAt?new Date(x.lastConsumedAt).toLocaleString():"—"}</td></tr>)}</tbody></table></div></section>
    {selected&&<section className="surface-panel"><div className="section-header"><div><h2>{t("wms.consumption.charts",locale)} · {selected.materialCode}</h2><p>{displayName(selected)}</p></div></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16}}>
      <div style={{height:260}}><strong>{t("wms.consumption.trend",locale)}</strong><ResponsiveContainer width="100%" height="90%"><LineChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time"/><YAxis/><Tooltip/><Legend/><Line type="monotone" dataKey="qty" stroke="#dc2626" name={t("wms.consumption.consumed",locale)}/><Line type="monotone" dataKey="total" stroke="#7c3aed" name={t("wms.consumption.usedVsLeft",locale)}/></LineChart></ResponsiveContainer></div>
      <div style={{height:260}}><strong>{t("wms.consumption.locationSplit",locale)}</strong><ResponsiveContainer width="100%" height="90%"><PieChart><Pie data={stockSplit} dataKey="value" nameKey="name" outerRadius={80} label>{stockSplit.map(x=><Cell key={x.name} fill={x.color}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div>
      <div style={{height:260}}><strong>{t("wms.consumption.usedVsLeft",locale)}</strong><ResponsiveContainer width="100%" height="90%"><BarChart data={usedLeft}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name"/><YAxis/><Tooltip/><Legend/><Bar dataKey="consumed" fill="#dc2626" name={t("wms.consumption.consumed",locale)}/><Bar dataKey="left" fill="#16a34a" name={t("wms.consumption.left",locale)}/></BarChart></ResponsiveContainer></div>
    </div></section>}
    <section className="surface-panel"><div className="section-header"><div><h2>{t("wms.consumption.records",locale)}</h2><p>{t("wms.consumption.recordsDesc",locale)}</p></div></div><div className="table-shell"><table><thead><tr><th>{t("common.datetime",locale)}</th><th>{t("common.material",locale)}</th><th>{t("common.lot",locale)}</th><th>{t("common.qty",locale)}</th><th>{t("common.workOrder",locale)}</th><th>{t("wms.consumption.station",locale)}</th><th>{t("wms.transactions.operator",locale)}</th><th>{t("wms.transactions.reference",locale)}</th></tr></thead><tbody>{data.records.map(x=><tr key={x.id}><td>{new Date(x.occurredAt).toLocaleString()}</td><td>{x.materialCode}</td><td>{x.lotNo}</td><td>{x.qty.toLocaleString()} {x.uom}</td><td>{x.workOrderCode||"—"}</td><td>{x.station||"—"}</td><td>{x.operator||"—"}</td><td>{x.referenceNo||x.txNo}</td></tr>)}</tbody></table></div></section>
  </div>;
}
