import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, AlertTriangle, CheckCircle, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { MaterialLot } from "../api";

type CountSession = {
  id: string;
  locationCode: string;
  startedAt: string;
  items: CountItem[];
  status: "open" | "completed";
};

type CountItem = {
  lotNo: string;
  materialCode: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  counted: boolean;
};

const VARIANCE_THRESHOLD_PCT = 10;

export function WmsCycleCount({ locale }: { locale: Locale }) {
  const [allLots, setAllLots] = useState<MaterialLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationFilter, setLocationFilter] = useState("");
  const [session, setSession] = useState<CountSession | null>(null);
  const [activeItemIdx, setActiveItemIdx] = useState(0);
  const [countInput, setCountInput] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    wmsApi.getMaterialLots({ limit: 500 }).then((res) => {
      setAllLots(res.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Group lots by location for location-based cycle count
  const lotsByLocation = useMemo(() => {
    const map = new Map<string, MaterialLot[]>();
    for (const lot of allLots) {
      const loc = lot.locationCode ?? "(unassigned)";
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc)!.push(lot);
    }
    return map;
  }, [allLots]);

  const filteredLocations = useMemo(() => {
    if (!locationFilter) return Array.from(lotsByLocation.keys());
    return Array.from(lotsByLocation.keys()).filter((loc) =>
      loc.toUpperCase().includes(locationFilter.toUpperCase()),
    );
  }, [lotsByLocation, locationFilter]);

  const startCount = useCallback(
    (locationCode: string) => {
      const lots = lotsByLocation.get(locationCode) ?? [];
      const items: CountItem[] = lots.map((lot) => ({
        lotNo: lot.lotNo,
        materialCode: lot.materialCode,
        systemQty: lot.qty ?? 0,
        countedQty: null,
        variance: null,
        counted: false,
      }));
      setSession({
        id: `CC-${Date.now()}`,
        locationCode,
        startedAt: new Date().toISOString(),
        items,
        status: "open",
      });
      setActiveItemIdx(0);
      setCountInput("");
      setFeedback(null);
    },
    [lotsByLocation],
  );

  const confirmCount = useCallback(() => {
    if (!session) return;
    const qty = Number(countInput);
    if (isNaN(qty) || qty < 0) {
      setFeedback({ ok: false, msg: String(t("wms.validQtyRequired", locale)) });
      return;
    }
    const item = session.items[activeItemIdx];
    const variance = qty - item.systemQty;
    const updatedItems = session.items.map((it, i) =>
      i === activeItemIdx ? { ...it, countedQty: qty, variance, counted: true } : it,
    );
    setSession({ ...session, items: updatedItems });

    // Auto-advance to next uncounted item
    const nextIdx = updatedItems.findIndex((it, i) => i > activeItemIdx && !it.counted);
    if (nextIdx !== -1) {
      setActiveItemIdx(nextIdx);
      setCountInput("");
    } else {
      const allDone = updatedItems.every((it) => it.counted);
      if (allDone) {
        setFeedback({ ok: true, msg: t("wms.allCounted", locale) ?? "All items counted" });
      } else {
        setFeedback({ ok: true, msg: t("wms.locationCounted", locale) ?? "Location counted" });
      }
    }
  }, [session, countInput, activeItemIdx, locale]);

  const skipItem = useCallback(() => {
    if (!session) return;
    const nextIdx = session.items.findIndex((_, i) => i > activeItemIdx);
    if (nextIdx !== -1) {
      setActiveItemIdx(nextIdx);
      setCountInput("");
    }
  }, [session, activeItemIdx]);

  const submitCount = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      for (const item of session.items) {
        if (!item.counted || item.variance === 0) continue;
        // Record adjustment for variance
        try {
          await wmsApi.postTransaction("ADJUST", {
            lotNo: item.lotNo,
            qty: Math.abs(item.variance ?? 0),
            operator: "VN_WH_010",
          });
        } catch {
          // Continue with next item
        }
      }
      setFeedback({ ok: true, msg: t("wms.countSubmitted", locale) ?? "Cycle count submitted" });
      setTimeout(() => setSession(null), 1500);
    } finally {
      setSubmitting(false);
    }
  };

  const currentItem = session?.items[activeItemIdx];
  const progress = session ? `${session.items.filter((it) => it.counted).length}/${session.items.length}` : "0/0";
  const hasVariance = session?.items.some((it) => it.variance !== null && it.variance !== 0) ?? false;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.cycleCount", locale)}</h2>
            <p>{t("wms.cycleCountSubtitle", locale)}</p>
          </div>
        </div>
      </section>

      {/* Session active — count entry UI */}
      {session && session.status === "open" && (
        <>
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h2>{session.locationCode}</h2>
                <p>{t("wms.countProgress", locale)}: {progress}</p>
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  className="action-button"
                  style={{ background: "var(--muted)" }}
                  onClick={() => setSession(null)}
                >
                  {t("common.cancel", locale)}
                </button>
                <button
                  type="button"
                  className="action-button"
                  style={{ background: "var(--ok)" }}
                  disabled={submitting}
                  onClick={submitCount}
                >
                  <CheckCircle size={14} />
                  {t("wms.submitCount", locale)}
                </button>
              </div>
            </div>

            {hasVariance && (
              <div style={{
                marginBottom: 12,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid var(--warn)",
                color: "var(--warn)",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <AlertTriangle size={14} />
                {t("wms.varianceDetected", locale)}
              </div>
            )}

            {currentItem && (
              <div style={{ maxWidth: 480 }}>
                <div style={{
                  padding: "16px 20px",
                  borderRadius: 8,
                  background: "var(--nav)",
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    {t("wms.itemN", locale).replace("{n}", String(activeItemIdx + 1))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong style={{ fontSize: 18 }}>{currentItem.materialCode}</strong>
                      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{currentItem.lotNo}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.systemQty", locale)}</div>
                      <strong style={{ fontSize: 20 }}>{currentItem.systemQty.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("wms.countedQty", locale)}
                  </span>
                  <input
                    type="number"
                    className="input"
                    value={countInput}
                    min={0}
                    onChange={(e) => setCountInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmCount(); }}
                    placeholder="0"
                    style={{ fontSize: 24, textAlign: "center", padding: "12px" }}
                    autoFocus
                  />
                </label>

                {countInput && !isNaN(Number(countInput)) && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 13,
                    color: Number(countInput) === currentItem.systemQty ? "var(--ok)" : "var(--warn)",
                    textAlign: "center",
                  }}>
                    {Number(countInput) === currentItem.systemQty
                      ? `✓ ${t("wms.match", locale)}`
                      : (() => {
                          const diff = Number(countInput) - currentItem.systemQty;
                          const sign = diff > 0 ? "+" : "";
                          const pct = Math.abs(Math.round(diff / Math.max(currentItem.systemQty, 1) * 100));
                          return `${sign}${diff} ${t("wms.variance", locale)} (${pct}%)`;
                        })()}
                  </div>
                )}

                {feedback && (
                  <div style={{
                    marginTop: 12,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: feedback.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                    border: `1px solid ${feedback.ok ? "var(--ok)" : "var(--danger)"}`,
                    color: feedback.ok ? "var(--ok)" : "var(--danger)",
                    fontSize: 13,
                  }}>
                    {feedback.msg}
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                  <button
                    type="button"
                    className="action-button"
                    style={{ background: "var(--muted)", flex: 1 }}
                    onClick={skipItem}
                  >
                    <RotateCcw size={14} />
                    {t("wms.skipItem", locale)}
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    style={{ background: "var(--ok)", flex: 2 }}
                    onClick={confirmCount}
                  >
                    <ClipboardCheck size={14} />
                    {t("wms.confirmCount", locale)}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Variance summary */}
          <section className="surface-panel">
            <div className="section-header"><h3>{t("wms.countSummary", locale)}</h3></div>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.lot", locale)}</th>
                    <th>{t("common.material", locale)}</th>
                    <th>{t("wms.system", locale)}</th>
                    <th>{t("wms.counted", locale)}</th>
                    <th>{t("wms.variance", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {session.items.map((item, i) => (
                    <tr
                      key={item.lotNo}
                      onClick={() => !item.counted && setActiveItemIdx(i)}
                      style={{
                        cursor: item.counted ? "default" : "pointer",
                        background: item.variance !== null && item.variance !== 0 ? "rgba(245,158,11,0.05)" : undefined,
                      }}
                    >
                      <td><code>{item.lotNo}</code></td>
                      <td><strong>{item.materialCode}</strong></td>
                      <td>{item.systemQty.toLocaleString()}</td>
                      <td style={{ color: item.counted ? "var(--ok)" : "var(--muted)" }}>
                        {item.counted ? String(item.countedQty) : "—"}
                      </td>
                      <td style={{
                        color: item.variance === null ? "var(--muted)" : item.variance === 0 ? "var(--ok)" : "var(--warn)",
                        fontWeight: item.variance !== 0 ? 600 : 400,
                      }}>
                        {item.variance === null ? "—" : `${item.variance > 0 ? "+" : ""}${item.variance}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Location picker */}
      {!session && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>{t("wms.selectLocation", locale)}</h3>
              <p>{t("wms.selectLocationSubtitle", locale)}</p>
            </div>
          </div>
          <div className="scan-input" style={{ maxWidth: 400, marginBottom: 16 }}>
            <ClipboardCheck size={20} />
            <input
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder={t("wms.filterLocation", locale) ?? "Filter location"}
            />
          </div>
          {loading ? (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>
              {t("common.loading", locale) ?? "Loading..."}
            </div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("wms.location", locale)}</th>
                    <th>{t("wms.lotCount", locale)}</th>
                    <th>{t("wms.totalQty", locale)}</th>
                    <th>{t("table.action", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLocations.map((loc) => {
                    const lots = lotsByLocation.get(loc) ?? [];
                    const totalQty = lots.reduce((s, l) => s + (l.qty ?? 0), 0);
                    return (
                      <tr key={loc}>
                        <td><strong>{loc}</strong></td>
                        <td>{lots.length}</td>
                        <td>{totalQty.toLocaleString()}</td>
                        <td>
                          <button
                            type="button"
                            className="action-button"
                            style={{ background: "var(--info)", fontSize: 12, padding: "4px 12px" }}
                            onClick={() => startCount(loc)}
                          >
                            <ClipboardCheck size={12} />
                            {t("wms.startCount", locale)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
// @ts-nocheck
