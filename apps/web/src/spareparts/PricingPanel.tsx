import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Search, TrendingDown, TrendingUp, DollarSign, AlertTriangle, ChevronDown, ChevronUp, CheckCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

interface PartsPricingHistory {
  id: number;
  part_id: string;
  supplier_id: string;
  unit_cost: number;
  currency: string;
  moq: number;
  lead_time_days: number | null;
  valid_from: string;
  valid_to: string | null;
  quote_reference: string | null;
  is_current: boolean;
  part_no: string | null;
  name_zh: string | null;
  supplier_name: string | null;
}

interface SupplierQuote {
  id: number;
  part_id: string;
  supplier_id: string;
  unit_cost: number;
  currency: string;
  moq: number;
  lead_time_days: number | null;
  quote_number: string | null;
  quote_date: string;
  valid_until: string | null;
  notes: string | null;
  status: string;
  part_no: string | null;
  supplier_name: string | null;
}

interface StalePricing {
  id: number;
  part_id: string;
  unit_cost: number;
  valid_from: string;
  part_no: string | null;
  name_zh: string | null;
}

type PriceTab = "current" | "history" | "quotes" | "stale";

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    pending: "var(--warning)",
    accepted: "var(--ok)",
    rejected: "var(--danger)",
    expired: "var(--muted)",
  };
  return colors[status] ?? "var(--text)";
}

export function PricingPanel({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<PriceTab>("current");
  const [prices, setPrices] = useState<PartsPricingHistory[]>([]);
  const [quotes, setQuotes] = useState<SupplierQuote[]>([]);
  const [stale, setStale] = useState<StalePricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedPart, setExpandedPart] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [priceRes, quoteRes, staleRes] = await Promise.all([
        apiClient.get<{ data: { items: PartsPricingHistory[] } }>("/parts-pricing"),
        apiClient.get<{ data: { items: SupplierQuote[] } }>("/supplier-quotes"),
        apiClient.get<{ data: { items: StalePricing[] } }>("/parts-pricing/stale"),
      ]);
      setPrices(priceRes.data.items);
      setQuotes(quoteRes.data.items);
      setStale(staleRes.data.items);
    } catch {
      setPrices([]);
      setQuotes([]);
      setStale([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredPrices = prices.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.part_no ?? "").toLowerCase().includes(q) || (p.name_zh ?? "").toLowerCase().includes(q);
  });

  const staleCount = stale.length;

  if (loading) return <div className="loading-row">{t("common.loading", locale)}…</div>;

  return (
    <div>
      {/* Sub-nav */}
      <div className="tab-nav" style={{ marginBottom: 16 }}>
        <button className={`tab-btn${tab === "current" ? " active" : ""}`} onClick={() => setTab("current")}>
          {t("spareParts.pricing.currentPrices", locale)}
        </button>
        <button className={`tab-btn${tab === "quotes" ? " active" : ""}`} onClick={() => setTab("quotes")}>
          {t("spareParts.pricing.supplierQuotes", locale)}
          {quotes.filter(q => q.status === "pending").length > 0 && (
            <span className="badge">{quotes.filter(q => q.status === "pending").length}</span>
          )}
        </button>
        <button className={`tab-btn${tab === "stale" ? " active" : ""}`} onClick={() => setTab("stale")}>
          {t("spareParts.pricing.stalePricing", locale)}
          {staleCount > 0 && <span className="badge" style={{ background: "var(--warning)", color: "#000" }}>{staleCount}</span>}
        </button>
        <button className="btn-secondary" style={{ marginLeft: "auto" }} onClick={load}>
          <RefreshCw size={13} /> {t("common.refresh", locale)}
        </button>
      </div>

      {/* Search (for current tab) */}
      {tab === "current" && (
        <div style={{ marginBottom: 14, position: "relative", maxWidth: 300 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("spareParts.pricing.searchParts", locale)} style={{ paddingLeft: 32, width: "100%" }} />
        </div>
      )}

      {/* Current Prices Tab */}
      {tab === "current" && (
        <div>
          {filteredPrices.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{t("spareParts.pricing.noPricing", locale)}</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("spareParts.pricing.partNo", locale)}</th>
                  <th>{t("spareParts.pricing.partName", locale)}</th>
                  <th>{t("spareParts.pricing.supplier", locale)}</th>
                  <th>{t("spareParts.pricing.unitCost", locale)}</th>
                  <th>{t("spareParts.pricing.moq", locale)}</th>
                  <th>{t("spareParts.pricing.leadTime", locale)}</th>
                  <th>{t("spareParts.pricing.validFrom", locale)}</th>
                  <th>{t("spareParts.pricing.reference", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPrices.map(p => (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setExpandedPart(expandedPart === p.part_id ? null : p.part_id)}>
                    <td><code>{p.part_no}</code></td>
                    <td>{p.name_zh}</td>
                    <td>{p.supplier_name ?? "—"}</td>
                    <td style={{ fontWeight: 700 }}>
                      <DollarSign size={12} style={{ display: "inline", marginRight: 2 }} />
                      {p.unit_cost.toFixed(2)} {p.currency}
                    </td>
                    <td>{p.moq}</td>
                    <td>{p.lead_time_days ? `${p.lead_time_days}d` : "—"}</td>
                    <td>{p.valid_from}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{p.quote_reference ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Supplier Quotes Tab */}
      {tab === "quotes" && (
        <div>
          {quotes.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{t("spareParts.pricing.noQuotes", locale)}</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("spareParts.pricing.partNo", locale)}</th>
                  <th>{t("spareParts.pricing.supplier", locale)}</th>
                  <th>{t("spareParts.pricing.unitCost", locale)}</th>
                  <th>{t("spareParts.pricing.quoteNo", locale)}</th>
                  <th>{t("spareParts.pricing.quoteDate", locale)}</th>
                  <th>{t("spareParts.pricing.validUntil", locale)}</th>
                  <th>{t("spareParts.pricing.status", locale)}</th>
                  <th>{t("spareParts.pricing.moq", locale)}</th>
                  <th>{t("spareParts.pricing.leadTime", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => (
                  <tr key={q.id}>
                    <td><code>{q.part_no ?? q.part_id}</code></td>
                    <td>{q.supplier_name ?? "—"}</td>
                    <td style={{ fontWeight: 700 }}>
                      {q.unit_cost.toFixed(2)} {q.currency}
                      {q.status === "accepted" && <TrendingUp size={12} style={{ display: "inline", marginLeft: 4, color: "var(--ok)" }} />}
                      {q.status === "pending" && <TrendingDown size={12} style={{ display: "inline", marginLeft: 4, color: "var(--warning)" }} />}
                    </td>
                    <td style={{ fontSize: 12 }}>{q.quote_number ?? "—"}</td>
                    <td>{q.quote_date}</td>
                    <td style={{ color: q.valid_until && new Date(q.valid_until) < new Date() ? "var(--danger)" : "var(--muted)" }}>
                      {q.valid_until ?? "—"}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: statusBadge(q.status) + "22", color: statusBadge(q.status), fontWeight: 600 }}>
                        {q.status}
                      </span>
                    </td>
                    <td>{q.moq}</td>
                    <td>{q.lead_time_days ? `${q.lead_time_days}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Stale Pricing Tab */}
      {tab === "stale" && (
        <div>
          {staleCount === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--ok)" }}>
              <CheckCircle size={20} style={{ display: "block", margin: "0 auto 8px" }} />
              {t("spareParts.pricing.noStale", locale)}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: 8, fontSize: 13 }}>
                <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
                {t("spareParts.pricing.staleWarning", locale)}
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("spareParts.pricing.partNo", locale)}</th>
                    <th>{t("spareParts.pricing.partName", locale)}</th>
                    <th>{t("spareParts.pricing.lastPrice", locale)}</th>
                    <th>{t("spareParts.pricing.lastUpdated", locale)}</th>
                    <th>{t("spareParts.pricing.daysStale", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {stale.map(s => {
                    const daysStale = Math.floor((Date.now() - new Date(s.valid_from).getTime()) / 86400000);
                    return (
                      <tr key={s.id}>
                        <td><code>{s.part_no ?? s.part_id}</code></td>
                        <td>{s.name_zh}</td>
                        <td style={{ fontWeight: 700 }}>{s.unit_cost.toFixed(2)} CNY</td>
                        <td>{s.valid_from}</td>
                        <td style={{ color: daysStale > 120 ? "var(--danger)" : daysStale > 90 ? "var(--warning)" : "var(--muted)", fontWeight: 600 }}>
                          {daysStale} {t("spareParts.pricing.days", locale)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
