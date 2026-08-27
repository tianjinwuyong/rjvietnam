import { useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

export function WmsInventoryControlCenter({ locale }: { locale: Locale }) {
  const en = locale === "en-US";
  const [lots, setLots] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  useEffect(() => {
    Promise.all([wmsApi.getMaterialLots({ limit: 500 }), wmsApi.getStorageLocations({ limit: 500 }), wmsApi.getTransactions({ limit: 500 })])
      .then(([l, s, t]) => { setLots(l.items || []); setLocations(s.items || []); setTransactions(t.items || []); })
      .finally(() => setLoading(false));
  }, []);
  const filtered = useMemo(() => lots.filter(lot => !query || [lot.materialCode, lot.lotNo, lot.labelId, lot.locationCode].some(v => String(v || "").toLowerCase().includes(query.toLowerCase()))), [lots, query]);
  const qty = (lot: any) => Number(lot.availableQty ?? lot.qty ?? lot.receivedQty ?? 0);
  const overdue = filtered.filter(lot => lot.receivedAt && Date.now() - new Date(lot.receivedAt).getTime() > 24 * 60 * 60 * 1000 && !["released", "scrapped"].includes(String(lot.iqcStatus || "").toLowerCase())).length;
  const go = (tab: string) => { window.location.href = "/?view=wms&wmsTab=" + tab; };
  if (loading) return <section className="surface-panel"><div className="placeholder-view">{en ? "Loading inventory control center..." : "正在加载库存控制中心..."}</div></section>;
  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header"><div><h2>{en ? "Inventory Control Center" : "库存控制中心"}</h2><p>{en ? "One control view for quantity, position, status, transactions and processing deadlines." : "统一管理数量、位置、状态、交易台账和处理时限。"}</p></div><button className="action-button" onClick={() => go("wms3dFlow")}>{en ? "Open 3D flow" : "打开3D流程"}</button></div>
      <div className="content-grid four">
        <div className="metric-card"><strong>{filtered.length}</strong><span>{en ? "Lots" : "批次数"}</span></div>
        <div className="metric-card"><strong>{filtered.reduce((sum, lot) => sum + qty(lot), 0).toLocaleString()}</strong><span>{en ? "Available quantity" : "可用数量"}</span></div>
        <div className="metric-card"><strong>{locations.length}</strong><span>{en ? "Locations" : "库位数"}</span></div>
        <div className="metric-card"><strong style={{ color: overdue ? "var(--danger)" : "var(--ok)" }}>{overdue}</strong><span>{en ? "SLA overdue" : "超时待处理"}</span></div>
      </div>
      <div className="page-tools" style={{ marginTop: 14 }}><input value={query} onChange={e => setQuery(e.target.value)} placeholder={en ? "Material / batch / label QR / location" : "物料/批次/标签QR/库位"} /><button className="action-button" onClick={() => go("transactions")}>{en ? "Ledger" : "交易台账"}</button><button className="action-button" onClick={() => go("cycleCount")}>{en ? "Cycle count" : "盘点"}</button><button className="action-button" onClick={() => go("transferAdjust")}>{en ? "Transfer / adjust" : "调拨/调整"}</button></div>
    </section>
    <section className="surface-panel"><div className="section-header"><div><h3>{en ? "Quantity by position" : "按库位查看数量"}</h3><p>{en ? "Current lot balance and process status" : "当前批次余额和流程状态"}</p></div><span>{transactions.length} {en ? "ledger entries" : "条台账记录"}</span></div><div className="table-shell"><table><thead><tr><th>{en ? "Material" : "物料"}</th><th>{en ? "Batch" : "批次"}</th><th>{en ? "Quantity" : "数量"}</th><th>{en ? "Location" : "库位"}</th><th>{en ? "Status" : "状态"}</th><th>{en ? "Action" : "操作"}</th></tr></thead><tbody>{filtered.slice(0, 200).map(lot => <tr key={lot.id}><td>{lot.materialCode || "-"}</td><td>{lot.lotNo || "-"}</td><td><strong>{qty(lot).toLocaleString()}</strong></td><td>{lot.locationCode || "-"}</td><td><span className="badge badge-info">{lot.iqcStatus || "PENDING"}</span></td><td><button className="action-button" onClick={() => window.location.href = "/?view=wms&wmsTab=materialTrace&lotNo=" + encodeURIComponent(lot.lotNo || "")}>{en ? "Trace" : "追踪"}</button></td></tr>)}</tbody></table></div></section>
  </div>;
}
