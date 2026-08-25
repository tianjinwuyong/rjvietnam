import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { einvoiceApi, type EinvoiceInvoice } from "../api/einvoice";

function toneForStatus(s: string): "ok" | "warning" | "danger" | "info" {
  if (s === "published") return "ok";
  if (s === "cancelled" || s === "voided") return "danger";
  if (s === "draft") return "info";
  return "warning";
}

function fmtCurrency(n: number | null | undefined, cur = "VND"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " " + cur;
}

type StatusFilter = "all" | "published" | "cancelled" | "draft";

export function EinvoiceInvoiceList({ locale, onSelect }: { locale: Locale; onSelect: (id: number) => void }) {
  const [tab, setTab] = useState<StatusFilter>("all");
  const [items, setItems] = useState<EinvoiceInvoice[]>([]);
  const [loading, setLoading] = useState(false);

  const tabs: StatusFilter[] = ["all", "published", "cancelled", "draft"];

  const load = () => {
    setLoading(true);
    const params = tab === "all" ? { limit: 200 } : { status: tab, limit: 200 };
    einvoiceApi.listInvoices(params)
      .then(r => { setItems(r.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);

  const statusLabel = (s: StatusFilter) => {
    const map: Record<StatusFilter, string> = {
      all: t("common.all", locale) ?? "全部",
      published: t("einvoice.status.published", locale) ?? "已签发",
      cancelled: t("einvoice.status.cancelled", locale) ?? "已作废",
      draft: t("einvoice.status.draft", locale) ?? "草稿",
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
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.invoiceNo", locale) ?? "发票号"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.einvoiceReference", locale) ?? "电子发票号"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.buyerName", locale) ?? "买方"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.issueDate", locale) ?? "开票日期"}</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.totalAmount", locale) ?? "金额"}</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.vatAmount", locale) ?? "税额"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("einvoice.currency", locale) ?? "币种"}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("common.status", locale) ?? "状态"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(inv => (
                <tr key={inv.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => onSelect(inv.id)}>
                  <td style={{ padding: "8px 12px" }}><strong>{inv.invoiceNo}</strong></td>
                  <td style={{ padding: "8px 12px" }}>{inv.einvoiceReference ?? "—"}</td>
                  <td style={{ padding: "8px 12px" }}>{inv.buyerName ?? "—"}</td>
                  <td style={{ padding: "8px 12px" }}>{inv.issueDate}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}><strong>{fmtCurrency(inv.totalAmount, inv.currencyCode)}</strong></td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtCurrency(inv.vatAmount, inv.currencyCode)}</td>
                  <td style={{ padding: "8px 12px" }}>{inv.currencyCode}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span className={"badge tone-" + toneForStatus(inv.status)}>{inv.status}</span>
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
