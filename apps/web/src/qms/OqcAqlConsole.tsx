/**
 * OqcAqlConsole — 出货抽检（AQL / Z1.4）原生控制台
 *
 * 一屏完成：算抽样方案 → 建批 → 逐件判定 → 统计 CR/MA/MI → 出结论 → 处置。
 * 关键点：结论由 Ac/Re 决定，不靠"感觉"。CR 永远 Ac=0，一件就整批不合格。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { t } from "../i18n";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type PlansFor = {
  ok: boolean;
  n: number;
  level: string;
  code: string;
  lotCode: string;
  severity: string;
  cr: { ac: number; re: number; aql: number };
  ma: { ac: number; re: number; aql: number; n: number; note?: string };
  mi: { ac: number; re: number; aql: number; n: number; note?: string };
};

type Batch = {
  id: string;
  batchNo: string;
  shipmentNo?: string | null;
  customerName?: string | null;
  status: string;
  totalQty: number;
  sampleSize: number;
  sampleCode?: string | null;
  lotCode?: string | null;
  severityProfile?: string | null;
  aqlMa?: number | string | null;
  aqlMi?: number | string | null;
  acMajor?: number | null;
  acMinor?: number | null;
  itemCount?: number;
  disposition?: string | null;
  createdAt: string;
};

type Item = {
  id: string;
  sn: string;
  result: string;
  severity?: string | null;
  defectCode?: string | null;
  defectDesc?: string | null;
};

type Detail = {
  batch: Batch & { planNote?: string | null; remarks?: string | null; dispositionReason?: string | null };
  items: Item[];
  counts: { cr: number; ma: number; mi: number };
  verdict: { ok: boolean | null; accepted: boolean | null; reasons: string[] };
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const statusTone = (status: string) => {
  if (status === "PASSED") return "badge badge-success";
  if (status === "FAILED") return "badge badge-danger";
  if (status === "SAMPLING") return "badge badge-warning";
  return "badge badge-info";
};

export function OqcAqlConsole({ locale }: { locale: Locale }) {
  const [lotQty, setLotQty] = useState("500");
  const [aqlMa, setAqlMa] = useState("1.0");
  const [aqlMi, setAqlMi] = useState("2.5");
  const [level, setLevel] = useState("II");
  const [severity, setSeverity] = useState("normal");
  const [customerName, setCustomerName] = useState("");
  const [plan, setPlan] = useState<PlansFor | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [sn, setSn] = useState("");
  const [result, setResult] = useState<"PASS" | "FAIL">("PASS");
  const [itemSeverity, setItemSeverity] = useState<"CR" | "MA" | "MI">("MA");
  const [defectCode, setDefectCode] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () => ({ lotQty, aqlMa, aqlMi, level, severity }),
    [lotQty, aqlMa, aqlMi, level, severity],
  );

  const loadPlan = useCallback(async () => {
    try {
      const res = await apiClient.get<PlansFor>("/api/qms/oqc-aql/plan", query);
      setPlan(res?.ok ? res : null);
    } catch {
      setPlan(null);
    }
  }, [query]);

  const loadBatches = useCallback(async () => {
    try {
      const res = await apiClient.get<{ items?: Batch[] }>("/api/qms/oqc-aql/batches", { limit: 30 });
      setBatches(res?.items ?? []);
    } catch {
      setBatches([]);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await apiClient.get<Detail>(`/api/qms/oqc-aql/batches/${id}`);
      setDetail(res);
    } catch (err) {
      setDetail(null);
      setFeedback({ ok: false, msg: errorText(err) });
    }
  }, []);

  useEffect(() => { void loadPlan(); }, [loadPlan]);
  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const createBatch = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiClient.post<{ id: string; batchNo: string }>("/api/qms/oqc-aql/batches", {
        lotQty: Number(lotQty),
        aqlMa: Number(aqlMa),
        aqlMi: Number(aqlMi),
        level,
        severity,
        customerName: customerName.trim() || undefined,
      });
      setFeedback({ ok: true, msg: `${t("mes.oqcAql.created", locale)} ${res.batchNo}` });
      await loadBatches();
      setSelectedId(res.id);
    } catch (err) {
      setFeedback({ ok: false, msg: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const recordItem = async () => {
    if (!selectedId) { setFeedback({ ok: false, msg: t("mes.oqcAql.needBatch", locale) }); return; }
    const value = sn.trim().toUpperCase();
    if (!value) { setFeedback({ ok: false, msg: t("mes.oqcAql.needSn", locale) }); return; }
    if (result === "FAIL" && !defectCode.trim()) {
      setFeedback({ ok: false, msg: t("mes.oqcAql.needDefect", locale) });
      return;
    }
    setBusy(true);
    try {
      await apiClient.post(`/api/qms/oqc-aql/batches/${selectedId}/items`, {
        sn: value,
        result,
        severity: result === "FAIL" ? itemSeverity : undefined,
        defectCode: result === "FAIL" ? defectCode.trim() : undefined,
      });
      setSn("");
      setDefectCode("");
      await loadDetail(selectedId);
    } catch (err) {
      setFeedback({ ok: false, msg: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const judge = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ status: string; verdict: { reasons: string[] } }>(
        `/api/qms/oqc-aql/batches/${selectedId}/judge`,
        {},
      );
      setFeedback({
        ok: res.status === "PASSED",
        msg: `${res.status} — ${res.verdict.reasons.join("；")}`,
      });
      await Promise.all([loadDetail(selectedId), loadBatches()]);
    } catch (err) {
      setFeedback({ ok: false, msg: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const dispose = async (decision: "REWORK" | "WAIVER" | "SCRAP") => {
    if (!selectedId) return;
    const reason = window.prompt(t("mes.oqcAql.disposeReasonPrompt", locale), "");
    if (!reason?.trim()) return;
    try {
      await apiClient.post(`/api/qms/oqc-aql/batches/${selectedId}/review`, { decision, reason: reason.trim() });
      setFeedback({ ok: true, msg: `${decision} — ${reason.trim()}` });
      await loadDetail(selectedId);
    } catch (err) {
      setFeedback({ ok: false, msg: errorText(err) });
    }
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel" style={{ padding: 20 }}>
        <div className="section-header">
          <div>
            <div style={{ color: "var(--state-active,#18c6d9)", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>
              {t("mes.oqcAql.eyebrow", locale)}
            </div>
            <h2 style={{ margin: "6px 0" }}>{t("mes.oqcAql.title", locale)}</h2>
            <p style={{ margin: 0, color: "var(--muted)" }}>{t("mes.oqcAql.subtitle", locale)}</p>
          </div>
          <button className="action-button" type="button" onClick={() => { void loadPlan(); void loadBatches(); }} title={t("common.refresh", locale)}>
            <RefreshCw size={16} /> {t("common.refresh", locale)}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 16 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.lotQty", locale)}</span>
            <input className="form-input" value={lotQty} onChange={e => setLotQty(e.target.value)} title={t("mes.oqcAql.lotQty", locale)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.aqlMa", locale)}</span>
            <input className="form-input" value={aqlMa} onChange={e => setAqlMa(e.target.value)} title={t("mes.oqcAql.aqlMa", locale)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.aqlMi", locale)}</span>
            <input className="form-input" value={aqlMi} onChange={e => setAqlMi(e.target.value)} title={t("mes.oqcAql.aqlMi", locale)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.level", locale)}</span>
            <select className="form-input" value={level} onChange={e => setLevel(e.target.value)} title={t("mes.oqcAql.level", locale)}>
              {["I", "II", "III"].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.severity", locale)}</span>
            <select className="form-input" value={severity} onChange={e => setSeverity(e.target.value)} title={t("mes.oqcAql.severity", locale)}>
              <option value="normal">{t("mes.oqcAql.sevNormal", locale)}</option>
              <option value="tightened">{t("mes.oqcAql.sevTightened", locale)}</option>
              <option value="reduced">{t("mes.oqcAql.sevReduced", locale)}</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.customer", locale)}</span>
            <input className="form-input" value={customerName} onChange={e => setCustomerName(e.target.value)} title={t("mes.oqcAql.customer", locale)} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          {plan ? (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
              <span><strong>{t("mes.oqcAql.sampleSize", locale)}</strong> {plan.n}（{t("mes.oqcAql.code", locale)} {plan.code}）</span>
              <span><strong>CR</strong> Ac 0</span>
              <span><strong>MA</strong> Ac {plan.ma.ac} / Re {plan.ma.re}</span>
              <span><strong>MI</strong> Ac {plan.mi.ac} / Re {plan.mi.re}</span>
            </div>
          ) : (
            <span className="badge badge-danger">{t("mes.oqcAql.planInvalid", locale)}</span>
          )}
          <button className="action-button action-button-primary" type="button" disabled={busy || !plan} onClick={() => void createBatch()} title={t("mes.oqcAql.createBatch", locale)}>
            <ClipboardCheck size={16} /> {t("mes.oqcAql.createBatch", locale)}
          </button>
        </div>

        {feedback && (
          <div className={feedback.ok ? "badge badge-success" : "badge badge-danger"} style={{ padding: "10px 12px", marginTop: 12, fontSize: 13 }}>
            {feedback.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {feedback.msg}
          </div>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,0.9fr) minmax(360px,1.4fr)", gap: 16 }}>
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 10px" }}>{t("mes.oqcAql.batchList", locale)}</h3>
          <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto" }}>
            {batches.map(batch => (
              <button
                key={batch.id}
                type="button"
                className="action-button"
                style={{
                  display: "grid",
                  gap: 4,
                  textAlign: "left",
                  border: selectedId === batch.id ? "1px solid var(--state-active,#18c6d9)" : undefined,
                }}
                onClick={() => setSelectedId(batch.id)}
                title={batch.batchNo}
              >
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <code style={{ fontSize: 11 }}>{batch.batchNo}</code>
                  <span className={statusTone(batch.status)}>{batch.status}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t("mes.oqcAql.nOfLot", locale)} {batch.sampleSize}/{batch.totalQty}
                  {batch.severityProfile && batch.severityProfile !== "normal" ? ` · ${batch.severityProfile}` : ""}
                  {batch.disposition ? ` · ${batch.disposition}` : ""}
                </span>
              </button>
            ))}
            {batches.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("mes.oqcAql.noBatches", locale)}</div>
            )}
          </div>
        </section>

        <section className="surface-panel" style={{ padding: 16 }}>
          {!detail && (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("mes.oqcAql.selectBatch", locale)}</div>
          )}
          {detail && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{detail.batch.batchNo}</strong>
                <span className={statusTone(detail.batch.status)}>{detail.batch.status}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  n={detail.batch.sampleSize} / {detail.batch.totalQty}
                  {detail.batch.planNote ? ` · ${detail.batch.planNote}` : ""}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
                <div className="surface-panel" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>CR</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: detail.counts.cr > 0 ? "var(--state-danger,#dc2626)" : undefined }}>
                    {detail.counts.cr} <span style={{ fontSize: 11, color: "var(--muted)" }}>Ac 0</span>
                  </div>
                </div>
                <div className="surface-panel" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>MA</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{detail.counts.ma} <span style={{ fontSize: 11, color: "var(--muted)" }}>Ac {detail.batch.acMajor ?? 0}</span></div>
                </div>
                <div className="surface-panel" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>MI</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{detail.counts.mi} <span style={{ fontSize: 11, color: "var(--muted)" }}>Ac {detail.batch.acMinor ?? 0}</span></div>
                </div>
              </div>

              <div className={detail.verdict.accepted ? "badge badge-success" : "badge badge-danger"} style={{ padding: "10px 12px", fontSize: 13 }}>
                {detail.verdict.accepted ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                {" "}{detail.verdict.reasons.join("；")}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.2fr) auto auto minmax(120px,1fr) auto", gap: 8, alignItems: "end" }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.sn", locale)}</span>
                  <input
                    className="form-input"
                    value={sn}
                    onChange={e => setSn(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === "Enter") void recordItem(); }}
                    placeholder={t("mes.oqcAql.snPlaceholder", locale)}
                    title={t("mes.oqcAql.sn", locale)}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.result", locale)}</span>
                  <select className="form-input" value={result} onChange={e => setResult(e.target.value as "PASS" | "FAIL")} title={t("mes.oqcAql.result", locale)}>
                    <option value="PASS">PASS</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.sev", locale)}</span>
                  <select
                    className="form-input"
                    value={itemSeverity}
                    disabled={result !== "FAIL"}
                    onChange={e => setItemSeverity(e.target.value as "CR" | "MA" | "MI")}
                    title={t("mes.oqcAql.sev", locale)}
                  >
                    <option value="CR">CR</option>
                    <option value="MA">MA</option>
                    <option value="MI">MI</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{t("mes.oqcAql.defect", locale)}</span>
                  <input
                    className="form-input"
                    value={defectCode}
                    disabled={result !== "FAIL"}
                    onChange={e => setDefectCode(e.target.value.toUpperCase())}
                    title={t("mes.oqcAql.defect", locale)}
                  />
                </label>
                <button className="action-button" type="button" disabled={busy} onClick={() => void recordItem()} title={t("mes.oqcAql.record", locale)}>
                  {t("mes.oqcAql.record", locale)}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="action-button action-button-primary" type="button" disabled={busy} onClick={() => void judge()} title={t("mes.oqcAql.judge", locale)}>
                  <ShieldAlert size={16} /> {t("mes.oqcAql.judge", locale)}
                </button>
                <span style={{ width: 12 }} />
                {(["REWORK", "WAIVER", "SCRAP"] as const).map(decision => (
                  <button
                    key={decision}
                    className="action-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void dispose(decision)}
                    title={t(`mes.oqcAql.dispose.${decision}`, locale)}
                  >
                    {t(`mes.oqcAql.dispose.${decision}`, locale)}
                  </button>
                ))}
                {detail.batch.disposition && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {detail.batch.disposition} · {detail.batch.dispositionReason || ""}
                  </span>
                )}
              </div>

              <div className="table-shell" style={{ maxHeight: 260, overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t("mes.oqcAql.sn", locale)}</th>
                      <th>{t("mes.oqcAql.result", locale)}</th>
                      <th>{t("mes.oqcAql.sev", locale)}</th>
                      <th>{t("mes.oqcAql.defect", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.slice(-60).reverse().map(item => (
                      <tr key={item.id}>
                        <td><code style={{ fontSize: 11 }}>{item.sn}</code></td>
                        <td>{item.result}</td>
                        <td>{item.severity || "—"}</td>
                        <td>{item.defectCode || "—"}</td>
                      </tr>
                    ))}
                    {detail.items.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>{t("mes.oqcAql.noItems", locale)}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
