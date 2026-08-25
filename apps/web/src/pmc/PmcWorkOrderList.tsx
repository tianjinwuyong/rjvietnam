import { useEffect, useState, useMemo, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api";

const allStatuses = ["all", "draft", "released", "running", "hold", "closed"] as const;

export function PmcWorkOrderList({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [notification, setNotification] = useState<string | null>(null);
  const [releasingCode, setReleasingCode] = useState<string | null>(null);

  const loadWorkOrders = useCallback(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((woRes) => {
      setWorkOrders(woRes.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadWorkOrders();
    // Auto-refresh every 10 seconds to monitor WO locks
    const interval = setInterval(loadWorkOrders, 10000);
    return () => clearInterval(interval);
  }, [loadWorkOrders]);

  const handleForceUnlock = async (woCode: string, lockedBy: string) => {
    if (!confirm(`Force unlock WO ${woCode}? It was locked by ${lockedBy}.`)) return;
    try {
      await pmcApi.unlockWorkOrder(woCode, { operator: "MANAGER", force: true });
      setNotification(`WO ${woCode} has been force unlocked`);
      loadWorkOrders();
    } catch {
      setNotification(`Failed to unlock WO ${woCode}`);
    }
    setTimeout(() => setNotification(null), 3000);
  };

  const handleQuickRelease = async (woCode: string) => {
    if (!confirm(`确认快速审批并释放工单 ${woCode}？`)) return;
    setReleasingCode(woCode);
    try {
      await pmcApi.quickApproveAndReleaseWorkOrder(woCode);
      setNotification(`工单 ${woCode} 已审批并释放`);
      await loadWorkOrders();
    } catch (error: any) {
      const message = error?.message || error?.error?.message || "审批释放失败";
      setNotification(`工单 ${woCode}：${message}`);
    } finally {
      setReleasingCode(null);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const lineCodes = useMemo(() => [...new Set(workOrders.map((wo) => wo.lineCode))], [workOrders]);

  const filtered = useMemo(() => {
    return workOrders.filter((wo) => {
      if (statusFilter !== "all" && wo.status !== statusFilter) return false;
      if (lineFilter !== "all" && wo.lineCode !== lineFilter) return false;
      return true;
    });
  }, [workOrders, statusFilter, lineFilter]);

  // Count WOs being loaded by PDA
  const lockedCount = workOrders.filter((wo) => (wo.activeOperators?.length ?? 0) > 0).length;

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale) ?? "Loading..."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {notification && (
        <div style={{
          position: "fixed",
          top: 16,
          right: 16,
          background: "var(--info)",
          color: "white",
          padding: "12px 20px",
          borderRadius: 6,
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
        }}>
          {notification}
        </div>
      )}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.subnav.workOrders", locale)}</h2>
            <p>{t("pmc.woStatusFilter", locale)}</p>
          </div>
          {lockedCount > 0 && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="badge badge-warning" style={{ fontSize: 13, padding: "6px 12px" }}>
                🔒 {lockedCount} WO{lockedCount > 1 ? "s" : ""} being loaded on PDA
              </span>
              <button
                onClick={loadWorkOrders}
                style={{
                  background: "var(--nav)",
                  border: "none",
                  color: "var(--text)",
                  padding: "6px 12px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12
                }}
              >
                🔄 Refresh
              </button>
            </div>
          )}
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 12, padding: "8px 16px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("table.status", locale)}:</span>
          {allStatuses.map((s) => (
            <button
              key={s}
              className={`badge badge-${statusFilter === s ? "info" : "muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? t("ui.filterTabs", locale) : t(`workorder.${s}` as any, locale)}
            </button>
          ))}
          <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 12 }}>{t("common.line", locale)}:</span>
          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            style={{ fontSize: 12, padding: "2px 6px" }}
          >
            <option value="all">{t("ui.filterTabs", locale)}</option>
            {lineCodes.map((lc) => (
              <option key={lc} value={lc}>{t("common.line", locale)} {lc}</option>
            ))}
          </select>
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.code", locale)}</th>
                <th>{t("common.product", locale)}</th>
                <th>{t("common.line", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.completed", locale)}</th>
                <th>{t("table.ready", locale)}</th>
                <th>{t("pmc.firstArticle", locale)}</th>
                <th>{t("table.status", locale)}</th>
                <th>PDA Loading</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((wo) => (
                <tr key={wo.id}>
                  <td><strong>{wo.code}</strong></td>
                  <td>{wo.productCode}</td>
                  <td>{wo.lineCode}</td>
                  <td>{wo.plannedQty.toLocaleString()}</td>
                  <td>{wo.completedQty.toLocaleString()}</td>
                  <td>
                    <div className="progress" title="100%">
                      <span style={{ width: "100%" }} />
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-warning">
                      {t("status.pending", locale)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${wo.status === "running" ? "ok" : wo.status === "released" ? "info" : wo.status === "hold" ? "warning" : wo.status === "draft" ? "muted" : "muted"}`}>
                      {t(wo.status === "running" ? "workorder.running" : wo.status === "released" ? "workorder.released" : wo.status === "hold" ? "workorder.hold" : wo.status === "draft" ? "workorder.draft" : "workorder.closed", locale)}
                    </span>
                  </td>
                  <td>
                    {(wo.activeOperators?.length ?? 0) > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {(wo.activeOperators ?? []).map((op: string) => (
                          <span key={op} className="badge badge-warning" style={{ fontSize: 11 }}>
                            🔒 {op}
                          </span>
                        ))}
                        <button
                          onClick={() => handleForceUnlock(wo.code, wo.lockedBy ?? wo.activeOperators?.[0] ?? "?")}
                          title="Force unlock (Manager)"
                          style={{
                            background: "var(--danger, #dc2626)",
                            border: "none",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 10,
                            marginTop: 2,
                          }}
                        >
                          ✕ Force
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {(wo.status === "draft" || wo.status === "hold") ? (
                      <button
                        className="action-button"
                        disabled={releasingCode === wo.code}
                        onClick={() => void handleQuickRelease(wo.code)}
                        style={{ whiteSpace: "nowrap", padding: "6px 10px", fontSize: 12 }}
                      >
                        {releasingCode === wo.code ? "审批中..." : "快速审批并释放"}
                      </button>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
