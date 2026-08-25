import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";

interface UpstreamAlert {
  verdict: "BLOCK_NG" | "OK" | "UNKNOWN";
  hasNg: boolean;
  hasPass: boolean;
  events: Array<{
    stationCode: string;
    eventType: string;
    result: string;
    occurredAt: string;
    operatorName?: string;
  }>;
}

export function PmcStationCheckin({ locale }: { locale: Locale }) {
  const [stationCode, setStationCode] = useState("");
  const [pcbSerial, setPcbSerial] = useState("");
  const [eventType, setEventType] = useState<"checkin" | "output" | "ng">("checkin");
  const [result, setResult] = useState("");
  const [workOrderCode, setWorkOrderCode] = useState("");
  const [operator, setOperator] = useState("VN_OP_001");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [upstreamAlert, setUpstreamAlert] = useState<UpstreamAlert | null>(null);
  const [checkingUpstream, setCheckingUpstream] = useState(false);

  // Debounced upstream check when SN changes
  async function checkUpstream(sn: string, sc: string) {
    if (!sn || !sc) { setUpstreamAlert(null); return; }
    setCheckingUpstream(true);
    try {
      const res = await mesApi.getUpstreamCheck(sn, sc) as any;
      if (res?.data) {
        setUpstreamAlert({
          verdict: res.data.verdict,
          hasNg: res.data.hasNg,
          hasPass: res.data.hasPass,
          events: res.data.upstreamEvents ?? [],
        });
      }
    } catch {
      setUpstreamAlert(null);
    } finally {
      setCheckingUpstream(false);
    }
  }

  function handleSnChange(val: string) {
    setPcbSerial(val);
    if (val.length > 4) {
      checkUpstream(val, stationCode);
    } else {
      setUpstreamAlert(null);
    }
  }

  function handleStationChange(val: string) {
    setStationCode(val);
    if (pcbSerial && pcbSerial.length > 4) {
      checkUpstream(pcbSerial, val);
    }
  }

  async function handleSubmit() {
    if (!stationCode) { alert(t("pmc.stationCheckin.stationCodeRequired", locale)); return; }
    if (upstreamAlert?.verdict === "BLOCK_NG") {
      alert(t("pmc.stationCheckin.blockNgAlert", locale));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/mes/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            stationCode,
            pcbSerial: pcbSerial || undefined,
            eventType,
            result: result || (eventType === "checkin" ? "OK" : eventType === "output" ? "PASS" : "NG"),
            traceKey: workOrderCode || undefined,
            operator,
          },
        }),
      });
      const data = await res.json();
      setLastResult({ success: res.ok, data });
      if (res.ok) {
        setPcbSerial("");
        setResult("");
        setUpstreamAlert(null);
      }
    } catch (e: any) {
      setLastResult({ success: false, error: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.stationCheckin", locale)}</h2>
            <p>{t("pmc.stationCheckinDesc", locale)}</p>
          </div>
        </div>
      </div>

      {/* Upstream NG Alert Banner */}
      {upstreamAlert && (
        <div
          className="surface-panel"
          style={{
            borderLeft: `4px solid ${
              upstreamAlert.verdict === "BLOCK_NG"
                ? "var(--danger, #dc2626)"
                : upstreamAlert.verdict === "OK"
                ? "var(--ok, #16a34a)"
                : "var(--warning, #d97706)"
            }`,
            background: upstreamAlert.verdict === "BLOCK_NG"
              ? "rgba(220,38,38,0.08)"
              : upstreamAlert.verdict === "OK"
              ? "rgba(22,163,74,0.08)"
              : "rgba(217,119,6,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              {upstreamAlert.verdict === "BLOCK_NG" && (
                <strong style={{ color: "var(--danger, #dc2626)", fontSize: 16 }}>
                  &#x26A0; {t("pmc.stationCheckin.blockNg", locale)}
                </strong>
              )}
              {upstreamAlert.verdict === "OK" && (
                <strong style={{ color: "var(--ok, #16a34a)", fontSize: 16 }}>
                  &#x2714; {t("pmc.stationCheckin.upstreamOk", locale)}
                </strong>
              )}
              {upstreamAlert.verdict === "UNKNOWN" && (
                <strong style={{ color: "var(--warning, #d97706)", fontSize: 16 }}>
                  &#x2139; {t("pmc.stationCheckin.unknownBoard", locale)}
                </strong>
              )}
            {checkingUpstream && <span style={{ color: "#888", fontSize: 12 }}>{t("pmc.stationCheckin.querying", locale)}</span>}
          </div>
          {upstreamAlert.events.length > 0 && (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.1)" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>{t("pmc.stationCode", locale)}</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>{t("pmc.eventType", locale)}</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>{t("pmc.result", locale)}</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>{t("pmc.reportedAt", locale)}</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>{t("pmc.operator", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {upstreamAlert.events.map((ev, i) => (
                  <tr key={i} style={{ background: ev.result === "fail" ? "rgba(220,38,38,0.1)" : undefined }}>
                    <td style={{ padding: "4px 8px" }}>{ev.stationCode}</td>
                    <td style={{ padding: "4px 8px" }}>{ev.eventType}</td>
                    <td style={{ padding: "4px 8px", color: ev.result === "fail" ? "var(--danger,#dc2626)" : "var(--ok,#16a34a)", fontWeight: "bold" }}>
                      {ev.result}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{new Date(ev.occurredAt).toLocaleString()}</td>
                    <td style={{ padding: "4px 8px" }}>{ev.operatorName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="surface-panel">
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>{t("pmc.stationCode", locale)} *</label>
            <input type="text" value={stationCode} placeholder="ICT-01" onChange={(e) => handleStationChange(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("pmc.workOrder", locale)}</label>
            <input type="text" value={workOrderCode} placeholder="26061020007" onChange={(e) => setWorkOrderCode(e.target.value)} />
          </div>
          <div className="field">
            <label>PCB SN</label>
            <input type="text" value={pcbSerial} placeholder="PCB-2026-XXXXX" onChange={(e) => handleSnChange(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("pmc.operator", locale)}</label>
            <input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("pmc.eventType", locale)}</label>
            <select value={eventType} onChange={(e) => setEventType(e.target.value as any)}>
              <option value="checkin" key="checkin-opt">{t("pmc.stationCheckin.eventCheckin", locale)}</option>
              <option value="output" key="output-opt">{t("pmc.stationCheckin.eventOutput", locale)}</option>
              <option value="ng" key="ng-opt">{t("pmc.stationCheckin.eventNg", locale)}</option>
            </select>
          </div>
          <div className="field">
            <label>{t("pmc.result", locale)}</label>
            <input type="text" value={result} placeholder={eventType === "checkin" ? "OK" : eventType === "output" ? "PASS" : "NG reason"} onChange={(e) => setResult(e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="action-button"
            onClick={handleSubmit}
            disabled={submitting || upstreamAlert?.verdict === "BLOCK_NG"}
            style={upstreamAlert?.verdict === "BLOCK_NG" ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            {submitting ? t("common.loading", locale) : upstreamAlert?.verdict === "BLOCK_NG" ? t("pmc.stationCheckin.submitBlocked", locale) : t("common.submit", locale)}
          </button>
          <button className="action-button secondary" onClick={() => { setStationCode(""); setPcbSerial(""); setResult(""); setWorkOrderCode(""); setUpstreamAlert(null); }}>
            {t("common.reset", locale)}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="surface-panel">
          <div className="section-header"><h3>{t("pmc.submitResult", locale)}</h3></div>
          <pre style={{ fontSize: 12, overflowX: "auto", color: lastResult.success ? "var(--ok, #16a34a)" : "var(--danger, #dc2626)" }}>
            {lastResult.success ? JSON.stringify(lastResult.data, null, 2) : lastResult.error}
          </pre>
        </div>
      )}
    </div>
  );
}
