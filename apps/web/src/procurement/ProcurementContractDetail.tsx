import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { procurementApi, type ProcurementContract, type ContractApprovalTask, type ContractApprovalHistory } from "../api/procurement";

function toneForStatus(s: string): "ok" | "warning" | "danger" | "info" {
  if (s === "active" || s === "approved" || s === "fulfilled" || s === "paid" || s === "closed") return "ok";
  if (s === "rejected" || s === "terminated" || s === "voided") return "danger";
  if (s === "pending_approval" || s === "partially_fulfilled") return "warning";
  return "info";
}

function fmtCurrency(n: number | null | undefined, cur = "USD"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
}

export function ProcurementContractDetail({ locale, canManage, contractId, onBack }: { locale: Locale; canManage: boolean; contractId: number; onBack: () => void }) {
  const [contract, setContract] = useState<ProcurementContract | null>(null);
  const [tasks, setTasks] = useState<ContractApprovalTask[]>([]);
  const [history, setHistory] = useState<ContractApprovalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectReason, setRejectReason] = useState("");
  const [actioning, setActioning] = useState(false);

  useEffect(() => {
    Promise.all([
      procurementApi.getContract(contractId),
      procurementApi.getApprovals(contractId),
    ]).then(([c, a]) => {
      setContract(c);
      setTasks(a.data.tasks ?? []);
      setHistory(a.data.history ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [contractId]);

  const handleSubmit = async () => {
    setActioning(true);
    try {
      await procurementApi.submitContract(contractId);
      window.location.reload();
    } catch (e: any) { alert(e?.message ?? "Submit failed"); }
    setActioning(false);
  };

  const handleApprove = async () => {
    setActioning(true);
    try {
      await procurementApi.approveContract(contractId);
      window.location.reload();
    } catch (e: any) { alert(e?.message ?? "Approve failed"); }
    setActioning(false);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { alert("请输入拒绝原因"); return; }
    setActioning(true);
    try {
      await procurementApi.rejectContract(contractId, rejectReason);
      window.location.reload();
    } catch (e: any) { alert(e?.message ?? "Reject failed"); }
    setActioning(false);
  };

  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (!contract) return <div style={{ padding: 32, textAlign: "center" }}>Contract not found</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={onBack} style={{ padding: "4px 12px", cursor: "pointer" }}>{t("common.back", locale) ?? "返回"}</button>
      </div>
      <div className="surface-panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><strong>{t("procurement.contractNo", locale) ?? "合同号"}:</strong> {contract.contractNo}</div>
          <div><strong>{t("procurement.supplier", locale) ?? "供应商"}:</strong> {contract.supplierNameZh}</div>
          <div><strong>{t("procurement.title", locale) ?? "标题"}:</strong> {contract.title}</div>
          <div><strong>{t("procurement.contractType", locale) ?? "类型"}:</strong> {contract.contractType}</div>
          <div><strong>{t("procurement.totalValue", locale) ?? "金额"}:</strong> {fmtCurrency(contract.totalValue, contract.currencyCode)}</div>
          <div><strong>{t("procurement.paymentTerms", locale) ?? "付款条款"}:</strong> {contract.paymentTerms ?? "—"}</div>
          <div><strong>{t("procurement.deliveryTerms", locale) ?? "交货条款"}:</strong> {contract.deliveryTerms ?? "—"}</div>
          <div><strong>{t("procurement.warrantyMonths", locale) ?? "质保期"}:</strong> {contract.warrantyMonths} {t("common.months", locale) ?? "个月"}</div>
          <div><strong>{t("procurement.effectiveDate", locale) ?? "生效日期"}:</strong> {contract.effectiveDate}</div>
          <div><strong>{t("procurement.expiryDate", locale) ?? "到期日期"}:</strong> {contract.expiryDate}</div>
          <div>
            <strong>{t("common.status", locale) ?? "状态"}:</strong>{" "}
            <span className={"badge tone-" + toneForStatus(contract.status)}>{contract.status}</span>
          </div>
          <div><strong>{t("procurement.autoRenew", locale) ?? "自动续期"}:</strong> {contract.autoRenew ? "是" : "否"}</div>
        </div>
      </div>

      {/* Approval Workflow */}
      <div className="surface-panel" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>{t("procurement.approval.workflow", locale) ?? "审批流程"}</h3>
        {tasks.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>无审批步骤</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tasks.map(task => (
              <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 4 }}>
                <span style={{ fontWeight: 600, minWidth: 32 }}>Step {task.step}</span>
                <span>{task.approverRole}</span>
                <span className={"badge tone-" + (task.status === "approved" ? "ok" : task.status === "rejected" ? "danger" : "info")}>
                  {task.status}
                </span>
                {task.notes && <span style={{ color: "var(--muted)", fontSize: 12 }}>{task.notes}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Approval History */}
      {history.length > 0 && (
        <div className="surface-panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>{t("procurement.approval.history", locale) ?? "审批历史"}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map(h => (
              <div key={h.id} style={{ fontSize: 13, color: "var(--text)" }}>
                <span style={{ color: "var(--muted)" }}>{h.actedAt}</span> — {h.action} by {h.approverRole} {h.notes && `: "${h.notes}"`}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {canManage && (
        <div className="surface-panel" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {contract.status === "draft" && (
            <button type="button" onClick={handleSubmit} disabled={actioning} style={{ padding: "6px 16px", background: "var(--primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
              {t("procurement.btn.submit", locale) ?? "提交审批"}
            </button>
          )}
          {contract.status === "pending_approval" && (
            <>
              <button type="button" onClick={handleApprove} disabled={actioning} style={{ padding: "6px 16px", background: "var(--success, green)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                {t("procurement.btn.approve", locale) ?? "批准"}
              </button>
              <input
                type="text"
                placeholder={t("procurement.rejectReason", locale) ?? "拒绝原因"}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, flex: 1 }}
              />
              <button type="button" onClick={handleReject} disabled={actioning} style={{ padding: "6px 16px", background: "var(--danger, red)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                {t("procurement.btn.reject", locale) ?? "拒绝"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
