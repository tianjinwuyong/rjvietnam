import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api";

interface MaterialItem {
  id: number;
  materialCode: string;
  vietnamCode: string | null;
  materialNameZh: string;
  uom: string;
  materialType: string;
  qtyPer: number;
  lossRate: number;
  totalRequired: number;
  pickedQty: number;
  shortfall: number;
  bestLot: { lotNo: string; locationCode: string; availableQty: number } | null;
}

interface MaterialStatusData {
  workOrder: { woCode: string; plannedQty: number; completedQty: number; status: string; productCode: string; lineCode: string };
  items: MaterialItem[];
  summary: { totalMaterials: number; fulfilledMaterials: number; fulfillmentPct: number; totalShortfall: number; woProgressPct: number };
}

const MAT_TYPE_COLORS: Record<string, string> = {
  PCB: "badge-info",
  resistor: "badge-muted",
  capacitor: "badge-muted",
  connector: "badge-muted",
  IC: "badge-warning",
  default: "badge-muted",
};

function matTypeColor(type: string): string {
  return MAT_TYPE_COLORS[type.toLowerCase()] ?? MAT_TYPE_COLORS.default;
}

function ProgressBar({ pct, color = "var(--ok)" }: { pct: number; color?: string }) {
  return (
    <div className="progress" style={{ margin: "4px 0" }}>
      <span style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

export function PmcMaterialStatus({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWoCode, setSelectedWoCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MaterialStatusData | null>(null);
  const [matLoading, setMatLoading] = useState(false);

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((woRes) => {
      const items = woRes.items.filter((w) => w.status === "released" || w.status === "running");
      setWorkOrders(items);
      if (items.length > 0 && !selectedWoCode) setSelectedWoCode(items[0].code);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedWoCode) return;
    setMatLoading(true);
    pmcApi.getWorkOrderMaterialStatus(selectedWoCode).then((res: any) => {
      setData(res.data ?? res);
      setMatLoading(false);
    }).catch(() => { setData(null); setMatLoading(false); });
  }, [selectedWoCode]);

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale) ?? "Loading..."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.subnav.materialStatus", locale)}</h2>
            <p>{t("pmc.materialStatusDesc", locale)}</p>
          </div>
        </div>
      </div>

      {/* WO selector */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.selectWorkOrder", locale)}</h3></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {workOrders.map((w) => (
            <button
              key={w.id}
              className={`badge ${w.code === selectedWoCode ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setSelectedWoCode(w.code)}
            >
              {w.code}
            </button>
          ))}
        </div>
      </div>

      {matLoading && (
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        </div>
      )}

      {data && !matLoading && (
        <>
          {/* Summary cards */}
          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            <article className="stat-card">
              <span>{t("pmc.materialStatus.totalMaterials", locale)}</span>
              <strong>{data.summary.totalMaterials}</strong>
            </article>
            <article className="stat-card">
              <span>{t("pmc.materialStatus.fulfilledMaterials", locale)}</span>
              <strong>{data.summary.fulfilledMaterials}</strong>
            </article>
            <article className="stat-card">
              <span>{t("pmc.materialStatus.fulfillmentPct", locale)}</span>
              <strong style={{ color: data.summary.fulfillmentPct >= 100 ? "var(--ok)" : data.summary.fulfillmentPct >= 60 ? "var(--warn)" : "var(--danger)" }}>
                {data.summary.fulfillmentPct}%
              </strong>
            </article>
            <article className="stat-card">
              <span>{t("pmc.materialStatus.shortfall", locale)}</span>
              <strong style={{ color: data.summary.totalShortfall > 0 ? "var(--danger)" : "var(--ok)" }}>
                {data.summary.totalShortfall > 0 ? data.summary.totalShortfall : "—"}
              </strong>
            </article>
            <article className="stat-card">
              <span>{t("pmc.materialStatus.woProgress", locale)}</span>
              <strong>{data.summary.woProgressPct}%</strong>
              <ProgressBar pct={data.summary.woProgressPct} color="var(--info)" />
            </article>
          </div>

          {/* Material table */}
          <div className="surface-panel">
            <div className="section-header">
              <h3>{t("pmc.materialStatus.materialList", locale)}</h3>
              <span className="badge badge-info">{data.workOrder.productCode}</span>
            </div>

            {data.items.length === 0 ? (
              <p style={{ color: "var(--muted)", padding: 16 }}>{t("common.noData", locale)}</p>
            ) : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("pmc.materialStatus.materialCode", locale)}</th>
                      <th>{t("pmc.materialStatus.materialName", locale)}</th>
                      <th>{t("pmc.materialStatus.type", locale)}</th>
                      <th>{t("pmc.materialStatus.qtyPer", locale)}</th>
                      <th>{t("pmc.materialStatus.totalRequired", locale)}</th>
                      <th>{t("pmc.materialStatus.pickedQty", locale)}</th>
                      <th>{t("pmc.materialStatus.shortfallCol", locale)}</th>
                      <th>{t("pmc.materialStatus.availableLot", locale)}</th>
                      <th>{t("pmc.materialStatus.status", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => {
                      const pct = item.totalRequired > 0 ? Math.round(item.pickedQty / item.totalRequired * 100) : 0;
                      const isFulfilled = item.shortfall === 0;
                      return (
                        <tr key={item.id}>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                            {item.vietnamCode ?? item.materialCode}
                          </td>
                          <td style={{ fontSize: 13 }}>{item.materialNameZh}</td>
                          <td><span className={`badge ${matTypeColor(item.materialType)}`}>{item.materialType}</span></td>
                          <td style={{ fontSize: 12 }}>{item.qtyPer} {item.uom}</td>
                          <td style={{ fontSize: 12 }}>{item.totalRequired}</td>
                          <td style={{ fontSize: 12, color: "var(--ok)" }}>{item.pickedQty}</td>
                          <td style={{ fontSize: 12, color: isFulfilled ? "var(--ok)" : "var(--danger)", fontWeight: isFulfilled ? 400 : 600 }}>
                            {isFulfilled ? "—" : item.shortfall}
                          </td>
                          <td style={{ fontSize: 11, color: "var(--muted)" }}>
                            {item.bestLot
                              ? <span>{item.bestLot.lotNo}<br/>{item.bestLot.locationCode} ({item.bestLot.availableQty})</span>
                              : "—"}
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span className={`badge ${isFulfilled ? "badge-ok" : "badge-warning"}`}>
                                {isFulfilled ? t("pmc.materialStatus.fulfilled", locale) : t("pmc.materialStatus.shortfall", locale)}
                              </span>
                            </div>
                            <div style={{ width: 60 }}>
                              <ProgressBar pct={pct} color={isFulfilled ? "var(--ok)" : "var(--warn)"} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!matLoading && !data && (
        <div className="surface-panel">
          <p style={{ color: "var(--muted)", padding: 16 }}>{t("common.noData", locale)}</p>
        </div>
      )}
    </div>
  );
}
