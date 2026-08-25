import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { MaterialLot, StorageLocation } from "../api";
import { AiPatrolChat } from "../ai/AiPatrolChat";
import { wmsPatrol } from "../ai/patrol";

export function WmsDashboard({ locale }: { locale: Locale }) {
  const [lots, setLots] = useState<MaterialLot[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      wmsApi.getMaterialLots({ limit: 100 }),
      wmsApi.getStorageLocations({ limit: 100 }),
    ]).then(([lotsResult, locationsResult]) => {
      if (lotsResult.status === "fulfilled") setLots(lotsResult.value.items);
      if (locationsResult.status === "fulfilled") setLocations(locationsResult.value.items);
      setLoadError(lotsResult.status === "rejected" || locationsResult.status === "rejected");
      setLoading(false);
    });
  }, []);

  const pendingIqc = lots.filter((l) => l.iqcStatus === "pending" || l.iqcStatus === "hold").length;
  const activeLocations = locations.filter((l) => l.status === "active").length;

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="metric-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <article className="stat-card" key={i}>
              <span className="skeleton-text" style={{ width: "60%", height: 14, display: "block", borderRadius: 4, background: "var(--nav)", animation: "pulse 1.5s infinite" }} />
              <strong style={{ fontSize: 28, marginTop: 8, display: "block" }}>—</strong>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {loadError && (
        <section className="surface-panel" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} role="alert">
          <strong>{t("wms.connectionInterrupted", locale)}</strong>
          <div>{t("wms.noSimulatedInventory", locale)}</div>
        </section>
      )}
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("wms.pendingReceive", locale)}</span>
          <strong>{0}</strong>
          <span className={`badge badge-${0 > 0 ? "warning" : "ok"}`} title={t("ui.statusIndicator", locale)}>
            {t(0 > 0 ? "status.hold" : "status.released", locale)}
          </span>
        </article>
        <article className="stat-card">
          <span>{t("wms.iqcPending", locale)}</span>
          <strong>{pendingIqc}</strong>
          <span className={`badge badge-${pendingIqc > 0 ? "warning" : "ok"}`} title={t("ui.statusIndicator", locale)}>
            {t(pendingIqc > 0 ? "status.hold" : "status.released", locale)}
          </span>
        </article>
        <article className="stat-card">
          <span>{t("common.material", locale)}</span>
          <strong>{lots.length}</strong>
          <span className="badge badge-info" title={t("ui.statusIndicator", locale)}>{t("common.active", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("wms.area", locale)}</span>
          <strong>{activeLocations}</strong>
          <span className="badge badge-ok" title={t("ui.statusIndicator", locale)}>{t("common.available", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("wms.stockAlerts", locale)}</span>
          <strong>{0}</strong>
          <span className="badge badge-danger" title={t("ui.statusIndicator", locale)}>{t("status.critical", locale)}</span>
        </article>
      </div>

      <div className="content-grid two">
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.receivingQueue", locale)}</h2>
              <p>{t("section.queue", locale)}</p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.lot", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.location", locale)}</th>
                  <th>{t("wms.qualityStatus", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {lots.slice(0, 4).map((lot) => (
                  <tr key={lot.id}>
                    <td>{lot.lotNo}</td>
                    <td>
                      <strong>{lot.materialCode}</strong>
                    </td>
                    <td>{(lot.qty ?? 0).toLocaleString()}</td>
                    <td>{lot.locationCode ?? "—"}</td>
                    <td>
                      <span
                        className={`badge badge-${lot.iqcStatus === "released" ? "ok" : lot.iqcStatus === "rejected" ? "danger" : lot.iqcStatus === "hold" ? "warning" : "info"}`}
                        title={t("ui.statusIndicator", locale)}
                      >
                        {t(lot.iqcStatus === "released" ? "iqc.released" : lot.iqcStatus === "rejected" ? "iqc.rejected" : lot.iqcStatus === "hold" ? "iqc.hold" : "iqc.pending", locale)}
                      </span>
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
              <h2>{t("wms.iqcPending", locale)}</h2>
              <p>{t("section.queue", locale)}</p>
            </div>
          </div>
          <div className="status-stack">
            {lots
              .filter((l) => l.iqcStatus === "pending" || l.iqcStatus === "hold")
              .slice(0, 3)
              .map((lot) => (
                <div className="status-row" key={String(lot.id)}>
                  <div>
                    <strong>{lot.materialCode}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{lot.lotNo}</span>
                  </div>
                  <span className={`badge badge-warning`} title={t("ui.statusIndicator", locale)}>
                    {t(lot.iqcStatus === "hold" ? "iqc.hold" : "iqc.pending", locale)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      </div>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.inventoryLots", locale)}</h2>
            <p>{t("common.overview", locale)}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.location", locale)}</th>
                <th>{t("wms.qualityStatus", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={String(lot.id)}>
                  <td>
                    <strong>{lot.materialCode}</strong>
                  </td>
                  <td>{lot.lotNo}</td>
                  <td>{(lot.qty ?? 0).toLocaleString()}</td>
                  <td>{lot.locationCode ?? "—"}</td>
                  <td>
                    <span
                      className={`badge badge-${lot.iqcStatus === "released" ? "ok" : lot.iqcStatus === "rejected" ? "danger" : lot.iqcStatus === "hold" ? "warning" : "info"}`}
                      title={t("ui.statusIndicator", locale)}
                    >
                      {t(lot.iqcStatus === "released" ? "iqc.released" : lot.iqcStatus === "rejected" ? "iqc.rejected" : lot.iqcStatus === "hold" ? "iqc.hold" : "iqc.pending", locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AiPatrolChat patrol={wmsPatrol(locale)} locale={locale} />
    </div>
  );
}
