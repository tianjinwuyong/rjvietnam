import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { financeApi, type PaymentRecord } from "../api/finance";

const fmt = (n: number | null | undefined, cur = "USD") => {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
};

export function FinancePaymentList({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    financeApi.listPayments({ limit: 200 })
      .then(r => { setItems(r.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="surface-panel">
      {loading ? (
        <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>
      ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>{t("common.noData", locale)}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.paymentNo", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("common.direction", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.party", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.amount", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.method", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.paidAt", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(p => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 12px" }}><strong>{p.paymentNumber}</strong></td>
                <td style={{ padding: "8px 12px" }}>
                  <span className={`badge ${p.direction === "IN" ? "tone-ok" : "tone-info"}`}>
                    {p.direction === "IN" ? t("finance.direction.in", locale) : t("finance.direction.out", locale)}
                  </span>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {p.partyType === "customer" ? t("common.customer", locale) : t("common.supplier", locale)}
                  {" · "}{p.partyCode}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><strong>{fmt(p.amount, p.currencyCode)}</strong></td>
                <td style={{ padding: "8px 12px" }}>{p.paymentMethod ?? "—"}</td>
                <td style={{ padding: "8px 12px" }}>{p.paymentDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
