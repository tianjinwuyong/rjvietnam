import { useState, useMemo } from "react";
import { Snowflake, Flame, Thermometer, Clock, Package, AlertTriangle, Search, CheckCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface AuxRecord {
  id: number;
  materialCode: string;
  materialNameZh: string;
  lotNo: string;
  category: "solderPaste" | "flux" | "underfill" | "glue";
  storageStatus: "frozen" | "thawing" | "ready" | "inUse";
  thawStartTime: string;
  thawHoursRequired: number;
  thawElapsedHours: number;
  openedAt: string;
  shelfLifeAfterOpenHours: number;
  remainingShelfLifeHours: number;
  location: string;
  supplier: string;
}

const categories = ["solderPaste", "flux", "underfill", "glue"] as const;

const catLabels: Record<string, string> = {
  solderPaste: "wms.auxCategory.solderPaste",
  flux: "wms.auxCategory.flux",
  underfill: "wms.auxCategory.underfill",
  glue: "wms.auxCategory.glue",
};

const statusLabels: Record<string, string> = {
  frozen: "wms.frozen",
  thawing: "wms.thawing",
  ready: "wms.ready",
  inUse: "wms.inUse",
};

const _mockAux: AuxRecord[] = [
  { id: 1, materialCode: "SP-SAC305-T4", materialNameZh: "SAC305锡膏 T4", lotNo: "SP-LOT-20260601-001", category: "solderPaste", storageStatus: "frozen", thawStartTime: "", thawHoursRequired: 4, thawElapsedHours: 0, openedAt: "", shelfLifeAfterOpenHours: 24, remainingShelfLifeHours: 24, location: "FRZ-001-A1", supplier: "贺利氏" },
  { id: 2, materialCode: "SP-SAC305-T4", materialNameZh: "SAC305锡膏 T4", lotNo: "SP-LOT-20260610-002", category: "solderPaste", storageStatus: "thawing", thawStartTime: "2025-06-28 08:00", thawHoursRequired: 4, thawElapsedHours: 2.5, openedAt: "", shelfLifeAfterOpenHours: 24, remainingShelfLifeHours: 24, location: "THAW-BENCH-01", supplier: "贺利氏" },
  { id: 3, materialCode: "SP-SAC305-T4", materialNameZh: "SAC305锡膏 T4", lotNo: "SP-LOT-20260615-003", category: "solderPaste", storageStatus: "ready", thawStartTime: "2025-06-27 06:00", thawHoursRequired: 4, thawElapsedHours: 4, openedAt: "2025-06-27 10:00", shelfLifeAfterOpenHours: 24, remainingShelfLifeHours: 8, location: "READY-AREA-01", supplier: "贺利氏" },
  { id: 4, materialCode: "SP-SAC305-T4", materialNameZh: "SAC305锡膏 T4", lotNo: "SP-LOT-20260620-004", category: "solderPaste", storageStatus: "inUse", thawStartTime: "2025-06-20 05:00", thawHoursRequired: 4, thawElapsedHours: 4, openedAt: "2025-06-20 09:00", shelfLifeAfterOpenHours: 24, remainingShelfLifeHours: 2, location: "LINE-01-SPOT", supplier: "贺利氏" },
  { id: 5, materialCode: "FLUX-WF-6318", materialNameZh: "助焊剂 WF-6318", lotNo: "FL-LOT-20260605-001", category: "flux", storageStatus: "frozen", thawStartTime: "", thawHoursRequired: 2, thawElapsedHours: 0, openedAt: "", shelfLifeAfterOpenHours: 72, remainingShelfLifeHours: 72, location: "FRZ-002-B1", supplier: "Kester" },
  { id: 6, materialCode: "FLUX-WF-6318", materialNameZh: "助焊剂 WF-6318", lotNo: "FL-LOT-20260612-002", category: "flux", storageStatus: "ready", thawStartTime: "2025-06-26 14:00", thawHoursRequired: 2, thawElapsedHours: 2, openedAt: "2025-06-26 16:00", shelfLifeAfterOpenHours: 72, remainingShelfLifeHours: 48, location: "READY-AREA-02", supplier: "Kester" },
  { id: 7, materialCode: "UF-LOCTITE-3515", materialNameZh: "底部填充胶 3515", lotNo: "UF-LOT-20260520-001", category: "underfill", storageStatus: "frozen", thawStartTime: "", thawHoursRequired: 24, thawElapsedHours: 0, openedAt: "", shelfLifeAfterOpenHours: 168, remainingShelfLifeHours: 168, location: "FRZ-003-C1", supplier: "Henkel" },
  { id: 8, materialCode: "UF-LOCTITE-3515", materialNameZh: "底部填充胶 3515", lotNo: "UF-LOT-20260525-002", category: "underfill", storageStatus: "thawing", thawStartTime: "2025-06-27 12:00", thawHoursRequired: 24, thawElapsedHours: 14, openedAt: "", shelfLifeAfterOpenHours: 168, remainingShelfLifeHours: 168, location: "THAW-BENCH-02", supplier: "Henkel" },
  { id: 9, materialCode: "GLUE-SILICONE-3140", materialNameZh: "硅胶密封胶 3140", lotNo: "GL-LOT-20260618-001", category: "glue", storageStatus: "frozen", thawStartTime: "", thawHoursRequired: 8, thawElapsedHours: 0, openedAt: "", shelfLifeAfterOpenHours: 336, remainingShelfLifeHours: 336, location: "FRZ-001-A2", supplier: "Dow" },
  { id: 10, materialCode: "SP-SAC305-T3", materialNameZh: "SAC305锡膏 T3", lotNo: "SP-LOT-20260622-005", category: "solderPaste", storageStatus: "frozen", thawStartTime: "", thawHoursRequired: 4, thawElapsedHours: 0, openedAt: "", shelfLifeAfterOpenHours: 24, remainingShelfLifeHours: 24, location: "FRZ-001-A3", supplier: "千住" },
  { id: 11, materialCode: "FLUX-ALPHA-100", materialNameZh: "助焊剂 Alpha 100", lotNo: "FL-LOT-20260608-003", category: "flux", storageStatus: "inUse", thawStartTime: "2025-06-25 09:00", thawHoursRequired: 2, thawElapsedHours: 2, openedAt: "2025-06-25 11:00", shelfLifeAfterOpenHours: 72, remainingShelfLifeHours: 12, location: "LINE-02-FLUX", supplier: "Alpha" },
  { id: 12, materialCode: "UF-LOCTITE-3515", materialNameZh: "底部填充胶 3515", lotNo: "UF-LOT-20260601-003", category: "underfill", storageStatus: "inUse", thawStartTime: "2025-06-22 08:00", thawHoursRequired: 24, thawElapsedHours: 24, openedAt: "2025-06-23 08:00", shelfLifeAfterOpenHours: 168, remainingShelfLifeHours: 96, location: "LINE-01-UNDERFILL", supplier: "Henkel" },
];

const statusColors: Record<string, string> = {
  frozen: "var(--info)",
  thawing: "var(--warn)",
  ready: "var(--ok)",
  inUse: "#8b5cf6",
};

const statusIcons: Record<string, typeof Snowflake> = {
  frozen: Snowflake,
  thawing: Flame,
  ready: CheckCircle,
  inUse: Clock,
};

export function WmsAuxiliary({ locale }: { locale: Locale }) {
  const [records] = useState<AuxRecord[]>(_mockAux);
  const [catFilter, setCatFilter] = useState<string>("all");
  const [searchQ, setSearchQ] = useState("");

  const filtered = useMemo(() => {
    let r = records;
    if (catFilter !== "all") r = r.filter((a) => a.category === catFilter);
    if (searchQ) r = r.filter((a) => a.materialCode.toLowerCase().includes(searchQ.toLowerCase()) || a.lotNo.toLowerCase().includes(searchQ.toLowerCase()));
    return r;
  }, [records, catFilter, searchQ]);

  const statCards = useMemo(() => [
    { label: t("wms.frozen", locale), count: records.filter((r) => r.storageStatus === "frozen").length, color: "var(--info)" },
    { label: t("wms.thawing", locale), count: records.filter((r) => r.storageStatus === "thawing").length, color: "var(--warn)" },
    { label: t("wms.ready", locale), count: records.filter((r) => r.storageStatus === "ready").length, color: "var(--ok)" },
    { label: t("wms.inUse", locale), count: records.filter((r) => r.storageStatus === "inUse").length, color: "#8b5cf6" },
  ], [records]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.auxiliary", locale)}</h2>
            <p>{t("wms.stockAlerts", locale)}</p>
          </div>
          <div className="scan-input" style={{ maxWidth: 220 }}>
            <Search size={14} />
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t("common.search", locale)} />
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {statCards.map((card) => (
            <div key={card.label} style={{ flex: 1, padding: "14px 18px", borderRadius: 8, background: "var(--nav)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{card.label}</div>
              <strong style={{ fontSize: 22, color: card.color }}>{card.count}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3>{t("wms.auxCategory", locale)} {t("wms.inventoryLots", locale)}</h3></div>
          <div className="toolbar" style={{ gap: 4 }}>
            <button className="action-button" type="button"
              style={{ background: catFilter === "all" ? "var(--info)" : "var(--nav)", color: catFilter === "all" ? "#fff" : "var(--fg)", fontSize: 11, padding: "4px 10px" }}
              onClick={() => setCatFilter("all")}>{t("common.all", locale)}</button>
            {categories.map((cat) => (
              <button key={cat} className="action-button" type="button"
                style={{ background: catFilter === cat ? "var(--info)" : "var(--nav)", color: catFilter === cat ? "#fff" : "var(--fg)", fontSize: 11, padding: "4px 10px" }}
                onClick={() => setCatFilter(cat)}>{t(catLabels[cat], locale)}</button>
            ))}
          </div>
        </div>
        <div className="table-shell" style={{ maxHeight: 500, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("wms.auxCategory", locale)}</th>
                <th>{t("wms.auxStorage", locale)}</th>
                <th>{t("wms.auxThawTime", locale)}</th>
                <th>{t("common.date", locale)}</th>
                <th>{t("wms.auxShelfLife", locale)}</th>
                <th>{t("common.location", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const StatusIcon = statusIcons[r.storageStatus];
                const isRth = r.storageStatus === "thawing" && r.thawElapsedHours < r.thawHoursRequired;
                const isExpiringAe = r.storageStatus === "inUse" && r.remainingShelfLifeHours <= 4;
                return (
                  <tr key={r.id} style={{ background: isExpiringAe ? "rgba(239,68,68,0.04)" : isRth ? "rgba(245,158,11,0.04)" : undefined }}>
                    <td><strong style={{ fontSize: 12 }}>{r.materialCode}</strong><br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{r.materialNameZh}</span></td>
                    <td><code style={{ fontSize: 10 }}>{r.lotNo}</code></td>
                    <td><span style={{ fontSize: 12 }}>{t(catLabels[r.category], locale)}</span></td>
                    <td>
                      <span className="badge" style={{ background: statusColors[r.storageStatus], color: "#fff", fontSize: 11 }}>
                        <StatusIcon size={12} style={{ marginRight: 2 }} />
                        {t(statusLabels[r.storageStatus], locale)}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.storageStatus === "thawing" ? (
                        <span style={{ color: "var(--warn)" }}>
                          {r.thawElapsedHours.toFixed(1)}h / {r.thawHoursRequired}h
                          {r.thawElapsedHours < r.thawHoursRequired && <AlertTriangle size={10} style={{ marginLeft: 4 }} />}
                        </span>
                      ) : r.storageStatus === "frozen" ? (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      ) : (
                        <span style={{ color: "var(--ok)" }}>{r.thawHoursRequired}h {t("wms.done", locale)}</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{r.openedAt || r.thawStartTime || "—"}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Clock size={12} color="var(--muted)" />
                        <span style={{
                          fontWeight: 600, fontSize: 12,
                          color: r.remainingShelfLifeHours <= 4 ? "var(--danger)" : r.remainingShelfLifeHours <= 24 ? "#f59e0b" : "var(--muted)",
                        }}>
                          {r.remainingShelfLifeHours}h
                        </span>
                        {r.remainingShelfLifeHours <= 4 && <AlertTriangle size={12} color="var(--danger)" />}
                      </div>
                      <div style={{ width: 60, height: 3, background: "var(--border)", borderRadius: 2, marginTop: 2 }}>
                        <div style={{
                          width: `${Math.min(100, (1 - r.remainingShelfLifeHours / r.shelfLifeAfterOpenHours) * 100)}%`,
                          height: 3, background: r.remainingShelfLifeHours <= 4 ? "var(--danger)" : r.remainingShelfLifeHours <= 24 ? "#f59e0b" : "var(--ok)", borderRadius: 2,
                        }} />
                      </div>
                    </td>
                    <td style={{ fontSize: 11 }}>{r.location}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
