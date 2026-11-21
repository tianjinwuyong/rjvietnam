import { useState, useEffect, useCallback } from "react";
import {
  Package, FileText, Image, Video, ShieldCheck, Plus, X,
  Upload, Eye, Download, Clock, AlertTriangle, CheckCircle, Play, Search, Barcode, ChevronLeft, ChevronRight
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface DefectiveMoveTask {
  id: number;
  moveNo: string;
  inventoryId: number;
  fromStockStatus: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  reason: string;
  remark: string | null;
  toLocationId: number | null;
  status: "pending_confirm" | "pending" | "completed" | "cancelled";
  createdBy: string;
  createdByName: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmRemark: string | null;
  executedBy: string | null;
  executedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DefectiveMoveLocation {
  id: number;
  locationCode: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  status: string;
}

interface DefectiveMoveSourceStock {
  id: number;
  materialId: number;
  materialCode: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  storageLocationId: number | null;
  locationCode: string | null;
  qty: number;
}

export function WmsDefectiveMove({ locale }: { locale: Locale }) {
  const [tasks, setTasks] = useState<DefectiveMoveTask[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState({ pending: 0, pendingConfirm: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [search, setSearch] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showDetail, setShowDetail] = useState<DefectiveMoveTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    moveNo: "",
    inventoryId: 0,
    materialCode: "",
    materialName: "",
    quantity: 0,
    unit: "PCS",
    reason: "",
    remark: "",
    toLocationId: null as number | null,
  });
  const [locations, setLocations] = useState<DefectiveMoveLocation[]>([]);
  const [sourceStock, setSourceStock] = useState<DefectiveMoveSourceStock[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wmsApi.getDefectiveMoveList({
        page: page + 1,
        pageSize: LIMIT,
        keyword: search || undefined,
        materialCode: materialFilter || undefined,
        status: statusFilter || undefined,
      });
      setTasks(res.items || []);
      setTotal(res.total || 0);
    } catch { setTasks([]); }
    setLoading(false);
  }, [page, search, materialFilter, statusFilter]);

  const loadPendingCount = useCallback(async () => {
    try {
      const res = await wmsApi.getDefectiveMovePendingCount();
      setPendingCount(res);
    } catch { setPendingCount({ pending: 0, pendingConfirm: 0, total: 0 }); }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      const res = await wmsApi.getDefectiveMoveLocations();
      setLocations(res);
    } catch { setLocations([]); }
  }, []);

  const loadSourceStock = useCallback(async (params?: Record<string, unknown>) => {
    try {
      const res = await wmsApi.getDefectiveMoveSourceStock(params);
      setSourceStock(res.items || []);
    } catch { setSourceStock([]); }
  }, []);

  useEffect(() => {
    load();
    loadPendingCount();
    loadLocations();
  }, [load, loadPendingCount, loadLocations]);

  useEffect(() => {
    if (showDetail?.materialCode) {
      loadSourceStock({ keyword: showDetail.materialCode });
    } else {
      setSourceStock([]);
    }
  }, [showDetail?.materialCode, loadSourceStock]);

  const handleCreate = async () => {
    if (!form.inventoryId || !form.materialCode || form.quantity <= 0 || !form.reason) return;
    setSaving(true);
    try {
      await wmsApi.createDefectiveMove(form);
      setShowNew(false);
      setForm({
        moveNo: "",
        inventoryId: 0,
        materialCode: "",
        materialName: "",
        quantity: 0,
        unit: "PCS",
        reason: "",
        remark: "",
        toLocationId: null,
      });
      setShowForm(false);
      load();
    } catch(e) { console.error(e); }
    setSaving(false);
  };

  const handleConfirm = async (id: number, remark: string) => {
    try {
      await wmsApi.confirmDefectiveMove(id, { approve: true, remark });
      load();
    } catch(e) { console.error(e); }
  };

  const handleCancel = async (id: number, cancelReason: string) => {
    try {
      await wmsApi.cancelDefectiveMove(id, { reason: cancelReason });
      load();
    } catch(e) { console.error(e); }
  };

  const handleScan = async (id: number, scanData: string) => {
    try {
      await wmsApi.scanDefectiveMove(id, { code: scanData });
      load();
    } catch(e) { console.error(e); }
  };

  const handleComplete = async (id: number, scannedCode: string, toLocationCode: string) => {
    try {
      await wmsApi.completeDefectiveMove(id, { scannedCodes: [scannedCode], toLocationCode });
      load();
    } catch(e) { console.error(e); }
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.defectiveMove", locale)}</h2>
            <p>{t("wms.defectiveMove.title", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("wms.defectiveMove.moveNo", locale)}
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
              <option value="pending_confirm">{t("wms.defectiveMove.status.pendingConfirm", locale)}</option>
              <option value="pending">{t("wms.defectiveMove.status.pending", locale)}</option>
              <option value="completed">{t("wms.defectiveMove.status.completed", locale)}</option>
              <option value="cancelled">{t("wms.defectiveMove.status.cancelled", locale)}</option>
            </select>
            <button
              className="action-button"
              type="button"
              style={{ background: "var(--info)" }}
              onClick={() => setShowNew(true)}
            >
              <Plus size={14} /> {t("wms.newDefectiveMove", locale)}
            </button>
          </div>
        </div>
      </section>

      {showNew && (
        <section className="surface-panel">
          <div className="section-header"><div><h3>{t("wms.newDefectiveMove", locale)}</h3></div></div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 150 }}
              placeholder={t("wms.defectiveMove.moveNo", locale)}
              value={form.moveNo || ""}
              onChange={(e) => setForm(prev => ({ ...prev, moveNo: e.target.value }))}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 150 }}
              placeholder={t("wms.defectiveMove.inventoryId", locale)}
              type="number"
              value={form.inventoryId || ""}
              onChange={(e) => setForm(prev => ({ ...prev, inventoryId: Number(e.target.value) || 0 }))}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 150 }}
              placeholder={t("common.materialCode", locale)}
              value={form.materialCode}
              onChange={(e) => setForm(prev => ({ ...prev, materialCode: e.target.value }))}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 150 }}
              placeholder={t("common.material", locale)}
              value={form.materialName}
              onChange={(e) => setForm(prev => ({ ...prev, materialName: e.target.value }))}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 100 }}
              type="number"
              placeholder={t("common.qty", locale)}
              value={form.quantity || ""}
              onChange={(e) => setForm(prev => ({ ...prev, quantity: Number(e.target.value) || 0 }))}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 80 }}
              placeholder={t("common.unit", locale)}
              value={form.unit}
              onChange={(e) => setForm(prev => ({ ...prev, unit: e.target.value }))}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 150 }}
              placeholder={t("wms.defectiveMove.reason", locale)}
              value={form.reason}
              onChange={(e) => setForm(prev => ({ ...prev, reason: e.target.value }))}
            />
            <select
              className="input"
              style={{ padding: "4px 10px", width: 150 }}
              value={form.toLocationId || ""}
              onChange={(e) => setForm(prev => ({ ...prev, toLocationId: Number(e.target.value) || null }))}
            >
              <option value="">{t("common.select", locale)}</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.locationCode} - {loc.nameZh}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 250 }}
              placeholder={t("common.remark", locale)}
              value={form.remark}
              onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))}
            />
            <button
              className="action-button"
              type="button"
              style={{ background: "var(--ok)" }}
              onClick={handleCreate}
              disabled={saving}
            >
              {saving ? <Clock size={14} /> : <CheckCircle size={14} />}{t("common.submit", locale)}
            </button>
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.defectiveMove.list", locale)}</h3></div></div>
        {loading && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.loading", locale)}</p>}
        {!loading && tasks.length === 0 && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.noData", locale)}</p>}

        {!loading && tasks.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.defectiveMove.moveNo", locale)}</th>
                  <th>{t("wms.defectiveMove.inventoryId", locale)}</th>
                  <th>{t("common.materialCode", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.unit", locale)}</th>
                  <th>{t("wms.defectiveMove.reason", locale)}</th>
                  <th>{t("wms.defectiveMove.fromStockStatus", locale)}</th>
                  <th>{t("wms.defectiveMove.toLocation", locale)}</th>
                  <th>{t("wms.defectiveMove.status", locale)}</th>
                  <th>{t("common.createdAt", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} onClick={() => setShowDetail(task)}>
                    <td><code style={{ fontSize: 11 }}>{task.moveNo}</code></td>
                    <td><code style={{ fontSize: 11 }}>{task.inventoryId}</code></td>
                    <td><code style={{ fontSize: 11 }}>{task.materialCode}</code></td>
                    <td>{task.materialName}</td>
                    <td>{task.quantity.toLocaleString()}</td>
                    <td>{task.unit}</td>
                    <td>{task.reason}</td>
                    <td>{task.fromStockStatus}</td>
                    <td>
                      {task.toLocationId ? (
                        <code>{locations.find(l => l.id === task.toLocationId)?.locationCode || "—"}</code>
                      ) : "—"}
                    </td>
                    <td>
                      <span className="badge" style={{ 
                        background: task.status === "pending_confirm" ? "var(--warn)" :
                                    task.status === "pending" ? "var(--info)" :
                                    task.status === "completed" ? "var(--ok)" :
                                    "var(--danger)",
                        color: "#fff"
                      }}>
                        {t(`wms.defectiveMove.status.${task.status}`, locale)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{task.createdAt.slice(0, 10)}</td>
                    <td style={{ width: 80 }}>
                      <button
                        className="action-button"
                        type="button"
                        style={{ background: "var(--info)", width: 32, height: 32, padding: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDetail(task);
                        }}
                      >
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination" style={{ display: "flex", justifyContent: "end", gap: 8, marginTop: 12 }}>
              <button
                className="action-button"
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={12} /> {t("common.prev", locale)}
              </button>
              <span>{t("common.page", locale)} {page + 1}</span>
              <button
                className="action-button"
                type="button"
                disabled={tasks.length < LIMIT}
                onClick={() => setPage(page + 1)}
              >
                {t("common.next", locale)} <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header"><div><h3>{t("wms.defectiveMove.pendingCount", locale)}</h3></div></div>
        <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>{pendingCount.pendingConfirm}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.defectiveMove.pendingConfirm", locale)}</div>
          </div>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>{pendingCount.pending}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.defectiveMove.pending", locale)}</div>
          </div>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>{pendingCount.total}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.total", locale)}</div>
          </div>
        </div>
      </section>

      {showDetail && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>{t("wms.defectiveMove.detail", locale)}</h3>
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
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.moveNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.moveNo}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.inventoryId", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.inventoryId}</div>
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
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.qty", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.quantity.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.unit", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.unit}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.reason", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.reason}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.fromStockStatus", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.fromStockStatus}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.toLocation", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.toLocationId ? locations.find(l => l.id === showDetail?.toLocationId)?.locationCode || "—" : "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.status", locale)}</div>
              <div>
                <span className="badge" style={{ 
                  background: showDetail?.status === "pending_confirm" ? "var(--warn)" :
                              showDetail?.status === "pending" ? "var(--info)" :
                              showDetail?.status === "completed" ? "var(--ok)" :
                              "var(--danger)",
                  color: "#fff"
                }}>
                  {t(`wms.defectiveMove.status.${showDetail?.status}`, locale)}
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.createdBy", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.createdByName || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.defectiveMove.createdAt", locale)}</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{showDetail?.createdAt.slice(0, 10)}</div>
            </div>
          </div>
          <div className="table-shell" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>{t("common.materialCode", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.location", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {sourceStock.map((stock) => (
                  <tr key={stock.id}>
                    <td><code style={{ fontSize: 11 }}>{stock.materialCode}</code></td>
                    <td>{stock.name_zh}</td>
                    <td>{stock.qty.toLocaleString()}</td>
                    <td>{stock.locationCode || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showDetail?.status === "pending_confirm" && (
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "end", gap: 12 }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--info)" }}
                onClick={() => {
                  const remark = prompt(t("wms.defectiveMove.confirmRemark", locale));
                  if (remark !== null) handleConfirm(showDetail?.id, remark);
                }}
              >
                <CheckCircle size={14} /> {t("wms.defectiveMove.confirm", locale)}
              </button>
            </div>
          )}

          {showDetail?.status === "pending" && (
            <div className="toolbar" style={{ marginTop: 16, justifyContent: "end", gap: 12 }}>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--warn)" }}
                onClick={() => {
                  const cancelReason = prompt(t("wms.defectiveMove.cancelReason", locale));
                  if (cancelReason !== null) handleCancel(showDetail?.id, cancelReason);
                }}
              >
                <X size={14} /> {t("wms.defectiveMove.cancel", locale)}
              </button>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--info)" }}
                onClick={() => {
                  const scanData = prompt(t("wms.defectiveMove.scanData", locale));
                  if (scanData !== null) handleScan(showDetail?.id, scanData);
                }}
              >
                <Barcode size={14} /> {t("wms.defectiveMove.scan", locale)}
              </button>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--ok)" }}
                onClick={() => {
                  const scannedCode = prompt(t("wms.defectiveMove.scanData", locale));
                  if (scannedCode === null) return;
                  const toLocationCode = prompt(t("wms.defectiveMove.toLocation", locale));
                  if (toLocationCode !== null) handleComplete(showDetail?.id, scannedCode, toLocationCode);
                }}
              >
                <CheckCircle size={14} /> {t("wms.defectiveMove.complete", locale)}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}