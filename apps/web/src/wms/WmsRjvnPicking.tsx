/**
 * WmsRjvnPicking — picking core ported from D:\rj\rjvn\WMS-20261019 (workorder module).
 * Backend: services/api/src/rjvn-picking.js
 *   list/detail/approve/pick(FIFO stock deduct)/receive/reels
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function WmsRjvnPicking({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [subTab, setSubTab] = useState<"orders" | "reels">("orders");
  const [reels, setReels] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ order: Row; items: Row[] } | null>(null);
  const [pickQty, setPickQty] = useState<Record<string, string>>({});
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, rl] = await Promise.all([
        wmsApi.getRjvnPickingList({ q: q || undefined, status: status || undefined, limit: 50 }),
        wmsApi.getRjvnPickingReels({ limit: 50 }),
      ]);
      setRows(list.rows ?? []); setTotal(list.total ?? 0); setByStatus(list.byStatus ?? {});
      setReels(rl.rows ?? []);
      setError("");
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
    finally { setLoading(false); }
  }, [q, status]);

  // Single debounced load; load already depends on q/status.
  useEffect(() => {
    const tm = setTimeout(() => void load(), q || status ? 300 : 0);
    return () => clearTimeout(tm);
  }, [load, q, status]);

  const openDetail = useCallback(async (id: string) => {
    setSelected(id); setDetail(null); setFeedback("");
    try {
      const d = await wmsApi.getRjvnPickingDetail(id);
      setDetail(d);
      setPickQty(Object.fromEntries((d.items ?? []).map((i) => [str(i.id), str(i.pick_qty)])));
      setRecvQty(Object.fromEntries((d.items ?? []).map((i) => [str(i.id), str(i.actual_qty ?? i.pick_qty)])));
    } catch (e) { setFeedback(`ERR: ${String((e as Error)?.message ?? e)}`); }
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setFeedback("");
    try {
      const r = await fn() as { data?: { order?: Row } };
      setFeedback(ok);
      await load();
      if (selected) {
        const d = await wmsApi.getRjvnPickingDetail(selected);
        setDetail(d);
      }
    } catch (e) { setFeedback(`ERR: ${String((e as Error)?.message ?? e)}`); }
    finally { setBusy(false); }
  }, [load, selected]);

  const orderStatus = detail ? str(detail.order.status) : "";

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rjvnPicking.title", locale)}</h2>
            <p>{t("wms.rjvnPicking.desc", locale)}</p>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="stat-grid">
          <div className="stat-card"><span className="stat-label">{t("wms.rjvnPicking.total", locale)}</span><strong className="stat-value">{total}</strong></div>
          {Object.entries(byStatus).map(([s, n]) => (
            <div className="stat-card" key={s}><span className="stat-label">{s}</span><strong className="stat-value">{n}</strong></div>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className={subTab === "orders" ? "active" : ""} onClick={() => setSubTab("orders")}>{t("wms.rjvnPicking.tabOrders", locale)}</button>
          <button type="button" className={subTab === "reels" ? "active" : ""} onClick={() => setSubTab("reels")}>{t("wms.rjvnPicking.tabReels", locale)}</button>
        </div>
        {feedback && <div className={`alert ${feedback.startsWith("ERR:") ? "alert-error" : "alert-info"}`}>{feedback}</div>}
      </section>

      {subTab === "orders" && (
        <>
          <section className="surface-panel">
            <div className="toolbar">
              <label className="field field-grow"><span>{t("wms.rjvn.search", locale)}</span>
                <input value={q} placeholder={t("wms.rjvn.searchPlaceholder", locale)} onChange={(e) => setQ(e.target.value)} /></label>
              <label className="field"><span>{t("wms.rjvnInventory.status", locale)}</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t("wms.rjvnInventory.all", locale)}</option>
                  <option value="pending_approval">pending_approval</option>
                  <option value="approved">approved</option>
                  <option value="issued">issued</option>
                  <option value="received">received</option>
                </select></label>
            </div>
            {loading && rows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
              : rows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
              : (
                <div className="table-scroll"><table className="data-table">
                  <thead><tr>
                    <th>{t("wms.rjvnPicking.pickingNo", locale)}</th>
                    <th>{t("wms.rjvnPicking.workOrder", locale)}</th>
                    <th>{t("wms.rjvnPicking.section", locale)}</th>
                    <th>{t("wms.rjvnReceipt.qty", locale)}</th>
                    <th>{t("wms.rjvnInventory.status", locale)}</th>
                  </tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i} style={{ cursor: "pointer" }} onClick={() => void openDetail(str(r.id))}>
                      <td>{str(r.picking_no)}</td><td>{str(r.work_order_no)}</td>
                      <td>{str(r.work_section)}</td><td>{str(r.total_qty)}</td><td>{str(r.status)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
          </section>

          {selected && (
            <section className="surface-panel">
              <div className="section-header">
                <div><h2>{t("wms.rjvnPicking.detail", locale)}</h2>
                  <p>{detail ? `${str(detail.order.picking_no)} · ${orderStatus}` : t("wms.rjvn.loading", locale)}</p></div>
                {detail && (
                  <div className="toolbar">
                    {orderStatus === "pending_approval" && (
                      <>
                        <button type="button" disabled={busy} onClick={() => void act(() => wmsApi.approveRjvnPicking(selected, { pass: true }), t("wms.rjvnInventory.done", locale))}>{t("wms.rjvnPicking.approve", locale)}</button>
                        <button type="button" disabled={busy} onClick={() => void act(() => wmsApi.approveRjvnPicking(selected, { pass: false }), t("wms.rjvnInventory.done", locale))}>{t("wms.rjvnPicking.reject", locale)}</button>
                      </>
                    )}
                    {orderStatus === "approved" && (
                      <button type="button" disabled={busy} onClick={() => void act(() => wmsApi.pickRjvnPicking(selected, {
                        items: (detail.items ?? []).filter((i) => Number(pickQty[str(i.id)]) > 0)
                          .map((i) => ({ id: str(i.id), actualQty: Number(pickQty[str(i.id)]) })),
                      }), t("wms.rjvnInventory.done", locale))}>{t("wms.rjvnPicking.pick", locale)}</button>
                    )}
                    {(orderStatus === "issued" || orderStatus === "completed") && (
                      <button type="button" disabled={busy} onClick={() => void act(() => wmsApi.receiveRjvnPicking(selected, {
                        items: (detail.items ?? []).map((i) => ({ id: str(i.id), receivedQty: Number(recvQty[str(i.id)]) || 0 })),
                        remark: "E2E",
                      }), t("wms.rjvnInventory.done", locale))}>{t("wms.rjvnPicking.receive", locale)}</button>
                    )}
                  </div>
                )}
              </div>
              {detail && (
                <div className="table-scroll"><table className="data-table">
                  <thead><tr>
                    <th>{t("wms.rjvnIqc.material", locale)}</th>
                    <th>{t("wms.rjvnPicking.pickQty", locale)}</th>
                    <th>{t("wms.rjvnPicking.actualQty", locale)}</th>
                    <th>{t("wms.rjvnPicking.receivedQty", locale)}</th>
                  </tr></thead>
                  <tbody>{(detail.items ?? []).map((i, n) => (
                    <tr key={n}>
                      <td>{str(i.material_code)} {str(i.material_name)}</td>
                      <td>{str(i.pick_qty)}</td>
                      <td>{orderStatus === "approved"
                        ? <input type="number" min="0" value={pickQty[str(i.id)] ?? ""}
                            onChange={(e) => setPickQty({ ...pickQty, [str(i.id)]: e.target.value })} />
                        : str(i.actual_qty)}</td>
                      <td>{(orderStatus === "issued" || orderStatus === "completed")
                        ? <input type="number" min="0" value={recvQty[str(i.id)] ?? ""}
                            onChange={(e) => setRecvQty({ ...recvQty, [str(i.id)]: e.target.value })} />
                        : str(i.received_qty)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
          )}
        </>
      )}

      {subTab === "reels" && (
        <section className="surface-panel">
          <div className="section-header"><div><h2>{t("wms.rjvnPicking.tabReels", locale)}</h2></div></div>
          {reels.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div> : (
            <div className="table-scroll"><table className="data-table">
              <thead><tr>
                <th>Reel No</th><th>{t("wms.rjvnIqc.material", locale)}</th>
                <th>{t("wms.rjvnReceipt.batchNo", locale)}</th><th>{t("wms.rjvnReceipt.location", locale)}</th>
                <th>{t("wms.rjvnReceipt.qty", locale)}</th><th>{t("wms.rjvnInventory.status", locale)}</th>
              </tr></thead>
              <tbody>{reels.map((r, i) => (
                <tr key={i}><td>{str(r.reel_no)}</td><td>{str(r.material_code)}</td>
                  <td>{str(r.batch_no)}</td><td>{str(r.location_code)}</td>
                  <td>{str(r.issued_qty)}</td><td>{str(r.status)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  );
}
