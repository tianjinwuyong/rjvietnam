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

      <section className="surface-panel" style={{ border: "1px solid #60a5fa", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="section-header"><div><h2>采购与供应商管理闭环</h2><p>点击节点进入对应页面；当前流程从供应商送货单开始，完成收料后进入 IQC。</p></div><span className="badge badge-info">PURCHASING · SUPPLIER · WMS</span></div>
        <svg viewBox="0 0 1200 190" role="img" aria-label="采购与供应商管理闭环流程图" style={{ width: "100%", minHeight: 170, display: "block" }}>
          <defs><marker id="wms-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker></defs>
          {[[190,95,300,95],[490,95,600,95],[790,95,900,95],[1090,95,1160,95]].map(([x1,y1,x2,y2],i)=><line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#64748b" strokeWidth="3" markerEnd="url(#wms-flow-arrow)" />)}
          {[{x:35,title:"供应商管理",sub:"主数据 / 资质 / 证书",href:"/?view=wms&wmsTab=supplierManagement",fill:"#dbeafe",stroke:"#2563eb"},{x:335,title:"采购部",sub:"PO / 交期 / 数量",href:"/?view=wms&wmsTab=poReceipt",fill:"#dcfce7",stroke:"#16a34a"},{x:635,title:"供应商送货单",sub:"送货单号 / 明细 / OCR",href:"/?view=wms&wmsTab=supplierManagement",fill:"#fef3c7",stroke:"#d97706"},{x:935,title:"WMS 收料",sub:"箱 QR / 托板 / 库位",href:"/?view=wms&wmsTab=materialReceiving",fill:"#e0e7ff",stroke:"#4f46e5"}].map(n=><a key={n.title} href={n.href}><rect x={n.x} y="55" width="220" height="80" rx="14" fill={n.fill} stroke={n.stroke} strokeWidth="3" /><text x={n.x+110} y="87" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0f172a">{n.title}</text><text x={n.x+110} y="112" textAnchor="middle" fontSize="13" fill="#475569">{n.sub}</text></a>)}
          <text x="600" y="170" textAnchor="middle" fontSize="13" fill="#475569">完成 WMS 收料 → IQC 待检 → 财务 PO / 收货 / 发票三方匹配</text>
        </svg>
      </section>

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
