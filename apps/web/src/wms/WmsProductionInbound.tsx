/**
 * WmsProductionInbound — 生产入库管理
 * 
 * Excel 二级菜单: "生产出入库管理"
 * Tab: productionInbound
 * 
 * Flow: 工单开始生产 → 物料消耗记录 → 成品入库登记 → IQC/FQC → 确认入库
 * Data: GET/PUT /api/production/orders + /api/production/fg
 */

import { useEffect, useState, useCallback } from "react";
import { CheckCircle, Package, Clock, AlertTriangle, Plus, ArrowRight } from "lucide-react";
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
  actual_start: string;
  actual_end: string;
}

interface FgReceipt {
  id: number;
  receipt_no: string;
  production_order_id: number;
  material_code: string;
  material_name: string;
  quantity: number;
  unit_code: string;
  serial_no: string;
  batch_no: string;
  warehouse_code: string;
  location_code: string;
  status: string;
  qc_result: string;
  production_date: string;
  created_at: string;
}

export function WmsProductionInbound({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<ProdOrder[]>([]);
  const [fgReceipts, setFgReceipts] = useState<FgReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<ProdOrder | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptQty, setReceiptQty] = useState("");
  const [receiptSerial, setReceiptSerial] = useState("");
  const [receiptBatch, setReceiptBatch] = useState("");
  const [receiptRemarks, setReceiptRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"orders" | "receipts">("orders");

  const labels = STATUS_LABELS[locale] ?? STATUS_LABELS["zh-CN"];

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://127.0.0.1:8080/api/production/orders?status=" + (statusFilter || ""), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.items ?? data ?? []);
      }
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  const fetchReceipts = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://127.0.0.1:8080/api/production/fg?pageSize=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFgReceipts(data.items ?? data ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  const filteredOrders = orders.filter((o) =>
    !statusFilter || o.status === statusFilter
  );

  const handleReceive = async () => {
    if (!selectedOrder || !receiptQty) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://127.0.0.1:8080/api/production/fg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          production_order_id: selectedOrder.id,
          material_code: selectedOrder.material_code,
          material_name: selectedOrder.material_name,
          quantity: Number(receiptQty),
          serial_no: receiptSerial || null,
          batch_no: receiptBatch || null,
          warehouse_code: "WH01",
          remarks: receiptRemarks,
        }),
      });
      if (res.ok) {
        setShowReceiptModal(false);
        setReceiptQty("");
        setReceiptSerial("");
        setReceiptBatch("");
        setReceiptRemarks("");
        setSelectedOrder(null);
        fetchOrders();
        fetchReceipts();
      } else {
        alert("Receipt failed: " + res.status);
      }
    } catch (e) {
      alert(String(e));
    }
    setSubmitting(false);
  };

  const fmtDate = (s: string | null | undefined) => {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  };

  return (
    <div className="screen-stack">
      {/* Header */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.productionInbound", locale)}</h2>
            <p>{locale === "zh-CN" ? "成品入库登记与QC确认" : locale === "vi-VN" ? "Nhap kho thanh pham va xac nhan QC" : "Finished goods receipt and QC confirmation"}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={tab === "orders" ? "action-button" : "secondary-button"}
              onClick={() => setTab("orders")}
            >
              <Package size={14} style={{ marginRight: 4 }} />
              {locale === "zh-CN" ? "工单" : locale === "vi-VN" ? "Lenh SX" : "Orders"}
              <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "1px 8px", fontSize: 12 }}>
                {orders.filter(o => o.status === "IN_PRODUCTION" || o.status === "QC_IN_PROGRESS").length}
              </span>
            </button>
            <button
              className={tab === "receipts" ? "action-button" : "secondary-button"}
              onClick={() => setTab("receipts")}
            >
              <CheckCircle size={14} style={{ marginRight: 4 }} />
              {locale === "zh-CN" ? "入库记录" : locale === "vi-VN" ? "Phieu nhap" : "Receipts"}
            </button>
          </div>
        </div>

        {/* Status filter */}
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
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            {filteredOrders.length} / {orders.length} {
              locale === "zh-CN" ? "条工单" : locale === "vi-VN" ? "lenh" : "orders"
            }
          </div>
        </div>
      </section>

      {tab === "orders" ? (
        /* Orders list */
        <section className="surface-panel">
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{locale === "zh-CN" ? "工单号" : locale === "vi-VN" ? "Ma Lenh" : "WO No."}</th>
                  <th>{locale === "zh-CN" ? "MO号" : "MO No."}</th>
                  <th>{locale === "zh-CN" ? "物料" : "Material"}</th>
                  <th>{locale === "zh-CN" ? "计划/完成" : locale === "vi-VN" ? "Ke hoach/HT" : "Planned/Done"}</th>
                  <th>{locale === "zh-CN" ? "状态" : "Status"}</th>
                  <th>{locale === "zh-CN" ? "日期" : "Date"}</th>
                  <th>{locale === "zh-CN" ? "操作" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="empty-state">{t("common.loading", locale)}</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr><td colSpan={8} className="empty-state">{t("common.empty", locale)}</td></tr>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3 }}>
                          <div style={{
                            width: `${o.planned_qty > 0 ? Math.min(100, (Number(o.output_qty) / Number(o.planned_qty)) * 100) : 0}%`,
                            height: "100%",
                            background: "#22c55e",
                            borderRadius: 3,
                            transition: "width 0.3s",
                          }} />
                        </div>
                        <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                          {o.output_qty}/{o.planned_qty}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: STATUS_COLORS[o.status] ?? "#999", fontWeight: 600, fontSize: 12 }}>
                        {labels[o.status] ?? o.status}
                      </span>
                    </td>
                    <td><code>{fmtDate(o.order_date)}</code></td>
                    <td>
                      {(o.status === "IN_PRODUCTION" || o.status === "QC_IN_PROGRESS") && (
                        <button
                          className="action-button"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => { setSelectedOrder(o); setShowReceiptModal(true); }}
                        >
                          <Plus size={12} style={{ marginRight: 3 }} />
                          {locale === "zh-CN" ? "入库" : locale === "vi-VN" ? "Nhap" : "Receive"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        /* Receipts list */
        <section className="surface-panel">
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{locale === "zh-CN" ? "入库单号" : locale === "vi-VN" ? "Phieu nhap" : "Receipt No."}</th>
                  <th>{locale === "zh-CN" ? "物料" : "Material"}</th>
                  <th>{locale === "zh-CN" ? "数量" : "Qty"}</th>
                  <th>SN / Batch</th>
                  <th>{locale === "zh-CN" ? "QC结果" : "QC Result"}</th>
                  <th>{locale === "zh-CN" ? "仓库" : "Warehouse"}</th>
                  <th>{locale === "zh-CN" ? "入库时间" : "Time"}</th>
                </tr>
              </thead>
              <tbody>
                {fgReceipts.length === 0 ? (
                  <tr><td colSpan={8} className="empty-state">{t("common.empty", locale)}</td></tr>
                ) : fgReceipts.map((r, idx) => (
                  <tr key={r.id}>
                    <td>{idx + 1}</td>
                    <td><code style={{ color: "#22c55e" }}>{r.receipt_no}</code></td>
                    <td>
                      <strong>{r.material_name || r.material_code}</strong>
                      <br /><code style={{ fontSize: 11, color: "var(--muted)" }}>{r.material_code}</code>
                    </td>
                    <td>{r.quantity.toLocaleString()} {r.unit_code}</td>
                    <td>
                      <code>{r.serial_no || r.batch_no || "—"}</code>
                    </td>
                    <td>
                      {r.qc_result === "PASS" ? (
                        <span className="badge badge-ok">PASS</span>
                      ) : r.qc_result === "FAIL" ? (
                        <span className="badge badge-danger">FAIL</span>
                      ) : (
                        <span className="badge badge-warning">{r.status}</span>
                      )}
                    </td>
                    <td><code>{r.warehouse_code || "WH01"}</code></td>
                    <td><code>{fmtDate(r.created_at)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Receipt Modal */}
      {showReceiptModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowReceiptModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ marginBottom: 16 }}>
              <ArrowRight size={16} style={{ display: "inline", marginRight: 6 }} />
              {locale === "zh-CN" ? "成品入库登记" : locale === "vi-VN" ? "Dang ky nhap kho TP" : "Finished Goods Receipt"}
            </h3>

            {/* Order summary */}
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
              <div><strong>{selectedOrder.order_no}</strong> — {selectedOrder.material_name || selectedOrder.material_code}</div>
              <div style={{ color: "var(--muted)", marginTop: 4 }}>
                {locale === "zh-CN" ? "计划数量" : "Planned qty"}: {selectedOrder.planned_qty} &nbsp;
                {locale === "zh-CN" ? "已完成" : "Done"}: {selectedOrder.output_qty}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>{
                  locale === "zh-CN" ? "入库数量 *" : locale === "vi-VN" ? "So luong nhap *" : "Receipt Qty *"
                }</label>
                <input
                  className="input"
                  type="number"
                  value={receiptQty}
                  onChange={(e) => setReceiptQty(e.target.value)}
                  placeholder="0"
                  min="1"
                  style={{ width: "100%", marginTop: 4 }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>SN / {
                  locale === "zh-CN" ? "序列号" : locale === "vi-VN" ? "So SN" : "Serial No."
                }</label>
                <input
                  className="input"
                  value={receiptSerial}
                  onChange={(e) => setReceiptSerial(e.target.value)}
                  placeholder="SN-XXXX-XXXX"
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Batch / {
                  locale === "zh-CN" ? "批次号" : locale === "vi-VN" ? "So LO" : "Batch No."
                }</label>
                <input
                  className="input"
                  value={receiptBatch}
                  onChange={(e) => setReceiptBatch(e.target.value)}
                  placeholder={
                    locale === "zh-CN" ? "批次号（可选）" : locale === "vi-VN" ? "So LO (tuy chon)" : "Batch No. (optional)"
                  }
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>{
                  locale === "zh-CN" ? "备注" : locale === "vi-VN" ? "Ghi chu" : "Remarks"
                }</label>
                <textarea
                  className="input"
                  value={receiptRemarks}
                  onChange={(e) => setReceiptRemarks(e.target.value)}
                  rows={2}
                  style={{ width: "100%", marginTop: 4, resize: "vertical" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
              <button className="secondary-button" onClick={() => setShowReceiptModal(false)}>
                {locale === "zh-CN" ? "取消" : locale === "vi-VN" ? "Huy" : "Cancel"}
              </button>
              <button
                className="action-button"
                onClick={handleReceive}
                disabled={!receiptQty || submitting}
              >
                {submitting ? (
                  locale === "zh-CN" ? "提交中..." : locale === "vi-VN" ? "Dang gui..." : "Submitting..."
                ) : (
                  <>
                    <CheckCircle size={14} style={{ marginRight: 4 }} />
                    {locale === "zh-CN" ? "确认入库" : locale === "vi-VN" ? "Xac nhan nhap" : "Confirm Receipt"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
