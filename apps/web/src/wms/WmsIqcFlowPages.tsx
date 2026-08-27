import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

export type IqcFlowPageKey =
  | "poReceipt" | "lineReturn" | "subcontractReturn" | "mrbReworkReturn"
  | "qrBinding" | "iqcPassMaintenance" | "defectArchive" | "mrbApproval"
  | "scrapFinanceApproval" | "reworkComplete" | "iqcReinspection";

type Row = Record<string, any>;
const pageInfo: Record<IqcFlowPageKey, { title: string; description: string; sourceType?: string }> = {
  poReceipt: { title: "PO采购到货", description: "收货后生成QR单据，绑定待检仓位并进入IQC。", sourceType: "PO_RECEIPT" },
  lineReturn: { title: "产线退料回仓", description: "产线退料收货后生成QR单据，进入IQC复检。", sourceType: "LINE_RETURN" },
  subcontractReturn: { title: "外协完工回厂", description: "外协加工完工收货后生成QR单据，进入IQC。", sourceType: "SUBCONTRACT_RETURN" },
  mrbReworkReturn: { title: "MRB返工修复回仓", description: "返工修复完成回仓，生成新QR单据并进入IQC复检。", sourceType: "REWORK_RETURN" },
  qrBinding: { title: "QR绑定仓库", description: "生成系统QR收货单，将物料批次绑定到指定待检仓位。" },
  iqcPassMaintenance: { title: "IQC合格结果维护", description: "维护IQC结果；合格后解除QR绑定并转入成品仓库。" },
  defectArchive: { title: "IQC不良品档案", description: "建立不良品档案，并记录从栈板移除。" },
  mrbApproval: { title: "MRB物料评审 / OA审批", description: "对不良品执行返工、报废或退货供应商的评审审批。" },
  scrapFinanceApproval: { title: "报废财务审批闭环", description: "财务审批报废金额；批准后由仓库执行报废并关闭库存台账。" },
  reworkComplete: { title: "返工修复完成回仓", description: "登记返工完成，生成新QR单据并等待IQC复检。" },
  iqcReinspection: { title: "IQC复检档案", description: "建立复检档案，完成PASS/FAIL判定；PASS后重新建立有效期记录。" },
};

function BackButton() {
  return <button type="button" className="btn btn-secondary" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign("/?view=wms")}>返回来源页面</button>;
}

function value(row: Row, ...keys: string[]) {
  const found = keys.map(key => row[key]).find(item => item !== undefined && item !== null && item !== "");
  return found === undefined ? "-" : String(found);
}

export function WmsIqcFlowPages({ page, locale: _locale }: { page: IqcFlowPageKey; locale: Locale }) {
  const info = pageInfo[page];
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ lotNo: "", quantity: "", location: "", warehouse: "IQC-PENDING", operator: "operator", lotId: "", defectId: "", qrDocumentNo: "", decision: "REWORK", result: "PASS" });
  const endpoint = useMemo(() => page === "defectArchive" ? "/quality/iqc-defect-cases" : page === "mrbApproval" ? "/quality/iqc-mrb-tasks" : page === "scrapFinanceApproval" ? "/quality/iqc-scrap-finance-approvals" : page === "iqcReinspection" ? "/quality/iqc-reinspections" : "/wms/receiving/qr-bindings", [page]);
  const load = useCallback(async () => {
    setError("");
    try { const response: any = await apiClient.get(endpoint); setRows(response.items ?? response.data ?? response ?? []); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const update = (key: keyof typeof form, next: string) => setForm(current => ({ ...current, [key]: next }));
  const submit = async (path: string, body: Row) => {
    setError(""); setMessage("");
    try { await apiClient.post(path, body); setMessage("操作成功，已进入下一流程"); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const field = (key: keyof typeof form, placeholder: string) => <input className="form-input" value={form[key]} placeholder={placeholder} onChange={event => update(key, event.target.value)} />;
  const sourceForm = ["poReceipt", "lineReturn", "subcontractReturn", "mrbReworkReturn", "qrBinding"].includes(page);
  return <div className="screen-stack"><section className="surface-panel"><div className="section-header"><div><h2>{info.title}</h2><p>{info.description}</p></div><BackButton /></div>
    {error && <p style={{ color: "var(--danger)" }}>{error}</p>}{message && <p style={{ color: "var(--ok)" }}>{message}</p>}
    {sourceForm && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("lotNo", "物料批次")}{field("quantity", "数量")}{field("location", "待检仓位")}{field("operator", "操作员")}<button className="btn btn-primary" onClick={() => void submit("/wms/receiving/qr-bindings", { lotNo: form.lotNo, quantity: Number(form.quantity), location: form.location, warehouse: form.warehouse, sourceType: info.sourceType || "PO_RECEIPT", operator: form.operator })}>收货并生成QR，进入IQC</button></div>}
    {page === "iqcPassMaintenance" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("lotId", "物料批次ID")}{field("operator", "检验员")}<select value={form.result} onChange={event => update("result", event.target.value)}><option value="PASS">PASS 合格</option><option value="FAIL">FAIL 不合格</option></select><button className="btn btn-primary" onClick={() => void submit(`/wms/receiving/qr-bindings/${form.lotId}/iqc-result`, { result: form.result, operator: form.operator })}>提交IQC结果</button></div>}
    {page === "defectArchive" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("operator", "移除人")}<button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-defect-cases/${form.defectId}/pallet-removal`, { operator: form.operator })}>建档并从栈板移除</button></div>}
    {page === "mrbApproval" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("operator", "评审人")}<select value={form.decision} onChange={event => update("decision", event.target.value)}><option value="REWORK">返工修复</option><option value="SCRAP">报废</option><option value="VENDOR_RETURN">退货供应商</option></select><button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-defect-cases/${form.defectId}/mrb`, { decision: form.decision, operator: form.operator })}>提交MRB / OA审批</button></div>}
    {page === "scrapFinanceApproval" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "财务审批ID")}{field("operator", "审批/执行人")}<select value={form.result} onChange={event => update("result", event.target.value)}><option value="APPROVED">财务批准</option><option value="REJECTED">财务拒绝</option></select><button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${form.defectId}/decision`, { decision: form.result, approver: form.operator })}>提交财务审批</button><button className="btn btn-secondary" onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${form.defectId}/execute`, { operator: form.operator })}>批准后执行报废</button></div>}
    {page === "reworkComplete" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("lotNo", "批次")}{field("quantity", "数量")}{field("location", "复检仓位")}{field("operator", "操作员")}<button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-defect-cases/${form.defectId}/rework-complete`, { operator: form.operator })}>确认返工完成</button><button className="btn btn-secondary" onClick={() => void submit("/wms/receiving/qr-bindings", { lotNo: form.lotNo, quantity: Number(form.quantity), location: form.location, warehouse: form.warehouse, sourceType: "REWORK_RETURN", operator: form.operator })}>生成新QR并进入复检</button></div>}
    {page === "iqcReinspection" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("qrDocumentNo", "返工QR单据号")}{field("operator", "复检员")}<button className="btn btn-primary" onClick={() => void submit("/quality/iqc-reinspections", { caseId: Number(form.defectId), qrDocumentNo: form.qrDocumentNo, operator: form.operator })}>建立复检档案</button></div>}
    <div className="table-shell" style={{ marginTop: 16 }}><table><thead><tr>{["ID", "单据/档案", "批次", "状态/来源", "数量/金额", "操作"].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6}>暂无记录</td></tr> : rows.map(row => <tr key={row.id}><td>{value(row, "id", "material_lot_id")}</td><td>{value(row, "document_no", "approval_no", "case_no", "task_no", "reinspection_no")}</td><td>{value(row, "lot_no")}</td><td>{value(row, "status", "source_type", "decision")}</td><td>{page === "scrapFinanceApproval" ? `${value(row, "scrap_qty")} / ${value(row, "scrap_amount")} ${value(row, "currency")}` : value(row, "quantity", "defective_qty")}</td><td>{page === "scrapFinanceApproval" && row.status === "PENDING_FINANCE_APPROVAL" && <><button onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${row.id}/decision`, { decision: "APPROVED", approver: form.operator })}>财务批准</button><button onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${row.id}/decision`, { decision: "REJECTED", approver: form.operator })}>拒绝</button></>}{page === "scrapFinanceApproval" && row.status === "FINANCE_APPROVED" && <button onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${row.id}/execute`, { operator: form.operator })}>执行报废</button>}{page === "iqcReinspection" && ["OPEN", "PENDING"].includes(String(row.status)) && <><button onClick={() => void submit(`/quality/iqc-reinspections/${row.id}/complete`, { result: "PASS", operator: form.operator })}>PASS</button><button onClick={() => void submit(`/quality/iqc-reinspections/${row.id}/complete`, { result: "FAIL", operator: form.operator })}>FAIL</button></>}{page === "defectArchive" && row.status === "PALLET_REMOVAL_PENDING" && <button onClick={() => void submit(`/quality/iqc-defect-cases/${row.id}/pallet-removal`, { operator: form.operator })}>从栈板移除</button>}</td></tr>)}</tbody></table></div>
  </section></div>;
}
