/**
 * WmsRjvnReceipt — receiving core ported from D:\rj\rjvn\WMS-20261019.
 *
 * Backend: services/api/src/rjvn-receipt.js
 *   - QR parse/verify (receipt.service.ts:120-270)
 *   - submitIqc: group received receipts into IQC lots (:764-1130)
 *
 * The submit action is a real transaction in the mirror tables; it is
 * idempotent (a second run reports 0 newly submitted receipts).
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function WmsRjvnReceipt({ locale }: { locale: Locale }) {
  const [pending, setPending] = useState<Row[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [preview, setPreview] = useState<{ receipt_count: number; lot_count: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState("");
  const [qr, setQr] = useState("");
  const [qrResult, setQrResult] = useState<Row | null>(null);
  const [qrError, setQrError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ receipt: Row; lots: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const [p, w, pv] = await Promise.all([
        wmsApi.getRjvnReceiptPending({ q: q || undefined, limit: 50 }),
        wmsApi.getRjvnReceiptWarehouses(),
        wmsApi.previewRjvnReceiptSubmit(),
      ]);
      setPending(p.rows ?? []);
      setPendingTotal(p.total ?? 0);
      setWarehouses(w.rows ?? []);
      setPreview(pv);
      setError("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(search); }, 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  const verifyQr = useCallback(async () => {
    if (!qr.trim()) return;
    setVerifying(true);
    setQrError("");
    try {
      const r = await wmsApi.verifyRjvnReceiptQr(qr.trim());
      setQrResult(r);
    } catch (e) {
      setQrResult(null);
      setQrError(String((e as Error)?.message ?? e));
    } finally {
      setVerifying(false);
    }
  }, [qr]);

  const submitIqc = useCallback(async () => {
    setSubmitting(true);
    setSubmitResult("");
    try {
      const r = await wmsApi.submitRjvnReceiptIqc();
      setSubmitResult(`${t("wms.rjvnReceipt.submittedLots", locale)}: ${r.createdLotCount} · ${t("wms.rjvnReceipt.submittedReceipts", locale)}: ${r.submittedReceiptCount}`);
      await load(search);
    } catch (e) {
      setSubmitResult(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }, [load, search, locale]);

  const openDetail = useCallback(async (id: string) => {
    setSelected(id);
    try {
      setDetail(await wmsApi.getRjvnReceiptDetail(id));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, []);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rjvnReceipt.title", locale)}</h2>
            <p>{t("wms.rjvnReceipt.desc", locale)}</p>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnReceipt.pendingReceipts", locale)}</span>
            <strong className="stat-value">{pendingTotal.toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnReceipt.willCreateLots", locale)}</span>
            <strong className="stat-value">{preview?.lot_count ?? 0}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnReceipt.warehouses", locale)}</span>
            <strong className="stat-value">{warehouses.length}</strong>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{t("wms.rjvnReceipt.qrVerify", locale)}</h2></div>
        </div>
        <div className="toolbar">
          <label className="field field-grow">
            <span>{t("wms.rjvnReceipt.qrPlaceholder", locale)}</span>
            <input value={qr} onChange={(e) => setQr(e.target.value)} />
          </label>
          <button type="button" disabled={verifying || !qr.trim()} onClick={() => void verifyQr()}>
            {verifying ? t("wms.rjvnIqc.submitting", locale) : t("wms.rjvnReceipt.verify", locale)}
          </button>
        </div>
        {qrError && <div className="alert alert-error">{qrError}</div>}
        {qrResult && (
          <div className={`alert ${qrResult.valid ? "alert-info" : "alert-error"}`}>
            {str(qrResult.valid)} · {str(qrResult.materialName)} · {str(qrResult.errorMessage ?? qrResult.errorCode ?? "")}
          </div>
        )}
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{t("wms.rjvnReceipt.pendingLots", locale)}</h2></div>
          <button type="button" disabled={submitting || pendingTotal === 0} onClick={() => void submitIqc()}>
            {submitting ? t("wms.rjvnIqc.submitting", locale) : t("wms.rjvnReceipt.submitIqc", locale)}
          </button>
        </div>
        {submitResult && <div className="alert alert-info">{submitResult}</div>}
        <div className="toolbar">
          <label className="field field-grow">
            <span>{t("wms.rjvn.search", locale)}</span>
            <input value={search} placeholder={t("wms.rjvn.searchPlaceholder", locale)}
              onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {loading && pending.length === 0 ? (
          <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
        ) : pending.length === 0 ? (
          <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("wms.rjvnReceipt.receiptNo", locale)}</th>
                  <th>{t("wms.rjvnIqc.material", locale)}</th>
                  <th>{t("wms.rjvnIqc.supplier", locale)}</th>
                  <th>{t("wms.rjvnReceipt.batchNo", locale)}</th>
                  <th>{t("wms.rjvnReceipt.qty", locale)}</th>
                  <th>{t("wms.rjvnReceipt.receiptDate", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r, i) => (
                  <tr key={str(r.id) || i} style={{ cursor: "pointer" }}
                    onClick={() => void openDetail(str(r.id))}>
                    <td>{str(r.receipt_no)}</td>
                    <td>{str(r.material_name) || str(r.material_code)}</td>
                    <td>{str(r.supplier_name)}</td>
                    <td>{str(r.batch_no)}</td>
                    <td>{str(r.quantity)} {str(r.unit)}</td>
                    <td>{str(r.receipt_date).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && detail && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.rjvnReceipt.detail", locale)}</h2>
              <p>{str(detail.receipt.receipt_no)} · {str(detail.receipt.serial_no)}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <tbody>
                <tr><th>{t("wms.rjvnReceipt.receiptNo", locale)}</th><td>{str(detail.receipt.receipt_no)}</td></tr>
                <tr><th>{t("wms.rjvnIqc.material", locale)}</th><td>{str(detail.receipt.material_name) || str(detail.receipt.material_code)}</td></tr>
                <tr><th>{t("wms.rjvnIqc.supplier", locale)}</th><td>{str(detail.receipt.supplier_name)}</td></tr>
                <tr><th>{t("wms.rjvnReceipt.batchNo", locale)}</th><td>{str(detail.receipt.batch_no)}</td></tr>
                <tr><th>{t("wms.rjvnReceipt.qty", locale)}</th><td>{str(detail.receipt.quantity)} {str(detail.receipt.unit)}</td></tr>
                <tr><th>{t("wms.rjvnReceipt.location", locale)}</th><td>{str(detail.receipt.location_code)}</td></tr>
              </tbody>
            </table>
          </div>
          <h3 style={{ margin: "16px 0 8px" }}>{t("wms.rjvnReceipt.linkedLots", locale)}</h3>
          {detail.lots.length === 0 ? (
            <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Lot No</th><th>{t("wms.rjvnIqc.result", locale)}</th><th>{t("wms.rjvnReceipt.qty", locale)}</th></tr></thead>
                <tbody>
                  {detail.lots.map((l, i) => (
                    <tr key={i}><td>{str(l.lot_no)}</td><td>{str(l.status)}</td><td>{str(l.total_qty)}</td></tr>
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
