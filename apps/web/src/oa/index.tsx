import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi,
  type OaAnnouncement,
  type OaFlowDef,
  type OaInstanceQuery,
  type OaInstanceSummary,
  type OaNotification,
  type OaPaged,
  type OaStatsOverview,
} from "./oaApi";
import { t } from "./i18n";
import { FlowForm } from "./FlowForm";
import { InstanceDetail } from "./InstanceDetail";

/**
 * OA 原生模块 —— 信息架构对齐原 OA：
 * 我的工作台 / 发起申请 / 待我审批 / 我的申请 / 已办 / 抄送我的 / 通知 / 通知通告。
 * 界面文案统一走 i18n/zh|en|vi.json（原 OA 词典逆向提取，措辞逐字一致）。
 */

const statusColor: Record<string, string> = {
  running: "#b45309",
  completed: "#15803d",
  approved: "#15803d",
  rejected: "#b91c1c",
  withdrawn: "#64748b",
  terminated: "#64748b",
  draft: "#64748b",
};

type Tab = "overview" | "start" | "todo" | "mine" | "done" | "cc" | "notifications" | "announcements";

const TAB_KEYS: Tab[] = ["overview", "start", "todo", "mine", "done", "cc", "notifications", "announcements"];
const TAB_I18N_KEY: Record<Tab, string> = {
  overview: "menu.workbench",
  start: "menu.startFlow",
  todo: "menu.todo",
  mine: "menu.mine",
  done: "menu.done",
  cc: "menu.cc",
  notifications: "announce.cat_notice",
  announcements: "menu.announcements",
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
  if (rows.length === 0) return <div className="empty-state">{t("common.empty", locale)}</div>;
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>{t("flowList.instanceNo", locale)}</th>
            <th>{t("flowList.titleCol", locale)}</th>
            <th>{t("flowList.defCol", locale)}</th>
            <th>{t("flowList.applicantCol", locale)}</th>
            <th>{t("flowList.statusCol", locale)}</th>
            <th>{t("flowList.time", locale)}</th>
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
                {statusText(row.status, locale)}
              </td>
              <td>{fmtDate(row.created_at, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString(locale === "vi-VN" ? "vi-VN" : locale === "en-US" ? "en-US" : "zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

/** 状态码 → 词典文案；未知状态回退显示原文（flowStatus.running） */
function statusText(status: string, locale: Locale): string {
  const key = `flowStatus.${status}`;
  return t(key, locale) === key ? status : t(key, locale);
}

/** 发起申请 —— 流程类型选择页（按业务分类分组，与原 OA 一致） */
function FlowPicker({
  locale, onPick,
}: {
  locale: Locale;
  onPick: (def: OaFlowDef) => void;
}) {
  const [flows, setFlows] = useState<OaFlowDef[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    oaApi.flows()
      .then(list => { if (!cancelled) setFlows(list); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, OaFlowDef[]>();
    for (const f of flows || []) {
      const cat = f.category || t("apply.catOther", locale);
      const arr = map.get(cat) || [];
      arr.push(f);
      map.set(cat, arr);
    }
    return [...map.entries()];
  }, [flows, locale]);

  if (error) return <div className="empty-state">{t("empty.loadFailed", locale)}: {error}</div>;
  if (!flows) return <div className="empty-state">{t("common.loading", locale)}</div>;
  if (flows.length === 0) return <div className="empty-state">{t("apply.noFlowAvailable", locale)}</div>;

  return (
    <div className="surface-panel" style={{ padding: "14px 16px" }}>
      <h4 style={{ margin: "0 0 4px" }}>{t("apply.pickFlow", locale)}</h4>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("apply.pickFlowHint", locale)}</p>
      {grouped.map(([cat, defs]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>{cat}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {defs.map(d => (
              <button
                key={String(d.id)}
                onClick={() => onPick(d)}
                style={{ padding: "10px 14px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", textAlign: "left", maxWidth: 260 }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{locale === "vi-VN" && d.name_vi ? d.name_vi : d.name}</div>
                {d.description ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.description}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ))}
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
  const [startDef, setStartDef] = useState<OaFlowDef | null>(null);

  const loadTab = useCallback(async (which: Tab, opts?: { keyword?: string; page?: number }) => {
    setLoading(true);
    setError("");
    try {
      if (which === "overview") {
        setOverview(await oaApi.statsOverview());
      } else if (which === "todo" || which === "mine" || which === "done" || which === "cc") {
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
      <h2 style={{ marginTop: 0 }}>{t("app.name", locale)}</h2>

      <div role="tablist" aria-label={t("app.name", locale)} style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {TAB_KEYS.map(key => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); setPage(1); setStartDef(null); }}
            style={{
              padding: "7px 12px", borderRadius: 6, cursor: "pointer",
              border: tab === key ? "2px solid #0f766e" : "1px solid #cbd5e1",
              background: tab === key ? "#ecfdf5" : "white",
              fontWeight: tab === key ? 700 : 400,
            }}
          >
            {t(TAB_I18N_KEY[key], locale)}
            {key === "todo" && (overview?.todo ?? 0) > 0 ? ` (${overview?.todo})` : ""}
            {key === "announcements" && (overview?.announcementUnread ?? 0) > 0 ? ` (${overview?.announcementUnread})` : ""}
          </button>
        ))}
      </div>

      {error && tab !== "start" && <p style={{ color: "var(--danger, #b91c1c)" }}>{t("empty.loadFailed", locale)}: {error}</p>}

      {tab === "overview" && (
        loading || !overview ? <div className="empty-state">{t("common.loading", locale)}</div> : (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label={t("dash.todoTitle", locale)} value={overview.todo} color="#b45309" />
              <StatCard label={t("flowStatus.running", locale)} value={overview.statusCounts.running ?? 0} color="#0f766e" />
              <StatCard label={t("flowStatus.completed", locale)} value={overview.statusCounts.completed ?? 0} color="#15803d" />
              <StatCard label={t("announce.unreadTag", locale)} value={overview.announcementUnread} color="#7c3aed" />
            </div>
            <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>{t("dash.recentDocs", locale)}</h4>
              <InstanceTable rows={overview.recent} locale={locale} onOpen={setDetailId} />
            </div>
            <div className="surface-panel" style={{ padding: "14px 16px" }}>
              <h4 style={{ margin: "0 0 8px" }}>{t("admin.byDef", locale)}</h4>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr><th>{t("flowList.defCol", locale)}</th><th style={{ width: 80 }}>N</th></tr>
                  </thead>
                  <tbody>
                    {overview.byDef.length === 0
                      ? <tr><td colSpan={2}>{t("common.empty", locale)}</td></tr>
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

      {tab === "start" && (
        startDef
          ? <FlowForm def={startDef} locale={locale} onDone={() => { setStartDef(null); setTab("mine"); }} onCancel={() => setStartDef(null)} />
          : <FlowPicker locale={locale} onPick={setStartDef} />
      )}

      {(tab === "todo" || tab === "mine" || tab === "done" || tab === "cc") && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder={t("common.keyword", locale)}
              style={{ flex: "0 1 280px", padding: "6px 10px" }}
              onKeyDown={e => { if (e.key === "Enter") { setPage(1); void loadTab(tab, { keyword, page: 1 }); } }}
            />
            <button onClick={() => { setPage(1); void loadTab(tab, { keyword, page: 1 }); }} style={{ cursor: "pointer" }}>
              {t("common.search", locale)}
            </button>
            <button onClick={() => void loadTab(tab, { keyword, page })} style={{ cursor: "pointer" }}>
              {t("common.refresh", locale)}
            </button>
          </div>
          {loading ? <div className="empty-state">{t("common.loading", locale)}</div> : (
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
        loading ? <div className="empty-state">{t("common.loading", locale)}</div> : (
          <>
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => void markAllRead()} style={{ cursor: "pointer" }}>{t("layout.markAllRead", locale)}</button>
              <span style={{ marginLeft: 10, fontSize: 13, color: "var(--text-muted, #64748b)" }}>
                {t("dash.unread", locale)}: {notifications.unread}
              </span>
            </div>
            {notifications.list.length === 0 ? <div className="empty-state">{t("common.empty", locale)}</div> : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr><th>{t("flowList.titleCol", locale)}</th><th>{t("flowList.statusCol", locale)}</th><th>{t("flowList.time", locale)}</th></tr>
                  </thead>
                  <tbody>
                    {notifications.list.map(n => (
                      <tr key={String(n.id)} style={{ fontWeight: n.read_at ? 400 : 700 }}>
                        <td>{n.title}{n.content ? <span style={{ color: "var(--text-muted, #64748b)" }}> — {n.content}</span> : null}</td>
                        <td>{n.read_at ? t("dash.read", locale) : t("dash.unread", locale)}</td>
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
        loading ? <div className="empty-state">{t("common.loading", locale)}</div> : (
          announcements.list.length === 0 ? <div className="empty-state">{t("common.empty", locale)}</div> : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("flowList.titleCol", locale)}</th>
                    <th>{t("announce.publisher", locale)}</th>
                    <th>{t("announce.publishAt", locale)}</th>
                    <th>{t("announce.readCountShort", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {announcements.list.map(a => (
                    <tr key={String(a.id)} style={{ fontWeight: a.is_read ? 400 : 700 }}>
                      <td>{a.top ? "📌 " : ""}{a.title}{a.content ? <div style={{ color: "var(--text-muted, #64748b)", fontWeight: 400, fontSize: 13 }}>{a.content}</div> : null}</td>
                      <td>{a.publisher_name ?? "-"}</td>
                      <td>{fmtDate(a.publish_at ?? a.created_at, locale)}</td>
                      <td>{a.read_count ?? 0}{a.is_read ? "" : ` · ${t("announce.unreadTag", locale)}`}</td>
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
