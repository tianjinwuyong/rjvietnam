/**
 * WmsInboundOrders — 入库单管理
 * DRAFT → SUBMITTED → APPROVED → EXECUTING → COMPLETED
 */
import { useState, useEffect, useCallback } from "react";
import { Plus, Eye, Edit2, Trash2, CheckCircle, XCircle, Play, CheckSquare } from "lucide-react";
import { docApi, type DocListItem } from "../api/wms";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#95a5a6", SUBMITTED: "#3498db", APPROVED: "#27ae60",
  EXECUTING: "#f39c12", COMPLETED: "#2ecc71", REJECTED: "#e74c3c", CANCELLED: "#7f8c8d",
};

export function WmsInboundOrders({ locale = "zh-CN" }: { locale?: Locale } = {}) {
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await docApi.inbound.list({ status: statusFilter || undefined, pageSize: 50 });
      setItems(res.items);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [statusFilter, refreshKey]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const doAction = async (id: number, verb: string) => {
    try {
      switch (verb) {
        case "submit":   await docApi.inbound.submit(id); break;
        case "approve":  await docApi.inbound.approve(id); break;
        case "reject":   await docApi.inbound.reject(id); break;
        case "execute":  await docApi.inbound.execute(id); break;
        case "complete": await docApi.inbound.complete(id); break;
        case "cancel":   await docApi.inbound.cancel(id); break;
      }
      setRefreshKey(k => k + 1);
    } catch (e) { alert(`${verb} failed: ${e instanceof Error ? e.message : e}`); }
  };

  const doDelete = async (id: number) => {
    if (!confirm("Delete this DRAFT document?")) return;
    try { await docApi.inbound.delete(id); setRefreshKey(k => k + 1); }
    catch (e) { alert(`Delete failed: ${e instanceof Error ? e.message : e}`); }
  };

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd" }}>
          <option value="">全部状态</option>
          {["DRAFT","SUBMITTED","APPROVED","EXECUTING","COMPLETED","REJECTED","CANCELLED"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ color: "#666", fontSize: 13, alignSelf: "center" }}>共 {items.length} 条</span>
      </div>
      {loading ? <div>加载中...</div> : error ? <div style={{ color: "#e74c3c" }}>{error}</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {[locale === 'zh-CN' ? '单据号' : locale === 'vi-VN' ? 'Số đơn' : 'Doc No.', locale === 'zh-CN' ? '状态' : locale === 'vi-VN' ? 'Trạng thái' : 'Status', locale === 'zh-CN' ? '创建时间' : locale === 'vi-VN' ? 'TG tạo' : 'Created'].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left" }}>{h}</th>)}
              <th style={{ padding: "8px 12px", textAlign: "left" }}>{locale === 'zh-CN' ? '操作' : locale === 'vi-VN' ? 'Thao tác' : 'Action'}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{item.doc_no}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ background: STATUS_COLORS[item.status] ?? "#999", color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 12 }}>{item.status}</span>
                </td>
                <td style={{ padding: "8px 12px", color: "#666" }}>{new Date(item.created_at).toLocaleString()}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  {item.status === "DRAFT" && <>
                    <button onClick={() => doAction(item.id, "submit")} title={locale === 'zh-CN' ? '提交' : locale === 'vi-VN' ? 'Gửi' : 'Submit'} style={{ background: "none", border: "none", cursor: "pointer", color: "#3498db" }}><CheckCircle size={16}/></button>
                    <button onClick={() => doDelete(item.id)} title={locale === 'zh-CN' ? '删除' : locale === 'vi-VN' ? 'Xóa' : 'Delete'} style={{ background: "none", border: "none", cursor: "pointer", color: "#e74c3c" }}><Trash2 size={16}/></button>
                  </>}
                  {item.status === "SUBMITTED" && <>
                    <button onClick={() => doAction(item.id, "approve")} title={locale === 'zh-CN' ? '批准' : locale === 'vi-VN' ? 'Phê duyệt' : 'Approve'} style={{ background: "none", border: "none", cursor: "pointer", color: "#27ae60" }}><CheckSquare size={16}/></button>
                    <button onClick={() => doAction(item.id, "reject")} title={locale === 'zh-CN' ? '拒绝' : locale === 'vi-VN' ? 'Từ chối' : 'Reject'} style={{ background: "none", border: "none", cursor: "pointer", color: "#e74c3c" }}><XCircle size={16}/></button>
                  </>}
                  {item.status === "APPROVED" && <>
                    <button onClick={() => doAction(item.id, "execute")} title={locale === 'zh-CN' ? '执行' : locale === 'vi-VN' ? 'Thực hiện' : 'Execute'} style={{ background: "none", border: "none", cursor: "pointer", color: "#f39c12" }}><Play size={16}/></button>
                  </>}
                  {item.status === "EXECUTING" && <>
                    <button onClick={() => doAction(item.id, "complete")} title={locale === 'zh-CN' ? '完成' : locale === 'vi-VN' ? 'Hoàn thành' : 'Complete'} style={{ background: "none", border: "none", cursor: "pointer", color: "#2ecc71" }}><CheckSquare size={16}/></button>
                  </>}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#999" }}>{locale === 'zh-CN' ? '暂无数据' : locale === 'vi-VN' ? 'Không có dữ liệu' : 'No data'}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
