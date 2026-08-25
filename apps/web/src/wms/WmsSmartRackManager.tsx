/**
 * WmsSmartRackManager — 智能料架管理
 *
 * 功能：料架库存查询、入库、出库、LED引导
 * 物料管控规则集成：
 *   - 有效期管控：显示 alertLevel 状态标签（超期/三级/二级/一级/正常）
 *   - 剩余天数：颜色编码显示（红≤30天、蓝≤90天、绿>90天）
 *   - FIFO 管控：按入库时间排序，标记违规批次
 *   - 最低库存预警：对比 minStock 显示库存不足警告
 *   - 周期复检提示：超期/临期物料需复检
 *
 * 由于货架控制器（192.168.6.118:8093）只有 POST 接口无查询接口，
 * 物料批次信息通过 WMS API（getLifecycleLots）获取后与料架库位数据合并展示。
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Search, X, LayoutGrid, RefreshCw,
  ArrowDownToLine, ArrowUpFromLine, Trash2,
  Lightbulb, LightbulbOff, AlertTriangle,
  ArrowUpDown
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";
import type { LifecycleLot } from "../api/wms";
import {
  shelfIn, shelfOut, lightCell, lightEmptyLocations,
  fetchRackCells, fetchRackStatus,
  type RackCellRow,
} from "./shelf-api";
import { SmartRackAiChat } from "./SmartRackAiChat";

/* ── Types ─────────────────────────────────────────────────────────── */

export type ShelfCell = {
  locationCode: string;    // "L001A"
  labelId: string;        // 标签/条码号
  materialCode: string;    // 物料编码
  materialName: string;    // 物料名称
  qty: number;            // 当前数量
  minStock: number;       // 最低库存阈值
  inTime: string;         // 入库时间 ISO
  // 生命周期管控字段（从 WMS API 合并）
  lotNo?: string;
  expiryDate?: string;
  remainingDays?: number | null;
  alertLevel?: "EXPIRED" | "RED_L3" | "BLUE_L2" | "YELLOW_L1" | "NORMAL" | null;
  fifoOrder?: number;     // FIFO 顺序号
  fifoViolation?: boolean; // 是否 FIFO 违规
  periodicInspectionDue?: boolean; // 是否需周期复检
};

/* ── Mock 料架数据（含生命周期管控字段）────────────────────────────── */

const MOCK_CELLS: ShelfCell[] = [
  {
    locationCode: "L001A", labelId: "TSN-2025-0601-001", materialCode: "CAP-100UF-16V",
    materialName: "贴片电容 100μF/16V", qty: 2000, minStock: 500,
    inTime: "2025-06-28T08:00:00Z",
    lotNo: "LOT-20250628-001", expiryDate: "2026-06-28", remainingDays: -2,
    alertLevel: "EXPIRED", fifoOrder: 2, fifoViolation: false,
  },
  {
    locationCode: "L001B", labelId: "TSN-2025-0601-002", materialCode: "RES-10K-0603",
    materialName: "贴片电阻 10kΩ 0603", qty: 300, minStock: 1000,
    inTime: "2025-06-28T09:30:00Z",
    lotNo: "LOT-20250628-002", expiryDate: "2027-06-28", remainingDays: 365,
    alertLevel: "NORMAL", fifoOrder: 3, fifoViolation: false,
  },
  {
    locationCode: "L002A", labelId: "TSN-2025-0620-015", materialCode: "IC-STM32F103",
    materialName: "STM32F103 MCU", qty: 450, minStock: 200,
    inTime: "2025-06-20T14:00:00Z",
    lotNo: "LOT-20250620-015", expiryDate: "2026-09-20", remainingDays: 82,
    alertLevel: "BLUE_L2", fifoOrder: 1, fifoViolation: false,
  },
  {
    locationCode: "L002B", labelId: "", materialCode: "", materialName: "", qty: 0, minStock: 0,
    inTime: "",
  },
  {
    locationCode: "L003A", labelId: "TSN-2025-0615-008", materialCode: "LED-RED-0805",
    materialName: "红色LED 0805", qty: 80, minStock: 200,
    inTime: "2025-06-15T10:00:00Z",
    lotNo: "LOT-20250615-008", expiryDate: "2026-07-01", remainingDays: 1,
    alertLevel: "RED_L3", fifoOrder: 1, fifoViolation: true,
    periodicInspectionDue: true,
  },
  {
    locationCode: "L003B", labelId: "TSN-2025-0625-020", materialCode: "CONN-USB-C",
    materialName: "USB-C 连接器 24P", qty: 150, minStock: 100,
    inTime: "2025-06-25T11:00:00Z",
    lotNo: "LOT-20250625-020", expiryDate: "2026-08-25", remainingDays: 56,
    alertLevel: "YELLOW_L1", fifoOrder: 2, fifoViolation: false,
  },
];

const RACKS = ["L001", "L002", "L003"];

/* ── 辅助函数 ──────────────────────────────────────────────────────── */

function formatTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const ALERT_CFG: Record<string, { labelKey: string; color: string; bg: string }> = {
  EXPIRED:   { labelKey: "wms.alert.expired",   color: "#fff", bg: "#c0392b" },
  RED_L3:    { labelKey: "wms.alert.redL3",    color: "#fff", bg: "#e74c3c" },
  BLUE_L2:   { labelKey: "wms.alert.blueL2",    color: "#fff", bg: "#2980b9" },
  YELLOW_L1: { labelKey: "wms.alert.yellowL1", color: "#000", bg: "#f39c12" },
  NORMAL:    { labelKey: "wms.alert.normal",    color: "#fff", bg: "#27ae60" },
};

function AlertBadge({ level }: { level: string | null | undefined }) {
  if (!level) return <span style={{ color: "var(--muted)" }}>—</span>;
  const cfg = ALERT_CFG[level] ?? ALERT_CFG.NORMAL;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, color: cfg.color, background: cfg.bg,
      whiteSpace: "nowrap",
    }}>
      {t(cfg.labelKey, "zh-CN") as string}
    </span>
  );
}

function DaysDisplay({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (days <= 0) return <span style={{ color: "#c0392b", fontWeight: 700, fontSize: 12 }}>已超期{Math.abs(days)}天</span>;
  if (days <= 30)  return <span style={{ color: "#e74c3c", fontWeight: 600, fontSize: 12 }}>{days}天</span>;
  if (days <= 90)  return <span style={{ color: "#2980b9", fontWeight: 600, fontSize: 12 }}>{days}天</span>;
  return <span style={{ color: "#27ae60", fontSize: 12 }}>{days}天</span>;
}

/* ── Props ──────────────────────────────────────────────────────────── */

interface Props { locale: Locale; }

/* ── Component ─────────────────────────────────────────────────────── */

export function WmsSmartRackManager({ locale }: Props) {
  const [cells, setCells] = useState<ShelfCell[]>([]);
  const [lifecycleLots, setLifecycleLots] = useState<LifecycleLot[]>([]);
  const [racks, setRacks] = useState<string[]>(["RAW-A", "RAW-B", "RAW-C", "RAW-D"]);
  const [activeRack, setActiveRack] = useState<string>("RAW-A");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [alertFilter, setAlertFilter] = useState<string>("ALL");

  /* ── 数据获取 ── */
  const loadRackCells = useCallback(async (rack?: string) => {
    setLoading(true);
    try {
      const targetRack = rack ?? activeRack;
      // Fetch rack cells from real API
      const res = await fetchRackCells(targetRack);
      if (res) {
        const mapped: ShelfCell[] = (res.cells.rows as RackCellRow[]).map((c) => ({
          locationCode: c.storageCode ?? `${targetRack}${c.cell_number}`,
          labelId: c.labelId ?? "",
          materialCode: c.materialCode ?? "",
          materialName: c.materialNameZh ?? "",
          qty: c.qty ?? 0,
          minStock: 0,
          inTime: c.last_light_at ?? "",
          lotNo: c.lotNo ?? undefined,
          expiryDate: undefined,
          remainingDays: undefined,
          alertLevel: null,
          fifoOrder: undefined,
          fifoViolation: false,
          periodicInspectionDue: false,
        }));
        setCells(mapped);
      }
      // Also load lifecycle lots for alert/expiry enrichment
      wmsApi.getLifecycleLots({ limit: 200 }).then((lots) => {
        setLifecycleLots(lots ?? []);
      }).catch(() => {});
    } catch (e) {
      // network error — keep existing cells
    } finally {
      setLoading(false);
    }
  }, [activeRack]);

  useEffect(() => {
    loadRackCells();
  }, [activeRack]);

  useEffect(() => {
    fetchRackStatus().then((data) => {
      const discovered = (data.racks?.rows ?? []).map((rack) => rack.shelf_code);
      if (discovered.length) {
        setRacks(discovered);
        if (!discovered.includes(activeRack)) setActiveRack(discovered[0]);
      }
    }).catch(() => {});
  }, []);

  /* ── 计算统计数据 ── */
  const stats = useMemo(() => {
    const rackCells = cells.filter((c) => c.locationCode.startsWith(activeRack) && c.labelId);
    const expired     = rackCells.filter((c) => c.alertLevel === "EXPIRED").length;
    const redL3       = rackCells.filter((c) => c.alertLevel === "RED_L3").length;
    const blueL2      = rackCells.filter((c) => c.alertLevel === "BLUE_L2").length;
    const yellowL1    = rackCells.filter((c) => c.alertLevel === "YELLOW_L1").length;
    const normal      = rackCells.filter((c) => c.alertLevel === "NORMAL").length;
    const fifoViol    = rackCells.filter((c) => c.fifoViolation).length;
    const belowMin    = rackCells.filter((c) => c.minStock > 0 && c.qty < c.minStock).length;
    const total       = rackCells.length;
    const emptySlots  = cells.filter((c) => c.locationCode.startsWith(activeRack) && !c.labelId).length;
    return { expired, redL3, blueL2, yellowL1, normal, fifoViol, belowMin, total, emptySlots };
  }, [cells, activeRack]);

  /* ── 过滤逻辑 ── */
  const rackCells = cells.filter((c) => c.locationCode.startsWith(activeRack));

  const filtered = useMemo(() => {
    let result = rackCells;
    if (alertFilter !== "ALL") {
      result = result.filter((c) => c.alertLevel === alertFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (c) =>
          (c.labelId    && c.labelId.toLowerCase().includes(q)) ||
          (c.materialCode && c.materialCode.toLowerCase().includes(q)) ||
          (c.materialName && c.materialName.toLowerCase().includes(q)) ||
          (c.lotNo      && c.lotNo.toLowerCase().includes(q)),
      );
    }
    return [...result].sort((a, b) => {
      if (!a.inTime) return 1;
      if (!b.inTime) return -1;
      return a.inTime.localeCompare(b.inTime);
    });
  }, [rackCells, alertFilter, query]);

  /* ── 操作函数 ── */
  function flash(msg: string, ok = true) {
    setFeedback({ ok, msg });
    setTimeout(() => setFeedback(null), 3500);
  }

  function toggleSelect(labelId: string) {
    if (!labelId) return;
    setSelectedCells((prev) => {
      const next = new Set(prev);
      next.has(labelId) ? next.delete(labelId) : next.add(labelId);
      return next;
    });
  }

  const handleRefresh = useCallback(async () => {
    await loadRackCells();
    flash((t("common.refreshed", locale) as string) ?? "已刷新");
  }, [loadRackCells, locale]);

  const handleShelfIn = async () => {
    const label = scanInput.trim();
    if (!label) return;
    setLoading(true);
    try {
      // Parse optional materialCode from label (format: L001A-01 → cellNumber=01)
      const parts = label.split("-");
      const cellNumber = parts.length >= 2 ? parts[parts.length - 1] : undefined;
      const res = await shelfIn({ shelfCode: activeRack, cellNumber, labelId: label });
      if (res.success) {
        flash(`${label} · ${t("wms.shelfInSuccess", locale)}`);
        setScanInput("");
        await loadRackCells();
      } else {
        flash(res.error ?? res.Message ?? "Failed", false);
      }
    } catch (e) { flash(String(e), false); }
    finally { setLoading(false); }
  };

  const handleShelfOut = async () => {
    const selected = Array.from(selectedCells);
    if (!selected.length) { flash(t("wms.selectCellFirst", locale) as string, false); return; }
    setLoading(true);
    try {
      let allOk = true;
      for (const labelId of selected) {
        const res = await shelfOut({ labelId });
        if (!res.success) { allOk = false; flash(`${labelId}: ${res.error}`, false); break; }
      }
      if (allOk) {
        flash(selected.join(", ") + " · " + (t("wms.shelfOutSuccess", locale) as string));
        setSelectedCells(new Set());
        await loadRackCells();
      }
    } catch (e) { flash(String(e), false); }
    finally { setLoading(false); }
  };

  const handleRemoveLabel = async (labelId: string) => {
    // Remove = rack-out + clear from inventory (not implemented separately — use rack-out)
    setLoading(true);
    try {
      const res = await shelfOut({ labelId });
      if (res.success) {
        flash(`${labelId} · ${t("wms.labelRemoved", locale)}`);
        await loadRackCells();
      } else {
        flash(res.error ?? "Failed", false);
      }
    } catch (e) { flash(String(e), false); }
    finally { setLoading(false); }
  };

  const handleLightOn = async () => {
    setLoading(true);
    try {
      const res = await lightEmptyLocations(activeRack, true);
      flash(res.success ? t("wms.emptyLocationsLit", locale) as string : (res.error ?? "Failed"), !!res.success);
    } catch (e) { flash(String(e), false); }
    finally { setLoading(false); }
  };

  const handleLightOff = async () => {
    setLoading(true);
    try {
      const res = await lightEmptyLocations(activeRack, false);
      flash(res.success ? t("wms.ledsTurnedOff", locale) as string : (res.error ?? "Failed"), !!res.success);
    } catch (e) { flash(String(e), false); }
    finally { setLoading(false); }
  };

  /* ── 选中的单个批次明细 ── */
  const detailCell = useMemo(() => {
    if (selectedCells.size !== 1) return null;
    const label = Array.from(selectedCells)[0];
    return cells.find((c) => c.labelId === label) ?? null;
  }, [selectedCells, cells]);

  /* ── 渲染 ── */

  return (
    <div className="screen-stack">
      {/* ── 页面标题 + 告警统计卡片 ── */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.smartRackManager", locale)}</h2>
            <p>{t("wms.smartRackManagerDesc", locale)}</p>
          </div>
          <button type="button" className="action-button"
            style={{ background: "var(--nav)", padding: "4px 8px" }}
            title={t("common.refresh", locale)} onClick={handleRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: t("wms.alert.expired", locale),   value: stats.expired,   color: "#c0392b", bg: "rgba(192,57,43,0.1)" },
            { label: t("wms.alert.redL3", locale),    value: stats.redL3,     color: "#e74c3c", bg: "rgba(231,76,60,0.1)" },
            { label: t("wms.alert.blueL2", locale),  value: stats.blueL2,    color: "#2980b9", bg: "rgba(41,128,185,0.1)" },
            { label: t("wms.alert.yellowL1", locale), value: stats.yellowL1,  color: "#f39c12", bg: "rgba(243,156,18,0.1)" },
            { label: t("wms.alert.normal", locale),   value: stats.normal,    color: "#27ae60", bg: "rgba(39,174,96,0.1)" },
          ].map((s) => (
            <div key={s.label} style={{
              flex: "1 1 100px", padding: "8px 12px", borderRadius: 6,
              background: s.bg, border: `1px solid ${s.color}40`,
            }}>
              <div style={{ fontSize: 11, color: s.color }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
          <div style={{ flex: "1 1 100px", padding: "8px 12px", borderRadius: 6, background: "rgba(231,76,60,0.1)", border: "1px solid #e74c3c40" }}>
            <div style={{ fontSize: 11, color: "#e74c3c" }}>{t("wms.fifoViolation", locale)}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e74c3c" }}>{stats.fifoViol}</div>
          </div>
          <div style={{ flex: "1 1 100px", padding: "8px 12px", borderRadius: 6, background: "rgba(243,156,18,0.1)", border: "1px solid #f39c1240" }}>
            <div style={{ fontSize: 11, color: "#f39c12" }}>{t("wms.lowStock", locale)}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f39c12" }}>{stats.belowMin}</div>
          </div>
          <div style={{ flex: "1 1 100px", padding: "8px 12px", borderRadius: 6, background: "var(--nav)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.empty", locale)}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{stats.emptySlots}</div>
          </div>
        </div>
      </section>

      {/* ── 料架选择 + 操作按钮 ── */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.rackSelection", locale)}</h2>
            <p>{t("wms.selectRackAndOperate", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="field-input" style={{ gap: 4 }}>
              <LayoutGrid size={14} />
              {racks.map((r) => (
                <button key={r} type="button"
                  className={`tab-btn${activeRack === r ? " active" : ""}`}
                  onClick={() => setActiveRack(r)}>
                  {r}
                </button>
              ))}
            </div>
            <button type="button" className="action-button"
              style={{ background: "var(--ok)", padding: "4px 8px" }}
              title={t("wms.lightOnEmpty", locale)} onClick={handleLightOn} disabled={loading}>
              <Lightbulb size={13} />
            </button>
            <button type="button" className="action-button"
              style={{ background: "var(--muted)", padding: "4px 8px" }}
              title={t("wms.lightOff", locale)} onClick={handleLightOff} disabled={loading}>
              <LightbulbOff size={13} />
            </button>
          </div>
        </div>

        {/* 入库扫码 */}
        <div className="scan-input" style={{ marginBottom: 8 }}>
          <ArrowDownToLine size={18} />
          <input value={scanInput} onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleShelfIn()}
            placeholder={t("wms.scanLabelToShelfIn", locale) as string} disabled={loading} />
          <button type="button" className="action-button"
            disabled={loading || !scanInput.trim()} onClick={handleShelfIn}>
            <ArrowDownToLine size={14} />{t("wms.shelfIn", locale)}
          </button>
        </div>

        {/* 出库按钮 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button type="button" className="action-button"
            style={{ background: "var(--warning-bg)", color: "var(--warning)", padding: "4px 10px" }}
            disabled={loading || !selectedCells.size} onClick={handleShelfOut}>
            <ArrowUpFromLine size={13} />
            {t("wms.shelfOut", locale)}{selectedCells.size > 0 ? ` (${selectedCells.size})` : ""}
          </button>
          {selectedCells.size > 0 && (
            <button type="button" className="action-button"
              style={{ background: "var(--danger-bg)", color: "var(--danger)", padding: "4px 8px" }}
              onClick={() => setSelectedCells(new Set())}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* 告警过滤 */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.filterByAlert", locale)}:</span>
          {(["ALL", "EXPIRED", "RED_L3", "BLUE_L2", "YELLOW_L1", "NORMAL"] as const).map((f) => (
            <button key={f} type="button"
              className={`tab-btn${alertFilter === f ? " active" : ""}`}
              style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={() => setAlertFilter(f)}>
              {f === "ALL" ? t("common.all", locale) : (t(`wms.alert.${f.toLowerCase().replace("_", "")}`, locale as any) as string ?? f)}
            </button>
          ))}
        </div>

        {feedback && (
          <div style={{
            marginTop: 8, padding: "6px 12px", borderRadius: 6,
            background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
            color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {feedback.msg}
          </div>
        )}
      </section>

      {/* ── AI 助手（可折叠）── */}
      <SmartRackAiChat locale={locale} cells={cells} stats={stats} />

      {/* ── 物料列表 ── */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.materialOnRack", locale)} · {activeRack}</h2>
            <p>{t("wms.rackContent", locale)}</p>
          </div>
          <div className="page-tools">
            <div className="field-input">
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t("scan.placeholder", locale)}
                title={t("ui.searchInput", locale)} />
              {query && (
                <button type="button" onClick={() => setQuery("")}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>{t("common.location", locale)}</th>
                <th>{t("wms.fifoOrder", locale)}</th>
                <th>{t("common.label", locale)}</th>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.name", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("wms.minStock", locale)}</th>
                <th>{t("wms.expiryDate", locale)}</th>
                <th>{t("wms.remainingDays", locale)}</th>
                <th>{t("wms.alertStatus", locale)}</th>
                <th>{t("wms.fifoStatus", locale)}</th>
                <th>{t("common.action", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 ? (
                <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                  {t("common.loading", locale)}
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                  {t("common.noData", locale)}
                </td></tr>
              ) : (
                filtered.map((cell) => {
                  const isLowStock = cell.minStock > 0 && cell.qty < cell.minStock;
                  const isFifoViolation = cell.fifoViolation;
                  return (
                    <tr key={cell.locationCode}
                      className={selectedCells.has(cell.labelId) ? "row-selected" : ""}
                      style={isFifoViolation ? { background: "rgba(231,76,60,0.04)" } : undefined}
                    >
                      <td>
                        {cell.labelId && (
                          <input type="checkbox"
                            checked={selectedCells.has(cell.labelId)}
                            onChange={() => toggleSelect(cell.labelId)} />
                        )}
                      </td>
                      <td><code style={{ fontSize: 12 }}>{cell.locationCode}</code></td>
                      <td>
                        {cell.fifoOrder ? (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>#{cell.fifoOrder}</span>
                        ) : "—"}
                      </td>
                      <td>
                        {cell.labelId ? (
                          <span style={{ fontFamily: "monospace", fontSize: 11 }}>{cell.labelId}</span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 12 }}>
                            {t("wms.emptyCell", locale)}
                          </span>
                        )}
                      </td>
                      <td>
                        {cell.materialCode ? <strong style={{ fontSize: 12 }}>{cell.materialCode}</strong> : "—"}
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 11 }}>
                        {cell.materialName || "—"}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{cell.qty > 0 ? cell.qty.toLocaleString() : "—"}</span>
                        {isLowStock && (
                          <span style={{ marginLeft: 4 }} title={t("wms.lowStockWarning", locale) as string}>
                            <AlertTriangle size={11} color="#f39c12" />
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--muted)" }}>
                        {cell.minStock > 0 ? cell.minStock.toLocaleString() : "—"}
                      </td>
                      <td style={{ fontSize: 11 }}>{cell.expiryDate || "—"}</td>
                      <td><DaysDisplay days={cell.remainingDays} /></td>
                      <td><AlertBadge level={cell.alertLevel} /></td>
                      <td>
                        {isFifoViolation ? (
                          <span style={{ color: "#e74c3c", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                            <ArrowUpDown size={11} />{t("wms.fifoViolation", locale)}
                          </span>
                        ) : cell.fifoOrder ? (
                          <span style={{ color: "var(--ok)", fontSize: 11 }}>✓ {t("wms.fifoOk", locale)}</span>
                        ) : "—"}
                      </td>
                      <td>
                        {cell.labelId && (
                          <button type="button" className="action-button"
                            style={{ background: "var(--danger-bg)", color: "var(--danger)", padding: "3px 6px" }}
                            title={t("wms.removeLabel", locale)}
                            onClick={() => handleRemoveLabel(cell.labelId)} disabled={loading}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 批次明细（选中单个时展示）── */}
      {detailCell && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.lotDetail", locale)} · {detailCell.lotNo ?? detailCell.labelId}</h2>
              <p>{detailCell.materialCode} · {detailCell.materialName}</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {[
              { label: t("common.label", locale),          value: detailCell.labelId },
              { label: t("common.lot", locale),             value: detailCell.lotNo ?? "—" },
              { label: t("common.material", locale),        value: detailCell.materialCode },
              { label: t("common.qty", locale),             value: detailCell.qty > 0 ? detailCell.qty.toLocaleString() : "—" },
              { label: t("wms.minStock", locale),           value: detailCell.minStock > 0 ? detailCell.minStock.toLocaleString() : "—" },
              { label: t("wms.inTime", locale),              value: formatTime(detailCell.inTime) },
              { label: t("wms.expiryDate", locale),         value: detailCell.expiryDate ?? "—" },
              { label: t("wms.remainingDays", locale),      value: detailCell.remainingDays !== null && detailCell.remainingDays !== undefined ? `${detailCell.remainingDays} ${t("common.days", locale)}` : "—" },
              { label: t("wms.alertStatus", locale),        value: detailCell.alertLevel ? (t(`wms.alert.${(detailCell.alertLevel as string).toLowerCase().replace("_", "")}`, locale as any) as string ?? detailCell.alertLevel) : "—" },
              { label: t("wms.periodicInspection", locale), value: detailCell.periodicInspectionDue ? (t("common.yes", locale) as string) : (t("common.no", locale) as string) },
            ].map((item) => (
              <div key={item.label} style={{ padding: "8px 12px", background: "var(--nav)", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.label}</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
// @ts-nocheck
