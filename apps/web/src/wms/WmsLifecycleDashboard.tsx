/**
 * WmsLifecycleDashboard — 物料有效期管控台账（主入口）
 *
 * 仓库电子元器件寿命管参考 Excel 的 5 个 Sheet 全部集成于此：
 *   Sheet1 物料有效期管控台账（主Tab：台账）
 *   Sheet2 物料近效期预警清单     （子Tab：近效期预警）
 *   Sheet3 超期物料复检测试报告     （子Tab：复检报告）
 *   Sheet4 物料开封日期登记记录表   （子Tab：开封记录）
 *   Sheet5 过期物料隔离报废申请单   （子Tab：报废申请）
 *
 * Routing: case "lifecycle" → WmsLifecycleDashboard（不变）
 */

import { useState, useEffect, useCallback } from "react";
import { wmsApi } from "../api/wms";
import type { LifecycleAlertAction, LifecycleReinspection, LifecycleOpening, LifecycleScrapping, LifecycleLot } from "../api/wms";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { WmsLifecycleAlerts } from "./WmsLifecycleAlerts";
import { WmsLifecycleReinspection } from "./WmsLifecycleReinspection";
import { WmsLifecycleOpenings } from "./WmsLifecycleOpenings";
import { WmsLifecycleScrapping } from "./WmsLifecycleScrapping";
import { WmsLifecycleExempt } from "./WmsLifecycleExempt";

// API base — resolved from VITE_API_BASE env or defaults to factory address
const API = (() => {
  // In dev: VITE_API_BASE overrides; in prod: relative to current origin
  const env = (import.meta as any).env;
  const override = env?.VITE_API_BASE;
  if (override) return override.replace(/\/$/, "");
  // Browser deployments use the current host; test/SSR environments use the
  // local MES API without assuming that `window` exists.
  if (typeof window === "undefined") return "http://localhost:8080";
  return window.location.protocol + "//" + window.location.hostname + ":8080";
})();

// ── Types (Sheet1 inline) ───────────────────────────────────────────────────────

interface AlertSummary { expired: number; red_l3: number; blue_l2: number; yellow_l1: number; normal: number; total: number; }

type LifecycleSubTab = "account" | "alerts" | "reinspection" | "openings" | "scrapping" | "exempt";

const SUB_TABS: { key: LifecycleSubTab; label: string }[] = [
  { key: "account",      label: "① 台账" },
  { key: "alerts",      label: "② 预警清单" },
  { key: "reinspection", label: "③ 复检报告" },
  { key: "openings",     label: "④ 开封记录" },
  { key: "scrapping",    label: "⑤ 报废申请" },
  { key: "exempt",       label: "⑥ 免检物料" },
];

// ── Sub-components (Sheet1 inline) ─────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: "#fff", borderRadius: 8, padding: "16px 20px", border: `3px solid ${color ?? "#e0e0e0"}`, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "#333", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AlertBadge({ level, label }: { level: string | null; label: string | null }) {
  if (!level || !label) return <span style={{ color: "#999" }}>—</span>;
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    EXPIRED:   { label: "超期隔离",     color: "#fff", bg: "#c0392b" },
    RED_L3:    { label: "三级预警(红)", color: "#fff", bg: "#e74c3c" },
    BLUE_L2:   { label: "二级预警(蓝)", color: "#fff", bg: "#2980b9" },
    YELLOW_L1: { label: "一级预警(黄)", color: "#000", bg: "#f39c12" },
    NORMAL:    { label: "正常在用",     color: "#fff", bg: "#27ae60" },
  };
  const c = cfg[level] ?? cfg.NORMAL;
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, color: c.color, background: c.bg }}>{c.label}</span>;
}

function DaysDisplay({ days }: { days: number | null }) {
  if (days === null) return <span style={{ color: "#999" }}>—</span>;
  if (days <= 0) return <span style={{ color: "#c0392b", fontWeight: 700 }}>已超期{Math.abs(days)}天</span>;
  return <span style={{ color: days <= 30 ? "#e74c3c" : days <= 90 ? "#2980b9" : "#27ae60", fontWeight: 600 }}>{days}天</span>;
}

const LEVEL_ORDER = ["ALL", "EXPIRED", "RED_L3", "BLUE_L2", "YELLOW_L1", "NORMAL"] as const;
type FilterLevel = typeof LEVEL_ORDER[number];

// ── Sheet1 Table (inline as account tab) ───────────────────────────────────────

function Sheet1Table({ permissions }: { permissions: string[] }) {
  const [lots, setLots] = useState<LifecycleLot[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterLevel>("ALL");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof wmsApi.getLifecycleLots>[0] = { limit: 200 };
      if (filter !== "ALL") params.alert = filter;
      const [lots, summary] = await Promise.all([
        wmsApi.getLifecycleLots(params),
        wmsApi.getLifecycleSummary(),
      ]);
      setLots(lots ?? []);
      const sr = summary as { success: boolean; data: {
        expired: number | string; red_l3: number | string; blue_l2: number | string;
        yellow_l1: number | string; normal: number | string; total: number | string;
      } };
      setSummary(sr.data ? {
        expired: Number(sr.data.expired),
        red_l3: Number(sr.data.red_l3),
        blue_l2: Number(sr.data.blue_l2),
        yellow_l1: Number(sr.data.yellow_l1),
        normal: Number(sr.data.normal),
        total: Number(sr.data.total),
      } : null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter, refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = search
    ? lots.filter(l =>
        (l.lotNo ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (l.materialCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (l.materialNameZh ?? "").includes(search),
      )
    : lots;

  const countFor = (lvl: FilterLevel) =>
    lvl === "ALL" ? summary?.total
    : lvl === "EXPIRED" ? summary?.expired
    : lvl === "RED_L3" ? summary?.red_l3
    : lvl === "BLUE_L2" ? summary?.blue_l2
    : lvl === "YELLOW_L1" ? summary?.yellow_l1
    : summary?.normal;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {summary && (
        <div style={{ display: "flex", gap: 12 }}>
          <KpiCard label="总批次" value={summary.total} sub="全部物料批次" color="#2c3e50" />
          <KpiCard label="超期隔离" value={summary.expired} sub="剩余天数 ≤ 0" color="#c0392b" />
          <KpiCard label="三级预警(红)" value={summary.red_l3} sub="剩余 1–30 天" color="#e74c3c" />
          <KpiCard label="二级预警(蓝)" value={summary.blue_l2} sub="剩余 31–90 天" color="#2980b9" />
          <KpiCard label="一级预警(黄)" value={summary.yellow_l1} sub="剩余 91–180 天" color="#f39c12" />
          <KpiCard label="正常在用" value={summary.normal} sub="剩余 > 180 天" color="#27ae60" />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {LEVEL_ORDER.map(lvl => {
          const active = filter === lvl;
          const cfg = lvl !== "ALL" ? {
            EXPIRED: { bg: "#c0392b" }, RED_L3: { bg: "#e74c3c" },
            BLUE_L2: { bg: "#2980b9" }, YELLOW_L1: { bg: "#f39c12" }, NORMAL: { bg: "#27ae60" },
          }[lvl] : null;
          return (
            <button key={lvl} onClick={() => setFilter(lvl)} style={{
              padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 400,
              background: active ? (cfg?.bg ?? "#2c3e50") : cfg ? `${cfg.bg}22` : "#f0f0f0",
              color: active ? "#fff" : (cfg?.bg ?? "#555"),
            }}>{lvl === "ALL" ? "全部" : ({
              EXPIRED: "超期隔离", RED_L3: "三级预警(红)", BLUE_L2: "二级预警(蓝)",
              YELLOW_L1: "一级预警(黄)", NORMAL: "正常在用",
            }[lvl])} ({countFor(lvl) ?? "—"})</button>
          );
        })}
      </div>

      <input type="text" placeholder="搜索 批次号 / 物料编码 / 物料名称…" value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box" }} />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => {
            const params = new URLSearchParams();
            if (filter !== "ALL") params.set("alert", filter);
            if (search) params.set("lotNo", search);
            window.open(`${API}/api/lifecycle/export?${params.toString()}`, "_blank");
          }}
          style={{ padding: "7px 16px", background: "#2c7a4b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
        >
          📥 导出Excel
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>加载中…</div>
         : error ? <div style={{ padding: 40, textAlign: "center", color: "#c0392b" }}>
            <div>加载失败: {error}</div>
            <button onClick={() => setRefreshKey(k => k + 1)} style={{ marginTop: 12, padding: "6px 20px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>重试</button>
          </div>
         : filtered.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#888" }}>{search ? "无匹配结果" : "暂无数据"}</div>
         : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                  {["批次号","物料编码","物料名称","物料类型","生产日期","封存有效期(月)","到期日期","库存","剩余天数","状态"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600, color: "#555" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lot, i) => (
                  <tr key={lot.id} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600 }}>{lot.lotNo ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.materialCode ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{lot.materialNameZh ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#666", fontSize: 12 }}>{lot.materialType ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.manufacturingDate ? String(lot.manufacturingDate).slice(0, 10) : "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>{lot.shelfLifeMonths ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.expiryDate ? String(lot.expiryDate).slice(0, 10) : "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>{lot.qty ?? 0}</td>
                    <td style={{ padding: "8px 12px" }}><DaysDisplay days={lot.remainingDays} /></td>
                    <td style={{ padding: "8px 12px" }}><AlertBadge level={lot.alertLevel} label={lot.statusLabel} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#bbb", textAlign: "right" }}>
        公式: 到期日期 = 生产日期 + 封存有效期(月) · 剩余天数 = 到期日期 − TODAY() · 预警: ≤0超期 / ≤30红 / ≤90蓝 / ≤180黄 / &gt;180正常
      </div>
    </div>
  );
}

// ── Main Container ─────────────────────────────────────────────────────────────

export function WmsLifecycleDashboard({ permissions, locale }: { permissions: string[]; locale: Locale }) {
  const [subTab, setSubTab] = useState<LifecycleSubTab>("account");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 32px" }}>
      {/* Page header */}
      <div style={{ padding: "20px 24px 0" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>物料有效期管控台账</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>
          仓库电子元器件寿命管参考 · 5 Sheet 完整集成 · 数据来源: PostgreSQL v_material_lifecycle
        </p>
      </div>

      {/* Sub-tab navigation */}
      <div style={{ display: "flex", gap: 0, padding: "16px 24px 0", borderBottom: "2px solid #e0e0e0" }}>
        {SUB_TABS.map(tab => {
          const active = subTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setSubTab(tab.key)} style={{
              padding: "8px 18px", border: "none", borderBottom: active ? "3px solid #2c3e50" : "3px solid transparent",
              background: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 400,
              color: active ? "#2c3e50" : "#888", marginBottom: -2,
            }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ padding: "20px 24px 0" }}>
        {subTab === "account"      && <Sheet1Table permissions={permissions} />}
        {subTab === "alerts"       && <WmsLifecycleAlerts permissions={permissions} locale={locale} />}
        {subTab === "reinspection" && <WmsLifecycleReinspection permissions={permissions} locale={locale} />}
        {subTab === "openings"     && <WmsLifecycleOpenings permissions={permissions} locale={locale} />}
        {subTab === "scrapping"    && <WmsLifecycleScrapping permissions={permissions} locale={locale} />}
        {subTab === "exempt"       && <WmsLifecycleExempt permissions={permissions} locale={locale} />}
      </div>
    </div>
  );
}
// @ts-nocheck
