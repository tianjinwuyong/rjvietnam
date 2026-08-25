import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, CheckCircle, Clock, RefreshCw, Search, Wrench, Gauge, Filter } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

interface LifespanItem {
  id: number;
  partId: string;
  partNo: string;
  name_zh: string | null;
  name_en: string | null;
  name_vi: string | null;
  equipmentId: string | null;
  equipmentName: string | null;
  installedAt: string | null;
  runningHours: number;
  replaceIntervalHours: number;
  wearPercentage: number;
  lifeRemainingHours: number;
  estimatedDaysLeft: number;
  wearStatus: string;
  nextReplaceDue: string | null;
  currentStock: number;
  minStock: number;
  last7DaysConsumption: number;
  consumptionVelocity: string;
}

interface FleetSummary {
  totalTracked: number;
  normal: number;
  warning: number;
  critical: number;
  overdue: number;
  avgFleetWear: number;
}

function wearColor(pct: number): string {
  if (pct >= 100) return "var(--danger)";
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f97316";
  if (pct >= 50) return "#eab308";
  return "#22c55e";
}

function wearStatusLabel(status: string, locale: Locale): string {
  const map: Record<string, string> = {
    normal: "spareParts.wear.normal",
    warning: "spareParts.wear.warning",
    critical: "spareParts.wear.critical",
    overdue: "spareParts.wear.overdue",
  };
  return t(map[status] ?? "spareParts.wear.normal", locale);
}

function pulseClass(status: string): string {
  if (status === "overdue") return "pulse-alarm";
  if (status === "critical") return "pulse-fast";
  if (status === "warning") return "pulse-slow";
  return "";
}

export function LifespanMonitor({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<LifespanItem[]>([]);
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterEquipment, setFilterEquipment] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"wearPct" | "lifeLeft" | "partName">("wearPct");
  const [criticalOnly, setCriticalOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: { items: LifespanItem[]; fleetSummary: FleetSummary } }>("/spare-parts/lifespan");
      setItems(res.data.items);
      setSummary(res.data.fleetSummary);
      setLastUpdated(new Date());
    } catch {
      // demo fallback
      setItems([]);
      setSummary({ totalTracked: 0, normal: 0, warning: 0, critical: 0, overdue: 0, avgFleetWear: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uniqueEquipment = [...new Set(items.map(i => i.equipmentName).filter((e): e is string => Boolean(e)))];

  const filtered = items
    .filter(item => {
      if (criticalOnly && !["critical", "overdue"].includes(item.wearStatus)) return false;
      if (filterStatus !== "all" && item.wearStatus !== filterStatus) return false;
      if (filterEquipment !== "all" && item.equipmentName !== filterEquipment) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = (item.name_zh ?? item.name_en ?? "").toLowerCase();
        if (!name.includes(q) && !item.partNo.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "wearPct") return b.wearPercentage - a.wearPercentage;
      if (sortBy === "lifeLeft") return a.lifeRemainingHours - b.lifeRemainingHours;
      return (a.name_zh ?? a.name_en ?? "").localeCompare(b.name_zh ?? b.name_en ?? "");
    });

  if (loading) {
    return <div className="loading-row">{t("common.loading", locale)}…</div>;
  }

  return (
    <div>
      {/* Fleet summary strip */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
          <div className="surface-panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("spareParts.lifespan.totalTracked", locale)}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.totalTracked}</div>
          </div>
          <div className="surface-panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("spareParts.wear.normal", locale)}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#22c55e" }}>{summary.normal}</div>
          </div>
          <div className="surface-panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("spareParts.lifespan.warningCount", locale)}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#f97316" }}>{summary.warning}</div>
          </div>
          <div className="surface-panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("spareParts.lifespan.criticalCount", locale)}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#ef4444" }}>{summary.critical}</div>
          </div>
          <div className="surface-panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("spareParts.lifespan.overdueCount", locale)}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#7f1d1d", background: "#fef2f2", padding: "2px 8px", borderRadius: 4 }}>{summary.overdue}</div>
          </div>
          <div className="surface-panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("spareParts.lifespan.avgFleetWear", locale)}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{summary.avgFleetWear}%</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("spareParts.lifespan.searchPlaceholder", locale)}
            style={{ paddingLeft: 32, width: "100%" }}
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ minWidth: 130 }}>
          <option value="all">{t("spareParts.lifespan.allStatuses", locale)}</option>
          <option value="normal" key="status-normal">{t("spareParts.wear.normal", locale)}</option>
          <option value="warning" key="status-warning">{t("spareParts.wear.warning", locale)}</option>
          <option value="critical" key="status-critical">{t("spareParts.wear.critical", locale)}</option>
          <option value="overdue" key="status-overdue">{t("spareParts.wear.overdue", locale)}</option>
        </select>
        <select value={filterEquipment} onChange={e => setFilterEquipment(e.target.value)} style={{ minWidth: 130 }}>
          <option value="all">{t("spareParts.lifespan.allEquipment", locale)}</option>
          {uniqueEquipment.map(eq => <option key={eq} value={eq}>{eq}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as "wearPct" | "lifeLeft" | "partName")} style={{ minWidth: 130 }}>
          <option value="wearPct" key="sort-wearPct">{t("spareParts.lifespan.sortByWear", locale)}</option>
          <option value="lifeLeft" key="sort-lifeLeft">{t("spareParts.lifespan.sortByLifeLeft", locale)}</option>
          <option value="partName" key="sort-partName">{t("spareParts.lifespan.sortByName", locale)}</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} />
          {t("spareParts.lifespan.criticalOnly", locale)}
        </label>
        <button className="btn-secondary" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }} onClick={load}>
          <RefreshCw size={13} /> {t("common.refresh", locale)}
        </button>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
          {t("spareParts.lifespan.lastUpdated", locale)}: {lastUpdated.toLocaleTimeString()} · auto-refresh 60s
        </div>
      )}

      {/* Cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {filtered.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "var(--muted)" }}>
            {t("spareParts.lifespan.noData", locale)}
          </div>
        )}
        {filtered.map(item => (
          <LifespanCard key={item.id} item={item} locale={locale} />
        ))}
      </div>
    </div>
  );
}

function LifespanCard({ item, locale }: { item: LifespanItem; locale: Locale }) {
  const color = wearColor(item.wearPercentage);
  const statusLabel = wearStatusLabel(item.wearStatus, locale);
  const pulse = pulseClass(item.wearStatus);

  return (
    <div className={`surface-panel ${pulse}`} style={{ padding: 14, position: "relative", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name_zh ?? item.name_en ?? item.partNo}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.partNo}</div>
          {item.equipmentName && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              <Wrench size={10} style={{ display: "inline", marginRight: 3 }} />
              {item.equipmentName}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
          background: color + "22", color: color,
        }}>
          {statusLabel}
        </span>
      </div>

      {/* Wear bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: "var(--muted)" }}>{t("spareParts.lifespan.wearPercent", locale)}</span>
          <span style={{ fontWeight: 700, color }}>{item.wearPercentage.toFixed(1)}%</span>
        </div>
        <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{
            width: `${Math.min(item.wearPercentage, 100)}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
            transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 10 }}>{t("spareParts.lifespan.runningHours", locale)}</div>
          <div style={{ fontWeight: 600 }}>{item.runningHours.toLocaleString()} / {item.replaceIntervalHours.toLocaleString()}h</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 10 }}>{t("spareParts.lifespan.lifeRemaining", locale)}</div>
          <div style={{ fontWeight: 600, color }}>
            {item.lifeRemainingHours > 0 ? `~${item.estimatedDaysLeft}d` : "—"}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
        <span>
          <Clock size={10} style={{ display: "inline", marginRight: 3 }} />
          {item.nextReplaceDue ? `${t("spareParts.lifespan.nextDue", locale)}: ${new Date(item.nextReplaceDue).toLocaleDateString()}` : ""}
        </span>
        <span style={{ color: item.currentStock < item.minStock ? "var(--warning)" : "var(--muted)" }}>
          <AlertTriangle size={10} style={{ display: "inline", marginRight: 3 }} />
          {item.currentStock}/{item.minStock}
        </span>
      </div>

      {/* Consumption velocity */}
      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
        {t("spareParts.lifespan.consumptionVel", locale)}: {item.consumptionVelocity}
      </div>
    </div>
  );
}
