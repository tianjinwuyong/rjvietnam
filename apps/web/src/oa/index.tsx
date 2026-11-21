import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi,
  type OaFlowDef,
  type OaInstanceQuery,
  type OaInstanceSummary,
  type OaNotification,
  type OaPaged,
  type OaProfile,
  type OaStatsOverview,
} from "./oaApi";
import { t } from "./i18n";
import { FlowForm } from "./FlowForm";
import { InstanceDetail } from "./InstanceDetail";
import { Announcements } from "./Announcements";
import { OrgView } from "./OrgView";
import { OrgImportView } from "./OrgImportView";
import { FlowDesignView } from "./FlowDesignView";
import { DocsView, type DocsSubView } from "./DocsView";
import { DriveView } from "./DriveView";
import { KnowledgeView } from "./KnowledgeView";
import { SysView } from "./SysView";
import { EquipmentView } from "./EquipmentView";
import { HrView } from "./HrView";
import { QualityView } from "./QualityView";
import { SettingsView } from "./SettingsView";
import { OA_MENU, menuText, type OaMenuItem, type OaViewId } from "./menu";

/**
 * OA 原生模块 —— 二级侧边栏布局，菜单结构与文案逐项对齐原版 BasicLayout
 * （分组/小节/菜单键复用原版 menu.* 词典）。未实现的叶子显示「建设中」。
 * 已实现视图：工作台 / 发起申请 / 待我审批 / 我的申请 / 已办 / 抄送我的 /
 * 消息通知 / 通知通告（含管理）/ 组织与人员（只读）。
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

/** 状态码 → 词典文案；未知状态回退显示原文 */
function statusText(status: string, locale: Locale): string {
  const key = `flowStatus.${status}`;
  return t(key, locale) === key ? status : t(key, locale);
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

/** 发起申请 —— 流程类型选择页（按业务分类分组，与原 OA 一致） */
function FlowPicker({
  locale, autoPickCode, onPick,
}: {
  locale: Locale;
  autoPickCode: string | null;
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

  // 人事单据等菜单快捷入口：加载后自动选中指定 code 的流程
  useEffect(() => {
    if (!flows || !autoPickCode) return;
    const def = flows.find(f => f.code === autoPickCode);
    if (def) onPick(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows, autoPickCode]);

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

/** 侧边栏叶子按钮 */
function MenuLeaf({
  item, active, badge, locale, onClick,
}: {
  item: OaMenuItem;
  active: boolean;
  badge?: number;
  locale: Locale;
  onClick: () => void;
}) {
  const wip = !item.view;
  return (
    <button
      onClick={onClick}
      title={wip ? `${menuText(item.titleKey, locale)} · ${t("wip.hint", locale)}` : undefined}
      style={{
        display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 6,
        padding: "6px 10px", borderRadius: 6, cursor: "pointer", textAlign: "left", fontSize: 13,
        border: active ? "1px solid #0f766e" : "1px solid transparent",
        background: active ? "#ecfdf5" : "transparent",
        fontWeight: active ? 700 : 400,
        color: wip ? "var(--text-muted, #94a3b8)" : "inherit",
      }}
    >
      <span>{menuText(item.titleKey, locale)}{wip ? " ·" : ""}</span>
      {badge != null && badge > 0 ? (
        <span style={{ fontSize: 11, background: "#b91c1c", color: "#fff", borderRadius: 999, padding: "0 6px", lineHeight: "16px" }}>{badge}</span>
      ) : null}
    </button>
  );
}

export function OaModule({ locale }: { locale: Locale; currentUsername: string; roleKey: string }) {
  const [view, setView] = useState<OaViewId>("overview");
  const [profile, setProfile] = useState<OaProfile | null>(null);
  const [overview, setOverview] = useState<OaStatsOverview | null>(null);
  const [instances, setInstances] = useState<OaPaged<OaInstanceSummary>>({ list: [], total: 0, page: 1, size: 20 });
  const [notifications, setNotifications] = useState<{ list: OaNotification[]; unread: number }>({ list: [], unread: 0 });
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailId, setDetailId] = useState<OaInstanceSummary["id"] | null>(null);
  const [startDef, setStartDef] = useState<OaFlowDef | null>(null);
  const [autoPickCode, setAutoPickCode] = useState<string | null>(null);
  const isAdmin = !!profile?.isAdmin;

  // 管理员判定 + 角标计数（一次加载，常驻）
  useEffect(() => {
    oaApi.profile().then(setProfile).catch(() => setProfile(null));
    oaApi.statsOverview().then(setOverview).catch(() => { /* 角标可缺省 */ });
  }, []);

  const loadView = useCallback(async (which: OaViewId, opts?: { keyword?: string; page?: number }) => {
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
      }
      // announcements / org / start 由各自组件自加载
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (detailId) return;
    void loadView(view, { keyword, page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, detailId, page]);

  const markAllRead = async () => {
    const ids = notifications.list.filter(n => !n.read_at).map(n => n.id);
    if (ids.length === 0) return;
    await oaApi.markNotificationsRead(ids);
    void loadView("notifications");
  };

  const openItem = (item: OaMenuItem) => {
    setDetailId(null);
    setStartDef(null);
    if (!item.view) {
      // 未实现叶子：建设中占位
      setWipKey(menuText(item.titleKey, locale));
      return;
    }
    setWipKey(null);
    setAutoPickCode(item.flowCode ?? null);
    setPage(1);
    setView(item.view);
  };

  // 建设中占位标题（null = 显示当前视图）
  const [wipKey, setWipKey] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(instances.total / instances.size));

  const content = wipKey ? (
    <div className="surface-panel" style={{ padding: "32px 24px", textAlign: "center" }}>
      <h3 style={{ margin: "0 0 6px" }}>{wipKey}</h3>
      <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: 14 }}>{t("wip.title", locale)} — {t("wip.hint", locale)}</p>
    </div>
  ) : detailId !== null ? (
    <InstanceDetail
      id={detailId}
      locale={locale}
      onBack={() => setDetailId(null)}
      onActed={() => void loadView(view, { keyword, page })}
    />
  ) : view === "overview" ? (
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
  ) : view === "start" ? (
    startDef
      ? <FlowForm def={startDef} locale={locale} onDone={() => { setStartDef(null); setAutoPickCode(null); setView("mine"); }} onCancel={() => { setStartDef(null); setAutoPickCode(null); }} />
      : <FlowPicker locale={locale} autoPickCode={autoPickCode} onPick={setStartDef} />
  ) : view === "announcements" ? (
    <Announcements locale={locale} />
  ) : view === "org" ? (
    <OrgView locale={locale} />
  ) : view === "orgImport" ? (
    <OrgImportView locale={locale} />
  ) : view === "docs" || view === "docNew" || view === "docLedger" || view === "docIssueRecord" || view === "docObsolete" || view === "docExternal" ? (
    <DocsView locale={locale} sub={view as DocsSubView} onNavigate={s => { setWipKey(null); setView(s); }} />
  ) : view === "drive" ? (
    <DriveView locale={locale} />
  ) : view === "knowledge" ? (
    <KnowledgeView locale={locale} />
  ) : view === "ledger" || view === "flowVersions" || view === "customField" ? (
    <SysView locale={locale} sub={view} />
  ) : view === "flowDesign" ? (
    <FlowDesignView locale={locale} />
  ) : view === "equipment" || view === "equipStocktake" || view === "equipTasks" || view === "equipCalib" || view === "equipAlerts" ? (
    <EquipmentView locale={locale} sub={view} />
  ) : view === "attendance" || view === "cardRule" || view === "workCalendar" || view === "schedule" || view === "salary" || view === "salaryTemplate" || view === "perfFlow" || view === "training" || view === "myExams" || view === "handover" || view === "meetingCreate" || view === "meetingList" || view === "meetingSeries" || view === "meetingActions" || view === "meetingMinutes" ? (
    <HrView locale={locale} sub={view} onNavigate={s => setView(s)} />
  ) : view === "iqcInspect" || view === "mrbReview" || view === "ipqcFill" || view === "ipqcRecords" || view === "faiFill" || view === "faiRecords" || view === "inspectFill" || view === "inspectRecords" || view === "oqcInspect" || view === "qcTemplates" ? (
    <QualityView locale={locale} sub={view} onNavigate={s => { setWipKey(null); setView(s); }} />
  ) : view === "settings" ? (
    <SettingsView locale={locale} />
  ) : view === "notifications" ? (
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
  ) : (
    // todo / mine / done / cc
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder={t("common.keyword", locale)}
          style={{ flex: "0 1 280px", padding: "6px 10px" }}
          onKeyDown={e => { if (e.key === "Enter") { setPage(1); void loadView(view as "todo" | "mine" | "done" | "cc", { keyword, page: 1 }); } }}
        />
        <button onClick={() => { setPage(1); void loadView(view as "todo" | "mine" | "done" | "cc", { keyword, page: 1 }); }} style={{ cursor: "pointer" }}>
          {t("common.search", locale)}
        </button>
        <button onClick={() => void loadView(view as "todo" | "mine" | "done" | "cc", { keyword, page })} style={{ cursor: "pointer" }}>
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
  );

  return (
    <div className="screen-stack oa-module" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {/* 二级侧边栏 */}
      <aside style={{ flex: "0 0 216px", position: "sticky", top: 8, maxHeight: "calc(100vh - 24px)", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 15, padding: "4px 10px 10px" }}>{t("app.name", locale)}</div>
        {OA_MENU.map(group => {
          const visibleItems = group.items.filter(it => !it.adminOnly || isAdmin);
          const visibleSections = (group.sections || []).map(sec => ({
            ...sec,
            items: sec.items.filter(it => !it.adminOnly || isAdmin),
          })).filter(sec => sec.items.length > 0);
          if (visibleItems.length === 0 && visibleSections.length === 0) {
            // 原版 single 组：组头即链接。有 homeView 的（公共盘）进原生页，否则建设中占位
            return (
              <div key={group.titleKey} style={{ marginBottom: 10 }}>
                <button
                  onClick={() => {
                    if (group.homeView) { setWipKey(null); openItem({ titleKey: group.titleKey, view: group.homeView }); return; }
                    setWipKey(menuText(group.titleKey, locale));
                  }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
                    fontSize: 13, borderRadius: 6, cursor: "pointer",
                    border: group.homeView && !wipKey && view === group.homeView ? "1px solid #0f766e" : "1px solid transparent",
                    background: group.homeView && !wipKey && view === group.homeView ? "#ecfdf5" : "transparent",
                    color: group.homeView ? "inherit" : "var(--text-muted, #94a3b8)",
                  }}
                >
                  {menuText(group.titleKey, locale)}{group.homeView ? "" : " ·"}
                </button>
              </div>
            );
          }
          return (
            <div key={group.titleKey} style={{ marginBottom: 10 }}>
              {group.homeView ? (
                <button
                  onClick={() => { setWipKey(null); openItem({ titleKey: group.titleKey, view: group.homeView }); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "6px 10px 4px",
                    fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                    textTransform: "uppercase", letterSpacing: 0.4,
                    border: !wipKey && view === group.homeView ? "1px solid #0f766e" : "1px solid transparent",
                    background: !wipKey && view === group.homeView ? "#ecfdf5" : "transparent",
                    color: "var(--text-muted, #64748b)",
                  }}
                >
                  {menuText(group.titleKey, locale)}
                </button>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted, #64748b)", padding: "6px 10px 4px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {menuText(group.titleKey, locale)}
                </div>
              )}
              {visibleItems.map(item => (
                <MenuLeaf
                  key={item.titleKey}
                  item={item}
                  locale={locale}
                  active={!wipKey && item.view === view && !(item.flowCode && view === "start" && !startDef)}
                  badge={
                    item.view === "todo" ? overview?.todo
                      : item.view === "announcements" ? overview?.announcementUnread
                        : undefined
                  }
                  onClick={() => { setWipKey(null); openItem(item); }}
                />
              ))}
              {visibleSections.map(sec => (
                <div key={sec.titleKey} style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", padding: "4px 10px 2px" }}>
                    {menuText(sec.titleKey, locale)}
                  </div>
                  {sec.items.map(item => (
                    <MenuLeaf
                      key={item.titleKey}
                      item={item}
                      locale={locale}
                      active={!wipKey && item.view === view && !(item.flowCode && view === "start" && !startDef)}
                      onClick={() => { setWipKey(null); openItem(item); }}
                    />
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </aside>

      {/* 内容区 */}
      <main style={{ flex: 1, minWidth: 0 }}>
        {error && !wipKey && view !== "start" && <p style={{ color: "var(--danger, #b91c1c)" }}>{t("empty.loadFailed", locale)}: {error}</p>}
        {content}
      </main>
    </div>
  );
}
