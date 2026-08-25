import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type Dashboard = {
  summary: { active_materials: number; quarantined_receipts: number; pending_issues: number; overdue_loans: number; pending_handovers: number; waiting_closure: number };
  receipts: Array<any>; issues: Array<any>; loans: Array<any>; dispositions: Array<any>;
};
const labels = {
  "zh-CN": { title: "非 IQC 物料管理闭环", sub: "基础收货验证、异常隔离、用途领用、借还、成本归集和受控关单", material: "有效物料", quarantine: "隔离收货", issue: "待批领用", overdue: "超期借用", handover: "待接收交接", closing: "等待关单", receipts: "收货与隔离", issues: "领用申请", loans: "借出与归还", empty: "暂无数据", refresh: "刷新" },
  "en-US": { title: "Non-IQC Material Closed Loop", sub: "Receipt validation, quarantine, purpose-bound issue, loans, costing and controlled closure", material: "Active materials", quarantine: "Quarantined", issue: "Pending issues", overdue: "Overdue loans", handover: "Pending handovers", closing: "Waiting close", receipts: "Receipts and quarantine", issues: "Issue requests", loans: "Loans and returns", empty: "No data", refresh: "Refresh" },
  "vi-VN": { title: "Vòng kín vật liệu không IQC", sub: "Xác minh nhận hàng, cách ly, cấp phát theo mục đích, mượn trả, chi phí và đóng có kiểm soát", material: "Vật liệu hoạt động", quarantine: "Đang cách ly", issue: "Chờ duyệt cấp phát", overdue: "Mượn quá hạn", handover: "Chờ bàn giao", closing: "Chờ đóng", receipts: "Nhận hàng và cách ly", issues: "Yêu cầu cấp phát", loans: "Mượn và trả", empty: "Không có dữ liệu", refresh: "Làm mới" },
} as const;

export function WmsNonIqcClosedLoop({ locale }: { locale: Locale }) {
  const w = labels[locale], [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => { try { setData(await apiClient.get<Dashboard>("/api/wms/non-iqc/dashboard")); setError(""); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 15_000); return () => window.clearInterval(id); }, [load]);
  const metrics = [[w.material, data?.summary.active_materials ?? 0], [w.quarantine, data?.summary.quarantined_receipts ?? 0], [w.issue, data?.summary.pending_issues ?? 0], [w.overdue, data?.summary.overdue_loans ?? 0], [w.handover, data?.summary.pending_handovers ?? 0], [w.closing, data?.summary.waiting_closure ?? 0]];
  return <div className="screen-stack">
    <section className="surface-panel"><div className="section-header"><div><h2>{w.title}</h2><p>{w.sub}</p></div><button onClick={() => void load()}>{w.refresh}</button></div>{error && <p style={{ color: "#dc2626" }}>{error}</p>}<div className="metric-grid">{metrics.map(([name, value], index) => <div className="metric-card" key={String(name)} style={{ borderTop: `4px solid ${index === 1 || index === 3 ? "#dc2626" : "#2563eb"}` }}><span>{name}</span><strong>{value}</strong></div>)}</div></section>
    <section className="surface-panel"><h3>{w.receipts}</h3><div className="table-shell"><table><thead><tr><th>Receipt</th><th>PO / Supplier</th><th>Material / Lot</th><th>Qty</th><th>Six gates</th><th>Status</th><th>Received</th></tr></thead><tbody>{data?.receipts.length ? data.receipts.map(row => <tr key={row.id}><td>{row.receipt_no}</td><td>{row.purchase_order_code} / {row.supplier_code}</td><td>{row.material_code} / {row.supplier_lot_no || "-"}</td><td>{row.received_qty} {row.uom}</td><td>{[row.po_match,row.material_match,row.quantity_match,row.visual_pass,row.date_valid,row.documents_complete].filter(Boolean).length}/6</td><td>{row.status}</td><td>{new Date(row.received_at).toLocaleString()}</td></tr>) : <tr><td colSpan={7}>{w.empty}</td></tr>}</tbody></table></div></section>
    <section className="surface-panel"><h3>{w.issues}</h3><div className="table-shell"><table><thead><tr><th>Request</th><th>Material</th><th>Qty</th><th>Purpose</th><th>Cost center</th><th>Requester</th><th>Status</th></tr></thead><tbody>{data?.issues.length ? data.issues.map(row => <tr key={row.id}><td>{row.request_no}</td><td>{row.material_code}</td><td>{row.qty} {row.uom}</td><td>{row.purpose_type}: {row.purpose_ref}</td><td>{row.cost_center}</td><td>{row.requester}</td><td>{row.status}</td></tr>) : <tr><td colSpan={7}>{w.empty}</td></tr>}</tbody></table></div></section>
    <section className="surface-panel"><h3>{w.loans}</h3><div className="table-shell"><table><thead><tr><th>Loan</th><th>Item</th><th>Borrower</th><th>Due</th><th>Returned</th><th>Condition</th><th>Status</th></tr></thead><tbody>{data?.loans.length ? data.loans.map(row => <tr key={row.id}><td>{row.loan_no}</td><td>{row.item_identifier}</td><td>{row.borrower}</td><td>{new Date(row.expected_return_at).toLocaleString()}</td><td>{row.actual_return_at ? new Date(row.actual_return_at).toLocaleString() : "-"}</td><td>{row.return_condition || "-"}</td><td>{row.status}</td></tr>) : <tr><td colSpan={7}>{w.empty}</td></tr>}</tbody></table></div></section>
  </div>;
}
