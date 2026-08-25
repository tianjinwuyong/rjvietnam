import { useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { Fixture, FixtureUsageLog, FixtureCleaningRecord } from "../api/maintenance";

interface Props { locale: Locale; }

const FIXTURE_TYPE_MAP: Record<string, { label: string; icon: string }> = {
  fct_jig: { label: "FCT治具", icon: "🔌" }, ict_jig: { label: "ICT治具", icon: "🔍" },
  wave_pallet: { label: "波峰焊载具", icon: "🌊" }, burnin_rack: { label: "老化架", icon: "🔥" },
  ultrasonic_horn: { label: "超声波模具", icon: "📡" }, test_fixture: { label: "测试治具", icon: "🧪" },
  assembly_jig: { label: "组装治具", icon: "🔧" }, solder_stencil: { label: "钢网", icon: "🪟" },
  general: { label: "通用", icon: "📦" },
};
const USAGE_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  available: { label: "可用", cls: "badge-ok" }, in_use: { label: "使用中", cls: "badge-info" },
  cleaning: { label: "清洁中", cls: "badge-warning" }, maintenance: { label: "维护中", cls: "badge-warning" },
  calibration: { label: "校准中", cls: "badge-info" }, retired: { label: "报废", cls: "badge-muted" },
};
const CAL_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  valid: { label: "有效", cls: "badge-ok" }, expiring: { label: "即将到期", cls: "badge-warning" },
  expired: { label: "已过期", cls: "badge-danger" }, na: { label: "免校准", cls: "badge-muted" },
};

function UsageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden", minWidth: 50 }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 32, textAlign: "right" }}>{Math.round(pct)}%</span>
    </div>
  );
}

export function FixtureManagement({ locale }: Props) {
  const [items, setItems] = useState<Fixture[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState<Fixture | null>(null);
  const [logs, setLogs] = useState<FixtureUsageLog[]>([]);
  const [cleanRecords, setCleanRecords] = useState<FixtureCleaningRecord[]>([]);
  const [detailTab, setDetailTab] = useState<"info" | "logs" | "cleaning">("info");

  const fetch = useCallback(() => {
    setLoading(true);
    maintenanceApi.getFixtures({
      fixtureType: typeFilter === "all" ? undefined : typeFilter,
      usageStatus: statusFilter === "all" ? undefined : statusFilter,
      search: search || undefined, limit: 100,
    }).then((r: any) => { setItems(r?.data ?? []); setTotal(r?.total ?? 0); setLoading(false); }).catch(() => setLoading(false));
  }, [typeFilter, statusFilter, search]);

  useEffect(() => { fetch(); }, [fetch]);

  const openDetail = (item: Fixture) => {
    setSelected(item);
    setDetailTab("info");
    maintenanceApi.getFixtureLogs(item.id).then((r: any) => setLogs(r?.data ?? [])).catch(() => {});
    maintenanceApi.getFixtureCleaningRecords(item.id).then((r: any) => setCleanRecords(r?.data ?? [])).catch(() => {});
  };

  const doAction = (action: string) => {
    if (!selected) return;
    maintenanceApi.fixtureAction(selected.id, { action, operatorName: "Operator" }).then(() => {
      fetch();
      openDetail(selected);
    }).catch(() => {});
  };

  const doClean = () => {
    if (!selected) return;
    maintenanceApi.cleanFixture(selected.id, { cleaningType: "routine", result: "pass" }).then(() => {
      fetch();
      openDetail(selected);
    }).catch(() => {});
  };

  const types = ["all", ...Object.keys(FIXTURE_TYPE_MAP)];
  const statuses = ["all", "available", "in_use", "cleaning", "maintenance", "calibration"];

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div><h2>治具管理</h2><p style={{ fontSize: 12, color: "var(--muted)" }}>{total} 套 · 使用次数+清洁+校准+定置</p></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === "Enter" && setSearch(searchInput)}
              placeholder="搜索编号/名称/产品..." style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, width: 170 }} />
            <button className="btn btn-sm" onClick={() => setSearch(searchInput)} style={{ fontSize: 12 }}>搜索</button>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 6, padding: "4px 16px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>类型:</span>
          {types.map(tp => (
            <button key={tp} className={`badge ${typeFilter === tp ? "badge-info" : "badge-muted"}`} style={{ cursor: "pointer", border: "none", fontSize: 10, padding: "2px 6px" }}
              onClick={() => setTypeFilter(tp)}>{tp === "all" ? "全部" : `${FIXTURE_TYPE_MAP[tp]?.icon ?? ""} ${FIXTURE_TYPE_MAP[tp]?.label ?? tp}`}</button>
          ))}
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>状态:</span>
          {statuses.map(s => (
            <button key={s} className={`badge ${statusFilter === s ? "badge-info" : "badge-muted"}`} style={{ cursor: "pointer", border: "none", fontSize: 10, padding: "2px 6px" }}
              onClick={() => setStatusFilter(s)}>{s === "all" ? "全部" : USAGE_STATUS_MAP[s]?.label ?? s}</button>
          ))}
        </div>
      </div>

      <section className="surface-panel">
        {loading ? <div style={{ padding: 24 }}><div className="skeleton" style={{ height: 200, width: "100%" }} /></div> : (
          <div className="table-shell"><table>
            <thead><tr>
              <th>编号</th><th>名称</th><th>类型</th><th>产品</th>
              <th>使用次数</th><th>寿命</th><th>清洁</th><th>校准</th>
              <th>定置位置</th><th>状态</th>
            </tr></thead>
            <tbody>
              {items.map(fx => {
                const tp = FIXTURE_TYPE_MAP[fx.fixture_type] ?? { label: fx.fixture_type, icon: "📦" };
                const us = USAGE_STATUS_MAP[fx.usage_status] ?? { label: fx.usage_status, cls: "badge-muted" };
                const cs = CAL_STATUS_MAP[fx.calibration_status] ?? { label: fx.calibration_status, cls: "badge-muted" };
                const needsClean = fx.cleaning_interval_uses ? fx.uses_since_cleaning >= fx.cleaning_interval_uses : false;
                return (
                  <tr key={fx.id} style={{ cursor: "pointer" }} onClick={() => openDetail(fx)}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{fx.fixture_code}</td>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{fx.name_zh}</td>
                    <td><span className="badge badge-muted" style={{ fontSize: 10 }}>{tp.icon} {tp.label}</span></td>
                    <td style={{ fontSize: 11 }}>{fx.product_name ?? fx.product_code ?? "-"}</td>
                    <td style={{ fontSize: 12, textAlign: "right" }}>
                      {fx.current_usage_count.toLocaleString()}
                      {fx.max_usage_count ? <span style={{ fontSize: 10, color: "var(--muted)" }}>/{(fx.max_usage_count / 1000).toFixed(0)}K</span> : null}
                    </td>
                    <td style={{ minWidth: 80 }}>{fx.max_usage_count ? <UsageBar pct={Number(fx.usage_percentage)} /> : "-"}</td>
                    <td style={{ textAlign: "center" }}>
                      {needsClean ? <span className="badge badge-warning" style={{ fontSize: 9 }}>需清洁</span> :
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{fx.uses_since_cleaning}/{fx.cleaning_interval_uses ?? "-"}</span>}
                    </td>
                    <td><span className={`badge ${cs.cls}`} style={{ fontSize: 9 }}>{cs.label}</span></td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{fx.storage_location ?? "-"}</td>
                    <td><span className={`badge ${us.cls}`}>{us.label}</span></td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无数据</td></tr>}
            </tbody>
          </table></div>
        )}
      </section>

      {/* Detail Modal */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setSelected(null)}>
          <div className="surface-panel" style={{ width: 700, maxHeight: "85vh", overflow: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ fontSize: 15 }}>{selected.name_zh} <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{selected.fixture_code}</span></h3>
              <button className="btn btn-sm" onClick={() => setSelected(null)}>✕</button>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {selected.usage_status === "available" && <button className="btn btn-sm btn-primary" style={{ fontSize: 11 }} onClick={() => doAction("checkout")}>领用</button>}
              {selected.usage_status === "in_use" && <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => doAction("return")}>归还</button>}
              <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => doAction("use")}>记录使用</button>
              <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={doClean}>记录清洁</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
              {([["info", "基本信息"], ["logs", "使用记录"], ["cleaning", "清洁记录"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setDetailTab(k)} style={{
                  padding: "6px 14px", fontSize: 12, border: "none", cursor: "pointer", background: "transparent",
                  color: detailTab === k ? "var(--primary)" : "var(--muted)",
                  borderBottom: detailTab === k ? "2px solid var(--primary)" : "2px solid transparent",
                  fontWeight: detailTab === k ? 600 : 400,
                }}>{l}</button>
              ))}
            </div>

            {detailTab === "info" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  {[
                    ["类型", FIXTURE_TYPE_MAP[selected.fixture_type]?.label ?? selected.fixture_type],
                    ["产品", selected.product_name ?? selected.product_code ?? "-"],
                    ["设备类型", selected.equipment_type ?? "-"],
                    ["制造商", selected.manufacturer ?? "-"],
                    ["型号", selected.model_no ?? "-"],
                    ["序列号", selected.serial_no ?? "-"],
                    ["存储位置", selected.storage_location ?? "-"],
                    ["当前状态", USAGE_STATUS_MAP[selected.usage_status]?.label ?? selected.usage_status],
                  ].map(([l, v], i) => (
                    <div key={i} style={{ display: "flex", padding: "3px 0", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                      <span style={{ width: 80, color: "var(--muted)" }}>{l}</span><span>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 style={{ fontSize: 12, marginBottom: 6 }}>使用 & 寿命</h4>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>使用次数: {selected.current_usage_count.toLocaleString()}{selected.max_usage_count ? ` / ${selected.max_usage_count.toLocaleString()}` : ""}</div>
                  {selected.max_usage_count ? <UsageBar pct={Number(selected.usage_percentage)} /> : null}
                  <h4 style={{ fontSize: 12, margin: "10px 0 6px" }}>清洁</h4>
                  <div style={{ fontSize: 12 }}>距上次清洁: {selected.uses_since_cleaning} 次 (周期: {selected.cleaning_interval_uses ?? "-"})</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>上次清洁: {selected.last_cleaned_at ? new Date(selected.last_cleaned_at).toLocaleString("zh-CN") : "-"}</div>
                  <h4 style={{ fontSize: 12, margin: "10px 0 6px" }}>校准</h4>
                  <div style={{ fontSize: 12 }}>状态: {CAL_STATUS_MAP[selected.calibration_status]?.label ?? selected.calibration_status}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>上次: {selected.last_calibration_date ?? "-"} | 下次: {selected.next_calibration_date ?? "-"}</div>
                  {selected.calibration_interval_days && <div style={{ fontSize: 11, color: "var(--muted)" }}>周期: {selected.calibration_interval_days}天</div>}
                  <h4 style={{ fontSize: 12, margin: "10px 0 6px" }}>🇻🇳 越南</h4>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>进口交期: {selected.vn_lead_time_days ?? "-"}天 + 清关{selected.customs_clearance_days ?? "-"}天</div>
                  {selected.import_customs_no && <div style={{ fontSize: 11, color: "var(--muted)" }}>报关单: {selected.import_customs_no}</div>}
                </div>
              </div>
            )}

            {detailTab === "logs" && (
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {logs.map(log => (
                  <div key={log.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 11, alignItems: "center" }}>
                    <span style={{ color: "var(--muted)", minWidth: 120 }}>{log.logged_at ? new Date(log.logged_at).toLocaleString("zh-CN") : "-"}</span>
                    <span className={`badge ${log.action === "checkout" ? "badge-info" : log.action === "return" ? "badge-ok" : log.action === "use" ? "badge-warning" : "badge-muted"}`} style={{ fontSize: 9 }}>
                      {log.action === "checkout" ? "领用" : log.action === "return" ? "归还" : log.action === "use" ? "使用" : log.action === "retire" ? "报废" : log.action}
                    </span>
                    <span>+{log.usage_count}次</span>
                    {log.product_code && <span style={{ color: "var(--muted)" }}>{log.product_code}</span>}
                    {log.operator_name && <span style={{ color: "var(--muted)" }}>{log.operator_name}</span>}
                    {log.condition_after !== "good" && <span className="badge badge-warning" style={{ fontSize: 9 }}>{log.condition_after}</span>}
                  </div>
                ))}
                {logs.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", padding: 16, fontSize: 12 }}>暂无记录</div>}
              </div>
            )}

            {detailTab === "cleaning" && (
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {cleanRecords.map(rec => (
                  <div key={rec.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 11, alignItems: "center" }}>
                    <span style={{ color: "var(--muted)", minWidth: 120 }}>{rec.cleaned_at ? new Date(rec.cleaned_at).toLocaleString("zh-CN") : "-"}</span>
                    <span className="badge badge-muted" style={{ fontSize: 9 }}>{rec.cleaning_type === "routine" ? "常规" : rec.cleaning_type === "deep" ? "深度" : rec.cleaning_type}</span>
                    <span>{rec.cleaned_by}</span>
                    <span className={`badge ${rec.result === "pass" ? "badge-ok" : "badge-danger"}`} style={{ fontSize: 9 }}>{rec.result === "pass" ? "合格" : "不合格"}</span>
                    <span style={{ color: "var(--muted)" }}>使用{rec.usage_count_at_cleaning}次时清洁</span>
                  </div>
                ))}
                {cleanRecords.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", padding: 16, fontSize: 12 }}>暂无记录</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
