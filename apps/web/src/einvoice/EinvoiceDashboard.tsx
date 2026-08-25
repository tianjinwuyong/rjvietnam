import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { einvoiceApi, type EinvoiceInvoice } from "../api/einvoice";

function toneForStatus(s: string): "ok" | "warning" | "danger" | "info" {
  if (s === "published" || s === "fulfilled" || s === "paid" || s === "closed") return "ok";
  if (s === "cancelled" || s === "voided") return "danger";
  if (s === "draft") return "info";
  return "warning";
}

function fmtCurrency(n: number | null | undefined, cur = "VND"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " " + cur;
}

type StatusFilter = "all" | "published" | "cancelled" | "draft";

export function EinvoiceDashboard({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<EinvoiceInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    einvoiceApi.listInvoices({ limit: 500 })
      .then(r => { setItems(r.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;

  const published = items.filter(i => i.status === "published");
  const cancelled = items.filter(i => i.status === "cancelled");
  const totalAmount = published.reduce((s, i) => s + (i.totalAmount ?? 0), 0);

  const cards = [
    { label: t("einvoice.dashboard.totalInvoices", locale) ?? "Total Invoices", value: String(items.length), tone: "info" as const },
    { label: t("einvoice.dashboard.published", locale) ?? "Published", value: String(published.length), tone: "ok" as const },
    { label: t("einvoice.dashboard.cancelled", locale) ?? "Cancelled", value: String(cancelled.length), tone: cancelled.length > 0 ? "danger" as const : "ok" as const },
    { label: t("einvoice.dashboard.totalAmount", locale) ?? "Total Amount (VND)", value: fmtCurrency(totalAmount), tone: "info" as const },
  ];

  return (
    <div className="metric-grid">
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <span className="stat-label">{c.label}</span>
          <strong className={"tone-" + c.tone}>{c.value}</strong>
        </div>
      ))}
    </div>
  );
}
