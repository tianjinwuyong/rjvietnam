import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle,
  Clock,
  Gauge,
  Package,
  RefreshCw,
  Search,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { sparePartsApi, type SparePart, type PartsWearSchedule, type PartsWearAlert, type PartsConsumptionLog } from "../api/spareparts";
import { LifespanMonitor } from "./LifespanMonitor";
import { PricingPanel } from "./PricingPanel";

type Tab = "inventory" | "wear" | "alerts" | "consumption" | "lifespan" | "pricing";

interface Summary {
  totalParts: number;
  totalUnits: number;
  lowStockCount: number;
  criticalWear: number;
  warningWear: number;
  totalAlerts: number;
  criticalAlerts: number;
  last30DaysConsumed: number;
  last30DaysTransactions: number;
}

interface ConsumeForm {
  quantity: number;
  reason: "corrective" | "preventive" | "breakdown";
  operatorName: string;
  equipmentId: string;
  workOrderCode: string;
}

interface ReplaceForm {
  equipmentId: string;
  runningHours: number;
  replaceIntervalHours: number;
  nextReplaceDue: string;
}

export function SparePartsWarehouse({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("inventory");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [wearSchedules, setWearSchedules] = useState<PartsWearSchedule[]>([]);
  const [alerts, setAlerts] = useState<PartsWearAlert[]>([]);
  const [consumption, setConsumption] = useState<PartsConsumptionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      sparePartsApi.getSummary(),
      sparePartsApi.getParts({ limit: 200 }),
      sparePartsApi.getWearSchedule(),
      sparePartsApi.getWearAlerts({ acknowledged: false }),
      sparePartsApi.getConsumption({ limit: 100 }),
    ]).then(([s, p, w, a, c]) => {
      setSummary(s);
      setParts(p.items);
      setWearSchedules(w.items);
      setAlerts(a.items);
      setConsumption(c.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const filteredParts = parts.filter(
    (p) =>
      !query ||
      p.partNo.toLowerCase().includes(query.toLowerCase()) ||
      (p.name_zh ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (p.equipmentModel ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  const lowStockCount = parts.filter((p) => p.currentStock < p.minStock).length;
  const criticalWear = wearSchedules.filter((w) => w.wearStatus === "critical" || w.wearStatus === "overdue").length;
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  if (loading && !summary) {
    return (
      <div className="screen-stack">
        <div className="surface-panel" style={{ padding: 24, color: "var(--muted)" }}>
          {t("common.loading", locale) ?? "Loading..."}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {/* Summary strip */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
          <SummaryCard icon={<Boxes size={18} />} label={t("spareParts.totalParts", locale)} value={summary.totalParts} sub={`${summary.totalUnits} ${t("spareParts.unit", locale)}`} locale={locale} />
          <SummaryCard icon={<AlertTriangle size={18} />} label={t("spareParts.lowStockAlert", locale)} value={summary.lowStockCount} tone="warning" locale={locale} />
          <SummaryCard icon={<Wrench size={18} />} label={t("spareParts.wear.critical", locale)} value={summary.criticalWear} tone="danger" locale={locale} />
          <SummaryCard icon={<Gauge size={18} />} label={t("spareParts.wear.warning", locale)} value={summary.warningWear} tone="info" locale={locale} />
          <SummaryCard icon={<AlertTriangle size={18} />} label={t("spareParts.activeAlerts", locale)} value={summary.totalAlerts} tone={summary.criticalAlerts > 0 ? "danger" : "warning"} locale={locale} />
          <SummaryCard icon={<Package size={18} />} label={t("spareParts.tab.consumption", locale)} value={summary.last30DaysConsumed} sub={`${summary.last30DaysTransactions} ${t("spareParts.tab.consumption", locale)}`} locale={locale} />
        </div>
      )}

      {/* Tab nav */}
      <div className="tab-nav" style={{ marginBottom: 16 }}>
        {(["inventory", "wear", "alerts", "consumption", "lifespan", "pricing"] as Tab[]).map((t_) => (
          <button key={t_} className={`tab-btn${tab === t_ ? " active" : ""}`} onClick={() => setTab(t_)}>
            {t("spareParts.tab." + t_, locale)}
          </button>
        ))}
      </div>

      {/* Inventory tab */}
      {tab === "inventory" && (
        <InventoryTab
          parts={filteredParts}
          query={query}
          setQuery={setQuery}
          lowStockCount={lowStockCount}
          locale={locale}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* Wear monitor tab */}
      {tab === "wear" && (
        <WearTab
          schedules={wearSchedules}
          locale={locale}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* Alerts tab */}
      {tab === "alerts" && (
        <AlertsTab
          alerts={alerts}
          locale={locale}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* Consumption tab */}
      {tab === "consumption" && (
        <ConsumptionTab
          logs={consumption}
          parts={parts}
          locale={locale}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* Lifespan Monitor tab */}
      {tab === "lifespan" && (
        <LifespanMonitor locale={locale} />
      )}

      {/* Pricing tab */}
      {tab === "pricing" && (
        <PricingPanel locale={locale} />
      )}
    </div>
  );
}

function t_(tab: Tab, locale: Locale): string {
  const map: Record<Tab, string> = {
    inventory: "spareParts.tab.inventory",
    wear: "spareParts.tab.wearMonitor",
    alerts: "spareParts.tab.alerts",
    consumption: "spareParts.tab.consumption",
    lifespan: "spareParts.tab.lifespan",
    pricing: "spareParts.tab.pricing",
  };
  return t(map[tab], locale);
}

function SummaryCard({ icon, label, value, sub, tone = "ok", locale }: {
  icon: React.ReactNode; label: string; value: number; sub?: string; tone?: "ok" | "warning" | "danger" | "info"; locale: Locale;
}) {
  const toneColor = tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : tone === "info" ? "var(--info)" : "var(--text)";
  return (
    <div className="surface-panel" style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: toneColor }}>{icon}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: toneColor }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Inventory Tab ────────────────────────────────────────────────────

function InventoryTab({ parts, query, setQuery, lowStockCount, locale, onRefresh }: {
  parts: SparePart[]; query: string; setQuery: (q: string) => void;
  lowStockCount: number; locale: Locale; onRefresh: () => void;
}) {
  const [selectedPart, setSelectedPart] = useState<SparePart | null>(null);
  const [showConsume, setShowConsume] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [form, setForm] = useState<ConsumeForm>({ quantity: 1, reason: "corrective", operatorName: "", equipmentId: "", workOrderCode: "" });

  const handleConsume = async () => {
    if (!selectedPart) return;
    await sparePartsApi.recordConsume(selectedPart.id, form);
    setShowConsume(false);
    onRefresh();
  };

  const handleAdjust = async (partId: string, adjustment: number) => {
    await sparePartsApi.adjustStock(partId, { adjustment, reason: "manual" });
    setShowAdjust(false);
    onRefresh();
  };

  return (
    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{t("spareParts.tab.inventory", locale)}</h2>
          <p>{parts.length} {t("spareParts.totalParts", locale)} · {lowStockCount} {t("spareParts.lowStockAlert", locale)}</p>
        </div>
        <div className="page-tools">
          <div className="field-input">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("scan.placeholder", locale)} />
          </div>
          <button className="btn-secondary" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("spareParts.partNo", locale)}</th>
              <th>{t("spareParts.name", locale)}</th>
              <th>{t("spareParts.equipmentModel", locale)}</th>
              <th>{t("spareParts.location", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.currentStock", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.minStock", locale)}</th>
              <th>{t("spareParts.stockOk", locale)}</th>
              <th>{t("spareParts.supplier", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.unitCost", locale)}</th>
              <th>{t("spareParts.status", locale)}</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const low = p.currentStock < p.minStock;
              return (
                <tr key={p.id} className={low ? "row-warning" : ""}>
                  <td><span className="mono">{p.partNo}</span></td>
                  <td>{p.name_zh ?? p.name_en ?? p.partNo}</td>
                  <td>{p.equipmentModel ?? "—"}</td>
                  <td><span className="mono">{p.locationCode ?? "—"}</span></td>
                  <td style={{ textAlign: "right", fontWeight: low ? 700 : 400, color: low ? "var(--danger)" : undefined }}>
                    {p.currentStock}
                  </td>
                  <td style={{ textAlign: "right" }}>{p.minStock}</td>
                  <td>
                    {low
                      ? <span className="badge danger">{t("spareParts.lowStock", locale)}</span>
                      : <span className="badge ok">{t("spareParts.stockOk", locale)}</span>
                    }
                  </td>
                  <td>{p.supplier ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{p.unitCost != null ? `$${p.unitCost.toFixed(0)}` : "—"}</td>
                  <td><span className="badge">{p.status}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-ghost" onClick={() => { setSelectedPart(p); setShowConsume(true); }} title={t("spareParts.consume", locale)}>
                        <Wrench size={12} />
                      </button>
                      <button className="btn-ghost" onClick={() => { setSelectedPart(p); setShowReplace(true); }} title={t("spareParts.replace", locale)}>
                        <Settings size={12} />
                      </button>
                      <button className="btn-ghost" onClick={() => { setSelectedPart(p); setShowAdjust(true); }} title={t("spareParts.adjustStock", locale)}>
                        <Package size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {parts.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>—</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Consume modal */}
      {showConsume && selectedPart && (
        <Modal title={`${t("spareParts.consume", locale)} — ${selectedPart.partNo}`} onClose={() => setShowConsume(false)} locale={locale}>
          <div className="form-grid">
            <div className="field">
              <label>{t("spareParts.consumeQty", locale)}</label>
              <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>{t("spareParts.reason", locale)}</label>
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as ConsumeForm["reason"] })}>
                <option value="corrective" key="reason-corrective">{t("spareParts.reason.corrective", locale)}</option>
                <option value="preventive" key="reason-preventive">{t("spareParts.reason.preventive", locale)}</option>
                <option value="breakdown" key="reason-breakdown">{t("spareParts.reason.breakdown", locale)}</option>
              </select>
            </div>
            <div className="field">
              <label>{t("spareParts.equipmentNo", locale)}</label>
              <input value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} />
            </div>
            <div className="field">
              <label>Operator</label>
              <input value={form.operatorName} onChange={(e) => setForm({ ...form, operatorName: e.target.value })} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowConsume(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleConsume}>Confirm</button>
          </div>
        </Modal>
      )}

      {/* Replace modal */}
      {showReplace && selectedPart && (
        <ReplaceModal part={selectedPart} locale={locale} onClose={() => setShowReplace(false)} onDone={() => { setShowReplace(false); onRefresh(); }} />
      )}

      {/* Adjust stock modal */}
      {showAdjust && selectedPart && (
        <AdjustModal part={selectedPart} locale={locale} onClose={() => setShowAdjust(false)} onDone={(adj) => { handleAdjust(selectedPart.id, adj); setShowAdjust(false); }} />
      )}
    </section>
  );
}

// ── Wear Tab ────────────────────────────────────────────────────────

function WearTab({ schedules, locale, onRefresh }: {
  schedules: PartsWearSchedule[]; locale: Locale; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<string>("");
  return (
    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{t("spareParts.tab.wearMonitor", locale)}</h2>
          <p>{schedules.filter((s) => s.wearStatus === "overdue" || s.wearStatus === "critical").length} {t("spareParts.wear.critical", locale)} · {schedules.filter((s) => s.wearStatus === "warning").length} {t("spareParts.wear.warning", locale)}</p>
        </div>
        <div className="page-tools">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="overdue" key="filter-overdue">{t("spareParts.wear.overdue", locale)}</option>
            <option value="critical" key="filter-critical">{t("spareParts.wear.critical", locale)}</option>
            <option value="warning" key="filter-warning">{t("spareParts.wear.warning", locale)}</option>
            <option value="normal" key="filter-normal">{t("spareParts.wear.normal", locale)}</option>
          </select>
          <button className="btn-secondary" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("spareParts.partNo", locale)}</th>
              <th>{t("spareParts.name", locale)}</th>
              <th>{t("spareParts.equipmentNo", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.runningHours", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.intervalHours", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.wearPct", locale)}</th>
              <th>{t("spareParts.nextReplaceDue", locale)}</th>
              <th>{t("spareParts.wearStatus", locale)}</th>
              <th style={{ width: 180 }}>Progress</th>
            </tr>
          </thead>
          <tbody>
            {schedules.filter((s) => !filter || s.wearStatus === filter).map((s) => {
              const pct = s.wearPct ?? (s.replaceIntervalHours > 0 ? (s.runningHours / s.replaceIntervalHours) * 100 : 0);
              const barColor = s.wearStatus === "overdue" ? "var(--danger)" : s.wearStatus === "critical" ? "var(--danger)" : s.wearStatus === "warning" ? "var(--warning)" : "var(--ok)";
              return (
                <tr key={s.id} className={s.wearStatus === "overdue" || s.wearStatus === "critical" ? "row-danger" : s.wearStatus === "warning" ? "row-warning" : ""}>
                  <td><span className="mono">{s.partNo}</span></td>
                  <td>{s.name_zh ?? s.name_en ?? s.partId}</td>
                  <td><span className="mono">{s.equipmentNo ?? s.equipmentId}</span></td>
                  <td style={{ textAlign: "right" }}>{s.runningHours.toFixed(0)}</td>
                  <td style={{ textAlign: "right" }}>{s.replaceIntervalHours}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: barColor }}>{pct.toFixed(1)}%</td>
                  <td>{s.nextReplaceDue ? new Date(s.nextReplaceDue).toLocaleDateString() : "—"}</td>
                  <td><span className={`badge ${s.wearStatus === "overdue" ? "danger" : s.wearStatus === "critical" ? "danger" : s.wearStatus === "warning" ? "warning" : "ok"}`}>{t(`spareParts.wear.${s.wearStatus}`, locale)}</span></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: barColor }} />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 36 }}>{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {schedules.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>—</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Alerts Tab ─────────────────────────────────────────────────────

function AlertsTab({ alerts, locale, onRefresh }: {
  alerts: PartsWearAlert[]; locale: Locale; onRefresh: () => void;
}) {
  const handleAck = async (alert: PartsWearAlert) => {
    await sparePartsApi.acknowledgeAlert(alert.partId, { alertId: alert.id, operatorName: "Operator" });
    onRefresh();
  };

  const active = alerts.filter((a) => !a.acknowledged);
  const acknowledged = alerts.filter((a) => a.acknowledged);

  return (
    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{t("spareParts.tab.alerts", locale)}</h2>
          <p>{active.length} {t("spareParts.activeAlerts", locale)} · {acknowledged.length} {t("spareParts.acknowledged", locale)}</p>
        </div>
        <button className="btn-secondary" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
      </div>

      {active.length > 0 && (
        <>
          <h3 style={{ margin: "16px 0 8px", fontSize: 13, color: "var(--muted)" }}>{t("spareParts.activeAlerts", locale)}</h3>
          <div className="alert-list">
            {active.map((a) => (
              <div key={a.id} className={`alert-card ${a.severity === "critical" ? "alert-danger" : a.severity === "warning" ? "alert-warning" : "alert-info"}`}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    {a.severity === "critical" ? <AlertTriangle size={14} /> : <Clock size={14} />}
                    <span className="mono">{a.partNo}</span>
                    <span className={`badge ${a.severity === "critical" ? "danger" : "warning"}`}>{t(`spareParts.alert.${a.alertType}`, locale)}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p style={{ fontSize: 13, margin: "0 0 8px" }}>{a.message}</p>
                  {a.runningHours != null && (
                    <p style={{ fontSize: 12, color: "var(--muted)" }}>
                      {t("spareParts.runningHours", locale)}: {a.runningHours} / {a.replaceIntervalHours}h
                    </p>
                  )}
                </div>
                <button className="btn-secondary" onClick={() => handleAck(a)}>
                  <CheckCircle size={13} /> {t("spareParts.acknowledge", locale)}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {acknowledged.length > 0 && (
        <>
          <h3 style={{ margin: "20px 0 8px", fontSize: 13, color: "var(--muted)" }}>{t("spareParts.acknowledged", locale)}</h3>
          <div className="alert-list">
            {acknowledged.map((a) => (
              <div key={a.id} className="alert-card" style={{ opacity: 0.6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle size={14} />
                    <span className="mono">{a.partNo}</span>
                    <span className="badge">{t(`spareParts.alert.${a.alertType}`, locale)}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {a.acknowledgedBy} · {a.acknowledgedAt ? new Date(a.acknowledgedAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, margin: "4px 0 0", color: "var(--muted)" }}>{a.message}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {alerts.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
          <CheckCircle size={24} style={{ marginBottom: 8 }} />
          <p>{t("spareParts.activeAlerts", locale)}: 0</p>
        </div>
      )}
    </section>
  );
}

// ── Consumption Tab ────────────────────────────────────────────────

function ConsumptionTab({ logs, parts, locale, onRefresh }: {
  logs: PartsConsumptionLog[]; parts: SparePart[]; locale: Locale; onRefresh: () => void;
}) {
  const [selectedPartId, setSelectedPartId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ quantity: number; reason: string; operatorName: string; equipmentId: string; workOrderCode: string }>({
    quantity: 1, reason: "corrective", operatorName: "", equipmentId: "", workOrderCode: "",
  });

  const handleSubmit = async () => {
    if (!selectedPartId) return;
    await sparePartsApi.recordConsume(selectedPartId, { ...form, reason: form.reason as "corrective" | "preventive" | "breakdown" });
    setShowForm(false);
    setForm({ quantity: 1, reason: "corrective", operatorName: "", equipmentId: "", workOrderCode: "" });
    setSelectedPartId("");
    onRefresh();
  };

  const filtered = selectedPartId ? logs.filter((l) => l.partId === selectedPartId) : logs;

  return (
    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{t("spareParts.tab.consumption", locale)}</h2>
          <p>{logs.length} {t("spareParts.tab.consumption", locale)}</p>
        </div>
        <div className="page-tools">
          <select value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}>
            <option value="">All parts</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.partNo} — {p.name_zh ?? p.name_en}</option>)}
          </select>
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ {t("spareParts.consume", locale)}</button>
        </div>
      </div>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("spareParts.partNo", locale)}</th>
              <th>{t("spareParts.name", locale)}</th>
              <th style={{ textAlign: "right" }}>{t("spareParts.consumeQty", locale)}</th>
              <th>{t("spareParts.reason", locale)}</th>
              <th>{t("spareParts.equipmentNo", locale)}</th>
              <th>WO / {t("spareParts.equipmentNo", locale)}</th>
              <th>Operator</th>
              <th>{t("spareParts.lastReplaced", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <td><span className="mono">{l.partNo}</span></td>
                <td>{l.name_zh ?? l.name_en}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{l.quantity}</td>
                <td><span className="badge">{t(`spareParts.reason.${l.reason}`, locale)}</span></td>
                <td><span className="mono">{l.equipmentId ?? "—"}</span></td>
                <td><span className="mono">{l.workOrderCode ?? "—"}</span></td>
                <td>{l.operatorName ?? "—"}</td>
                <td>{new Date(l.consumedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>—</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={t("spareParts.consume", locale)} onClose={() => setShowForm(false)} locale={locale}>
          <div className="form-grid">
            <div className="field">
              <label>{t("spareParts.partNo", locale)}</label>
              <select value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}>
                <option value="">—</option>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.partNo}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t("spareParts.consumeQty", locale)}</label>
              <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>{t("spareParts.reason", locale)}</label>
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                <option value="corrective" key="form-reason-corrective">{t("spareParts.reason.corrective", locale)}</option>
                <option value="preventive" key="form-reason-preventive">{t("spareParts.reason.preventive", locale)}</option>
                <option value="breakdown" key="form-reason-breakdown">{t("spareParts.reason.breakdown", locale)}</option>
              </select>
            </div>
            <div className="field">
              <label>{t("spareParts.equipmentNo", locale)}</label>
              <input value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} />
            </div>
            <div className="field">
              <label>Operator</label>
              <input value={form.operatorName} onChange={(e) => setForm({ ...form, operatorName: e.target.value })} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={!selectedPartId}>Confirm</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ── Replace Modal ───────────────────────────────────────────────────

function ReplaceModal({ part, locale, onClose, onDone }: {
  part: SparePart; locale: Locale; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState<ReplaceForm>({
    equipmentId: "", runningHours: 0, replaceIntervalHours: 2000, nextReplaceDue: new Date().toISOString().slice(0, 10),
  });

  const handle = async () => {
    await sparePartsApi.replacePart(part.id, form);
    onDone();
  };

  return (
    <Modal title={`${t("spareParts.replace", locale)} — ${part.partNo}`} onClose={onClose} locale={locale}>
      <div className="form-grid">
        <div className="field">
          <label>{t("spareParts.equipmentNo", locale)}</label>
          <input value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("spareParts.runningHours", locale)}</label>
          <input type="number" min={0} value={form.runningHours} onChange={(e) => setForm({ ...form, runningHours: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>{t("spareParts.intervalHours", locale)}</label>
          <input type="number" min={1} value={form.replaceIntervalHours} onChange={(e) => setForm({ ...form, replaceIntervalHours: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>{t("spareParts.nextReplaceDue", locale)}</label>
          <input type="date" value={form.nextReplaceDue} onChange={(e) => setForm({ ...form, nextReplaceDue: e.target.value })} />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handle}>Confirm Replacement</button>
      </div>
    </Modal>
  );
}

// ── Adjust Stock Modal ─────────────────────────────────────────────

function AdjustModal({ part, locale, onClose, onDone }: {
  part: SparePart; locale: Locale; onClose: () => void; onDone: (adjustment: number) => void;
}) {
  const [adjustment, setAdjustment] = useState(0);
  return (
    <Modal title={`${t("spareParts.adjustStock", locale)} — ${part.partNo}`} onClose={onClose} locale={locale}>
      <p style={{ marginBottom: 16 }}>
        Current: <strong>{part.currentStock}</strong> {part.unit} · Min: <strong>{part.minStock}</strong>
      </p>
      <div className="field">
        <label>Adjustment (+/-)</label>
        <input type="number" value={adjustment} onChange={(e) => setAdjustment(Number(e.target.value))} />
      </div>
      <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--muted)" }}>
        New stock: <strong>{Math.max(0, part.currentStock + adjustment)}</strong>
      </p>
      <div className="modal-actions">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onDone(adjustment)}>Apply</button>
      </div>
    </Modal>
  );
}

// ── Modal ────────────────────────────────────────────────────────────

function Modal({ title, children, onClose, locale }: { title: string; children: React.ReactNode; onClose: () => void; locale: Locale }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" style={{ minWidth: 400 }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
