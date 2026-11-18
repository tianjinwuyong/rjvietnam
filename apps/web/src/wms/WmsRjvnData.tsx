/**
 * WmsRjvnData — read-only browser for the `public.rjvn_*` mirror tables.
 *
 * The mirror is a 1:1 copy of the source `wms` database (loaded by
 * scripts/etl/rjvn-wms-load.mjs). Nothing here writes to it: all mutations
 * still go through the canonical smt WMS tables and their own pages.
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type IqcOverview = Awaited<ReturnType<typeof wmsApi.getRjvnIqcOverview>>;

interface TableInfo { name: string; approx_rows: number }
interface TableData {
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  columns: string[];
}

const SUMMARY_LABELS: Record<string, string> = {
  material: "wms.rjvn.material",
  supplier: "wms.rjvn.supplier",
  bom: "wms.rjvn.bom",
  receipt_order: "wms.rjvn.receipt",
  iqc_lot: "wms.rjvn.iqcLot",
  iqc_lot_receipt: "wms.rjvn.iqcLotReceipt",
  iqc_report: "wms.rjvn.iqcReport",
  inventory: "wms.rjvn.inventory",
};

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function WmsRjvnData({ locale }: { locale: Locale }) {
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [iqc, setIqc] = useState<IqcOverview | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState("rjvn_material");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;

  useEffect(() => {
    void Promise.all([wmsApi.getRjvnSummary(), wmsApi.getRjvnTables(), wmsApi.getRjvnIqcOverview()])
      .then(([s, tbls, overview]) => {
        setSummary(s);
        setTables(tbls);
        setIqc(overview);
        setLoading(false);
      })
      .catch((e) => { setError(String(e?.message ?? e)); setLoading(false); });
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void wmsApi.getRjvnTableData(table, { q: q || undefined, limit, offset })
      .then((r) => { if (live) { setResult(r); setLoading(false); setError(""); } })
      .catch((e) => { if (live) { setError(String(e?.message ?? e)); setLoading(false); } });
    return () => { live = false; };
  }, [table, q, offset]);

  const total = result?.total ?? 0;
  const maxOffset = Math.max(0, Math.ceil(total / limit) - 1) * limit;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rjvn.title", locale)}</h2>
            <p>{t("wms.rjvn.desc", locale)}</p>
          </div>
          <span className="pill pill-muted">{t("wms.rjvn.readOnly", locale)}</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="stat-grid">
          {Object.entries(SUMMARY_LABELS).map(([key, labelKey]) => (
            <div className="stat-card" key={key}>
              <span className="stat-label">{t(labelKey, locale)}</span>
              <strong className="stat-value">{(summary[key] ?? 0).toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </section>

      {iqc && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.rjvn.iqcOverview", locale)}</h2>
              <p>
                {t("wms.rjvn.passRate", locale)}:{" "}
                {iqc.totals.lots ? Math.round((iqc.totals.passed / iqc.totals.lots) * 100) : 0}% ·{" "}
                {iqc.totals.pending} {t("wms.rjvn.pending", locale)}
              </p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("wms.rjvn.supplier", locale)}</th>
                  <th>{t("wms.rjvn.lots", locale)}</th>
                  <th>{t("wms.rjvn.passed", locale)}</th>
                  <th>{t("wms.rjvn.passRate", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {iqc.bySupplier.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.lots}</td>
                    <td>{row.passed}</td>
                    <td>{row.lots ? Math.round((row.passed / row.lots) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="toolbar">
          <label className="field">
            <span>{t("wms.rjvn.pickTable", locale)}</span>
            <select value={table} onChange={(e) => { setTable(e.target.value); setOffset(0); }}>
              {tables.map((ti) => (
                <option key={ti.name} value={ti.name}>
                  {ti.name} ({ti.approx_rows.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <label className="field field-grow">
            <span>{t("wms.rjvn.search", locale)}</span>
            <input
              value={q}
              placeholder={t("wms.rjvn.searchPlaceholder", locale)}
              onChange={(e) => { setQ(e.target.value); setOffset(0); }}
            />
          </label>
          <span className="muted">{total.toLocaleString()} {t("wms.rjvn.rows", locale)}</span>
        </div>

        {loading && !result ? (
          <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
        ) : result && result.rows.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => <td key={c} title={cell(row[c])}>{cell(row[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="toolbar toolbar-end">
              <button type="button" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
                {t("wms.rjvn.prev", locale)}
              </button>
              <span className="muted">{Math.floor(offset / limit) + 1} / {Math.floor(maxOffset / limit) + 1}</span>
              <button type="button" disabled={offset >= maxOffset} onClick={() => setOffset((o) => o + limit)}>
                {t("wms.rjvn.next", locale)}
              </button>
            </div>
          </>
        ) : (
          <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
        )}
      </section>
    </div>
  );
}
