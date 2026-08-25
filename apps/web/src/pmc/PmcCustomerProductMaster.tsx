import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

type Customer = {
  id: number; code: string; name: string; status: string;
  lifecycleStatus?: string; riskLevel?: string; contactName?: string;
  email?: string; phone?: string; paymentTermsDays?: number;
};
type Product = { id: number; code: string; nameZh?: string; nameEn?: string; revision?: string; status: string };

const lifecycleLabel: Record<string, string> = {
  DRAFT: "草稿", PENDING_APPROVAL: "待审批", ACTIVE: "已启用",
  ON_HOLD: "已冻结", REJECTED: "已拒绝", ARCHIVED: "已归档",
};

export function PmcCustomerProductMaster({ locale: _locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"customers" | "products">("customers");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("");
  const [customerForm, setCustomerForm] = useState({
    code: "", nameZh: "", nameEn: "", contactName: "", email: "", phone: "",
    paymentTermsDays: "30", riskLevel: "LOW",
  });
  const [productForm, setProductForm] = useState({ code: "", nameZh: "", nameEn: "", revision: "V1.0" });

  const load = useCallback(async () => {
    const [customerRes, productRes] = await Promise.all([pmcApi.getErpCustomers(), pmcApi.getErpProducts()]);
    setCustomers(customerRes.items);
    setProducts(productRes.items);
  }, []);

  useEffect(() => { load().catch((error) => setMessage(String(error))); }, [load]);

  const createCustomer = async (event: FormEvent) => {
    event.preventDefault();
    await pmcApi.createErpCustomer({
      ...customerForm,
      paymentTermsDays: Number(customerForm.paymentTermsDays),
    });
    setCustomerForm({ code: "", nameZh: "", nameEn: "", contactName: "", email: "", phone: "", paymentTermsDays: "30", riskLevel: "LOW" });
    setMessage("客户草稿已创建，请提交审批后启用。");
    await load();
  };

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    await pmcApi.createErpProduct(productForm);
    setProductForm({ code: "", nameZh: "", nameEn: "", revision: "V1.0" });
    setMessage("产品创建成功。");
    await load();
  };

  const transition = async (item: Customer, action: "submit" | "approve" | "reject" | "hold" | "reactivate" | "archive") => {
    const reason = action === "submit" ? "客户资料已核对" : window.prompt("请输入审批/操作原因")?.trim();
    if (!reason) return;
    await pmcApi.transitionErpCustomer(item.id, action, reason);
    setMessage(`${item.code}：客户状态已更新。`);
    await load();
  };

  const editCustomer = async (item: Customer) => {
    const nameZh = window.prompt("客户名称", item.name)?.trim();
    if (!nameZh) return;
    const contactName = window.prompt("联系人", item.contactName || "")?.trim() ?? "";
    await pmcApi.updateErpCustomer(item.id, { nameZh, nameEn: nameZh, contactName });
    setMessage("客户资料已更新，变更已记录。");
    await load();
  };

  const removeCustomer = async (item: Customer) => {
    if (!window.confirm(`确认删除从未使用的客户 ${item.code}？已发生交易的客户只能归档。`)) return;
    await pmcApi.deleteErpCustomer(item.id);
    setMessage("未使用客户已删除。");
    await load();
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>客户与产品主数据中心</h2>
            <p>客户建档、去重、审批、启用、冻结、归档和审计；只有已启用客户才能创建 PO。</p>
          </div>
        </div>
        <div className="toolbar">
          <button type="button" onClick={() => setTab("customers")}>客户管理</button>
          <button type="button" onClick={() => setTab("products")}>产品管理</button>
        </div>
        {message && <p style={{ padding: "0 16px" }}>{message}</p>}
      </section>

      {tab === "customers" ? <>
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3>新增客户草稿</h3>
          <form onSubmit={createCustomer} style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(180px,1fr))", gap: 12 }}>
            <input aria-label="客户代码" placeholder="客户代码" value={customerForm.code} onChange={(e) => setCustomerForm({ ...customerForm, code: e.target.value })} required />
            <input aria-label="客户中文名称" placeholder="客户中文名称" value={customerForm.nameZh} onChange={(e) => setCustomerForm({ ...customerForm, nameZh: e.target.value })} required />
            <input aria-label="客户英文名称" placeholder="客户英文名称" value={customerForm.nameEn} onChange={(e) => setCustomerForm({ ...customerForm, nameEn: e.target.value })} />
            <input aria-label="联系人" placeholder="联系人" value={customerForm.contactName} onChange={(e) => setCustomerForm({ ...customerForm, contactName: e.target.value })} />
            <input aria-label="电子邮箱" type="email" placeholder="电子邮箱" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} />
            <input aria-label="电话" placeholder="电话" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} />
            <label>账期（天）<input aria-label="账期" type="number" min="0" value={customerForm.paymentTermsDays} onChange={(e) => setCustomerForm({ ...customerForm, paymentTermsDays: e.target.value })} /></label>
            <label>风险等级<select aria-label="风险等级" value={customerForm.riskLevel} onChange={(e) => setCustomerForm({ ...customerForm, riskLevel: e.target.value })}>
              <option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option>
            </select></label>
            <button type="submit" className="action-button">创建客户草稿</button>
          </form>
        </section>
        <MasterTable headers={["代码", "客户", "联系人", "风险", "生命周期", "操作"]} rows={customers.map((item) => [
          item.code, item.name, item.contactName || "—", item.riskLevel || "LOW",
          lifecycleLabel[item.lifecycleStatus || "ACTIVE"] || item.lifecycleStatus || item.status,
          <span key={item.id} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={() => editCustomer(item).catch((e) => setMessage(String(e)))}>修改</button>
            {(item.lifecycleStatus === "DRAFT" || item.lifecycleStatus === "REJECTED") && <button type="button" onClick={() => transition(item, "submit").catch((e) => setMessage(String(e)))}>提交审批</button>}
            {item.lifecycleStatus === "PENDING_APPROVAL" && <>
              <button type="button" onClick={() => transition(item, "approve").catch((e) => setMessage(String(e)))}>批准启用</button>
              <button type="button" onClick={() => transition(item, "reject").catch((e) => setMessage(String(e)))}>拒绝</button>
            </>}
            {item.lifecycleStatus === "ACTIVE" && <button type="button" onClick={() => transition(item, "hold").catch((e) => setMessage(String(e)))}>冻结</button>}
            {item.lifecycleStatus === "ON_HOLD" && <button type="button" onClick={() => transition(item, "reactivate").catch((e) => setMessage(String(e)))}>恢复</button>}
            {!["ARCHIVED", "PENDING_APPROVAL"].includes(item.lifecycleStatus || "") && <button type="button" onClick={() => transition(item, "archive").catch((e) => setMessage(String(e)))}>归档</button>}
            <button type="button" onClick={() => removeCustomer(item).catch((e) => setMessage(String(e)))}>删除未使用</button>
          </span>,
        ])} />
      </> : <>
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3>新增产品</h3>
          <form onSubmit={createProduct} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input aria-label="产品代码" placeholder="产品代码/机型" value={productForm.code} onChange={(e) => setProductForm({ ...productForm, code: e.target.value })} required />
            <input aria-label="产品中文名称" placeholder="产品中文名称" value={productForm.nameZh} onChange={(e) => setProductForm({ ...productForm, nameZh: e.target.value })} required />
            <input aria-label="产品英文名称" placeholder="产品英文名称" value={productForm.nameEn} onChange={(e) => setProductForm({ ...productForm, nameEn: e.target.value })} />
            <input aria-label="产品版本" placeholder="版本" value={productForm.revision} onChange={(e) => setProductForm({ ...productForm, revision: e.target.value })} required />
            <button type="submit" className="action-button">新增产品</button>
          </form>
        </section>
        <MasterTable headers={["机型", "产品名称", "版本", "状态", "操作"]} rows={products.map((item) => [
          item.code, item.nameZh || item.nameEn || item.code, item.revision || "—", item.status,
          <span key={item.id} style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => pmcApi.setErpProductStatus(item.id, item.status === "active" ? "inactive" : "active").then(load).catch((e) => setMessage(String(e)))}>
              {item.status === "active" ? "停用" : "启用"}
            </button>
            <button type="button" onClick={() => pmcApi.deleteErpProduct(item.id).then(load).catch((e) => setMessage(String(e)))}>删除未使用</button>
          </span>,
        ])} />
      </>}
    </div>
  );
}

function MasterTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <section className="surface-panel"><div className="table-shell"><table>
    <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((cells, rowIndex) => <tr key={rowIndex}>{cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
  </table></div></section>;
}
// @ts-nocheck
