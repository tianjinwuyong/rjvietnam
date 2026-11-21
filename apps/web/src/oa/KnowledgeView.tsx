import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi, oaKnowledgeApi, oaFileUrl,
  type OaKnowledgeRow, type OaKnowledgeVersionRow,
} from "./oaApi";
import { t } from "./i18n";

/**
 * 知识共享 —— 对齐原版 /knowledge 单页：
 * 목록(상태/키워드 필터) + 업로드(승인 대기) + 열람/다운로드 카운터 +
 * 승인/반려(부서장·관리자) + 신규 버전 업로드 + 버전 이력.
 */

function fmtSize(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!v) return "—";
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function statusText(status: string | null | undefined, locale: Locale): string {
  const key = `knowledge.${status}`;
  return t(key, locale) === key ? (status ?? "-") : t(key, locale);
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#b45309",
  approved: "#15803d",
  rejected: "#b91c1c",
};

// ============ 업로드 폼 (신규 / 신규 버전 공용) ============

function UploadForm({
  locale, base, onDone, onCancel,
}: {
  locale: Locale;
  base: OaKnowledgeRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isVersion = base !== null;
  const [title, setTitle] = useState(base?.title ?? "");
  const [category, setCategory] = useState(base?.category ?? "");
  const [desc, setDesc] = useState(base?.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!file) { setError(t("knowledgeExtra.chooseFile", locale)); return; }
    if (!isVersion && !title.trim()) { setError(t("knowledge.docTitle", locale)); return; }
    setBusy(true);
    try {
      const up = await oaApi.upload(file);
      const body = {
        title: isVersion ? undefined : title.trim(),
        category: category.trim() || null,
        description: desc.trim() || null,
        filePath: up.tempRelPath || up.filePath || "",
        fileSize: up.fileSize,
      };
      if (isVersion) await oaKnowledgeApi.createVersion(base!.id, body);
      else await oaKnowledgeApi.create(body as { title: string; filePath: string });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-panel" style={{ padding: "16px 18px", maxWidth: 640 }}>
      <h3 style={{ margin: "0 0 12px" }}>
        {isVersion ? t("knowledge.newVersionTitle", locale) : t("knowledge.uploadTitle", locale)}
      </h3>
      {isVersion && (
        <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 10px" }}>
          {t("knowledge.versionLocked", locale)} · {t("knowledge.versionTransition", locale, { n: Number(base!.version ?? 1), m: Number(base!.version ?? 1) + 1 })}
        </p>
      )}

      {!isVersion && (
        <>
          <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("knowledge.docTitle", locale)} *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
        </>
      )}

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("knowledge.category", locale)}</label>
      <input value={category} onChange={e => setCategory(e.target.value)} placeholder={t("knowledge.catPlaceholder", locale)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("knowledgeExtra.descLabel", locale)}</label>
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder={t("knowledgeExtra.descPlaceholder", locale)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, resize: "vertical" }} />

      <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("knowledge.file", locale)} *</label>
      <input type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.hwp"
        onChange={e => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
        style={{ marginBottom: 4 }} />
      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 12 }}>
        {file ? file.name : t("knowledgeExtra.fileHint", locale)}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={() => void submit()}
          style={{ padding: "8px 18px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
          {t("common.save", locale)}
        </button>
        <button onClick={onCancel} style={{ padding: "8px 14px", cursor: "pointer" }}>{t("common.cancel", locale)}</button>
        {busy && <span style={{ alignSelf: "center", fontSize: 13 }}>{t("common.loading", locale)}</span>}
      </div>
      {!isVersion && <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 0 }}>{t("knowledgeExtra.openHint", locale)}</p>}
    </div>
  );
}

// ============ 버전 이력 ============

function VersionHistory({ id, locale, onBack }: { id: OaKnowledgeRow["id"]; locale: Locale; onBack: () => void }) {
  const [rows, setRows] = useState<OaKnowledgeVersionRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    oaKnowledgeApi.versions(id)
      .then(r => setRows(r || []))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>;
  if (!rows) return <div className="empty-state">{t("common.loading", locale)}</div>;

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 10, cursor: "pointer" }}>← {t("docSec.backToDocs", locale)}</button>
      <h3 style={{ margin: "0 0 10px" }}>{t("knowledge.historyTitle", locale)}</h3>
      {rows.length === 0 ? <div className="empty-state">{t("knowledge.noHistory", locale)}</div> : (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>{t("knowledge.verCol", locale)}</th>
                <th>{t("knowledge.docTitle", locale)}</th>
                <th style={{ width: 100 }}>{t("knowledge.verStatus", locale)}</th>
                <th style={{ width: 110 }}>{t("knowledge.verUploader", locale)}</th>
                <th style={{ width: 110 }}>{t("knowledge.verTime", locale)}</th>
                <th style={{ width: 90 }}>{t("common.attachment", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(v => (
                <tr key={String(v.id)}>
                  <td>v{v.version}{v.is_current ? ` (${t("knowledge.verCurrent", locale)})` : ""}</td>
                  <td>{v.title}</td>
                  <td style={{ color: STATUS_COLORS[v.status] ?? undefined }}>{statusText(v.status, locale)}</td>
                  <td>{v.uploader_name ?? "-"}</td>
                  <td>{fmtDate(v.created_at)}</td>
                  <td>
                    {v.file_path && v.status === "approved" ? (
                      <a href={oaFileUrl(v.file_path)} target="_blank" rel="noreferrer">{t("driveExtra.menuDownload", locale)}</a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ 메인 목록 ============

export function KnowledgeView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<OaKnowledgeRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"list" | "upload" | "newver">("list");
  const [base, setBase] = useState<OaKnowledgeRow | null>(null);
  const [historyId, setHistoryId] = useState<OaKnowledgeRow["id"] | null>(null);
  const [profile, setProfile] = useState<{ isAdmin: boolean; permissions: string[] } | null>(null);
  const pageSize = 20;

  useEffect(() => {
    oaApi.profile().then(p => setProfile({ isAdmin: !!p.isAdmin, permissions: p.permissions || [] })).catch(() => setProfile(null));
  }, []);

  const canManage = !!profile?.isAdmin || (profile?.permissions || []).includes("knowledge:manage");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const q: Record<string, unknown> = { page: p, size: pageSize };
      if (status) q.status = status;
      if (keyword.trim()) q.keyword = keyword.trim();
      const r = await oaKnowledgeApi.list(q);
      setRows(r.list || []);
      setTotal(r.total || 0);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, keyword]);

  useEffect(() => { void load(1); }, [load]);

  const openDoc = async (row: OaKnowledgeRow) => {
    if (row.status === "approved") {
      await oaKnowledgeApi.view(row.id).catch(() => { /* 카운터 실패 무시 */ });
    }
    if (row.file_path && row.status === "approved") {
      window.open(oaFileUrl(row.file_path), "_blank");
    } else if (row.status !== "approved") {
      setMessage(t("knowledge.downloadDenied", locale));
    }
    void load(page);
  };

  const download = async (row: OaKnowledgeRow) => {
    try {
      const r = await oaKnowledgeApi.download(row.id);
      if (r.filePath) window.open(oaFileUrl(r.filePath), "_blank");
      void load(page);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const doApprove = async (row: OaKnowledgeRow, action: "approve" | "reject") => {
    try {
      await oaKnowledgeApi.approve(row.id, action);
      setMessage(action === "approve" ? t("knowledge.openOk", locale) : t("knowledge.rejectOk", locale));
      void load(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (mode === "upload") {
    return <KnowledgeUploadNew locale={locale} onDone={() => { setMode("list"); void load(1); }} onCancel={() => setMode("list")} />;
  }
  if (mode === "newver" && base) {
    return <UploadForm locale={locale} base={base} onDone={() => { setMode("list"); setBase(null); void load(page); }} onCancel={() => { setMode("list"); setBase(null); }} />;
  }
  if (historyId !== null) {
    return <VersionHistory id={historyId} locale={locale} onBack={() => setHistoryId(null)} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const btn = { padding: "4px 10px", cursor: "pointer" } as const;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {canManage && (
          <button onClick={() => setMode("upload")}
            style={{ padding: "7px 14px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600 }}>
            {t("knowledge.upload", locale)}
          </button>
        )}
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ padding: "6px 8px" }}>
          <option value="">{t("doc.allStatus", locale)}</option>
          <option value="pending">{t("knowledge.pending", locale)}</option>
          <option value="approved">{t("knowledge.approved", locale)}</option>
          <option value="rejected">{t("knowledge.rejected", locale)}</option>
        </select>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={t("knowledgeExtra.searchPlaceholder", locale)}
          style={{ width: 220, padding: "6px 10px" }}
          onKeyDown={e => { if (e.key === "Enter") void load(1); }} />
        <button onClick={() => void load(1)} style={{ cursor: "pointer" }}>{t("common.search", locale)}</button>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      {loading ? <div className="empty-state">{t("common.loading", locale)}</div>
        : !rows || rows.length === 0 ? <div className="empty-state">{t("common.empty", locale)}</div>
          : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>
                {t("docLedger.totalCount", locale, { n: total })}
              </div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("knowledge.docTitle", locale)}</th>
                      <th style={{ width: 110 }}>{t("knowledge.category", locale)}</th>
                      <th style={{ width: 70 }}>{t("knowledge.version", locale)}</th>
                      <th style={{ width: 100 }}>{t("knowledge.status", locale)}</th>
                      <th style={{ width: 110 }}>{t("knowledge.uploader", locale)}</th>
                      <th style={{ width: 60 }}>{t("knowledge.views", locale)}</th>
                      <th style={{ width: 70 }}>{t("knowledge.downloads", locale)}</th>
                      <th style={{ width: 100 }}>{t("doc.issueTime", locale)}</th>
                      <th style={{ width: 260 }}>{""}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={String(row.id)}>
                        <td>{row.title}{row.description ? <span style={{ color: "var(--text-muted, #64748b)" }}> — {row.description}</span> : null}</td>
                        <td>{row.category ?? "-"}</td>
                        <td>v{row.version ?? 1}{row.is_current ? " ●" : ""}</td>
                        <td style={{ color: STATUS_COLORS[row.status] ?? undefined, fontWeight: 600 }}>{statusText(row.status, locale)}</td>
                        <td>{row.uploader_name ?? "-"}</td>
                        <td>{row.view_count ?? 0}</td>
                        <td>{row.download_count ?? 0}</td>
                        <td>{fmtDate(row.created_at)}</td>
                        <td>
                          {row.status === "approved" && (
                            <>
                              <button onClick={() => void openDoc(row)} style={{ ...btn, marginRight: 4 }}>{t("driveExtra.open", locale)}</button>
                              <button onClick={() => void download(row)} style={{ ...btn, marginRight: 4 }}>{t("driveExtra.menuDownload", locale)}</button>
                            </>
                          )}
                          {row.status === "pending" && profile?.isAdmin && (
                            <>
                              <button onClick={() => void doApprove(row, "approve")} style={{ ...btn, marginRight: 4, color: "#15803d" }}>{t("knowledge.approve", locale)}</button>
                              <button onClick={() => void doApprove(row, "reject")} style={{ ...btn, marginRight: 4, color: "#b91c1c" }}>{t("knowledge.rejectDoc", locale)}</button>
                            </>
                          )}
                          {row.status === "approved" && canManage && row.is_current && (
                            <>
                              <button onClick={() => { setBase(row); setMode("newver"); }} style={{ ...btn, marginRight: 4 }}>{t("knowledge.newVersion", locale)}</button>
                              <button onClick={() => setHistoryId(row.id)} style={btn}>{t("knowledge.history", locale)}</button>
                            </>
                          )}
                        </td>
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

/** 신규 업로드 (title 필수) */
function KnowledgeUploadNew({ locale, onDone, onCancel }: { locale: Locale; onDone: () => void; onCancel: () => void }) {
  return <UploadForm locale={locale} base={null} onDone={onDone} onCancel={onCancel} />;
}
