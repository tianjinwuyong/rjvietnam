import { useEffect, useState } from "react";
import { Search, History, MapPin, Package } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";
import { WmsMaterialRealtimeFlow } from "./WmsMaterialRealtimeFlow";

type Trace = any;

export function WmsMaterialTraceRoute({ locale }: { locale: Locale }) {
  const initial = new URLSearchParams(window.location.search).get("lotNo") || new URLSearchParams(window.location.search).get("qr") || "";
  const [query, setQuery] = useState(initial);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const search = async () => {
    const value = query.trim();
    if (!value) return;
    setLoading(true); setError("");
    try { const response: any = await wmsApi.getMaterialTrace(value); setTrace(response.data ?? response); }
    catch (err) { setTrace(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (initial) void search(); }, []);
  const movements = trace?.movements ?? [];
  const inspections = trace?.quality?.inspections ?? [];
  return <div className="screen-stack">
    <section className="surface-panel"><div className="section-header"><div><h2><History size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />物料流程追踪</h2><p>输入批次号、物料QR或栈板QR，查看物料在流程图中的当前位置和完整历史。</p></div><div className="toolbar"><div className="scan-input"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void search(); }} placeholder="批次号 / 物料QR / 栈板QR" /></div><button className="action-button" type="button" onClick={() => void search()} disabled={loading}>{loading ? "查询中..." : "追踪"}</button></div></div>{error && <p style={{ color: "var(--danger)" }}>{error}</p>}</section>
    {trace && <><WmsMaterialRealtimeFlow locale={locale} materialCode={trace.materialCode || ""} lotNo={trace.lotNo || query} boxQr={trace.materialQr || trace.palletQr || query} iqcStatus={trace.iqcStatus || trace.quality?.iqcStatus || ""} locationCode={trace.locationCode} approvalCount={trace.quality?.specialApprovals?.length || 0} inspectionCount={inspections.length} />
      <section className="surface-panel"><div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}><div><Package size={14} /> <strong>{trace.materialCode || "-"}</strong><br /><small>{trace.materialName || "-"}</small></div><div><strong>批次</strong><br />{trace.lotNo || "-"}</div><div><MapPin size={14} /> <strong>当前位置</strong><br />{trace.locationCode || "-"}</div><div><strong>可用数量</strong><br />{trace.remainingQty ?? "-"}</div><div><strong>IQC状态</strong><br />{trace.iqcStatus || "-"}</div></div></section>
      <section className="surface-panel"><h3>库存与流程事件</h3><div className="table-shell"><table><thead><tr><th>时间</th><th>动作</th><th>数量</th><th>从</th><th>到</th><th>工单/参考单</th><th>操作员</th></tr></thead><tbody>{movements.length ? movements.map((row: any) => <tr key={row.id || row.txNo}><td>{row.occurredAt ? new Date(row.occurredAt).toLocaleString() : "-"}</td><td>{row.action || "-"}</td><td>{row.qty ?? "-"}</td><td>{row.fromLocation || "-"}</td><td>{row.toLocation || "-"}</td><td>{row.workOrderCode || row.referenceNo || "-"}</td><td>{row.operator || "-"}</td></tr>) : <tr><td colSpan={7}>暂无流程事件</td></tr>}</tbody></table></div></section>
      <section className="surface-panel"><h3>IQC / PDA检验记录</h3><div className="table-shell"><table><thead><tr><th>类型</th><th>结果</th><th>时间</th><th>记录</th></tr></thead><tbody>{[...inspections.map((row: any) => ({ type: "IQC", row })), ...(trace.quality?.pdaInspections || []).map((row: any) => ({ type: "PDA", row }))].length ? [...inspections.map((row: any) => ({ type: "IQC", row })), ...(trace.quality?.pdaInspections || []).map((row: any) => ({ type: "PDA", row }))].map((item: any, index: number) => <tr key={item.row.id || index}><td>{item.type}</td><td>{item.row.result || item.row.status || "-"}</td><td>{item.row.completed_at || item.row.created_at || item.row.scanned_at || "-"}</td><td>{item.row.remark || item.row.note || item.row.inspection_no || "-"}</td></tr>) : <tr><td colSpan={4}>暂无检验记录</td></tr>}</tbody></table></div></section>
    </>}
    {!trace && !error && <section className="surface-panel"><div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>请输入物料标识开始追踪</div></section>}
  </div>;
}
