import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { financeApi } from "../api/finance";

const fmt = (n: number | null | undefined, cur = "USD") => {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
};
const fmtInt = (n: number | null | undefined) => n == null ? "0" : n.toLocaleString();

const card = (label: string, value: string, sub?: string, tone: "ok" | "warn" | "danger" | "neutral" = "neutral") => ({
  label, value, sub, tone
});

type Tab = "overview" | "loss" | "trend" | "consumption";

function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  const colors: Record<string, string> = {
    ok: "var(--success, #22c55e)",
    warn: "var(--warning, #f59e0b)",
    danger: "var(--danger, #ef4444)",
    neutral: "var(--text, #e2e8f0)"
  };
  return (
    <div style={{ background: "var(--surface, #1e293b)", borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
      <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: colors[tone] || colors.neutral }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)" }}>{sub}</span>}
    </div>
  );
}

function LoadingState({ locale }: { locale: Locale }) {
  return <div style={{ padding: 40, textAlign: "center", color: "var(--muted, #94a3b8)" }}>{t("finance.cost.loading", locale)}</div>;
}

function EmptyState({ msg, locale }: { msg?: string; locale: Locale }) {
  return <div style={{ padding: 40, textAlign: "center", color: "var(--muted, #94a3b8)" }}>{msg}</div>;
}

function Table({ headers, rows, locales }: { headers: string[]; rows: string[][]; locales: Locale }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--muted, #94a3b8)", borderBottom: "1px solid var(--border, #334155)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border, #1e293b)" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "8px 12px", color: "var(--text, #e2e8f0)" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewPanel({ locale }: { locale: Locale }) {
  const [summary, setSummary] = useState<any>(null);
  const [inv, setInv] = useState<any>(null);
  const [wip, setWip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      financeApi.getCostSummary().catch(() => null),
      financeApi.getInventoryValue().catch(() => null),
      financeApi.getWipData().catch(() => null),
    ]).then(([s, i, w]) => {
      setSummary(s); setInv(i); setWip(w); setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState locale={locale} />;

  const totals = summary?.totals;
  const grandTotal = inv?.grandTotal;
  const invVal = Array.isArray(grandTotal) ? grandTotal.reduce((a: number, b: any) => a + (parseFloat(b.grand_total) || 0), 0) : 0;

  const cards = [
    card(t("finance.cost.totalMaterialCost", locale), fmt(parseFloat(totals?.total_material_cost || "0")), t("finance.cost.days90", locale)),
    card(t("finance.cost.ngLoss", locale), fmt(parseFloat(totals?.total_ng_loss ?? "0")), `${totals?.total_ng_events ?? 0} ${t("finance.cost.times", locale)}`, parseFloat(totals?.total_ng_loss || "0") > 1000 ? "danger" : "neutral"),
    card(t("finance.cost.scrapLoss", locale), fmt(parseFloat(totals?.total_scrap_loss ?? "0")), `${totals?.total_scrap_count ?? 0} ${t("finance.cost.times", locale)}`, parseFloat(totals?.total_scrap_loss || "0") > 500 ? "danger" : "neutral"),
    card(t("finance.cost.inventoryValue", locale), fmt(invVal), (Array.isArray(grandTotal) && grandTotal[0] ? grandTotal[0].currency_code : "USD")),
    card(t("finance.cost.wip", locale), fmt((wip?.totalQty ?? 0)), `${wip?.totalSn ?? 0} SN`),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {cards.map(c => <MetricCard key={c.label} {...c} />)}
      </div>

      {/* Inventory valuation detail */}
      {inv?.byMaterial?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.inventoryDetail", locale)}
          </div>
          <Table
            headers={[t("finance.cost.materialCode", locale), t("finance.cost.materialName", locale), t("finance.cost.lot", locale), t("finance.cost.quantity", locale), t("finance.cost.value", locale), t("finance.cost.currency", locale)]}
            rows={(inv.byMaterial as any[]).map((m: any) => [
              m.material_code, m.name_zh || "—",
              String(m.lot_count), fmtInt(m.total_qty),
              fmt(m.total_value), m.currency || "USD"
            ])}
            locales={locale}
          />
        </div>
      )}

      {/* WIP distribution */}
      {wip?.byZone?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.wipDistribution", locale)}
          </div>
          <Table
            headers={[t("finance.cost.zone", locale), t("finance.cost.snCount", locale)]}
            rows={(wip.byZone as any[]).map((z: any) => [z.zone || t("finance.cost.unclassified", locale), fmtInt(z.sn_count)])}
            locales={locale}
          />
        </div>
      )}

      {/* Cost trend */}
      {summary?.summary?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.costTrend30d", locale)}
          </div>
          <Table
            headers={[t("finance.cost.date", locale), t("finance.cost.materialCost", locale), t("finance.cost.ngLoss", locale), t("finance.cost.scrapLoss", locale), t("finance.cost.compensation", locale), t("finance.cost.ngCount", locale), t("finance.cost.consumptionCount", locale)]}
            rows={(summary.summary as any[]).slice(0, 30).map((s: any) => [
              s.date_key?.slice(0, 10) || "",
              fmt(parseFloat(s.material_cost || "0")),
              fmt(parseFloat(s.ng_loss || "0")),
              fmt(parseFloat(s.scrap_loss || "0")),
              fmt(parseFloat(s.compensation || "0")),
              s.ng_count || "0",
              s.consumption_count || "0",
            ])}
            locales={locale}
          />
        </div>
      )}
    </div>
  );
}

function LossPanel({ locale }: { locale: Locale }) {
  const [ng, setNg] = useState<any>(null);
  const [scrap, setScrap] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      financeApi.getNgLossReport().catch(() => null),
      financeApi.getScrapReport().catch(() => null),
      financeApi.getLossAnalysis().catch(() => null),
    ]).then(([n, s, a]) => {
      setNg(n); setScrap(s); setAnalysis(a); setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState locale={locale} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Loss analysis */}
      {analysis && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <MetricCard label={t("finance.cost.totalLossAmount", locale)} value={fmt((analysis.byType as any[])?.reduce((a: number, b: any) => a + parseFloat(b.total_loss || "0"), 0) || 0)} tone="danger" />
          <MetricCard label={t("finance.cost.lossEvents", locale)} value={fmtInt((analysis.byType as any[])?.reduce((a: number, b: any) => a + parseInt(b.count || "0"), 0) || 0)} tone="neutral" />
        </div>
      )}

      {analysis?.byType?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.lossTypeAnalysis", locale)}
          </div>
          <Table
            headers={[t("finance.cost.type", locale), t("finance.cost.count", locale), t("finance.cost.totalLoss", locale), t("finance.cost.avgLoss", locale)]}
            rows={(analysis.byType as any[]).map((r: any) => [
              r.event_type, r.count, fmt(parseFloat(r.total_loss || "0")), fmt(parseFloat(r.avg_loss || "0"))
            ])}
            locales={locale}
          />
        </div>
      )}

      {analysis?.topLossMaterials?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.topLossMaterials", locale)}
          </div>
          <Table
            headers={[t("finance.cost.materialCode", locale), t("finance.cost.materialName", locale), t("finance.cost.totalLoss", locale), t("finance.cost.eventCount", locale)]}
            rows={(analysis.topLossMaterials as any[]).map((m: any) => [
              m.material_code, m.material_name || "—", fmt(parseFloat(m.total_loss || "0")), m.event_count
            ])}
            locales={locale}
          />
        </div>
      )}

      {ng?.data?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.ngReplacement", locale)} ({ng.summary?.total_replacements || 0} {t("finance.cost.times", locale)})
          </div>
          <Table
            headers={[t("finance.cost.defectType", locale), t("finance.cost.description", locale), t("finance.cost.replacementQty", locale), t("finance.cost.time", locale)]}
            rows={(ng.data as any[]).map((r: any) => [
              r.defect_type || "—", r.description || "—",
              String(r.replacement_count || 0), r.replaced_at?.slice(0, 16) || "—"
            ])}
            locales={locale}
          />
        </div>
      )}

      {scrap?.data?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.scrapRecords", locale)}
          </div>
          <Table
            headers={[t("finance.cost.batchNo", locale), t("finance.cost.materialCode", locale), t("finance.cost.scrapQty", locale), t("finance.cost.lossAmount", locale)]}
            rows={(scrap.data as any[]).map((r: any) => [
              r.lot_no || "—", r.material_code || "—",
              String(r.scrap_count || 0), fmt(parseFloat(r.total_loss || "0"))
            ])}
            locales={locale}
          />
        </div>
      )}

      {!ng?.data?.length && !scrap?.data?.length && !analysis?.byType?.length && (
        <EmptyState msg={t("finance.cost.noLossData", locale)} locale={locale} />
      )}
    </div>
  );
}

function TrendPanel({ locale }: { locale: Locale }) {
  const [trend, setTrend] = useState<any>(null);
  const [lifecycle, setLifecycle] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      financeApi.getMonthlyCostTrend().catch(() => null),
      financeApi.getMaterialLifecycleCost(90).catch(() => null),
    ]).then(([t, l]) => {
      setTrend(t); setLifecycle(l); setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState locale={locale} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {trend?.data?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.monthlyTrend", locale)}
          </div>
          <Table
            headers={[t("finance.cost.month", locale), t("finance.cost.materialCost", locale), t("finance.cost.ngLoss", locale), t("finance.cost.scrapLoss", locale), t("finance.cost.compensation", locale), t("finance.cost.monthlyTotalCost", locale)]}
            rows={(trend.data as any[]).map((r: any) => [
              r.month, fmt(parseFloat(r.material_cost || "0")),
              fmt(parseFloat(r.ng_loss || "0")), fmt(parseFloat(r.scrap_loss || "0")),
              fmt(parseFloat(r.compensation || "0")), fmt(parseFloat(r.total_cost || "0"))
            ])}
            locales={locale}
          />
        </div>
      )}

      {lifecycle?.data?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {lifecycle.periodDays}{t("finance.cost.lifecycleDistribution", locale)}
          </div>
          <Table
            headers={[t("finance.cost.eventType", locale), t("finance.cost.eventCount", locale), t("finance.cost.totalCost", locale), t("finance.cost.totalLoss", locale)]}
            rows={(lifecycle.data as any[]).map((r: any) => [
              r.event_type, r.event_count, fmt(parseFloat(r.total_cost || "0")), fmt(parseFloat(r.total_loss || "0"))
            ])}
            locales={locale}
          />
        </div>
      )}

      {!trend?.data?.length && !lifecycle?.data?.length && <EmptyState msg={t("finance.cost.noData", locale)} locale={locale} />}
    </div>
  );
}

function ConsumptionPanel({ locale }: { locale: Locale }) {
  const [consumption, setConsumption] = useState<any>(null);
  const [turnover, setTurnover] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      financeApi.getConsumptionReport().catch(() => null),
      financeApi.getInventoryTurnover().catch(() => null),
    ]).then(([c, t]) => {
      setConsumption(c); setTurnover(t); setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState locale={locale} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {consumption?.data?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.reportConsumption", locale)}
          </div>
          <Table
            headers={[t("finance.cost.materialCode", locale), t("finance.cost.materialName", locale), t("finance.cost.consumptionCount", locale), t("finance.cost.consumptionCost", locale), t("finance.cost.loss", locale)]}
            rows={(consumption.data as any[]).map((r: any) => [
              r.material_code, r.material_name || "—",
              String(r.tx_count || 0), fmt(r.total_cost || 0), fmt(r.loss || 0)
            ])}
            locales={locale}
          />
        </div>
      )}

      {turnover?.data?.length > 0 && (
        <div className="surface-panel">
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border, #334155)" }}>
            {t("finance.cost.inventoryTurnover", locale)}
          </div>
          <Table
            headers={[t("finance.cost.materialCode", locale), t("finance.cost.materialName", locale), t("finance.cost.consumedValue", locale), t("finance.cost.receivedValue", locale), t("finance.cost.qty", locale)]}
            rows={(turnover.data as any[]).map((r: any) => [
              r.material_code, r.material_name || "—",
              fmt(r.consumed_value || 0), fmt(r.received_value || 0), fmtInt(r.total_qty)
            ])}
            locales={locale}
          />
        </div>
      )}

      {!consumption?.data?.length && !turnover?.data?.length &&         <EmptyState msg={t("finance.cost.noConsumptionData", locale)} locale={locale} />}
    </div>
  );
}

export function FinanceCostReport({ locale }: { locale: Locale; canManage?: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: t("finance.cost.costOverview", locale) },
    { key: "loss", label: t("finance.cost.lossReport", locale) },
    { key: "trend", label: t("finance.cost.trendAnalysis", locale) },
    { key: "consumption", label: t("finance.cost.materialConsumption", locale) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, padding: "0 0 16px 0", borderBottom: "1px solid var(--border, #334155)", marginBottom: 16 }}>
        {tabs.map(tb => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              background: tab === tb.key ? "var(--primary, #3b82f6)" : "var(--surface, #1e293b)",
              color: tab === tb.key ? "#fff" : "var(--muted, #94a3b8)",
              transition: "all 0.15s",
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewPanel locale={locale} />}
      {tab === "loss" && <LossPanel locale={locale} />}
      {tab === "trend" && <TrendPanel locale={locale} />}
      {tab === "consumption" && <ConsumptionPanel locale={locale} />}
    </div>
  );
}
