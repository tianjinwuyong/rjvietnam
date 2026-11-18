/**
 * WmsRjvnInventory — inventory core ported from D:\rj\rjvn\WMS-20261019.
 *
 * Backend: services/api/src/rjvn-inventory.js
 *   - doTransfer(): stock movement (source deduct / target upsert / transfer record)
 *   - adjustInventory(): CAS stock take + advisory lock + balance_after audit
 *   - lock/unlockInventory(): lock state with audit trail
 *
 * All writes hit the public.rjvn_* mirror tables only.
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => Number(v ?? 0);
type SubTab = "stock" | "tx" | "transfer";

export function WmsRjvnInventory({ locale }: { locale: Locale }) {
  const [subTab, setSubTab] = useState<SubTab>("stock");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [lockedTotal, setLockedTotal] = useState(0);
  const [summary, setSummary] = useState<Row[]>([]);
  const [txRows, setTxRows] = useState<Row[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [transferRows, setTransferRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [force, setForce] = useState(false);
  const [forceReason, setForceReason] = useState("");
  const [lockReason, setLockReason] = useState("");
  const [unlockReason, setUnlockReason] = useState("");
  const [targetLoc, setTargetLoc] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, locked, summ, tx, tr] = await Promise.all([
        wmsApi.getRjvnInventoryList({ q: q || undefined, stockStatus: status || undefined, limit: 50 }),
        wmsApi.getRjvnInventoryList({ stockStatus: "locked", limit: 1 }),
        wmsApi.getRjvnInventorySummary(),
        wmsApi.getRjvnInventoryTransactions({ limit: 50 }),
        wmsApi.getRjvnInventoryTransfers({ limit: 50 }),
      ]);
      setRows(list.rows ?? []); setTotal(list.total ?? 0);
      setLockedTotal(locked.total ?? 0);
      setSummary(summ.rows ?? []);
      setTxRows(tx.rows ?? []); setTxTotal(tx.total ?? 0);
      setTransferRows(tr.rows ?? []);
      setError("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  // Single debounced load; load already depends on q/status.
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, q || status ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q, status]);

  const act = useCallback(async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true); setFeedback("");
    try {
      await fn();
      setFeedback(okMsg);
      await load();
    } catch (e) {
      setFeedback(`ERR: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const totalAvailable = summary.reduce((s, r) => s + num(r.total_qty), 0);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rjvnInventory.title", locale)}</h2>
            <p>{t("wms.rjvnInventory.desc", locale)}</p>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnInventory.total", locale)}</span>
            <strong className="stat-value">{total.toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnInventory.available", locale)}</span>
            <strong className="stat-value">{totalAvailable.toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnInventory.lockedCount", locale)}</span>
            <strong className="stat-value">{lockedTotal.toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnInventory.txCount", locale)}</span>
            <strong className="stat-value">{txTotal.toLocaleString()}</strong>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          {(["stock", "tx", "transfer"] as SubTab[]).map((s) => (
            <button key={s} type="button"
              className={subTab === s ? "active" : ""}
              onClick={() => setSubTab(s)}>
              {t(`wms.rjvnInventory.tab${s === "stock" ? "Stock" : s === "tx" ? "Tx" : "Transfer"}`, locale)}
            </button>
          ))}
        </div>
        {feedback && (
          <div className={`alert ${feedback.startsWith("ERR:") ? "alert-error" : "alert-info"}`}>
            {feedback}
          </div>
        )}
      </section>

      {subTab === "stock" && (
        <>
          <section className="surface-panel">
            <div className="toolbar">
              <label className="field field-grow">
                <span>{t("wms.rjvn.search", locale)}</span>
                <input value={q} placeholder={t("wms.rjvn.searchPlaceholder", locale)}
                  onChange={(e) => setQ(e.target.value)} />
              </label>
              <label className="field">
                <span>{t("wms.rjvnInventory.status", locale)}</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t("wms.rjvnInventory.all", locale)}</option>
                  <option value="good">good</option>
                  <option value="pending_qc">pending_qc</option>
                  <option value="locked">locked</option>
                </select>
              </label>
            </div>
            {loading && rows.length === 0 ? (
              <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
            ) : rows.length === 0 ? (
              <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("wms.rjvnIqc.material", locale)}</th>
                      <th>{t("wms.rjvnReceipt.batchNo", locale)}</th>
                      <th>{t("wms.rjvnReceipt.location", locale)}</th>
                      <th>{t("wms.rjvnInventory.warehouse", locale)}</th>
                      <th>{t("wms.rjvnReceipt.qty", locale)}</th>
                      <th>{t("wms.rjvnInventory.status", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={str(r.id) || i}
                        className={selected && str(selected.id) === str(r.id) ? "row-selected" : ""}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelected(r)}>
                        <td>{str(r.material_code)} {str(r.material_name)}</td>
                        <td>{str(r.batch_no)}</td>
                        <td>{str(r.location_code)}</td>
                        <td>{str(r.wh_code)}</td>
                        <td>{str(r.quantity)} {str(r.unit)}</td>
                        <td>
                          {str(r.stock_status)}
                          {r.locked === true && <span className="pill pill-warn"> · {t("wms.rjvnInventory.locked", locale)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h2>{t("wms.rjvnInventory.actions", locale)}</h2>
                {selected ? (
                  <p>{str(selected.material_code)} · {str(selected.batch_no)} · {str(selected.location_code)} · {str(selected.quantity)} {str(selected.unit)}</p>
                ) : (
                  <p>{t("wms.rjvnInventory.selectRow", locale)}</p>
                )}
              </div>
            </div>
            {!selected ? (
              <div className="placeholder-view">{t("wms.rjvnInventory.selectRow", locale)}</div>
            ) : (
              <div className="form-grid">
                <div className="form-block">
                  <h3>{t("wms.rjvnInventory.adjust", locale)}</h3>
                  <label className="field"><span>{t("wms.rjvnInventory.actualQty", locale)}</span>
                    <input type="number" min="0" step="1" value={adjustQty}
                      onChange={(e) => setAdjustQty(e.target.value)} /></label>
                  <label className="field"><span>{t("wms.rjvnInventory.reason", locale)}</span>
                    <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} /></label>
                  {selected.locked === true && (
                    <>
                      <label className="checkbox-field"><input type="checkbox" checked={force}
                        onChange={(e) => setForce(e.target.checked)} />
                        {t("wms.rjvnInventory.force", locale)}</label>
                      {force && <label className="field"><span>{t("wms.rjvnInventory.forceReason", locale)}</span>
                        <input value={forceReason} onChange={(e) => setForceReason(e.target.value)} /></label>}
                    </>
                  )}
                  <button type="button" disabled={busy || !adjustQty || !adjustReason.trim()}
                    onClick={() => void act(() => wmsApi.adjustRjvnInventory({
                      inventoryId: str(selected.id), actualQty: Number(adjustQty),
                      reason: adjustReason.trim(), force, forceReason: forceReason.trim() || undefined,
                    }), t("wms.rjvnInventory.done", locale))}>
                    {t("wms.rjvnInventory.submit", locale)}
                  </button>
                </div>

                <div className="form-block">
                  <h3>{t("wms.rjvnInventory.transfer", locale)}</h3>
                  <label className="field"><span>{t("wms.rjvnInventory.targetLocation", locale)}</span>
                    <input value={targetLoc} placeholder="UUID" onChange={(e) => setTargetLoc(e.target.value)} /></label>
                  <label className="field"><span>{t("wms.rjvnReceipt.qty", locale)}</span>
                    <input type="number" min="1" step="1" value={transferQty}
                      onChange={(e) => setTransferQty(e.target.value)} /></label>
                  <button type="button" disabled={busy || !targetLoc.trim() || !transferQty}
                    onClick={() => void act(() => wmsApi.transferRjvnInventory({
                      fromLocationId: str(selected.location_id), toLocationId: targetLoc.trim(),
                      materialId: str(selected.material_id), batchNo: str(selected.batch_no) || undefined,
                      quantity: Number(transferQty),
                    }), t("wms.rjvnInventory.done", locale))}>
                    {t("wms.rjvnInventory.submit", locale)}
                  </button>
                </div>

                <div className="form-block">
                  <h3>{selected.locked === true ? t("wms.rjvnInventory.unlock", locale) : t("wms.rjvnInventory.lock", locale)}</h3>
                  {selected.locked === true ? (
                    <>
                      <label className="field"><span>{t("wms.rjvnInventory.reason", locale)}</span>
                        <input value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} /></label>
                      <button type="button" disabled={busy}
                        onClick={() => void act(() => wmsApi.unlockRjvnInventory({
                          inventoryId: str(selected.id), reason: unlockReason.trim() || undefined,
                        }), t("wms.rjvnInventory.done", locale))}>
                        {t("wms.rjvnInventory.unlock", locale)}
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="field"><span>{t("wms.rjvnInventory.reason", locale)}</span>
                        <input value={lockReason} onChange={(e) => setLockReason(e.target.value)} /></label>
                      <button type="button" disabled={busy || !lockReason.trim()}
                        onClick={() => void act(() => wmsApi.lockRjvnInventory({
                          inventoryId: str(selected.id), lockReason: lockReason.trim(),
                        }), t("wms.rjvnInventory.done", locale))}>
                        {t("wms.rjvnInventory.lock", locale)}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {subTab === "tx" && (
        <section className="surface-panel">
          <div className="section-header"><div><h2>{t("wms.rjvnInventory.tabTx", locale)}</h2></div></div>
          {txRows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr>
                  <th>{t("wms.rjvnInventory.txNo", locale)}</th>
                  <th>{t("wms.rjvnInventory.txType", locale)}</th>
                  <th>{t("wms.rjvnIqc.material", locale)}</th>
                  <th>{t("wms.rjvnReceipt.location", locale)}</th>
                  <th>{t("wms.rjvnReceipt.qty", locale)}</th>
                  <th>{t("wms.rjvnInventory.balance", locale)}</th>
                  <th>{t("wms.rjvnInventory.reason", locale)}</th>
                </tr></thead>
                <tbody>
                  {txRows.map((r, i) => (
                    <tr key={i}>
                      <td>{str(r.tx_no)}</td><td>{str(r.tx_type)}</td>
                      <td>{str(r.material_code)}</td><td>{str(r.location_code)}</td>
                      <td>{str(r.qty)}</td><td>{str(r.balance_after)}</td>
                      <td>{str(r.remark)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {subTab === "transfer" && (
        <section className="surface-panel">
          <div className="section-header"><div><h2>{t("wms.rjvnInventory.tabTransfer", locale)}</h2></div></div>
          {transferRows.length === 0 ? <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr>
                  <th>{t("wms.rjvnInventory.transferNo", locale)}</th>
                  <th>{t("wms.rjvnInventory.from", locale)}</th>
                  <th>{t("wms.rjvnInventory.to", locale)}</th>
                  <th>{t("wms.rjvnIqc.material", locale)}</th>
                  <th>{t("wms.rjvnReceipt.batchNo", locale)}</th>
                  <th>{t("wms.rjvnReceipt.qty", locale)}</th>
                  <th>{t("wms.rjvnInventory.status", locale)}</th>
                </tr></thead>
                <tbody>
                  {transferRows.map((r, i) => (
                    <tr key={i}>
                      <td>{str(r.transfer_no)}</td>
                      <td>{str(r.from_code)}</td><td>{str(r.to_code)}</td>
                      <td>{str(r.material_code)}</td><td>{str(r.batch_no)}</td>
                      <td>{str(r.quantity)} {str(r.unit)}</td><td>{str(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
