import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi,
  type OaAnnouncement,
  type OaInstanceDetail,
  type OaInstanceQuery,
  type OaInstanceStatus,
  type OaInstanceSummary,
  type OaNotification,
  type OaPaged,
  type OaStatsOverview,
} from "./oaApi";

const words: Record<string, Record<Locale, string>> = {
  title: { "zh-CN": "OA 协同办公", "vi-VN": "OA văn phòng đốc tác", "en-US": "OA collaboration" },
  tabOverview: { "zh-CN": "概览", "vi-VN": "Tổng quan", "en-US": "Overview" },
  tabTodo: { "zh-CN": "待我审批", "vi-VN": "Chờ tôi duyệt", "en-US": "My approvals" },
  tabMine: { "zh-CN": "我发起的", "vi-VN": "Tôi khởi tạo", "en-US": "Submitted by me" },
  tabCc: { "zh-CN": "抄送我的", "vi-VN": "CC cho tôi", "en-US": "CC to me" },
  tabNotifications: { "zh-CN": "通知", "vi-VN": "Thông báo", "en-US": "Notifications" },
  tabAnnouncements: { "zh-CN": "公告", "vi-VN": "Công báo", "en-US": "Announcements" },
  todoCount: { "zh-CN": "待办任务", "vi-VN": "Việc chờ xử lý", "en-US": "Pending tasks" },
  runningCount: { "zh-CN": "在途单据", "vi-VN": "Đang xử lý", "en-US": "In-flight" },
  completedCount: { "zh-CN": "已完结", "vi-VN": "Hoàn tất", "en-US": "Completed" },
  announcementUnread: { "zh-CN": "公告未读", "vi-VN": "Công báo chưa đọc", "en-US": "Unread announcements" },
  colNo: { "zh-CN": "单号", "vi-VN": "Số đơn", "en-US": "No." },
  colTitle: { "zh-CN": "标题", "vi-VN": "Tiêu đề", "en-US": "Title" },
  colType: { "zh-CN": "流程类型", "vi-VN": "Loại quy trình", "en-US": "Flow type" },
  colApplicant: { "zh-CN": "发起人", "vi-VN": "Người khởi tạo", "en-US": "Applicant" },
  colStatus: { "zh-CN": "状态", "vi-VN": "Trạng thái", "en-US": "Status" },
  colCreatedAt: { "zh-CN": "发起时间", "vi-VN": "Thời gian tạo", "en-US": "Created" },
  colFinishedAt: { "zh-CN": "完结时间", "vi-VN": "Thời gian kết thúc", "en-US": "Finished" },
  colPublisher: { "zh-CN": "发布人", "vi-VN": "Người đăng", "en-US": "Publisher" },
  colReadCount: { "zh-CN": "已读", "vi-VN": "Đã đọc", "en-US": "Reads" },
  searchPlaceholder: { "zh-CN": "搜索标题 / 单号", "vi-VN": "Tìm tiêu đề / số đơn", "en-US": "Search title / no." },
  search: { "zh-CN": "搜索", "vi-VN": "Tìm", "en-US": "Search" },
  refresh: { "zh-CN": "刷新", "vi-VN": "Làm mới", "en-US": "Refresh" },
  markAllRead: { "zh-CN": "全部标为已读", "vi-VN": "Đánh dấu tất cả đã đọc", "en-US": "Mark all read" },
  empty: { "zh-CN": "暂无数据", "vi-VN": "Chưa có dữ liệu", "en-US": "No data" },
  loading: { "zh-CN": "加载中…", "vi-VN": "Đang tải…", "en-US": "Loading…" },
  loadFailed: { "zh-CN": "加载失败", "vi-VN": "Tải thất bại", "en-US": "Failed to load" },
  backToList: { "zh-CN": "返回列表", "vi-VN": "Quay lại danh sách", "en-US": "Back to list" },
  approve: { "zh-CN": "通过", "vi-VN": "Duyệt qua", "en-US": "Approve" },
  reject: { "zh-CN": "驳回", "vi-VN": "Từ chối", "en-US": "Reject" },
  commentLabel: { "zh-CN": "审批意见", "vi-VN": "Ý kiến duyệt", "en-US": "Comment" },
  actionDone: { "zh-CN": "操作成功", "vi-VN": "Thao tác thành công", "en-US": "Done" },
  actionFailed: { "zh-CN": "操作失败", "vi-VN": "Thao tác thất bại", "en-US": "Action failed" },
  auditTrail: { "zh-CN": "审批记录", "vi-VN": "Lịch sử duyệt", "en-US": "Audit trail" },
  formData: { "zh-CN": "表单内容", "vi-VN": "Nội dung biểu mẫu", "en-US": "Form content" },
  statusRunning: { "zh-CN": "进行中", "vi-VN": "Đang chạy", "en-US": "Running" },
  statusCompleted: { "zh-CN": "已通过", "vi-VN": "Đã duyệt", "en-US": "Approved" },
  statusRejected: { "zh-CN": "已驳回", "vi-VN": "Đã từ chối", "en-US": "Rejected" },
  statusWithdrawn: { "zh-CN": "已撤回", "vi-VN": "Đã thu hồi", "en-US": "Withdrawn" },
  statusTerminated: { "zh-CN": "已终止", "vi-VN": "Đã chấm dứt", "en-US": "Terminated" },
  statusDraft: { "zh-CN": "草稿", "vi-VN": "Bản nháp", "en-US": "Draft" },
  recent: { "zh-CN": "最近单据", "vi-VN": "Đơn gần đây", "en-US": "Recent instances" },
  byFlow: { "zh-CN": "按流程类型", "vi-VN": "Theo loại quy trình", "en-US": "By flow type" },
  unread: { "zh-CN": "未读", "vi-VN": "Chưa đọc", "en-US": "Unread" },
};

const w = (key: string, locale: Locale): string => words[key]?.[locale] ?? key;

const statusWordKey: Record<string, string> = {
  running: "statusRunning",
  completed: "statusCompleted",
  approved: "statusCompleted",
  rejected: "statusRejected",
  withdrawn: "statusWithdrawn",
  terminated: "statusTerminated",
  draft: "statusDraft",
};

function statusLabel(status: string, locale: Locale): string {
  return w(statusWordKey[status] ?? "statusRunning", locale);
}

const statusColor: Record<string, string> = {
  running: "#b45309",
  completed: "#15803d",
  approved: "#15803d",
  rejected: "#b91c1c",
  withdrawn: "#64748b",
  terminated: "#64748b",
  draft: "#64748b",
};

function fmtDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : locale === "vi-VN" ? "vi-VN" : "en-US", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

type Tab = "overview" | "todo" | "mine" | "cc" | "notifications" | "announcements";

const TAB_KEYS: Tab[] = ["overview", "todo", "mine", "cc", "notifications", "announcements"];
const tabWordKey: Record<Tab, string> = {
  overview: "tabOverview", todo: "tabTodo", mine: "tabMine",
  cc: "tabCc", notifications: "tabNotifications", announcements: "tabAnnouncements",
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="surface-panel" style={{ flex: "1 1 160px", minWidth: 160, padding: "14px 16px" }}>
      <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function InstanceTable({
  rows, locale, onOpen,
}: {
  rows: OaInstanceSummary[];
  locale: Locale;
  onOpen: (id: OaInstanceSummary["id"]) => void;
}) {
  if (rows.length === 0) return <div className="empty-state">{w("empty", locale)}</div>;
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>{w("colNo", locale)}</th>
            <th>{w("colTitle", locale)}</th>
            <th>{w("colType", locale)}</th>
            <th>{w("colApplicant", locale)}</th>
            <th>{w("colStatus", locale)}</th>
            <th>{w("colCreatedAt", locale)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={String(row.id)} style={{ cursor: "pointer" }} onClick={() => onOpen(row.id)}>
              <td>{row.instance_no}</td>
              <td>{row.title}</td>
              <td>{row.def_name}</td>
              <td>{row.applicant_name ?? "-"}</td>
              <td style={{ color: statusColor[row.status] ?? undefined, fontWeight: 600 }}>
                {statusLabel(row.status, locale)}
              </td>
              <td>{fmtDate(row.created_at, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstanceDetail({
  id, locale, onBack, onActed,
}: {
  id: OaInstanceSummary["id"];
  locale: Locale;
  onBack: () => void;
  onActed: () => void;
}) {
  const [detail, setDetail] = useState<OaInstanceDetail | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setDetail(await oaApi.instance(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: "approve" | "reject") => {
    const task = detail?.tasks?.find(t => t.status === "assigned");
    if (!task) return;
    setBusy(true);
    setMessage("");
    try {
      await oaApi.approveTask(task.id, { action, comment: comment.trim() || undefined });
      setMessage(w("actionDone", locale));
      setComment("");
      await load();
      onActed();
    } catch (e) {
      setMessage(`${w("actionFailed", locale)}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="empty-state">{w("loadFailed", locale)}: {error}</div>;
  if (!detail) return <div className="empty-state">{w("loading", locale)}</div>;

  const pendingTask = detail.tasks?.find(t => t.status === "assigned");

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 10, cursor: "pointer" }}>← {w("backToList", locale)}</button>
      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 6px" }}>{detail.title}</h3>
        <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: 13 }}>
          {detail.instance_no} · {detail.def_name} · {detail.applicant_name ?? "-"} · {fmtDate(detail.created_at, locale)}
          <span style={{ marginLeft: 10, color: statusColor[detail.status], fontWeight: 600 }}>
            {statusLabel(detail.status, locale)}
          </span>
        </p>
      </div>

      {pendingTask && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>{w("commentLabel", locale)}</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={busy}
              onClick={() => void act("approve")}
              style={{ padding: "7px 16px", cursor: "pointer", background: "#15803d", color: "#fff", border: 0, borderRadius: 6 }}
            >{w("approve", locale)}</button>
            <button
              disabled={busy}
              onClick={() => void act("reject")}
              style={{ padding: "7px 16px", cursor: "pointer", background: "#b91c1c", color: "#fff", border: 0, borderRadius: 6 }}
            >{w("reject", locale)}</button>
            {message && <span style={{ alignSelf: "center", fontSize: 13 }}>{message}</span>}
          </div>
        </div>
      )}

      {detail.form_data && Object.keys(detail.form_data).length > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{w("formData", locale)}</h4>
          <div className="table-shell">
            <table>
              <tbody>
                {Object.entries(detail.form_data).map(([k, v]) => (
                  <tr key={k}><th style={{ width: 180, textAlign: "left" }}>{k}</th><td>{String(v ?? "-")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail.tasks && detail.tasks.length > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px" }}>
          <h4 style={{ margin: "0 0 8px" }}>{w("auditTrail", locale)}</h4>
          <div className="table-shell">
            <table>
              <thead>
                <tr><th>{w("colStatus", locale)}</th><th>{w("colApplicant", locale)}</th><th>{w("colCreatedAt", locale)}</th><th>{w("commentLabel", locale)}</th></tr>
              </thead>
              <tbody>
                {detail.tasks.map(t => (
                  <tr key={String(t.id)}>
                    <td>{t.status}</td>
                    <td>{t.assignee_name ?? "-"}</td>
                    <td>{fmtDate(t.finished_at ?? t.created_at, locale)}</td>
                    <td>{t.comment ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function OaModule({ locale }: { locale: Locale; currentUsername: string; roleKey: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<OaStatsOverview | null>(null);
  const [instances, setInstances] = useState<OaPaged<OaInstanceSummary>>({ list: [], total: 0, page: 1, size: 20 });
  const [notifications, setNotifications] = useState<{ list: OaNotification[]; unread: number }>({ list: [], unread: 0 });
  const [announcements, setAnnouncements] = useState<OaPaged<OaAnnouncement>>({ list: [], total: 0, page: 1, size: 20 });
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailId, setDetailId] = useState<OaInstanceSummary["id"] | null>(null);

  const loadTab = useCallback(async (which: Tab, opts?: { keyword?: string; page?: number }) => {
    setLoading(true);
    setError("");
    try {
      if (which === "overview") {
        setOverview(await oaApi.statsOverview());
      } else if (which === "todo" || which === "mine" || which === "cc") {
        const query: OaInstanceQuery = { tab: which, page: opts?.page ?? 1, size: 20 };
        if (opts?.keyword) query.keyword = opts.keyword;
        setInstances(await oaApi.instances(query));
      } else if (which === "notifications") {
        setNotifications(await oaApi.notifications(50, 0));
      } else if (which === "announcements") {
        setAnnouncements(await oaApi.announcements({ page: opts?.page ?? 1, pageSize: 20 }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (detailId) return;
    void loadTab(tab, { keyword, page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, detailId, page]);

  const markAllRead = async () => {
    const ids = notifications.list.filter(n => !n.read_at).map(n => n.id);
    if (ids.length === 0) return;
    await oaApi.markNotificationsRead(ids);
    void loadTab("notifications");
  };

  const totalPages = Math.max(1, Math.ceil(instances.total / instances.size));

  if (detailId !== null) {
    return (
      <div className="screen-stack oa-module">
        <InstanceDetail
          id={detailId}
          locale={locale}
          onBack={() => setDetailId(null)}
          onActed={() => void loadTab(tab, { keyword, page })}
        />
      </div>
    );
  }

  return (
    <div className="screen-stack oa-module">
      <h2 style={{ marginTop: 0 }}>{w("title", locale)}</h2>

      <div role="tablist" aria-label={w("title", locale)} style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {TAB_KEYS.map(key => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); setPage(1); }}
            style={{
              padding: "7px 12px", borderRadius: 6, cursor: "pointer",
              border: tab === key ? "2px solid #0f766e" : "1px solid #cbd5e1",
              background: tab === key ? "#ecfdf5" : "white",
              fontWeight: tab === key ? 700 : 400,
            }}
          >
            {w(tabWordKey[key], locale)}
            {key === "todo" && (overview?.todo ?? 0) > 0 ? ` (${overview?.todo})` : ""}
            {key === "announcements" && (overview?.announcementUnread ?? 0) > 0 ? ` (${overview?.announcementUnread})` : ""}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)" }}>{w("loadFailed", locale)}: {error}</p>}

      {tab === "overview" && (
        loading || !overview ? <div className="empty-state">{w("loading", locale)}</div> : (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label={w("todoCount", locale)} value={overview.todo} color="#b45309" />
              <StatCard label={w("runningCount", locale)} value={overview.statusCounts.running ?? 0} color="#0f766e" />
              <StatCard label={w("completedCount", locale)} value={overview.statusCounts.completed ?? 0} color="#15803d" />
              <StatCard label={w("announcementUnread", locale)} value={overview.announcementUnread} color="#7c3aed" />
            </div>
            <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>{w("recent", locale)}</h4>
              <InstanceTable rows={overview.recent} locale={locale} onOpen={setDetailId} />
            </div>
            <div className="surface-panel" style={{ padding: "14px 16px" }}>
              <h4 style={{ margin: "0 0 8px" }}>{w("byFlow", locale)}</h4>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr><th>{w("colType", locale)}</th><th style={{ width: 80 }}>N</th></tr>
                  </thead>
                  <tbody>
                    {overview.byDef.length === 0
                      ? <tr><td colSpan={2}>{w("empty", locale)}</td></tr>
                      : overview.byDef.map(d => (
                        <tr key={d.id}>
                          <td>{locale === "vi-VN" && d.name_vi ? d.name_vi : d.name}</td>
                          <td>{d.n}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      {(tab === "todo" || tab === "mine" || tab === "cc") && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder={w("searchPlaceholder", locale)}
              style={{ flex: "0 1 280px", padding: "6px 10px" }}
              onKeyDown={e => { if (e.key === "Enter") { setPage(1); void loadTab(tab, { keyword, page: 1 }); } }}
            />
            <button onClick={() => { setPage(1); void loadTab(tab, { keyword, page: 1 }); }} style={{ cursor: "pointer" }}>
              {w("search", locale)}
            </button>
            <button onClick={() => void loadTab(tab, { keyword, page })} style={{ cursor: "pointer" }}>
              {w("refresh", locale)}
            </button>
          </div>
          {loading ? <div className="empty-state">{w("loading", locale)}</div> : (
            <>
              <InstanceTable rows={instances.list} locale={locale} onOpen={setDetailId} />
              {instances.total > instances.size && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ cursor: "pointer" }}>←</button>
                  <span style={{ fontSize: 13 }}>{page} / {totalPages} · {instances.total}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ cursor: "pointer" }}>→</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "notifications" && (
        loading ? <div className="empty-state">{w("loading", locale)}</div> : (
          <>
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => void markAllRead()} style={{ cursor: "pointer" }}>{w("markAllRead", locale)}</button>
              <span style={{ marginLeft: 10, fontSize: 13, color: "var(--text-muted, #64748b)" }}>
                {w("unread", locale)}: {notifications.unread}
              </span>
            </div>
            {notifications.list.length === 0 ? <div className="empty-state">{w("empty", locale)}</div> : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr><th>{w("colTitle", locale)}</th><th>{w("colStatus", locale)}</th><th>{w("colCreatedAt", locale)}</th></tr>
                  </thead>
                  <tbody>
                    {notifications.list.map(n => (
                      <tr key={String(n.id)} style={{ fontWeight: n.read_at ? 400 : 700 }}>
                        <td>{n.title}{n.content ? <span style={{ color: "var(--text-muted, #64748b)" }}> — {n.content}</span> : null}</td>
                        <td>{n.read_at ? w("statusCompleted", locale) : w("unread", locale)}</td>
                        <td>{fmtDate(n.created_at, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {tab === "announcements" && (
        loading ? <div className="empty-state">{w("loading", locale)}</div> : (
          announcements.list.length === 0 ? <div className="empty-state">{w("empty", locale)}</div> : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{w("colTitle", locale)}</th>
                    <th>{w("colPublisher", locale)}</th>
                    <th>{w("colCreatedAt", locale)}</th>
                    <th>{w("colReadCount", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {announcements.list.map(a => (
                    <tr key={String(a.id)} style={{ fontWeight: a.is_read ? 400 : 700 }}>
                      <td>{a.top ? "📌 " : ""}{a.title}{a.content ? <div style={{ color: "var(--text-muted, #64748b)", fontWeight: 400, fontSize: 13 }}>{a.content}</div> : null}</td>
                      <td>{a.publisher_name ?? "-"}</td>
                      <td>{fmtDate(a.publish_at ?? a.created_at, locale)}</td>
                      <td>{a.read_count ?? 0}{a.is_read ? "" : ` · ${w("unread", locale)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )
      )}
    </div>
  );
}
