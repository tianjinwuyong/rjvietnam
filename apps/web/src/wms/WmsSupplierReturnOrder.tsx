import { useState, useEffect, useCallback } from "react";
import { Truck, X, Eye, CheckCircle, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface SupplierReturnItem {
  id: number;
  material_id: number | null;
  material_code: string | null;
  material_name: string | null;
  batch_no: string | null;
  location_id: number | null;
  quantity: string;
  out_qty: string | null;
  unit: string;
}

interface SupplierReturnOrder {
  id: number;
  return_no: string;
  mrb_id: number | null;
  disposition_id: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
  batch_no: string | null;
  status: "pending_out" | "out" | "cancelled" | string;
  total_qty: string | null;
  out_qty: string | null;
  unit: string;
  out_time: string | null;
  out_by: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
  items?: SupplierReturnItem[];
}

const STATUS_COLOR: Record<string, string> = {
  pending_out: "var(--warn)",
  out: "var(--ok)",
  cancelled: "var(--danger)",
};

export function WmsSupplierReturnOrder({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<SupplierReturnOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState<SupplierReturnOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionRemark, setActionRemark] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await wmsApi.getSupplierReturnList({
        page: page + 1,
        pageSize: LIMIT,
        returnNo: search || undefined,
        status: statusFilter || undefined,
      });
      setOrders((res.items || []) as unknown as SupplierReturnOrder[]);
      setTotal(res.total || 0);
    } catch (e) {
      setOrders([]);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: number) => {
    setBusy(true);
    setError("");
    try {
      const row = await wmsApi.getSupplierReturnDetail(id);
      setDetail(row as unknown as SupplierReturnOrder);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const runAction = async (kind: "outbound" | "cancel") => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const body = { orderId: detail.id, remark: actionRemark || undefined };
      const row = kind === "outbound"
        ? await wmsApi.outboundSupplierReturn(body)
        : await wmsApi.cancelSupplierReturn(body);
      setDetail(row as unknown as SupplierReturnOrder);
      setActionRemark("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending_out: "wms.supplierReturnOrder.pendingOut",
      out: "wms.supplierReturnOrder.out",
      cancelled: "wms.status.cancelled",
    };
    return t(map[status] || "wms.status.pending", locale);
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Truck size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.supplierReturnOrder", locale)}</h2>
            <p>{t("wms.supplierReturnOrder.subtitle", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 170 }}
              placeholder={t("wms.supplierReturnOrder.returnNo", locale)}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
            <select
              className="input"
              style={{ padding: "4px 10px", width: 140 }}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            >
              <option value="">{t("common.all", locale)}</option>
              <option value="pending_out">{t("wms.supplierReturnOrder.pendingOut", locale)}</option>
              <option value="out">{t("wms.supplierReturnOrder.out", locale)}</option>
              <option value="cancelled">{t("wms.status.cancelled", locale)}</option>
            </select>
            <button className="action-button" type="button" onClick={() => load()} title={t("common.refresh", locale)}>
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </section>

      {error && (
        <section className="surface-panel">
          <p style={{ color: "var(--danger)" }}>{error}</p>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.supplierReturnOrder.list", locale)}</h3></div></div>
        {loading && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.loading", locale)}</p>}
        {!loading && orders.length === 0 && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.noData", locale)}</p>}

        {!loading && orders.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.supplierReturnOrder.returnNo", locale)}</th>
                  <th>{t("wms.rework.supplier", locale)}</th>
                  <th>{t("wms.rework.batchNo", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.unit", locale)}</th>
                  <th>{t("wms.supplierReturnOrder.outQty", locale)}</th>
                  <th>{t("wms.rework.status", locale)}</th>
                  <th>{t("wms.supplierReturnOrder.outTime", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} onClick={() => void openDetail(order.id)} style={{ cursor: "pointer" }}>
                    <td><code style={{ fontSize: 11 }}>{order.return_no}</code></td>
                    <td>{order.supplier_name || order.supplier_code || "—"}</td>
                    <td><code style={{ fontSize: 11 }}>{order.batch_no || "—"}</code></td>
                    <td>{Number(order.total_qty || 0).toLocaleString()}</td>
                    <td>{order.unit}</td>
                    <td>{Number(order.out_qty || 0).toLocaleString()}</td>
                    <td>
                      <span className="badge" style={{ background: STATUS_COLOR[order.status] || "var(--nav)", color: "#fff" }}>
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{order.out_time ? order.out_time.slice(0, 16) : "—"}</td>
                    <td style={{ width: 70 }}>
                      <button className="action-button" type="button" onClick={(e) => { e.stopPropagation(); void openDetail(order.id); }}>
                        <Eye size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > LIMIT && (
          <div className="toolbar" style={{ justifyContent: "center", gap: 8, marginTop: 12 }}>
            <button className="action-button" type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</button>
            <span style={{ padding: "0 10px" }}>{page + 1} / {pages}</span>
            <button className="action-button" type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        )}
      </section>

      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setDetail(null)}>
          <div className="surface-panel" style={{ width: 720, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="section-header">
              <div>
                <h2><CheckCircle size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{detail.return_no}</h2>
                <p>{t("wms.supplierReturnOrder.detail", locale)}</p>
              </div>
              <button className="action-button" type="button" onClick={() => setDetail(null)}><X size={16} /></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div><span style={{ color: "#64748b" }}>{t("wms.rework.status", locale)}: </span>
                <span className="badge" style={{ background: STATUS_COLOR[detail.status] || "var(--nav)", color: "#fff" }}>{statusLabel(detail.status)}</span>
              </div>
              <div><span style={{ color: "#64748b" }}>{t("wms.rework.supplier", locale)}: </span>{detail.supplier_name || detail.supplier_code || "—"}</div>
              <div><span style={{ color: "#64748b" }}>{t("wms.rework.batchNo", locale)}: </span>{detail.batch_no || "—"}</div>
              <div><span style={{ color: "#64748b" }}>{t("common.qty", locale)}: </span>{Number(detail.total_qty || 0).toLocaleString()} {detail.unit}</div>
              <div><span style={{ color: "#64748b" }}>{t("wms.supplierReturnOrder.outQty", locale)}: </span>{Number(detail.out_qty || 0).toLocaleString()}</div>
              <div><span style={{ color: "#64748b" }}>{t("wms.supplierReturnOrder.outTime", locale)}: </span>{detail.out_time ? detail.out_time.slice(0, 19).replace("T", " ") : "—"}</div>
              <div><span style={{ color: "#64748b" }}>{t("wms.supplierReturnOrder.createdAt", locale)}: </span>{detail.created_at ? detail.created_at.slice(0, 19).replace("T", " ") : "—"}</div>
              <div><span style={{ color: "#64748b" }}>{t("common.remark", locale)}: </span>{detail.remark || "—"}</div>
            </div>

            {detail.items && detail.items.length > 0 && (
              <div className="table-shell" style={{ marginBottom: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t("common.materialCode", locale)}</th>
                      <th>{t("common.material", locale)}</th>
                      <th>{t("wms.rework.batchNo", locale)}</th>
                      <th>{t("common.qty", locale)}</th>
                      <th>{t("wms.supplierReturnOrder.outQty", locale)}</th>
                      <th>{t("common.unit", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td><code style={{ fontSize: 11 }}>{item.material_code || "—"}</code></td>
                        <td>{item.material_name || "—"}</td>
                        <td><code style={{ fontSize: 11 }}>{item.batch_no || "—"}</code></td>
                        <td>{Number(item.quantity || 0).toLocaleString()}</td>
                        <td>{Number(item.out_qty || 0).toLocaleString()}</td>
                        <td>{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detail.status === "pending_out" && (
              <>
                <input
                  className="input"
                  style={{ width: "100%", marginBottom: 10 }}
                  placeholder={t("common.remark", locale)}
                  value={actionRemark}
                  onChange={(e) => setActionRemark(e.target.value)}
                />
                <div className="toolbar" style={{ gap: 8 }}>
                  <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void runAction("outbound")}>
                    <Truck size={14} style={{ marginRight: 6 }} />{t("wms.supplierReturnOrder.confirmOut", locale)}
                  </button>
                  <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void runAction("cancel")}>
                    <X size={14} style={{ marginRight: 6 }} />{t("common.cancel", locale)}
                  </button>
                </div>
              </>
            )}
            {error && <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
