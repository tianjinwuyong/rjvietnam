import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { mesApi, type UpstreamCheckResult } from "../api/mes";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface StationInfo { code: string; name_zh: string; line_code: string; station_type: string; }

interface EventResult { ok: boolean; message: string; timestamp: string; }

interface NgAlert {
  id: string;
  sn: string;
  stationCode: string;
  defectCode?: string;
  defectDescription?: string;
  operator?: string;
  receivedAt: Date;
  /** Auto-dismiss countdown in ms */
  expiresAt: number;
}

export function StationOperator({ locale }: { locale: Locale }) {
  const [stations, setStations] = useState<StationInfo[]>([]);
  const [selectedStation, setSelectedStation] = useState<StationInfo | null>(null);
  const [pcbSerial, setPcbSerial] = useState("");
  const [workOrderCode, setWorkOrderCode] = useState("");
  const [ngReason, setNgReason] = useState("");
  const [lastResult, setLastResult] = useState<EventResult | null>(null);
  const [todayCounts, setTodayCounts] = useState<{ checkin: number; output: number; ng: number }>({ checkin: 0, output: 0, ng: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [blockDialog, setBlockDialog] = useState<{ open: boolean; reason: string; details?: string }>({ open: false, reason: "", details: undefined });
  const [dupDialog, setDupDialog] = useState<{ open: boolean; sn: string; dupId: string }>({ open: false, sn: "", dupId: "" });
  const [repairRequired, setRepairRequired] = useState(false);
  const [unknownWarning, setUnknownWarning] = useState(false);
  const [liveNgAlerts, setLiveNgAlerts] = useState<NgAlert[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load station list from API
  useEffect(() => {
    fetch("/api/stations")
      .then((r) => r.json())
      .then((d) => setStations(d.data ?? d.items ?? []))
      .catch(() => {});
  }, []);

  // Auto-select from URL param ?station=AUTO-01
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stationParam = params.get("station");
    if (stationParam && stations.length > 0) {
      const found = stations.find((s) => s.code === stationParam);
      if (found) setSelectedStation(found);
    }
  }, [stations]);

  // SSE subscription — subscribe to NG_DEFECT broadcast from the same line
  useEffect(() => {
    if (!selectedStation) return;

    const url = `/api/pda/events?node=station_op_${selectedStation.code}&types=NG_DEFECT`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === "CONNECTED") return;
        if (evt.type !== "NG_DEFECT") return;

        const payload = evt.payload ?? {};
        const fromStation = evt.from ?? payload.stationCode ?? "unknown";
        const lineOfNg = payload.lineCode ?? "";

        // Only show alerts from the same line as the selected station
        if (lineOfNg && lineOfNg !== selectedStation.line_code) return;

        const alert: NgAlert = {
          id: evt._id ?? `ng_${Date.now()}`,
          sn: payload.sn ?? "unknown",
          stationCode: fromStation,
          defectCode: payload.defectCode,
          defectDescription: payload.defectDescription,
          operator: payload.operator,
          receivedAt: new Date(evt._ts ?? Date.now()),
          expiresAt: Date.now() + 30_000, // auto-dismiss after 30s
        };

        setLiveNgAlerts((prev) => {
          // Keep last 10 alerts, avoid duplicates by id
          const filtered = prev.filter((a) => a.id !== alert.id);
          return [alert, ...filtered].slice(0, 10);
        });
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // Reconnect automatically via EventSource
      es.close();
    };

    return () => {
      es.close();
    };
  }, [selectedStation]);

  // Auto-dismiss expired NG alerts every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveNgAlerts((prev) => prev.filter((a) => Date.now() < a.expiresAt));
    }, 5_000);
    return () => clearInterval(interval);
  }, []);

  // Focus barcode input on mount and after each action
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [lastResult, selectedStation]);

  async function postEvent(eventType: string, result: string, extra: Record<string, string> = {}) {
    if (!selectedStation) { alert("请先选择工位"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/mes/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            stationCode: selectedStation.code,
            pcbSerial: pcbSerial || undefined,
            eventType,
            result,
            traceKey: workOrderCode || undefined,
            operator: extra.operator ?? "AUTO_OP",
            ...extra,
          },
        }),
      });
      const data = await res.json();
      const ok = res.ok;
      setLastResult({ ok, message: ok ? (data.message ?? `OK: ${eventType}`) : (data.message ?? JSON.stringify(data)), timestamp: new Date().toLocaleTimeString() });
      // Update counts
      if (ok) {
        setTodayCounts((prev) => ({ ...prev, [eventType]: prev[eventType as keyof typeof prev] + 1 }));
      }
      setPcbSerial("");
      setNgReason("");
      if (autoMode) {
        setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 300);
      }
    } catch (e: any) {
      setLastResult({ ok: false, message: e.message, timestamp: new Date().toLocaleTimeString() });
    } finally {
      setSubmitting(false);
    }
  }

  /** Check upstream NG history and retest state before allowing a PASS. */
  async function checkUpstreamAndPost(eventType: string, result: string, extra: Record<string, string> = {}) {
    if (!pcbSerial.trim()) {
      setLastResult({ ok: false, message: t("mes.operator.noSerial", locale), timestamp: new Date().toLocaleTimeString() });
      return;
    }
    if (!selectedStation) { alert("请先选择工位"); return; }

    // 1. Call upstream-check API
    let upstreamResult: UpstreamCheckResult | null = null;
    try {
      const res = await mesApi.getUpstreamCheck(pcbSerial, selectedStation.code);
      upstreamResult = res ?? null;
    } catch {
      // Network error — proceed with caution
      setUnknownWarning(true);
      await postEvent(eventType, result, extra);
      return;
    }

    // 2. BLOCK_NG — upstream FAIL found, board cannot pass downstream
    if (upstreamResult?.verdict === "BLOCK_NG") {
      const ngEvents = upstreamResult.upstreamEvents?.filter(e => e.result === "fail") ?? [];
      const lastNg = ngEvents[ngEvents.length - 1];
      setBlockDialog({
        open: true,
        reason: t("mes.operator.blockNgReason", locale),
        details: lastNg
          ? `${lastNg.stationCode} @ ${new Date(lastNg.occurredAt).toLocaleString()} — ${lastNg.operatorName ?? "unknown operator"}`
          : undefined,
      });
      return;
    }

    // 2b. DUP SN detected upstream — show warning but allow override
    if (upstreamResult?.hasDuplicate && upstreamResult?.duplicateInfo) {
      const dup = upstreamResult.duplicateInfo;
      setDupDialog({
        open: true,
        sn: pcbSerial,
        dupId: String(dup.id),
      });
      return;
    }

    // 3. Retest enforcement — if board has an unrepaired fail at THIS station,
    //    it cannot PASS until repair is complete (repair_status must be 'repaired')
    if (result === "pass") {
      const failsAtThisStation = upstreamResult?.upstreamEvents?.filter(
        (e) => e.stationCode === selectedStation.code && e.result === "fail",
      ) ?? [];
      if (failsAtThisStation.length > 0) {
        const latestFail = failsAtThisStation[failsAtThisStation.length - 1];
        const repairStatus = (latestFail as any).repairStatus as string | undefined;
        if (repairStatus === "pending") {
          setRepairRequired(true);
          return;
        }
      }
    }

    // 4. Must repair — 2+ FAILs at this station, cannot PASS without repair
    if (upstreamResult?.mustRepair) {
      setRepairRequired(true);
      return;
    }

    // 5. UNKNOWN — no upstream history, warn but allow
    if (upstreamResult?.verdict === "UNKNOWN") {
      setUnknownWarning(true);
    }

    // 6. OK or UNKNOWN — proceed
    await postEvent(eventType, result, extra);
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pcbSerial.trim()) return;
    // Auto-detect event type from barcode prefix or default to checkin
    if (pcbSerial.startsWith("PCB-")) {
      postEvent("checkin", "pass", { pcbSerial });
    } else {
      postEvent("checkin", "pass", { pcbSerial });
    }
  }

  const btnBase: React.CSSProperties = {
    border: "none",
    borderRadius: 12,
    padding: "24px 16px",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    flex: "1 1 0",
    minWidth: 120,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    transition: "transform 0.1s",

  };

  const BTN_STYLES = {
    checkin: { ...btnBase, background: "#3b82f6", color: "#fff" },
    output: { ...btnBase, background: "#22c55e", color: "#fff" },
    ng: { ...btnBase, background: "#ef4444", color: "#fff" },
    standby: { ...btnBase, background: "#6b7280", color: "#fff" },
  };

  const station = selectedStation;

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      {/* Station selector */}
      <div className="surface-panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>{t("pmc.stationCode", locale)} *</label>
            <select
              value={station?.code ?? ""}
              onChange={(e) => {
                const s = stations.find((x) => x.code === e.target.value);
                setSelectedStation(s ?? null);
                setTodayCounts({ checkin: 0, output: 0, ng: 0 });
                setLastResult(null);
              }}
              style={{ width: "100%", fontSize: 16, padding: "8px 12px" }}
            >
              <option value="">— 选择工位 —</option>
              {stations.map((s) => (
                <option key={s.code} value={s.code}>{s.code} / {s.name_zh} ({s.line_code})</option>
              ))}
            </select>
          </div>
          {station && (
            <div style={{ flex: "0 0 auto", textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{station.line_code} · {station.station_type}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{station.name_zh}</div>
            </div>
          )}
          <div style={{ flex: "0 0 auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
              自动模式
            </label>
          </div>
        </div>
      </div>

      {/* Active station panel */}
      {!station ? (
        <div className="surface-panel" style={{ textAlign: "center", padding: "60px 24px", color: "var(--muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏭</div>
          <div style={{ fontSize: 20 }}>请从上方选择工位</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>或访问 ?station=AUTO-01 直接定位</div>
        </div>
      ) : (
        <>
          {/* Live NG broadcast alerts from upstream stations on same line */}
          {liveNgAlerts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span>🔴</span>
                <span>{t("mes.operator.liveNgAlert.title", locale)}</span>
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>— {t("mes.operator.liveNgAlert.sameLine", locale)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {liveNgAlerts.map((alert) => {
                  const secondsLeft = Math.max(0, Math.ceil((alert.expiresAt - Date.now()) / 1000));
                  return (
                    <div
                      key={alert.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: "rgba(239,68,68,0.10)",
                        border: "1px solid rgba(239,68,68,0.30)",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>🔴</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>
                            {alert.stationCode}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--text)" }}>
                            SN: <code style={{ background: "rgba(239,68,68,0.08)", padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>{alert.sn}</code>
                          </span>
                          {alert.defectDescription && (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>
                              {alert.defectDescription}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                          {t("mes.operator.liveNgAlert.operator", locale)}: {alert.operator ?? "—"} &nbsp;·&nbsp; {t("mes.operator.liveNgAlert.time", locale)}: {alert.receivedAt.toLocaleTimeString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "rgba(239,68,68,0.6)" }}>
                          {secondsLeft}s
                        </span>
                        <button
                          type="button"
                          onClick={() => setLiveNgAlerts((prev) => prev.filter((a) => a.id !== alert.id))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: 14, padding: "2px 4px" }}
                          title={t("mes.operator.liveNgAlert.dismiss", locale)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Scan input */}
          <div className="surface-panel" style={{ marginBottom: 16 }}>
            <form onSubmit={handleBarcodeSubmit}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                PCB 序列号 / 工单编码 {autoMode ? "(自动模式)" : ""}
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={pcbSerial}
                  onChange={(e) => { setPcbSerial(e.target.value); setBlockDialog({ open: false, reason: "", details: undefined }); setRepairRequired(false); setUnknownWarning(false); setDupDialog({ open: false, sn: "", dupId: "" }); }}
                  placeholder={autoMode ? "扫码后自动提交..." : "PCB-2026-XXXXX 或工单号"}
                  style={{ flex: 1, fontSize: 20, padding: "12px 16px", borderRadius: 8, border: "2px solid var(--border)", background: "var(--bg-elevated)" }}
                />
                <button type="submit" style={{ padding: "12px 24px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
                  报到
                </button>
              </div>
            </form>
            <div className="field" style={{ marginTop: 8 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>工单编码</label>
              <input type="text" value={workOrderCode} onChange={(e) => setWorkOrderCode(e.target.value)} placeholder="26061020007" style={{ fontSize: 16, padding: "8px 12px", width: "100%", borderRadius: 6, border: "1px solid var(--border)" }} />
            </div>
          </div>

          {/* Big action buttons */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              style={BTN_STYLES.checkin}
              onClick={() => postEvent("checkin", "pass")}
              disabled={submitting}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ fontSize: 32 }}>✓</span>
              <span>报到</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>CHECK-IN</span>
            </button>
            <button
              style={{ ...BTN_STYLES.output, opacity: repairRequired ? 0.5 : 1 }}
              onClick={() => checkUpstreamAndPost("output", "pass")}
              disabled={submitting || repairRequired}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ fontSize: 32 }}>✔</span>
              <span>{repairRequired ? t("mes.operator.repairRequired", locale) : "产出"}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{repairRequired ? "REPAIR" : "OUTPUT"}</span>
            </button>
            <button
              style={BTN_STYLES.ng}
              onClick={() => {
                const reason = ngReason || prompt("请输入NG原因（可选）") || "NG";
                setNgReason(reason);
                postEvent("ng", "fail", { defectDescription: reason });
              }}
              disabled={submitting}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ fontSize: 32 }}>✗</span>
              <span>不良</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>NG</span>
            </button>
            <button
              style={BTN_STYLES.standby}
              onClick={() => postEvent("standby", "skip")}
              disabled={submitting}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ fontSize: 32 }}>⏸</span>
              <span>待机</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>STANDBY</span>
            </button>
          </div>

          {/* NG reason input */}
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              value={ngReason}
              onChange={(e) => setNgReason(e.target.value)}
              placeholder="NG原因（用于NG按钮快捷输入）"
              style={{ width: "100%", fontSize: 14, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
          </div>

          {/* BLOCK_NG dialog */}
          {blockDialog.open && (
            <div
              className="surface-panel"
              style={{
                marginBottom: 16,
                borderLeft: "6px solid #ef4444",
                background: "rgba(239,68,68,0.08)",
                padding: "16px",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>✗ {t("mes.operator.blockedTitle", locale)}</span>
                <button
                  onClick={() => setBlockDialog({ open: false, reason: "", details: undefined })}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 18 }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 14, color: "#ef4444", marginTop: 6, fontWeight: 600 }}>
                {blockDialog.reason}
              </div>
              {blockDialog.details && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {blockDialog.details}
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                {t("mes.operator.blockedHint", locale)}
              </div>
            </div>
          )}

          {/* DUP SN warning dialog */}
          {dupDialog.open && (
            <div
              className="surface-panel"
              style={{
                marginBottom: 16,
                borderLeft: "6px solid #f97316",
                background: "rgba(249,115,22,0.08)",
                padding: "16px",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#f97316" }}>⚠️ 重复码警告</span>
                <button
                  onClick={() => setDupDialog({ open: false, sn: "", dupId: "" })}
                  style={{ background: "none", border: "none", color: "#f97316", cursor: "pointer", fontSize: 18 }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 14, color: "#f97316", marginTop: 6, fontWeight: 600 }}>
                SN: <code>{dupDialog.sn}</code> 已被使用
              </div>
              {dupDialog.dupId && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  重复记录ID: {dupDialog.dupId}
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                此SN已在其他工站扫描过，请确认是否为重复扫码。
              </div>
            </div>
          )}

          {/* Repair required warning */}
          {repairRequired && (
            <div
              className="surface-panel"
              style={{
                marginBottom: 16,
                borderLeft: "6px solid #f59e0b",
                background: "rgba(245,158,11,0.08)",
                padding: "16px",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#f59e0b" }}>⚠ {t("mes.operator.repairRequiredTitle", locale)}</span>
                <button
                  onClick={() => { setRepairRequired(false); setPcbSerial(""); }}
                  style={{ background: "none", border: "none", color: "#f59e0b", cursor: "pointer", fontSize: 18 }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 14, color: "#f59e0b", marginTop: 6, fontWeight: 600 }}>
                {t("mes.operator.repairRequiredMsg", locale)}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                {t("mes.operator.repairRequiredHint", locale)}
              </div>
            </div>
          )}

          {/* Unknown upstream warning */}
          {unknownWarning && (
            <div
              className="surface-panel"
              style={{
                marginBottom: 16,
                borderLeft: "6px solid #3b82f6",
                background: "rgba(59,130,246,0.06)",
                padding: "12px 16px",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "#3b82f6", fontWeight: 600 }}>
                  ⚠ {t("mes.operator.unknownUpstreamWarning", locale)}
                </span>
                <button
                  onClick={() => setUnknownWarning(false)}
                  style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 14 }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Last result */}
          {lastResult && (
            <div
              className="surface-panel"
              style={{
                marginBottom: 16,
                borderLeft: `6px solid ${lastResult.ok ? "#22c55e" : "#ef4444"}`,
                background: lastResult.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: lastResult.ok ? "#22c55e" : "#ef4444" }}>
                  {lastResult.ok ? "✓ 成功" : "✗ 失败"}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{lastResult.timestamp}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4, wordBreak: "break-all" }}>{lastResult.message}</div>
            </div>
          )}

          {/* Today's counts */}
          <div style={{ display: "flex", gap: 12 }}>
            {[
              { label: "报到", key: "checkin", color: "#3b82f6" },
              { label: "产出", key: "output", color: "#22c55e" },
              { label: "NG", key: "ng", color: "#ef4444" },
            ].map(({ label, key, color }) => (
              <div key={key} className="surface-panel" style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 36, fontWeight: 700, color }}>{todayCounts[key as keyof typeof todayCounts]}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
