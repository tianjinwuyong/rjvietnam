import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";

interface WipEntry {
  workOrderCode: string;
  productCode: string;
  lineCode: string;
  status: string;
  plannedQty: number;
  completedQty: number;
  progressPct: number;
  materialFulfillment: number;
  lastEvent: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-muted",
  released: "badge-info",
  running: "badge-ok",
  hold: "badge-warning",
  closed: "badge-muted",
};

export function PmcWipTracking({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [wipData, setWipData] = useState<WipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((r) => {
      const items = r.items.filter((w) => w.status !== "closed");
      setWorkOrders(items);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    // Enrich with BOM fulfillment data
    Promise.all(
      workOrders.map(async (wo) => {
        let matFulfillment = 0;
        try {
          const req = await pmcApi.getWorkOrderRequirements(wo.code);
          const items = req.items ?? [];
          if (items.length > 0) {
            const fulfilled = items.filter((m) => m.pickedQty >= m.requiredQty).length;
            matFulfillment = Math.round((fulfilled / items.length) * 100);
          }
        } catch {}
        const progressPct = wo.plannedQty > 0 ? (wo.completedQty / wo.plannedQty) * 100 : 0;
        return {
          workOrderCode: wo.code,
          productCode: wo.productCode,
          lineCode: wo.lineCode,
          status: wo.status,
          plannedQty: wo.plannedQty,
          completedQty: wo.completedQty,
          progressPct,
          materialFulfillment: matFulfillment,
          lastEvent: new Date().toISOString(),
        } as WipEntry;
      })
    ).then(setWipData);
  }, [workOrders]);

  const filtered = wipData.filter(
    (w) =>
      !filter ||
      w.workOrderCode.includes(filter) ||
      w.productCode.includes(filter) ||
      w.lineCode.includes(filter)
  );

  if (loading) {
    return <div className="screen-stack"><div className="surface-panel"><div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div></div>;
  }

  // Aggregate stats
  const totalWO = wipData.length;
  const runningWO = wipData.filter((w) => w.status === "running").length;
  const totalOutput = wipData.reduce((s, w) => s + w.completedQty, 0);
  const avgProgress = wipData.length > 0 ? wipData.reduce((s, w) => s + w.progressPct, 0) / wipData.length : 0;
  const avgFulfillment = wipData.length > 0 ? wipData.reduce((s, w) => s + w.materialFulfillment, 0) / wipData.length : 0;

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.wipTracking", locale)}</h2>
            <p>{t("pmc.wipTrackingDesc", locale)}</p>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="content-grid four" style={{ gap: 12 }}>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.activeWorkOrders", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalWO}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{runningWO} {t("pmc.running", locale)}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.totalOutput", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--ok)" }}>{totalOutput.toLocaleString()}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>PCS</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("common.progress", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{avgProgress.toFixed(1)}%</div>
          <div className="progress" style={{ marginTop: 4 }}><span style={{ width: `${avgProgress}%` }} /></div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("pmc.materialFulfillment", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: avgFulfillment >= 80 ? "var(--ok)" : avgFulfillment >= 50 ? "var(--warning)" : "var(--danger)" }}>{avgFulfillment.toFixed(0)}%</div>
          <div className="progress" style={{ marginTop: 4 }}><span style={{ width: `${avgFulfillment}%`, background: avgFulfillment >= 80 ? "var(--ok)" : "var(--warning)" }} /></div>
        </div>
      </div>

      {/* Filter */}
      <div className="surface-panel">
        <input
          type="text"
          placeholder={`${t("common.filter", locale)} (WO / ${t("common.product", locale)} / ${t("common.line", locale)})`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      {/* WIP table */}
      <div className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.code", locale)}</th>
                <th>{t("common.product", locale)}</th>
                <th>{t("common.line", locale)}</th>
                <th>{t("table.status", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.progress", locale)}</th>
                <th>{t("pmc.materialFulfillment", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
              ) : (
                filtered.map((w) => (
                  <tr key={w.workOrderCode}>
                    <td><strong>{w.workOrderCode}</strong></td>
                    <td>{w.productCode}</td>
                    <td>{w.lineCode}</td>
                    <td><span className={`badge ${STATUS_COLORS[w.status] ?? "badge-muted"}`}>{t(`workorder.${w.status}`, locale)}</span></td>
                    <td>{w.completedQty.toLocaleString()} / {w.plannedQty.toLocaleString()}</td>
                    <td style={{ minWidth: 120 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="progress" style={{ flex: 1, margin: 0 }}><span style={{ width: `${w.progressPct}%` }} /></div>
                        <span style={{ fontSize: 11, minWidth: 36 }}>{w.progressPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="progress" style={{ flex: 1, margin: 0 }}>
                          <span
                            style={{
                              width: `${w.materialFulfillment}%`,
                              background: w.materialFulfillment >= 80 ? "var(--ok)" : w.materialFulfillment >= 50 ? "var(--warning)" : "var(--danger)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            minWidth: 36,
                            color: w.materialFulfillment >= 80 ? "var(--ok)" : w.materialFulfillment >= 50 ? "var(--warning)" : "var(--danger)",
                          }}
                        >
                          {w.materialFulfillment}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
