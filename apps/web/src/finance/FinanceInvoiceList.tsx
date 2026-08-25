import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { financeApi, type ArInvoice, type ApInvoice } from "../api/finance";

type Inv = ArInvoice | ApInvoice;

function toneForStatus(s: string): "ok" | "warning" | "danger" | "info" {
  if (s === "paid" || s === "closed") return "ok";
  if (s === "overdue" || s === "voided") return "danger";
  if (s === "partial") return "warning";
  return "info";
}

function fmtCurrency(n: number | null | undefined, cur = "USD"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
}

export function FinanceInvoiceList({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [tab, setTab] = useState<"AR" | "AP">("AR");
  const [items, setItems] = useState<Inv[]>([]);
  const [loading, setLoading] = useState(false);

  const loadInvoices = () => {
    setLoading(true);
    const fetch = tab === "AR" ? financeApi.listArInvoices({ limit: 200 }) : financeApi.listApInvoices({ limit: 200 });
    fetch.then(r => {
      setItems(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadInvoices(); }, [tab]);

  const handlePost = async (id: number) => {
    try {
      if (tab === "AR") await financeApi.postArInvoice(id);
      else await financeApi.postApInvoice(id);
      loadInvoices();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? "Post failed");
    }
  };

  return (
    <div>
      <div className="toolbar">
        <button type="button" className={tab === "AR" ? "active" : ""} onClick={() => setTab("AR")}>{t("finance.tab.ar", locale)}</button>
        <button type="button" className={tab === "AP" ? "active" : ""} onClick={() => setTab("AP")}>{t("finance.tab.ap", locale)}</button>
      </div>
      <div className="surface-panel">
        {loading ? (
          <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>{t("common.noData", locale)}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.invoiceNo", locale)}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.party", locale)}</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.amount", locale)}</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.paidAmount", locale)}</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.balance", locale)}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.dueDate", locale)}</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("common.status", locale)}</th>
                {canManage && <th style={{ padding: "8px 12px" }}>{t("common.action", locale)}</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((inv) => {
                const partyCode = "customerCode" in inv ? (inv as ArInvoice).customerCode : (inv as ApInvoice).supplierCode;
                const partyName = "customerNameZh" in inv ? (inv as ArInvoice).customerNameZh : (inv as ApInvoice).supplierNameZh;
                return (
                  <tr key={inv.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px" }}><strong>{inv.invoiceNumber}</strong></td>
                    <td style={{ padding: "8px 12px" }}>{partyCode}{partyName ? " · " + partyName : ""}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtCurrency(inv.totalAmount, inv.currencyCode)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtCurrency(inv.paidAmount, inv.currencyCode)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}><strong>{fmtCurrency(inv.outstandingAmount, inv.currencyCode)}</strong></td>
                    <td style={{ padding: "8px 12px" }}>{inv.dueDate}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span className={"badge tone-" + toneForStatus(inv.paymentStatus)}>
                        {inv.paymentStatus}
                      </span>
                    </td>
                    {canManage && (
                      <td style={{ padding: "8px 12px" }}>
                        {inv.paymentStatus === "open" && (
                          <button type="button" onClick={() => handlePost(inv.id)}
                            style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 11 }}>
                            {t("button.post", locale)}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
