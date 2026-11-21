/**
 * StationPassConsole — 过站校验台（原生 PG 版）
 *
 * 前端入口对应 MES-ruijing 的 `/exec/pass` 过站页：
 * 扫 SN + 选工位 → 后端规则链（重码/跳站/NG 路线/重测/时效）→ 允许或拦截，
 * 并把整条规则链的结论显示给现场，避免"扫了没反应"。
 * 跳站不靠口头放行：现场申请放行单，主管在这里批准/驳回。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { t } from "../i18n";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Station = { code: string; name_zh?: string; name_en?: string; line_code?: string; status?: string };

type PassCheck = { rule: string; ok: boolean; message: string };

type PassDecision = {
  accepted: boolean;
  blocked: boolean;
  gateState: string;
  reasonCode: string;
  message: string;
  nextAction: string;
  destinationStationCode?: string | null;
  nextStationCode?: string | null;
  productId?: string | null;
  passId?: string;
  checks?: PassCheck[];
};

type PassRow = {
  passId: string;
  identity: string;
  stationCode: string;
  result: string;
  gateState: string;
  reasonCode: string;
  operatorId: string;
  retestNo?: number;
  decidedAt: string;
};

type SkipRelease = {
  releaseNo: string;
  identity: string;
  fromStationCode: string;
  toStationCode: string;
  reason: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const gateTone = (state: string) => {
  if (state === "ALLOW") return "badge badge-success";
  if (state === "COMPLETED") return "badge badge-info";
  if (state === "REPAIR_ROUTE") return "badge badge-warning";
  return "badge badge-danger";
};

export function StationPassConsole({ locale }: { locale: Locale }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [stationCode, setStationCode] = useState("");
  const [sn, setSn] = useState("");
  const [workOrderCode, setWorkOrderCode] = useState("");
  const [result, setResult] = useState<"OK" | "NG">("OK");
  const [defectCode, setDefectCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<PassDecision | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [history, setHistory] = useState<PassRow[]>([]);
  const [releases, setReleases] = useState<SkipRelease[]>([]);
  const [releaseSn, setReleaseSn] = useState("");
  const [releaseFrom, setReleaseFrom] = useState("");
  const [releaseTo, setReleaseTo] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const snRef = useRef<HTMLInputElement>(null);

  const stationName = useMemo(() => {
    const found = stations.find(item => item.code === stationCode);
    if (!found) return stationCode;
    return `${found.code} · ${(locale === "en-US" ? found.name_en : found.name_zh) || found.name_zh || ""}`.trim();
  }, [stations, stationCode, locale]);

  useEffect(() => {
    apiClient
      .get<{ items?: Station[] }>("/api/stations")
      .then(res => setStations(res?.items ?? []))
      .catch(() => setStations([]));
  }, []);

  const loadHistory = useCallback(async () => {
    if (!stationCode) return;
    try {
      const res = await apiClient.get<{ items?: PassRow[] }>("/api/mes/station-pass/history", {
        stationCode,
        limit: 30,
      });
      setHistory(res?.items ?? []);
    } catch {
      setHistory([]);
    }
  }, [stationCode]);

  const loadReleases = useCallback(async () => {
    try {
      const res = await apiClient.get<{ items?: SkipRelease[] }>("/api/mes/station-pass/skip-releases", {
        status: "PENDING",
      });
      setReleases(res?.items ?? []);
    } catch {
      setReleases([]);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { void loadReleases(); }, [loadReleases]);

  const submitPass = async () => {
    const value = sn.trim();
    if (!stationCode) { setFeedback({ ok: false, msg: t("mes.stationPass.needStation", locale) }); return; }
    if (!value) { setFeedback({ ok: false, msg: t("mes.stationPass.needSn", locale) }); return; }
    if (result === "NG" && !defectCode.trim()) { setFeedback({ ok: false, msg: t("mes.stationPass.needDefect", locale) }); return; }
    setBusy(true);
    setFeedback(null);
    setDecision(null);
    try {
      const res = await apiClient.post<{ ok?: boolean; decision?: PassDecision }>(
        "/api/mes/station-pass",
        {
          sn: value,
          stationCode,
          workOrderCode: workOrderCode.trim() || undefined,
          result,
          defectCode: result === "NG" ? defectCode.trim() : undefined,
          source: "manual",
        },
      );
      if (res?.decision) {
        setDecision(res.decision);
        setFeedback({
          ok: res.decision.accepted,
          msg: res.decision.message || res.decision.reasonCode,
        });
      } else {
        setFeedback({ ok: false, msg: t("mes.stationPass.failed", locale) });
      }
      setSn("");
      setDefectCode("");
      void loadHistory();
      snRef.current?.focus();
    } catch (err) {
      setFeedback({ ok: false, msg: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const createRelease = async () => {
    if (!releaseSn.trim() || !releaseFrom.trim() || !releaseTo.trim() || !releaseReason.trim()) {
      setFeedback({ ok: false, msg: t("mes.stationPass.releaseRequired", locale) });
      return;
    }
    try {
      const res = await apiClient.post<{ releaseNo?: string }>(
        "/api/mes/station-pass/skip-releases",
        {
          identity: releaseSn.trim(),
          fromStationCode: releaseFrom.trim(),
          toStationCode: releaseTo.trim(),
          reason: releaseReason.trim(),
          workOrderCode: workOrderCode.trim() || undefined,
        },
      );
      if (res?.releaseNo) {
        setFeedback({ ok: true, msg: `${t("mes.stationPass.releaseCreated", locale)} ${res.releaseNo}` });
        setReleaseSn(""); setReleaseReason("");
        void loadReleases();
      } else {
        setFeedback({ ok: false, msg: t("mes.stationPass.failed", locale) });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: errorText(err) });
    }
  };

  const decideRelease = async (releaseNo: string, action: "approve" | "reject") => {
    try {
      await apiClient.post(`/api/mes/station-pass/skip-releases/${encodeURIComponent(releaseNo)}/${action}`, {});
      setFeedback({ ok: true, msg: `${releaseNo} → ${action === "approve" ? t("mes.stationPass.approved", locale) : t("mes.stationPass.rejected", locale)}` });
      void loadReleases();
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
              {t("mes.stationPass.eyebrow", locale)}
            </div>
            <h2 style={{ margin: "6px 0" }}>{t("mes.stationPass.title", locale)}</h2>
            <p style={{ margin: 0, color: "var(--muted)" }}>{t("mes.stationPass.subtitle", locale)}</p>
          </div>
          <button className="action-button" type="button" onClick={() => { void loadHistory(); void loadReleases(); }} title={t("common.refresh", locale)}>
            <RefreshCw size={16} /> {t("common.refresh", locale)}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.1fr) minmax(280px, 1fr)", gap: 16, marginTop: 18 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{t("mes.stationPass.station", locale)}</span>
              <select className="form-input" value={stationCode} onChange={event => setStationCode(event.target.value)} title={t("mes.stationPass.station", locale)}>
                <option value="">{t("mes.stationPass.selectStation", locale)}</option>
                {stations.map(item => (
                  <option key={item.code} value={item.code}>{item.code} · {item.name_zh || item.name_en || ""}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{t("mes.stationPass.sn", locale)}</span>
              <input
                ref={snRef}
                className="form-input"
                value={sn}
                onChange={event => setSn(event.target.value.toUpperCase())}
                onKeyDown={event => { if (event.key === "Enter") void submitPass(); }}
                placeholder={t("mes.stationPass.snPlaceholder", locale)}
                title={t("mes.stationPass.sn", locale)}
                autoFocus
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{t("mes.stationPass.workOrder", locale)}</span>
              <input
                className="form-input"
                value={workOrderCode}
                onChange={event => setWorkOrderCode(event.target.value.toUpperCase())}
                placeholder={t("mes.stationPass.workOrderPlaceholder", locale)}
                title={t("mes.stationPass.workOrder", locale)}
              />
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className={result === "OK" ? "action-button action-button-primary" : "action-button"}
                onClick={() => setResult("OK")}
                title={t("mes.stationPass.resultOk", locale)}
              >
                <CheckCircle2 size={16} /> {t("mes.stationPass.resultOk", locale)}
              </button>
              <button
                type="button"
                className={result === "NG" ? "action-button action-button-danger" : "action-button"}
                onClick={() => setResult("NG")}
                title={t("mes.stationPass.resultNg", locale)}
              >
                <XCircle size={16} /> {t("mes.stationPass.resultNg", locale)}
              </button>
              {result === "NG" && (
                <input
                  className="form-input"
                  style={{ flex: 1, minWidth: 160 }}
                  value={defectCode}
                  onChange={event => setDefectCode(event.target.value.toUpperCase())}
                  placeholder={t("mes.stationPass.defectCode", locale)}
                  title={t("mes.stationPass.defectCode", locale)}
                />
              )}
            </div>

            <button
              className="action-button action-button-primary"
              type="button"
              onClick={() => void submitPass()}
              disabled={busy}
              title={t("mes.stationPass.submit", locale)}
            >
              <ClipboardCheck size={16} /> {busy ? t("mes.stationPass.submitting", locale) : t("mes.stationPass.submit", locale)}
            </button>

            {feedback && (
              <div className={feedback.ok ? "badge badge-success" : "badge badge-danger"} style={{ padding: "10px 12px", fontSize: 13 }}>
                {feedback.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {feedback.msg}
              </div>
            )}
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("mes.stationPass.currentStation", locale)}：{stationName || "—"}
            </div>
          </div>

          <div className="surface-panel" style={{ padding: 14, background: "var(--surface-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <ShieldAlert size={16} />
              <strong style={{ fontSize: 13 }}>{t("mes.stationPass.verdict", locale)}</strong>
            </div>
            {!decision && <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("mes.stationPass.noVerdict", locale)}</div>}
            {decision && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className={gateTone(decision.gateState)}>{decision.gateState}</span>
                  <code style={{ fontSize: 12 }}>{decision.reasonCode}</code>
                </div>
                <div style={{ fontSize: 13 }}>{decision.message}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t("mes.stationPass.nextAction", locale)}：<code>{decision.nextAction}</code>
                  {decision.destinationStationCode ? ` → ${decision.destinationStationCode}` : ""}
                  {decision.nextStationCode ? ` · ${t("mes.stationPass.nextStation", locale)} ${decision.nextStationCode}` : ""}
                </div>
                <div style={{ display: "grid", gap: 4, maxHeight: 260, overflow: "auto" }}>
                  {(decision.checks || []).map(check => (
                    <div key={check.rule} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: check.ok ? "var(--state-ok,#16a34a)" : "var(--state-danger,#dc2626)" }}>
                      {check.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      <span><code>{check.rule}</code> — {check.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="surface-panel" style={{ padding: 20 }}>
        <div className="section-header">
          <div>
            <h3 style={{ margin: 0 }}>{t("mes.stationPass.history", locale)}</h3>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>{t("mes.stationPass.historyHint", locale)}</p>
          </div>
        </div>
        <div className="table-shell" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>{t("mes.stationPass.colTime", locale)}</th>
                <th>{t("mes.stationPass.colSn", locale)}</th>
                <th>{t("mes.stationPass.colStation", locale)}</th>
                <th>{t("mes.stationPass.colResult", locale)}</th>
                <th>{t("mes.stationPass.colGate", locale)}</th>
                <th>{t("mes.stationPass.colRule", locale)}</th>
                <th>{t("mes.stationPass.colOperator", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {history.map(row => (
                <tr key={row.passId}>
                  <td>{new Date(row.decidedAt).toLocaleString(locale)}</td>
                  <td><code>{row.identity}</code></td>
                  <td>{row.stationCode}</td>
                  <td>{row.result}</td>
                  <td><span className={gateTone(row.gateState)}>{row.gateState}</span></td>
                  <td><code style={{ fontSize: 11 }}>{row.reasonCode}</code></td>
                  <td>{row.operatorId}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>{t("mes.stationPass.emptyHistory", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel" style={{ padding: 20 }}>
        <div className="section-header">
          <div>
            <h3 style={{ margin: 0 }}>{t("mes.stationPass.releaseTitle", locale)}</h3>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>{t("mes.stationPass.releaseHint", locale)}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 12 }}>
          <input className="form-input" value={releaseSn} onChange={event => setReleaseSn(event.target.value.toUpperCase())} placeholder={t("mes.stationPass.sn", locale)} title={t("mes.stationPass.sn", locale)} />
          <input className="form-input" value={releaseFrom} onChange={event => setReleaseFrom(event.target.value)} placeholder={t("mes.stationPass.releaseFrom", locale)} title={t("mes.stationPass.releaseFrom", locale)} />
          <input className="form-input" value={releaseTo} onChange={event => setReleaseTo(event.target.value)} placeholder={t("mes.stationPass.releaseTo", locale)} title={t("mes.stationPass.releaseTo", locale)} />
          <input className="form-input" value={releaseReason} onChange={event => setReleaseReason(event.target.value)} placeholder={t("mes.stationPass.releaseReason", locale)} title={t("mes.stationPass.releaseReason", locale)} />
          <button className="action-button" type="button" onClick={() => void createRelease()} title={t("mes.stationPass.releaseCreate", locale)}>
            {t("mes.stationPass.releaseCreate", locale)}
          </button>
        </div>
        <div className="table-shell" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>{t("mes.stationPass.colReleaseNo", locale)}</th>
                <th>{t("mes.stationPass.colSn", locale)}</th>
                <th>{t("mes.stationPass.colHop", locale)}</th>
                <th>{t("mes.stationPass.colReason", locale)}</th>
                <th>{t("mes.stationPass.colStatus", locale)}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {releases.map(row => (
                <tr key={row.releaseNo}>
                  <td><code style={{ fontSize: 11 }}>{row.releaseNo}</code></td>
                  <td><code>{row.identity}</code></td>
                  <td>{row.fromStationCode} → {row.toStationCode}</td>
                  <td>{row.reason}</td>
                  <td><span className="badge badge-warning">{row.status}</span></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="action-button" type="button" onClick={() => void decideRelease(row.releaseNo, "approve")} title={t("mes.stationPass.approve", locale)}>
                      {t("mes.stationPass.approve", locale)}
                    </button>
                    <button className="action-button" type="button" onClick={() => void decideRelease(row.releaseNo, "reject")} title={t("mes.stationPass.reject", locale)}>
                      {t("mes.stationPass.reject", locale)}
                    </button>
                  </td>
                </tr>
              ))}
              {releases.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>{t("mes.stationPass.emptyReleases", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
