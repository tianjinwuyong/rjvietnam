/**
 * WmsCanonicalData — read-only browser for the rjvn data AFTER import into the
 * official smt business tables. Backend: services/api/src/rjvn-canonical-api.js
 * This is the "import is really usable" page: materials/suppliers/lots/receipts/
 * inspections/BOM/picking now carry the imported rows and translations.
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const ENTITIES = [
  { key: "materials", cols: ["code", "name_zh", "name_en", "name_vi", "uom", "status"] },
  { key: "suppliers", cols: ["code", "name_zh", "name_en", "name_vi", "country", "status"] },
  { key: "lots", cols: ["lot_no", "material_code", "material_name", "supplier_code", "received_qty", "iqc_status", "lot_status"] },
  { key: "receipts", cols: ["receipt_no", "receipt_date", "material_code", "supplier_code", "batch_no", "quantity", "status"] },
  { key: "inspections", cols: ["inspection_no", "lot_no", "received_qty", "result", "inspection_date", "remarks"] },
  { key: "boms", cols: ["product_code", "product_name", "revision", "status", "source_file_name"] },
  { key: "bom-lines", cols: ["material_code", "material_name_zh", "qty_per", "unit", "process_stage"] },
  { key: "picking", cols: ["picking_no", "work_order_no", "work_section", "total_qty", "status"] },
  { key: "reels", cols: ["picking_no", "material_code", "material_name", "pick_qty", "actual_qty", "received_qty"] },
];
// Column labels are i18n keys — never hardcoded UI strings (AGENTS.md).
const HEADERS: Record<string, string> = Object.fromEntries(
  ["code", "name_zh", "name_en", "name_vi", "uom", "status", "country", "lot_no",
   "material_code", "material_name", "material_name_zh", "supplier_code", "received_qty",
   "iqc_status", "lot_status", "receipt_no", "receipt_date", "batch_no", "quantity",
   "inspection_no", "result", "inspection_date", "remarks", "product_code", "product_name",
   "revision", "source_file_name", "qty_per", "unit", "process_stage", "picking_no",
   "work_order_no", "work_section", "total_qty", "pick_qty", "actual_qty"]
    .map((c) => [c, `wms.canonical.col.${c}`]));

export function WmsCanonicalData({ locale }: { locale: Locale }) {
  const [summary, setSummary] = useState<{
    counts: Record<string, number>; map: Record<string, number>;
    translation: Record<string, { translated: number; pending: number }>;
  } | null>(null);
  const [entity, setEntity] = useState("materials");
  const cfg = ENTITIES.find((e) => e.key === entity) ?? ENTITIES[0];
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    wmsApi.getCanonicalSummary().then(setSummary).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await wmsApi.getCanonicalList(entity, { q: q || undefined, limit: 50 });
      setRows(r.rows ?? []); setTotal(r.total ?? 0); setError("");
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
    finally { setLoading(false); }
  }, [entity, q]);

  // Debounced load on filter/entity change; a single effect avoids duplicate requests.
  useEffect(() => {
    const tm = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(tm);
  }, [load, q]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.canonical.title", locale)}</h2>
            <p>{t("wms.canonical.desc", locale)}</p>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="stat-grid">
          {summary ? Object.entries(summary.counts).slice(0, 6).map(([k, v]) => (
            <div className="stat-card" key={k}>
              <span className="stat-label">{k.replace(/_/g, " ")}</span>
              <strong className="stat-value">{typeof v === "number" ? v.toLocaleString() : v}</strong>
            </div>
          )) : <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>}
        </div>
        {summary && (
          <p style={{ marginTop: 10, opacity: .8, fontSize: 13 }}>
            {t("wms.canonical.mapping", locale)}: {Object.entries(summary.map).map(([k, v]) => `${k}=${v}`).join(" · ")}
            {" | "}{t("wms.canonical.translation", locale)}: {
              Object.entries(summary.translation).map(([k, v]) => `${k} ${v.translated}/${v.translated + v.pending}`).join(" · ")
            }
          </p>
        )}
        <div className="toolbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
          {ENTITIES.map((e) => (
            <button key={e.key} type="button" className={entity === e.key ? "active" : ""}
              onClick={() => setEntity(e.key)}>
              {t(`wms.canonical.tab.${e.key}`, locale)}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="toolbar">
          <label className="field field-grow"><span>{t("wms.rjvn.search", locale)}</span>
            <input value={q} placeholder={t("wms.rjvn.searchPlaceholder", locale)} onChange={(e) => setQ(e.target.value)} /></label>
          <span className="stat-label">{t("wms.rjvnInventory.total", locale)}: {total.toLocaleString()}</span>
        </div>
        {loading && rows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
          : rows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
          : (
            <div className="table-scroll"><table className="data-table">
              <thead><tr>{cfg.cols.map((c) => <th key={c}>{t(HEADERS[c] ?? c, locale)}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>{cfg.cols.map((c) => {
                  const val = str(r[c]);
                  return <td key={c} title={val}>{val.length > 60 ? val.slice(0, 60) + "…" : val}</td>;
                })}</tr>
              ))}</tbody>
            </table></div>
          )}
      </section>
    </div>
  );
}
