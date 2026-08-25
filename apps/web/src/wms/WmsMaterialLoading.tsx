import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Boxes, Clock3, Database, RefreshCw, Search, X } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

interface RecordRow {
  id:number; workOrderCode:string; lineCode:string; machineCode:string;
  channelCode:string; slotNo:string; feederCode:string; materialCode:string;
  materialNameZh:string; materialSn:string; lotNo:string; quantity:number;
  consumedQty:number; remainingQty:number; operator:string; status:string;
  qualityVerdict:string; boundAt:string; unboundAt:string; createdAt:string;
  sessionId:number; sessionStatus:string;
}
interface Summary {
  total:number; active:number; today:number; unverified:number;
  quantity:number; loading:number; released:number;
}

const words = {
  zh: {
    title:"PDA 上料追溯", sub:"MES 权威记录 · 所有扫码绑定永久保存", refresh:"刷新",
    search:"搜索工单、机台、槽位、Feeder 或物料 SN", wo:"工单", machine:"机台",
    status:"状态", all:"全部", from:"开始日期", to:"结束日期", total:"全部绑定",
    active:"当前有效", today:"今日绑定", loading:"进行中工单", qty:"绑定总数量",
    time:"绑定时间", slot:"槽位", feeder:"Feeder", material:"物料编码",
    sn:"物料 SN", lot:"批次", quantity:"数量", remaining:"剩余", operator:"操作员",
    session:"工单状态", detail:"绑定详情", empty:"没有符合条件的上料记录",
    source:"数据源：MES feeder_binding_events", close:"关闭", unverified:"未验证编码",
  },
  en: {
    title:"PDA Loading Trace", sub:"MES source of truth · every scanned binding retained", refresh:"Refresh",
    search:"Search WO, machine, slot, feeder or material SN", wo:"Work order", machine:"Machine",
    status:"Status", all:"All", from:"From", to:"To", total:"All bindings",
    active:"Active", today:"Today", loading:"Loading WOs", qty:"Total quantity",
    time:"Bound at", slot:"Slot", feeder:"Feeder", material:"Material",
    sn:"Material SN", lot:"Lot", quantity:"Quantity", remaining:"Remaining", operator:"Operator",
    session:"WO status", detail:"Binding details", empty:"No loading records match these filters",
    source:"Source: MES feeder_binding_events", close:"Close", unverified:"Unverified code",
  },
  vi: {
    title:"Truy xuất nạp liệu PDA", sub:"Dữ liệu MES chính thức · lưu toàn bộ lần quét", refresh:"Làm mới",
    search:"Tìm lệnh SX, máy, vị trí, feeder hoặc SN vật tư", wo:"Lệnh SX", machine:"Máy",
    status:"Trạng thái", all:"Tất cả", from:"Từ ngày", to:"Đến ngày", total:"Tổng liên kết",
    active:"Đang dùng", today:"Hôm nay", loading:"Lệnh đang nạp", qty:"Tổng số lượng",
    time:"Thời gian", slot:"Vị trí", feeder:"Feeder", material:"Mã vật tư",
    sn:"SN vật tư", lot:"Lô", quantity:"Số lượng", remaining:"Còn lại", operator:"Người thao tác",
    session:"Trạng thái lệnh", detail:"Chi tiết liên kết", empty:"Không có dữ liệu phù hợp",
    source:"Nguồn: MES feeder_binding_events", close:"Đóng", unverified:"Mã chưa xác minh",
  }
};

export function WmsMaterialLoading({ locale }: { locale: Locale }) {
  const tx = locale === "vi-VN" ? words.vi : locale === "en-US" ? words.en : words.zh;
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [summary, setSummary] = useState<Summary>({total:0,active:0,today:0,unverified:0,quantity:0,loading:0,released:0});
  const [filters, setFilters] = useState({search:"", workOrderCode:"", machineCode:"", status:"", from:"", to:""});
  const [applied, setApplied] = useState(filters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const data = await apiClient.get<{items:RecordRow[];total:number;summary:Summary}>(
        "/api/smt/loading/records", {...applied, limit:200}
      );
      setRows(data.items || []); setSummary(data.summary); setUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [applied]);

  useEffect(() => { load(); const id = window.setInterval(load, 15000); return () => window.clearInterval(id); }, [load]);
  const cards = useMemo(() => [
    [tx.total, summary.total, Database, "#2563eb"],
    [tx.active, summary.active, Activity, "#059669"],
    [tx.today, summary.today, Clock3, "#7c3aed"],
    [tx.loading, summary.loading, Boxes, "#d97706"],
    [tx.qty, Number(summary.quantity || 0).toLocaleString(), Boxes, "#0891b2"],
  ] as const, [summary, tx]);
  const field = (key: keyof typeof filters, placeholder:string) => (
    <input value={filters[key]} placeholder={placeholder} onChange={e=>setFilters(v=>({...v,[key]:e.target.value}))}
      onKeyDown={e=>{if(e.key==="Enter") setApplied(filters)}}
      style={{height:38,border:"1px solid #d7dde5",borderRadius:7,padding:"0 11px",fontSize:13,minWidth:0}} />
  );

  return <div style={{padding:"4px 24px 28px",color:"#172033"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,marginBottom:18}}>
      <div><h2 style={{margin:0,fontSize:22}}>{tx.title}</h2><div style={{fontSize:13,color:"#667085",marginTop:4}}>{tx.sub}</div></div>
      <button onClick={load} disabled={busy} style={{height:38,padding:"0 15px",border:0,borderRadius:7,background:"#175cd3",color:"#fff",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
        <RefreshCw size={15} className={busy?"spin":""}/>{tx.refresh}
      </button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(130px,1fr))",gap:12,marginBottom:14}}>
      {cards.map(([label,value,Icon,color])=><div key={label} style={{background:"#fff",border:"1px solid #e4e7ec",borderRadius:10,padding:"15px 16px",boxShadow:"0 1px 2px #1018280d"}}>
        <div style={{display:"flex",justifyContent:"space-between",color:"#667085",fontSize:12}}>{label}<Icon size={17} color={color}/></div>
        <div style={{fontSize:25,fontWeight:750,marginTop:7,color}}>{value}</div>
      </div>)}
    </div>
    <div style={{background:"#fff",border:"1px solid #e4e7ec",borderRadius:10,padding:14,marginBottom:14,display:"grid",gridTemplateColumns:"2fr 1fr 1fr 150px 145px 145px auto",gap:8}}>
      <div style={{position:"relative"}}><Search size={15} style={{position:"absolute",left:10,top:12,color:"#98a2b3"}}/>
        <input value={filters.search} placeholder={tx.search} onChange={e=>setFilters(v=>({...v,search:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")setApplied(filters)}}
          style={{height:38,width:"100%",boxSizing:"border-box",border:"1px solid #d7dde5",borderRadius:7,padding:"0 10px 0 32px",fontSize:13}}/>
      </div>
      {field("workOrderCode",tx.wo)}{field("machineCode",tx.machine)}
      <select value={filters.status} onChange={e=>setFilters(v=>({...v,status:e.target.value}))} style={{border:"1px solid #d7dde5",borderRadius:7,padding:"0 9px"}}>
        <option value="">{tx.all} {tx.status}</option><option value="active">Active</option><option value="replaced">Replaced</option><option value="unbound">Unbound</option>
      </select>
      <input type="date" title={tx.from} value={filters.from} onChange={e=>setFilters(v=>({...v,from:e.target.value}))} style={{border:"1px solid #d7dde5",borderRadius:7,padding:"0 8px"}}/>
      <input type="date" title={tx.to} value={filters.to} onChange={e=>setFilters(v=>({...v,to:e.target.value}))} style={{border:"1px solid #d7dde5",borderRadius:7,padding:"0 8px"}}/>
      <button onClick={()=>setApplied(filters)} style={{border:0,borderRadius:7,background:"#101828",color:"#fff",padding:"0 18px",fontWeight:700}}>{tx.search}</button>
    </div>
    {error && <div style={{padding:12,background:"#fef3f2",color:"#b42318",borderRadius:8,marginBottom:12}}>{error}</div>}
    <div style={{background:"#fff",border:"1px solid #e4e7ec",borderRadius:10,overflow:"hidden"}}>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,whiteSpace:"nowrap"}}>
        <thead><tr style={{background:"#f8fafc",color:"#475467"}}>
          {[tx.time,tx.wo,tx.machine,tx.slot,tx.feeder,tx.material,tx.sn,tx.lot,tx.quantity,tx.remaining,tx.operator,tx.status,tx.session].map(h=><th key={h} style={{padding:"11px 10px",textAlign:"left",fontWeight:700,borderBottom:"1px solid #e4e7ec"}}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.map(r=><tr key={r.id} onClick={()=>setSelected(r)} style={{borderBottom:"1px solid #f0f2f5",cursor:"pointer"}}>
          <td style={{padding:"10px",color:"#667085"}}>{r.boundAt ? new Date(r.boundAt).toLocaleString() : "-"}</td>
          <td style={{padding:"10px",fontWeight:700,color:"#175cd3"}}>{r.workOrderCode}</td><td style={{padding:"10px"}}>{r.machineCode}</td>
          <td style={{padding:"10px",fontWeight:700}}>{r.slotNo}</td><td style={{padding:"10px"}}>{r.feederCode}</td>
          <td style={{padding:"10px",color:r.materialCode==="UNVERIFIED"?"#b54708":"inherit"}}>{r.materialCode}{r.materialCode==="UNVERIFIED"&&<small style={{marginLeft:5}}>({tx.unverified})</small>}</td>
          <td style={{padding:"10px",fontFamily:"monospace",fontWeight:700}}>{r.materialSn}</td><td style={{padding:"10px"}}>{r.lotNo||"-"}</td>
          <td style={{padding:"10px",textAlign:"right",fontWeight:700}}>{Number(r.quantity||0).toLocaleString()}</td>
          <td style={{padding:"10px",textAlign:"right"}}>{Number(r.remainingQty||0).toLocaleString()}</td><td style={{padding:"10px"}}>{r.operator||"-"}</td>
          <td style={{padding:"10px"}}><span style={{padding:"3px 8px",borderRadius:99,background:r.status==="active"?"#dcfae6":"#f2f4f7",color:r.status==="active"?"#067647":"#475467"}}>{r.status}</span></td>
          <td style={{padding:"10px"}}>{r.sessionStatus||"-"}</td>
        </tr>)}</tbody>
      </table></div>
      {!busy&&rows.length===0&&<div style={{padding:50,textAlign:"center",color:"#98a2b3"}}>{tx.empty}</div>}
      <div style={{padding:"9px 13px",background:"#f8fafc",color:"#667085",fontSize:11,display:"flex",justifyContent:"space-between"}}><span>{tx.source}</span><span>{updated?.toLocaleTimeString()||""}</span></div>
    </div>
    {selected&&<div onClick={()=>setSelected(null)} style={{position:"fixed",inset:0,background:"#10182866",zIndex:1000,display:"flex",justifyContent:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:460,maxWidth:"92vw",height:"100%",background:"#fff",padding:24,boxSizing:"border-box",boxShadow:"-10px 0 30px #10182822"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h3>{tx.detail} #{selected.id}</h3><button onClick={()=>setSelected(null)} aria-label={tx.close} style={{border:0,background:"none"}}><X/></button></div>
        {Object.entries(selected).map(([k,v])=><div key={k} style={{display:"grid",gridTemplateColumns:"145px 1fr",gap:10,padding:"9px 0",borderBottom:"1px solid #f0f2f5",fontSize:13}}><b style={{color:"#667085"}}>{k}</b><span style={{wordBreak:"break-all"}}>{v==null?"-":String(v)}</span></div>)}
      </div>
    </div>}
  </div>;
}
