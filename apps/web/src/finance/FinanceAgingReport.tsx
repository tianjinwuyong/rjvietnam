import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { financeApi, type AgingBucket } from "../api/finance";

const fmt = (n: number | null | undefined, cur = "USD") => {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
};

const cells: Array<{ key: keyof AgingBucket["buckets"]; labelKey: string; tone: "ok" | "warning" | "danger" }> = [
  { key: "0-30", labelKey: "finance.bucket.0to30", tone: "ok" },
  { key: "31-60", labelKey: "finance.bucket.31to60", tone: "warning" },
  { key: "61-90", labelKey: "finance.bucket.61to90", tone: "danger" },
  { key: "over_90", labelKey: "finance.bucket.over90", tone: "danger" },
];

export function FinanceAgingReport({ locale }: { locale: Locale }) {
  const [arAging, setArAging] = useState<AgingBucket | null>(null);
  const [apAging, setApAging] = useState<AgingBucket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([financeApi.getArAging(), financeApi.getApAging()])
      .then(([ar, ap]) => {
        setArAging(ar);
        setApAging(ap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;

  const renderAging = (aging: AgingBucket | null, title: string) => {
    if (!aging) return null;
    return (
      <div key={title}>
        <h3 style={{ margin: "16px 0 12px", fontSize: 14, fontWeight: 700 }}>{title}</h3>
        <div className="content-grid four">
          {cells.map(c => (
            <div key={c.key} className="stat-card">
              <span className="stat-label">{t(c.labelKey as any, locale)}</span>
              <strong className={`tone-${c.tone}`}>{fmt(aging.buckets[c.key], aging.currencyCode)}</strong>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: "12px", background: "var(--surface-2)", borderRadius: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>{t("table.totalOutstanding", locale) ?? "Total Outstanding"}</span>
            <strong>{fmt(aging.totalOutstanding, aging.currencyCode)}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
            <span>{t("finance.totalOverdue", locale) ?? "Total Overdue"}</span>
            <strong className="tone-danger">{fmt(aging.totalOverdue, aging.currencyCode)}</strong>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderAging(arAging, t("finance.arAging", locale) ?? "AR Aging")}
      {renderAging(apAging, t("finance.apAging", locale) ?? "AP Aging")}
    </div>
  );
}
