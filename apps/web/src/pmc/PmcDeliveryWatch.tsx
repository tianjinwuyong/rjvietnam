import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

type DeliveryTier = "OVERDUE" | "WARNING" | "CAUTION" | "ON_TRACK";

interface DeliveryWatchItem {
  wo_code: string;
  product_code: string;
  line_code: string;
  due_date: string;
  completion_pct: number;
  completed_qty: number;
  planned_qty: number;
  delay_hours: number;
  tier: DeliveryTier;
  rate_detail?: string;
  alert_id?: number;
}

const TIER_CONFIG: Record<DeliveryTier, { color: string; badge: string; icon: string; threshold: string }> = {
  OVERDUE: { color: "var(--danger)", badge: "badge-danger", icon: "☠️", threshold: "due_date < NOW()" },
  WARNING:  { color: "var(--warning)", badge: "badge-warning", icon: "⚠️", threshold: "≤24h to due_date" },
  CAUTION: { color: "#eab308", badge: "badge-warning", icon: "🟡", threshold: "≤48h to due_date" },
  ON_TRACK:{ color: "var(--ok)", badge: "badge-ok", icon: "✅", threshold: ">48h to due_date" },
};

function TierCard({ tier, count, items }: { tier: DeliveryTier; count: number; items: DeliveryWatchItem[] }) {
  const config = TIER_CONFIG[tier];
  return (
    <div
      className="surface-panel"
      style={{
        padding: "16px 20px",
        borderTop: `3px solid ${config.color}`,
        cursor: "default",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: config.color, letterSpacing: "0.05em" }}>
            {config.icon} {tier}
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: config.color, marginTop: 4 }}>{count}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {items.length > 0 ? items[0]?.due_date : "—"}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
          <div style={{ fontFamily: "monospace", background: "var(--nav)", padding: "2px 6px", borderRadius: 4 }}>
            {config.threshold}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeliveryRow({ item, locale }: { item: DeliveryWatchItem; locale: Locale }) {
  const config = TIER_CONFIG[item.tier];
  const hoursToDue = Math.round(item.delay_hours);
  const isOverdue = item.tier === "OVERDUE";

  return (
    <tr
      style={{
        background: isOverdue ? "rgba(200,50,50,0.05)" : item.tier === "WARNING" ? "rgba(200,150,0,0.04)" : undefined,
      }}
    >
      <td>
        <strong>{item.wo_code}</strong>
        {item.alert_id && (
          <div style={{ fontSize: 10, color: "var(--muted)" }}>alert #{item.alert_id}</div>
        )}
      </td>
      <td>
        <div>{item.product_code}</div>
      </td>
      <td>{item.line_code}</td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 100 }}>
          <div className="progress" style={{ flex: 1, margin: 0 }}>
            <span
              style={{
                width: `${item.completion_pct}%`,
                background: item.completion_pct < 30 ? "var(--danger)" : item.completion_pct < 60 ? "var(--warning)" : "var(--ok)",
              }}
            />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600 }}>{item.completion_pct.toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {item.completed_qty.toLocaleString()} / {item.planned_qty.toLocaleString()}
        </div>
      </td>
      <td>
        <span style={{ fontSize: 12, fontFamily: "monospace" }}>
          {new Date(item.due_date).toLocaleDateString()}
        </span>
      </td>
      <td>
        <span
          style={{
            fontWeight: 700,
            color: isOverdue ? "var(--danger)" : hoursToDue <= 24 ? "var(--warning)" : "var(--ok)",
          }}
        >
          {isOverdue ? `-${Math.abs(hoursToDue)}h` : `+${hoursToDue}h`}
        </span>
      </td>
      <td>
        <span className={`badge ${config.badge}`}>
          {config.icon} {item.tier}
        </span>
      </td>
      <td style={{ fontSize: 11, color: "var(--muted)" }}>
        {item.rate_detail ?? "—"}
      </td>
    </tr>
  );
}

export function PmcDeliveryWatch({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<DeliveryWatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DeliveryTier | "ALL">("ALL");
  const [lastRun, setLastRun] = useState<string>("—");

  useEffect(() => {
    pmcApi.getDeliveryWatch().then((res) => {
      setItems(res.items ?? []);
      setLastRun(res.last_run ?? new Date().toISOString());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const overdue = items.filter((i) => i.tier === "OVERDUE");
  const warning = items.filter((i) => i.tier === "WARNING");
  const caution = items.filter((i) => i.tier === "CAUTION");
  const onTrack = items.filter((i) => i.tier === "ON_TRACK");

  const filtered = filter === "ALL" ? items : items.filter((i) => i.tier === filter);
  const totalAlerts = overdue.length + warning.length;

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.deliveryWatch", locale)}</h2>
            <p>{t("pmc.deliveryWatchDesc", locale)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastRun !== "—" && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("pmc.lastPatrol", locale)}: {new Date(lastRun).toLocaleString()}
              </span>
            )}
            {totalAlerts > 0 && (
              <span className="badge badge-danger" style={{ fontSize: 13, padding: "6px 12px" }}>
                🚨 {totalAlerts} {t("pmc.needsAttention", locale)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tier Summary Cards */}
      <div className="content-grid four" style={{ gap: 12 }}>
        <TierCard tier="OVERDUE" count={overdue.length} items={overdue} />
        <TierCard tier="WARNING" count={warning.length} items={warning} />
        <TierCard tier="CAUTION" count={caution.length} items={caution} />
        <TierCard tier="ON_TRACK" count={onTrack.length} items={onTrack} />
      </div>

      {/* Filter */}
      <div className="surface-panel">
        <div style={{ display: "flex", gap: 8 }}>
          {(["ALL", "OVERDUE", "WARNING", "CAUTION", "ON_TRACK"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`badge ${filter === f ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => setFilter(f)}
            >
              {f === "ALL" ? t("common.all", locale) : f}
              {f !== "ALL" && (
                <span style={{ marginLeft: 6 }}>
                  ({f === "OVERDUE" ? overdue.length : f === "WARNING" ? warning.length : f === "CAUTION" ? caution.length : onTrack.length})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.workOrder", locale)}</th>
                <th>{t("common.product", locale)}</th>
                <th>{t("common.line", locale)}</th>
                <th>{t("common.progress", locale)}</th>
                <th>{t("pmc.dueDate", locale)}</th>
                <th>{t("pmc.delayHours", locale)}</th>
                <th>{t("pmc.tier", locale)}</th>
                <th>{t("pmc.rateDetail", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <DeliveryRow key={item.wo_code} item={item} locale={locale} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rate Check Legend */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.rateCheckLogic", locale)}</h2>
            <p>{t("pmc.rateCheckLogicDesc", locale)}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
          <div style={{ background: "var(--nav)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⚡ Rate Check Formula</div>
            <code style={{ fontSize: 11, color: "var(--muted)" }}>
              current_rate = completed_qty / hours_elapsed<br />
              required_rate = remaining_qty / hours_remaining<br />
              <br />
              if required_rate &gt; current_rate × 1.2<br />
              &nbsp;&nbsp;→ escalate to WARNING
            </code>
          </div>
          <div style={{ background: "var(--nav)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>📊 Tier Thresholds</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
              <div><span style={{ color: "var(--danger)", fontWeight: 700 }}>OVERDUE</span> — due_date &lt; NOW()</div>
              <div><span style={{ color: "var(--warning)", fontWeight: 700 }}>WARNING</span> — ≤24h to due_date</div>
              <div><span style={{ color: "#eab308", fontWeight: 700 }}>CAUTION</span> — ≤48h to due_date</div>
              <div><span style={{ color: "var(--ok)", fontWeight: 700 }}>ON_TRACK</span> — &gt;48h to due_date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
