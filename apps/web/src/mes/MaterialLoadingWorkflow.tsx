import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowLeft, ArrowRight, Barcode, CheckCircle, XCircle, AlertTriangle,
  Loader2, Package, Scan, Factory, RefreshCw,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { ProductionLine, LineDetail, Station, FeederBinding, FoolProofRule } from "../api/mes";

// ── Types ──────────────────────────────────────────────────────────

interface LoadItem {
  stationCode: string;
  stationName: string;
  machineCode: string;
  feederSlot: string;
  expectedMaterialCode: string;
  expectedMaterialName: string;
  expectedReelCode?: string;
  scannedReelCode?: string;
  status: "pending" | "verified" | "error";
  boundAt?: string;
  operator?: string;
  bindingId?: number;
}

// ── Helpers ───────────────────────────────────────────────────────

let seq = 0;
function txSeq(prefix: string) {
  seq += 1;
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}-${String(seq).padStart(4, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────

export function MaterialLoadingWorkflow({
  locale,
  lineCode,
  onBack,
}: {
  locale: Locale;
  lineCode: string;
  onBack: () => void;
}) {
  // Data state
  const [line, setLine] = useState<ProductionLine | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [existingBindings, setExistingBindings] = useState<FeederBinding[]>([]);
  const [foolProofRules, setFoolProofRules] = useState<FoolProofRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Workflow state
  const [workOrderCode, setWorkOrderCode] = useState("");
  const [loadItems, setLoadItems] = useState<LoadItem[]>([]);
  const [step, setStep] = useState<"init" | "loading" | "complete">("init");

  // Scan state
  const [scanInput, setScanInput] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  // PCB SN state
  const [pcbSerialInput, setPcbSerialInput] = useState("");
  const [pcbSerials, setPcbSerials] = useState<{ serialNo: string; registeredAt: string }[]>([]);
  const [pcbScanFeedback, setPcbScanFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const pcbScanRef = useRef<HTMLInputElement>(null);

  // Derive progress
  const total = loadItems.length;
  const loaded = loadItems.filter((i) => i.status === "verified").length;
  const errors = loadItems.filter((i) => i.status === "error").length;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

  // ── Load line data ───────────────────────────────────────
  useEffect(() => {
    loadLineData();
  }, [lineCode]);

  async function loadLineData() {
    setLoading(true);
    try {
      const [lineRes, stationRes, bindRes, rulesRes] = await Promise.all([
        mesApi.getLines({ limit: 100 }),
        mesApi.getStations({ lineCode, limit: 100 }),
        mesApi.getFeederBindings({ lineCode, limit: 500 }),
        mesApi.getFoolProofRules({ lineCode, status: "active", limit: 500 }),
      ]);
      const foundLine = lineRes.items.find((l) => l.lineCode === lineCode) ?? null;
      setLine(foundLine);
      setStations(stationRes.items);
      setExistingBindings(bindRes.items);
      setFoolProofRules(rulesRes.items);

      // Auto-set work order if line has one
      if (foundLine?.currentWorkOrderCode) {
        setWorkOrderCode(foundLine.currentWorkOrderCode);
      }
    } catch {
      setError("Failed to load line data");
    } finally {
      setLoading(false);
    }
  }

  // ── Assign work order to each machine before loading ──────────
  async function assignWorkOrderToMachines(woCode: string) {
    const machineCodes = [...new Set(foolProofRules.map((r) => r.stationCode))];
    await Promise.allSettled(
      machineCodes.map((mc) =>
        fetch("/api/smt/machine/assign-wo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineCode: mc, workOrderCode: woCode }),
        }).then((r) => r.json())
      )
    );
  }

  // ── Build loading plan from rules + stations ──────────────
  function buildLoadingPlan(woCode: string) {
    // Assign WO to all machines first (non-blocking)
    assignWorkOrderToMachines(woCode).catch(() => {});

    const items: LoadItem[] = [];

    // Map stations with fool-proof rules
    for (const rule of foolProofRules) {
      const station = stations.find((s) => s.code === rule.stationCode);
      items.push({
        stationCode: rule.stationCode,
        stationName: station
          ? (locale === "zh-CN" ? station.nameZh : locale === "en-US" ? station.nameEn : station.nameVi)
          : rule.stationCode,
        machineCode: rule.stationCode, // Use station code as machine identifier
        feederSlot: rule.feederSlot,
        expectedMaterialCode: rule.materialCode,
        expectedMaterialName: rule.materialName ?? rule.materialCode,
        expectedReelCode: rule.materialReelCode,
        status: "pending",
      });
    }

    // If no fool-proof rules, create placeholder items from stations
    if (items.length === 0) {
      for (const station of stations) {
        // Default: create up to 12 feeder slots per station as placeholders
        for (let i = 1; i <= 6; i++) {
          const slot = `F${String(i).padStart(2, "0")}`;
          items.push({
            stationCode: station.code,
            stationName: locale === "zh-CN" ? station.nameZh : locale === "en-US" ? station.nameEn : station.nameVi,
            machineCode: station.code,
            feederSlot: slot,
            expectedMaterialCode: "—",
            expectedMaterialName: "—",
            status: "pending",
          });
        }
      }
    }

    // Match existing bindings
    const woBinds = existingBindings.filter((b) => b.workOrderCode === woCode && !b.unboundAt);
    for (const item of items) {
      const matchBind = woBinds.find(
        (b) => b.machineCode === item.machineCode && b.feederNo === item.feederSlot,
      );
      if (matchBind) {
        item.status = "verified";
        item.scannedReelCode = matchBind.reelCode;
        item.boundAt = matchBind.boundAt;
        item.operator = matchBind.operator;
        item.bindingId = matchBind.id;
      }
    }

    setLoadItems(items);
    setStep(items.every((i) => i.status === "verified") ? "complete" : "loading");
    setFeedback(null);
    setScanInput("");
    setTimeout(() => scanRef.current?.focus(), 100);
  }

  // ── Handle scan ──────────────────────────────────────────
  const handleScan = useCallback(async () => {
    const raw = scanInput.trim().toUpperCase();
    if (!raw || !workOrderCode) return;
    setBusy(true);
    setFeedback(null);

    try {
      // Find a matching pending item by:
      // 1. Check if scan matches a reel code (from fool-proof rule)
      // 2. Check if scan matches material code
      // 3. Fall back to first pending item

      let targetIdx = -1;

      // Strategy 1: Scan is a reel code → match against expectedReelCode
      if (raw.startsWith("REEL-") || raw.startsWith("R-")) {
        targetIdx = loadItems.findIndex(
          (it) => it.status === "pending" && it.expectedReelCode?.toUpperCase() === raw,
        );
      }

      // Strategy 2: Scan is a material code → match against expectedMaterialCode
      if (targetIdx === -1) {
        targetIdx = loadItems.findIndex(
          (it) => it.status === "pending" && it.expectedMaterialCode.toUpperCase() === raw,
        );
      }

      // Strategy 3: No match, take first pending
      if (targetIdx === -1) {
        targetIdx = loadItems.findIndex((it) => it.status === "pending");
      }

      if (targetIdx === -1) {
        setFeedback({ ok: false, msg: t("mes.materialLoad.allComplete", locale) ?? "All items already loaded" });
        setBusy(false);
        return;
      }

      const item = loadItems[targetIdx];

      // Verify against fool-proof rules
      const matchingRule = foolProofRules.find(
        (r) =>
          r.stationCode === item.stationCode &&
          r.feederSlot === item.feederSlot,
      );

      let verificationPassed = true;
      if (matchingRule) {
        if (matchingRule.ruleType === "material" || matchingRule.ruleType === "both") {
          if (matchingRule.materialCode.toUpperCase() !== raw && !raw.includes(matchingRule.materialCode.toUpperCase())) {
            verificationPassed = false;
          }
        }
        if (verificationPassed && (matchingRule.ruleType === "reel" || matchingRule.ruleType === "both")) {
          if (matchingRule.materialReelCode && matchingRule.materialReelCode.toUpperCase() !== raw) {
            verificationPassed = false;
          }
        }
      }

      if (!verificationPassed) {
        setFeedback({
          ok: false,
          msg: `${t("mes.materialLoad.verifyFail", locale)} ${item.expectedMaterialCode} → ${raw}`,
        });
        // Mark as error
        setLoadItems((prev) => {
          const updated = [...prev];
          updated[targetIdx] = { ...updated[targetIdx], status: "error", scannedReelCode: raw };
          return updated;
        });
        setBusy(false);
        setScanInput("");
        return;
      }

      // Verification passed → create feeder binding + material verification
      const now = new Date().toISOString();
      const operator = "OP_" + lineCode;

      // Try API call to bind feeder
      let bindingId: number | undefined;
      try {
        const bindRes = await mesApi.bindFeeder({
          workOrderCode,
          lineCode,
          machineCode: item.machineCode,
          lotNo: raw,
          feederNo: item.feederSlot,
          reelCode: raw,
          operator,
        });
        bindingId = bindRes.item?.id;
      } catch {
        // Fall back to local state if API fails (demo mode)
      }

      // Update load item
      setLoadItems((prev) => {
        const updated = [...prev];
        updated[targetIdx] = {
          ...updated[targetIdx],
          status: "verified",
          scannedReelCode: raw,
          boundAt: now,
          operator,
          bindingId,
        };
        return updated;
      });

      setFeedback({
        ok: true,
        msg: `${t("mes.materialLoad.bindSuccess", locale)}: ${item.feederSlot} ← ${raw}`,
      });

      // Check if all done
      const updatedItems = loadItems.map((it, idx) =>
        idx === targetIdx
          ? { ...it, status: "verified" as const, scannedReelCode: raw, boundAt: now, operator, bindingId }
          : it,
      );
      if (updatedItems.every((it) => it.status === "verified")) {
        setTimeout(() => setStep("complete"), 500);
      }
    } catch (e: any) {
      setFeedback({ ok: false, msg: e.message ?? "Scan failed" });
    } finally {
      setBusy(false);
      setScanInput("");
      setTimeout(() => scanRef.current?.focus(), 50);
    }
  }, [scanInput, loadItems, workOrderCode, locale, lineCode, foolProofRules]);

  // ── Handle PCB SN scan ──────────────────────────────────
  const handlePcbScan = useCallback(async () => {
    const sn = pcbSerialInput.trim().toUpperCase();
    if (!sn || !workOrderCode) return;
    if (pcbSerials.some((p) => p.serialNo === sn)) {
      setPcbScanFeedback({ ok: false, msg: "PCB SN already registered" });
      return;
    }
    try {
      await mesApi.registerPcbSerial({ serialNo: sn, workOrderCode });
      setPcbSerials((prev) => [...prev, { serialNo: sn, registeredAt: new Date().toISOString() }]);
      setPcbScanFeedback({ ok: true, msg: `PCB registered: ${sn}` });
    } catch {
      // If API fails (demo mode), register locally
      setPcbSerials((prev) => [...prev, { serialNo: sn, registeredAt: new Date().toISOString() }]);
      setPcbScanFeedback({ ok: true, msg: `PCB registered (offline): ${sn}` });
    }
    setPcbSerialInput("");
    setTimeout(() => pcbScanRef.current?.focus(), 50);
  }, [pcbSerialInput, workOrderCode, pcbSerials]);

  // Keyboard handler
  function handleScanKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !busy) {
      handleScan();
    }
  }

  // ── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="placeholder-view" style={{ padding: 60 }}>
        <Loader2 size={40} className="spin" />
        <p>{t("common.loading", locale)}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="placeholder-view" style={{ padding: 60 }}>
        <AlertTriangle size={40} color="var(--danger)" />
        <p>{error}</p>
        <button type="button" className="action-button" onClick={onBack} style={{ marginTop: 12 }}>
          {t("mes.materialLoad.backToDashboard", locale)}
        </button>
      </div>
    );
  }

  const lineName = line
    ? (locale === "zh-CN" ? line.nameZh : locale === "en-US" ? line.nameEn : line.nameVi)
    : lineCode;

  // ── INIT step: show line info + set work order ───────────
  if (step === "init") {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button type="button" className="action-button" onClick={onBack}>
              <ArrowLeft size={16} /> {t("mes.materialLoad.backToDashboard", locale)}
            </button>
          </div>
          <div className="section-header">
            <h2><Factory size={20} style={{ verticalAlign: "middle", marginRight: 8 }} />{lineName}</h2>
            <p>{line?.lineCode} · {stations.length} {t("mes.foolproof.station", locale)}</p>
          </div>

          <div style={{ padding: "16px 0" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("mes.materialLoad.scanWorkOrder", locale)}
            </label>
            <div className="scan-input" style={{ maxWidth: 480 }}>
              <Barcode size={22} />
              <input
                value={workOrderCode}
                onChange={(e) => setWorkOrderCode(e.target.value.toUpperCase())}
                placeholder={t("mes.materialLoad.scanWorkOrder", locale)}
              />
              <button
                type="button"
                className="action-button"
                style={{ background: "var(--ok)" }}
                disabled={!workOrderCode.trim()}
                onClick={() => buildLoadingPlan(workOrderCode.trim())}
              >
                {t("mes.materialLoad.startLoading", locale)} <ArrowRight size={16} />
              </button>
            </div>
            {!workOrderCode.trim() && (
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                {t("mes.materialLoad.noWorkOrder", locale)}
              </p>
            )}

            {/* Quick WO selectors */}
            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["26061010008", "26061020003", "26061020007"].map((wo) => (
                <button
                  key={wo}
                  type="button"
                  className="action-button"
                  style={{ background: "var(--nav)", fontSize: 12, color: "#fff" }}
                  onClick={() => { setWorkOrderCode(wo); buildLoadingPlan(wo); }}
                >
                  {wo}
                </button>
              ))}
            </div>
          </div>

          {/* Pre-bound items summary */}
          {existingBindings.length > 0 && (
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--ok-bg)", fontSize: 13 }}>
              <CheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
              {existingBindings.filter((b) => !b.unboundAt).length} existing bindings found
            </div>
          )}

          {/* PCB SN registration */}
          {workOrderCode && (
            <div style={{ marginTop: 20, padding: "16px", borderRadius: 8, border: "1.5px dashed var(--border)", background: "var(--surface-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Barcode size={16} style={{ color: "var(--accent)" }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  PCB板序列号 / PCB Serial (optional)
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  — {t("mes.materialLoad.pcbSerialHint", locale) ?? "Scan board barcode to enable traceability"}
                </span>
              </div>
              <div className="scan-input" style={{ maxWidth: 480 }}>
                <Barcode size={18} />
                <input
                  ref={pcbScanRef}
                  value={pcbSerialInput}
                  onChange={(e) => setPcbSerialInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") handlePcbScan(); }}
                  placeholder="Scan PCB barcode..."
                  disabled={busy}
                />
                <button
                  type="button"
                  className="action-button"
                  style={{ background: "var(--accent)" }}
                  disabled={!pcbSerialInput.trim() || busy}
                  onClick={handlePcbScan}
                >
                  {t("common.add", locale) ?? "Add"}
                </button>
              </div>
              {pcbScanFeedback && (
                <div style={{
                  marginTop: 6, padding: "6px 12px", borderRadius: 6,
                  background: pcbScanFeedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
                  color: pcbScanFeedback.ok ? "var(--ok)" : "var(--danger)",
                  fontSize: 12,
                }}>
                  {pcbScanFeedback.msg}
                </div>
              )}
              {pcbSerials.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {pcbSerials.map((p) => (
                    <span key={p.serialNo} className="badge badge-info" style={{ fontSize: 12 }}>
                      <Barcode size={10} style={{ marginRight: 4 }} />
                      {p.serialNo}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    );
  }

  // ── COMPLETE step ────────────────────────────────────────
  if (step === "complete") {
    return (
      <div className="screen-stack">
        <section className="surface-panel" style={{ textAlign: "center", padding: "48px 24px" }}>
          <CheckCircle size={64} color="var(--ok)" style={{ marginBottom: 16 }} />
          <h2>{t("mes.materialLoad.allComplete", locale)}</h2>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            {lineName} · {workOrderCode} · {loaded}/{total}
          </p>
          {pcbSerials.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--accent)" }}>
              <Barcode size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
              {pcbSerials.length} PCB board(s) registered: {pcbSerials.map((p) => p.serialNo).join(", ")}
            </div>
          )}
          <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center" }}>
            <button type="button" className="action-button" onClick={() => buildLoadingPlan(workOrderCode)}>
              <RefreshCw size={14} /> {t("common.refresh", locale)}
            </button>
            <button type="button" className="action-button" onClick={onBack}>
              {t("mes.materialLoad.backToDashboard", locale)}
            </button>
          </div>
        </section>

        {/* Summary table */}
        <section className="surface-panel">
          <div className="section-header">
            <h3>{t("common.detail", locale)}</h3>
          </div>
          <div className="table-shell" style={{ maxHeight: 400, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("mes.materialLoad.machine", locale)}</th>
                  <th>{t("mes.materialLoad.feederSlot", locale)}</th>
                  <th>{t("mes.materialLoad.materialName", locale)}</th>
                  <th>{t("mes.materialLoad.scannedReel", locale)}</th>
                  <th>{t("mes.materialLoad.loadedAt", locale)}</th>
                  <th>{t("mes.materialLoad.operator", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {loadItems.map((item, idx) => (
                  <tr key={idx} style={{ opacity: item.status === "verified" ? 1 : 0.5 }}>
                    <td>{item.machineCode}</td>
                    <td><span className="badge badge-info">{item.feederSlot}</span></td>
                    <td>
                      <strong>{item.expectedMaterialCode}</strong>
                      <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                        {item.expectedMaterialName}
                      </span>
                    </td>
                    <td>
                      {item.scannedReelCode ? (
                        <span style={{ color: "var(--ok)", fontSize: 12 }}>{item.scannedReelCode}</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{item.boundAt ? new Date(item.boundAt).toLocaleString() : "—"}</td>
                    <td style={{ fontSize: 12 }}>{item.operator ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // ── LOADING step: main scan workflow ─────────────────────
  return (
    <div className="screen-stack">
      {/* Header */}
      <section className="surface-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <button type="button" className="action-button" onClick={() => setStep("init")}>
            <ArrowLeft size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0 }}>{lineName}</h2>
              <span className="badge badge-info" style={{ fontSize: 11 }}>{lineCode}</span>
              <span className="badge badge-warning" style={{ fontSize: 11 }}>{workOrderCode}</span>
              {pcbSerials.length > 0 && (
                <span className="badge badge-accent" style={{ fontSize: 11, background: "var(--accent)", color: "#fff" }}>
                  <Barcode size={10} style={{ marginRight: 3 }} />
                  {pcbSerials.length} PCB
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
            <span>
              <CheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 4 }} color="var(--ok)" />
              {loaded}/{total} {t("mes.materialLoad.loadedCount", locale)}
            </span>
            <span style={{ color: "var(--muted)" }}>{pct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden", display: "flex" }}>
            <div style={{
              height: "100%", background: "var(--ok)", borderRadius: 4,
              transition: "width 0.3s", width: `${(loaded / total) * 100}%`,
            }} />
            {errors > 0 && (
              <div style={{
                height: "100%", background: "var(--danger)", borderRadius: 4,
                transition: "width 0.3s", width: `${(errors / total) * 100}%`,
              }} />
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", margin: 0 }}>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("common.total", locale)}</span>
            <strong>{total}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("mes.materialLoad.status.complete", locale)}</span>
            <strong style={{ color: "var(--ok)" }}>{loaded}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("common.pending", locale)}</span>
            <strong>{total - loaded - errors}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("mes.foolproof.title", locale)}</span>
            <strong style={{ color: errors > 0 ? "var(--danger)" : "var(--muted)" }}>{errors}</strong>
          </article>
        </div>
      </section>

      {/* Scan input */}
      <section className="surface-panel">
        <div className="scan-input" style={{ maxWidth: 600 }}>
          <Scan size={22} />
          <input
            ref={scanRef}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value.toUpperCase())}
            onKeyDown={handleScanKeyDown}
            placeholder={t("mes.materialLoad.scanReel", locale) ?? "Scan reel barcode or enter material code"}
            disabled={busy}
            autoFocus
          />
          <button
            type="button"
            className="action-button"
            style={{ background: "var(--ok)" }}
            disabled={!scanInput.trim() || busy}
            onClick={handleScan}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle size={16} />}
          </button>
        </div>

        {feedback && (
          <div style={{
            marginTop: 8, padding: "8px 14px", borderRadius: 8,
            background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
            color: feedback.ok ? "var(--ok)" : "var(--danger)",
            fontSize: 13, display: "flex", alignItems: "center", gap: 8,
          }}>
            {feedback.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {feedback.msg}
          </div>
        )}

        {/* Auto-confirm complete */}
        {loaded === total && total > 0 && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <button
              type="button"
              className="action-button"
              style={{ background: "var(--ok)", color: "#fff", fontSize: 16, padding: "12px 32px" }}
              onClick={() => setStep("complete")}
            >
              <CheckCircle size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />
              {t("mes.materialLoad.confirmComplete", locale)}
            </button>
          </div>
        )}
      </section>

      {/* Loading items table */}
      <section className="surface-panel">
        <div className="section-header">
          <h3>
            {t("mes.materialLoad.title", locale)}
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
              {foolProofRules.length > 0 ? `· ${foolProofRules.length} rules active` : "· No rules (free mode)"}
            </span>
          </h3>
          <div style={{ display: "flex", gap: 4 }}>
            {(["pending", "verified", "error"] as const).map((s) => {
              const count = loadItems.filter((i) => i.status === s).length;
              if (count === 0) return null;
              return (
                <span key={s} className={`badge ${s === "verified" ? "badge-ok" : s === "error" ? "badge-danger" : "badge-info"}`}>
                  {s === "verified" ? "✓" : s === "error" ? "✗" : "○"} {count}
                </span>
              );
            })}
          </div>
        </div>

        <div className="table-shell" style={{ maxHeight: 500, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{t("common.status", locale)}</th>
                <th>{t("mes.materialLoad.machine", locale)}</th>
                <th>{t("mes.materialLoad.feederSlot", locale)}</th>
                <th>{t("common.material", locale)}</th>
                <th>{t("mes.materialLoad.expectedReel", locale)}</th>
                <th>{t("mes.materialLoad.scannedReel", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {loadItems.map((item, idx) => (
                <tr
                  key={idx}
                  style={{
                    background: item.status === "verified"
                      ? "rgba(11,122,83,0.04)"
                      : item.status === "error"
                        ? "rgba(177,47,40,0.04)"
                        : undefined,
                  }}
                >
                  <td>
                    {item.status === "verified" ? (
                      <CheckCircle size={16} color="var(--ok)" />
                    ) : item.status === "error" ? (
                      <XCircle size={16} color="var(--danger)" />
                    ) : (
                      <Package size={16} color="var(--muted)" />
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>{item.stationName}</td>
                  <td><span className="badge badge-info">{item.feederSlot}</span></td>
                  <td>
                    <strong style={{ fontSize: 13 }}>{item.expectedMaterialCode}</strong>
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                      {item.expectedMaterialName !== item.expectedMaterialCode ? item.expectedMaterialName : ""}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>
                    {item.expectedReelCode ?? "—"}
                  </td>
                  <td>
                    {item.scannedReelCode ? (
                      <span style={{ color: "var(--ok)", fontSize: 12, fontWeight: 600 }}>
                        {item.scannedReelCode}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
