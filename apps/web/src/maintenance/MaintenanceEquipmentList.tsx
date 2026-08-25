import { useState, useMemo, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { EquipmentAsset, EquipmentCategory } from "../api/maintenance";

interface Props {
  locale: Locale;
  onSelect?: (equipmentId: string) => void;
}

const CRITICALITY_COLORS: Record<string, string> = { A: "#ef4444", B: "#f59e0b", C: "#22c55e" };
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: "运行中", cls: "badge-ok" },
  online: { label: "运行中", cls: "badge-ok" },
  idle: { label: "待机", cls: "badge-info" },
  maintenance: { label: "保养中", cls: "badge-warning" },
  repair: { label: "维修中", cls: "badge-danger" },
  fault: { label: "故障", cls: "badge-danger" },
  offline: { label: "停机", cls: "badge-muted" },
  scrapped: { label: "报废", cls: "badge-muted" },
};

export function MaintenanceEquipmentList({ locale, onSelect }: Props) {
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [critFilter, setCritFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const limit = 30;

  const fetchData = useCallback(() => {
    setLoading(true);
    maintenanceApi.getAssets({
      status: statusFilter === "all" ? undefined : statusFilter,
      criticality: critFilter === "all" ? undefined : critFilter,
      category: catFilter === "all" ? undefined : catFilter,
      search: search || undefined,
      page, limit,
    }).then((res: any) => {
      const d = res?.data ?? res;
      setAssets(Array.isArray(d) ? d : d?.data ?? []);
      setTotal(d?.total ?? (Array.isArray(d) ? d.length : 0));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [statusFilter, critFilter, catFilter, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    maintenanceApi.getEquipmentCategories().then((res: any) => {
      setCategories(res?.data ?? []);
    }).catch(() => {});
  }, []);

  const handleSearch = () => { setSearch(searchInput); setPage(1); };
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const statuses = ["all", "active", "idle", "maintenance", "repair", "fault", "offline", "scrapped"];
  const crits = ["all", "A", "B", "C"];

  if (loading && assets.length === 0) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header"><div><h2>{t("maintenance.subnav.equipment", locale)}</h2></div></div>
          <div className="table-shell"><table><thead><tr>
            {["资产编号","名称","类别","关键度","产线","状态"].map(h => <th key={h}>{h}</th>)}
          </tr></thead><tbody>
            {[1,2,3,4,5,6,7,8].map(i => <tr key={i}>{[80,120,80,40,60,60].map((w,j) => <td key={j}><div className="skeleton" style={{height:14,width:w}}/></td>)}</tr>)}
          </tbody></table></div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("maintenance.subnav.equipment", locale)}</h2>
            <p style={{fontSize:12,color:"var(--muted)"}}>{total} 台设备</p>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="搜索编号/名称/序列号..."
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:13,width:200}} />
            <button className="btn btn-sm btn-primary" onClick={handleSearch} style={{fontSize:12}}>搜索</button>
          </div>
        </div>
        <div className="filter-row" style={{display:"flex",gap:8,padding:"4px 16px",alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:"var(--muted)",minWidth:36}}>状态:</span>
          {statuses.map(s => (
            <button key={s} className={`badge ${statusFilter===s?"badge-info":"badge-muted"}`}
              style={{cursor:"pointer",border:"none",fontSize:11,padding:"2px 8px"}}
              onClick={() => {setStatusFilter(s); setPage(1);}}>
              {s==="all"?"全部":STATUS_MAP[s]?.label??s}
            </button>
          ))}
        </div>
        <div className="filter-row" style={{display:"flex",gap:8,padding:"4px 16px",alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:"var(--muted)",minWidth:36}}>关键:</span>
          {crits.map(c => (
            <button key={c} className={`badge ${critFilter===c?"badge-info":"badge-muted"}`}
              style={{cursor:"pointer",border:"none",fontSize:11,padding:"2px 8px"}}
              onClick={() => {setCritFilter(c); setPage(1);}}>
              {c==="all"?"全部":`${c}级`}
            </button>
          ))}
          <span style={{fontSize:12,color:"var(--muted)",marginLeft:12,minWidth:36}}>类别:</span>
          <select value={catFilter} onChange={e => {setCatFilter(e.target.value); setPage(1);}}
            style={{padding:"3px 8px",borderRadius:4,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:12}}>
            <option value="all">全部类别</option>
            {categories.map(c => <option key={c.id} value={c.code}>{c.name_zh}</option>)}
          </select>
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead><tr>
              <th>资产编号</th><th>设备名称</th><th>类别</th><th>品牌/型号</th>
              <th>关键度</th><th>产线</th><th>序列号</th>
              <th>购入日期</th><th>累计运行(h)</th><th>维修次数</th><th>状态</th>
            </tr></thead>
            <tbody>
              {assets.map(eq => {
                const st = STATUS_MAP[eq.status] ?? { label: eq.status, cls: "badge-muted" };
                return (
                  <tr key={eq.id} style={{cursor:onSelect?"pointer":"default"}} onClick={() => onSelect?.(eq.id)}>
                    <td><strong style={{fontFamily:"monospace",fontSize:12}}>{eq.asset_code}</strong></td>
                    <td>
                      <div style={{fontWeight:500}}>{eq.name_zh}</div>
                      {eq.name_en && <div style={{fontSize:11,color:"var(--muted)"}}>{eq.name_en}</div>}
                    </td>
                    <td><span className="badge badge-muted" style={{fontSize:11}}>{eq.category_zh ?? eq.category_code ?? "-"}</span></td>
                    <td style={{fontSize:12}}>
                      {eq.vendor_name ? <div>{eq.vendor_name}</div> : null}
                      {eq.model_name ? <div style={{color:"var(--muted)",fontSize:11}}>{eq.model_name}</div> : null}
                      {!eq.vendor_name && !eq.model_name ? "-" : null}
                    </td>
                    <td style={{textAlign:"center"}}>
                      <span style={{display:"inline-block",width:22,height:22,lineHeight:"22px",borderRadius:"50%",
                        background:CRITICALITY_COLORS[eq.criticality]??"#666",color:"#fff",fontSize:11,fontWeight:700,textAlign:"center"}}>
                        {eq.criticality}</span>
                    </td>
                    <td style={{fontSize:12}}>{eq.line_code ?? "-"}</td>
                    <td style={{fontSize:11,fontFamily:"monospace",color:"var(--muted)"}}>{eq.serial_no ?? "-"}</td>
                    <td style={{fontSize:12}}>{eq.purchase_date ? eq.purchase_date.slice(0,10) : "-"}</td>
                    <td style={{fontSize:12,textAlign:"right"}}>{eq.cumulative_runtime_hours != null ? Number(eq.cumulative_runtime_hours).toLocaleString() : "-"}</td>
                    <td style={{fontSize:12,textAlign:"center"}}>{eq.total_repair_count ?? 0}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
              {assets.length === 0 && (
                <tr><td colSpan={11} style={{textAlign:"center",color:"var(--muted)",padding:24}}>{t("common.noData", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{display:"flex",justifyContent:"center",gap:8,padding:"12px 0",alignItems:"center"}}>
            <button className="btn btn-sm" disabled={page<=1} onClick={() => setPage(p=>p-1)}>‹</button>
            <span style={{fontSize:12,color:"var(--muted)"}}>{page} / {totalPages}</span>
            <button className="btn btn-sm" disabled={page>=totalPages} onClick={() => setPage(p=>p+1)}>›</button>
          </div>
        )}
      </section>
    </div>
  );
}
