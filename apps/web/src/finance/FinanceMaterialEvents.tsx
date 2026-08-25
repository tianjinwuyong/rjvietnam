import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

interface FinancialEvent {
  id: string;
  eventType: string;
  workOrderCode: string | null;
  lineCode: string | null;
  materialCode: string | null;
  materialNameZh: string | null;
  lotNo: string | null;
  qty: number | null;
  unitCostUsd: string | null;
  totalCostUsd: string | null;
  saleProceedsUsd: string | null;
  lossAmountUsd: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  buyerCode: string | null;
  buyerName: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  refId: string | null;
  refType: string | null;
  operatorName: string | null;
  createdAt: string;
}

interface EventStat {
  eventType: string;
  count: number;
  totalLoss: number;
  totalProceeds: number;
  totalCost: number;
}

const EVENT_TYPE_KEYS: Record<string, string> = {
  COMPENSATION_REQUEST: "finance.eventType.compensationRequest",
  COMPENSATION_APPROVED: "finance.eventType.compensationApproved",
  COMPENSATION_DISPUTED: "finance.eventType.compensationDisputed",
  DISPOSAL_GARBAGE: "finance.eventType.disposalGarbage",
  DISPOSAL_SOLD: "finance.eventType.disposalSold",
  DISPOSAL_RETURN_SUPPLIER: "finance.eventType.disposalReturnSupplier",
  MATERIAL_RETURN_NG: "finance.eventType.materialReturnNg",
  MATERIAL_RETURN_DAMAGED: "finance.eventType.materialReturnDamaged",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  COMPENSATION_REQUEST: "#f59e0b",
  COMPENSATION_APPROVED: "#22c55e",
  COMPENSATION_DISPUTED: "#ef4444",
  DISPOSAL_GARBAGE: "#6b7280",
  DISPOSAL_SOLD: "#3b82f6",
  DISPOSAL_RETURN_SUPPLIER: "#8b5cf6",
  MATERIAL_RETURN_NG: "#ef4444",
  MATERIAL_RETURN_DAMAGED: "#dc2626",
};

function EventTypeBadge({ eventType, locale }: { eventType: string; locale: Locale }) {
  const color = EVENT_TYPE_COLORS[eventType] ?? "#6b7280";
  const label = t(EVENT_TYPE_KEYS[eventType], locale) ?? eventType;
  return (
    <span style={{
      padding: "2px 8px",
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      color: "#fff",
      background: color,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function fmt(v: string | number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? "—" : n.toFixed(decimals);
}

export function FinanceMaterialEvents({ locale }: { locale: Locale }) {
  const [events, setEvents] = useState<FinancialEvent[]>([]);
  const [stats, setStats] = useState<EventStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<FinancialEvent | null>(null);

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "300" });
    if (eventTypeFilter) params.set("eventType", eventTypeFilter);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    apiClient.get("/mes/material-financial-events?" + params.toString())
      .then((r: any) => {
        setEvents(r.items ?? []);
        setStats(r.stats ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [eventTypeFilter, fromDate, toDate]);

  const totalLoss = stats.reduce((s, st) => s + (st.totalLoss ?? 0), 0);
  const totalProceeds = stats.reduce((s, st) => s + (st.totalProceeds ?? 0), 0);
  const totalCost = stats.reduce((s, st) => s + (st.totalCost ?? 0), 0);

  const eventTypes = [
    "", "COMPENSATION_REQUEST", "COMPENSATION_APPROVED", "COMPENSATION_DISPUTED",
    "DISPOSAL_GARBAGE", "DISPOSAL_SOLD", "DISPOSAL_RETURN_SUPPLIER",
    "MATERIAL_RETURN_NG", "MATERIAL_RETURN_DAMAGED",
  ];

  return (
    <div style={{ padding: 16 }}>
      {/* KPI stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("finance.totalEvents", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#3b82f6" }}>{events.length}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("finance.loss30d", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#ef4444" }}>${fmt(totalLoss)}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("finance.income30d", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#22c55e" }}>${fmt(totalProceeds)}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("finance.cost30d", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>${fmt(totalCost)}</div>
        </div>
      </div>

      {/* Stats by type */}
      {stats.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {stats.map((s) => (
            <div key={s.eventType} style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: EVENT_TYPE_COLORS[s.eventType] ?? "#6b7280",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
            }}>
              {t(EVENT_TYPE_KEYS[s.eventType], locale) ?? s.eventType}: {s.count}{t("finance.items", locale)} | {t("finance.loss")}${fmt(s.totalLoss)} | {t("finance.profit")}${fmt(s.totalProceeds)}
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="surface-panel" style={{ marginBottom: 12, padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
          >
            <option value="">{t("finance.filter.allEventTypes", locale)}</option>
            {eventTypes.filter(Boolean).map((et) => (
              <option key={et} value={et}>{t(EVENT_TYPE_KEYS[et], locale) ?? et}</option>
            ))}
          </select>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("finance.filter.from", locale)}:
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              style={{ marginLeft: 6, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", fontSize: 12 }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("finance.filter.to", locale)}:
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              style={{ marginLeft: 6, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", fontSize: 12 }} />
          </label>
          <div style={{ flex: 1 }} />
          <button onClick={fetchData} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 12 }}>
            {t("finance.refresh", locale)}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="surface-panel">
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>{t("finance.loading", locale)}</div>
        ) : events.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>{t("finance.noData", locale)}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[t("finance.table.eventType", locale), t("finance.table.workOrder", locale), t("finance.table.material", locale), t("finance.table.lot", locale), t("finance.table.qty", locale), t("finance.table.unitCost", locale), t("finance.table.totalCost", locale), t("finance.table.loss", locale), t("finance.table.profit", locale), t("finance.table.reason", locale), t("finance.table.operator", locale), t("finance.table.time", locale), ""].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 100).map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setSelected(e)}>
                    <td style={{ padding: "8px 10px" }}><EventTypeBadge eventType={e.eventType} locale={locale} /></td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{e.workOrderCode ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{e.materialCode ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{e.lotNo ?? "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{e.qty ?? "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>${fmt(e.unitCostUsd)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>${fmt(e.totalCostUsd)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: parseFloat(String(e.lossAmountUsd ?? "0")) > 0 ? "#ef4444" : "inherit" }}>
                      ${fmt(e.lossAmountUsd)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: parseFloat(String(e.saleProceedsUsd ?? "0")) > 0 ? "#22c55e" : "inherit" }}>
                      ${fmt(e.saleProceedsUsd)}
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.reasonNote ?? e.reasonCode ?? "—"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{e.operatorName ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)" }}>
                      {e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setSelected(e); }}
                        style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 11 }}
                      >
                        {t("finance.detail.view", locale)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}
          onClick={() => setSelected(null)}
        >
          <div className="surface-panel" style={{ padding: 24, width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{t("finance.detail.title", locale)}</h3>
              <button onClick={() => setSelected(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 13 }}>
              {[
                [t("finance.detail.eventType", locale), <EventTypeBadge eventType={selected.eventType} locale={locale} />],
                [t("finance.detail.workOrder", locale), selected.workOrderCode ?? "—"],
                [t("finance.detail.materialCode", locale), selected.materialCode ?? "—"],
                [t("finance.detail.materialName", locale), selected.materialNameZh ?? "—"],
                [t("finance.detail.lotNo", locale), selected.lotNo ?? "—"],
                [t("finance.detail.qty", locale), selected.qty?.toString() ?? "—"],
                [t("finance.detail.unitCostUsd", locale), "$" + fmt(selected.unitCostUsd)],
                [t("finance.detail.totalCostUsd", locale), "$" + fmt(selected.totalCostUsd)],
                [t("finance.detail.lossAmountUsd", locale), "$" + fmt(selected.lossAmountUsd)],
                [t("finance.detail.saleProceedsUsd", locale), "$" + fmt(selected.saleProceedsUsd)],
                [t("finance.detail.supplier", locale), selected.supplierName ?? selected.supplierCode ?? "—"],
                [t("finance.detail.customer", locale), selected.buyerName ?? selected.buyerCode ?? "—"],
                [t("finance.detail.reasonCode", locale), selected.reasonCode ?? "—"],
                [t("finance.detail.reasonNote", locale), selected.reasonNote ?? "—"],
                [t("finance.detail.refType", locale), selected.refType ?? "—"],
                [t("finance.detail.refId", locale), selected.refId?.toString() ?? "—"],
                [t("finance.detail.operator", locale), selected.operatorName ?? "—"],
                [t("finance.detail.createdAt", locale), selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "—"],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ gridColumn: label === t("finance.detail.reasonNote", locale) || label === t("finance.detail.materialName", locale) ? "1/-1" : "auto" }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{String(label)}</div>
                  <div>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// @ts-nocheck
