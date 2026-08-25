import { useState, useEffect, useMemo } from "react";
import { ArrowRight, AlertTriangle, CheckCircle, Clock, Package, Boxes, RefreshCw, Info } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi, type MaterialLot } from "../api/wms";
import { materialLots as _demoLots } from "../data";

interface FifoLot extends MaterialLot {
  receivedDate?: string;
  ageDays?: number;
}

interface FifoAllocation {
  lotNo: string;
  materialCode: string;
  qty: number;
  fromLocation: string;
  receivedDate: string;
  ageDays: number;
  cumulativeQty: number;
  isFifoViolation: boolean;
}

interface SimulationResult {
  materialCode: string;
  requiredQty: number;
  allocations: FifoAllocation[];
  totalAvailable: number;
  fulfilled: number;
  shortfall: number;
  hasViolation: boolean;
  violations: string[];
}

const STAGES = [
  { key: "RECEIVE",       label: "wms.fifo.stage.receive",       color: "#3b82f6" },
  { key: "LABEL",         label: "wms.fifo.stage.label",         color: "#8b5cf6" },
  { key: "IQC",           label: "wms.fifo.stage.iqc",           color: "#f59e0b" },
  { key: "RELEASED",      label: "wms.fifo.stage.released",      color: "#06b6d4" },
  { key: "PUT_AWAY",      label: "wms.fifo.stage.putAway",       color: "#10b981" },
  { key: "PICK",          label: "wms.fifo.stage.pick",          color: "#6366f1" },
  { key: "ISSUE_TO_LINE", label: "wms.fifo.stage.issue",        color: "#ec4899" },
];

function parseLotDate(lotNo: string): Date {
  const m = lotNo.match(/(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const y = 2000 + parseInt(m[1]);
    const mo = parseInt(m[2]);
    const d = parseInt(m[3]);
    return new Date(y, mo - 1, d);
  }
  return new Date();
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ageDays(receivedDate: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - receivedDate.getTime()) / (1000 * 60 * 60 * 24));
}

const DEMO_MATERIALS = [
  "PCB-AURORA-CTRL",
  "R-0603-10K-1",
  "IC-MCU-RJ32",
  "CAP-0805-100N",
  "CONN-USB-C-30P",
];

export function WmsFifoSimulation({ locale }: { locale: Locale }) {
  const [allLots, setAllLots] = useState<FifoLot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<string>("");
  const [customMaterial, setCustomMaterial] = useState<string>("");
  const [requiredQty, setRequiredQty] = useState<number>(10000);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  useEffect(() => {
    wmsApi.getMaterialLots({ limit: 200 }).then((res) => {
      const lots = (res.items as unknown as MaterialLot[]).map((l) => {
        const d = parseLotDate(l.lotNo);
        return { ...l, receivedDate: formatDate(d), ageDays: ageDays(d) } as FifoLot;
      });
      setAllLots(lots);
    }).catch(() => {
      const lots = _demoLots.map((l) => {
        const d = parseLotDate(l.lotNo);
        return { ...l, receivedDate: formatDate(d), ageDays: ageDays(d) } as FifoLot;
      });
      setAllLots(lots);
    });
  }, []);

  const materialOptions = useMemo(() => {
    const codes = new Set(allLots.map((l) => l.materialCode));
    const demo = DEMO_MATERIALS.filter((m) => codes.has(m));
    const others = [...codes].filter((m) => !DEMO_MATERIALS.includes(m)).sort();
    return [...demo, ...others];
  }, [allLots]);

  const filteredLots = useMemo(() => {
    const code = selectedMaterial || customMaterial.trim().toUpperCase();
    if (!code) return [];
    return allLots
      .filter((l) => l.materialCode === code && l.iqcStatus === "released")
      .sort((a, b) => {
        const dateA = parseLotDate(a.lotNo);
        const dateB = parseLotDate(b.lotNo);
        return dateA.getTime() - dateB.getTime();
      });
  }, [allLots, selectedMaterial, customMaterial]);

  const totalAvailable = useMemo(() => {
    return filteredLots.reduce<number>((sum, l) => sum + Math.max(0, (l.qty ?? 0) - (l.reservedQty ?? 0)), 0);
  }, [filteredLots]);

  const simulateFifo = () => {
    if (!filteredLots.length || requiredQty <= 0) return;
    setSimRunning(true);

    const alloc: FifoAllocation[] = [];
    let remaining = requiredQty;
    let cumulative = 0;
    const violations: string[] = [];

    for (const lot of filteredLots) {
      const available = Math.max(0, (lot.qty ?? 0) - (lot.reservedQty ?? 0));
      if (available <= 0) continue;

      const pickQty = Math.min(remaining, available);
      cumulative += pickQty;

      const isViolation = remaining < requiredQty && alloc.length === 0 && pickQty < available;
      if (isViolation) {
        violations.push(`${lot.lotNo}: only picked ${pickQty} of ${available} (FIFO not fully respected)`);
      }

      alloc.push({
        lotNo: lot.lotNo,
        materialCode: lot.materialCode,
        qty: pickQty,
        fromLocation: lot.locationCode ?? "—",
        receivedDate: lot.receivedDate ?? "—",
        ageDays: lot.ageDays ?? 0,
        cumulativeQty: cumulative,
        isFifoViolation: false,
      });

      remaining -= pickQty;
      if (remaining <= 0) break;
    }

    if (remaining > 0 && violations.length === 0) {
      violations.push(`Shortfall: ${remaining.toLocaleString()} units unfulfilled — no released lots available`);
    }

    setTimeout(() => {
      setResult({
        materialCode: selectedMaterial || customMaterial.trim().toUpperCase(),
        requiredQty,
        allocations: alloc,
        totalAvailable,
        fulfilled: Math.min(requiredQty, totalAvailable),
        shortfall: Math.max(0, requiredQty - totalAvailable),
        hasViolation: violations.length > 0,
        violations,
      });
      setSimRunning(false);
    }, 600);
  };

  const resetSimulation = () => {
    setResult(null);
    setRequiredQty(10000);
  };

  const kpiCards = result
    ? [
        { label: t("wms.fifo.required", locale), value: result.requiredQty.toLocaleString(), color: "#3b82f6" },
        { label: t("wms.fifo.fulfilled", locale), value: result.fulfilled.toLocaleString(), color: result.shortfall > 0 ? "#f59e0b" : "#10b981" },
        { label: t("wms.fifo.shortfall", locale), value: result.shortfall.toLocaleString(), color: result.shortfall > 0 ? "#ef4444" : "#e0e0e0" },
        { label: t("wms.fifo.lotsUsed", locale), value: result.allocations.length, color: "#6366f1" },
      ]
    : [];

  return (
    <div className="screen-stack">
      {/* Header */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.fifo.title", locale)}</h2>
            <p>{t("wms.fifo.subtitle", locale)}</p>
          </div>
        </div>

        {/* Stage pipeline */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
          {STAGES.map((s, i) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: s.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                </div>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{t(s.label, locale)}</span>
              </div>
              {i < STAGES.length - 1 && <ArrowRight size={14} style={{ color: "var(--border)", marginBottom: 14 }} />}
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.fifo.material", locale)}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={selectedMaterial}
                onChange={(e) => { setSelectedMaterial(e.target.value); setCustomMaterial(""); }}
                style={{ padding: "6px 10px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", minWidth: 200, fontSize: 13 }}
              >
                <option value="">— {t("common.select", locale)} —</option>
                {materialOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input
                value={customMaterial}
                onChange={(e) => { setCustomMaterial(e.target.value); setSelectedMaterial(""); }}
                placeholder={t("wms.fifo.orEnter", locale)}
                style={{ padding: "6px 10px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", minWidth: 160, fontSize: 13 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.fifo.requiredQty", locale)}</label>
            <input
              type="number"
              value={requiredQty}
              onChange={(e) => setRequiredQty(Math.max(0, parseInt(e.target.value) || 0))}
              min={0}
              style={{ padding: "6px 10px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", width: 140, fontSize: 13 }}
            />
          </div>

          <button
            className="action-button"
            onClick={simulateFifo}
            disabled={simRunning || filteredLots.length === 0}
            style={{ background: "var(--primary)", alignSelf: "flex-end" }}
          >
            {simRunning ? <RefreshCw size={14} className="spin" /> : <Boxes size={14} />}
            {t("wms.fifo.simulate", locale)}
          </button>

          {result && (
            <button className="action-button" onClick={resetSimulation} style={{ background: "var(--muted)", alignSelf: "flex-end" }}>
              <RefreshCw size={14} />
              {t("common.reset", locale)}
            </button>
          )}
        </div>
      </section>

      {/* KPI strip */}
      {result && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {kpiCards.map((k) => (
            <div key={k.label} style={{ flex: 1, minWidth: 120, background: "var(--surface)", borderRadius: 8, padding: "12px 16px", border: `2px solid ${k.color}` }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: k.color, marginTop: 4 }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Inventory FIFO table */}
      {filteredLots.length > 0 && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>
                <Package size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                {t("wms.fifo.inventory", locale)}
                <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)", marginLeft: 8 }}>
                  ({filteredLots.length} {t("wms.fifo.releasedLots", locale)})
                </span>
              </h3>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("wms.fifo.totalAvailable", locale)}: <strong style={{ color: "var(--ok)" }}>{totalAvailable.toLocaleString()}</strong>
            </div>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("common.lot", locale)}</th>
                  <th>{t("wms.fifo.receivedDate", locale)}</th>
                  <th>{t("wms.fifo.age", locale)}</th>
                  <th>{t("common.location", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("wms.fifo.reserved", locale)}</th>
                  <th>{t("wms.fifo.available", locale)}</th>
                  <th>{t("wms.fifo.fifoOrder", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot, idx) => {
                  const available = Math.max(0, (lot.qty ?? 0) - (lot.reservedQty ?? 0));
                  const age = lot.ageDays ?? 0;
                  const ageColor = age > 60 ? "var(--danger)" : age > 30 ? "var(--warning)" : "var(--ok)";
                  return (
                    <tr key={lot.id} style={{ opacity: available === 0 ? 0.4 : 1 }}>
                      <td><span className="badge badge-info">{idx + 1}</span></td>
                      <td><strong>{lot.lotNo}</strong></td>
                      <td>{lot.receivedDate ?? "—"}</td>
                      <td>
                        <span style={{ color: ageColor, fontWeight: 600 }}>
                          {age}d
                        </span>
                      </td>
                      <td>{lot.locationCode ?? "—"}</td>
                      <td>{(lot.qty ?? 0).toLocaleString()}</td>
                      <td>{(lot.reservedQty ?? 0).toLocaleString()}</td>
                      <td><strong style={{ color: available > 0 ? "var(--ok)" : "var(--danger)" }}>{available.toLocaleString()}</strong></td>
                      <td>
                        <span style={{ color: "var(--primary)", fontWeight: 700, fontSize: 13 }}>
                          {t("wms.fifo.pickFirst", locale)} #{idx + 1}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Simulation result */}
      {result && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>
                <Clock size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                {t("wms.fifo.simulationResult", locale)}
              </h3>
              <p>
                {t("wms.fifo.fulfillNote", locale)}: <strong>{result.materialCode}</strong> × <strong>{result.requiredQty.toLocaleString()}</strong>
              </p>
            </div>
          </div>

          {result.allocations.length > 0 && (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("wms.fifo.pickSeq", locale)}</th>
                    <th>{t("common.lot", locale)}</th>
                    <th>{t("wms.fifo.receivedDate", locale)}</th>
                    <th>{t("wms.fifo.age", locale)}</th>
                    <th>{t("common.location", locale)}</th>
                    <th>{t("wms.fifo.pickQty", locale)}</th>
                    <th>{t("wms.fifo.cumulative", locale)}</th>
                    <th>{t("wms.fifo.allocation", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.allocations.map((a, idx) => (
                    <tr key={a.lotNo}>
                      <td><span className="badge badge-info">{idx + 1}</span></td>
                      <td><strong>{a.lotNo}</strong></td>
                      <td>{a.receivedDate}</td>
                      <td><span style={{ color: a.ageDays > 60 ? "var(--danger)" : a.ageDays > 30 ? "var(--warning)" : "var(--ok)", fontWeight: 600 }}>{a.ageDays}d</span></td>
                      <td>{a.fromLocation}</td>
                      <td><strong style={{ color: "var(--ok)" }}>{a.qty.toLocaleString()}</strong></td>
                      <td>{a.cumulativeQty.toLocaleString()}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 8 }}>
                            <div style={{ width: `${Math.min(100, (a.cumulativeQty / result.fulfilled) * 100)}%`, background: "var(--ok)", height: 8, borderRadius: 4, transition: "width 0.3s" }} />
                          </div>
                          <CheckCircle size={14} style={{ color: "var(--ok)" }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Shortfall */}
          {result.shortfall > 0 && (
            <div style={{ margin: "12px 0", padding: "12px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <AlertTriangle size={16} style={{ color: "var(--danger)", marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>{t("wms.fifo.shortfall", locale)}</div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  {result.shortfall.toLocaleString()} {t("wms.fifo.unfulfilled", locale)} — {t("wms.fifo.noReleasedLots", locale)}
                </div>
              </div>
            </div>
          )}

          {/* FIFO violations */}
          {result.hasViolation && (
            <div style={{ margin: "12px 0", padding: "12px 16px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid var(--warning)", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Info size={16} style={{ color: "var(--warning)", marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, color: "var(--warning)", marginBottom: 6 }}>{t("wms.fifo.fifoAlert", locale)}</div>
                {result.violations.map((v, i) => (
                  <div key={i} style={{ color: "var(--muted)", fontSize: 13, marginBottom: 2 }}>• {v}</div>
                ))}
              </div>
            </div>
          )}

          {/* Summary text */}
          <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8, background: "var(--nav)", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            {result.allocations.length > 0 && (
              <div>
                <strong style={{ color: "var(--fg)" }}>{t("wms.fifo.fifoSummary", locale)}</strong>
                {" — "}{result.materialCode} {t("wms.fifo.fulfillWith", locale)} {result.allocations.length} {t("wms.fifo.lots", locale)} (
                {result.allocations.map((a) => a.lotNo).join(", ")}
                ). {t("wms.fifo.earliest", locale)}: {result.allocations[0].lotNo} ({result.allocations[0].receivedDate}, {result.allocations[0].ageDays}{t("wms.fifo.daysOld", locale)}).
                {result.shortfall > 0 && ` ${t("wms.fifo.partialShortfall", locale)}`}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!result && !loading && filteredLots.length === 0 && (
        <section className="surface-panel">
          <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--muted)" }}>
            <Boxes size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <p>{t("wms.fifo.selectMaterial", locale)}</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>{t("wms.fifo.selectOrEnter", locale)}</p>
          </div>
        </section>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
// @ts-nocheck
