/**
 * WmsProductionOutbound — 生产出库 / 工单发料
 * 
 * Excel 二级菜单: "生产出入库管理"
 * Tab: productionOutbound
 * 
 * Flow: 工单发料申请 → 仓库确认发料 → 物料从仓库扣减 → 生产领用
 * Data: GET/PUT /api/production/orders + /api/production/material-issue
 */

import { useEffect, useState, useCallback } from "react";
import { Package, Send, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#95a5a6",
  MATERIAL_PENDING: "#f39c12",
  MATERIAL_ISSUED: "#3498db",
  IN_PRODUCTION: "#9b59b6",
  QC_IN_PROGRESS: "#e67e22",
  COMPLETED: "#27ae60",
  CANCELLED: "#e74c3c",
};

const STATUS_LABELS: Record<string, Record<string, string>> = {
  "zh-CN": {
    DRAFT: "草稿",
    MATERIAL_PENDING: "待发料",
    MATERIAL_ISSUED: "已发料",
    IN_PRODUCTION: "生产中",
    QC_IN_PROGRESS: "质检中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
  },
  "vi-VN": {
    DRAFT: "Draft",
    MATERIAL_PENDING: "Cho nhao lieu",
    MATERIAL_ISSUED: "Da nhao lieu",
    IN_PRODUCTION: "Dang SX",
    QC_IN_PROGRESS: "Dang QC",
    COMPLETED: "Hoan thanh",
    CANCELLED: "Da huy",
  },
  "en-US": {
    DRAFT: "Draft",
    MATERIAL_PENDING: "Pending Issue",
    MATERIAL_ISSUED: "Material Issued",
    IN_PRODUCTION: "In Production",
    QC_IN_PROGRESS: "QC In Progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  },
};

interface ProdOrder {
  id: number;
  order_no: string;
  mo_number: string;
  material_code: string;
  material_name: string;
  planned_qty: number;
  output_qty: number;
  status: string;
  work_center: string;
  order_date: string;
}

interface OrderItem {
  id: number;
  production_order_id: number;
  line_no: number;
  material_code: string;
  material_name: string;
  unit_code: string;
  planned_qty: number;
  issued_qty: number;
  consumed_qty: number;
  returned_qty: number;
  scrap_qty: number;
  warehouse_code: string;
  location_code: string;
}

export function WmsProductionOutbound({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<ProdOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<ProdOrder | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [issueQty, setIssueQty] = useState<Record<number, string>>({});
  const [issuing, setIssuing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const labels = STATUS_LABELS[locale] ?? STATUS_LABELS["zh-CN"];

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const url = "http://127.0.0.1:8080/api/production/orders?status=" + (statusFilter || "");
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.items ?? data ?? []);
      }
    } catch {}
    setLoading(false);
  }, [statusFilter, refreshKey]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const openOrder = async (order: ProdOrder) => {
    setSelectedOrder(order);
    setItemsLoading(true);
    setIssueQty({});
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`http://127.0.0.1:8080/api/production/orders/${order.id}/items`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrderItems(data.items ?? data ?? []);
      }
    } catch {}
    setItemsLoading(false);
  };

  const handleIssueAll = async () => {
    if (!selectedOrder) return;
    setIssuing(true);
    try {
      const token = localStorage.getItem("token");
      for (const item of orderItems) {
        const qty = Number(issueQty[item.id] || 0);
        if (qty <= 0) continue;
        await fetch("http://127.0.0.1:8080/api/production/material-issue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            production_order_id: selectedOrder.id,
            order_item_id: item.id,
            material_code: item.material_code,
            quantity: qty,
            warehouse_code: item.warehouse_code || "WH01",
            location_code: item.location_code || null,
            reference_no: selectedOrder.order_no,
          }),
        });
      }
      setRefreshKey((k) => k + 1);
      setSelectedOrder(null);
      setOrderItems([]);
    } catch (e) {
      alert(String(e));
    }
    setIssuing(false);
  };

  const filteredOrders = orders.filter((o) =>
    !statusFilter || o.status === statusFilter
  );

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.productionOutbound", locale)}</h2>
            <p>{locale === "zh-CN" ? "工单发料：仓库向产线发料" : locale === "vi-VN" ? "Nhao lieu: Kho xuat lieu cho day chuyen" : "Material Issue: warehouse to production line"}</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {filteredOrders.length} {
              locale === "zh-CN" ? "条工单" : locale === "vi-VN" ? "lenh" : "orders"
            }
          </div>
        </div>
        <div className="toolbar">
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="">{
              locale === "zh-CN" ? "全部状态" : locale === "vi-VN" ? "Tat ca trang thai" : "All Status"
            }</option>
            {Object.keys(STATUS_COLORS).map((s) => (
              <option key={s} value={s}>{labels[s] ?? s}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{locale === "zh-CN" ? "工单号" : "WO No."}</th>
                <th>{locale === "zh-CN" ? "MO号" : "MO No."}</th>
                <th>{locale === "zh-CN" ? "成品物料" : "Finished Goods"}</th>
                <th>{locale === "zh-CN" ? "状态" : "Status"}</th>
                <th>{locale === "zh-CN" ? "操作" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty-state">{t("common.loading", locale)}</td></tr>
              ) : filteredOrders.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">{t("common.empty", locale)}</td></tr>
              ) : filteredOrders.map((o, idx) => (
                <tr key={o.id} style={{ cursor: "pointer" }}>
                  <td>{idx + 1}</td>
                  <td><code style={{ color: "#e67e22" }}>{o.order_no}</code></td>
                  <td><code>{o.mo_number}</code></td>
                  <td>
                    <strong>{o.material_name || o.material_code}</strong>
                    <br /><code style={{ fontSize: 11, color: "var(--muted)" }}>{o.material_code}</code>
                  </td>
                  <td>
                    <span style={{ color: STATUS_COLORS[o.status] ?? "#999", fontWeight: 600, fontSize: 12 }}>
                      {labels[o.status] ?? o.status}
                    </span>
                  </td>
                  <td>
                    {o.status === "DRAFT" || o.status === "MATERIAL_PENDING" ? (
                      <button
                        className="action-button"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => openOrder(o)}
                      >
                        <Send size={12} style={{ marginRight: 3 }} />
                        {locale === "zh-CN" ? "发料" : locale === "vi-VN" ? "Nhao lieu" : "Issue"}
                      </button>
                    ) : (
                      <button
                        className="secondary-button"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => openOrder(o)}
                      >
                        {locale === "zh-CN" ? "查看" : locale === "vi-VN" ? "Xem" : "View"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Order Items Modal */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => { setSelectedOrder(null); setOrderItems([]); }}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <h3 style={{ marginBottom: 6 }}>
              <Package size={16} style={{ display: "inline", marginRight: 6 }} />
              {selectedOrder.order_no} — {selectedOrder.material_name || selectedOrder.material_code}
            </h3>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
              {locale === "zh-CN" ? "发料明细（计划/已发/剩余）" : "Chi tiet nhao lieu (Ke hoach/Da nhao/Con lai)"}
            </p>

            {itemsLoading ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                {t("common.loading", locale)}
              </div>
            ) : (
              <div className="table-shell" style={{ maxHeight: 360, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{locale === "zh-CN" ? "物料编码" : "Mat. Code"}</th>
                      <th>{locale === "zh-CN" ? "物料名称" : "Mat. Name"}</th>
                      <th>{locale === "zh-CN" ? "计划" : "Planned"}</th>
                      <th>{locale === "zh-CN" ? "已发" : "Issued"}</th>
                      <th>{locale === "zh-CN" ? "剩余" : "Remaining"}</th>
                      <th>{locale === "zh-CN" ? "本次发料" : "This Issue"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderItems.map((item, idx) => {
                      const remaining = Number(item.planned_qty) - Number(item.issued_qty);
                      return (
                        <tr key={item.id}>
                          <td>{idx + 1}</td>
                          <td><code>{item.material_code}</code></td>
                          <td><strong>{item.material_name || item.material_code}</strong></td>
                          <td>{Number(item.planned_qty).toLocaleString()}</td>
                          <td style={{ color: Number(item.issued_qty) > 0 ? "#22c55e" : undefined }}>
                            {Number(item.issued_qty).toLocaleString()}
                          </td>
                          <td style={{ color: remaining > 0 ? "#f59e0b" : "#22c55e", fontWeight: 600 }}>
                            {remaining.toLocaleString()}
                          </td>
                          <td>
                            {remaining > 0 && (
                              <input
                                className="input"
                                type="number"
                                value={issueQty[item.id] || ""}
                                onChange={(e) => setIssueQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                placeholder="0"
                                min="0"
                                max={remaining}
                                style={{ width: 80 }}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="secondary-button" onClick={() => { setSelectedOrder(null); setOrderItems([]); }}>
                {locale === "zh-CN" ? "关闭" : locale === "vi-VN" ? "Dong" : "Close"}
              </button>
              {(selectedOrder.status === "DRAFT" || selectedOrder.status === "MATERIAL_PENDING") && (
                <button
                  className="action-button"
                  onClick={handleIssueAll}
                  disabled={issuing || Object.values(issueQty).every((v) => !v)}
                >
                  {issuing ? (
                    locale === "zh-CN" ? "提交中..." : "Dang gui..."
                  ) : (
                    <>
                      <CheckCircle size={14} style={{ marginRight: 4 }} />
                      {locale === "zh-CN" ? "确认发料" : locale === "vi-VN" ? "Xac nhan nhao" : "Confirm Issue"}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
