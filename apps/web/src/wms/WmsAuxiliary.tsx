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
  const [records] = useState<AuxRecord[]>([]);
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
