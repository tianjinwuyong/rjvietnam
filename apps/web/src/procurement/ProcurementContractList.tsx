import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { procurementApi, type ProcurementContract } from "../api/procurement";

function toneForStatus(s: string): "ok" | "warning" | "danger" | "info" {
  if (s === "active" || s === "approved" || s === "fulfilled" || s === "paid" || s === "closed") return "ok";
  if (s === "rejected" || s === "terminated" || s === "voided") return "danger";
  if (s === "pending_approval" || s === "partially_fulfilled" || s === "partially_received") return "warning";
  return "info";
}

function fmtCurrency(n: number | null | undefined, cur = "USD"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
}

type StatusFilter = "all" | "draft" | "pending_approval" | "active" | "expired" | "rejected";

export function ProcurementContractList({ locale, canManage, onSelect }: { locale: Locale; canManage: boolean; onSelect: (id: number) => void }) {
  const [tab, setTab] = useState<StatusFilter>("all");
  const [items, setItems] = useState<ProcurementContract[]>([]);
  const [loading, setLoading] = useState(false);

  const tabs: StatusFilter[] = ["all", "draft", "pending_approval", "active", "expired", "rejected"];

  const load = () => {
    setLoading(true);
    const params = tab === "all" ? { limit: 200 } : { status: tab, limit: 200 };
    procurementApi.listContracts(params)
      .then(r => { setItems(r.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);

  const statusLabel = (s: StatusFilter) => {
    const map: Record<StatusFilter, string> = {
      all: t("common.all", locale) ?? "全部",
      draft: t("procurement.status.draft", locale) ?? "草稿",
      pending_approval: t("procurement.status.pending_approval", locale) ?? "待审批",
      active: t("procurement.status.active", locale) ?? "生效中",
      expired: t("procurement.status.expired", locale) ?? "已过期",
      rejected: t("procurement.status.rejected", locale) ?? "已拒绝",
    };
    return map[s];
  };

  return (
    <div>
      <div className="toolbar">
        {tabs.map(s => (
          <button key={s} type="button" className={tab === s ? "active" : ""} onClick={() => setTab(s)}>
            {statusLabel(s)}
          </button>
        ))}
      </div>
      <div className="surface-panel">
        {loading ? (
          <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>暂无数据</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.contractNo", locale) ?? "合同号"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.supplier", locale) ?? "供应商"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.title", locale) ?? "合同标题"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.contractType", locale) ?? "类型"}</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.totalValue", locale) ?? "合同金额"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.effectiveDate", locale) ?? "生效日期"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("procurement.expiryDate", locale) ?? "到期日期"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("common.status", locale) ?? "状态"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => onSelect(c.id)}>
                  <td style={{ padding: "8px 12px" }}><strong>{c.contractNo}</strong></td>
                  <td style={{ padding: "8px 12px" }}>{c.supplierNameZh ?? c.supplierCode}</td>
                  <td style={{ padding: "8px 12px" }}>{c.title}</td>
                  <td style={{ padding: "8px 12px" }}>{c.contractType}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}><strong>{fmtCurrency(c.totalValue, c.currencyCode)}</strong></td>
                  <td style={{ padding: "8px 12px" }}>{c.effectiveDate}</td>
                  <td style={{ padding: "8px 12px" }}>{c.expiryDate}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span className={"badge tone-" + toneForStatus(c.status)}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
