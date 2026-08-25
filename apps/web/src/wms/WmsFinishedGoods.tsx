import { useState, useEffect, useCallback } from "react";
import {
  Package, Truck, Search, Plus, X, CheckCircle, XCircle, Eye,
  FileText, MapPin, ClipboardCheck, RefreshCw
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface SnMaterialLotRecord {
  id: number; sn_no: string; material_lot_no: string; material_code: string;
  material_name: string; work_order_no: string; station_code: string;
  loaded_at: string; operator_id: string; qty_per_unit: number;
}
interface FinishedGood {
  id: number; sn_no: string; work_order_no: string; material_code: string;
  material_name: string; batch_code: string; production_date: string; qty: number;
  location_code: string; warehouse_zone: string; iqc_status: string;
  oqc_inspector: string; oqc_inspected_at: string; stored_at: string;
  stored_by: string; status: string; customer_code: string; customer_order_no: string;
}
interface OutboundOrder {
  id: number; outbound_no: string; customer_code: string; customer_name: string;
  customer_order_no: string; outbound_type: string; planned_date: string;
  actual_date: string; status: string; total_qty: number; operator_id: string;
  logistics_no: string; packing_operator: string; packing_time: string;
  shipping_method: string; destination: string;
}
interface OutboundItem {
  id: number; sn_no: string; material_code: string; batch_code: string;
  qty: number; pick_status: string;
}

type View = "finished" | "outbound" | "trace";

function statusBadge(s: string, locale: Locale) {
  const m: Record<string, { bg: string; text: string; label: string }> = {
    pending_oqc: { bg: "#f3f4f6", text: "#374151", label: locale === "vi-VN" ? "Cho OQC" : "Pending OQC" },
    in_production:{ bg: "#dbeafe", text: "#1e40af", label: locale === "vi-VN" ? "Dang SX" : "In Production" },
    in_stock:     { bg: "#d1fae5", text: "#065f46", label: locale === "vi-VN" ? "Kho" : "In Stock" },
    reserved:     { bg: "#fef3c7", text: "#92400e", label: locale === "vi-VN" ? "Da dat" : "Reserved" },
    shipped:      { bg: "#e0e7ff", text: "#3730a3", label: locale === "vi-VN" ? "Da xuat" : "Shipped" },
    scrapped:     { bg: "#fee2e2", text: "#991b1b", label: locale === "vi-VN" ? "Huy" : "Scrapped" },
  };
  const x = m[s] || { bg: "#f3f4f6", text: "#374151", label: s };
  return <span style={{ background: x.bg, color: x.text, padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>{x.label}</span>;
}

function oqcBadge(s: string, locale: Locale) {
  const x = s === "passed"
    ? { bg: "#d1fae5", text: "#065f46", label: locale === "vi-VN" ? "Dat" : "Pass" }
    : { bg: "#fee2e2", text: "#991b1b", label: locale === "vi-VN" ? "Khong dat" : "Fail" };
  return <span style={{ background: x.bg, color: x.text, padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>{x.label}</span>;
}

function outboundBadge(s: string, locale: Locale) {
  const m: Record<string, { bg: string; text: string; label: string }> = {
    pending:  { bg: "#f3f4f6", text: "#374151", label: locale === "vi-VN" ? "Cho" : "Pending" },
    picking:  { bg: "#dbeafe", text: "#1e40af", label: locale === "vi-VN" ? "Dang chon" : "Picking" },
    packed:   { bg: "#fef3c7", text: "#92400e", label: locale === "vi-VN" ? "Da dong" : "Packed" },
    shipped:  { bg: "#d1fae5", text: "#065f46", label: locale === "vi-VN" ? "Da xuat" : "Shipped" },
    cancelled:{ bg: "#fee2e2", text: "#991b1b", label: locale === "vi-VN" ? "Huy" : "Cancelled" },
  };
  const x = m[s] || m.pending;
  return <span style={{ background: x.bg, color: x.text, padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>{x.label}</span>;
}

export function WmsFinishedGoods({ locale }: { locale: Locale }) {
  const [view, setView] = useState<View>("finished");
  const [finished, setFinished] = useState<FinishedGood[]>([]);
  const [outbound, setOutbound] = useState<OutboundOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // SN Trace
  const [traceSn, setTraceSn] = useState("");
  const [traceResults, setTraceResults] = useState<SnMaterialLotRecord[]>([]);

  // Inbound form
  const [showInbound, setShowInbound] = useState(false);
  const [inboundForm, setInboundForm] = useState({
    sn_no: "", work_order_no: "", material_code: "", material_name: "",
    batch_code: "", production_date: new Date().toISOString().slice(0, 10),
    qty: "1", location_code: "", warehouse_zone: "", customer_code: "",
    customer_order_no: "", operator_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ok: boolean; msg: string} | null>(null);

  // Outbound form
  const [showOutbound, setShowOutbound] = useState(false);
  const [outboundForm, setOutboundForm] = useState({
    outbound_no: "", customer_code: "", customer_name: "", customer_order_no: "",
    outbound_type: "sales", planned_date: "", operator_id: "", destination: "",
  });
  const [selectedOutbound, setSelectedOutbound] = useState<(OutboundOrder & {items: OutboundItem[]}) | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [f, o] = await Promise.all([
        wmsApi.getFinishedGoods({ limit: 200 }),
        wmsApi.getOutboundOrders({ limit: 200 }),
      ]);
      setFinished(f.items || []);
      setOutbound(o.items || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const showFeedback = (ok: boolean, msg: string) => {
    setFeedback({ ok, msg });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleInbound = async () => {
    if (!inboundForm.sn_no || !inboundForm.work_order_no || !inboundForm.material_code) return;
    setSaving(true);
    try {
      await wmsApi.createFinishedGood({ ...inboundForm, qty: parseInt(inboundForm.qty) || 1 });
      setShowInbound(false);
      setInboundForm({ sn_no:"",work_order_no:"",material_code:"",material_name:"",batch_code:"",production_date:new Date().toISOString().slice(0,10),qty:"1",location_code:"",warehouse_zone:"",customer_code:"",customer_order_no:"",operator_id:"" });
      loadAll();
      showFeedback(true, locale === "vi-VN" ? "Da nhap kho" : locale === "en-US" ? "Stored" : "已入库");
    } catch(e: any) { showFeedback(false, e?.message || "Error"); }
    setSaving(false);
  };

  const handleOqc = async (id: number, passed: boolean) => {
    try {
      await wmsApi.oqcFinishedGood(id, {
        iqc_status: passed ? "passed" : "failed",
        oqc_inspector: inboundForm.operator_id || "OQC_USER",
      });
      loadAll();
      showFeedback(true, passed ? "OQC Passed" : "OQC Failed");
    } catch(e: any) { showFeedback(false, e?.message); }
  };

  const handleOutboundCreate = async () => {
    if (!outboundForm.outbound_no || !outboundForm.customer_code) return;
    setSaving(true);
    try {
      await wmsApi.createOutboundOrder(outboundForm);
      setShowOutbound(false);
      setOutboundForm({ outbound_no:"",customer_code:"",customer_name:"",customer_order_no:"",outbound_type:"sales",planned_date:"",operator_id:"",destination:"" });
      loadAll();
      showFeedback(true, "Outbound order created");
    } catch(e: any) { showFeedback(false, e?.message); }
    setSaving(false);
  };

  const handleShip = async (id: number) => {
    const logNo = prompt(locale === "vi-VN" ? "So van don" : locale === "en-US" ? "Tracking No." : "物流单号");
    if (!logNo) return;
    try {
      await wmsApi.shipOutboundOrder(id, { logistics_no: logNo });
      loadAll();
      showFeedback(true, locale === "vi-VN" ? "Da xuat hang" : locale === "en-US" ? "Shipped" : "已发货");
    } catch(e: any) { showFeedback(false, e?.message); }
  };

  const handleTrace = async () => {
    if (!traceSn.trim()) return;
    try {
      const res = await wmsApi.getSnMaterialLots(traceSn.trim());
      setTraceResults(res || []);
    } catch(e) { setTraceResults([]); }
  };

  return (
    <div style={{ padding: "0 24px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Package size={22} style={{ color: "#3b82f6" }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {locale === "vi-VN" ? "Thanh pham & Xuat hang" : locale === "en-US" ? "Finished Goods & Outbound" : "成品 & 出货"}
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setShowInbound(true)}
            style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
            <Plus size={14}/> {locale === "vi-VN" ? "Nhap kho" : locale === "en-US" ? "Inbound" : "入库"}
          </button>
          <button onClick={() => setShowOutbound(true)}
            style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
            <Truck size={14}/> {locale === "vi-VN" ? "Tao PX" : locale === "en-US" ? "New Outbound" : "新建出货"}
          </button>
        </div>
        {feedback && (
          <span style={{ marginLeft: 12, padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: feedback.ok ? "#d1fae5" : "#fee2e2", color: feedback.ok ? "#065f46" : "#991b1b" }}>
            {feedback.msg}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: 20 }}>
        {([
          { key: "finished" as View,  label: locale === "vi-VN" ? "Thanh pham" : locale === "en-US" ? "Finished Goods" : "成品库存" },
          { key: "outbound" as View,  label: locale === "vi-VN" ? "Xuat hang" : locale === "en-US" ? "Outbound" : "出货单" },
          { key: "trace" as View,     label: locale === "vi-VN" ? "Truy vet SN" : locale === "en-US" ? "SN Trace" : "SN追溯" },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)} style={{
            padding: "8px 20px", border: "none",
            borderBottom: view === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
            background: "none", cursor: "pointer",
            fontWeight: view === tab.key ? 700 : 400,
            color: view === tab.key ? "#3b82f6" : "#6b7280",
            fontSize: 14, marginBottom: -2,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading...</div> : (
        <>
          {/* FINISHED GOODS */}
          {view === "finished" && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                  {["SN","工单","产品型号","批次","生产日期","状态","OQC","库位","客户订单"].map((h, i) => (
                    <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {finished.map(fg => (
                  <tr key={fg.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8", fontWeight: 700 }}>{fg.sn_no}</td>
                    <td style={{ padding: "8px 12px", fontSize: 12 }}>{fg.work_order_no}</td>
                    <td style={{ padding: "8px 12px" }}>{fg.material_code}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280" }}>{fg.batch_code || "-"}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280" }}>{fg.production_date}</td>
                    <td style={{ padding: "8px 12px" }}>{statusBadge(fg.status, locale)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {fg.iqc_status === "pending"
                        ? fg.status === "pending_oqc" && <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => handleOqc(fg.id, true)} style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>Pass</button>
                            <button onClick={() => handleOqc(fg.id, false)} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>Fail</button>
                          </div>
                        : oqcBadge(fg.iqc_status, locale)}
                    </td>
                    <td style={{ padding: "8px 12px", color: "#6b7280", fontSize: 12 }}>{fg.location_code || "-"}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280", fontSize: 12 }}>{fg.customer_order_no || "-"}</td>
                  </tr>
                ))}
                {finished.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>No finished goods</td></tr>}
              </tbody>
            </table>
          )}

          {/* OUTBOUND */}
          {view === "outbound" && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                  {["出库单号","客户","订单号","类型","计划日","状态","数量","物流单号","操作"].map((h, i) => (
                    <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {outbound.map(ob => (
                  <tr key={ob.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8", fontWeight: 700 }}>{ob.outbound_no}</td>
                    <td style={{ padding: "8px 12px" }}>{ob.customer_name || ob.customer_code}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280", fontSize: 12 }}>{ob.customer_order_no || "-"}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280", fontSize: 12 }}>{ob.outbound_type}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280" }}>{ob.planned_date || "-"}</td>
                    <td style={{ padding: "8px 12px" }}>{outboundBadge(ob.status, locale)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>{ob.total_qty}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{ob.logistics_no || "-"}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {ob.status === "pending" || ob.status === "packed" ? (
                        <button onClick={() => handleShip(ob.id)} style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
                          {locale === "vi-VN" ? "Xuat hang" : locale === "en-US" ? "Ship" : "发货"}
                        </button>
                      ) : ob.status === "shipped" ? (
                        <span style={{ color: "#6b7280", fontSize: 12 }}>{ob.actual_date?.slice(0,10)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {outbound.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>No outbound orders</td></tr>}
              </tbody>
            </table>
          )}

          {/* SN TRACE */}
          {view === "trace" && (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                <input value={traceSn} onChange={e => setTraceSn(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleTrace()}
                  placeholder={locale === "vi-VN" ? "Nhap SN..." : locale === "en-US" ? "Enter SN..." : "输入 SN..."}
                  style={{ flex: 1, border: "2px solid #3b82f6", borderRadius: 8, padding: "10px 14px", fontSize: 15, fontFamily: "monospace" }} />
                <button onClick={handleTrace} style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  {locale === "vi-VN" ? "Truy vet" : locale === "en-US" ? "Trace" : "追溯"}
                </button>
              </div>
              {traceResults.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1d4ed8" }}>
                    {locale === "vi-VN" ? "Lich su vat tu cho SN" : locale === "en-US" ? "Material history for SN" : "SN 物料历史"}: {traceSn}
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                        {["物料批次号","物料编码","工位","上料时间","操作员","单件用量"].map((h, i) => (
                          <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {traceResults.map(r => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{r.material_lot_no}</td>
                          <td style={{ padding: "8px 12px" }}>{r.material_code}</td>
                          <td style={{ padding: "8px 12px" }}>{r.station_code}</td>
                          <td style={{ padding: "8px 12px", color: "#6b7280" }}>{r.loaded_at?.slice(0, 16)}</td>
                          <td style={{ padding: "8px 12px" }}>{r.operator_id}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.qty_per_unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {traceSn && traceResults.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>No trace results</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Inbound Modal */}
      {showInbound && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowInbound(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "90%", maxWidth: 580, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{locale === "vi-VN" ? "Nhap kho thanh pham" : locale === "en-US" ? "Finished Goods Inbound" : "成品入库"}</h3>
              <button onClick={() => setShowInbound(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { k: "sn_no", l: "SN *", req: true },
                { k: "work_order_no", l: locale === "vi-VN" ? "So DH *" : locale === "en-US" ? "Work Order *" : "工单号 *", req: true },
                { k: "material_code", l: locale === "vi-VN" ? "Ma SP *" : locale === "en-US" ? "Material Code *" : "产品型号 *", req: true },
                { k: "material_name", l: locale === "vi-VN" ? "Ten SP" : locale === "en-US" ? "Product Name" : "产品名称" },
                { k: "batch_code", l: locale === "vi-VN" ? "So lo" : locale === "en-US" ? "Batch Code" : "批次代码" },
                { k: "production_date", l: locale === "vi-VN" ? "Ngay SX" : locale === "en-US" ? "Production Date" : "生产日期" },
                { k: "qty", l: locale === "vi-VN" ? "So luong" : locale === "en-US" ? "Quantity" : "数量" },
                { k: "location_code", l: locale === "vi-VN" ? "Ma kho" : locale === "en-US" ? "Location" : "库位" },
                { k: "warehouse_zone", l: locale === "vi-VN" ? "Khu" : locale === "en-US" ? "Zone" : "库区" },
                { k: "customer_code", l: locale === "vi-VN" ? "Ma KH" : locale === "en-US" ? "Customer" : "客户" },
                { k: "customer_order_no", l: locale === "vi-VN" ? "So DH KH" : locale === "en-US" ? "Customer PO" : "客户订单号" },
                { k: "operator_id", l: locale === "vi-VN" ? "Nguoi nhap" : locale === "en-US" ? "Operator" : "操作员" },
              ].map(({ k, l }) => (
                <div key={k}>
                  <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{l}</label>
                  <input
                    type={k === "production_date" ? "date" : k === "qty" ? "number" : "text"}
                    value={(inboundForm as any)[k]} onChange={e => setInboundForm(p => ({ ...p, [k]: e.target.value }))}
                    style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setShowInbound(false)} style={{ padding: "8px 20px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>Cancel</button>
              <button onClick={handleInbound} disabled={saving} style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: saving ? "#9ca3af" : "#3b82f6", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {saving ? "..." : (locale === "vi-VN" ? "Nhap kho" : locale === "en-US" ? "Store" : "入库")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outbound Order Modal */}
      {showOutbound && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowOutbound(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "90%", maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{locale === "vi-VN" ? "Tao phieu xuat" : locale === "en-US" ? "New Outbound Order" : "新建出货单"}</h3>
              <button onClick={() => setShowOutbound(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { k: "outbound_no", l: locale === "vi-VN" ? "So PX *" : locale === "en-US" ? "Outbound No. *" : "出库单号 *", req: true },
                { k: "customer_code", l: locale === "vi-VN" ? "Ma KH *" : locale === "en-US" ? "Customer Code *" : "客户代码 *", req: true },
                { k: "customer_name", l: locale === "vi-VN" ? "Ten KH" : locale === "en-US" ? "Customer Name" : "客户名称" },
                { k: "customer_order_no", l: locale === "vi-VN" ? "So DH KH" : locale === "en-US" ? "Customer PO" : "客户订单号" },
                { k: "planned_date", l: locale === "vi-VN" ? "Ngay giao" : locale === "en-US" ? "Planned Date" : "计划发货日" },
                { k: "destination", l: locale === "vi-VN" ? "Dia chi" : locale === "en-US" ? "Destination" : "目的地址" },
              ].map(({ k, l }) => (
                <div key={k} style={k === "destination" ? { gridColumn: "1/-1" } : {}}>
                  <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{l}</label>
                  <input
                    type={k === "planned_date" ? "date" : "text"}
                    value={(outboundForm as any)[k]} onChange={e => setOutboundForm(p => ({ ...p, [k]: e.target.value }))}
                    style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setShowOutbound(false)} style={{ padding: "8px 20px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>Cancel</button>
              <button onClick={handleOutboundCreate} disabled={saving} style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: saving ? "#9ca3af" : "#10b981", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {saving ? "..." : (locale === "vi-VN" ? "Tao PX" : locale === "en-US" ? "Create" : "创建")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
