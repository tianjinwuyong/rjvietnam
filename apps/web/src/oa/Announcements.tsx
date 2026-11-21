import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi,
  type OaAnnouncement,
  type OaAnnouncementReadRow,
  type OaAnnouncementSaveBody,
  type OaAnnouncementUnreadRow,
  type OaProfile,
} from "./oaApi";
import { t } from "./i18n";

/**
 * 通知通告管理 —— 对齐原版 Announcements 页：
 * 工具栏（新建/关键词/状态/分类/查询）+ 列表（置顶/状态/已读数/操作）+
 * 编辑器（双语标题正文、分类、置顶、定时发布、失效时间）+ 详情（正文 + 阅读回执）。
 * 管理权与后端一致：管理员或发布者本人（编辑/发布/删除/看回执）。
 */

const CATEGORIES = ["notice", "policy", "event", "urgent"] as const;

function catKey(cat: string | null | undefined): string {
  return `announce.cat_${cat || "notice"}`;
}

function fmtDateTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(locale === "vi-VN" ? "vi-VN" : locale === "en-US" ? "en-US" : "zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

/** timestamptz → datetime-local 输入值（YYYY-MM-DDTHH:mm，本地时区） */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabel(status: string | null | undefined, locale: Locale): string {
  if (status === "published") return t("announce.stPublished", locale);
  return t("announce.stDraft", locale);
}

interface EditorState {
  id: OaAnnouncement["id"] | null; // null = 新建
  title: string;
  titleVi: string;
  content: string;
  contentVi: string;
  category: string;
  top: boolean;
  publishAt: string; // datetime-local 值
  expireAt: string;
}

const EMPTY_EDITOR: EditorState = {
  id: null, title: "", titleVi: "", content: "", contentVi: "",
  category: "notice", top: false, publishAt: "", expireAt: "",
};

export function Announcements({ locale }: { locale: Locale }) {
  const [profile, setProfile] = useState<OaProfile | null>(null);
  const [rows, setRows] = useState<OaAnnouncement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [detail, setDetail] = useState<OaAnnouncement | null>(null);
  const [receipt, setReceipt] = useState<{ read: OaAnnouncementReadRow[]; unread: OaAnnouncementUnreadRow[] } | null>(null);

  const isAdmin = !!profile?.isAdmin;
  const canManageRow = (row: OaAnnouncement) => isAdmin || (profile?.id != null && Number(row.publisher_id) === Number(profile.id));
  const pageSize = 20;

  const load = useCallback(async (opts?: { page?: number }) => {
    setLoading(true);
    setError("");
    try {
      const q: { keyword?: string; status?: string; category?: string; page: number; pageSize: number } = {
        page: opts?.page ?? 1, pageSize,
      };
      if (keyword.trim()) q.keyword = keyword.trim();
      if (statusFilter) q.status = statusFilter;
      if (categoryFilter) q.category = categoryFilter;
      const r = await oaApi.announcements(q);
      setRows(r.list || []);
      setTotal(r.total || 0);
      setPage(r.page || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter, categoryFilter]);

  useEffect(() => {
    oaApi.profile().then(setProfile).catch(() => setProfile(null));
  }, []);

  useEffect(() => { void load({ page: 1 }); }, [load]);

  const openDetail = async (row: OaAnnouncement) => {
    setError("");
    try {
      const d = await oaApi.announcement(row.id); // 读取即记已读（后端口径）
      setDetail(d);
      setReceipt(null);
      if (canManageRow(row)) {
        oaApi.announcementReads(row.id).then(setReceipt).catch(() => setReceipt(null));
      }
      // 列表行的未读状态就地刷新
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, is_read: true } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openEdit = (row: OaAnnouncement) => {
    setEditor({
      id: row.id,
      title: row.title || "",
      titleVi: row.title_vi || "",
      content: row.content || "",
      contentVi: row.content_vi || "",
      category: row.category || "notice",
      top: !!row.top,
      publishAt: toLocalInput(row.publish_at),
      expireAt: toLocalInput(row.expire_at),
    });
  };

  const saveEditor = async (andPublish: boolean) => {
    if (!editor) return;
    if (!editor.title.trim()) {
      setError(t("announce.needTitle", locale));
      return;
    }
    setEditorBusy(true);
    setError("");
    try {
      const body: OaAnnouncementSaveBody = {
        title: editor.title.trim(),
        titleVi: editor.titleVi.trim() || null,
        content: editor.content || null,
        contentVi: editor.contentVi || null,
        category: editor.category,
        top: editor.top,
        publishAt: editor.publishAt || null,
        expireAt: editor.expireAt || null,
      };
      if (editor.id !== null) {
        await oaApi.updateAnnouncement(editor.id, body);
        if (andPublish) await oaApi.publishAnnouncement(editor.id);
        setMessage(andPublish ? t("announce.published", locale) : t("common.success", locale));
      } else {
        await oaApi.createAnnouncement({ ...body, status: andPublish ? "published" : "draft" });
        setMessage(andPublish ? t("announce.published", locale) : t("announce.saved", locale));
      }
      setEditor(null);
      await load({ page });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditorBusy(false);
    }
  };

  const publishRow = async (row: OaAnnouncement) => {
    if (!window.confirm(t("announce.publishConfirm", locale, { title: row.title }))) return;
    setError("");
    try {
      await oaApi.publishAnnouncement(row.id);
      setMessage(t("announce.published", locale));
      await load({ page });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteRow = async (row: OaAnnouncement) => {
    if (!window.confirm(t("announce.deleteConfirm", locale, { title: row.title }))) return;
    setError("");
    try {
      await oaApi.deleteAnnouncement(row.id);
      setMessage(t("common.success", locale));
      await load({ page });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ---- 详情视图 ----
  if (detail) {
    const d = detail;
    return (
      <div>
        <button onClick={() => setDetail(null)} style={{ marginBottom: 10, cursor: "pointer" }}>
          ← {t("common.back", locale)}
        </button>
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 6px" }}>
            {d.top ? "📌 " : ""}{locale === "vi-VN" && d.title_vi ? d.title_vi : d.title}
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>
            <span>{t(catKey(d.category), locale)}</span>
            <span>{t("announce.publisher", locale)}：{d.publisher_name ?? "-"}</span>
            <span>{t("announce.publishAt", locale)}：{fmtDateTime(d.publish_at ?? d.created_at, locale)}</span>
            {d.expire_at ? <span>{t("announce.expireAt", locale)}：{fmtDateTime(d.expire_at, locale)}</span> : null}
            <span>{statusLabel(d.status, locale)}</span>
          </div>
        </div>
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7 }}>
          {locale === "vi-VN" && d.content_vi ? d.content_vi : (d.content || t("common.empty", locale))}
        </div>
        {receipt && (
          <div className="surface-panel" style={{ padding: "14px 16px" }}>
            <h4 style={{ margin: "0 0 8px" }}>
              {t("announce.readReceipt", locale)} · {(d.read_count ?? receipt.read.length)} {t("announce.readUnit", locale)}
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {receipt.read.map(r => (
                <span key={String(r.user_id)} style={{ fontSize: 13, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 999, padding: "2px 10px" }}>
                  {r.real_name ?? r.user_id}{r.dept_name ? ` · ${r.dept_name}` : ""}
                </span>
              ))}
              {receipt.read.length === 0 && <span style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("common.empty", locale)}</span>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>
              {t("announce.unreadTag", locale)} · {receipt.unread.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {receipt.unread.map(r => (
                <span key={String(r.user_id)} style={{ fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 10px", color: "var(--text-muted, #64748b)" }}>
                  {r.real_name ?? r.user_id}{r.dept_name ? ` · ${r.dept_name}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- 列表视图 ----
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {isAdmin && (
          <button
            onClick={() => setEditor({ ...EMPTY_EDITOR })}
            style={{ padding: "7px 14px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600 }}
          >{t("announce.new", locale)}</button>
        )}
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder={t("announce.keyword", locale)}
          style={{ width: 220, padding: "6px 10px" }}
          onKeyDown={e => { if (e.key === "Enter") void load({ page: 1 }); }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "6px 8px" }}>
          <option value="">{t("announce.status", locale)}</option>
          <option value="draft">{t("announce.stDraft", locale)}</option>
          <option value="published">{t("announce.stPublished", locale)}</option>
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ padding: "6px 8px" }}>
          <option value="">{t("announce.category", locale)}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{t(`announce.cat_${c}`, locale)}</option>)}
        </select>
        <button onClick={() => void load({ page: 1 })} style={{ cursor: "pointer" }}>{t("common.search", locale)}</button>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      {loading ? <div className="empty-state">{t("common.loading", locale)}</div> : rows.length === 0 ? (
        <div className="empty-state">{t("announce.noData", locale)}</div>
      ) : (
        <>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("announce.docTitle", locale)}</th>
                  <th style={{ width: 90 }}>{t("announce.category", locale)}</th>
                  <th style={{ width: 110 }}>{t("announce.publisher", locale)}</th>
                  <th style={{ width: 150 }}>{t("announce.publishAt", locale)}</th>
                  <th style={{ width: 150 }}>{t("announce.expireAt", locale)}</th>
                  <th style={{ width: 90 }}>{t("announce.status", locale)}</th>
                  <th style={{ width: 70 }}>{t("announce.readCountShort", locale)}</th>
                  <th style={{ width: 170 }}>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={String(row.id)}>
                    <td style={{ cursor: "pointer", fontWeight: row.is_read ? 400 : 700 }} onClick={() => void openDetail(row)}>
                      {row.top ? "📌 " : ""}{locale === "vi-VN" && row.title_vi ? row.title_vi : row.title}
                      {row.content ? (
                        <div style={{ color: "var(--text-muted, #64748b)", fontWeight: 400, fontSize: 12, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {locale === "vi-VN" && row.content_vi ? row.content_vi : row.content}
                        </div>
                      ) : null}
                    </td>
                    <td>{t(catKey(row.category), locale)}</td>
                    <td>{row.publisher_name ?? "-"}</td>
                    <td>{fmtDateTime(row.publish_at ?? row.created_at, locale)}</td>
                    <td>{row.expire_at ? fmtDateTime(row.expire_at, locale) : "—"}</td>
                    <td>
                      <span style={{
                        fontSize: 12, borderRadius: 4, padding: "1px 8px",
                        background: row.status === "published" ? "#ecfdf5" : "#f1f5f9",
                        color: row.status === "published" ? "#15803d" : "#64748b",
                      }}>{statusLabel(row.status, locale)}</span>
                    </td>
                    <td>{row.read_count ?? 0}{row.is_read ? "" : <span style={{ color: "#b45309" }}> · {t("announce.unreadTag", locale)}</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => void openDetail(row)} style={{ cursor: "pointer", fontSize: 12 }}>{t("common.detail", locale)}</button>
                        {canManageRow(row) && (
                          <>
                            <button onClick={() => openEdit(row)} style={{ cursor: "pointer", fontSize: 12 }}>{t("common.edit", locale)}</button>
                            {row.status !== "published" && (
                              <button onClick={() => void publishRow(row)} style={{ cursor: "pointer", fontSize: 12 }}>{t("announce.publish", locale)}</button>
                            )}
                            <button onClick={() => void deleteRow(row)} style={{ cursor: "pointer", fontSize: 12, color: "#b91c1c" }}>{t("common.delete", locale)}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > pageSize && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <button disabled={page <= 1} onClick={() => void load({ page: page - 1 })} style={{ cursor: "pointer" }}>←</button>
              <span style={{ fontSize: 13 }}>{page} / {totalPages} · {total}</span>
              <button disabled={page >= totalPages} onClick={() => void load({ page: page + 1 })} style={{ cursor: "pointer" }}>→</button>
            </div>
          )}
        </>
      )}

      {/* ---- 编辑器 ---- */}
      {editor && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60,
          display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto",
        }} onClick={() => { if (!editorBusy) setEditor(null); }}>
          <div
            className="surface-panel"
            style={{ width: 640, maxWidth: "100%", padding: "18px 20px", background: "white" }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 14px" }}>{editor.id === null ? t("announce.new", locale) : t("common.edit", locale)}</h3>

            <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.docTitle", locale)} *</label>
            <input value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })}
              placeholder={t("announce.titleZhPlaceholder", locale)} style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

            <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.docTitleVi", locale)}</label>
            <input value={editor.titleVi} onChange={e => setEditor({ ...editor, titleVi: e.target.value })}
              placeholder={t("announce.titleViPlaceholder", locale)} style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

            <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.content", locale)}</label>
            <textarea value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })}
              rows={4} placeholder={t("announce.contentZhPlaceholder", locale)}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, resize: "vertical" }} />

            <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.contentVi", locale)}</label>
            <textarea value={editor.contentVi} onChange={e => setEditor({ ...editor, contentVi: e.target.value })}
              rows={4} placeholder={t("announce.contentViPlaceholder", locale)}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, resize: "vertical" }} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <div>
                <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.category", locale)}</label>
                <select value={editor.category} onChange={e => setEditor({ ...editor, category: e.target.value })} style={{ padding: "6px 8px" }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{t(`announce.cat_${c}`, locale)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.publishAt", locale)}</label>
                <input type="datetime-local" value={editor.publishAt} onChange={e => setEditor({ ...editor, publishAt: e.target.value })}
                  style={{ padding: "5px 8px" }} />
                <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 3 }}>{t("announce.publishAtHint", locale)}</div>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("announce.expireAt", locale)}</label>
                <input type="datetime-local" value={editor.expireAt} onChange={e => setEditor({ ...editor, expireAt: e.target.value })}
                  style={{ padding: "5px 8px" }} />
                <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 3 }}>{t("announce.expireAtHint", locale)}</div>
              </div>
            </div>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={editor.top} onChange={e => setEditor({ ...editor, top: e.target.checked })} />
              {t("announce.top", locale)}
            </label>

            {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={editorBusy} onClick={() => void saveEditor(false)}
                style={{ padding: "7px 16px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}>
                {editor.id === null ? t("announce.saveDraft", locale) : t("common.save", locale)}
              </button>
              <button disabled={editorBusy} onClick={() => void saveEditor(true)}
                style={{ padding: "7px 16px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
                {editor.id === null ? t("announce.savePublish", locale) : t("announce.publish", locale)}
              </button>
              <button disabled={editorBusy} onClick={() => setEditor(null)}
                style={{ padding: "7px 16px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}>
                {t("common.cancel", locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
