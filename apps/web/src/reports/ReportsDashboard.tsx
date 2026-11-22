import { useMemo, useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi, pmcApi } from "../api";
import type { ProductionLine } from "../api/mes";
import type { WorkOrder as PmcWorkOrder } from "../api/pmc";
import {
  reportTabKeys, reportTabI18nKey, reportDomainOf, reportDomainI18nKey,
  PERIOD_REPORTS, type ReportTabKey, type ReportDomain, type ReportPeriod,
} from "./index";
import { reportsApi, reportKeys, type ReportData } from "../api/reports";
import { downloadReportSessions, normalizeReportSession, type ReportSession } from "./reportSessionExport";
import { MemoryChat } from "./MemoryChat";
import { IctFlintDemo, FlintDemo, StationReports } from "./index";

// ── Helpers ───────────────────────────────────────────────────────

const STATUS_TONES: Record<string, string> = {
  running: "ok", released: "info", draft: "warning", closed: "muted", hold: "warning",
  voided: "danger", pending: "warning", rejected: "danger", completed: "ok",
  low: "ok", medium: "warning", high: "danger", critical: "danger",
};

function badgeTone(val: unknown): string {
  const s = String(val ?? "").toLowerCase();
  return STATUS_TONES[s] ?? "info";
}

function fmtVal(val: unknown, key: string): string {
  if (val == null) return "—";
  if (typeof val === "number") {
    if (key.endsWith("Pct") || key.includes("percentage") || key.includes("rate") || key === "availability" || key === "performance" || key === "quality" || key === "oee") return `${val}%`;
    return val.toLocaleString();
  }
  if (typeof val === "object") {
    const s = String(val);
    if (s.startsWith("(") && s.endsWith(")")) {
      const parts = s.slice(1, -1).split(",").map((p) => p.replace(/^"|"$/g, "").trim());
      return parts[0] || parts[1] || parts[2] || s;
    }
    return s;
  }
  return String(val);
}

// ── Report Filter Bar ─────────────────────────────────────────────

function ReportFilterBar({
  reportKey,
  filters,
  onChange,
  locale,
}: {
  reportKey: string;
  filters: Record<string, string>;
  onChange: (f: Record<string, string>) => void;
  locale: Locale;
}) {
  const hasLine = ["work-order-progress", "oee-by-line", "delivery-risk", "aoi-yield", "spi-yield"].includes(reportKey);
  const hasWo = ["work-order-progress", "material-movement", "defect-analysis", "delivery-risk"].includes(reportKey);
  const hasMat = ["inventory-ledger", "material-movement", "material-balance"].includes(reportKey);
  const hasSup = ["iqc-summary", "inventory-ledger"].includes(reportKey);
  const hasIqcStatus = ["inventory-ledger"].includes(reportKey);
  const hasStatus = ["work-order-progress"].includes(reportKey);
  const hasStationType = ["defect-analysis"].includes(reportKey);
  const hasRiskLevel = ["delivery-risk"].includes(reportKey);
  const hasEmp = ["attendance-summary"].includes(reportKey);
  const hasAsset = ["equipment-downtime", "maintenance-summary"].includes(reportKey);

  const set = (key: string, value: string) => onChange({ ...filters, [key]: value });
  const reset = () => onChange({});

  return (
    <div className="report-filter-bar" data-testid="reports.filters">
      <span className="filter-label">{t("report.filter.title", locale)}</span>
      <input type="date" value={filters.dateFrom ?? ""} onChange={(e) => set("dateFrom", e.target.value)} style={inputStyle} title={t("report.filter.dateFrom", locale)} />
      <input type="date" value={filters.dateTo ?? ""} onChange={(e) => set("dateTo", e.target.value)} style={inputStyle} title={t("report.filter.dateTo", locale)} />
      {hasLine && <input value={filters.lineCode ?? ""} onChange={(e) => set("lineCode", e.target.value)} placeholder={t("report.filter.lineCode", locale)} style={inputStyle} />}
      {hasWo && <input value={filters.workOrderCode ?? ""} onChange={(e) => set("workOrderCode", e.target.value)} placeholder={t("report.filter.workOrderCode", locale)} style={inputStyle} />}
      {hasMat && <input value={filters.materialCode ?? ""} onChange={(e) => set("materialCode", e.target.value)} placeholder={t("report.filter.materialCode", locale)} style={inputStyle} />}
      {hasSup && <input value={filters.supplierCode ?? ""} onChange={(e) => set("supplierCode", e.target.value)} placeholder={t("report.filter.supplierCode", locale)} style={inputStyle} />}
      {hasIqcStatus && (
        <select value={filters.iqcStatus ?? ""} onChange={(e) => set("iqcStatus", e.target.value)} style={{ ...inputStyle, maxWidth: 120 }}>
          <option value="">{t("report.filter.iqcStatus", locale)}</option>
          <option value="released" key="iqc-released">{t("iqc.released", locale)}</option>
          <option value="hold" key="iqc-hold">{t("iqc.hold", locale)}</option>
          <option value="pending" key="iqc-pending">{t("iqc.pending", locale)}</option>
          <option value="rejected" key="iqc-rejected">{t("iqc.rejected", locale)}</option>
        </select>
      )}
      {hasStatus && (
        <select value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)} style={{ ...inputStyle, maxWidth: 120 }}>
          <option value="">{t("report.filter.status", locale)}</option>
          <option value="released" key="status-released">{t("status.released", locale)}</option>
          <option value="running" key="status-running">{t("status.running", locale)}</option>
          <option value="closed" key="status-closed">{t("status.closed", locale)}</option>
          <option value="hold" key="status-hold">{t("status.hold", locale)}</option>
        </select>
      )}
      {hasStationType && <input value={filters.stationType ?? ""} onChange={(e) => set("stationType", e.target.value)} placeholder={t("report.filter.stationType", locale)} style={inputStyle} />}
      {hasRiskLevel && (
        <select value={filters.riskLevel ?? ""} onChange={(e) => set("riskLevel", e.target.value)} style={{ ...inputStyle, maxWidth: 120 }}>
          <option value="">{t("report.filter.riskLevel", locale)}</option>
          <option value="low" key="risk-low">{t("risk.low", locale)}</option>
          <option value="medium" key="risk-medium">{t("risk.medium", locale)}</option>
          <option value="high" key="risk-high">{t("risk.high", locale)}</option>
          <option value="critical" key="risk-critical">{t("risk.critical", locale)}</option>
        </select>
      )}
      {hasEmp && <input value={filters.employeeCode ?? ""} onChange={(e) => set("employeeCode", e.target.value)} placeholder={t("report.col.employeeCode", locale)} style={inputStyle} />}
      {hasAsset && <input value={filters.assetCode ?? ""} onChange={(e) => set("assetCode", e.target.value)} placeholder={t("report.col.assetCode", locale)} style={inputStyle} />}
      {hasIqcStatus && (
        <select value={filters.iqcStatus ?? ""} onChange={(e) => set("iqcStatus", e.target.value)} style={{ ...inputStyle, maxWidth: 120 }}>
          <option value="">{t("report.filter.iqcStatus", locale)}</option>
          <option value="released" key="iqc2-released">{t("iqc.released", locale)}</option>
          <option value="hold" key="iqc2-hold">{t("iqc.hold", locale)}</option>
          <option value="pending" key="iqc2-pending">{t("iqc.pending", locale)}</option>
          <option value="rejected" key="iqc2-rejected">{t("iqc.rejected", locale)}</option>
        </select>
      )}
      {hasStatus && (
        <select value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)} style={{ ...inputStyle, maxWidth: 120 }}>
          <option value="">{t("report.filter.status", locale)}</option>
          <option value="released" key="status2-released">{t("status.released", locale)}</option>
          <option value="running" key="status2-running">{t("status.running", locale)}</option>
          <option value="closed" key="status2-closed">{t("status.closed", locale)}</option>
          <option value="hold" key="status2-hold">{t("status.hold", locale)}</option>
        </select>
      )}
      {hasStationType && <input value={filters.stationType ?? ""} onChange={(e) => set("stationType", e.target.value)} placeholder={t("report.filter.stationType", locale)} style={inputStyle} />}
      {hasRiskLevel && (
        <select value={filters.riskLevel ?? ""} onChange={(e) => set("riskLevel", e.target.value)} style={{ ...inputStyle, maxWidth: 120 }}>
          <option value="">{t("report.filter.riskLevel", locale)}</option>
          <option value="low" key="risk2-low">{t("risk.low", locale)}</option>
          <option value="medium" key="risk2-medium">{t("risk.medium", locale)}</option>
          <option value="high" key="risk2-high">{t("risk.high", locale)}</option>
          <option value="critical" key="risk2-critical">{t("risk.critical", locale)}</option>
        </select>
      )}
      <button className="btn btn-sm" onClick={() => onChange({ ...filters })} style={{ padding: "4px 12px" }}>{t("report.filter.apply", locale)}</button>
      <button className="btn btn-sm btn-outline" onClick={reset} style={{ padding: "4px 12px" }}>{t("report.filter.reset", locale)}</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "4px 8px", fontSize: 13, border: "1px solid var(--border)",
  borderRadius: 4, background: "var(--bg)", color: "var(--text)", maxWidth: 150,
};

// ── Report Table ───────────────────────────────────────────────────

function ReportTable({ data, locale }: { data: ReportData; locale: Locale }) {
  if (!data.rows.length) {
    return <p style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>{t("report.noData", locale)}</p>;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {data.columns.map((col) => (
              <th key={col.key}>
                {col.labelZh && col.labelZh !== col.key
                  ? col.labelZh
                  : t(`report.col.${col.key}` as any, locale)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {data.columns.map((col) => {
                const val = row[col.key];
                const key = col.key;

                if (key === "riskLevel" || key === "risk" || key === "status" || key === "iqcStatus" || key === "result") {
                  return (
                    <td key={col.key}>
                      <span className={`badge badge-${badgeTone(val)}`}>{fmtVal(val, key)}</span>
                    </td>
                  );
                }

                if (key === "progressPct" || key === "availability" || key === "performance" || key === "quality" || key === "oee") {
                  const num = typeof val === "number" ? val : 0;
                  return (
                    <td key={col.key}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div className="progress" style={{ flex: 1, maxWidth: 80 }}>
                          <span style={{ width: `${Math.min(num, 100)}%` }} />
                        </div>
                        <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{num}%</span>
                      </div>
                    </td>
                  );
                }

                if (typeof val === "number") {
                  return <td key={col.key} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtVal(val, key)}</td>;
                }

                return <td key={col.key}>{fmtVal(val, key)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Dashboard Overview ────────────────────────────────────────────

function DashboardOverview({ locale, onSelectReport }: { locale: Locale; onSelectReport: (key: ReportTabKey) => void }) {
  // These two lists used to be fabricated demo constants. They now come from the MES and
  // PMC APIs, and a failed call leaves the table empty rather than showing invented rows.
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [workOrders, setWorkOrders] = useState<PmcWorkOrder[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([mesApi.getLines({ limit: 200 }), pmcApi.getWorkOrders({ limit: 500 })])
      .then(([lineRes, woRes]) => {
        if (!alive) return;
        setLines(lineRes.items ?? []);
        setWorkOrders(woRes.items ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setLines([]);
        setWorkOrders([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  const metrics = [
    { id: "dashboard.workOrders", value: String(workOrders.length), trend: t("section.queue", locale), tone: "info" as const },
    { id: "common.line", value: String(lines.length), trend: t("section.flow", locale), tone: "ok" as const },
  ];
  const woByType = useMemo(() => [1, 2, 3].map((typ) => ({ type: typ, count: workOrders.filter((wo) => wo.type === typ).length })), []);
  const woByLine = useMemo(() => [...new Set(workOrders.map((wo) => wo.lineCode))].map((lc) => ({ lineCode: lc, count: workOrders.filter((wo) => wo.lineCode === lc).length })), []);

  return (
    <div className="screen-stack">
      <section className="metric-grid">
        {metrics.map((metric) => (
          <article className="stat-card" key={metric.id}>
            <span>{t(metric.id as any, locale)}</span>
            <strong>{metric.value}</strong>
            <span className={`badge badge-${metric.tone}`}>{metric.trend}</span>
          </article>
        ))}
      </section>

      <div className="content-grid two">
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("section.reportPanel", locale)}</h2>
              <p>{t("reports.subtitle", locale)}</p>
            </div>
          </div>
          <div className="report-grid">
            {reportTabKeys.filter((k) => k !== "dashboard").map((key) => (
              <article className="report-card" key={key} style={{ cursor: "pointer" }} onClick={() => onSelectReport(key)}>
                <span>{t(reportTabI18nKey[key] as any, locale)}</span>
                <small style={{ color: "var(--muted)", fontSize: 11 }}>{key}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("reports.performance", locale)}</h2>
              <p>{t("section.flow", locale)}</p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("common.line", locale)}</th><th>{t("common.status", locale)}</th><th>{t("common.output", locale)}</th></tr></thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.nameZh ?? line.nameEn}</td>
                    <td><span className={`badge badge-${line.status === "running" ? "ok" : line.status === "changeover" ? "warning" : line.status === "down" ? "danger" : "info"}`}>{t(line.status === "running" ? "status.running" : line.status === "changeover" ? "status.changeover" : line.status === "down" ? "status.down" : "status.idle", locale)}</span></td>
                    <td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="content-grid two">
        <section className="surface-panel">
          <div className="section-header"><div><h2>{t("reports.woByType", locale)}</h2><p>{t("reports.woSummary", locale)}</p></div></div>
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("common.type", locale)}</th><th>{t("common.count", locale)}</th></tr></thead>
              <tbody>{woByType.map((row) => <tr key={row.type}><td>{t(`woType.${row.type}` as any, locale)}</td><td>{row.count}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="surface-panel">
          <div className="section-header"><div><h2>{t("reports.woByLine", locale)}</h2><p>{t("reports.woSummary", locale)}</p></div></div>
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("common.line", locale)}</th><th>{t("common.count", locale)}</th></tr></thead>
              <tbody>{woByLine.map((row) => <tr key={row.lineCode}><td><code>{row.lineCode}</code></td><td>{row.count}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function ReportsDashboard({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<ReportTabKey>("dashboard");
  const [reportData, setReportData] = useState<Record<string, ReportData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState<ReportPeriod>("daily");
  const [activeDomain, setActiveDomain] = useState<ReportDomain | "dashboard">("dashboard");
  const [reportSessions, setReportSessions] = useState<ReportSession[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(window.localStorage.getItem("mes.reportSessions") || "[]") as ReportSession[]; } catch { return []; }
  });
  const [archiveStatus, setArchiveStatus] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("mes.reportSessions", JSON.stringify(reportSessions.slice(-100)));
  }, [reportSessions]);

  const toSession = useCallback((data: ReportData): ReportSession => normalizeReportSession({
    key: data.key,
    title: locale === "zh-CN" ? data.titleZh : locale === "vi-VN" ? data.titleVi : data.titleEn,
    generatedAt: data.meta.generatedAt,
    filters: Object.fromEntries(Object.entries(data.meta.filter ?? {}).map(([key, value]) => [key, String(value ?? "")])),
    columns: data.columns.map((column) => ({ key: column.key, label: locale === "zh-CN" ? column.labelZh : locale === "vi-VN" ? column.labelVi : column.labelEn })),
    rows: data.rows,
  }), [locale]);

  const fetchReport = useCallback(async (key: string) => {
    setLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const apiFilters: Parameters<typeof reportsApi.getReport>[1] = {};
      if (filters.dateFrom) apiFilters.dateFrom = filters.dateFrom;
      if (filters.dateTo) apiFilters.dateTo = filters.dateTo;
      if (filters.lineCode) apiFilters.lineCode = filters.lineCode;
      if (filters.workOrderCode) apiFilters.workOrderCode = filters.workOrderCode;
      if (filters.materialCode) apiFilters.materialCode = filters.materialCode;
      if (filters.supplierCode) apiFilters.supplierCode = filters.supplierCode;
      if (filters.employeeCode) apiFilters.employeeCode = filters.employeeCode;
      if (filters.assetCode) apiFilters.assetCode = filters.assetCode;
      if (filters.iqcStatus) (apiFilters as any).iqcStatus = filters.iqcStatus;
      if (filters.status) (apiFilters as any).status = filters.status;
      if (filters.stationType) (apiFilters as any).stationType = filters.stationType;
      if (filters.riskLevel) (apiFilters as any).riskLevel = filters.riskLevel;
      if (PERIOD_REPORTS.includes(activeTab) && period !== "daily") apiFilters.period = period;
      const data = await reportsApi.getReport(key as any, Object.keys(apiFilters).length > 0 ? apiFilters : undefined);
      setReportData((prev) => ({ ...prev, [key]: data }));
      setReportSessions((prev) => [...prev, toSession(data)].slice(-100));
    } catch {
      // handled by mock fallback in reportsApi
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [filters, period, activeTab, toSession]);

  useEffect(() => {
    if (activeTab !== "dashboard") fetchReport(activeTab);
  }, [activeTab, fetchReport]);

  const currentData = reportData[activeTab];
  const isPeriodReport = PERIOD_REPORTS.includes(activeTab);
  const [exportingAllReports, setExportingAllReports] = useState(false);

  const exportAllReports = useCallback(async () => {
    setExportingAllReports(true);
    try {
      const apiFilters: Parameters<typeof reportsApi.getReport>[1] = {};
      for (const [key, value] of Object.entries(filters)) if (value) (apiFilters as Record<string, string>)[key] = value;
      if (period !== "daily") apiFilters.period = period;
      const loaded = await Promise.all(reportKeys.map((key) => reportsApi.getReport(key, Object.keys(apiFilters).length ? apiFilters : undefined)));
      setReportData((prev) => Object.fromEntries([...Object.entries(prev), ...loaded.map((data) => [data.key, data])]));
      const sessions = loaded.map(toSession);
      setReportSessions((prev) => [...prev, ...sessions].slice(-100));
      await downloadReportSessions(sessions, `management-reports-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExportingAllReports(false);
    }
  }, [filters, period, toSession]);

  const exportReportHistory = useCallback(async () => {
    if (reportSessions.length === 0) return;
    await downloadReportSessions(reportSessions, `management-report-sessions-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [reportSessions]);

  const archiveAllReportsInMes = useCallback(async () => {
    setArchiveStatus("Archiving...");
    try {
      const result = await reportsApi.archiveAllReports(period === "daily" ? undefined : period);
      setArchiveStatus(`MES archived ${result.totalArchived} report sessions`);
    } catch (error) {
      setArchiveStatus(error instanceof Error ? error.message : String(error));
    }
  }, [period]);

  // Group tabs by domain for domain-section navigation
  const domains: (ReportDomain | "dashboard")[] = ["dashboard", "production", "warehouse", "quality", "hr-equipment", "finance", "memory"];
  const domainTabs = (domain: ReportDomain | "dashboard") =>
    reportTabKeys.filter((k) => k !== "dashboard" && reportDomainOf[k] === domain);

  // activeTab is only rendered as a report when it is a real ReportKey; the
  // export link falls back to "#" for the demo/memory tabs.
  const exportKey = reportKeys.find((k) => k === activeTab);
  const exportUrl = exportKey ? reportsApi.getExportUrl(exportKey) : "#";

  return (
    <section className="screen-stack" aria-label={t("nav.reports", locale)} data-testid="reports.page">
      {/* Domain navigation bar */}
      <nav className="toolbar" aria-label={t("reports.subtitle", locale)} data-testid="reports.domains" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
        {domains.map((domain) => {
          const tabs = domainTabs(domain);
          if (tabs.length === 0) return null;
          const isActive = activeDomain === domain;
          return (
            <button
              key={domain}
              type="button"
              className={isActive ? "active" : ""}
              data-testid={`reports.domain.${domain}`}
              title={domain === "dashboard" ? t("reports.subtitle", locale) : t(reportDomainI18nKey[domain], locale)}
              onClick={() => { setActiveDomain(domain); setActiveTab(domain === "dashboard" ? "dashboard" : tabs[0]); }}
            >
              {domain === "dashboard" ? t("reports.subtitle", locale) : t(reportDomainI18nKey[domain], locale)}
            </button>
          );
        })}
      </nav>

      {/* Tab bar — only show tabs for active domain */}
      <nav className="toolbar" aria-label={t("section.reportPanel", locale)} data-testid="reports.tabs">
        {(activeDomain === "dashboard" ? reportTabKeys : domainTabs(activeDomain)).map((key) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? "active" : ""}
            data-testid={`reports.tab.${key}`}
            title={t(reportTabI18nKey[key], locale)}
            onClick={() => { setActiveTab(key); if (key !== "dashboard") setFilters({}); }}
          >
            {t(reportTabI18nKey[key], locale)}
          </button>
        ))}
      </nav>

      {reportSessions.length > 0 && (
        <section className="surface-panel" aria-label={t("report.sessions.title", locale)}>
          <div className="page-header">
            <div>
              <h2>{t("report.sessions.title", locale)}</h2>
              <p>{t("report.sessions.desc", locale)}</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="action-button" data-testid="reports.sessions-export" title={t("report.sessions.exportHistory", locale)} onClick={exportReportHistory}>{t("report.sessions.exportHistory", locale)}</button>
              <button type="button" className="action-button" data-testid="reports.sessions-archive" title={t("report.sessions.archiveAll", locale)} onClick={archiveAllReportsInMes}>{t("report.sessions.archiveAll", locale)}</button>
            </div>
          </div>
          {archiveStatus && <div role="status" style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>{archiveStatus}</div>}
          <div className="table-shell" style={{ marginTop: 10 }}>
            <table className="data-table" data-testid="reports.sessions-table">
              <thead><tr><th>{t("report.sessions.col.report", locale)}</th><th>{t("report.sessions.col.generated", locale)}</th><th>{t("report.sessions.col.rows", locale)}</th><th>{t("report.sessions.col.filters", locale)}</th></tr></thead>
              <tbody>{reportSessions.slice(-5).reverse().map((session, index) => (
                <tr key={`${session.key}-${session.generatedAt}-${index}`}>
                  <td><code>{session.key}</code><div style={{ color: "var(--muted)", fontSize: 11 }}>{session.title}</div></td>
                  <td>{new Date(session.generatedAt).toLocaleString(locale)}</td>
                  <td>{session.totalRows.toLocaleString()}</td>
                  <td style={{ maxWidth: 260, whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(session.filters)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "dashboard" && <DashboardOverview locale={locale} onSelectReport={(k) => { setActiveTab(k); setActiveDomain(reportDomainOf[k]); }} />}

      {activeTab === "memory-query" && (
        <MemoryChat locale={locale} />
      )}

      {activeTab === "ict-flint-demo" && (
        <IctFlintDemo locale={locale} />
      )}

      {activeTab === "flint-demo" && (
        <FlintDemo locale={locale} />
      )}

      {activeTab === "station-reports" && (
        <StationReports locale={locale} />
      )}

      {activeTab !== "dashboard" && activeTab !== "memory-query" && activeTab !== "ict-flint-demo" && activeTab !== "flint-demo" && activeTab !== "station-reports" && (
        <>
          <div className="page-header" style={{ marginBottom: 4 }}>
            <div>
              <h2 data-testid="reports.active-title">{t(reportTabI18nKey[activeTab], locale)}</h2>
              {currentData?.meta && (
                <p>
                  {t("report.generatedAt", locale)}: {new Date(currentData.meta.generatedAt).toLocaleString()}
                  {" · "}{t("report.totalRows", locale).replace("{n}", String(currentData.meta.totalRows))}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {/* Period switcher for time-aware reports */}
              {isPeriodReport && (
                <div className="toolbar" role="group" aria-label={t("report.period", locale)} data-testid="reports.period" style={{ gap: 6 }}>
                  {(["daily", "weekly", "monthly"] as ReportPeriod[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={period === p ? "active" : ""}
                      title={t(`report.period.${p}`, locale)}
                      onClick={() => setPeriod(p)}
                    >
                      {t(`report.period.${p}`, locale)}
                    </button>
                  ))}
                </div>
              )}
              <a href={exportUrl} download className="action-button" style={{ textDecoration: "none" }} data-testid="reports.export-csv" title={t("report.export.csv", locale)}>
                {t("report.export.csv", locale)}
              </a>
              <button type="button" className="action-button" data-testid="reports.export-all" onClick={exportAllReports} disabled={exportingAllReports} title={t("report.export.all", locale)}>
                {exportingAllReports ? t("report.export.preparing", locale) : t("report.export.all", locale)}
              </button>
              <button type="button" className="action-button" data-testid="reports.export-sessions" onClick={exportReportHistory} disabled={reportSessions.length === 0} title={t("report.export.sessionsTooltip", locale)}>
                {t("report.export.sessions", locale)} ({reportSessions.length})
              </button>
            </div>
          </div>

          <ReportFilterBar reportKey={activeTab} filters={filters} onChange={(f) => setFilters(f)} locale={locale} />

          {loading[activeTab] ? (
            <div className="empty-state" role="status" data-testid="reports.loading">{t("report.loading", locale)}</div>
          ) : currentData ? (
            <ReportTable data={currentData} locale={locale} />
          ) : (
            <div className="empty-state" data-testid="reports.empty"><strong>{t("report.noData", locale)}</strong></div>
          )}
        </>
      )}
    </section>
  );
}
// @ts-nocheck
