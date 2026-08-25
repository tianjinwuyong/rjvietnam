/**
 * WmsLifecycleAlerts — 物料近效期预警清单
 * Sheet 2 from 仓库电子元器件寿命管参考
 *
 * Data: GET /api/lifecycle/alerts-with-actions
 * Actions: PATCH /api/lifecycle/alert-status/:lotId (更新处理状态)
 */

import { useState, useEffect, useCallback } from "react";
import { PermissionGuard } from "../PermissionGuard";
import { wmsApi } from "../api/wms";
import type { LifecycleAlertAction } from "../api/wms";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const ALERT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  "超期":       { label: "超期",       color: "#fff", bg: "#c0392b" },
  "一级预警（黄）": { label: "一级预警（黄）", color: "#000", bg: "#f39c12" },
  "二级预警（蓝）": { label: "二级预警（蓝）", color: "#fff", bg: "#2980b9" },
};

const PROCESSING_STATUS_OPTIONS = ["待处理", "处理中", "已完成"];

export function WmsLifecycleAlerts({ permissions, locale }: { permissions: string[]; locale: Locale }) {
  const [rows, setRows] = useState<LifecycleAlertAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [editForm, setEditForm] = useState({ processing_status: "", action_plan: "", responsible: "", plan_date: "" });
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await wmsApi.getLifecycleAlertsWithActions(statusFilter ? { status: statusFilter } : undefined);
      setRows(rows ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startEdit = (row: LifecycleAlertAction) => {
    setEditingId(row.id);
    setEditForm({
      processing_status: row.processingStatus || "",
      action_plan: row.action_plan || "",
      responsible: row.responsible || "",
      plan_date: row.plan_date ? String(row.plan_date).slice(0, 10) : "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ processing_status: "", action_plan: "", responsible: "", plan_date: "" });
  };

  const saveEdit = async (lotId: number | string) => {
    setSaving(true);
    try {
      await wmsApi.patchLifecycleAlertStatus(lotId, editForm);
      setEditingId(null);
      setRefreshKey(k => k + 1);
    } catch (e) {
      alert(t("common.saveFailed", locale) + ": " + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 0 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t("wms.lifecycleAlerts", locale)}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>
            {t("wms.lifecycleAlertsDesc", locale)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
          >
            <option value="">{t("common.allStatus", locale)}</option>
            {PROCESSING_STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{ padding: "6px 16px", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
          >{t("common.refresh", locale)}</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>{t("common.loading", locale)}</div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: "center", color: "#c0392b" }}>
            <div>{t("common.loadError", locale)}: {error}</div>
            <button onClick={() => setRefreshKey(k => k + 1)} style={{ marginTop: 12, padding: "6px 20px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{t("common.retry", locale)}</button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>{t("common.noData", locale)}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                  {[t("common.batchNo", locale),t("common.materialCode", locale),t("common.materialName", locale),t("common.spec", locale),t("common.materialType", locale),t("common.expiryDate", locale),t("common.remainingDays", locale),t("common.alertLevel", locale),t("common.inventory", locale),t("common.supplier", locale),t("common.processingStatus", locale),t("common.processingPlan", locale),t("common.responsible", locale),t("common.planDate", locale)].map(h => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600, color: "#555" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isEditing = editingId === row.id;
                  const alertCfg = ALERT_CONFIG[row.alertLevel] ?? { label: row.alertLevel, color: "#fff", bg: "#27ae60" };
                  return (
                    <tr key={row.id} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace", fontWeight: 600 }}>{row.lotNo ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{row.materialCode ?? "—"}</td>
                      <td style={{ padding: "7px 10px" }}>{row.materialNameZh ?? "—"}</td>
                      <td style={{ padding: "7px 10px", color: "#666", fontSize: 11 }}>{row.materialNameEn ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontSize: 11, color: "#666" }}>{row.materialType ?? "—"}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{row.expiryDate ? row.expiryDate.slice(0, 10) : "—"}</td>
                      <td style={{ padding: "7px 10px", fontWeight: 600, color: (row.remainingDays ?? 999) <= 0 ? "#c0392b" : (row.remainingDays ?? 999) <= 30 ? "#e74c3c" : "#2980b9" }}>
                        {row.remainingDays !== null ? (row.remainingDays <= 0 ? `${t("common.overdue", locale)}${Math.abs(row.remainingDays)}${t("common.days", locale)}` : `${row.remainingDays}${t("common.days", locale)}`) : "—"}
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: alertCfg.color, background: alertCfg.bg }}>
                          {alertCfg.label}
                        </span>
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.qty ?? 0} {row.uom}</td>
                      <td style={{ padding: "7px 10px" }}>{row.supplierName ?? "—"}</td>

                      {isEditing ? (
                        <>
                          <td style={{ padding: "4px 6px" }}>
                            <select
                              value={editForm.processing_status}
                              onChange={e => setEditForm(f => ({ ...f, processing_status: e.target.value }))}
                              style={{ padding: "4px 6px", fontSize: 11, border: "1px solid #ccc", borderRadius: 4 }}
                            >
                              <option value="">—</option>
                              {PROCESSING_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <input
                              value={editForm.action_plan}
                              onChange={e => setEditForm(f => ({ ...f, action_plan: e.target.value }))}
                              placeholder={t("common.processingPlan", locale)}
                              style={{ padding: "4px 6px", fontSize: 11, border: "1px solid #ccc", borderRadius: 4, width: 120 }}
                            />
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <input
                              value={editForm.responsible}
                              onChange={e => setEditForm(f => ({ ...f, responsible: e.target.value }))}
                              placeholder={t("common.responsible", locale)}
                              style={{ padding: "4px 6px", fontSize: 11, border: "1px solid #ccc", borderRadius: 4, width: 80 }}
                            />
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <input
                              type="date"
                              value={editForm.plan_date}
                              onChange={e => setEditForm(f => ({ ...f, plan_date: e.target.value }))}
                              style={{ padding: "4px 6px", fontSize: 11, border: "1px solid #ccc", borderRadius: 4, width: 130 }}
                            />
                          </td>
                          <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                            <button onClick={() => saveEdit(row.id)} disabled={saving} style={{ padding: "3px 10px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11, marginRight: 4 }}>{t("common.save", locale)}</button>
                            <button onClick={cancelEdit} style={{ padding: "3px 10px", background: "#aaa", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>{t("common.cancel", locale)}</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: "7px 10px" }}>{row.processingStatus ?? t("common.pending", locale)}</td>
                          <td style={{ padding: "7px 10px", fontSize: 11, color: "#555" }}>{row.action_plan ?? "—"}</td>
                          <td style={{ padding: "7px 10px", fontSize: 11 }}>{row.responsible ?? "—"}</td>
                          <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: 11 }}>{row.plan_date ? String(row.plan_date).slice(0, 10) : "—"}</td>
                          <td style={{ padding: "7px 10px" }}>
                            <PermissionGuard permission="lifecycle.edit" permissions={permissions}>
                              <button
                                onClick={() => startEdit(row)}
                                style={{ padding: "3px 10px", background: "#3498db", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                              >{t("common.edit", locale)}</button>
                            </PermissionGuard>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
