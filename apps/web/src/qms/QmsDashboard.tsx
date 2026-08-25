// @ts-nocheck
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsKpiSummary } from "../api/qms";

const card = (label: string, value: string | number, color: string, sub?: string) => (
  <div style={{ background: "#1e293b", borderRadius: 12, padding: "20px 24px", minWidth: 180, flex: 1, borderLeft: `4px solid ${color}` }}>
    <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 6 }}>{label}</div>
    <div style={{ color, fontSize: 28, fontWeight: 700 }}>{value}</div>
    {sub && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{sub}</div>}
  </div>
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

  if (loading) return <div style={{ padding: 40, color: "#94a3b8" }}>{t("qms.loading")}</div>;
  if (!kpi) return <div style={{ padding: 40, color: "#f87171" }}>{t("qms.loadError")}</div>;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: "#e2e8f0", marginBottom: 20, fontSize: 20 }}>{t("qms.dashboard")}</h2>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        {card(t("qms.oqcBatches"), kpi.total_oqc_batches, "#38bdf8", `${t("qms.passRate")}: ${(kpi.oqc_pass_rate * 100).toFixed(1)}%`)}
        {card(t("qms.open8d"), kpi.open_8d, "#fb923c", `${t("qms.closed8d")}: ${kpi.closed_8d}`)}
        {card(t("qms.ngPending"), kpi.ng_pending, "#f87171", `${t("qms.ngRepaired")}: ${kpi.ng_repaired} | ${t("qms.ngScrapped")}: ${kpi.ng_scrapped}`)}
        {card(t("qms.complaints"), kpi.customer_complaints, "#a78bfa")}
        {card(t("qms.supplierPpm"), kpi.supplier_ppm, "#34d399")}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {card(t("qms.totalNg"), kpi.total_ng, "#fbbf24")}
        {card(t("qms.total8d"), kpi.total_8d, "#60a5fa")}
      </div>
    </div>
  );
}
