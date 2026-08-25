import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Package, Clock, AlertTriangle, CheckCircle, X, Plus, Search,
  Scan, Flame, TrendingDown, Lock, ChevronDown, ChevronRight
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const API = "/api";

interface SolderPasteLot {
  id: number; lot_no: string; material_code: string; material_name_zh: string;
  supplier: string; supplier_name: string; received_at: string;
  shelf_life_days: number; msd_level: string; qty_kg: number; qty_remaining_kg: number;
  status: string; iqc_status: string; notes: string;
  created_by: string; created_at: string; updated_at: string;
  remaining_days: number;
}

interface SolderPasteOpening {
  id: number; lot_id: number; opened_at: string; opened_by: string; opened_by_name: string;
  shelf_life_hours: number; expires_at: string; status: string;
  closed_at: string; close_reason: string; consumption_kg: number;
  created_at: string; updated_at: string;
  lot_no: string; material_code: string; material_name_zh: string;
  original_qty_kg: number; remaining_hours: number;
  open_temp: number | null; open_humidity: number | null; open_image_url: string | null;
  line_code: string | null; machine_code: string | null;
}

interface Consumption {
  id: number; opening_id: number; lot_id: number;
  work_order_code: string; line_code: string; machine_code: string;
  consumed_at: string; consumed_by: string; consumed_by_name: string;
  qty_kg: number; created_at: string;
  lot_no: string; material_code: string; material_name_zh: string;
  consume_image_url: string | null;
}

interface Summary {
  frozenLots: number; activeOpenings: number; expiringSoon: number; todayConsumptionKg: number;
}

type Tab = "lots" | "openings" | "consumption" | "register" | "settings";

function fmtDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtHours(h: number, locale: Locale = "zh-CN"): string {
  if (!isFinite(h) || h < 0) return t("wms.solderPaste.expired", locale);
  if (h < 1) return Math.round(h * 60) + " 分钟";
  if (h < 24) return h.toFixed(1) + " 小时";
  return (h / 24).toFixed(1) + " 天";
}
function openingColor(h: number): string {
  if (!isFinite(h) || h <= 0) return "var(--danger)";
  if (h <= 2) return "var(--danger)";
  if (h <= 8) return "#f59e0b";
  return "var(--ok)";
}
function statusBadge(status: string): string {
  const map: Record<string, string> = {
    frozen: "badge-blue", opened: "badge-yellow", exhausted: "badge-green",
    expired: "badge-red", scrapped: "badge-gray",
    active: "badge-yellow", closed: "badge-green", "expired-opening": "badge-red",
  };
  return map[status] ?? "badge-gray";
}
function iqcBadge(iqc: string): string {
  const map: Record<string, string> = { pending: "badge-yellow", passed: "badge-green", failed: "badge-red" };
  return map[iqc] ?? "badge-gray";
}

export function WmsSolderPaste({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("lots");
  const [lots, setLots] = useState<SolderPasteLot[]>([]);
  const [openings, setOpenings] = useState<SolderPasteOpening[]>([]);
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [summary, setSummary] = useState<Summary>({ frozenLots: 0, activeOpenings: 0, expiringSoon: 0, todayConsumptionKg: 0 });
  const [loadingLots, setLoadingLots] = useState(false);
  const [loadingOpenings, setLoadingOpenings] = useState(false);
  const [loadingConsumption, setLoadingConsumption] = useState(false);
  const [err, setErr] = useState("");

  // Register form
  const [regLotNo, setRegLotNo] = useState("");
  const [regMatCode, setRegMatCode] = useState("");
  const [regMatName, setRegMatName] = useState("");
  const [regSupplier, setRegSupplier] = useState("");
  const [regSupplierName, setRegSupplierName] = useState("");
  const [regShelfLife, setRegShelfLife] = useState("90");
  const [regMsd, setRegMsd] = useState("3");
  const [regQty, setRegQty] = useState("");
  const [regNotes, setRegNotes] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regOk, setRegOk] = useState(false);

  // Open form
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openLotId, setOpenLotId] = useState<number | null>(null);
  const [openLotNo, setOpenLotNo] = useState("");
  const [openShelfHours, setOpenShelfHours] = useState("24");
  const [openTemp, setOpenTemp] = useState("");
  const [openHumidity, setOpenHumidity] = useState("");
  const [openImageUrl, setOpenImageUrl] = useState("");
  const [openLine, setOpenLine] = useState("");
  const [openMachine, setOpenMachine] = useState("");
  const [openSubmitting, setOpenSubmitting] = useState(false);
  const [openOk, setOpenOk] = useState(false);

  // Consume form
  const [showConsumeModal, setShowConsumeModal] = useState(false);
  const [consumeOpening, setConsumeOpening] = useState<SolderPasteOpening | null>(null);
  const [consumeQty, setConsumeQty] = useState("");
  const [consumeWo, setConsumeWo] = useState("");
  const [consumeLine, setConsumeLine] = useState("");
  const [consumeMachine, setConsumeMachine] = useState("");
  const [consumeSubmitting, setConsumeSubmitting] = useState(false);

  // Settings
  const [alertHours, setAlertHours] = useState(() => {
    return localStorage.getItem("spAlertHours") ?? "2";
  });

  // Search
  const [searchQ, setSearchQ] = useState("");

  const fetchLots = useCallback(async () => {
    setLoadingLots(true);
    try {
      const r = await fetch(`${API}/solder-paste/lots?limit=200&offset=0`);
      const j = await r.json();
      setLots(j.items || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingLots(false); }
  }, []);

  const fetchOpenings = useCallback(async () => {
    setLoadingOpenings(true);
    try {
      const r = await fetch(`${API}/solder-paste/openings?limit=200&offset=0`);
      const j = await r.json();
      setOpenings(j.items || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingOpenings(false); }
  }, []);

  const fetchConsumption = useCallback(async () => {
    setLoadingConsumption(true);
    try {
      const r = await fetch(`${API}/solder-paste/consumption?limit=200&offset=0`);
      const j = await r.json();
      setConsumptions(j.items || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingConsumption(false); }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch(`${API}/solder-paste/summary`);
      const j = await r.json();
      setSummary(j);
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => { fetchLots(); fetchSummary(); }, [fetchLots, fetchSummary]);
  useEffect(() => { if (tab === "openings") fetchOpenings(); }, [tab, fetchOpenings]);
  useEffect(() => { if (tab === "consumption") fetchConsumption(); }, [tab, fetchConsumption]);

  // Auto-refresh active openings every 30s
  useEffect(() => {
    if (tab !== "openings") return;
    const id = setInterval(fetchOpenings, 30_000);
    return () => clearInterval(id);
  }, [tab, fetchOpenings]);

  async function handleRegister() {
    if (!regLotNo.trim() || !regMatCode.trim() || !regQty) { setErr("请填写批次号、物料代码、数量"); return; }
    setRegSubmitting(true);
    try {
      const r = await fetch(`${API}/solder-paste/lots`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotNo: regLotNo.trim(), materialCode: regMatCode.trim(),
          materialNameZh: regMatName || undefined, supplier: regSupplier || undefined,
          supplierName: regSupplierName || undefined, shelfLifeDays: parseInt(regShelfLife),
          msdLevel: regMsd, qtyKg: parseFloat(regQty), notes: regNotes || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || t("wms.solderPaste.registerFailed", locale));
      setRegOk(true);
      setTimeout(() => { setRegOk(false); setTab("lots"); fetchLots(); fetchSummary(); }, 1200);
      setRegLotNo(""); setRegMatCode(""); setRegMatName(""); setRegSupplier("");
      setRegSupplierName(""); setRegShelfLife("90"); setRegMsd("3"); setRegQty(""); setRegNotes("");
    } catch (e: any) { setErr(e.message); }
    finally { setRegSubmitting(false); }
  }

  async function handleOpen() {
    if (!openLotId) return;
    setOpenSubmitting(true);
    try {
      const r = await fetch(`${API}/solder-paste/openings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotId: openLotId, shelfLifeHours: parseInt(openShelfHours),
          openTemp: openTemp ? parseFloat(openTemp) : undefined,
          openHumidity: openHumidity ? parseFloat(openHumidity) : undefined,
          openImageUrl: openImageUrl || undefined,
          lineCode: openLine || undefined,
          machineCode: openMachine || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || t("wms.solderPaste.openFailed", locale));
      setOpenOk(true);
      setTimeout(() => { setShowOpenModal(false); setOpenOk(false); fetchOpenings(); fetchLots(); fetchSummary(); setTab("openings"); }, 1200);
    } catch (e: any) { setErr(e.message); }
    finally { setOpenSubmitting(false); }
  }

  async function handleConsume() {
    if (!consumeOpening || !consumeQty) return;
    setConsumeSubmitting(true);
    try {
      const r = await fetch(`${API}/solder-paste/openings/${consumeOpening.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "consume", qtyKg: parseFloat(consumeQty),
          workOrderCode: consumeWo || undefined, lineCode: consumeLine || undefined,
          machineCode: consumeMachine || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || t("wms.solderPaste.consumeFailed", locale));
      setShowConsumeModal(false); setConsumeQty(""); setConsumeWo(""); setConsumeLine(""); setConsumeMachine("");
      fetchOpenings(); fetchConsumption(); fetchLots(); fetchSummary();
    } catch (e: any) { setErr(e.message); }
    finally { setConsumeSubmitting(false); }
  }

  async function handleCloseOpening(opening: SolderPasteOpening, reason: string) {
    try {
      await fetch(`${API}/solder-paste/openings/${opening.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", reason }),
      });
      fetchOpenings(); fetchSummary();
    } catch (e: any) { setErr(e.message); }
  }

  const filteredLots = useMemo(() =>
    lots.filter(l => !searchQ ||
      l.lot_no.toLowerCase().includes(searchQ.toLowerCase()) ||
      l.material_code.toLowerCase().includes(searchQ.toLowerCase()) ||
      (l.material_name_zh || "").includes(searchQ) ||
      (l.supplier_name || "").includes(searchQ)), [lots, searchQ]);

  const filteredOpenings = useMemo(() =>
    openings.filter(o => !searchQ ||
      o.lot_no.toLowerCase().includes(searchQ.toLowerCase()) ||
      o.material_code.toLowerCase().includes(searchQ.toLowerCase()) ||
      (o.material_name_zh || "").includes(searchQ)), [openings, searchQ]);

  const frozenLots = useMemo(() => lots.filter(l => l.status === "frozen"), [lots]);
  const activeOpenings = useMemo(() => openings.filter(o => o.status === "active"), [openings]);
  const expiringOpenings = useMemo(() =>
    openings.filter(o => o.status === "active" && o.remaining_hours <= parseFloat(alertHours)), [openings, alertHours]);

  return (
    <div className="screen-stack">
      {/* Header */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.solderPaste", locale)}</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {t("wms.solderPaste.subtitle", locale) || "锡膏冷冻存储 → 开封使用 → 消耗记录"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="scan-input" style={{ maxWidth: 180 }}>
              <Search size={14} />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder={t("buttons.search", locale)} />
            </div>
            <button className="btn-primary" onClick={() => { setTab("register"); setErr(""); setRegOk(false); }}>
              <Plus size={14} />{t("wms.solderPaste.register", locale)}
            </button>
          </div>
        </div>
        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 12 }}>
          <div className="kpi-card">
            <div className="kpi-label">冷冻批次</div>
            <div className="kpi-value" style={{ color: "#3b82f6" }}>{summary.frozenLots}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">开封中</div>
            <div className="kpi-value" style={{ color: "#f59e0b" }}>{summary.activeOpenings}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">即将过期 (≤{alertHours}h)</div>
            <div className="kpi-value" style={{ color: summary.expiringSoon > 0 ? "var(--danger)" : "var(--ok)" }}>{summary.expiringSoon}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">今日消耗 (kg)</div>
            <div className="kpi-value" style={{ color: "var(--ok)" }}>{summary.todayConsumptionKg.toFixed(2)}</div>
          </div>
        </div>
      </section>

      {err && <div className="alert alert-error" style={{ marginBottom: 8 }}>{err}</div>}

      {/* Tab nav */}
      <div className="tab-nav">
        {(["lots", "openings", "consumption", "register", "settings"] as Tab[]).map(tb => (
          <button key={tb} className={`tab-btn${tab === tb ? " active" : ""}`} onClick={() => setTab(tb)}>
            {tb === "lots" && <Package size={13} />}
            {tb === "openings" && <Clock size={13} />}
            {tb === "consumption" && <TrendingDown size={13} />}
            {tb === "register" && <Plus size={13} />}
            {tb === "settings" && <AlertTriangle size={13} />}
            {t(`wms.solderPaste.tab.${tb}`, locale)}
          </button>
        ))}
      </div>

      {/* ── 批次列表 ── */}
      {tab === "lots" && (
        <section className="surface-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>批次号</th><th>物料代码</th><th>物料名称</th><th>供应商</th>
                  <th>数量(kg)</th><th>剩余(kg)</th><th>保质期(天)</th>
                  <th>剩余(天)</th><th>状态</th><th>IQC</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loadingLots ? <tr><td colSpan={11} className="text-center muted">加载中...</td></tr>
                  : filteredLots.length === 0 ? <tr><td colSpan={11} className="text-center muted">无数据</td></tr>
                  : filteredLots.map(lot => (
                    <tr key={lot.id}>
                      <td><code>{lot.lot_no}</code></td>
                      <td><code>{lot.material_code}</code></td>
                      <td>{lot.material_name_zh || "—"}</td>
                      <td>{lot.supplier_name || lot.supplier || "—"}</td>
                      <td>{lot.qty_kg}</td>
                      <td>{lot.qty_remaining_kg}</td>
                      <td>{lot.shelf_life_days}</td>
                      <td style={{ color: lot.remaining_days < 30 ? "var(--danger)" : lot.remaining_days < 90 ? "#f59e0b" : "var(--ok)" }}>
                        {lot.remaining_days}
                      </td>
                      <td><span className={`badge ${statusBadge(lot.status)}`}>{lot.status}</span></td>
                      <td><span className={`badge ${iqcBadge(lot.iqc_status)}`}>{lot.iqc_status}</span></td>
                      <td>
                        {lot.status === "frozen" && (
                          <button className="btn-sm btn-primary" onClick={() => { setOpenLotId(lot.id); setOpenLotNo(lot.lot_no); setShowOpenModal(true); }}>
                            <Scan size={11} />开封
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 开封管理 ── */}
      {tab === "openings" && (
        <section className="surface-panel">
          <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
            <button className="btn-sm btn-outline" onClick={fetchOpenings}>刷新</button>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>批次号</th><th>物料</th><th>开封时间</th><th>有效期</th>
                  <th>剩余</th><th>温度</th><th>湿度</th><th>线别</th><th>机台</th>
                  <th>状态</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loadingOpenings ? <tr><td colSpan={11} className="text-center muted">加载中...</td></tr>
                  : filteredOpenings.length === 0 ? <tr><td colSpan={11} className="text-center muted">无开封记录</td></tr>
                  : filteredOpenings.map(op => (
                    <tr key={op.id}>
                      <td><code>{op.lot_no}</code></td>
                      <td>{op.material_name_zh || op.material_code}</td>
                      <td>{fmtDt(op.opened_at)}</td>
                      <td>{op.shelf_life_hours}h</td>
                      <td>
                        <span style={{ color: openingColor(op.remaining_hours), fontWeight: 600 }}>
                          {fmtHours(op.remaining_hours)}
                        </span>
                      </td>
                      <td>{op.open_temp != null ? `${op.open_temp}°C` : "—"}</td>
                      <td>{op.open_humidity != null ? `${op.open_humidity}%` : "—"}</td>
                      <td>{op.line_code || "—"}</td>
                      <td>{op.machine_code || "—"}</td>
                      <td><span className={`badge ${statusBadge(op.status)}`}>{op.status}</span></td>
                      <td style={{ display: "flex", gap: 4 }}>
                        {op.status === "active" && (
                          <>
                            <button className="btn-sm btn-primary" onClick={() => { setConsumeOpening(op); setShowConsumeModal(true); }}>
                              消耗
                            </button>
                            <button className="btn-sm btn-outline" onClick={() => handleCloseOpening(op, "used")}>
                              关闭
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 消耗记录 ── */}
      {tab === "consumption" && (
        <section className="surface-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th><th>批次号</th><th>物料</th>
                  <th>工单</th><th>线别</th><th>机台</th><th>消耗(kg)</th><th>照片</th><th>操作人</th>
                </tr>
              </thead>
              <tbody>
                {loadingConsumption ? <tr><td colSpan={9} className="text-center muted">加载中...</td></tr>
                  : consumptions.length === 0 ? <tr><td colSpan={9} className="text-center muted">无消耗记录</td></tr>
                  : consumptions.map(c => (
                    <tr key={c.id}>
                      <td>{fmtDt(c.consumed_at)}</td>
                      <td><code>{c.lot_no}</code></td>
                      <td>{c.material_name_zh || c.material_code}</td>
                      <td>{c.work_order_code || "—"}</td>
                      <td>{c.line_code || "—"}</td>
                      <td>{c.machine_code || "—"}</td>
                      <td>{c.qty_kg}</td>
                      <td>{c.consume_image_url ? <a href={c.consume_image_url} target="_blank" rel="noreferrer">📷</a> : "—"}</td>
                      <td>{c.consumed_by_name || c.consumed_by || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 登记批次 ── */}
      {tab === "register" && (
        <section className="surface-panel">
          <div className="form-grid" style={{ maxWidth: 640 }}>
            <div className="form-group">
              <label>{t("common.batchNo", locale)} <span className="required">*</span></label>
              <input value={regLotNo} onChange={e => setRegLotNo(e.target.value)} placeholder="例: SP-2024-001" />
            </div>
            <div className="form-group">
              <label>{t("common.materialCode", locale)} <span className="required">*</span></label>
              <input value={regMatCode} onChange={e => setRegMatCode(e.target.value)} placeholder="例: 332-0001" />
            </div>
            <div className="form-group">
              <label>{t("common.materialName", locale)}</label>
              <input value={regMatName} onChange={e => setRegMatName(e.target.value)} placeholder="例: 锡膏 SAC305" />
            </div>
            <div className="form-group">
              <label>{t("common.supplier", locale)}</label>
              <input value={regSupplier} onChange={e => setRegSupplier(e.target.value)} placeholder={t("wms.solderPaste.supplierCode", locale)} />
            </div>
            <div className="form-group">
              <label>{t("common.supplier", locale)} {t("common.name", locale)}</label>
              <input value={regSupplierName} onChange={e => setRegSupplierName(e.target.value)} placeholder={t("wms.solderPaste.supplierName", locale)} />
            </div>
            <div className="form-group">
              <label>{t("wms.solderPaste.shelfLifeDays", locale)}</label>
              <input type="number" value={regShelfLife} onChange={e => setRegShelfLife(e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t("wms.solderPaste.msdLevel", locale)}</label>
              <select value={regMsd} onChange={e => setRegMsd(e.target.value)}>
                <option value="1">MSD 1级</option>
                <option value="2">MSD 2级</option>
                <option value="2a">MSD 2a级</option>
                <option value="3">MSD 3级</option>
                <option value="4">MSD 4级</option>
                <option value="5">MSD 5级</option>
                <option value="5a">MSD 5a级</option>
                <option value="6">MSD 6级</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("wms.solderPaste.qty", locale)} <span className="required">*</span></label>
              <input type="number" step="0.001" value={regQty} onChange={e => setRegQty(e.target.value)} placeholder="0.000" />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>{t("wms.solderPaste.note", locale)}</label>
              <textarea value={regNotes} onChange={e => setRegNotes(e.target.value)} rows={2} placeholder={t("wms.solderPaste.optionalNote", locale)} />
            </div>
            {regOk && <div className="alert alert-success" style={{ gridColumn: "1/-1" }}>{t("wms.solderPaste.registerSuccess", locale)}</div>}
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={handleRegister} disabled={regSubmitting}>
                {regSubmitting ? t("wms.solderPaste.submitting", locale) : t("wms.solderPaste.confirmRegister", locale)}
              </button>
              <button className="btn-outline" onClick={() => { setTab("lots"); setErr(""); }}>{t("wms.solderPaste.cancel", locale)}</button>
            </div>
          </div>
        </section>
      )}

      {/* ── 预警设置 ── */}
      {tab === "settings" && (
        <section className="surface-panel">
          <div className="form-grid" style={{ maxWidth: 400 }}>
            <div className="form-group">
              <label>{t("wms.solderPaste.alertThreshold", locale)}</label>
              <input type="number" value={alertHours} onChange={e => {
                setAlertHours(e.target.value);
                localStorage.setItem("spAlertHours", e.target.value);
              }} />
              <small style={{ color: "var(--muted)" }}>{t("wms.solderPaste.alertThresholdHint", locale)}</small>
            </div>
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>{t("wms.solderPaste.msdReference", locale)}</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                <div>MSD 1: {locale === 'zh-CN' ? '无限（<30℃/85%RH）' : locale === 'vi-VN' ? 'Không giới hạn (<30℃/85%RH)' : 'Unlimited (<30℃/85%RH)'}</div>
                <div>MSD 2: {locale === 'zh-CN' ? '4周（<30℃/60%RH）' : locale === 'vi-VN' ? '4 tuần (<30℃/60%RH)' : '4 weeks (<30℃/60%RH)'}</div>
                <div>MSD 2a: {locale === 'zh-CN' ? '168小时' : locale === 'vi-VN' ? '168 giờ' : '168 hours'}</div>
                <div>MSD 3: {locale === 'zh-CN' ? '48小时（<30℃/60%RH）' : locale === 'vi-VN' ? '48 giờ (<30℃/60%RH)' : '48 hours (<30℃/60%RH)'}</div>
                <div>MSD 4: {locale === 'zh-CN' ? '24小时' : locale === 'vi-VN' ? '24 giờ' : '24 hours'}</div>
                <div>MSD 5: {locale === 'zh-CN' ? '24小时' : locale === 'vi-VN' ? '24 giờ' : '24 hours'}</div>
                <div>MSD 5a: {locale === 'zh-CN' ? '6小时' : locale === 'vi-VN' ? '6 giờ' : '6 hours'}</div>
                <div>MSD 6: {locale === 'zh-CN' ? '按标签' : locale === 'vi-VN' ? 'Theo nhãn' : 'Per label'}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── 开封 Modal ── */}
      {showOpenModal && (
        <div className="modal-overlay" onClick={() => !openSubmitting && setShowOpenModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Scan size={16} />{t("wms.solderPaste.tab.openings", locale)}</h3>
              <button className="icon-btn" onClick={() => setShowOpenModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t("wms.solderPaste.batchNo", locale)}</label>
                <input value={openLotNo} disabled />
              </div>
              <div className="form-group">
                <label>{t("wms.solderPaste.openShelfLife", locale)}</label>
                <input type="number" value={openShelfHours} onChange={e => setOpenShelfHours(e.target.value)} />
                <small style={{ color: "var(--muted)" }}>{t("wms.solderPaste.openShelfLifeHint", locale)}</small>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="form-group">
                  <label>{t("wms.solderPaste.openTemp", locale)}<span style={{ color: "var(--danger)" }}>*</span></label>
                  <input type="number" step="0.1" value={openTemp} onChange={e => setOpenTemp(e.target.value)} placeholder="25.5" />
                  <small style={{ color: "var(--muted)" }}>{locale === 'zh-CN' ? '阈值: ≤30°C' : locale === 'vi-VN' ? 'Ngưỡng: ≤30°C' : 'Threshold: ≤30°C'}</small>
                </div>
                <div className="form-group">
                  <label>{t("wms.solderPaste.openHumidity", locale)}<span style={{ color: "var(--danger)" }}>*</span></label>
                  <input type="number" step="0.1" value={openHumidity} onChange={e => setOpenHumidity(e.target.value)} placeholder="45" />
                  <small style={{ color: "var(--muted)" }}>{locale === 'zh-CN' ? '阈值: ≤60%' : locale === 'vi-VN' ? 'Ngưỡng: ≤60%' : 'Threshold: ≤60%'}</small>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="form-group">
                  <label>{t("wms.solderPaste.line", locale)}</label>
                  <input value={openLine} onChange={e => setOpenLine(e.target.value)} placeholder={t("wms.solderPaste.line", locale)} />
                </div>
                <div className="form-group">
<label>{t("wms.solderPaste.machine", locale)}</label>
                  <input value={openMachine} onChange={e => setOpenMachine(e.target.value)} placeholder={t("wms.solderPaste.machine", locale)} />
                </div>
              </div>
              <div className="form-group">
                <label>{t("wms.solderPaste.openImage", locale)}</label>
                <input value={openImageUrl} onChange={e => setOpenImageUrl(e.target.value)} placeholder={t("wms.solderPaste.uploadHint", locale)} />
              </div>
              {openOk && <div className="alert alert-success">{t("wms.solderPaste.openSuccess", locale)}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={handleOpen} disabled={openSubmitting}>
                {openSubmitting ? t("wms.solderPaste.submitting", locale) : t("wms.solderPaste.confirmOpen", locale)}
              </button>
              <button className="btn-outline" onClick={() => setShowOpenModal(false)}>{t("wms.solderPaste.cancel", locale)}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 消耗 Modal ── */}
      {showConsumeModal && consumeOpening && (
        <div className="modal-overlay" onClick={() => !consumeSubmitting && setShowConsumeModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><TrendingDown size={16} />{t("wms.solderPaste.recordConsumption", locale)}</h3>
              <button className="icon-btn" onClick={() => setShowConsumeModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="alert alert-info" style={{ marginBottom: 12 }}>
                批次：<code>{consumeOpening.lot_no}</code>，物料：{consumeOpening.material_name_zh || consumeOpening.material_code}
              </div>
              <div className="form-group">
                <label>{t("wms.solderPaste.consumeQty", locale)} <span className="required">*</span></label>
                <input type="number" step="0.001" value={consumeQty} onChange={e => setConsumeQty(e.target.value)} placeholder="0.000" autoFocus />
              </div>
              <div className="form-group">
                <label>{t("wms.solderPaste.workOrder", locale)}</label>
                <input value={consumeWo} onChange={e => setConsumeWo(e.target.value)} placeholder={t("wms.solderPaste.optional", locale)} />
              </div>
              <div className="form-group">
                <label>{t("wms.solderPaste.lineType", locale)}</label>
                <input value={consumeLine} onChange={e => setConsumeLine(e.target.value)} placeholder={t("wms.solderPaste.optional", locale)} />
              </div>
              <div className="form-group">
                <label>机台</label>
                <input value={consumeMachine} onChange={e => setConsumeMachine(e.target.value)} placeholder={t("wms.solderPaste.optional", locale)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={handleConsume} disabled={consumeSubmitting}>
                {consumeSubmitting ? t("wms.solderPaste.submitting", locale) : t("wms.solderPaste.confirmConsume", locale)}
              </button>
              <button className="btn-outline" onClick={() => setShowConsumeModal(false)}>{t("wms.solderPaste.cancel", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
