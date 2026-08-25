import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { TranslationKey } from "../i18n";
import { mesApi, type UpstreamCheckResult } from "../api/mes";
import { repairStationApi, type RepairStationContextResponse } from "../api/repairStation";

// ── Types ────────────────────────────────────────────────────────────

interface NgAlert {
  id: string;
  sn: string;
  stationCode: string;
  defectDescription?: string;
  operator?: string;
  receivedAt: Date;
  expiresAt: number;
}

interface RepairEvent {
  id: string;
  sn: string;
  stationCode: string;
  result: string;
  defectDescription?: string;
  occurredAt: string;
  operatorName?: string;
  repairStatus?: string;
}

const REPAIR_STATION = "REPAIR-01";

// ── Component ────────────────────────────────────────────────────────

export function RepairStation({ locale }: { locale: Locale }) {
  const [pcbSerial, setPcbSerial] = useState("");
  const [workOrderCode, setWorkOrderCode] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string; timestamp: string } | null>(null);
  const [upstreamEvents, setUpstreamEvents] = useState<RepairEvent[]>([]);
  const [upstreamCheck, setUpstreamCheck] = useState<UpstreamCheckResult | null>(null);
  const [liveNgAlerts, setLiveNgAlerts] = useState<NgAlert[]>([]);
  const [loadingUpstream, setLoadingUpstream] = useState(false);
  const [integrationContext, setIntegrationContext] = useState<RepairStationContextResponse | null>(null);
  const [materialCode, setMaterialCode] = useState("");
  const [materialLot, setMaterialLot] = useState("");
  const [materialQuantity, setMaterialQuantity] = useState("1");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // SSE subscription — receive NG_DEFECT broadcasts from all stations
  useEffect(() => {
    const url = `/api/pda/events?node=station_op_${REPAIR_STATION}&types=NG_DEFECT,MAINTENANCE_HANDOVER_BILL_CREATED`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === "CONNECTED") return;
        if (evt.type === "MAINTENANCE_HANDOVER_BILL_CREATED") {
          const payload = evt.payload ?? {};
          if (payload.destinationStation !== "manu_rework") return;
          const alert: NgAlert = {
            id: evt._id ?? `migration_${Date.now()}`,
            sn: payload.ngSn ?? "unknown",
            stationCode: payload.sourceStation ?? evt.stationCode ?? "unknown",
            defectDescription: `维修工单 ${payload.repairWorkOrderNo ?? ""}`.trim(),
            receivedAt: new Date(evt._ts ?? Date.now()),
            expiresAt: Date.now() + 60_000,
          };
          setLiveNgAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 10));
          setLastResult({ ok: false, message: `收到NG维修任务：${alert.sn}`, timestamp: new Date().toLocaleTimeString() });
          new Audio("/audio/maintenance-ng-received.wav").play().catch(() => void 0);
          return;
        }
        if (evt.type !== "NG_DEFECT") return;

        const payload = evt.payload ?? {};
        const alert: NgAlert = {
          id: evt._id ?? `ng_${Date.now()}`,
          sn: payload.sn ?? "unknown",
          stationCode: evt.from ?? payload.stationCode ?? "unknown",
          defectDescription: payload.defectDescription,
          operator: payload.operator,
          receivedAt: new Date(evt._ts ?? Date.now()),
          expiresAt: Date.now() + 30_000,
        };

        setLiveNgAlerts((prev) => {
          const filtered = prev.filter((a) => a.id !== alert.id);
          return [alert, ...filtered].slice(0, 10);
        });
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => { es.close(); };

    return () => { es.close(); };
  }, []);

  // Auto-dismiss expired alerts
  useEffect(() => {
    const iv = setInterval(() => {
      setLiveNgAlerts((prev) => prev.filter((a) => Date.now() < a.expiresAt));
    }, 5_000);
    return () => clearInterval(iv);
  }, []);

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [lastResult]);

  // Fetch upstream events for a scanned SN
  async function fetchUpstream(sn: string) {
    setLoadingUpstream(true);
    try {
      // Get upstream NG events from the failing station that sent board here
      const uc = await mesApi.getUpstreamCheck(sn, REPAIR_STATION);
      setUpstreamCheck(uc ?? null);
      const context = await repairStationApi.getContext(sn, workOrderCode.trim());
      setIntegrationContext(context ?? null);

      if (uc?.upstreamEvents) {
        // Show all NG events from upstream stations
        const ngEvents: RepairEvent[] = uc.upstreamEvents
          .filter((e: any) => e.result === "fail")
          .map((e: any) => ({
            id: e.id,
            sn,
            stationCode: e.stationCode,
            result: e.result,
            defectDescription: (e as any).defectDesc ?? (e as any).defectDescription ?? "—",
            occurredAt: e.occurredAt,
            operatorName: e.operatorName,
            repairStatus: (e as any).repairStatus,
          }));
        setUpstreamEvents(ngEvents);
      }
    } catch {
      setUpstreamEvents([]);
      setUpstreamCheck(null);
      setIntegrationContext(null);
    } finally {
      setLoadingUpstream(false);
    }
  }

  async function sendIntegrationCommand(type: "REPAIR_STARTED" | "MATERIAL_USAGE_RECORDED" | "QMS_EVIDENCE_ATTACHED" | "RETEST_REQUESTED") {
    if (!pcbSerial.trim()) return;
    setCommandBusy(true);
    try {
      const payload = type === "MATERIAL_USAGE_RECORDED"
        ? { materialCode, lotNo: materialLot, quantity: Number(materialQuantity) }
        : { note: evidenceNote || notes, source: "REPAIR_STATION_UI" };
      await repairStationApi.sendCommand({ type, stationCode: REPAIR_STATION, sn: pcbSerial.trim(), workOrderNo: workOrderCode.trim() || undefined, operator: "REPAIR_OPERATOR", payload });
      setLastResult({ ok: true, message: `${type} accepted by MES`, timestamp: new Date().toLocaleTimeString() });
      if (type === "MATERIAL_USAGE_RECORDED") {
        setMaterialCode(""); setMaterialLot(""); setMaterialQuantity("1");
      }
    } catch (error: any) {
      setLastResult({ ok: false, message: error.message, timestamp: new Date().toLocaleTimeString() });
    } finally { setCommandBusy(false); }
  }

  // Post repair result event
  async function postRepairResult(result: "pass" | "fail", sn: string, wo: string) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/mes/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "station_event",
          payload: {
            stationCode: REPAIR_STATION,
            pcbSerial: sn,
            workOrderCode: wo || undefined,
            result,
            defectDescription: notes || undefined,
            extraParams: { repairResult: result, repairNotes: notes },
          },
        }),
      });
      const data = await res.json();
      const ok = res.ok;
      setLastResult({
        ok,
        message: ok
          ? result === "pass"
            ? t("mes.repair.repairComplete", locale)
            : t("mes.repair.repairFailed", locale)
          : (data.message ?? JSON.stringify(data)),
        timestamp: new Date().toLocaleTimeString(),
      });
      if (ok) {
        setPcbSerial("");
        setWorkOrderCode("");
        setNotes("");
        setUpstreamEvents([]);
        setUpstreamCheck(null);
        setIntegrationContext(null);
      }
    } catch (e: any) {
      setLastResult({ ok: false, message: e.message, timestamp: new Date().toLocaleTimeString() });
    } finally {
      setSubmitting(false);
    }
  }

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!pcbSerial.trim()) return;
    fetchUpstream(pcbSerial.trim());
  }

  function handleRepairComplete() {
    if (!pcbSerial.trim()) return;
    postRepairResult("pass", pcbSerial.trim(), workOrderCode.trim());
  }

  function handleRepairFailed() {
    if (!pcbSerial.trim()) return;
    postRepairResult("fail", pcbSerial.trim(), workOrderCode.trim());
  }

  async function exportWorkOrders() {
    setExportBusy(true);
    try {
      await repairStationApi.downloadWorkOrdersExcel({ stationCode: REPAIR_STATION, limit: 5000 });
      setLastResult({ ok: true, message: "Work-order document exported", timestamp: new Date().toLocaleTimeString() });
    } catch (error) {
      setLastResult({ ok: false, message: error instanceof Error ? error.message : String(error), timestamp: new Date().toLocaleTimeString() });
    } finally {
      setExportBusy(false);
    }
  }

  const btnBase: React.CSSProperties = {
    border: "none",
    borderRadius: 12,
    padding: "20px 16px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    flex: "1 1 0",
    minWidth: 140,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  };

  return (
    <div style={{ padding: 16, maxWidth: 860, margin: "0 auto" }}>
      {/* Live NG Alerts */}
      {liveNgAlerts.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span>🔴</span>
            <span>{t("mes.repair.ngAlert", locale)}</span>
          </div>
          {liveNgAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 4,
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong style={{ color: "var(--danger)" }}>{alert.stationCode}</strong>
                {" — "}
                <span>{alert.sn}</span>
                {alert.defectDescription && <span style={{ color: "var(--muted)" }}> · {alert.defectDescription}</span>}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>
                {new Date(alert.receivedAt).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SN Scan Input */}
      <div className="surface-panel" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--info)", marginBottom: 10, letterSpacing: "0.05em" }}>
          {t("mes.repair.title", locale).toUpperCase()} — {REPAIR_STATION}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button type="button" onClick={exportWorkOrders} disabled={exportBusy} style={{ padding: "5px 10px", fontSize: 11 }}>
            {exportBusy ? "Exporting..." : "Export work orders"}
          </button>
        </div>
        <form onSubmit={handleScan} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "2 2 200px" }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              {t("mes.operator.sn", locale)} *
            </label>
            <input
              ref={inputRef}
              type="text"
              value={pcbSerial}
              onChange={(e) => setPcbSerial(e.target.value)}
              placeholder={t("mes.repair.scanHint", locale)}
              style={{ width: "100%", fontSize: 18, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "var(--input-bg)", color: "var(--text)", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              {t("mes.operator.workOrder", locale)}
            </label>
            <input
              type="text"
              value={workOrderCode}
              onChange={(e) => setWorkOrderCode(e.target.value)}
              placeholder="SMT-WO-001"
              style={{ width: "100%", fontSize: 16, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "var(--input-bg)", color: "var(--text)", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button
              type="submit"
              disabled={!pcbSerial.trim() || loadingUpstream}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: "var(--info)",
                color: "#fff",
                fontWeight: 700,
                cursor: pcbSerial.trim() && !loadingUpstream ? "pointer" : "not-allowed",
                opacity: pcbSerial.trim() && !loadingUpstream ? 1 : 0.5,
              }}
            >
              {loadingUpstream ? "…" : t("common.search", locale)}
            </button>
          </div>
        </form>
      </div>

      {/* Upstream NG Events */}
      {upstreamEvents.length > 0 && (
        <div className="surface-panel" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚠️</span>
            <span>{t("mes.repair.defectInfo", locale)}</span>
            <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>
              — {t("mes.repair.defectFrom", locale)}: {upstreamEvents[0]?.stationCode}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {upstreamEvents.map((evt, i) => (
              <div
                key={i}
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <strong style={{ color: "var(--danger)" }}>{evt.stationCode}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    {new Date(evt.occurredAt).toLocaleString(locale)}
                  </span>
                </div>
                <div style={{ color: "var(--text)", opacity: 0.8 }}>
                  {evt.defectDescription && evt.defectDescription !== "—" ? evt.defectDescription : t("mes.repair.defectInfo", locale)}
                </div>
                {evt.operatorName && (
                  <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                    {t("mes.operator.operator", locale)}: {evt.operatorName}
                  </div>
                )}
                {evt.repairStatus && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: evt.repairStatus === "repaired"
                        ? "rgba(34,197,94,0.2)" : evt.repairStatus === "scrapped"
                        ? "rgba(239,68,68,0.2)" : "rgba(251,191,36,0.2)",
                      color: evt.repairStatus === "repaired"
                        ? "#4ade80" : evt.repairStatus === "scrapped"
                        ? "#fca5a5" : "#fbbf24",
                    }}>
                      {t(`mes.repair.status.${evt.repairStatus}` as TranslationKey, locale)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {upstreamCheck && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 12, color: "var(--muted)" }}>
              {t("mes.repair.reworkPass", locale)}: {upstreamCheck.hasPass ? t("common.yes", locale) : t("common.no", locale)}
              {" · "}failCount: {upstreamCheck.failCount ?? 0}
              {" · "}mustRepair: {upstreamCheck.mustRepair ? t("common.yes", locale) : t("common.no", locale)}
              {" · "}pendingNg: {upstreamCheck.pendingNgCount ?? 0}
            </div>
          )}
        </div>
      )}

      {integrationContext && (
        <div className="surface-panel" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>维修协同 · MES / WMS / QMS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
            {(["mes", "wms", "qms"] as const).map((service) => {
              const status = integrationContext[service];
              return <div key={service} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 700, textTransform: "uppercase" }}>{service}</div>
                <div style={{ color: status.available ? "#4ade80" : "#fbbf24", fontSize: 12 }}>{status.available ? "connected" : `unavailable${status.error ? `: ${status.error}` : ""}`}</div>
                {service === "mes" && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{String(integrationContext.mes.workOrder?.status || "no work order")}</div>}
                {service === "wms" && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{integrationContext.wms.lots.length} lots visible</div>}
                {service === "qms" && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{String(integrationContext.qms.case?.status || "no QMS case")}</div>}
              </div>;
            })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" disabled={commandBusy} onClick={() => sendIntegrationCommand("REPAIR_STARTED")} style={{ padding: "8px 12px" }}>Start repair</button>
            <input value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder="Material code" style={{ flex: "1 1 140px", padding: 8 }} />
            <input value={materialLot} onChange={(e) => setMaterialLot(e.target.value)} placeholder="WMS lot" style={{ flex: "1 1 140px", padding: 8 }} />
            <input value={materialQuantity} onChange={(e) => setMaterialQuantity(e.target.value)} type="number" min="0.01" step="0.01" style={{ width: 80, padding: 8 }} />
            <button type="button" disabled={commandBusy || !materialCode || !materialLot} onClick={() => sendIntegrationCommand("MATERIAL_USAGE_RECORDED")} style={{ padding: "8px 12px" }}>Record material</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} placeholder="QMS evidence / repair note" style={{ flex: "1 1 260px", padding: 8 }} />
            <button type="button" disabled={commandBusy} onClick={() => sendIntegrationCommand("QMS_EVIDENCE_ATTACHED")} style={{ padding: "8px 12px" }}>Send QMS evidence</button>
            <button type="button" disabled={commandBusy} onClick={() => sendIntegrationCommand("RETEST_REQUESTED")} style={{ padding: "8px 12px" }}>Request MES retest</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Commands are append-only facts; MES decides route, retest, release, scrap and final disposition.</div>
        </div>
      )}

      {/* Repair Notes */}
      {upstreamEvents.length > 0 && (
        <div className="surface-panel" style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
            {t("mes.repair.repairNotes", locale)}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t("mes.repair.repairNotes", locale)}
            style={{ width: "100%", fontSize: 14, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "var(--input-bg)", color: "var(--text)", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>
      )}

      {/* Repair Action Buttons */}
      {upstreamEvents.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <button
            type="button"
            onClick={handleRepairComplete}
            disabled={submitting}
            style={{
              ...btnBase,
              background: "#22c55e",
              color: "#fff",
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 24 }}>✅</span>
            <span>{t("mes.repair.repairComplete", locale)}</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{t("mes.repair.reworkPass", locale)}</span>
          </button>
          <button
            type="button"
            onClick={handleRepairFailed}
            disabled={submitting}
            style={{
              ...btnBase,
              background: "#ef4444",
              color: "#fff",
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 24 }}>❌</span>
            <span>{t("mes.repair.repairFailed", locale)}</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{t("common.scrap", locale)}</span>
          </button>
        </div>
      )}

      {/* Last Result */}
      {lastResult && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: lastResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${lastResult.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            color: lastResult.ok ? "#4ade80" : "#fca5a5",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <strong>{lastResult.timestamp}</strong> — {lastResult.message}
        </div>
      )}

      {/* Empty state */}
      {!pcbSerial && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔧</div>
          <div style={{ fontSize: 16 }}>{t("mes.repair.scanHint", locale)}</div>
        </div>
      )}
    </div>
  );
}
