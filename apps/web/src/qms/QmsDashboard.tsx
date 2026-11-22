// @ts-nocheck
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsKpiSummary } from "../api/qms";

const card = (label: string, value: string | number, tone: "ok" | "info" | "warning" | "danger", sub?: string) => (
  <article className="stat-tile" style={{ borderLeft: `4px solid var(--${tone === "ok" ? "ok" : tone === "danger" ? "danger" : tone === "warning" ? "warn" : "info"})` }}>
    <span>{label}</span>
    <strong>{value}</strong>
    {sub && <small>{sub}</small>}
  </article>
);

export function QmsDashboard({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [kpi, setKpi] = useState<QmsKpiSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    qmsApi.getKpiSummary()
      .then((r: QmsKpiSummary | { data?: QmsKpiSummary }) => setKpi("data" in r && r.data ? r.data : r as QmsKpiSummary))
      .catch(e => console.error("QMS KPI:", e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state" role="status" data-testid="qms.loading">{t("qms.loading")}</div>;
  if (!kpi) return <p className="error-note" role="alert" data-testid="qms.error">{t("qms.loadError")}</p>;

  const n = (v: string | number | undefined) => Number(v ?? 0) || 0;
  const oqcTotal = n(kpi.oqc_passed) + n(kpi.oqc_failed);
  const passRate = oqcTotal > 0 ? (n(kpi.oqc_passed) / oqcTotal) * 100 : 0;

  return (
    <section className="surface-panel" aria-label={t("qms.dashboard")} data-testid="qms.dashboard">
      <div className="page-header">
        <div>
          <h2>{t("qms.dashboard")}</h2>
          <p>{t("nav.qms")}</p>
        </div>
      </div>
      <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", marginTop: 12 }}>
        {card(t("qms.oqcBatches"), oqcTotal, "info", `${t("qms.passRate")}: ${passRate.toFixed(1)}%`)}
        {card(t("qms.open8d"), n(kpi.capa_open), "warning", `${t("qms.closed8d")}: ${n(kpi.capa_closed)}`)}
        {card(t("qms.ngPending"), n(kpi.ng?.open) + n(kpi.ng?.retesting), "danger", `${t("qms.ngRepaired")}: ${n(kpi.ng?.repairing)} · ${t("qms.ngScrapped")}: ${n(kpi.ng?.scrapped)}`)}
        {card(t("qms.total8d"), n(kpi.capa_open) + n(kpi.capa_closed) + n(kpi.capa_containment), "info")}
        {card(t("qms.totalNg"), n(kpi.ng?.open) + n(kpi.ng?.repairing) + n(kpi.ng?.retesting) + n(kpi.ng?.closed) + n(kpi.ng?.scrapped), "warning")}
      </div>
    </section>
  );
}
