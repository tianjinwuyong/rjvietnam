import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { procurementApi, type PurchaseRequisition } from "../api/procurement";

export function ProcurementRequisitionList({ locale: _locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [items, setItems] = useState<PurchaseRequisition[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ department: "PMC", reason: "", urgency: "normal", targetDate: "", materialCode: "", qty: "1", unit: "PCS", targetCost: "" });

  const load = () => procurementApi.listRequisitions().then(r => setItems(r.items ?? [])).catch(e => setMessage(String(e)));
  useEffect(() => { load(); }, []);

  const act = async (job: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMessage("");
    try { await job(); setMessage(ok); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const create = () => act(async () => {
    await procurementApi.createRequisition({
      department: form.department, reason: form.reason, urgency: form.urgency,
      target_date: form.targetDate || undefined,
      lines: [{ material_code: form.materialCode, qty_requested: Number(form.qty), unit: form.unit, target_unit_cost: form.targetCost ? Number(form.targetCost) : undefined }]
    });
    setShowCreate(false);
  }, "采购申请已建立并保留审计记录");

  return (
    <div className="screen-stack">
      <div className="surface-panel" style={{ padding: 16 }}>
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <div><strong>采购申请（PR）</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>内部需求 → 提交 → 询价</div></div>
          {canManage && <button type="button" className="active" onClick={() => setShowCreate(v => !v)}>新建采购申请</button>}
        </div>
        {showCreate && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 14 }}>
            <input aria-label="申请部门" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="申请部门" />
            <input aria-label="采购原因" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="采购原因" />
            <select aria-label="紧急程度" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
              <option value="normal">正常</option><option value="urgent">紧急</option><option value="critical">特急</option><option value="low">低</option>
            </select>
            <input aria-label="目标日期" type="date" value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} />
            <input aria-label="物料编码" value={form.materialCode} onChange={e => setForm({ ...form, materialCode: e.target.value })} placeholder="物料编码" />
            <input aria-label="数量" type="number" min="0.0001" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
            <input aria-label="单位" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
            <input aria-label="目标单价" type="number" min="0" value={form.targetCost} onChange={e => setForm({ ...form, targetCost: e.target.value })} placeholder="目标单价（可选）" />
            <button type="button" disabled={busy || !form.reason || !form.materialCode || Number(form.qty) <= 0} onClick={create}>保存草稿</button>
          </div>
        )}
        {message && <div style={{ marginTop: 10, color: message.includes("已") ? "var(--success)" : "var(--danger)" }}>{message}</div>}
      </div>
      <div className="surface-panel" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["申请号","部门/原因","物料需求","紧急度","目标日期","状态","操作"].map(x => <th key={x} style={{ padding: 10, textAlign: "left", borderBottom: "1px solid var(--border)" }}>{x}</th>)}</tr></thead>
          <tbody>{items.map(pr => (
            <tr key={pr.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: 10 }}><strong>{pr.requisitionNo}</strong><div style={{ fontSize: 11, color: "var(--muted)" }}>{pr.requesterName}</div></td>
              <td style={{ padding: 10 }}>{pr.department}<div style={{ fontSize: 12 }}>{pr.reason}</div></td>
              <td style={{ padding: 10 }}>{pr.lines.map(l => <div key={l.id}>{l.materialCode} · {l.qtyRequested} {l.unit}</div>)}</td>
              <td style={{ padding: 10 }}>{pr.urgency}</td><td style={{ padding: 10 }}>{pr.targetDate || "—"}</td>
              <td style={{ padding: 10 }}><span className="badge tone-info">{pr.status}</span></td>
              <td style={{ padding: 10 }}>
                {canManage && pr.status === "draft" && <button disabled={busy} onClick={() => act(() => procurementApi.submitRequisition(pr.id), "采购申请已提交")}>提交</button>}
                {canManage && pr.status === "submitted" && <button disabled={busy} onClick={() => act(() => procurementApi.createRfq(pr.id), "RFQ 已生成并发出")}>生成 RFQ</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
