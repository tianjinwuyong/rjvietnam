import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { Locale, AttendanceRecord } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";

interface Props { locale: Locale; }

export function HrAttendance({ locale }: Props) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    hrApi.getAttendance({ date: dateFilter, limit: 500 }).then((r: any) => {
      setRecords(r.items ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [dateFilter]);

  const totalRecords = records.length;
  const normalCount = records.filter((r) => r.status === "normal" || (r as any).clockInStatus === "normal").length;
                  const lateCount = records.filter((r) => (r as any).clockInStatus === "late" || r.status === "late").length;
                  const earlyCount = records.filter((r) => (r as any).clockOutStatus === "early" || r.status === "early").length;
  const absentCount = records.filter((r) => r.status === "absent").length;
  const leaveCount = records.filter((r) => r.status === "leave").length;

  const filtered = useMemo(() => {
    if (statusFilter === "all") return records;
    return records.filter((r) => r.status === statusFilter || (r as any).clockInStatus === statusFilter);
  }, [records, statusFilter]);

  const statusColor = (s: string) => ({
    normal: "var(--ok)", late: "var(--warning)", early: "var(--warning)",
    absent: "var(--danger)", leave: "var(--muted)",
  }[s] ?? "var(--text-muted)");

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        {[
          { label: t("common.total", locale), val: totalRecords, badge: dateFilter, badgeCls: "badge-info" },
          { label: t("common.normal", locale), val: normalCount, badge: totalRecords > 0 ? ((normalCount/totalRecords)*100).toFixed(0)+"%" : "0%", badgeCls: "badge-ok" },
          { label: t("common.late", locale), val: lateCount, badge: totalRecords > 0 ? ((lateCount/totalRecords)*100).toFixed(0)+"%" : "0%", badgeCls: lateCount > 0 ? "badge-warning" : "badge-ok" },
          { label: t("common.early", locale), val: earlyCount, badge: totalRecords > 0 ? ((earlyCount/totalRecords)*100).toFixed(0)+"%" : "0%", badgeCls: "badge-warning" },
          { label: t("hr.absent", locale), val: absentCount, badge: absentCount > 0 ? "!" : "0", badgeCls: absentCount > 0 ? "badge-danger" : "badge-ok" },
          { label: t("hr.leave", locale), val: leaveCount, badge: leaveCount > 0 ? ((leaveCount/totalRecords)*100).toFixed(0)+"%" : "0%", badgeCls: "badge-muted" },
        ].map(({ label, val, badge, badgeCls }) => (
          <article key={label} className="stat-card">
            <span>{label}</span>
            <strong>{loading ? "…" : val}</strong>
            <span className={`badge ${badgeCls}`}>{badge}</span>
          </article>
        ))}
      </div>

      <div className="toolbar">
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="input" style={{ width: 160 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="select">
          <option value="all">{t("common.all", locale)}</option>
          <option value="normal" key="normal-opt">{t("common.normal", locale)}</option>
          <option value="late" key="late-opt">{t("common.late", locale)}</option>
          <option value="early" key="early-opt">{t("common.early", locale)}</option>
          <option value="absent" key="absent-opt">{t("hr.absent", locale)}</option>
          <option value="leave" key="leave-opt">{t("hr.leave", locale)}</option>
        </select>
      </div>

      {loading ? (
        <p style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>{t("common.loading", locale)}…</p>
      ) : (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("hr.employee", locale)}</th>
              <th>{t("hr.department", locale)}</th>
              <th>{t("hr.date", locale)}</th>
              <th>{t("hr.clockIn", locale)}</th>
              <th>{t("hr.clockOut", locale)}</th>
              <th>{t("hr.workHours", locale)}</th>
              <th>{t("hr.shift", locale)}</th>
              <th>{t("table.status", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                {t("common.noData", locale)}
              </td></tr>
            ) : filtered.map((r) => {
              const status = (r as any).clockInStatus || r.status || "normal";
              return (
                <tr key={r.id}>
                  <td>{(r as any).employeeName || (r as any).employee_no || `ID ${r.id}`}</td>
                  <td>{(r as any).departmentName || (r as any).dept_name_zh || "-"}</td>
                  <td>{(r as any).date || (r as any).work_date || "-"}</td>
                  <td>{(r as any).clockInTime || (r as any).clock_in || "-"}</td>
                  <td>{(r as any).clockOutTime || (r as any).clock_out || "-"}</td>
                  <td>{(r as any).workHours || (r as any).work_hours || "-"}</td>
                  <td>{(r as any).shiftName || (r as any).shift_name || "-"}</td>
                  <td>
                    <span className={`badge badge-${status === "normal" ? "ok" : status === "late" || status === "early" ? "warning" : "danger"}`}>
                      {t(`hr.status.${status}`, locale)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
