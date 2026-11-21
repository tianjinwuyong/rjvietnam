import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { procurementApi, type PoAdjustmentRequest, type PoClosure, type PoIncomingLogistics, type PurchaseOrderHeader } from "../api/procurement";
import { PoManagementEmployeeCommunication } from "./PoManagementEmployeeCommunication";
import { t } from "../i18n";

const gateLabels: Record<keyof PoClosure["gates"], string> = {
  supplierAcknowledged: "供应商已确认",
  receiptComplete: "WMS 已足量收货",
  iqcReleased: "IQC 已放行",
  threeWayMatch: "PO/收货/发票三单匹配",
  paymentSettled: "财务已结清"
};

export function ProcurementPoList({ locale, canManage = false }: { locale: Locale; canManage?: boolean }) {
  const [items, setItems] = useState<PurchaseOrderHeader[]>([]);
  const [selected, setSelected] = useState<PoClosure | null>(null);
  const [incoming, setIncoming] = useState<PoIncomingLogistics | null>(null);
  const [adjustments, setAdjustments] = useState<PoAdjustmentRequest[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([procurementApi.listPos({ limit: 200 }), procurementApi.listPoAdjustments()]).then(([p,a]) => { setItems(p.items ?? []); setAdjustments(a.items ?? []); });
  useEffect(() => { load(); }, []);
  const act = async (job: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMessage("");
    try { await job(); setMessage(ok); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const inspect = async (id: number) => {
    setBusy(true); setMessage("");
    try { const [closure, logistics] = await Promise.all([procurementApi.getPoClosure(id), procurementApi.getPoIncomingLogistics(id)]); setSelected(closure); setIncoming(logistics); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="screen-stack">
      <PoManagementEmployeeCommunication locale={locale} items={items} adjustments={adjustments} />
      {canManage && <div style={{ display:"flex",justifyContent:"flex-end" }}><button disabled={busy} onClick={() => act(() => procurementApi.runPurchasingEmployee(),t("poGuide.runComplete",locale))}>{t("poGuide.runNow",locale)}</button></div>}
      {message && <div className="surface-panel" style={{ padding: 12 }}>{message}</div>}
      <div className="surface-panel" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["PO号","供应商","下单日期","承诺日期","金额","状态","操作"].map(x => <th key={x} style={{ padding: 10, textAlign: "left", borderBottom: "1px solid var(--border)" }}>{x}</th>)}</tr></thead>
          <tbody>{items.map(po => (
            <tr key={po.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: 10 }}><strong>{po.poNo}</strong></td>
              <td style={{ padding: 10 }}>{po.supplierNameZh || po.supplierCode}</td>
              <td style={{ padding: 10 }}>{po.orderDate}</td><td style={{ padding: 10 }}>{po.promisedDate || "—"}</td>
              <td style={{ padding: 10 }}>{Number(po.totalAmount).toLocaleString()} {po.currencyCode}</td>
              <td style={{ padding: 10 }}><span className="badge tone-info">{po.status}</span></td>
              <td style={{ padding: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {canManage && po.status === "draft" && <button disabled={busy} onClick={() => act(() => procurementApi.sendPo(po.id), "PO 已发送供应商")}>发送</button>}
                {canManage && po.status === "sent" && <button disabled={busy} onClick={() => act(() => procurementApi.acknowledgePo(po.id), "供应商确认已记录")}>确认回签</button>}
                <button disabled={busy} onClick={() => inspect(po.id)}>闭环检查</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="surface-panel" style={{ padding: 16, overflowX: "auto" }}>
        <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 12 }}><div><strong>供应商 PO 调整审批</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>仅工厂采购管理可批准；WMS 按批准结果执行。</div></div><span className="badge tone-warning">{adjustments.filter(x => x.status === "PENDING").length} 待审批</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["申请号 / PO","供应商","调整项","当前值 → 建议值","原因","状态","采购审批"].map(x => <th key={x} style={{ padding: 10, textAlign: "left", borderBottom: "1px solid var(--border)" }}>{x}</th>)}</tr></thead><tbody>{adjustments.map(x => <tr key={x.request_no} style={{ borderBottom: "1px solid var(--border)" }}><td style={{ padding: 10 }}><b>{x.request_no}</b><br/><small>{x.po_no}</small></td><td style={{ padding: 10 }}>{x.supplier_name}<br/><small>{x.supplier_code}</small></td><td style={{ padding: 10 }}>{x.adjustment_type}{x.line_no ? ` · 行 ${x.line_no}` : ""}</td><td style={{ padding: 10 }}>{x.current_value || "—"} → <b>{x.proposed_value}</b></td><td style={{ padding: 10 }}>{x.reason}</td><td style={{ padding: 10 }}><span className="badge tone-info">{x.status}</span>{x.review_note && <><br/><small>{x.review_note}</small></>}</td><td style={{ padding: 10 }}>{canManage && x.status === "PENDING" ? <div style={{ display: "flex", gap: 6 }}><button disabled={busy} onClick={() => act(() => procurementApi.decidePoAdjustment(x,"APPROVED","采购批准"),"调整已批准并回传供应商")}>批准</button><button disabled={busy} onClick={() => { const reason=window.prompt("请输入驳回原因"); if(reason) void act(() => procurementApi.decidePoAdjustment(x,"REJECTED",reason),"调整已驳回并回传供应商"); }}>驳回</button></div> : "—"}</td></tr>)}</tbody></table>
        {!adjustments.length && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>暂无供应商 PO 调整申请</div>}
      </div>
      {selected && (
        <div className="surface-panel" style={{ padding: 16 }}>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <strong>{selected.po.poNo} · 采购关闭门禁</strong>
            <button onClick={() => setSelected(null)}>关闭面板</button>
          </div>
          <div className="metric-grid" style={{ marginTop: 12 }}>
            {(Object.keys(selected.gates) as Array<keyof PoClosure["gates"]>).map(key => (
              <div className="stat-card" key={key}>
                <span className="stat-label">{gateLabels[key]}</span>
                <strong className={selected.gates[key] ? "tone-ok" : "tone-danger"}>{selected.gates[key] ? "通过" : "阻塞"}</strong>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, color: "var(--muted)" }}>
            订购 {selected.metrics.orderedQty}；收货 {selected.metrics.receivedQty}；订单金额 {selected.metrics.orderedValue}；
            发票金额 {selected.metrics.invoiceValue}；未付 {selected.metrics.outstandingValue}
          </div>
          {canManage && <button style={{ marginTop: 12 }} disabled={busy || !selected.canClose} onClick={() => act(() => procurementApi.closePo(selected.po.id), "采购订单已闭环关闭")}>确认关闭采购订单</button>}
        </div>
      )}
      {selected && incoming && <div className="surface-panel" style={{ padding: 16 }}>
        <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 12 }}><div><strong>{t("poGuide.incomingTitle", locale)} · {incoming.poNo}</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>{t("poGuide.incomingHint", locale)}</div></div><span className="badge tone-info">ASN {incoming.shipments.length} · QR {incoming.qrCodes.length}</span></div>
        {!incoming.shipments.length ? <div role="alert" style={{ padding: 12, borderRadius: 8, background: "#fff7ed", color: "#9a3412" }}>{t("poGuide.noAsn", locale)}</div> : incoming.shipments.map(shipment => {
          const logistics=shipment.logisticsPayload||{}, pallets=Array.isArray(logistics.pallets)?logistics.pallets:[];
          return <div key={shipment.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}><strong>ASN {shipment.asn}</strong><span className="badge tone-info">{shipment.status}</span><span>ETA: {shipment.eta||"—"}</span><span>ATA: {shipment.ata||"—"}</span><span>{t("poGuide.carrier", locale)}: {logistics.carrierName||"—"}</span><span>{t("poGuide.vehicle", locale)}: {logistics.vehicleNo||"—"}</span></div>
            <div className="metric-grid" style={{ marginTop: 10 }}><div className="stat-card"><span className="stat-label">{t("poGuide.palletCount", locale)}</span><strong>{logistics.palletCount??pallets.length}</strong></div><div className="stat-card"><span className="stat-label">{t("poGuide.totalWeight", locale)}</span><strong>{logistics.totalWeightKg??0} kg</strong></div><div className="stat-card"><span className="stat-label">{t("poGuide.lines", locale)}</span><strong>{shipment.lines.length}</strong></div><div className="stat-card"><span className="stat-label">{t("poGuide.registeredQr", locale)}</span><strong>{incoming.qrCodes.length}</strong></div></div>
            {!pallets.length && <div role="alert" style={{ marginTop: 10, padding: 9, background: "#fff7ed", color: "#9a3412", borderRadius: 7 }}>{t("poGuide.missingPalletData", locale)}</div>}
            {!!pallets.length && <div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{[t("poGuide.palletQr",locale),"L × W × H (mm)",t("poGuide.weight",locale)].map(x=><th key={x} style={{ textAlign:"left",padding:8,borderBottom:"1px solid var(--border)" }}>{x}</th>)}</tr></thead><tbody>{pallets.map((p,index)=><tr key={p.palletQr||index}><td style={{padding:8,fontFamily:"monospace"}}>{p.palletQr||"—"}</td><td style={{padding:8}}>{p.lengthMm||"—"} × {p.widthMm||"—"} × {p.heightMm||"—"}</td><td style={{padding:8}}>{p.weightKg??"—"} kg</td></tr>)}</tbody></table></div>}
          </div>;
        })}
        <details><summary style={{ cursor:"pointer",fontWeight:800 }}>{t("poGuide.allQr", locale)} ({incoming.qrCodes.length})</summary><div style={{ maxHeight:320,overflow:"auto",marginTop:8 }}><table style={{ width:"100%",borderCollapse:"collapse" }}><thead><tr>{[t("poGuide.level",locale),t("poGuide.serial",locale),t("poGuide.qrValue",locale),t("poGuide.palletQr",locale),t("poGuide.scanStatus",locale)].map(x=><th key={x} style={{textAlign:"left",padding:8,borderBottom:"1px solid var(--border)"}}>{x}</th>)}</tr></thead><tbody>{incoming.qrCodes.map(q=><tr key={q.qrValue}><td style={{padding:8}}>{q.packageLevel}</td><td style={{padding:8}}>{q.serialNo}</td><td style={{padding:8,fontFamily:"monospace"}}>{q.qrValue}</td><td style={{padding:8,fontFamily:"monospace"}}>{q.palletQr||"—"}</td><td style={{padding:8}}>{q.receivingStatus}</td></tr>)}</tbody></table></div></details>
      </div>}
    </div>
  );
}
