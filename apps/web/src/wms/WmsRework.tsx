import { useState, useEffect, useCallback } from "react";
import {
  Package, FileText, Image, Video, ShieldCheck, X,
  Upload, Eye, Download, Clock, AlertTriangle, CheckCircle, Play, Search
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface ReworkOrder {
  id: number;
  reworkNo: string;
  mrbNo: string | null;
  materialCode: string;
  materialName: string;
  supplierCode: string | null;
  supplierName: string | null;
  batchNo: string | null;
  quantity: number;
  unit: string;
  status: "pending" | "reworking" | "pending_reinspect" | "passed" | "failed"
    // legacy aliases (pre-312 rows / cached responses)
    | "started" | "finished" | "reinspected_ok" | "reinspected_ng";
  finishTime: string | null;
  finishBy: string | null;
  finishRemark: string | null;
  createdAt: string;
  updatedAt: string;
}

export function WmsRework({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<ReworkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [showDetail, setShowDetail] = useState<ReworkOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wmsApi.getReworkList({
        page: page + 1,
        pageSize: LIMIT,
        reworkNo: search || undefined,
        status: statusFilter || undefined,
        materialCode: materialFilter || undefined,
      });
      setOrders(res.items || []);
      setTotal(res.total || 0);
    } catch { setOrders([]); }
    setLoading(false);
  }, [page, search, statusFilter, materialFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStart = async (id: number, remark: string) => {
    try {
      await wmsApi.startReworkOrder(id, { id, remark });
      load();
    } catch(e) { console.error(e); }
  };

  const handleFinish = async (id: number, remark: string) => {
    try {
      await wmsApi.finishReworkOrder(id, { id, remark });
      load();
    } catch(e) { console.error(e); }
  };

  const handleReinspect = async (id: number, result: "pass" | "fail", remark: string) => {
    try {
      await wmsApi.reinspectReworkOrder(id, { id, result, remark });
      load();
    } catch(e) { console.error(e); }
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.rework", locale)}</h2>
            <p>{t("wms.rework.title", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("wms.rework.reworkNo", locale)}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("common.material", locale)}
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value)}
            />
            <select
              className="input"
              style={{ padding: "4px 10px", width: 120 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("common.all", locale)}</option>
              <option value="pending">{t("wms.status.pending", locale)}</option>
              <option value="reworking">{t("wms.status.reworking", locale)}</option>
              <option value="pending_reinspect">{t("wms.status.pendingReinspect", locale)}</option>
              <option value="passed">{t("wms.status.passed", locale)}</option>
              <option value="failed">{t("wms.status.failed", locale)}</option>
            </select>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.rework.list", locale)}</h3></div></div>
        {loading && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.loading", locale)}</p>}
        {!loading && orders.length === 0 && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.noData", locale)}</p>}
        
        {!loading && orders.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.rework.reworkNo", locale)}</th>
                  <th>{t("wms.rework.mrbNo", locale)}</th>
                  <th>{t("common.materialCode", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("wms.rework.supplier", locale)}</th>
                  <th>{t("wms.rework.batchNo", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.unit", locale)}</th>
                  <th>{t("wms.rework.status", locale)}</th>
                  <th>{t("wms.rework.finishTime", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} onClick={() => setShowDetail(order)}>
                    <td><code style={{ fontSize: 11 }}>{order.reworkNo}</code></td>
                    <td><code style={{ fontSize: 11 }}>{order.mrbNo || "—"}</code></td>
                    <td><code style={{ fontSize: 11 }}>{order.materialCode}</code></td>
                    <td>{order.materialName}</td>
                    <td>{order.supplierName || "—"}</td>
                    <td><code style={{ fontSize: 11 }}>{order.batchNo || "—"}</code></td>
                    <td>{order.quantity.toLocaleString()}</td>
                    <td>{order.unit}</td>
                    <td>
                      <span className="badge" style={{ 
                        background: order.status === "pending" ? "var(--warn)" :
                                    order.status === "reworking" || order.status === "started" ? "var(--info)" :
                                    order.status === "pending_reinspect" || order.status === "finished" ? "var(--ok)" :
                                    order.status === "passed" || order.status === "reinspected_ok" ? "var(--ok)" :
                                    "var(--danger)",
                        color: "#fff"
                      }}>
                        {t(`wms.status.${order.status}`, locale)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{order.finishTime ? order.finishTime.slice(0, 16) : "—"}</td>
                    <td style={{ width: 80 }}>
                      <button
                        className="action-button"
                        type="button"
                        style={{ background: "var(--info)", width: 32, height: 32, padding: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDetail(order);
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
        <div className="section-header"><div><h3>{t("wms.rework.pendingCount", locale)}</h3></div></div>
        <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>{total}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.total", locale)}</div>
          </div>
        </div>
      </section>

      {showDetail && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>{t("wms.rework.detail", locale)}</h3>
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
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.reworkNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.reworkNo}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.mrbNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.mrbNo || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.materialCode", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.materialCode}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.material", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.materialName}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.supplier", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.supplierName || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.batchNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.batchNo || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.qty", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.quantity.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.unit", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.unit}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.status", locale)}</div>
              <div>
                <span className="badge" style={{ 
                  background: showDetail?.status === "pending" ? "var(--warn)" :
                              showDetail?.status === "reworking" || showDetail?.status === "started" ? "var(--info)" :
                              showDetail?.status === "pending_reinspect" || showDetail?.status === "finished" ? "var(--ok)" :
                              showDetail?.status === "passed" || showDetail?.status === "reinspected_ok" ? "var(--ok)" :
                              "var(--danger)",
                  color: "#fff"
                }}>
                  {t(`wms.status.${showDetail?.status}`, locale)}
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.finishTime", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.finishTime || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.finishBy", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.finishBy || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.rework.finishRemark", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.finishRemark || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.createdAt", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.createdAt}</div>
            </div>
            <div>
              {t("wms.rework.actions", locale)}
            </div>
          </div>
          
          {showDetail?.status === "pending" && (
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "end", gap: 12 }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--info)" }}
                onClick={() => {
                  const remark = prompt(t("wms.rework.startRemark", locale));
                  if (remark !== null) handleStart(showDetail?.id, remark);
                }}
              >
                <Play size={14} /> {t("wms.rework.start", locale)}
              </button>
            </div>
          )}
          
          {(showDetail?.status === "reworking" || showDetail?.status === "started") && (
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "end", gap: 12 }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--ok)" }}
                onClick={() => {
                  const remark = prompt(t("wms.rework.finishRemark", locale));
                  if (remark !== null) handleFinish(showDetail?.id, remark);
                }}
              >
                <CheckCircle size={14} /> {t("wms.rework.finish", locale)}
              </button>
            </div>
          )}
          
          {(showDetail?.status === "pending_reinspect" || showDetail?.status === "finished") && (
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "end", gap: 12 }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--info)" }}
                onClick={() => {
                  const result = prompt(t("wms.rework.reinspectResult", locale)) as "pass" | "fail";
                  const remark = prompt(t("wms.rework.reinspectRemark", locale));
                  if (result && remark !== null) handleReinspect(showDetail?.id, result, remark);
                }}
              >
                <Search size={14} /> {t("wms.rework.reinspect", locale)}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}