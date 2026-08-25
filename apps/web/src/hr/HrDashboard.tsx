import { useEffect, useMemo, useState } from "react";
import { t, text } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi, type AttendanceRecord, type Department, type Employee } from "../api/hr";
import { AiPatrolChat } from "../ai/AiPatrolChat";
import { hrPatrol } from "../ai/patrol";

export function HrDashboard({ locale }: { locale: Locale }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      hrApi.getEmployees({ limit: 1000 }),
      hrApi.getDepartments(),
      hrApi.getAttendance({ date: today, limit: 1000 }),
    ]).then(([employeeResult, departmentResult, attendanceResult]) => {
      if (cancelled) return;
      setEmployees(employeeResult.items);
      setDepartments(departmentResult.items);
      setTodayAttendance(attendanceResult.items);
    }).catch(() => {
      if (cancelled) return;
      setEmployees([]);
      setDepartments([]);
      setTodayAttendance([]);
    });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const totalHeadcount = employees.length;
  const activeHeadcount = employees.filter((e) => e.status === "active").length;
  const lateCount = todayAttendance.filter((r) => r.status === "late").length;
  const earlyCount = todayAttendance.filter((r) => r.status === "early").length;
  const absentCount = todayAttendance.filter((r) => r.status === "absent").length;
  const leaveCount = todayAttendance.filter((r) => r.status === "leave").length;

  const deptStats = useMemo(() => {
    return departments.map((dept) => ({
      ...dept,
      actualCount: employees.filter((e) => e.departmentId === dept.id).length,
    }));
  }, [departments, employees]);

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("hr.headcount", locale)}</span>
          <strong>{totalHeadcount}</strong>
          <span className="badge badge-info">{t("common.total", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("hr.activeEmployees", locale)}</span>
          <strong>{activeHeadcount}</strong>
          <span className="badge badge-ok">{t("common.active", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("hr.attendanceToday", locale)}</span>
          <strong>{todayAttendance.length}</strong>
          <span className="badge badge-info">{t("hr.date", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("hr.lateToday", locale)}</span>
          <strong>{lateCount}</strong>
          <span className={`badge badge-${lateCount > 0 ? "warning" : "ok"}`}>{t("status.warning", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("hr.onLeave", locale)}</span>
          <strong>{leaveCount + absentCount}</strong>
          <span className={`badge badge-${leaveCount + absentCount > 0 ? "muted" : "ok"}`}>{t("status.idle", locale)}</span>
        </article>
      </div>

      <div className="content-grid two">
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("hr.departments", locale)}</h2>
              <p>{t("hr.headcount", locale)}</p>
            </div>
          </div>
          <div className="status-stack">
            {deptStats.map((dept) => (
              <div className="status-row" key={dept.id}>
                <div>
                  <strong>{text(dept, locale)}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {t("common.code", locale)}: {dept.code}
                  </span>
                </div>
                <span className="badge badge-info">{dept.actualCount} / {dept.headcountTarget}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("hr.attendanceStats", locale)}</h2>
              <p>{t("hr.date", locale)}: {today}</p>
            </div>
          </div>
          <div className="status-stack">
            <div className="status-row">
              <span>{t("common.normal", locale)}</span>
              <span className="badge badge-ok">
                {todayAttendance.filter((r) => r.status === "normal").length}
              </span>
            </div>
            <div className="status-row">
              <span>{t("hr.lateToday", locale)}</span>
              <span className={`badge badge-${lateCount > 0 ? "warning" : "ok"}`}>{lateCount}</span>
            </div>
            <div className="status-row">
              <span>{t("common.early", locale)}</span>
              <span className={`badge badge-${earlyCount > 0 ? "warning" : "ok"}`}>{earlyCount}</span>
            </div>
            <div className="status-row">
              <span>{t("common.absent", locale)}</span>
              <span className={`badge badge-${absentCount > 0 ? "danger" : "ok"}`}>{absentCount}</span>
            </div>
            <div className="status-row">
              <span>{t("hr.onLeave", locale)}</span>
              <span className={`badge badge-${leaveCount > 0 ? "muted" : "ok"}`}>{leaveCount}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("hr.employeeList", locale)}</h2>
            <p>{t("hr.activeEmployees", locale)}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("hr.employeeNo", locale)}</th>
                <th>{t("common.name", locale)}</th>
                <th>{t("hr.department", locale)}</th>
                <th>{t("hr.position", locale)}</th>
                <th>{t("hr.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {employees.slice(0, 8).map((emp) => {
                const dept = departments.find((d) => d.id === emp.departmentId);
                return (
                  <tr key={emp.id}>
                    <td><strong>{emp.code}</strong></td>
                    <td>
                      <span>{text(emp as any, locale)}</span>
                    </td>
                    <td>{dept ? text(dept, locale) : emp.departmentNameZh}</td>
                    <td>{locale === "vi-VN" ? emp.positionTitleVi : locale === "en-US" ? emp.positionTitleEn : emp.positionTitleZh}</td>
                    <td>
                      <span className={`badge badge-${emp.status === "active" ? "ok" : "muted"}`}>
                        {t(emp.status === "active" ? "status.approved" : "status.closed", locale)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <AiPatrolChat patrol={hrPatrol(locale)} locale={locale} />
    </div>
  );
}
