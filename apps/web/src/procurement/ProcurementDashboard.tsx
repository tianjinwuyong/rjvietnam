import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { procurementApi, type ProcurementDashboardSummary } from "../api/procurement";

function fmt(n: number | null | undefined, currency = "USD"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " " + currency;
}

export function ProcurementDashboard({ locale }: { locale: Locale }) {
  const [data, setData] = useState<ProcurementDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    procurementApi.getDashboardSummary()
      .then(r => { setData(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Loading...</div>;
  if (!data) return null;

  const cards = [
    { label: t("procurement.dashboard.activeContracts", locale) ?? "Active Contracts", value: String(data.activeContracts), tone: "ok" as const },
    { label: t("procurement.dashboard.pendingApprovals", locale) ?? "Pending Approvals", value: String(data.pendingApprovals), tone: data.pendingApprovals > 0 ? "warning" as const : "ok" as const },
    { label: t("procurement.dashboard.expiringSoon", locale) ?? "Expiring Soon", value: String(data.expiringContracts), tone: data.expiringContracts > 0 ? "warning" as const : "ok" as const },
    { label: t("procurement.dashboard.poThisMonth", locale) ?? "POs This Month", value: String(data.poThisMonth), tone: "info" as const },
    { label: t("procurement.dashboard.poThisMonthValue", locale) ?? "PO Value (USD)", value: fmt(data.poThisMonthValue), tone: "info" as const },
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
