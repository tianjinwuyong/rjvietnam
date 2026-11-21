import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi, oaDocApi, oaFileUrl,
  type OaDepartment, type OaDocAttachmentRow, type OaDocDetail, type OaDocRow,
  type OaProfile,
} from "./oaApi";
import { t } from "./i18n";
import { DocLedger, LedgerTable } from "./DocLedger";

/**
 * 体系文件 —— 对齐原版页面组：
 * 文档库（列表+详情）/ 新建体系文件 / 台账（7 类 tab）/ 发放回收 / 作废清单 / 外来文件。
 * 台账见 DocLedger.tsx（消费后端双语 columns）。
 */

export type DocsSubView = "docs" | "docNew" | "docLedger" | "docIssueRecord" | "docObsolete" | "docExternal";

const CATEGORIES: Array<{ value: string; key: string }> = [
  { value: "l1_manual", key: "docSec.catL1Manual" },
  { value: "l2_procedure", key: "docSec.catL2Procedure" },
  { value: "l3_manage", key: "docSec.catL3Manage" },
  { value: "l4_form", key: "docSec.catL4Form" },
  { value: "product_l3", key: "docSec.catProductL3" },
  { value: "external", key: "docSec.catExternal" },
  { value: "temporary", key: "docSec.catTemporary" },
];

/** 分类 → 默认文件级别（与编号规则联动，见 doc-service.js CATEGORY_PREFIX） */
const CAT_LEVEL: Record<string, string> = {
  l1_manual: "1", l2_procedure: "2", l3_manage: "3", l4_form: "4", product_l3: "3",
};

function catText(cat: string | null | undefined, locale: Locale): string {
  const map: Record<string, string> = {
    l1_manual: "docSec.catL1Manual",
    l2_procedure: "docSec.catL2Procedure",
    l3_manage: "docSec.catL3Manage",
    l4_form: "docSec.catL4Form",
    external: "docSec.catExternal",
    temporary: "docSec.catTemporary",
  };
  const key = map[cat || ""] || "";
  return key && t(key, locale) !== key ? t(key, locale) : (cat ?? "-");
}

function levelText(level: number | string | null | undefined, locale: Locale): string {
  const key = `doc.lv${level}`;
  return t(key, locale) === key ? String(level ?? "-") : t(key, locale);
}

function statusText(status: string | null | undefined, locale: Locale): string {
  const key = `docStatus.${status}`;
  return t(key, locale) === key ? (status ?? "-") : t(key, locale);
}

const STATUS_COLORS: Record<string, string> = {
  published: "#15803d",
  draft: "#64748b",
  reviewing: "#b45309",
  rejected: "#b91c1c",
  obsolete: "#64748b",
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function fmtSize(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!v) return "";
  if (v >= 1024 * 1024) return ` · ${(v / 1024 / 1024).toFixed(1)} MB`;
  if (v >= 1024) return ` · ${(v / 1024).toFixed(0)} KB`;
  return ` · ${v} B`;
}

// ============ 文档库列表 ============

function DocsList({
  locale, profile, onOpen, onNew, onLedger,
}: {
  locale: Locale;
  profile: OaProfile | null;
  onOpen: (id: OaDocRow["id"]) => void;
  onNew: () => void;
  onLedger: () => void;
}) {
  const [rows, setRows] = useState<OaDocRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 20;
  const canEdit = !!profile?.isAdmin || (profile?.permissions || []).includes("doc:edit");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const q: Record<string, unknown> = { page: p, size: pageSize };
      if (keyword.trim()) q.keyword = keyword.trim();
      if (level) q.level = level;
      if (status) q.status = status;
      const r = await oaDocApi.docs(q);
      setRows(r.list || []);
      setTotal(r.total || 0);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, level, status]);

  useEffect(() => { void load(1); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {canEdit && (
          <button
            onClick={onNew}
            style={{ padding: "7px 14px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600 }}
          >{t("doc.newDoc", locale)}</button>
        )}
        <button onClick={onLedger} style={{ padding: "7px 12px", cursor: "pointer" }}>{t("docSec.ledgerEntry", locale)}</button>
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder={t("doc.searchKeyword", locale)}
          style={{ width: 220, padding: "6px 10px" }}
          onKeyDown={e => { if (e.key === "Enter") void load(1); }}
        />
        <select value={level} onChange={e => setLevel(e.target.value)} style={{ padding: "6px 8px" }}>
          <option value="">{t("doc.allLevel", locale)}</option>
          {[1, 2, 3, 4].map(l => <option key={l} value={l}>{levelText(l, locale)}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ padding: "6px 8px" }}>
          <option value="">{t("doc.allStatus", locale)}</option>
          {["draft", "reviewing", "published", "rejected", "obsolete"].map(s => (
            <option key={s} value={s}>{statusText(s, locale)}</option>
          ))}
        </select>
        <button onClick={() => void load(1)} style={{ cursor: "pointer" }}>{t("common.search", locale)}</button>
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      {loading ? <div className="empty-state">{t("common.loading", locale)}</div>
        : !rows || rows.length === 0 ? <div className="empty-state">{t("doc.noData", locale)}</div>
          : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>
                {t("doc.totalCount", locale, { n: total })}
              </div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("doc.code", locale)}</th>
                      <th>{t("doc.docTitle", locale)}</th>
                      <th style={{ width: 130 }}>{t("doc.category", locale)}</th>
                      <th style={{ width: 90 }}>{t("doc.level", locale)}</th>
                      <th style={{ width: 70 }}>{t("doc.version", locale)}</th>
                      <th style={{ width: 110 }}>{t("doc.ownerDept", locale)}</th>
                      <th style={{ width: 90 }}>{t("announce.status", locale)}</th>
                      <th style={{ width: 110 }}>{t("doc.issueTime", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={String(row.id)} style={{ cursor: "pointer" }} onClick={() => onOpen(row.id)}>
                        <td>{row.code}</td>
                        <td>{locale === "vi-VN" && row.title_vi ? row.title_vi : row.title}</td>
                        <td>{catText(row.category, locale)}</td>
                        <td>{levelText(row.level, locale)}</td>
                        <td>V{row.current_version ?? "-"}</td>
                        <td>{row.owner_dept ?? "-"}</td>
                        <td style={{ color: STATUS_COLORS[row.status || ""] ?? undefined, fontWeight: 600 }}>
                          {statusText(row.status, locale)}
                        </td>
                        <td>{fmtDate(row.issue_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > pageSize && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <button disabled={page <= 1} onClick={() => void load(page - 1)} style={{ cursor: "pointer" }}>←</button>
                  <span style={{ fontSize: 13 }}>{page} / {totalPages} · {total}</span>
                  <button disabled={page >= totalPages} onClick={() => void load(page + 1)} style={{ cursor: "pointer" }}>→</button>
                </div>
              )}
            </>
          )}
    </div>
  );
}

// ============ 文档详情 ============

function DocDetail({ id, locale, onBack }: { id: OaDocRow["id"]; locale: Locale; onBack: () => void }) {
  const [doc, setDoc] = useState<OaDocDetail | null>(null);
  const [atts, setAtts] = useState<OaDocAttachmentRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    oaDocApi.doc(id, locale === "vi-VN" ? "vi" : "zh")
      .then(d => { if (!cancelled) setDoc(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    oaDocApi.docAttachments(id)
      .then(list => { if (!cancelled) setAtts(list || []); })
      .catch(() => { /* 附件可缺省 */ });
    return () => { cancelled = true; };
  }, [id, locale]);

  if (error) return <div className="empty-state">{t("empty.loadFailed", locale)}: {error}</div>;
  if (!doc) return <div className="empty-state">{t("common.loading", locale)}</div>;

  const langRow = locale === "vi-VN" ? doc.currentLang?.vi : doc.currentLang?.zh;
  const content = langRow?.content ?? doc.content ?? "";
  const downloadBase = (p: string) => oaFileUrl(p);

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 10, cursor: "pointer" }}>← {t("docSec.backToDocs", locale)}</button>

      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 6px" }}>
          {doc.code} · {locale === "vi-VN" && doc.title_vi ? doc.title_vi : doc.title}
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>
          <span>{catText(doc.category, locale)}</span>
          <span>{levelText(doc.level, locale)}</span>
          <span>V{doc.current_version ?? "-"}</span>
          <span style={{ color: STATUS_COLORS[doc.status || ""] ?? undefined, fontWeight: 600 }}>
            {statusText(doc.status, locale)}
          </span>
          <span>{t("doc.ownerDept", locale)}：{doc.owner_dept ?? "-"}</span>
          <span>{t("doc.editor", locale)}：{doc.created_by_name ?? "-"}</span>
          <span>{t("doc.issueTime", locale)}：{fmtDate(doc.issue_date)}</span>
          {doc.next_review_date ? <span>{t("doc.nextReview", locale)}：{fmtDate(doc.next_review_date)}</span> : null}
        </div>
        {doc.security_level === "secret" && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}>{t("docSec.secretBanner", locale)}</p>
        )}
      </div>

      {/* 正文 */}
      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 8px" }}>
          {t("doc.content", locale)}
          {doc.missingLang ? <span style={{ marginLeft: 8, fontSize: 12, color: "#b45309" }}>{t("docSec.missingLangHint", locale)}</span> : null}
        </h4>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7 }}>
          {content || t("common.empty", locale)}
        </div>
      </div>

      {/* 版本履历 */}
      {(doc.versions?.length ?? 0) > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("doc.versionHistory", locale)}</h4>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>V</th>
                  <th>{t("doc.reviewNote", locale)}</th>
                  <th style={{ width: 110 }}>{t("doc.editor", locale)}</th>
                  <th style={{ width: 110 }}>{t("doc.issueTime", locale)}</th>
                  <th style={{ width: 110 }}>{t("docSec.langCoverage", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {doc.versions.map(v => (
                  <tr key={String(v.id)}>
                    <td>V{v.version}</td>
                    <td>{v.change_log ?? "-"}</td>
                    <td>{v.editor_name ?? "-"}</td>
                    <td>{fmtDate(v.published_at)}</td>
                    <td>{(v.has_zh ? "中" : "") + (v.has_vi ? "越" : "") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 附件 / 受控原件 */}
      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 8px" }}>{t("common.attachment", locale)}</h4>
        {atts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("doc.noOriginal", locale)}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {atts.map(a => (
              <div key={String(a.id)} style={{ fontSize: 13 }}>
                📄 <a href={downloadBase(a.file_path)} target="_blank" rel="noreferrer">{a.file_name}</a>
                <span style={{ color: "var(--text-muted, #64748b)" }}>{fmtSize(a.file_size)} · {a.uploader_name ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 关联文件 */}
      {(doc.relations?.length ?? 0) > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px" }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("docSec.relations", locale)}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {doc.relations.map(r => (
              <div key={String(r.id)} style={{ fontSize: 13 }}>
                {t(`docSec.rel_${r.relation_type || "related"}`, locale) === `docSec.rel_${r.relation_type || "related"}`
                  ? (r.relation_type ?? "-")
                  : t(`docSec.rel_${r.relation_type || "related"}`, locale)}
                ：{r.code} {locale === "vi-VN" && r.title_vi ? r.title_vi : r.title}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 新建体系文件 ============

function DocNew({ locale, profile, onCreated }: { locale: Locale; profile: OaProfile | null; onCreated: (id: OaDocRow["id"]) => void }) {
  const [depts, setDepts] = useState<OaDepartment[]>([]);
  const [title, setTitle] = useState("");
  const [titleVi, setTitleVi] = useState("");
  const [category, setCategory] = useState("l3_manage");
  const [level, setLevel] = useState("3");
  const [security, setSecurity] = useState("public");
  const [deptId, setDeptId] = useState("");
  const [content, setContent] = useState("");
  const [codePreview, setCodePreview] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canEdit = !!profile?.isAdmin || (profile?.permissions || []).includes("doc:edit");

  useEffect(() => {
    oaApi.departments().then(list => setDepts(list || [])).catch(() => setDepts([]));
  }, []);

  // 编号预览（只读，不消耗序号；正式取号在保存时）
  useEffect(() => {
    if (!canEdit || !deptId) { setCodePreview(""); return; }
    let cancelled = false;
    oaDocApi.nextCode({ level, category, deptId })
      .then(r => { if (!cancelled) setCodePreview(r.code || ""); })
      .catch(() => { if (!cancelled) setCodePreview(""); });
    return () => { cancelled = true; };
  }, [category, level, deptId, canEdit]);

  if (!canEdit) return <div className="empty-state">{t("common.noPermission", locale)}</div>;

  const submit = async () => {
    setError("");
    if (!title.trim()) { setError(t("doc.inputTitle", locale)); return; }
    if (!deptId) { setError(t("doc.selectDeptFirst", locale)); return; }
    setBusy(true);
    try {
      let staged: { fileName: string; filePath: string; fileSize: number; mimeType: string } | null = null;
      if (file) {
        const up = await oaApi.upload(file);
        staged = { fileName: up.fileName || file.name, filePath: up.tempRelPath || up.filePath || "", fileSize: up.fileSize, mimeType: up.mimeType };
      }
      const doc = await oaDocApi.createDoc({
        title: title.trim(),
        titleVi: titleVi.trim() || null,
        level: Number(level),
        category,
        ownerDeptId: deptId,
        content: content || null,
        securityLevel: security,
      });
      if (staged) {
        await oaDocApi.addDocAttachment(doc.id, staged).catch(() => { /* 绑定失败不阻断 */ });
      }
      onCreated(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-panel" style={{ padding: "16px 18px", maxWidth: 760 }}>
      <h3 style={{ margin: "0 0 14px" }}>{t("docExtra.newDocTitle", locale)}</h3>

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.docTitle", locale)} *</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("docExtra.titlePlaceholder", locale)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("docSec.docTitleVi", locale)}</label>
      <input value={titleVi} onChange={e => setTitleVi(e.target.value)} placeholder={t("docSec.titleViPlaceholder", locale)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.category", locale)}</label>
          <select
            value={category}
            onChange={e => {
              setCategory(e.target.value);
              const lv = CAT_LEVEL[e.target.value];
              if (lv) setLevel(lv);
            }}
            style={{ padding: "6px 8px", minWidth: 160 }}
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(c.key, locale)}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.level", locale)}</label>
          <select value={level} onChange={e => setLevel(e.target.value)} style={{ padding: "6px 8px" }}>
            {[1, 2, 3, 4].map(l => <option key={l} value={l}>{t(`doc.level${l}`, locale)}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.secretLevel", locale)}</label>
          <select value={security} onChange={e => setSecurity(e.target.value)} style={{ padding: "6px 8px" }}>
            <option value="public">{t("docSec.public", locale)}</option>
            <option value="secret">{t("docSec.secret", locale)}</option>
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.ownerDept", locale)} *</label>
          <select value={deptId} onChange={e => setDeptId(e.target.value)} style={{ padding: "6px 8px", minWidth: 180 }}>
            <option value="">{t("docExtra.deptPlaceholder", locale)}</option>
            {depts.map(d => <option key={String(d.id)} value={String(d.id)}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {codePreview && (
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          {t("doc.code", locale)}：<b>{codePreview}</b>
          <span style={{ color: "var(--text-muted, #64748b)", marginLeft: 8 }}>{t("doc.autoCodeHint", locale)}</span>
        </div>
      )}

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.content", locale)}</label>
      <textarea value={content} onChange={e => setContent(e.target.value)} rows={8} placeholder={t("docExtra.contentHint", locale)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, resize: "vertical" }} />

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("doc.original", locale)}</label>
      <input type="file" accept=".doc,.docx,.xls,.xlsx,.pdf"
        onChange={e => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
        style={{ marginBottom: 4 }} />
      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 12 }}>
        {file ? file.name : t("docExtra.originalAccept", locale)} · {t("docExtra.originalRoleHint", locale)}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={() => void submit()}
          style={{ padding: "8px 18px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
          {t("common.save", locale)}
        </button>
        {busy && <span style={{ alignSelf: "center", fontSize: 13 }}>{t("common.loading", locale)}</span>}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 0 }}>{t("doc.createHint", locale)}</p>
    </div>
  );
}

// ============ 出口 ============

export function DocsView({
  locale, sub, onNavigate,
}: {
  locale: Locale;
  sub: DocsSubView;
  /** 子视图切换（新建/台账入口由列表页发起，路由归 OaModule 管） */
  onNavigate: (sub: DocsSubView) => void;
}) {
  const [profile, setProfile] = useState<OaProfile | null>(null);
  const [detailId, setDetailId] = useState<OaDocRow["id"] | null>(null);

  useEffect(() => {
    oaApi.profile().then(setProfile).catch(() => setProfile(null));
  }, []);

  if (sub === "docLedger") return <DocLedger locale={locale} />;
  if (sub === "docIssueRecord") return <LedgerTable key="issue" locale={locale} type="issue" />;
  if (sub === "docObsolete") return <LedgerTable key="obsolete" locale={locale} type="obsolete" />;
  if (sub === "docExternal") return <LedgerTable key="external" locale={locale} type="external" />;

  if (sub === "docNew") {
    return (
      <DocNew
        locale={locale}
        profile={profile}
        onCreated={id => { setDetailId(id); onNavigate("docs"); }}
      />
    );
  }

  // docs（文档库）：详情 / 列表
  if (detailId !== null) {
    return <DocDetail id={detailId} locale={locale} onBack={() => setDetailId(null)} />;
  }
  return <DocsList locale={locale} profile={profile} onOpen={setDetailId} onNew={() => onNavigate("docNew")} onLedger={() => onNavigate("docLedger")} />;
}
