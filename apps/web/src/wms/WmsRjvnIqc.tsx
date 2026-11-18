/**
 * WmsRjvnIqc — IQC core logic ported from D:\rj\rjvn\WMS-20261019.
 *
 * Covers the three rules that were ported to the Express backend
 * (services/api/src/rjvn-iqc.js):
 *   1. strictness  — normal / tightened / reduced transitions driven by the
 *                    last 10 inspection results per material
 *   2. sampling    — ANSI/ASQ Z1.4 style plan lookup (sample size, Ac, Re)
 *   3. decision    — a record passes when defectQty <= Ac; the lot passes only
 *                    when every record passes
 *
 * Read/write only the mirrored public.rjvn_* tables. OA is out of scope.
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type Row = Record<string, unknown>;

interface IqcStats {
  lots: number; pending: number; passed: number; failed: number; passRate: number;
  byStrictness: Array<{ name: string; value: number }>;
}
interface LotDetail {
  lot: Row; records: Row[]; report: Row | null; strictness: Row | null;
}
interface SamplingPlan {
  sampleSize: number; ac: number; re: number; planText: string;
  aql: number; level: string; verdict?: string;
}
interface EditableRecord {
  itemName: string; sectionType: string; standard: string;
  measuredValue: string; defectQty: string; isPass: boolean;
  sampleSize?: number; aql?: number;
}

const STRICTNESS_CLASS: Record<string, string> = {
  reduced: "pill pill-success",
  normal: "pill pill-info",
  tightened: "pill pill-danger",
  suspended: "pill pill-muted",
  exempt: "pill pill-warning",
};

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function WmsRjvnIqc({ locale }: { locale: Locale }) {
  const [stats, setStats] = useState<IqcStats | null>(null);
  const [strictnessRows, setStrictnessRows] = useState<Row[]>([]);
  const [pending, setPending] = useState<Row[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [transferLogs, setTransferLogs] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LotDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [edits, setEdits] = useState<EditableRecord[]>([]);
  const [plan, setPlan] = useState<SamplingPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [calcQty, setCalcQty] = useState("");
  const [calcAql, setCalcAql] = useState("0.4");
  const [calcLevel, setCalcLevel] = useState("II");
  const [calcStrictness, setCalcStrictness] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string>("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, st, p, tl] = await Promise.all([
        wmsApi.getRjvnIqcStats(),
        wmsApi.getRjvnIqcStrictnessList({ limit: 100 }),
        wmsApi.getRjvnIqcPending({ limit: 50 }),
        wmsApi.getRjvnIqcTransferLogs({ limit: 50 }),
      ]);
      setStats(s);
      setStrictnessRows(st.rows ?? []);
      setPending(p.rows ?? []);
      setPendingTotal(p.total ?? 0);
      setTransferLogs(tl.rows ?? []);
      setError("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Pending list is refreshed on search, but only after the user stops typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      void wmsApi.getRjvnIqcPending({ q: search || undefined, limit: 50 })
        .then((p) => { setPending(p.rows ?? []); setPendingTotal(p.total ?? 0); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const openLot = useCallback(async (lotId: string, keepResult = false) => {
    setSelectedLotId(lotId);
    setDetailLoading(true);
    if (!keepResult) setSubmitResult("");
    setPlan(null);
    try {
      const d = await wmsApi.getRjvnIqcLot(lotId);
      setDetail(d);
      const lot = d.lot ?? {};
      setEdits((d.records ?? []).map((r) => ({
        itemName: str(r.item_name) || str(r.item_id),
        sectionType: str(r.section_type),
        standard: str(r.standard),
        measuredValue: str(r.measured_value),
        defectQty: str(r.defect_qty ?? 0),
        isPass: r.is_pass === true,
        sampleSize: r.sample_size === null || r.sample_size === undefined ? undefined : num(r.sample_size),
        aql: r.aql === null || r.aql === undefined ? undefined : num(r.aql),
      })));
      setCalcQty(String(lot.total_qty ?? ""));
      const st = d.strictness ?? null;
      if (st) {
        setCalcAql(String(st.aql ?? 0.4));
        setCalcLevel(str(st.inspection_level) || "II");
        setCalcStrictness(str(st.strictness) || "normal");
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const runSampling = useCallback(async () => {
    if (!selectedLotId) return;
    setPlanError("");
    try {
      const p = await wmsApi.calculateRjvnSampling({
        lotId: selectedLotId,
        qty: Number(calcQty) || 0,
        aql: Number(calcAql) || 0.4,
        inspectionLevel: calcLevel,
        strictness: calcStrictness,
      });
      setPlan(p);
    } catch (e) {
      setPlan(null);
      setPlanError(String((e as Error)?.message ?? e));
    }
  }, [selectedLotId, calcQty, calcAql, calcLevel, calcStrictness]);

  const submitInspection = useCallback(async () => {
    if (!selectedLotId || edits.length === 0) return;
    setSubmitting(true);
    setSubmitResult("");
    try {
      const res = await wmsApi.submitRjvnInspection(selectedLotId, {
        records: edits.map((e) => ({
          itemName: e.itemName,
          sectionType: e.sectionType,
          standard: e.standard,
          measuredValue: e.measuredValue,
          defectQty: Number(e.defectQty) || 0,
          isPass: e.isPass,
          sampleSize: e.sampleSize,
          aql: e.aql,
        })),
      });
      const transfer = res.transfer
        ? ` | ${str(res.transfer.from_strictness)} → ${str(res.transfer.to_strictness)}`
        : "";
      setSubmitResult(`${t("wms.rjvnIqc.decision", locale)}: ${res.decision}${transfer}`);
      await openLot(selectedLotId, true);
      await loadAll();
    } catch (e) {
      setSubmitResult(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }, [selectedLotId, edits, openLot, loadAll]);

  const setEdit = (idx: number, patch: Partial<EditableRecord>) => {
    setEdits((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rjvnIqc.title", locale)}</h2>
            <p>{t("wms.rjvnIqc.desc", locale)}</p>
          </div>
          <span className="pill pill-warning">{t("wms.rjvnIqc.writes", locale)}</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnIqc.lots", locale)}</span>
            <strong className="stat-value">{(stats?.lots ?? 0).toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnIqc.pending", locale)}</span>
            <strong className="stat-value">{(stats?.pending ?? 0).toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnIqc.passed", locale)}</span>
            <strong className="stat-value">{(stats?.passed ?? 0).toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t("wms.rjvnIqc.passRate", locale)}</span>
            <strong className="stat-value">{Math.round(stats?.passRate ?? 0)}%</strong>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{t("wms.rjvnIqc.strictnessOverview", locale)}</h2></div>
        </div>
        {loading && strictnessRows.length === 0 ? (
          <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>
        ) : strictnessRows.length === 0 ? (
          <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("wms.rjvnIqc.material", locale)}</th>
                  <th>{t("wms.rjvnIqc.level", locale)}</th>
                  <th>{t("wms.rjvnIqc.aql", locale)}</th>
                  <th>{t("wms.rjvnIqc.inspectionLevel", locale)}</th>
                  <th>{t("wms.rjvnIqc.consecutiveAccepted", locale)}</th>
                  <th>{t("wms.rjvnIqc.recentRejected", locale)}</th>
                  <th>{t("wms.rjvnIqc.tightenedRejected", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {strictnessRows.map((r, i) => {
                  const level = str(r.strictness);
                  return (
                    <tr key={str(r.id) || i}>
                      <td>{str(r.material_name) || str(r.material_code) || str(r.material_id)}</td>
                      <td><span className={STRICTNESS_CLASS[level] ?? "pill pill-muted"}>{level}</span></td>
                      <td>{str(r.aql)}</td>
                      <td>{str(r.inspection_level)}</td>
                      <td>{num(r.consecutive_accepted)}</td>
                      <td>{num(r.recent_rejected_in_5)}</td>
                      <td>{num(r.tightened_rejected_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{t("wms.rjvnIqc.pendingLots", locale)}</h2></div>
          <span className="muted">{pendingTotal.toLocaleString()} {t("wms.rjvn.rows", locale)}</span>
        </div>
        <div className="toolbar">
          <label className="field field-grow">
            <span>{t("wms.rjvn.search", locale)}</span>
            <input value={search} placeholder={t("wms.rjvn.searchPlaceholder", locale)}
              onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {pending.length === 0 ? (
          <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("wms.rjvnIqc.lotNo", locale)}</th>
                  <th>{t("wms.rjvnIqc.material", locale)}</th>
                  <th>{t("wms.rjvnIqc.supplier", locale)}</th>
                  <th>{t("wms.rjvnIqc.qty", locale)}</th>
                  <th>{t("wms.rjvnIqc.receiptDate", locale)}</th>
                  <th>{t("wms.rjvnIqc.result", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r, i) => (
                  <tr key={str(r.id) || i}
                    onClick={() => void openLot(str(r.id))}
                    style={{ cursor: "pointer", background: selectedLotId === str(r.id) ? "var(--surface-2, #eef2f7)" : undefined }}>
                    <td>{str(r.lot_no)}</td>
                    <td>{str(r.material_name) || str(r.material_code)}</td>
                    <td>{str(r.supplier_name)}</td>
                    <td>{str(r.total_qty)} {str(r.unit)}</td>
                    <td>{str(r.receipt_date).slice(0, 10)}</td>
                    <td><span className="pill pill-warning">{str(r.inspection_result) || "pending"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedLotId && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.rjvnIqc.detail", locale)}</h2>
              <p>{str(detail?.lot?.lot_no)} · {str(detail?.lot?.material_name)}</p>
            </div>
          </div>

          {detailLoading && <div className="placeholder-view">{t("wms.rjvn.loading", locale)}</div>}

          {detail && (
            <>
              <div className="toolbar">
                <label className="field">
                  <span>{t("wms.rjvnIqc.qty", locale)}</span>
                  <input value={calcQty} onChange={(e) => setCalcQty(e.target.value)} />
                </label>
                <label className="field">
                  <span>{t("wms.rjvnIqc.aql", locale)}</span>
                  <select value={calcAql} onChange={(e) => setCalcAql(e.target.value)}>
                    {["0.65", "1.0", "1.5", "2.5", "4.0", "0.4", "0.1"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{t("wms.rjvnIqc.inspectionLevel", locale)}</span>
                  <select value={calcLevel} onChange={(e) => setCalcLevel(e.target.value)}>
                    {["S-1", "S-2", "S-3", "S-4", "I", "II", "III"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{t("wms.rjvnIqc.level", locale)}</span>
                  <select value={calcStrictness} onChange={(e) => setCalcStrictness(e.target.value)}>
                    {["normal", "tightened", "reduced"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => void runSampling()}>{t("wms.rjvnIqc.calculate", locale)}</button>
              </div>

              {planError && <div className="alert alert-error">{planError}</div>}
              {plan && (
                <div className="stat-grid">
                  <div className="stat-card">
                    <span className="stat-label">{t("wms.rjvnIqc.sampleSize", locale)}</span>
                    <strong className="stat-value">{plan.sampleSize}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Ac</span>
                    <strong className="stat-value">{plan.ac}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Re</span>
                    <strong className="stat-value">{plan.re}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">{t("wms.rjvnIqc.planText", locale)}</span>
                    <strong className="stat-value" style={{ fontSize: 13 }}>{plan.planText}</strong>
                  </div>
                </div>
              )}

              <h3 style={{ margin: "16px 0 8px" }}>{t("wms.rjvnIqc.records", locale)}</h3>
              {edits.length === 0 ? (
                <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t("wms.rjvnIqc.itemName", locale)}</th>
                        <th>{t("wms.rjvnIqc.section", locale)}</th>
                        <th>{t("wms.rjvnIqc.standard", locale)}</th>
                        <th>{t("wms.rjvnIqc.measuredValue", locale)}</th>
                        <th>{t("wms.rjvnIqc.defectQty", locale)}</th>
                        <th>{t("wms.rjvnIqc.isPass", locale)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edits.map((row, idx) => (
                        <tr key={`${row.itemName}-${idx}`}>
                          <td>{row.itemName}</td>
                          <td>{row.sectionType}</td>
                          <td>{row.standard}</td>
                          <td>
                            <input value={row.measuredValue}
                              onChange={(e) => setEdit(idx, { measuredValue: e.target.value })} />
                          </td>
                          <td>
                            <input value={row.defectQty}
                              onChange={(e) => setEdit(idx, { defectQty: e.target.value })} />
                          </td>
                          <td>
                            <input type="checkbox" checked={row.isPass}
                              onChange={(e) => setEdit(idx, { isPass: e.target.checked })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="toolbar toolbar-end">
                <button type="button" disabled={submitting || edits.length === 0}
                  onClick={() => void submitInspection()}>
                  {submitting ? t("wms.rjvnIqc.submitting", locale) : t("wms.rjvnIqc.submit", locale)}
                </button>
              </div>
              {submitResult && <div className="alert alert-info">{submitResult}</div>}
            </>
          )}
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{t("wms.rjvnIqc.transferLogs", locale)}</h2></div>
        </div>
        {transferLogs.length === 0 ? (
          <div className="placeholder-view">{t("wms.rjvn.noData", locale)}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("wms.rjvnIqc.material", locale)}</th>
                  <th>{t("wms.rjvnIqc.from", locale)}</th>
                  <th>{t("wms.rjvnIqc.to", locale)}</th>
                  <th>{t("wms.rjvnIqc.transferType", locale)}</th>
                  <th>{t("wms.rjvnIqc.reason", locale)}</th>
                  <th>{t("wms.rjvnIqc.createdAt", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {transferLogs.map((r, i) => (
                  <tr key={str(r.id) || i}>
                    <td>{str(r.material_id)}</td>
                    <td>{str(r.from_strictness)}</td>
                    <td>{str(r.to_strictness)}</td>
                    <td>{str(r.transfer_type)}</td>
                    <td title={text(r.reason)}>{text(r.reason).slice(0, 60)}</td>
                    <td>{str(r._created_at).slice(0, 19).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
