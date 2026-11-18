import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient, } from "../api/client";
import { oaApi, type OaUserOption } from "./oaApi";
import { t } from "./i18n";
import { GenericListPage, fmtDate, cell, type GenCol } from "./OaGeneric";

/**
 * 人事管理组 —— 考勤汇总 / 卡规则 / 工作日历 / 排班 / 薪资 / 薪资模板 /
 * 绩效流程 / 培训计划 / 我的考试 / 交接 / 会议四页。
 * 组织导入、发起会议暂留建设中（复杂表单/导入向导）。
 */

const btn = { padding: "6px 12px", cursor: "pointer" } as const;

function nowMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 月份选择 + 通用月度列表 */
function MonthListPage({
  locale, url, monthParam, columns, extra,
}: {
  locale: Locale;
  url: string;
  monthParam?: string;
  columns: GenCol[];
  extra?: React.ReactNode;
}) {
  const [month, setMonth] = useState(nowMonth());
  const key = monthParam ?? "month";
  return (
    <div>
      {monthParam !== null && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: "5px 8px" }} />
          {extra}
        </div>
      )}
      <GenericListPage key={month} locale={locale} url={url} params={monthParam === null ? undefined : { [key]: month }} columns={columns} />
    </div>
  );
}

// ============ 卡规则 ============

function CardRulesPage({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setRows(await apiClient.get<Array<Record<string, unknown>>>("/api/attendance/rules")); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>;
  if (!rows) return <div className="empty-state">{t("common.loading", locale)}</div>;

  return (
    <div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th style={{ width: 160 }}>code</th>
              <th>{t("cardRule.ruleName", locale)}</th>
              <th style={{ width: 90 }}>{t("cardRule.cardCount", locale)}</th>
              <th style={{ width: 80 }}>{t("cardRule.active", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={String(r.code)}>
                <td>{cell(r.code)}</td>
                <td>{cell(r.name)}{r.name_vi ? <span style={{ color: "var(--text-muted, #64748b)" }}> · {cell(r.name_vi)}</span> : null}</td>
                <td>{cell(r.card_count)}</td>
                <td>{r.active ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 工作日历 ============

function WorkCalendarPage({ locale }: { locale: Locale }) {
  const [month, setMonth] = useState(nowMonth());
  const [data, setData] = useState<{ rule?: string; days?: Record<string, number> } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ rule?: string; days?: Record<string, number> }>(`/api/attendance/calendar/${month}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [month]);

  const days = Object.entries(data?.days || {}).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: "5px 8px" }} />
        {data?.rule ? <span style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>rule: {data.rule}</span> : null}
      </div>
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {!data ? <div className="empty-state">{t("common.loading", locale)}</div> : (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {days.map(([day, work]) => (
            <div key={day} title={work ? "work" : "rest"} style={{
              width: 40, height: 40, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 600,
              background: work ? "#ecfdf5" : "#fef2f2",
              color: work ? "#15803d" : "#b91c1c",
              border: `1px solid ${work ? "#a7f3d0" : "#fecaca"}`,
            }}>
              {day}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 会议发起 ============

function MeetingCreatePage({ locale, onCreated }: { locale: Locale; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [titleVi, setTitleVi] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [form, setForm] = useState("offline");
  const [location, setLocation] = useState("");
  const [onlineLink, setOnlineLink] = useState("");
  const [hostId, setHostId] = useState("");
  const [recorderId, setRecorderId] = useState("");
  const [users, setUsers] = useState<OaUserOption[]>([]);
  const [attendees, setAttendees] = useState<Array<number | string>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agenda, setAgenda] = useState<Array<{ text: string; text_vi: string }>>([]);

  useEffect(() => {
    oaApi.users({ scope: "all" }).then(l => setUsers(l || [])).catch(() => setUsers([]));
  }, []);

  const submit = async () => {
    setError("");
    if (!title.trim()) { setError(t("meeting.meetingTitle", locale)); return; }
    setBusy(true);
    try {
      await apiClient.post("/api/meeting", {
        title: title.trim(),
        titleVi: titleVi.trim() || null,
        plannedStart: start || null,
        plannedEnd: end || null,
        form,
        location: location.trim() || null,
        onlineLink: onlineLink.trim() || null,
        hostId: hostId || null,
        recorderId: recorderId || null,
        agendaItems: agenda
          .map(a => ({ text: a.text.trim(), text_vi: a.text_vi.trim() || null }))
          .filter(a => a.text),
        attendees: attendees.map(id => ({ userId: id })),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = { display: "block", marginBottom: 5, fontSize: 13 };
  const input = { width: "100%", boxSizing: "border-box" as const, marginBottom: 10 };

  return (
    <div className="surface-panel" style={{ padding: "16px 18px", maxWidth: 720 }}>
      <h3 style={{ margin: "0 0 14px" }}>{t("menu.meetingCreate", locale)}</h3>

      <label style={label}>{t("meeting.meetingTitle", locale)} *</label>
      <input value={title} onChange={e => setTitle(e.target.value)} style={input} />

      <label style={label}>{t("meeting.titleVi", locale)}</label>
      <input value={titleVi} onChange={e => setTitleVi(e.target.value)} style={input} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={label}>{t("meeting.plannedStart", locale)}</label>
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} style={input} />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <label style={label}>{t("meeting.plannedEnd", locale)}</label>
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} style={input} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div>
          <label style={label}>{t("meeting.form", locale)}</label>
          <select value={form} onChange={e => setForm(e.target.value)} style={{ ...input, padding: "6px 8px" }}>
            <option value="offline">{t("meeting.form_offline", locale)}</option>
            <option value="online">{t("meeting.form_online", locale)}</option>
            <option value="hybrid">{t("meeting.form_hybrid", locale)}</option>
          </select>
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={label}>{t("meeting.location", locale)}</label>
          <input value={location} onChange={e => setLocation(e.target.value)} style={input} />
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={label}>{t("meeting.onlineLink", locale)}</label>
          <input value={onlineLink} onChange={e => setOnlineLink(e.target.value)} style={input} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={label}>{t("meeting.host", locale)}</label>
          <select value={hostId} onChange={e => setHostId(e.target.value)} style={{ ...input, padding: "6px 8px" }}>
            <option value="">—</option>
            {users.map(u => <option key={String(u.id)} value={String(u.id)}>{u.real_name ?? u.username}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <label style={label}>{t("meeting.recorder", locale)}</label>
          <select value={recorderId} onChange={e => setRecorderId(e.target.value)} style={{ ...input, padding: "6px 8px" }}>
            <option value="">—</option>
            {users.map(u => <option key={String(u.id)} value={String(u.id)}>{u.real_name ?? u.username}</option>)}
          </select>
        </div>
      </div>

      <label style={label}>{t("meeting.agenda", locale)}</label>
      {agenda.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, width: 20 }}>{i + 1}</span>
          <input value={a.text} onChange={e => setAgenda(g => g.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
            placeholder={t("meeting.agendaText", locale)} style={{ flex: "1 1 180px", boxSizing: "border-box" }} />
          <input value={a.text_vi} onChange={e => setAgenda(g => g.map((x, j) => j === i ? { ...x, text_vi: e.target.value } : x))}
            placeholder={t("meeting.agendaTextVi", locale)} style={{ flex: "1 1 180px", boxSizing: "border-box" }} />
          <button type="button" style={{ ...btn, padding: "3px 8px" }} disabled={i === 0}
            onClick={() => setAgenda(g => { const c = [...g]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}>↑</button>
          <button type="button" style={{ ...btn, padding: "3px 8px" }} disabled={i === agenda.length - 1}
            onClick={() => setAgenda(g => { const c = [...g]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c; })}>↓</button>
          <button type="button" style={{ ...btn, padding: "3px 8px", color: "var(--danger, #b91c1c)" }}
            onClick={() => setAgenda(g => g.filter((_, j) => j !== i))}>{t("common.delete", locale)}</button>
        </div>
      ))}
      <button type="button" style={{ ...btn, marginBottom: 12, border: "1px solid #0f766e", color: "#0f766e", background: "none", borderRadius: 6 }}
        onClick={() => setAgenda(g => [...g, { text: "", text_vi: "" }])}>+ {t("meeting.agenda", locale)}</button>

      <label style={label}>{t("meeting.attendees", locale)}</label>
      <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", marginBottom: 12 }}>
        {users.map(u => {
          const checked = attendees.includes(u.id);
          return (
            <label key={String(u.id)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setAttendees(a => (e.target.checked ? [...a, u.id] : a.filter(x => String(x) !== String(u.id))))}
              />
              {u.real_name ?? u.username}{u.employee_no ? <span style={{ color: "var(--text-muted, #64748b)" }}>（{u.employee_no}）</span> : null}
            </label>
          );
        })}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={() => void submit()}
          style={{ padding: "8px 18px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
          {t("common.save", locale)}
        </button>
        {busy && <span style={{ alignSelf: "center", fontSize: 13 }}>{t("common.loading", locale)}</span>}
      </div>
    </div>
  );
}

// ============ 出口 ============

export type HrSubView =
  | "attendance" | "cardRule" | "workCalendar" | "schedule"
  | "salary" | "salaryTemplate" | "perfFlow"
  | "training" | "myExams" | "handover"
  | "meetingCreate" | "meetingList" | "meetingSeries" | "meetingActions" | "meetingMinutes";

export function HrView({ locale, sub, onNavigate }: { locale: Locale; sub: HrSubView; onNavigate?: (sub: HrSubView) => void }) {
  switch (sub) {
    case "attendance":
      return (
        <MonthListPage
          locale={locale}
          url="/api/attendance/summary"
          columns={[
            { key: "employee_no", label: t("attendance.employeeNo", locale), fmt: (v, row) => String(v ?? row.emp_no ?? row.employeeNo ?? "-") },
            { key: "name", label: t("attendance.name", locale), fmt: (v, row) => String(v ?? row.real_name ?? "-") },
            { key: "work_days", label: t("attendance.workDate", locale), fmt: v => String(v ?? "-") },
            { key: "ot_hours", label: "OT", fmt: v => String(v ?? "-") },
            { key: "late_count", label: "late", fmt: v => String(v ?? "-") },
            { key: "absent_count", label: "absent", fmt: v => String(v ?? "-") },
          ]}
        />
      );
    case "cardRule":
      return <CardRulesPage locale={locale} />;
    case "workCalendar":
      return <WorkCalendarPage locale={locale} />;
    case "schedule":
      return (
        <MonthListPage
          locale={locale}
          url="/api/attendance/schedule"
          columns={[
            { key: "employee_no", label: t("attendance.employeeNo", locale), fmt: (v, row) => String(v ?? row.emp_no ?? "-") },
            { key: "name", label: t("attendance.name", locale), fmt: (v, row) => String(v ?? row.real_name ?? "-") },
            { key: "work_date", label: t("attendance.workDate", locale), fmt: v => fmtDate(v) },
            { key: "shift_code", label: "shift", fmt: v => String(v ?? "-") },
          ]}
        />
      );
    case "salary":
      return (
        <MonthListPage
          locale={locale}
          url="/api/salary/records"
          columns={[
            { key: "employee_no", label: t("salary.employee", locale), fmt: (v, row) => String(v ?? row.emp_no ?? "-") },
            { key: "name", label: t("attendance.name", locale), fmt: (v, row) => String(v ?? row.real_name ?? "-") },
            { key: "period", label: t("salary.period", locale) },
            { key: "gross", label: t("salary.gross", locale) },
            { key: "net", label: t("salary.net", locale) },
          ]}
        />
      );
    case "salaryTemplate":
      return (
        <GenericListPage
          locale={locale}
          url="/api/salary/structures"
          columns={[
            { key: "name", label: t("flowVer.name", locale) },
            { key: "ver", label: t("salary.ver", locale) },
            { key: "status", label: t("announce.status", locale) },
            { key: "effective_from", label: t("salary.effectiveFrom", locale), fmt: v => fmtDate(v) },
          ]}
        />
      );
    case "perfFlow":
      return (
        <GenericListPage
          locale={locale}
          url="/api/salary/performance-records"
          columns={[
            { key: "employee_no", label: t("salary.employee", locale), fmt: (v, row) => String(v ?? row.emp_no ?? "-") },
            { key: "name", label: t("attendance.name", locale), fmt: (v, row) => String(v ?? row.real_name ?? "-") },
            { key: "period", label: t("salary.period", locale) },
            { key: "score", label: "score", fmt: v => String(v ?? "-") },
            { key: "grade", label: "grade", fmt: v => String(v ?? "-") },
          ]}
        />
      );
    case "training":
      return (
        <GenericListPage
          locale={locale}
          url="/api/training/plans"
          columns={[
            { key: "name", label: t("training.name", locale) },
            { key: "type", label: t("training.type", locale) },
            { key: "plan_date", label: t("training.planDate", locale), fmt: v => fmtDate(v) },
            { key: "status", label: t("announce.status", locale) },
          ]}
        />
      );
    case "myExams":
      return (
        <GenericListPage
          locale={locale}
          url="/api/exams/my"
          columns={[
            { key: "title", label: t("exam.title", locale) === "exam.title" ? t("flowList.titleCol", locale) : t("exam.title", locale) },
            { key: "status", label: t("announce.status", locale) },
            { key: "score", label: t("training.score", locale), fmt: v => String(v ?? "-") },
            { key: "created_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
          ]}
        />
      );
    case "handover":
      return (
        <GenericListPage
          locale={locale}
          url="/api/handover"
          columns={[
            { key: "title", label: t("flowList.titleCol", locale), fmt: (v, row) => String(v ?? row.name ?? "-") },
            { key: "status", label: t("announce.status", locale) },
            { key: "created_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
          ]}
        />
      );
    case "meetingCreate":
      return <MeetingCreatePage locale={locale} onCreated={() => onNavigate?.("meetingList")} />;
    case "meetingList":
      return (
        <GenericListPage
          locale={locale}
          url="/api/meeting"
          columns={[
            { key: "title", label: t("meeting.meetingTitle", locale) },
            { key: "planned_start", label: t("meeting.plannedStart", locale), fmt: v => fmtDate(v) },
            { key: "location", label: t("meeting.location", locale) },
            { key: "status", label: t("announce.status", locale) },
          ]}
        />
      );
    case "meetingSeries":
      return (
        <GenericListPage
          locale={locale}
          url="/api/meeting/series"
          columns={[
            { key: "title", label: t("meeting.meetingTitle", locale), fmt: (v, row) => String(v ?? row.name ?? "-") },
            { key: "cadence", label: "cadence", fmt: v => String(v ?? "-") },
            { key: "status", label: t("announce.status", locale) },
          ]}
        />
      );
    case "meetingActions":
      return (
        <GenericListPage
          locale={locale}
          url="/api/meeting/actions"
          columns={[
            { key: "title", label: t("flowList.titleCol", locale), fmt: (v, row) => String(v ?? row.content ?? "-") },
            { key: "assignee_name", label: t("driveExtra.operator", locale), fmt: v => String(v ?? "-") },
            { key: "due_date", label: "due", fmt: v => fmtDate(v) },
            { key: "status", label: t("announce.status", locale) },
          ]}
        />
      );
    case "meetingMinutes":
      return (
        <GenericListPage
          locale={locale}
          url="/api/meeting/minutes"
          columns={[
            { key: "meeting_title", label: t("meeting.meetingTitle", locale), fmt: (v, row) => String(v ?? row.title ?? "-") },
            { key: "recorder_name", label: t("meeting.recorder", locale), fmt: v => String(v ?? "-") },
            { key: "created_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
          ]}
        />
      );
    default:
      return <div className="empty-state">{t("common.empty", locale)}</div>;
  }
}
