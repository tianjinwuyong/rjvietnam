import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { API_BASE } from "../api/client";
import { t } from "../i18n";

type Status = "ONLINE" | "STALE" | "OFFLINE";
interface Row { stationCode:string; lineCode:string|null; sequenceOrder:number|null; datasetCount:number; datasets:string[]; inventoryDatasetCount:number; localCount:number; mesCount:number; mismatchCount:number; openConflicts:number; status:Status; latestInventoryAt:string|null; latestSignalAt:string|null }
interface Response { ok:boolean; generatedAt:string; summary:{stations:number;online:number;stale:number;offline:number;mismatched:number;conflicts:number};items:Row[] }
const tone:Record<Status,string>={ONLINE:"ok",STALE:"warning",OFFLINE:"danger"};

export function StationDatabaseManagement({locale}:{locale:Locale}) {
  const [data,setData]=useState<Response|null>(null); const [filter,setFilter]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{setLoading(true);try{const response=await fetch(`${API_BASE}/api/station/database-management`);if(!response.ok)throw new Error(`HTTP ${response.status}`);setData(await response.json());setError("");}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setLoading(false);}},[]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(timer);},[refresh]);
  const rows=useMemo(()=>(data?.items??[]).filter(row=>{const q=filter.trim().toLowerCase();return !q||row.stationCode.toLowerCase().includes(q)||(row.lineCode??"").toLowerCase().includes(q)||row.status.toLowerCase().includes(q);}),[data,filter]);
  const time=(value:string|null)=>value?new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"medium"}).format(new Date(value)):"—";
  const metrics=data?[["admin.databases.total",data.summary.stations],["admin.databases.online",data.summary.online],["admin.databases.stale",data.summary.stale],["admin.databases.mismatch",data.summary.mismatched],["admin.databases.conflicts",data.summary.conflicts]]:[];
  return <div className="screen-stack"><div className="metric-grid">{metrics.map(([label,value])=><article className="surface-panel stat-card" key={label}><span>{t(String(label),locale)}</span><strong>{value}</strong></article>)}</div>
    <section className="surface-panel"><div className="section-header"><div><h2>{t("admin.databases.inventory",locale)}</h2><p>{t("admin.databases.rule",locale)}</p></div></div>
      <div className="toolbar"><input className="input" value={filter} onChange={event=>setFilter(event.target.value)} placeholder={t("admin.databases.search",locale)}/><button type="button" onClick={()=>void refresh()} disabled={loading} title={t("admin.databases.refreshTip",locale)}>{loading?t("admin.databases.loading",locale):t("admin.services.refresh",locale)}</button><span>{t("admin.databases.updated",locale)}: {time(data?.generatedAt??null)}</span></div>
      {error&&<div className="empty-state"><span className="badge badge-danger">{error}</span></div>}
      <div className="table-shell"><table><thead><tr><th>{t("admin.databases.station",locale)}</th><th>{t("admin.databases.status",locale)}</th><th>{t("admin.databases.datasets",locale)}</th><th>{t("admin.databases.local",locale)}</th><th>{t("admin.databases.mes",locale)}</th><th>{t("admin.databases.issues",locale)}</th><th>{t("admin.databases.lastSignal",locale)}</th></tr></thead><tbody>
      {rows.map(row=><tr key={row.stationCode}><td><strong>{row.stationCode}</strong><span>{row.lineCode??"—"}{row.sequenceOrder!=null?` · #${row.sequenceOrder}`:""}</span></td><td><span className={`badge badge-${tone[row.status]}`} title={row.status==="ONLINE"?t("admin.databases.onlineTip",locale):t("admin.databases.offlineTip",locale)}>{t(`admin.databases.${row.status.toLowerCase()}`,locale)}</span></td><td><strong>{row.datasetCount}</strong><span title={row.datasets.join(", ")}>{row.datasets.slice(0,3).join(", ")||"—"}</span></td><td>{row.inventoryDatasetCount?row.localCount.toLocaleString():"—"}</td><td>{row.mesCount.toLocaleString()}</td><td><strong className={row.mismatchCount||row.openConflicts?"badge badge-danger":"badge badge-ok"}>{row.mismatchCount+row.openConflicts}</strong><span>{row.mismatchCount} mismatch · {row.openConflicts} conflict</span></td><td>{time(row.latestSignalAt)}<span>{row.latestInventoryAt?t("admin.databases.inventoryReported",locale):t("admin.databases.noInventory",locale)}</span></td></tr>)}
      {!rows.length&&<tr><td colSpan={7} className="empty-state">{t("common.empty",locale)}</td></tr>}</tbody></table></div></section></div>;
}
