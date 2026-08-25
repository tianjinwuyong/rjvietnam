import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Settings } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { StagnationLog, StagnationThreshold } from "../api/mes";

/* ── Dropdown options (mirrors Excel dataValidations in 产品呆滞 sheet) ── */
const CUSTOMER_OPTIONS  = ["NetBit", "RJ", "Anker"];
const MODEL_OPTIONS     = ["EPS48R1-36", "EPS36R0-36", "EPS18R1G-36"];
const PO_OPTIONS        = ["RJ-VN-PO-240611", "RJ-VN-PO-240612", "RJ-VN-PO-240613", "RJ-VN-PO-26061901"];
const STATION_OPTIONS   = [
  "SMT-AOI", "MI-loadion", "WS-AOI", "ICT", "FCT", "PCBA Divid", "PCBA_link",
  "ATE1", "Ultrasonic", "BI_loading", "Burn-in", "Hi-pot", "ATE2", "CODE-LINK", "PACKING",
];
const LINE_OPTIONS      = Array.from({ length: 24 }, (_, i) => String(i + 1));

/* ── Badge helpers ── */
const levelBadgeClass: Record<string, string> = {
  normal:   "badge-ok",
  warning:  "badge-warning",
  alert:    "badge-danger",
  critical: "badge-critical",
};

/* ── Overdue months formatter ── */
function formatOverdueMinutes(minutes: number | undefined): string {
  if (minutes == null) return "—";
  const months = minutes / (30 * 24 * 60);
  return `${months.toFixed(1)}`;
}

/* ── Row renderer ── */
function StagnationRow({
  row, idx, locale,
}: {
  row: StagnationLog;
  idx: number;
  locale: Locale;
}) {
  return (
    <tr>
      <td style={{ textAlign: "center" }}>{idx}</td>
      <td>{row.customerCode ?? "—"}</td>
      <td>{row.productModel ?? "—"}</td>
      <td>{row.sn}</td>
      <td>{row.pcbNo ?? "—"}</td>
      <td>{row.laserQrDate ? new Date(row.laserQrDate).toLocaleDateString() : "—"}</td>
      <td>{row.stationCode}</td>
      <td>{row.whLocation ?? "—"}</td>
      <td style={{ textAlign: "center" }}>{formatOverdueMinutes(row.stagnationMinutes)}</td>
      <td>{row.workOrderCode ?? "—"}</td>
      <td>{row.poNumber ?? "—"}</td>
      <td>{row.notes ?? "—"}</td>
    </tr>
  );
}

/* ── Main component ── */
export function StagnationTracking({ locale }: { locale: Locale }) {
  /* ── Filter state (mirrors Excel B3-B9 header) ── */
  const [filters, setFilters] = useState({
    customer:        "",
    model:           "",
    fromStation:     "",
    toStation:       "",
    overdueMonths:   "",   // Excel B6 threshold input
    lineCode:        "",
    poNumber:        "",
    productModel:   "",
  });
  const [showFilters, setShowFilters] = useState(false);

  /* ── Data state ── */
  const [logs, setLogs]               = useState<StagnationLog[]>([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const [totalCount, setTotalCount]   = useState(0);

  /* ── Threshold panel ── */
  const [thresholds, setThresholds]   = useState<StagnationThreshold[]>([]);
  const [showThresholds, setShowThresholds] = useState(false);

  /* ── Load data ── */
  function load() {
    setLoading(true);
    const params: Parameters<typeof mesApi.getStagnation>[0] = {
      status: statusFilter === "open" ? "open" : undefined,
      limit: 500,
    };
    if (filters.customer)        params.customer     = filters.customer;
    if (filters.model)           params.model        = filters.model;
    if (filters.fromStation)     params.fromStation  = filters.fromStation;
    if (filters.toStation)       params.toStation    = filters.toStation;
    if (filters.poNumber)        params.poNumber     = filters.poNumber;
    if (filters.lineCode)        params.lineCode     = filters.lineCode;
    if (filters.productModel)    params.model = filters.productModel;
    if (filters.overdueMonths) {
      const minMinutes = Number(filters.overdueMonths) * 30 * 24 * 60;
      if (!isNaN(minMinutes)) params.overdueMonthsMin = minMinutes;
    }
    Promise.all([
      mesApi.getStagnation(params),
      mesApi.getStagnationThresholds(),
    ])
      .then(([logsRes, thrRes]) => {
        setLogs(logsRes.items);
        setTotalCount(logsRes.total ?? logsRes.items.length);
        setThresholds(thrRes.items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, [statusFilter]);

  function handleFilterChange(field: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  function clearFilters() {
    setFilters({ customer: "", model: "", fromStation: "", toStation: "", overdueMonths: "", lineCode: "", poNumber: "", productModel: "" });
    load();
  }

  /* ── Summary ── */
  const openCount    = logs.filter((l) => l.status === "open").length;
  const criticalRows = logs.filter((l) => l.stagnationLevel === "critical" || l.stagnationLevel === "alert").length;

  /* ── Field definitions for the filter grid (matches Excel B3-B9 layout) ── */
  const filterFields: Array<{ key: keyof typeof filters; labelKey: string; type?: string; options?: string[] }> = [
    { key: "customer",      labelKey: "mes.stagnation.customer",      type: "select", options: CUSTOMER_OPTIONS },
    { key: "model",         labelKey: "mes.stagnation.modelDropdown", type: "select", options: MODEL_OPTIONS },
    { key: "fromStation",   labelKey: "mes.stagnation.fromStation",   type: "select", options: STATION_OPTIONS },
    { key: "toStation",     labelKey: "mes.stagnation.toStation",     type: "select", options: STATION_OPTIONS },
    { key: "overdueMonths", labelKey: "mes.stagnation.overdueMonths", type: "number" },
    { key: "lineCode",      labelKey: "mes.stagnation.line",          type: "select", options: LINE_OPTIONS },
    { key: "poNumber",      labelKey: "mes.scrap.poNumber",          type: "select", options: PO_OPTIONS },
  ];

  return (
    <div className="screen-stack">

      {/* ── Summary cards ──────────────────────────── */}
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("mes.stagnation.filter.open" as any, locale)}</span>
          <strong>{openCount}</strong>
          <span className={`badge ${openCount > 0 ? "badge-warning" : "badge-ok"}`}>
            {t("mes.stagnation.status" as any, locale)}
          </span>
        </article>
        <article className="stat-card">
          <span>{t("mes.stagnation.level.critical" as any, locale)}</span>
          <strong>{criticalRows}</strong>
          <span className={`badge ${criticalRows > 0 ? "badge-danger" : "badge-ok"}`}>
            <AlertCircle size={12} />
          </span>
        </article>
        <article className="stat-card">
          <span>{t("common.total" as any, locale)}</span>
          <strong>{totalCount}</strong>
          <span className="badge badge-info">{t("mes.stagnation.title" as any, locale)}</span>
        </article>
      </div>

      {/* ── Toolbar ──────────────────────────────────── */}
      <div className="toolbar">
        <button type="button" className={`action-button ${statusFilter === "open" ? "active" : ""}`} onClick={() => setStatusFilter("open")}>
          {t("mes.stagnation.filter.open" as any, locale)}
        </button>
        <button type="button" className={`action-button ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
          {t("mes.stagnation.filter.all" as any, locale)}
        </button>
        <button type="button" className={`action-button ${showFilters ? "active" : ""}`} onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? t("common.cancel" as any, locale) : "🔍 " + t("common.filter" as any, locale)}
        </button>
        <button type="button" className={`action-button ${showThresholds ? "active" : ""}`} style={{ marginLeft: "auto" }} onClick={() => setShowThresholds(!showThresholds)}>
          <Settings size={14} />
          {t("mes.stagnation.threshold" as any, locale)}
        </button>
        <button type="button" className="action-button" style={{ marginLeft: 4 }}
          onClick={() => {
            const params = new URLSearchParams();
            if (filters.customer)      params.set("customer", filters.customer);
            if (filters.model)         params.set("model", filters.model);
            if (filters.fromStation)   params.set("fromStation", filters.fromStation);
            if (filters.toStation)     params.set("toStation", filters.toStation);
            if (filters.overdueMonths) params.set("overdueMonths", filters.overdueMonths);
            if (filters.lineCode)      params.set("lineCode", filters.lineCode);
            if (filters.poNumber)      params.set("poNumber", filters.poNumber);
            params.set("status", statusFilter === "all" ? "all" : "open");
            const token = sessionStorage.getItem("auth_token");
            const url = `/api/mes/stagnation/export?${params.toString()}`;
            fetch(url, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); })
              .then(blob => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `产品呆滞追踪_${new Date().toISOString().slice(0,10)}.xlsx`;
                a.click();
                URL.revokeObjectURL(a.href);
              })
              .catch(e => alert("导出失败: " + e.message));
          }}>
          📥 {t("common.export" as any, locale) || "导出Excel"}
        </button>
      </div>

      {/* ── Filter bar (Excel 表头横向固定行风格) ── */}
      {showFilters && (
        <section className="excel-filter-bar">
          <table className="excel-filter-table">
            <thead>
              <tr>
                {filterFields.map(({ key, labelKey, type, options }) => (
                  <th key={key}>
                    <span className="excel-filter-label">
                      {labelKey === "mes.stagnation.modelDropdown"
                        ? t("mes.stagnation.modelDropdown" as any, locale)
                        : labelKey === "mes.stagnation.overdueMonths"
                          ? t("mes.stagnation.overdueMonths" as any, locale)
                          : t(labelKey as any, locale)}
                    </span>
                    {type === "select" && options ? (
                      <div className="excel-picker">
                        <select
                          value={(filters as any)[key]}
                          onChange={(e) => handleFilterChange(key, e.target.value)}
                        >
                          <option value="">— 全部 —</option>
                          {options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                        <span className="picker-arrow">▾</span>
                      </div>
                    ) : (
                      <input
                        className="excel-input"
                        type={type === "number" ? "number" : "text"}
                        value={(filters as any)[key]}
                        onChange={(e) => handleFilterChange(key, e.target.value)}
                        placeholder={type === "number" ? "" : ""}
                        min={0}
                      />
                    )}
                  </th>
                ))}
                {/* 操作列 */}
                <th className="excel-filter-actions">
                  <button type="button" className="action-button" onClick={load}>
                    {t("common.filter" as any, locale)}
                  </button>
                  <button type="button" className="action-button" onClick={clearFilters}>
                    {t("common.clear" as any, locale)}
                  </button>
                </th>
              </tr>
            </thead>
          </table>
        </section>
      )}

      {/* ── Threshold settings panel ──────────────── */}
      {showThresholds && thresholds.length > 0 && (
        <section className="surface-panel">
          <div className="section-header">
            <h2>{t("mes.stagnation.threshold" as any, locale)}</h2>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("mes.stagnation.station" as any, locale)}</th>
                  <th>{t("mes.stagnation.level.warning" as any, locale)} (min)</th>
                  <th>{t("mes.stagnation.level.alert" as any, locale)} (min)</th>
                  <th>{t("mes.stagnation.level.critical" as any, locale)} (min)</th>
                  <th>{t("common.status" as any, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((thr) => (
                  <tr key={thr.stationCode}>
                    <td>{thr.stationCode}</td>
                    <td style={{ color: "var(--warn)" }}>{thr.warningMinutes}</td>
                    <td style={{ color: "var(--danger)" }}>{thr.alertMinutes}</td>
                    <td style={{ color: "var(--critical)" }}>{thr.criticalMinutes}</td>
                    <td><span className={`badge ${thr.status === "active" ? "badge-ok" : "badge-warning"}`}>{thr.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Main table (mirrors Excel 产品呆滞 rows 11-I22) ── */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mes.stagnation.title" as any, locale)}</h2>
            <p>{t("section.timeline" as any, locale)}</p>
          </div>
        </div>

        {loading ? (
          <div className="placeholder-view">{t("common.loading" as any, locale)}</div>
        ) : logs.length === 0 ? (
          <div className="placeholder-view">
            <CheckCircle size={40} />
            <p>{t("common.noData" as any, locale)}</p>
          </div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "center", width: 40 }}>No.</th>
                  <th>{t("mes.stagnation.customer" as any, locale)}</th>
                  <th>{t("mes.stagnation.productModel" as any, locale)}</th>
                  <th>{t("mes.stagnation.sn" as any, locale)}</th>
                  <th>{t("mes.stagnation.pcbNo" as any, locale)}</th>
                  <th>{t("mes.stagnation.laserQrDate" as any, locale)}</th>
                  <th>{t("mes.stagnation.station" as any, locale)}</th>
                  <th>{t("mes.stagnation.whLocation" as any, locale)}</th>
                  <th style={{ textAlign: "center" }}>{t("mes.stagnation.overdueMonths" as any, locale)}</th>
                  <th>{t("mes.stagnation.workOrder" as any, locale)}</th>
                  <th>{t("mes.scrap.poNumber" as any, locale)}</th>
                  <th>{t("common.notes" as any, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row, i) => (
                  <StagnationRow key={row.id} row={row} idx={i + 1} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}