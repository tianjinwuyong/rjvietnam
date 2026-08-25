import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { financeApi, type DashboardSummary } from "../api/finance";

const fmt = (n: number | null | undefined, currency = "USD") => {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
};

export function FinanceDashboard({ locale }: { locale: Locale }) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    financeApi.getDashboardSummary()
      .then(r => { setData(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Loading...</div>;
  if (!data) return null;

  const cards = [
    { label: t("finance.totalArOutstanding", locale) ?? "AR Receivable", value: fmt(data.totalArOutstanding, data.currency), tone: "info" as const },
    { label: t("finance.totalApOutstanding", locale) ?? "AP Payable", value: fmt(data.totalApOutstanding, data.currency), tone: "info" as const },
    { label: t("finance.inventoryValue", locale) ?? "Inventory Value", value: fmt(data.totalInventoryValue, data.currency), tone: "ok" as const },
    { label: t("finance.overdueAmount", locale) ?? "AR Overdue", value: fmt(data.totalArOverdue, data.currency), tone: data.totalArOverdue > 0 ? "danger" as const : "ok" as const },
    { label: t("finance.wipCost", locale) ?? "WIP Cost", value: fmt(data.totalWipCost, data.currency), tone: "info" as const },
    { label: t("finance.openMaterialEvents", locale) ?? "Open Material Events", value: String(data.openMaterialEventCount), tone: data.openMaterialEventCount > 0 ? "warning" as const : "ok" as const },
  ];

  return (
    <div className="metric-grid">
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <span className="stat-label">{c.label}</span>
          <strong className={`tone-${c.tone}`}>{c.value}</strong>
        </div>
      ))}
    </div>
  );
}
