import { useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi, type BomReconciliationGate, type BomReconciliationLine } from "../api/mes";

const copy = {
  "zh-CN": { title:"BOM 全流程核销", hint:"输入工单数据库 ID，核对从上料到包装的每一个 BOM 项目。全部精确一致后才允许绑定成品。", query:"查询", init:"冻结工单 BOM", allowed:"允许绑定成品", blocked:"禁止绑定成品", material:"物料", required:"BOM 标准数量", used:"已核销", remaining:"剩余", naming:"命名版本", state:"状态", exact:"一致", mismatch:"不一致", empty:"暂无核销项目", error:"读取失败" },
  "en-US": { title:"BOM Reconciliation", hint:"Enter the work-order database ID. Product binding is allowed only after every BOM line is reconciled exactly from loading through packaging.", query:"Query", init:"Freeze WO BOM", allowed:"Product binding allowed", blocked:"Product binding blocked", material:"Material", required:"BOM required", used:"Written off", remaining:"Remaining", naming:"Naming version", state:"Status", exact:"Exact", mismatch:"Mismatch", empty:"No reconciliation lines", error:"Load failed" },
  "vi-VN": { title:"Đối soát BOM", hint:"Nhập ID lệnh sản xuất. Chỉ cho phép liên kết thành phẩm khi mọi dòng BOM được đối soát chính xác từ cấp liệu đến đóng gói.", query:"Tra cứu", init:"Khóa BOM lệnh SX", allowed:"Cho phép liên kết thành phẩm", blocked:"Chặn liên kết thành phẩm", material:"Vật tư", required:"SL BOM", used:"Đã quyết toán", remaining:"Còn lại", naming:"Phiên bản tên", state:"Trạng thái", exact:"Khớp", mismatch:"Không khớp", empty:"Chưa có dòng đối soát", error:"Không thể tải" },
} as const;

export function BomReconciliation({ locale }: { locale: Locale }) {
  const c=copy[locale];
  const [workOrderId,setWorkOrderId]=useState("");
  const [gate,setGate]=useState<BomReconciliationGate|null>(null);
  const [lines,setLines]=useState<BomReconciliationLine[]>([]);
  const [message,setMessage]=useState("");
  const load=async()=>{try{setMessage("");const r=await mesApi.getBomReconciliation(workOrderId);setGate(r.gate);setLines(r.lines);}catch(e){setMessage(e instanceof Error?e.message:c.error);}};
  const initialize=async()=>{try{await mesApi.initializeBomReconciliation(workOrderId);await load();}catch(e){setMessage(e instanceof Error?e.message:c.error);}};
  return <div className="screen-stack">
    <section className="surface-panel" style={{padding:20}}>
      <div className="section-header"><div><h2>{c.title}</h2><p>{c.hint}</p></div></div>
      <div className="toolbar" style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <input value={workOrderId} onChange={e=>setWorkOrderId(e.target.value.replace(/\D/g,""))} placeholder="Work order ID" style={{minWidth:220}} />
        <button type="button" onClick={load} disabled={!workOrderId}>{c.query}</button>
        <button type="button" onClick={initialize} disabled={!workOrderId}>{c.init}</button>
        {gate&&<span className={`badge badge-${gate.product_binding_allowed?"success":"danger"}`} style={{padding:"8px 12px"}}>{gate.product_binding_allowed?c.allowed:c.blocked}</span>}
      </div>
      {message&&<p style={{color:"var(--danger)",marginTop:12}}>{message}</p>}
    </section>
    {gate&&<section className="surface-panel" style={{padding:16}}>
      <div style={{display:"flex",gap:24,flexWrap:"wrap",marginBottom:12}}>
        <strong>{gate.work_order_code}</strong><span>BOM {gate.bom_revision}</span>
        <span>{gate.reconciled_line_count}/{gate.bom_line_count}</span><span>{c.remaining}: {gate.total_remaining_qty}</span>
      </div>
      <div className="table-shell"><table><thead><tr><th>{c.material}</th><th>{c.required}</th><th>{c.used}</th><th>{c.remaining}</th><th>{c.naming}</th><th>{c.state}</th></tr></thead>
        <tbody>{lines.length?lines.map(x=><tr key={x.bom_line_id}><td><strong>{x.material_code}</strong><br/><small>{locale==="en-US"?x.materialNameEn:locale==="vi-VN"?x.materialNameVi:x.material_name}</small></td><td>{x.required_qty}</td><td>{x.written_off_qty}</td><td>{x.remaining_qty}</td><td>{x.naming_version_matches?c.exact:c.mismatch}</td><td><span className={`badge badge-${x.fully_reconciled&&x.naming_version_matches?"success":"danger"}`}>{x.fully_reconciled&&x.naming_version_matches?c.exact:c.mismatch}</span></td></tr>):<tr><td colSpan={6}>{c.empty}</td></tr>}</tbody>
      </table></div>
    </section>}
  </div>;
}
