import { useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { Consumable, ConsumableUsageLog } from "../api/maintenance";

interface Props { locale: Locale; }

const CATEGORY_MAP: Record<string, { label: string; icon: string }> = {
  nozzle: { label: "吸嘴", icon: "🔘" }, squeegee: { label: "刮刀", icon: "🔪" },
  stencil: { label: "网板", icon: "🪟" }, solder_paste: { label: "锡膏", icon: "🧪" },
  filter: { label: "滤网", icon: "🕸️" }, belt: { label: "皮带", icon: "⚙️" },
  wiper: { label: "擦拭纸", icon: "🧻" }, blade: { label: "刀片", icon: "🔪" },
  general: { label: "通用", icon: "📦" },
};
const LIFE_STATUS_MAP: Record<string, { label: string; cls: string; color: string }> = {
  new: { label: "新", cls: "badge-info", color: "#3b82f6" },
  in_use: { label: "使用中", cls: "badge-ok", color: "#22c55e" },
  warning: { label: "预警", cls: "badge-warning", color: "#f59e0b" },
  expired: { label: "到期", cls: "badge-danger", color: "#ef4444" },
  replaced: { label: "已更换", cls: "badge-muted", color: "#6b7280" },
};
const TRACKING_LABELS: Record<string, string> = { count: "计数", time: "计时", dual: "双轨" };

function LifeBar({ pct, status }: { pct: number; status: string }) {
  const color = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden", minWidth: 60 }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 36, textAlign: "right" }}>{Math.round(pct)}%</span>
    </div>
  );
}

export function ConsumablesManagement({ locale }: Props) {
  const [items, setItems] = useState<Consumable[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState("all");
  const [lifeFilter, setLifeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState<Consumable | null>(null);
  const [usageLogs, setUsageLogs] = useState<ConsumableUsageLog[]>([]);
  const [showUsageForm, setShowUsageForm] = useState(false);
  const [usageForm, setUsageForm] = useState({ usageCount: 0, usageHours: 0, notes: "" });

  const fetch = useCallback(() => {
    setLoading(true);
    maintenanceApi.getConsumables({
      category: catFilter === "all" ? undefined : catFilter,
      lifeStatus: lifeFilter === "all" ? undefined : lifeFilter,
      search: search || undefined, limit: 100,
    }).then((r: any) => { setItems(r?.data ?? []); setTotal(r?.total ?? 0); setLoading(false); }).catch(() => setLoading(false));
  }, [catFilter, lifeFilter, search]);

  useEffect(() => { fetch(); }, [fetch]);

  const openDetail = (item: Consumable) => {
    setSelected(item);
    maintenanceApi.getConsumableUsageLogs(item.id).then((r: any) => setUsageLogs(r?.data ?? [])).catch(() => {});
  };

  const submitUsage = () => {
    if (!selected) return;
    maintenanceApi.recordConsumableUsage(selected.id, {
      usageType: "increment", usageCount: usageForm.usageCount, usageHours: usageForm.usageHours,
      source: "manual", notes: usageForm.notes,
    }).then(() => {
      setShowUsageForm(false);
      setUsageForm({ usageCount: 0, usageHours: 0, notes: "" });
      fetch();
      openDetail(selected);
    }).catch(() => {});
  };

  const cats = ["all", ...Object.keys(CATEGORY_MAP)];
  const lifeStatuses = ["all", "new", "in_use", "warning", "expired"];

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div><h2>易耗品管理</h2><p style={{ fontSize: 12, color: "var(--muted)" }}>{total} 项 · 计数/计时寿命跟踪</p></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === "Enter" && setSearch(searchInput)}
              placeholder="搜索编号/名称..." style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, width: 160 }} />
            <button className="btn btn-sm" onClick={() => setSearch(searchInput)} style={{ fontSize: 12 }}>搜索</button>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 6, padding: "4px 16px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>类别:</span>
          {cats.map(c => (
            <button key={c} className={`badge ${catFilter === c ? "badge-info" : "badge-muted"}`} style={{ cursor: "pointer", border: "none", fontSize: 10, padding: "2px 6px" }}
              onClick={() => setCatFilter(c)}>{c === "all" ? "全部" : `${CATEGORY_MAP[c]?.icon ?? ""} ${CATEGORY_MAP[c]?.label ?? c}`}</button>
          ))}
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>寿命:</span>
          {lifeStatuses.map(s => (
            <button key={s} className={`badge ${lifeFilter === s ? "badge-info" : "badge-muted"}`} style={{ cursor: "pointer", border: "none", fontSize: 10, padding: "2px 6px" }}
              onClick={() => setLifeFilter(s)}>{s === "all" ? "全部" : LIFE_STATUS_MAP[s]?.label ?? s}</button>
          ))}
        </div>
      </div>

      <section className="surface-panel">
        {loading ? <div style={{ padding: 24 }}><div className="skeleton" style={{ height: 200, width: "100%" }} /></div> : (
          <div className="table-shell"><table>
            <thead><tr>
              <th>编号</th><th>名称</th><th>类别</th><th>跟踪</th><th>规格</th>
              <th>库存</th><th>寿命进度</th><th>寿命状态</th><th>单价</th><th>供应商</th>
            </tr></thead>
            <tbody>
              {items.map(item => {
                const cat = CATEGORY_MAP[item.category] ?? { label: item.category, icon: "📦" };
                const ls = LIFE_STATUS_MAP[item.life_status] ?? { label: item.life_status, cls: "badge-muted", color: "#666" };
                return (
                  <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => openDetail(item)}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{item.item_code}</td>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{item.name_zh}</td>
                    <td><span className="badge badge-muted" style={{ fontSize: 10 }}>{cat.icon} {cat.label}</span></td>
                    <td style={{ fontSize: 11 }}>{TRACKING_LABELS[item.tracking_mode] ?? item.tracking_mode}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.specification ?? "-"}</td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ fontWeight: 600, color: item.current_stock <= item.min_stock ? "#ef4444" : "var(--text)" }}>{item.current_stock}</span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>/{item.min_stock}</span>
                    </td>
                    <td style={{ minWidth: 100 }}>
                      {item.expected_life_count || item.expected_life_hours ? <LifeBar pct={Number(item.life_percentage)} status={item.life_status} /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>-</span>}
                    </td>
                    <td><span className={`badge ${ls.cls}`} style={{ fontSize: 10 }}>{ls.label}</span></td>
                    <td style={{ fontSize: 12, textAlign: "right" }}>${Number(item.unit_cost).toFixed(2)}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{item.supplier ?? "-"}</td>
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
          <div className="surface-panel" style={{ width: 680, maxHeight: "85vh", overflow: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15 }}>{selected.name_zh} <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{selected.item_code}</span></h3>
              <button className="btn btn-sm" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                {[
                  ["类别", CATEGORY_MAP[selected.category]?.label ?? selected.category],
                  ["跟踪模式", TRACKING_LABELS[selected.tracking_mode]],
                  ["设备类型", selected.equipment_type ?? "-"],
                  ["规格", selected.specification ?? "-"],
                  ["制造商", selected.manufacturer ?? "-"],
                  ["库存", `${selected.current_stock} ${selected.unit} (最低${selected.min_stock})`],
                  ["单价", `$${Number(selected.unit_cost).toFixed(2)}`],
                  ["供应商", selected.supplier ?? "-"],
                ].map(([l, v], i) => (
                  <div key={i} style={{ display: "flex", padding: "3px 0", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                    <span style={{ width: 80, color: "var(--muted)" }}>{l}</span><span>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <h4 style={{ fontSize: 12, marginBottom: 6 }}>寿命跟踪</h4>
                {selected.expected_life_count && <div style={{ fontSize: 12, marginBottom: 4 }}>预期寿命: {selected.expected_life_count.toLocaleString()} 次</div>}
                {selected.expected_life_hours && <div style={{ fontSize: 12, marginBottom: 4 }}>预期寿命: {selected.expected_life_hours.toLocaleString()} 小时</div>}
                <div style={{ fontSize: 12, marginBottom: 4 }}>已用: {selected.current_usage_count.toLocaleString()} 次 / {Number(selected.current_usage_hours).toLocaleString()} h</div>
                <LifeBar pct={Number(selected.life_percentage)} status={selected.life_status} />
                {selected.category === "solder_paste" && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                    🌡️ 存储温度: {selected.storage_temp_min}~{selected.storage_temp_max}°C
                    {selected.opened_at && <div>开封时间: {new Date(selected.opened_at).toLocaleString("zh-CN")}</div>}
                    {selected.expiry_after_open_hours && <div>开封后有效期: {selected.expiry_after_open_hours}h</div>}
                  </div>
                )}
                {selected.category === "stencil" && selected.tension_value != null && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                    📐 张力: {selected.tension_value} N/cm (标准: {selected.tension_min}~{selected.tension_max})
                  </div>
                )}
                <button className="btn btn-sm btn-primary" style={{ marginTop: 12, fontSize: 11 }} onClick={() => setShowUsageForm(true)}>+ 记录使用</button>
              </div>
            </div>
            {showUsageForm && (
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 6, marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="number" placeholder="使用次数" value={usageForm.usageCount || ""} onChange={e => setUsageForm(f => ({ ...f, usageCount: Number(e.target.value) }))}
                    style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, width: 100 }} />
                  <input type="number" placeholder="使用小时" value={usageForm.usageHours || ""} onChange={e => setUsageForm(f => ({ ...f, usageHours: Number(e.target.value) }))}
                    style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, width: 100 }} />
                  <input placeholder="备注" value={usageForm.notes} onChange={e => setUsageForm(f => ({ ...f, notes: e.target.value }))}
                    style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, flex: 1 }} />
                  <button className="btn btn-sm btn-primary" onClick={submitUsage} style={{ fontSize: 11 }}>提交</button>
                </div>
              </div>
            )}
            <h4 style={{ fontSize: 12, marginBottom: 6 }}>使用记录 ({usageLogs.length})</h4>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {usageLogs.map(log => (
                <div key={log.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                  <span style={{ color: "var(--muted)" }}>{log.logged_at ? new Date(log.logged_at).toLocaleString("zh-CN") : "-"}</span>
                  <span className="badge badge-muted" style={{ fontSize: 9 }}>{log.usage_type}</span>
                  <span>{log.usage_count > 0 ? `+${log.usage_count}次` : ""}{log.usage_hours > 0 ? ` +${log.usage_hours}h` : ""}</span>
                  <span className={`badge ${log.source === "auto" ? "badge-ok" : "badge-info"}`} style={{ fontSize: 9 }}>{log.source === "auto" ? "MES" : "人工"}</span>
                  <span style={{ color: "var(--muted)" }}>{log.notes}</span>
                </div>
              ))}
              {usageLogs.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", padding: 12, fontSize: 12 }}>暂无记录</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
