import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";
import { bomApi } from "../api/bom";
import { mesApi, type FeederLoadingRecord } from "../api/mes";

interface MaterialItem {
  id: string;
  materialCode: string;
  materialName: { name_zh: string; name_en: string; name_vi: string };
  requiredQty: number;
  pickedQty: number;
  lotNo: string | null;
  locationCode: string | null;
  status: string;
}

const statusBadge: Record<string, string> = {
  pending: "badge-warning",
  partial: "badge-info",
  fulfilled: "badge-ok",
};

const woStatusBadge: Record<string, string> = {
  draft: "badge-muted",
  released: "badge-info",
  running: "badge-ok",
  hold: "badge-warning",
  closed: "badge-muted",
};

const WO_LIFECYCLE = [
  { status: "draft",     labelKey: "workorder.draft",     next: "released", actionLabelKey: "pmc.woAction.release" },
  { status: "released",  labelKey: "workorder.released",  next: "running",  actionLabelKey: "pmc.woAction.start" },
  { status: "running",   labelKey: "workorder.running",   next: "closed",   actionLabelKey: "pmc.woAction.close" },
  { status: "hold",      labelKey: "workorder.hold",      next: "released", actionLabelKey: "pmc.woAction.resume" },
  { status: "closed",    labelKey: "workorder.closed",    next: null,       actionLabelKey: "" },
];

function matName(name: { name_zh: string; name_en: string; name_vi: string }, locale: Locale) {
  const lang = locale.slice(0, 2) as "zh" | "en" | "vi";
  return name[`name_${lang}`] ?? name.name_en ?? name.name_zh ?? "";
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress" style={{ margin: "8px 0", width: "100%" }}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function PmcWorkOrderDetail({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWoCode, setSelectedWoCode] = useState<string>("");
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [matLoading, setMatLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [materialReady, setMaterialReady] = useState<number | null>(null);
  const [feederRecords, setFeederRecords] = useState<FeederLoadingRecord[]>([]);
  const [feederLoading, setFeederLoading] = useState(false);

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((woRes) => {
      const items = woRes.items;
      setWorkOrders(items);
      if (items.length > 0 && !selectedWoCode) setSelectedWoCode(items[0].code);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedWoCode) return;
    setMatLoading(true);
    pmcApi.getWorkOrderRequirements(selectedWoCode)
      .then((res) => setMaterials(res.items ?? []))
      .catch(() => setMaterials([]))
      .finally(() => setMatLoading(false));

    // Calculate materialReady from BOM vs demo inventory
    const wo = workOrders.find((w) => w.code === selectedWoCode);
    if (wo?.productCode) {
      bomApi.getBomByProduct(wo.productCode).then((bom) => {
        if (bom?.lines && bom.lines.length > 0) {
          import("../data").then((mod) => {
            const lots = mod.materialLots ?? [];
            const releasedLots = lots.filter((l: any) => l.iqcStatus === "released");
            let fulfilled = 0;
            for (const line of bom.lines) {
              const availableQty = releasedLots
                .filter((l: any) => l.materialCode === line.materialCode)
                .reduce((sum: number, l: any) => sum + (l.qty ?? 0), 0);
              if (availableQty >= (line.qtyPer ?? 0)) fulfilled++;
            }
            setMaterialReady(bom.lines.length > 0 ? Math.round((fulfilled / bom.lines.length) * 100) : 0);
          }).catch(() => setMaterialReady(null));
        } else {
          setMaterialReady(null);
        }
      }).catch(() => setMaterialReady(null));
    }
  }, [selectedWoCode]);

  useEffect(() => {
    if (!selectedWoCode) return;
    setFeederLoading(true);
    mesApi.getFeederLoadingRecords(selectedWoCode)
      .then((res) => setFeederRecords(res.items ?? []))
      .catch(() => setFeederRecords([]))
      .finally(() => setFeederLoading(false));
  }, [selectedWoCode]);

  const wo = workOrders.find((w) => w.code === selectedWoCode);
  const lifecycle = WO_LIFECYCLE.find((s) => s.status === wo?.status);
  const canTransition = lifecycle?.next != null;

  function handleStatusTransition() {
    if (!wo || !lifecycle?.next) return;
    setUpdating(true);
    pmcApi.updateWorkOrderStatus(wo.code, lifecycle.next)
      .then(() => {
        setWorkOrders((prev) => prev.map((w) => w.code === wo.code ? { ...w, status: lifecycle.next! } : w));
      })
      .finally(() => setUpdating(false));
  }

  if (loading) {
    return <div className="screen-stack"><div className="surface-panel"><div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div></div></div>;
  }

  if (!wo) {
    return <div className="screen-stack"><div className="surface-panel"><p style={{ color: "var(--muted)", padding: 16 }}>{t("common.noData", locale)}</p></div></div>;
  }

  const progress = wo.plannedQty > 0 ? (wo.completedQty / wo.plannedQty) * 100 : 0;
  const fulfilledCount = materials.filter((m) => m.pickedQty >= m.requiredQty).length;
  const totalRequired = materials.reduce((s, m) => s + m.requiredQty, 0);
  const totalPicked = materials.reduce((s, m) => s + m.pickedQty, 0);
  const matProgress = totalRequired > 0 ? (totalPicked / totalRequired) * 100 : 0;

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.subnav.workOrderDetail", locale)}</h2>
            <p>{wo.code}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {workOrders.map((w) => (
              <button
                key={w.id}
                className={`badge badge-${w.code === selectedWoCode ? "info" : "muted"}`}
                style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                onClick={() => setSelectedWoCode(w.code)}
              >
                {w.code}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="content-grid two">
        {/* Left: WO info */}
        <section className="surface-panel">
          <div className="section-header"><h2>{t("common.detail", locale)}</h2></div>
          <div className="status-stack">
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.code", locale)}</span><strong>{wo.code}</strong></div>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.product", locale)}</span><span>{wo.productCode}</span></div>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.line", locale)}</span><span>{wo.lineNameZh ?? wo.lineCode}</span></div>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.type", locale)}</span><span>Type {wo.type}</span></div>
            {(wo as any).bomRevision && (
              <div className="status-row">
                <span style={{ color: "var(--muted)" }}>BOM {t("bom.revision", locale)}</span>
                <span>{(wo as any).bomRevision}</span>
              </div>
            )}
            {materialReady !== null && (
              <div className="status-row">
                <span style={{ color: "var(--muted)" }}>{t("pmc.materialFulfillment", locale)}</span>
                <span style={{ color: materialReady >= 80 ? "var(--ok, #22c55e)" : materialReady >= 50 ? "#f59e0b" : "var(--danger, #ef4444)", fontWeight: 600 }}>
                  {materialReady}%
                </span>
              </div>
            )}
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("table.status", locale)}</span>
              <span className={`badge ${woStatusBadge[wo.status] ?? "badge-muted"}`}>{t(lifecycle?.labelKey ?? "common.status", locale)}</span>
            </div>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.qty", locale)}</span><span>{wo.plannedQty.toLocaleString()}</span></div>
            {lifecycle && canTransition && (
              <div style={{ paddingTop: 8 }}>
                <button className="action-button" onClick={handleStatusTransition} disabled={updating}>
                  {updating ? "..." : t(lifecycle.actionLabelKey, locale)}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Right: production progress + material progress */}
        <section className="surface-panel">
          <div className="section-header"><h2>{t("pmc.woProgress", locale)}</h2></div>
          <div className="status-stack">
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("common.completed", locale)}</span>
              <strong>{wo.completedQty.toLocaleString()} / {wo.plannedQty.toLocaleString()}</strong>
            </div>
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("common.progress", locale)}</span>
              <span>{progress.toFixed(1)}%</span>
            </div>
            <ProgressBar pct={progress} color="var(--ok)" />
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("pmc.materialFulfillment", locale)}</span>
              <strong>{fulfilledCount} / {materials.length} {t("pmc.itemsFulfilled", locale)}</strong>
            </div>
            <div className="status-row">
              <span style={{ color: "var(--muted)" }}>{t("pmc.materialQtyProgress", locale)}</span>
              <span>{totalPicked.toLocaleString()} / {totalRequired.toLocaleString()}</span>
            </div>
            <ProgressBar pct={matProgress} color="var(--info)" />
          </div>
        </section>
      </div>

      {/* Material Requirement Sheet */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.materialRequirementSheet", locale)}</h2>
            <p>{t("pmc.materialRequirementSheetDesc", locale)}</p>
          </div>
          <span className="badge badge-info">{materials.length} {t("table.items", locale)}</span>
        </div>
        {matLoading ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        ) : materials.length === 0 ? (
          <div className="placeholder-view"><p>{t("common.noData", locale)}</p></div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("table.material", locale)}</th>
                  <th>{t("pmc.materialName", locale)}</th>
                  <th>{t("pmc.requiredQty", locale)}</th>
                  <th>{t("pmc.pickedQty", locale)}</th>
                  <th>{t("pmc.shortfall", locale)}</th>
                  <th>{t("pmc.lotNo", locale)}</th>
                  <th>{t("pmc.location", locale)}</th>
                  <th>{t("table.status", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => {
                  const shortfall = m.requiredQty - m.pickedQty;
                  const fulfilled = shortfall <= 0;
                  return (
                    <tr key={m.id} style={{ background: fulfilled ? "rgba(0,128,0,0.05)" : shortfall > 0 ? "rgba(200,50,50,0.05)" : undefined }}>
                      <td>{i + 1}</td>
                      <td><strong>{m.materialCode}</strong></td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>{matName(m.materialName, locale)}</td>
                      <td><strong>{m.requiredQty.toLocaleString()}</strong></td>
                      <td style={{ color: fulfilled ? "var(--ok)" : "var(--muted)" }}>{m.pickedQty.toLocaleString()}</td>
                      <td style={{ color: shortfall > 0 ? "var(--danger)" : "var(--ok)" }}>
                        {shortfall > 0 ? shortfall.toLocaleString() : "—"}
                      </td>
                      <td>{m.lotNo ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td>{m.locationCode ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td>
                        <span className={`badge ${statusBadge[m.status] ?? "badge-muted"}`}>
                          {t(`pmc.matStatus.${m.status}`, locale)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Feeder Loading Records */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.feederLoadingRecords", locale)}</h2>
            <p>{t("pmc.feederLoadingRecordsDesc", locale)}</p>
          </div>
          <span className="badge badge-info">{feederRecords.length} {t("table.items", locale)}</span>
        </div>
        {feederLoading ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        ) : feederRecords.length === 0 ? (
          <div className="placeholder-view"><p>{t("common.noData", locale)}</p></div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("pmc.feederSlot", locale)}</th>
                  <th>{t("common.feeder", locale)}</th>
                  <th>{t("table.material", locale)}</th>
                  <th>{t("pmc.lotNo", locale)}</th>
                  <th>{t("pmc.qty", locale)}</th>
                  <th>{t("pmc.loadedAt", locale)}</th>
                  <th>{t("pmc.operator", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {feederRecords.map((rec, i) => (
                  <tr key={rec.id}>
                    <td>{i + 1}</td>
                    <td><strong>{rec.slotNo}</strong></td>
                    <td>{rec.feederNo ?? "—"}</td>
                    <td>{rec.materialCode ?? "—"}</td>
                    <td>{rec.lotNo}</td>
                    <td>{(rec.qty ?? 0).toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{new Date(rec.loadedAt).toLocaleString()}</td>
                    <td>{rec.operatorName ?? rec.operator ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}