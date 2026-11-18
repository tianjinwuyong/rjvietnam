/**
 * WmsRjvnDocFlow — remaining rjvn document flows in one page.
 * Backend: services/api/src/rjvn-docflow.js
 * Covers stock-take / mrb / supplier-return / over-picking.
 * NOTE: source mirror tables are 0 rows; pages show empty states until data is imported.
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

type Kind = "stock-take" | "mrb" | "supplier-return" | "over-picking";
const KINDS: Array<{ key: Kind; no: string; cols: string[]; actions: string[] }> = [
  { key: "stock-take", no: "take_no", cols: ["warehouse_name", "total_lines", "book_qty_total"], actions: ["submit", "approve", "cancel"] },
  { key: "mrb", no: "mrb_no", cols: ["batch_no", "quantity", "final_decision"], actions: ["submit", "final-approve", "reject"] },
  { key: "supplier-return", no: "return_no", cols: ["supplier_name", "total_qty", "out_qty"], actions: ["outbound", "cancel"] },
  { key: "over-picking", no: "order_no", cols: ["work_order_no", "total_qty", "applicant_name"], actions: ["approve", "cancel"] },
];
const LABEL: Record<string, string> = {
  "submit": "提交", "approve": "批准", "cancel": "取消", "final-approve": "终审通过",
  "reject": "驳回", "outbound": "出库",
};

export function WmsRjvnDocFlow({ locale }: { locale: Locale }) {
  const [kind, setKind] = useState<Kind>("stock-take");
  const cfg = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ order: Row; items: Row[]; logs?: Row[] } | null>(null);
  const [remark, setRemark] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await wmsApi.getRjvnDocList(kind, { q: q || undefined, status: status || undefined, limit: 50 });
      setRows(r.rows ?? []); setTotal(r.total ?? 0); setByStatus(r.byStatus ?? {});
    } catch (e) { setFeedback(`ERR: ${String((e as Error)?.message ?? e)}`); }
    finally { setLoading(false); }
  }, [kind, q, status]);

  useEffect(() => { setSelected(null); setDetail(null); setQ(""); setStatus(""); setFeedback(""); }, [kind]);
  // Single debounced load; load already depends on kind/q/status.
  useEffect(() => {
    const tm = setTimeout(() => void load(), q || status ? 300 : 0);
    return () => clearTimeout(tm);
  }, [load, q, status]);

  const openDetail = useCallback(async (id: string) => {
    setSelected(id); setDetail(null);
    try { setDetail(await wmsApi.getRjvnDocDetail(kind, id)); }
    catch (e) { setFeedback(`ERR: ${String((e as Error)?.message ?? e)}`); }
  }, [kind]);

  const act = useCallback(async (action: string) => {
    if (!selected) return;
    setBusy(true); setFeedback("");
    try {
      await wmsApi.rjvnDocAction(kind, selected, action, { remark, approvalRemark: remark });
      setFeedback(`${LABEL[action] ?? action}: ${t("wms.rjvnInventory.done", locale)}`);
      setRemark("");
      await load();
      setDetail(await wmsApi.getRjvnDocDetail(kind, selected));
    } catch (e) { setFeedback(`ERR: ${String((e as Error)?.message ?? e)}`); }
    finally { setBusy(false); }
  }, [selected, kind, remark, load, locale]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rjvnDoc.title", locale)}</h2>
            <p>{t("wms.rjvnDoc.desc", locale)}</p>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          {KINDS.map((k) => (
            <button key={k.key} type="button" className={kind === k.key ? "active" : ""}
              onClick={() => setKind(k.key)}>
              {t(`wms.rjvnDoc.${k.key}`, locale)}
            </button>
          ))}
        </div>
        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat-card"><span className="stat-label">{t("wms.rjvnDoc.total", locale)}</span><strong className="stat-value">{total}</strong></div>
          {Object.entries(byStatus).map(([s, n]) => (
            <div className="stat-card" key={s}><span className="stat-label">{s}</span><strong className="stat-value">{n}</strong></div>
          ))}
        </div>
        {feedback && <div className={`alert ${feedback.startsWith("ERR:") ? "alert-error" : "alert-info"}`}>{feedback}</div>}
      </section>

      <section className="surface-panel">
        <div className="toolbar">
          <label className="field field-grow"><span>{t("wms.rjvn.search", locale)}</span>
            <input value={q} placeholder={t("wms.rjvn.searchPlaceholder", locale)} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="field"><span>{t("wms.rjvnInventory.status", locale)}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("wms.rjvnInventory.all", locale)}</option>
              {Object.keys(byStatus).map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
        </div>
        {loading && rows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
          : rows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
          : (
            <div className="table-scroll"><table className="data-table">
              <thead><tr><th>{t("wms.rjvnDoc.no", locale)}</th>
                {cfg.cols.map((c) => <th key={c}>{c}</th>)}
                <th>{t("wms.rjvnInventory.status", locale)}</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} style={{ cursor: "pointer" }} onClick={() => void openDetail(str(r.id))}>
                  <td>{str(r[cfg.no])}</td>
                  {cfg.cols.map((c) => <td key={c}>{str(r[c])}</td>)}
                  <td>{str(r.status)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </section>

      {selected && (
        <section className="surface-panel">
          <div className="section-header">
            <div><h2>{t("wms.rjvnDoc.detail", locale)}</h2>
              <p>{detail ? `${str(detail.order[cfg.no])} · ${str(detail.order.status)}` : t("wms.rjvn.loading", locale)}</p></div>
          </div>
          {detail && (
            <>
              <div className="toolbar">
                <label className="field field-grow"><span>{t("wms.rjvnInventory.reason", locale)}</span>
                  <input value={remark} onChange={(e) => setRemark(e.target.value)} /></label>
                {cfg.actions.map((a) => (
                  <button key={a} type="button" disabled={busy} onClick={() => void act(a)}>
                    {LABEL[a] ?? a}
                  </button>
                ))}
              </div>
              <div className="table-scroll"><table className="data-table">
                <tbody>
                  {Object.entries(detail.order).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
                    <tr key={k}><th>{k}</th><td>{str(v)}</td></tr>
                  ))}
                </tbody>
              </table></div>
              <h3 style={{ margin: "16px 0 8px" }}>{t("wms.rjvnDoc.lines", locale)} ({detail.items.length})</h3>
              {detail.items.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div> : (
                <div className="table-scroll"><table className="data-table">
                  <thead><tr>{Object.keys(detail.items[0]).filter((k) => !k.startsWith("_")).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                  <tbody>{detail.items.map((r, i) => (
                    <tr key={i}>{Object.keys(detail.items[0]).filter((k) => !k.startsWith("_")).map((k) => <td key={k}>{str(r[k])}</td>)}</tr>
                  ))}</tbody>
                </table></div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
