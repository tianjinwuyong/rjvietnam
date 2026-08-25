import { useState, useEffect, useMemo } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { LeaveRequest } from "../api";

export function HrLeave({ locale }: { locale: Locale }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    hrApi.getLeaveRequests().then((res) => {
      setRequests(res.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleApprove = async (id: number) => {
    await hrApi.updateLeaveRequest(id, "approved");
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" } : r));
  };

  const handleReject = async (id: number) => {
    await hrApi.updateLeaveRequest(id, "rejected");
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: "rejected" } : r));
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}...</div>;
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("hr.subnav.leave", locale)}</h2>
            <p>{t("page.hr", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["all", "pending", "approved", "rejected"].map((s) => (
              <button
                key={s}
                className={`btn-ghost ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? t("ui.filterTabs", locale) : t(`status.${s}`, locale)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("hr.employeeNo", locale)}</th>
                <th>{t("common.name", locale)}</th>
                <th>{t("hr.department", locale)}</th>
                <th>{t("hr.leaveType", locale)}</th>
                <th>{t("hr.startDate", locale)}</th>
                <th>{t("hr.endDate", locale)}</th>
                <th>{t("hr.reason", locale)}</th>
                <th>{t("table.status", locale)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => (
                <tr key={req.id}>
                  <td><strong>{req.employeeCode}</strong></td>
                  <td>{req.employeeNameZh}</td>
                  <td>{req.departmentName}</td>
                  <td>{t(`hr.leaveType.${req.leaveType}`, locale)}</td>
                  <td>{req.startDate}</td>
                  <td>{req.endDate}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.reason}</td>
                  <td>
                    <span className={`badge badge-${req.status === "approved" ? "ok" : req.status === "rejected" ? "danger" : "warning"}`}>
                      {t(`status.${req.status}`, locale)}
                    </span>
                  </td>
                  <td>
                    {req.status === "pending" && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn-ghost btn-sm" onClick={() => handleApprove(req.id)}>
                          {t("buttons.approve", locale)}
                        </button>
                        <button className="btn-ghost btn-sm" onClick={() => handleReject(req.id)}>
                          {t("buttons.reject", locale)}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
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
