import { useEffect, useState } from "react";
import { Barcode, CheckCircle, History, PackageOpen, ShieldCheck } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi, type MaterialTrace } from "../api/wms";
import { WmsWorkOrderMaterialFlow, type WmsWorkOrderMaterialItem } from "./WmsWorkOrderMaterialFlow";
import { WmsMaterialRealtimeFlow } from "./WmsMaterialRealtimeFlow";

const copy = {
  "zh-CN": { title:"PDA 物料消耗与追溯", scan:"扫描物料/栈板二维码", find:"查询", wo:"工单 WO", station:"工站", qty:"实际使用数量", operator:"操作员", consume:"确认消耗", remain:"当前剩余", warehouse:"仓库", line:"线边", partial:"半箱 / 余料", used:"按工单已使用", moves:"移动与消耗历史", quality:"IQC 质量档案", none:"无记录" },
  "vi-VN": { title:"PDA tiêu hao & truy xuất vật liệu", scan:"Quét QR vật liệu/pallet", find:"Tra cứu", wo:"Lệnh SX WO", station:"Trạm", qty:"Số lượng thực dùng", operator:"Nhân viên", consume:"Xác nhận tiêu hao", remain:"Còn lại", warehouse:"Kho", line:"Bên chuyền", partial:"Thùng lẻ / vật liệu dư", used:"Đã dùng theo WO", moves:"Lịch sử di chuyển & tiêu hao", quality:"Hồ sơ IQC", none:"Không có dữ liệu" },
  "en-US": { title:"PDA Material Consumption & Trace", scan:"Scan material / pallet QR", find:"Search", wo:"Work order", station:"Station", qty:"Actual quantity used", operator:"Operator", consume:"Confirm consumption", remain:"Remaining", warehouse:"Warehouse", line:"Line side", partial:"Partial box / remainder", used:"Used by work order", moves:"Movement & consumption history", quality:"IQC quality file", none:"No records" },
};

export function WmsPdaConsumption({ locale }: { locale: Locale }) {
  const c=copy[locale]??copy["en-US"];
  const [qr,setQr]=useState(""); const [trace,setTrace]=useState<MaterialTrace|null>(null);
  const [wo,setWo]=useState(""); const [station,setStation]=useState(""); const [qty,setQty]=useState(""); const [operator,setOperator]=useState("VN_OP_001");
  const [busy,setBusy]=useState(false); const [binding,setBinding]=useState(false); const [boundReservation,setBoundReservation]=useState<number|null>(null); const [message,setMessage]=useState("");
  useEffect(() => {
    const onMaterialSelected = async (event: Event) => {
      const detail = (event as CustomEvent<WmsWorkOrderMaterialItem & { allocation?: { lotNo: string; qty: number } }>).detail;
      if (!detail?.allocation) return;
      setQr(detail.allocation.lotNo);
      setQty(String(detail.allocation.qty));
      setBoundReservation(null);
      try {
        const result = await wmsApi.getMaterialTrace(detail.allocation.lotNo);
        setTrace(result.data);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    };
    window.addEventListener("wms:work-order-material-selected", onMaterialSelected);
    return () => window.removeEventListener("wms:work-order-material-selected", onMaterialSelected);
  }, []);
  const load=async()=>{ if(!qr.trim())return; setBusy(true);setMessage("");setBoundReservation(null);try{const r=await wmsApi.getMaterialTrace(qr.trim());setTrace(r.data);}catch(e){setTrace(null);setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const bindWorkOrder=async()=>{
    if(!trace||!wo.trim()||Number(qty)<=0)return;
    setBinding(true);setMessage("");setBoundReservation(null);
    try {
      const recommendation=await wmsApi.getLotRecommendations(wo.trim(),trace.materialCode);
      const first=recommendation.items?.[0];
      if(!first) throw new Error("工单没有可用的 IQC 放行库存，不能绑定");
      if(String(first.lotNo)!==String(trace.lotNo)) throw new Error(`FIFO 拦截：应先使用 ${first.lotNo}（入库 ${first.receivedAt ? new Date(first.receivedAt).toLocaleString() : "更早"}），当前 ${trace.lotNo} 不能绑定`);
      if(Number(qty)>Number(first.availableQty)) throw new Error(`FIFO 拦截：最早批次仅剩 ${first.availableQty}，不能绑定 ${qty}`);
      const result=await wmsApi.reserveMaterial({lotNo:trace.lotNo,workOrderCode:wo.trim(),qty:Number(qty),operator});
      setBoundReservation(result.item.id);setMessage(`工单 ${wo.trim()} 已绑定批次 ${trace.lotNo}，FIFO 校验通过`);
    } catch(e) { setMessage(e instanceof Error?e.message:String(e)); }
    finally { setBinding(false); }
  };
  const consume=async()=>{if(!trace||!wo.trim()||Number(qty)<=0)return;setBusy(true);setMessage("");try{
    if(!boundReservation) throw new Error("请先绑定工单并完成 FIFO 校验");
    await wmsApi.postTransaction("CONSUME",{materialLotId:trace.id,qty:Number(qty),workOrderCode:wo.trim(),operator,reason:station.trim()?`STATION:${station.trim()}`:undefined});
    const r=await wmsApi.getMaterialTrace(qr.trim());setTrace(r.data);setQty("");setMessage("OK");
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <div className="screen-stack"><WmsMaterialRealtimeFlow locale={locale} materialCode={trace?.materialCode || ""} lotNo={trace?.lotNo || (trace ? qr : "")} boxQr={trace?.materialQr || (trace ? qr : "")} iqcStatus={trace?.quality?.iqcStatus || ""} locationCode={trace?.locationCode} approvalCount={trace?.quality?.specialApprovals.length || 0} inspectionCount={trace?.quality?.inspections.length || 0} /><WmsWorkOrderMaterialFlow locale={locale} workOrderCode={wo} onSelect={(item) => { if (item.bestLot?.lotNo) { setQr(item.bestLot.lotNo); setMessage(`FIFO 推荐批次 ${item.bestLot.lotNo}，请先扫描/查询后再绑定工单`); } else { setMessage(`物料 ${item.materialCode} 暂无可用 FIFO 批次，不能绑定`); } }} /><section className="surface-panel" style={{maxWidth:980,margin:"0 auto"}}>
    <div className="section-header"><div><h2><PackageOpen size={20}/> {c.title}</h2><p>{c.scan}</p></div></div>
    <div className="scan-input"><Barcode size={22}/><input autoFocus value={qr} onChange={e=>setQr(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder={c.scan}/><button className="action-button" onClick={load} disabled={busy}>{c.find}</button></div>
    {message&&<div style={{marginTop:10,color:message==="OK"?"var(--ok)":"var(--danger)"}}>{message==="OK"?<><CheckCircle size={16}/> OK</>:message}</div>}
    {trace&&<><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginTop:16}}>
      {[trace.materialCode,`${c.remain}: ${trace.remainingQty}`,`${c.warehouse}: ${trace.warehouseQty}`,`${c.line}: ${trace.lineSideQty}`,trace.isPartial?c.partial:trace.locationCode||"—"].map((x,i)=><div key={i} className="metric-card"><strong>{x}</strong></div>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginTop:16}}>
      <input value={wo} onChange={e=>{setWo(e.target.value.toUpperCase());setBoundReservation(null);}} placeholder={c.wo}/><input value={station} onChange={e=>setStation(e.target.value)} placeholder={c.station}/><input type="number" min="0" max={trace.lineSideQty} value={qty} onChange={e=>{setQty(e.target.value);setBoundReservation(null);}} placeholder={c.qty}/><input value={operator} onChange={e=>setOperator(e.target.value)} placeholder={c.operator}/>
    </div><div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}><button className="action-button" disabled={busy||binding||!wo||Number(qty)<=0} onClick={bindWorkOrder}>{binding?"FIFO 检查中…":boundReservation?`已绑定工单 (${boundReservation})`:"绑定工单 / FIFO 校验"}</button><button className="action-button" style={{background:"var(--ok)"}} disabled={busy||!boundReservation||Number(qty)<=0} onClick={consume}>{c.consume}</button></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:16,marginTop:20}}>
      <div><h3>{c.used}</h3>{trace.usedByWorkOrder.length?trace.usedByWorkOrder.map(x=><div key={x.workOrderCode}>{x.workOrderCode}: <strong>{x.usedQty}</strong></div>):c.none}</div>
      <div><h3><History size={16}/> {c.moves}</h3><div className="table-shell"><table><thead><tr><th>Time</th><th>Action</th><th>Qty</th><th>WO</th><th>Location</th></tr></thead><tbody>{trace.movements.map(x=><tr key={x.id}><td>{new Date(x.occurredAt).toLocaleString()}</td><td>{x.action}</td><td>{x.qty}</td><td>{x.workOrderCode||"—"}</td><td>{x.toLocation||x.fromLocation||"—"}</td></tr>)}</tbody></table></div></div>
    </div><div style={{marginTop:18}}><h3><ShieldCheck size={16}/> {c.quality}</h3><p>IQC: <strong>{trace.quality?.iqcStatus||"—"}</strong> · Inspections: {trace.quality?.inspections.length||0} · PDA: {trace.quality?.pdaInspections.length||0} · Approvals: {trace.quality?.specialApprovals.length||0} · Documents: {trace.quality?.documents.length||0}</p></div></>}
  </section></div>;
}
