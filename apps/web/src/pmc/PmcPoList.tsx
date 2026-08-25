import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi, type CustomerPo } from "../api";

type EnrichedPo = CustomerPo & { productCode?: string; woCode?: string };
type CustomerOption = { id: number; code: string; name: string; status: string; lifecycleStatus?: string };
type ProductOption = { id: number; code: string; nameZh?: string; nameEn?: string; status: string };

function risk(dueDate: string) {
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
  return days <= 3 ? "高" : days <= 7 ? "中" : "低";
}

export function PmcPoList({ locale: _locale }: { locale: Locale }) {
  const [pos, setPos] = useState<EnrichedPo[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<EnrichedPo | null>(null);
  const [closure, setClosure] = useState<Awaited<ReturnType<typeof pmcApi.getCustomerPoClosure>> | null>(null);
  const [form, setForm] = useState({
    poNumber: "", customerId: "", productId: "", orderQty: "1",
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    const [poRes, woRes, customerRes, productRes] = await Promise.all([
      pmcApi.getCustomerPos(), pmcApi.getWorkOrders({ limit: 200 }),
      pmcApi.getErpCustomers(), pmcApi.getErpProducts(),
    ]);
    setPos(poRes.items.map((po) => {
      const wo = woRes.items.find((item) => item.poNumber === po.poNumber);
      return { ...po, productCode: wo?.productCode, woCode: wo?.code };
    }));
    setCustomers(customerRes.items.filter((item) => item.status === "active" && (!item.lifecycleStatus || item.lifecycleStatus === "ACTIVE")));
    setProducts(productRes.items.filter((item) => item.status === "active"));
  }, []);

  useEffect(() => { load().catch((error) => setMessage(String(error))); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    await pmcApi.createCustomerPo({
      poNumber: form.poNumber.trim(), customerId: Number(form.customerId),
      productId: Number(form.productId), orderQty: Number(form.orderQty), dueDate: form.dueDate,
    });
    setMessage(`客户 PO ${form.poNumber} 创建成功。`);
    setShowCreate(false);
    setForm((value) => ({ ...value, poNumber: "", orderQty: "1" }));
    await load();
  };

  const inspect = async (po: EnrichedPo) => {
    setSelected(po);
    setClosure(await pmcApi.getCustomerPoClosure(po.id));
  };

  const accept = async () => {
    if (!selected) return;
    const reason = window.prompt("客户验收说明（必填）")?.trim();
    const evidenceRef = window.prompt("验收证据编号或文件（必填）")?.trim();
    if (!reason || !evidenceRef) return;
    await pmcApi.decideCustomerPoClosureGate(selected.id, { gateCode: "CUSTOMER_ACCEPTED", result: "PASS", reason, evidenceRef });
    setClosure(await pmcApi.getCustomerPoClosure(selected.id));
  };

  const close = async () => {
    if (!selected || !closure?.readyToClose) return;
    if (!window.confirm(`确认关闭 PO ${selected.poNumber}？关闭后不可修改。`)) return;
    await pmcApi.closeCustomerPo(selected.id);
    setMessage(`PO ${selected.poNumber} 已闭环关闭。`);
    setClosure(await pmcApi.getCustomerPoClosure(selected.id));
    await load();
  };

  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header">
        <div><h2>客户 PO 管理</h2><p>从已审批客户和已启用产品创建 PO，并完成工单、生产、出货、财务和验收闭环。</p></div>
        <button type="button" className="action-button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "取消" : "创建客户 PO"}
        </button>
      </div>
      {message && <p style={{ padding: "0 16px" }}>{message}</p>}
      {showCreate && <form aria-label="创建客户 PO" onSubmit={create} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(2,minmax(220px,1fr))", gap: 12 }}>
        <label>客户 PO 号<input name="poNumber" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} required /></label>
        <label>客户<select name="customerId" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} required>
          <option value="">请选择已审批客户</option>
          {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>产品<select name="productId" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required>
          <option value="">请选择已启用产品</option>
          {products.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
        </select></label>
        <label>数量<input name="orderQty" type="number" min="1" value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} required /></label>
        <label>交付日期<input name="dueDate" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required /></label>
        <button type="submit" className="action-button">确认创建 PO</button>
      </form>}
    </section>

    <section className="surface-panel"><div className="table-shell"><table>
      <thead><tr><th>PO</th><th>客户</th><th>产品</th><th>数量</th><th>交期</th><th>风险</th><th>工单/闭环</th></tr></thead>
      <tbody>{pos.map((po) => <tr key={po.id}>
        <td><strong>{po.poNumber}</strong></td><td>{po.customerName}</td><td>{po.productCode || "—"}</td>
        <td>{po.orderQty}</td><td>{String(po.dueDate).slice(0, 10)}</td><td>{risk(po.dueDate)}</td>
        <td>{po.woCode || "待创建工单"} <button type="button" onClick={() => inspect(po).catch((error) => setMessage(String(error)))}>闭环检查</button></td>
      </tr>)}</tbody>
    </table></div></section>

    {selected && closure && <section className="surface-panel" style={{ padding: 16 }}>
      <div className="section-header"><div><h2>PO 闭环控制 · {selected.poNumber}</h2><p>六个门禁全部通过后才能永久关闭。</p></div>
        <strong>{closure.readyToClose ? "可关闭" : "禁止关闭"}</strong></div>
      <div className="table-shell"><table>
        <thead><tr><th>门禁</th><th>状态</th><th>来源</th><th>依据</th><th>操作</th></tr></thead>
        <tbody>{closure.gates.map((gate) => <tr key={gate.gateCode}>
          <td>{gate.gateCode}</td><td>{gate.status}</td><td>{gate.source}</td><td>{gate.detail}</td>
          <td>{gate.gateCode === "CUSTOMER_ACCEPTED" && gate.status !== "PASS"
            ? <button type="button" onClick={() => accept().catch((error) => setMessage(String(error)))}>提交验收证据</button>
            : gate.status === "PASS" ? "已通过" : "等待系统记录"}</td>
        </tr>)}</tbody>
      </table></div>
      <button type="button" disabled={!closure.readyToClose || closure.po.status === "closed"} onClick={() => close().catch((error) => setMessage(String(error)))}>
        {closure.po.status === "closed" ? "PO 已关闭" : "确认闭环并关闭 PO"}
      </button>
    </section>}
  </div>;
}
