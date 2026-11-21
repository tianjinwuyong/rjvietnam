import { useState, useEffect, useCallback } from "react";
import {
  Package, FileText, Image, Video, ShieldCheck, Plus, X,
  Upload, Eye, Download, Clock, AlertTriangle, CheckCircle, XCircle
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface OverPickingOrder {
  id: number;
  orderNo: string;
  workOrderNo: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  applicantName: string;
  applicantRole: string;
  approverName: string | null;
  approverRole: string | null;
  approvalRemark: string | null;
  approvedAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OverPickingItem {
  id: number;
  materialCode: string;
  materialName: string;
  qty: number;
  unit: string;
}

export function WmsOverPicking({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<OverPickingOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [search, setSearch] = useState("");
  const [workOrderFilter, setWorkOrderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showDetail, setShowDetail] = useState<(OverPickingOrder & { items?: OverPickingItem[] }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    workOrderNo: "",
    items: [{ materialCode: "", materialName: "", qty: 0, unit: "PCS" }],
    remark: "",
  });
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wmsApi.getOverPickingList({
        page: page + 1,
        pageSize: LIMIT,
        orderNo: search || undefined,
        workOrderNo: workOrderFilter || undefined,
        status: statusFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setOrders(res.items || []);
      setTotal(res.total || 0);
    } catch { setOrders([]); }
    setLoading(false);
  }, [page, search, workOrderFilter, statusFilter, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const addItem = () => {
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { materialCode: "", materialName: "", qty: 0, unit: "PCS" }]
    }));
  };

  const removeItem = (index: number) => {
    if (form.items.length > 1) {
      setForm(prev => ({
        ...prev,
        items: prev.items.filter((_, i) => i !== index)
      }));
    }
  };

  const submitNew = async () => {
    if (!form.workOrderNo || form.items.length === 0) return;
    setSaving(true);
    try {
      const validItems = form.items.filter(item => item.materialCode && item.qty > 0);
      if (validItems.length === 0) {
        alert(t("wms.overPicking.validation.items", locale));
        return;
      }
      
      await wmsApi.createOverPickingOrder({
        workOrderNo: form.workOrderNo,
        items: validItems,
        remark: form.remark
      });
      setShowNew(false);
      setForm({
        workOrderNo: "",
        items: [{ materialCode: "", materialName: "", qty: 0, unit: "PCS" }],
        remark: "",
      });
      setShowForm(false);
      load();
    } catch(e) { console.error(e); }
    setSaving(false);
  };

  const handleApprove = async (id: number, pass: boolean, remark: string) => {
    try {
      await wmsApi.approveOverPickingOrder(id, { pass, approvalRemark: remark });
      load();
    } catch(e) { console.error(e); }
  };

  const handleCancel = async (id: number) => {
    try {
      await wmsApi.cancelOverPickingOrder(id);
      load();
    } catch(e) { console.error(e); }
  };

  const openDetail = async (id: number, fallback: OverPickingOrder) => {
    setShowDetail({ ...fallback, items: [] });
    try {
      const detail = await wmsApi.getOverPickingDetail(id);
      setShowDetail(detail);
    } catch { /* keep the list row as fallback */ }
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.overPicking", locale)}</h2>
            <p>{t("wms.overPicking.title", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("wms.overPicking.orderNo", locale)}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("wms.overPicking.workOrderNo", locale)}
              value={workOrderFilter}
              onChange={(e) => setWorkOrderFilter(e.target.value)}
            />
            <select
              className="input"
              style={{ padding: "4px 10px", width: 120 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("common.all", locale)}</option>
              <option value="pending">{t("wms.status.pending", locale)}</option>
              <option value="approved">{t("wms.status.approved", locale)}</option>
              <option value="rejected">{t("wms.status.rejected", locale)}</option>
              <option value="cancelled">{t("wms.status.cancelled", locale)}</option>
            </select>
            <input
              className="input"
              type="date"
              style={{ padding: "4px 10px", width: 140 }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <input
              className="input"
              type="date"
              style={{ padding: "4px 10px", width: 140 }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <button
              className="action-button"
              type="button"
              style={{ background: "var(--info)" }}
              onClick={() => setShowNew(true)}
            >
              <Plus size={14} /> {t("wms.newOverPicking", locale)}
            </button>
          </div>
        </div>
      </section>

      {showNew && (
        <section className="surface-panel">
          <div className="section-header"><div><h3>{t("wms.newOverPicking", locale)}</h3></div></div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 180 }}
              placeholder={t("wms.overPicking.workOrderNo", locale)}
              value={form.workOrderNo}
              onChange={(e) => setForm(prev => ({ ...prev, workOrderNo: e.target.value }))}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--ok)" }}
                onClick={addItem}
              >
                <Plus size={14} /> {t("wms.addItem", locale)}
              </button>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--warn)" }}
                onClick={submitNew}
                disabled={saving}
              >
                {saving ? <Clock size={14} /> : <CheckCircle size={14} />}{t("common.submit", locale)}
              </button>
            </div>
          </div>
          
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.materialCode", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.unit", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        className="input"
                        style={{ width: 120, padding: "2px 6px" }}
                        placeholder={t("common.materialCode", locale)}
                        value={item.materialCode}
                        onChange={(e) => {
                          const newItems = [...form.items];
                          newItems[index] = { ...newItems[index], materialCode: e.target.value };
                          setForm(prev => ({ ...prev, items: newItems }));
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 180, padding: "2px 6px" }}
                        placeholder={t("common.material", locale)}
                        value={item.materialName}
                        onChange={(e) => {
                          const newItems = [...form.items];
                          newItems[index] = { ...newItems[index], materialName: e.target.value };
                          setForm(prev => ({ ...prev, items: newItems }));
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        style={{ width: 80, padding: "2px 6px" }}
                        value={item.qty || ""}
                        onChange={(e) => {
                          const newItems = [...form.items];
                          newItems[index] = { ...newItems[index], qty: Number(e.target.value) || 0 };
                          setForm(prev => ({ ...prev, items: newItems }));
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 60, padding: "2px 6px" }}
                        value={item.unit || "PCS"}
                        onChange={(e) => {
                          const newItems = [...form.items];
                          newItems[index] = { ...newItems[index], unit: e.target.value };
                          setForm(prev => ({ ...prev, items: newItems }));
                        }}
                      />
                    </td>
                    <td>
                      {form.items.length > 1 && (
                        <button
                          className="action-button"
                          type="button"
                          style={{ background: "var(--danger)", width: 32, height: 32, padding: 0 }}
                          onClick={() => removeItem(index)}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="toolbar" style={{ marginTop: 12 }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 250 }}
              placeholder={t("wms.overPicking.remark", locale)}
              value={form.remark}
              onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))}
            />
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.overPicking.list", locale)}</h3></div></div>
        {loading && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.loading", locale)}</p>}
        {!loading && orders.length === 0 && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.noData", locale)}</p>}
        
        {!loading && orders.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.overPicking.orderNo", locale)}</th>
                  <th>{t("wms.overPicking.workOrderNo", locale)}</th>
                  <th>{t("wms.overPicking.applicant", locale)}</th>
                  <th>{t("wms.overPicking.applicantRole", locale)}</th>
                  <th>{t("wms.overPicking.approver", locale)}</th>
                  <th>{t("wms.overPicking.approverRole", locale)}</th>
                  <th>{t("wms.overPicking.status", locale)}</th>
                  <th>{t("common.date", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} onClick={() => openDetail(order.id, order)}>
                    <td><code style={{ fontSize: 11 }}>{order.orderNo}</code></td>
                    <td><code style={{ fontSize: 11 }}>{order.workOrderNo}</code></td>
                    <td>{order.applicantName}<br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{order.applicantRole}</span></td>
                    <td>{order.approverName || "—"}<br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{order.approverRole || "—"}</span></td>
                    <td>
                      <span className="badge" style={{ 
                        background: order.status === "pending" ? "var(--warn)" :
                                    order.status === "approved" ? "var(--ok)" :
                                    order.status === "rejected" ? "var(--danger)" :
                                    "var(--muted)",
                        color: "#fff"
                      }}>
                        {t(`wms.status.${order.status}`, locale)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{order.createdAt.slice(0, 10)}</td>
                    <td style={{ width: 80 }}>
                      <button
                        className="action-button"
                        type="button"
                        style={{ background: "var(--info)", width: 32, height: 32, padding: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(order.id, order);
                        }}
                      >
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header"><div><h3>{t("wms.overPicking.stats", locale)}</h3></div></div>
        <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
          {Object.entries(
            orders.reduce<Record<string, number>>((acc, o) => {
              acc[o.status] = (acc[o.status] || 0) + 1;
              return acc;
            }, { pending: 0, approved: 0, rejected: 0, cancelled: 0 })
          ).map(([status, count]) => (
            <div key={status} style={{ flex: "1 1 150px", textAlign: "center" }}>
              <div style={{ fontSize: 14, marginBottom: 4 }}>{count}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{t(`wms.status.${status}`, locale)}</div>
            </div>
          ))}
        </div>
      </section>

      {showDetail && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>{t("wms.overPicking.detail", locale)}</h3>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--danger)" }}
                onClick={() => setShowDetail(null)}
              >
                <X size={14} /> {t("common.close", locale)}
              </button>
            </div>
          </div>
          <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.orderNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.orderNo}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.workOrderNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.workOrderNo}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.status", locale)}</div>
              <div>
                <span className="badge" style={{ 
                  background: showDetail?.status === "pending" ? "var(--warn)" :
                              showDetail?.status === "approved" ? "var(--ok)" :
                              showDetail?.status === "rejected" ? "var(--danger)" :
                              "var(--muted)",
                  color: "#fff"
                }}>
                  {t(`wms.status.${showDetail?.status}`, locale)}
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.applicant", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.applicantName}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{showDetail?.applicantRole}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.approver", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.approverName || "—"}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{showDetail?.approverRole || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.approvalRemark", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.approvalRemark || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.overPicking.remark", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.remark || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.createdAt", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.createdAt}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.updatedAt", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.updatedAt}</div>
            </div>
          </div>
          
          <div className="table-shell" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>{t("common.materialCode", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.unit", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {showDetail?.items?.map((item) => (
                  <tr key={item.id}>
                    <td><code style={{ fontSize: 11 }}>{item.materialCode}</code></td>
                    <td>{item.materialName}</td>
                    <td>{item.qty.toLocaleString()}</td>
                    <td>{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {showDetail?.status === "pending" && (
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "end", gap: 12 }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--ok)" }}
                onClick={() => {
                  const remark = prompt(t("wms.overPicking.approvalRemark", locale));
                  if (remark !== null) handleApprove(showDetail?.id, true, remark);
                }}
              >
                <CheckCircle size={14} /> {t("wms.approve", locale)}
              </button>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--danger)" }}
                onClick={() => {
                  const remark = prompt(t("wms.overPicking.rejectionRemark", locale));
                  if (remark !== null) handleApprove(showDetail?.id, false, remark);
                }}
              >
                <XCircle size={14} /> {t("wms.reject", locale)}
              </button>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--warn)" }}
                onClick={() => {
                  if (confirm(t("wms.overPicking.confirmCancel", locale))) handleCancel(showDetail?.id);
                }}
              >
                <AlertTriangle size={14} /> {t("wms.cancel", locale)}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}