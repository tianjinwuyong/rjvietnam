import { useEffect, useState } from "react";
import { Search, X, History, CheckCircle2 } from "lucide-react";
import { t, text } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { MaterialLot, StorageLocation, InventoryTransaction } from "../api";

export function WmsInventory({ locale }: { locale: Locale }) {
  const [lots, setLots] = useState<MaterialLot[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState<MaterialLot | null>(null);
  const [lotHistory, setLotHistory] = useState<InventoryTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rollQr, setRollQr] = useState("");
  const [rollCheck, setRollCheck] = useState<any>(null);
  const [rollChecking, setRollChecking] = useState(false);
  const domainTitle = locale === "vi-VN" ? "Miền tồn kho" : locale === "en-US" ? "Inventory Domain" : "库存域";
  const domainLabel = (domain?: string | null) => domain === "FINISHED_GOODS"
    ? (locale === "vi-VN" ? "Thành phẩm · FINISHED_GOODS" : locale === "en-US" ? "Finished Goods · FINISHED_GOODS" : "成品域 · FINISHED_GOODS")
    : (locale === "vi-VN" ? "Nguyên vật liệu · RAW_MATERIAL" : locale === "en-US" ? "Raw Material · RAW_MATERIAL" : "原材料域 · RAW_MATERIAL");

  useEffect(() => {
    Promise.all([
      wmsApi.getMaterialLots({ limit: 200 }),
      wmsApi.getStorageLocations({ limit: 200 }),
    ]).then(([lotsRes, locsRes]) => {
      setLots(lotsRes.items);
      setLocations(locsRes.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openLotDetail = (lot: MaterialLot) => {
    setSelectedLot(lot);
    setHistoryLoading(true);
    wmsApi.getLotTransactions(lot.id!).then((res) => {
      setLotHistory(res.items);
      setHistoryLoading(false);
    }).catch(() => setHistoryLoading(false));
  };

  const resolveRoll = async () => {
    const qr = rollQr.trim();
    if (!qr) return;
    setRollChecking(true);
    try {
      setRollCheck(await wmsApi.resolveMaterialRoll(qr));
    } catch (error: any) {
      setRollCheck({ validation: "NOT_FOUND", error: error?.message ?? "Roll QR was not found" });
    } finally {
      setRollChecking(false);
    }
  };

  const filtered = lots.filter(
    (lot) =>
      !query ||
      lot.materialCode.toLowerCase().includes(query.toLowerCase()) ||
      lot.lotNo.toLowerCase().includes(query.toLowerCase()) ||
      (lot.labelId ?? lot.rollQr ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.inventoryLots", locale)}</h2>
              <p>{t("common.overview", locale)}</p>
            </div>
          </div>
          <div className="table-shell">
            <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.loading", locale) ?? "Loading..."}</div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>Material roll validation</h2>
            <p>Scan or enter a roll QR/SN before issuing it to MES/PDA loading.</p>
          </div>
          <CheckCircle2 size={20} color="var(--ok)" />
        </div>
        <div className="page-tools">
          <div className="field-input" style={{ flex: 1 }}>
            <Search size={16} />
            <input
              value={rollQr}
              onChange={(e) => setRollQr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") resolveRoll(); }}
              placeholder="Roll QR / SN"
              title="Roll QR / SN"
            />
          </div>
          <button type="button" className="action-button" onClick={resolveRoll} disabled={rollChecking || !rollQr.trim()}>
            {rollChecking ? "Checking…" : "Validate roll"}
          </button>
        </div>
        {rollCheck && (
          <div className={`badge badge-${rollCheck.validation === "READY" ? "ok" : "danger"}`} style={{ marginTop: 10, padding: 10 }}>
            {rollCheck.validation === "READY"
              ? `${rollCheck.materialCode} · ${rollCheck.rollQr || rollCheck.lotNo} · available ${rollCheck.availableQty} · ${rollCheck.locationCode ?? "no location"}`
              : (rollCheck.error ?? "Roll is blocked by WMS")}
          </div>
        )}
      </section>
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.inventoryLots", locale)}</h2>
            <p>{t("common.overview", locale)}</p>
          </div>
          <div className="page-tools">
            <div className="field-input">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("scan.placeholder", locale)}
                title={t("ui.searchInput", locale)}
              />
            </div>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.material", locale)}</th>
                <th>{domainTitle}</th>
                <th>Roll QR / SN</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>Available</th>
                <th>{t("common.location", locale)}</th>
                <th>{t("wms.qualityStatus", locale)}</th>
                <th>{t("common.action", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lot) => (
                <tr key={lot.id} onClick={() => openLotDetail(lot)} style={{ cursor: "pointer" }}>
                  <td><strong>{lot.materialCode}</strong></td>
                  <td><span className="badge badge-info">{domainLabel("RAW_MATERIAL")}</span></td>
                  <td><strong>{lot.labelId ?? lot.rollQr ?? "—"}</strong></td>
                  <td>{lot.lotNo}</td>
                  <td>{(lot.qty ?? 0).toLocaleString()}</td>
                  <td>{(lot.availableQty ?? Math.max(0, (lot.qty ?? 0) - (lot.reservedQty ?? 0))).toLocaleString()}</td>
                  <td>{lot.locationCode ?? "—"}</td>
                  <td>
                    <span
                      className={`badge badge-${lot.iqcStatus === "released" ? "ok" : lot.iqcStatus === "rejected" ? "danger" : lot.iqcStatus === "hold" ? "warning" : "info"}`}
                      title={t("ui.statusIndicator", locale)}
                    >
                      {t(lot.iqcStatus === "released" ? "iqc.released" : lot.iqcStatus === "rejected" ? "iqc.rejected" : lot.iqcStatus === "hold" ? "iqc.hold" : "iqc.pending", locale)}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="action-button"
                      style={{ background: "var(--nav)", padding: "4px 8px" }}
                      title={t("common.viewHistory", locale) ?? "View history"}
                      onClick={(e) => { e.stopPropagation(); openLotDetail(lot); }}
                    >
                      <History size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.area", locale)}</h2>
            <p>{t("common.overview", locale)}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.code", locale)}</th>
                <th>{domainTitle}</th>
                <th>{t("wms.area", locale)}</th>
                <th>{t("table.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id}>
                  <td><strong>{loc.code}</strong></td>
                  <td><span className={`badge badge-${loc.warehouseType === "FINISHED_GOODS" ? "ok" : "info"}`}>{domainLabel(loc.warehouseType)}</span></td>
                  <td>{text(loc, locale)}</td>
                  <td>
                    <span
                      className={`badge badge-${loc.status === "active" ? "ok" : loc.status === "full" ? "warning" : "danger"}`}
                      title={t("ui.statusIndicator", locale)}
                    >
                      {t(loc.status === "active" ? "common.available" : loc.status === "full" ? "status.closed" : "status.draft", locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedLot && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.lotHistory", locale)} · {selectedLot.lotNo}</h2>
              <p>{selectedLot.materialCode} · {(selectedLot.qty ?? 0).toLocaleString()} {t("common.qty", locale)}</p>
            </div>
            <button
              type="button"
              className="action-button"
              style={{ background: "var(--muted)", padding: "4px 8px" }}
              onClick={() => { setSelectedLot(null); setLotHistory([]); }}
            >
              <X size={14} />
            </button>
          </div>
          {historyLoading ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
          ) : lotHistory.length === 0 ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.noData", locale)}</div>
          ) : (
            <div className="timeline">
              {lotHistory.map((tx) => (
                <div className="timeline-item" key={tx.id}>
                  <span
                    className={`badge badge-${tx.action === "RECEIVE" ? "info" : tx.action === "IQC_RELEASE" ? "ok" : tx.action === "ISSUE_TO_LINE" ? "warning" : "muted"}`}
                  >
                    {tx.action}
                  </span>
                  <div>
                    <strong>{tx.txNo}</strong>
                    <p>
                      {tx.qty.toLocaleString()} · {tx.fromLocation ?? "—"} → {tx.toLocation ?? "—"}
                      {tx.workOrderCode && ` · WO: ${tx.workOrderCode}`}
                    </p>
                  </div>
                  <small>{new Date(tx.occurredAt).toLocaleString()}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
// @ts-nocheck
