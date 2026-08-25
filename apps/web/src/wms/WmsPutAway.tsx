import { useEffect, useState, useRef, useCallback } from "react";
import { Box, ScanBarcode, CheckCircle, MapPin } from "lucide-react";
import { t, text } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { MaterialLot, StorageLocation, InventoryTransaction } from "../api";

export function WmsPutAway({ locale }: { locale: Locale }) {
  const [releasedLots, setReleasedLots] = useState<MaterialLot[]>([]);
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLotId, setBusyLotId] = useState<number | string | null>(null);
  const [feedback, setFeedback] = useState<{ lotId: number | string; ok: boolean; msg: string } | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [highlightedLot, setHighlightedLot] = useState<string | null>(null);
  const [locationMap, setLocationMap] = useState<Record<string, string>>({});
  const scanRef = useRef<HTMLInputElement>(null);

  const activeLocations = storageLocations.filter((l) => l.status === "active");

  useEffect(() => {
    Promise.all([
      wmsApi.getMaterialLots({ iqcStatus: "released", limit: 200 }),
      wmsApi.getStorageLocations({ status: "active", limit: 200 }),
      wmsApi.getTransactions({ action: "PUT_AWAY", limit: 50 }),
    ]).then(([lotsRes, locsRes, txRes]) => {
      const pending = lotsRes.items.filter(
        (l) => !l.locationCode || l.locationCode.includes("IQC") || l.locationCode.includes("RCV"),
      );
      setReleasedLots(pending);
      setStorageLocations(locsRes.items);
      setTransactions(txRes.items);
      setLocationMap({});
      setLoading(false);
    }).catch((error) => {
      setReleasedLots([]);
      setStorageLocations([]);
      setTransactions([]);
      setFeedback({ lotId: "load", ok: false, msg: error instanceof Error ? error.message : String(error) });
      setLoading(false);
    });
  }, []);

  const handleScan = useCallback(() => {
    const scan = scanInput.trim().toUpperCase();
    if (!scan) return;
    const match = releasedLots.find(
      (l) => (l.lotNo ?? "").toUpperCase() === scan,
    );
    if (match) {
      setHighlightedLot(match.lotNo ?? null);
      setTimeout(() => setHighlightedLot(null), 2000);
    } else {
      setFeedback({ lotId: "scan", ok: false, msg: `${scan}: ${t("wms.lotNotFound", locale) ?? "Lot not found"}` });
      setTimeout(() => setFeedback(null), 3000);
    }
    setScanInput("");
    scanRef.current?.focus();
  }, [scanInput, releasedLots, locale]);

  const handlePutAway = async (lot: MaterialLot) => {
    const toLocation = locationMap[lot.id!];
    if (!toLocation) { setFeedback({ lotId: lot.id!, ok: false, msg: t("wms.selectLocation", locale) ?? "Select location" }); return; }
    setBusyLotId(lot.id!);
    setFeedback(null);
    try {
      await wmsApi.putAway({ lotNo: lot.lotNo ?? "", toLocation, qty: lot.qty ?? 0, operator: "VN_WH_010" });
      setReleasedLots((prev) => prev.filter((l) => l.id !== lot.id));
      setFeedback({ lotId: lot.id!, ok: true, msg: `${lot.lotNo} → ${toLocation}` });
    } catch (e) {
      setFeedback({ lotId: lot.id!, ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyLotId(null);
    }
  };

  const handlePutAwayAll = async () => {
    for (const lot of releasedLots) {
      if (locationMap[lot.id!]) await handlePutAway(lot);
    }
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale) ?? "Loading..."}</div>
        </div>
      </div>
    );
  }

  const anyPending = releasedLots.length > 0;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.putAwayGuide", locale)}</h2>
            <p>
              {anyPending
                ? `${releasedLots.length} ${t("wms.putAwayConfirm", locale) ?? "lots pending put-away"}`
                : t("common.all", locale)}
            </p>
          </div>
          {anyPending && (
            <button
              type="button"
              className="action-button"
              style={{ background: "var(--ok)" }}
              onClick={handlePutAwayAll}
            >
              <CheckCircle size={14} />
              {t("wms.putAwayAll", locale) ?? "Put Away All"}
            </button>
          )}
        </div>

        <div className="scan-input" style={{ maxWidth: 480, marginBottom: 16 }} ref={scanRef}>
          <ScanBarcode size={24} />
          <input
            ref={scanRef}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleScan()}
            placeholder={t("scan.lotOrMaterial", locale) ?? "Scan lot or material code"}
            title={t("ui.scanInput", locale)}
          />
          <button type="button" className="action-button" style={{ background: "var(--ok)" }} onClick={handleScan}>
            <MapPin size={14} />
          </button>
        </div>

        {highlightedLot && (
          <div style={{ marginBottom: 8, padding: "6px 12px", borderRadius: 6, background: "var(--ok-bg)", color: "var(--ok)", fontSize: 13 }}>
            {highlightedLot}: {t("wms.found", locale) ?? "Found"}
          </div>
        )}

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.currentLocation", locale)}</th>
                <th>{t("wms.targetLocation", locale)}</th>
                <th>{t("common.action", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {releasedLots.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              ) : (
                releasedLots.map((lot) => {
                  const isHighlighted = highlightedLot === lot.lotNo;
                  const isBusy = busyLotId === lot.id;
                  return (
                    <tr key={lot.id} style={{ background: isHighlighted ? "var(--ok-bg)" : undefined }}>
                      <td><strong>{lot.materialCode}</strong></td>
                      <td><code>{lot.lotNo}</code></td>
                      <td>{(lot.qty ?? 0).toLocaleString()}</td>
                      <td><span className="badge badge-info">{lot.locationCode ?? "IQC"}</span></td>
                      <td>
                        <select
                          value={locationMap[lot.id!] ?? ""}
                          onChange={(e) => setLocationMap((prev) => ({ ...prev, [lot.id!]: e.target.value }))}
                          style={{
                            background: "var(--nav)", color: "var(--fg)",
                            border: "1px solid rgba(238,248,250,0.2)", borderRadius: 4,
                            padding: "2px 6px", fontSize: 12,
                          }}
                        >
                          {activeLocations.map((loc) => (
                            <option key={loc.id} value={loc.code}>{loc.code} · {text(loc, locale)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="action-button"
                          type="button"
                          style={{ background: "var(--ok)" }}
                          disabled={isBusy || !locationMap[lot.id!]}
                          onClick={() => handlePutAway(lot)}
                        >
                          <Box size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {feedback && (
          <div style={{
            marginTop: 8, padding: "6px 12px", borderRadius: 6,
            background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
            color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13,
          }}>
            {feedback.msg}
          </div>
        )}
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.materialMoves", locale)}</h2>
            <p>{t("section.timeline", locale)}</p>
          </div>
        </div>
        {transactions.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.noData", locale)}</div>
        ) : (
          <div className="timeline">
            {transactions.slice(0, 5).map((tx) => (
              <div className="timeline-item" key={tx.id}>
                <span style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>P</span>
                <div>
                  <strong>{tx.txNo}</strong>
                  <p>{tx.toLocation ?? tx.referenceNo ?? "—"} · {tx.qty.toLocaleString()}</p>
                </div>
                <span className="badge badge-ok">{t("status.stored", locale)}</span>
                <small>{new Date(tx.occurredAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
// @ts-nocheck
