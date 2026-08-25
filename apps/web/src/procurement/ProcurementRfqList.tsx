import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { procurementApi, type ProcurementRfq, type ProcurementSupplier } from "../api/procurement";

export function ProcurementRfqList({ locale: _locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [items, setItems] = useState<ProcurementRfq[]>([]);
  const [suppliers, setSuppliers] = useState<ProcurementSupplier[]>([]);
  const [editing, setEditing] = useState<ProcurementRfq | null>(null);
  const [form, setForm] = useState({ supplierId: "", quoteNo: "", currency: "USD", leadDays: "7", unitPrice: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([procurementApi.listRfqs(), procurementApi.listSuppliers()]).then(([r, s]) => { setItems(r.items ?? []); setSuppliers(s.items ?? []); });
  useEffect(() => { load(); }, []);
  const act = async (job: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMessage("");
    try { await job(); setMessage(ok); setEditing(null); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const addQuote = () => {
    if (!editing) return;
    const supplier = suppliers.find(s => s.id === Number(form.supplierId));
    return act(() => procurementApi.addQuote(editing.id, {
      supplier_id: Number(form.supplierId), quote_no: form.quoteNo || undefined,
      currency_code: form.currency || supplier?.defaultCurrencyCode || "USD", lead_time_days: Number(form.leadDays),
      lines: editing.lines.map(line => ({ rfq_line_id: line.id, qty_quoted: Number(line.qtyRequested), unit_price: Number(form.unitPrice) }))
    }), "供应商报价已记录，可进行比价定标");
  };

  return (
    <div className="screen-stack">
      {message && <div className="surface-panel" style={{ padding: 12 }}>{message}</div>}
      <div className="surface-panel" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["RFQ号","来源申请","主题","物料","报价比较","状态","操作"].map(x => <th key={x} style={{ padding: 10, textAlign: "left", borderBottom: "1px solid var(--border)" }}>{x}</th>)}</tr></thead>
          <tbody>{items.map(rfq => (
            <tr key={rfq.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: 10 }}><strong>{rfq.rfqNo}</strong></td><td style={{ padding: 10 }}>{rfq.requisitionNo}</td>
              <td style={{ padding: 10 }}>{rfq.title}</td>
              <td style={{ padding: 10 }}>{rfq.lines?.map(l => <div key={l.id}>{l.materialCode} · {l.qtyRequested} {l.unit}</div>)}</td>
              <td style={{ padding: 10 }}>{rfq.quotes.map(q => <div key={q.id} style={{ marginBottom: 5 }}>
                {q.supplierName} · {Number(q.grandTotal).toLocaleString()} {q.currencyCode} · {q.leadTimeDays ?? "—"}天
                {canManage && rfq.status !== "awarded" && <button style={{ marginLeft: 6 }} disabled={busy} onClick={() => act(() => procurementApi.awardQuote(rfq.id, q.id), "已定标并自动生成采购订单")}>定标</button>}
              </div>)}</td>
              <td style={{ padding: 10 }}><span className="badge tone-info">{rfq.status}</span></td>
              <td style={{ padding: 10 }}>{canManage && ["sent","quotes_received","comparing"].includes(rfq.status) && <button disabled={busy} onClick={() => setEditing(rfq)}>录入报价</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {editing && <div className="surface-panel" style={{ padding: 16 }}>
        <strong>录入报价 · {editing.rfqNo}</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
          <select aria-label="供应商" value={form.supplierId} onChange={e => { const s = suppliers.find(x => x.id === Number(e.target.value)); setForm({ ...form, supplierId:e.target.value, currency:s?.defaultCurrencyCode || form.currency }); }}>
            <option value="">选择供应商</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.nameZh || s.nameEn}</option>)}
          </select>
          <input aria-label="报价单号" placeholder="报价单号" value={form.quoteNo} onChange={e => setForm({ ...form, quoteNo:e.target.value })} />
          <input aria-label="币种" value={form.currency} onChange={e => setForm({ ...form, currency:e.target.value })} />
          <input aria-label="交期天数" type="number" min="0" value={form.leadDays} onChange={e => setForm({ ...form, leadDays:e.target.value })} />
          <input aria-label="统一单价" type="number" min="0" placeholder="本次各行统一单价" value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice:e.target.value })} />
          <button disabled={busy || !form.supplierId || form.unitPrice === ""} onClick={addQuote}>保存供应商报价</button>
          <button onClick={() => setEditing(null)}>取消</button>
        </div>
      </div>}
    </div>
  );
}
