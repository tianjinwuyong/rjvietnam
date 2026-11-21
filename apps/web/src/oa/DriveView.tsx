import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi, oaDriveApi, oaFileUrl,
  type OaDriveAclResult, type OaDriveAuditRow, type OaDriveFileRow,
  type OaDriveFolderResult, type OaDriveFolderRow, type OaDriveTrashResult, type OaUserOption,
} from "./oaApi";
import { t } from "./i18n";

/**
 * 公共盘 —— 对齐原版单页三 tab（driveExtra.tabBrowse/tabTrash/tabAudit）：
 * 文件浏览（目录树导航 + 上传/下载/新建/重命名/删除 + 权限管理面板）/
 * 回收站（还原/彻底删除）/ 审计日志（列表 + CSV 导出）。
 * 权限全部按后端 perm（effectiveAcl）渲染，无权限的按钮不出现。
 */

function fmtSize(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!v) return "—";
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 16).replace("T", " ");
}

function actionText(action: string | null | undefined, locale: Locale): string {
  const map: Record<string, string> = {
    create: "driveExtra.actCreate", update: "driveExtra.actUpdate", delete: "driveExtra.actDelete",
    move: "driveExtra.actMove", copy: "driveExtra.actCopy", share: "driveExtra.actShare",
    restore: "driveExtra.actRestore", purge: "driveExtra.actPurge", acl: "driveExtra.actAcl",
    upload: "driveExtra.actCreate", rename: "driveExtra.actUpdate",
  };
  const key = map[action || ""];
  return key ? t(key, locale) : (action ?? "-");
}

const PERM_COLS: Array<{ field: "can_read" | "can_edit" | "can_upload" | "can_delete" | "can_create"; key: string }> = [
  { field: "can_read", key: "drive.permRead" },
  { field: "can_edit", key: "drive.permEdit" },
  { field: "can_upload", key: "drive.permUpload" },
  { field: "can_delete", key: "drive.permDelete" },
  { field: "can_create", key: "drive.permCreate" },
];

// ============ 文件浏览 ============

function BrowseTab({ locale, onChanged }: { locale: Locale; onChanged: () => void }) {
  const [folderId, setFolderId] = useState<number | string | null>(null);
  const [roots, setRoots] = useState<OaDriveFolderRow[] | null>(null);
  const [data, setData] = useState<OaDriveFolderResult | null>(null);
  const [crumbs, setCrumbs] = useState<Array<{ id: number | string; name: string }>>([]);
  const [keyword, setKeyword] = useState("");
  const [searchRes, setSearchRes] = useState<{ files: OaDriveFileRow[]; folders: OaDriveFolderRow[] } | null>(null);
  const [aclOpen, setAclOpen] = useState(false);
  const [acl, setAcl] = useState<OaDriveAclResult | null>(null);
  const [users, setUsers] = useState<OaUserOption[]>([]);
  const [grantUser, setGrantUser] = useState("");
  const [grantPerms, setGrantPerms] = useState<Record<string, boolean>>({ can_read: true, can_edit: false, can_upload: false, can_delete: false, can_create: false });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (id: number | string | null) => {
    setError("");
    setSearchRes(null);
    setAclOpen(false);
    try {
      if (id === null) {
        setRoots(await oaDriveApi.root());
        setData(null);
        setCrumbs([]);
      } else {
        const [r, b] = await Promise.all([oaDriveApi.folder(id), oaDriveApi.breadcrumb(id)]);
        setData(r);
        setCrumbs(b);
        setRoots(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(folderId); }, [folderId, load]);

  const perm = data?.perm;

  const openAcl = async () => {
    if (folderId === null) { setMessage(t("driveExtra.needFolderForAcl", locale)); return; }
    try {
      const [a, u] = await Promise.all([oaDriveApi.acl(folderId), oaApi.users({ scope: "all" })]);
      setAcl(a);
      setUsers(u || []);
      setAclOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const newFolder = async () => {
    const name = window.prompt(t("drive.folderName", locale));
    if (!name || !name.trim()) return;
    try {
      await oaDriveApi.createFolder({ parentId: folderId, name: name.trim() });
      setMessage(t("driveExtra.folderCreated", locale));
      onChanged();
      void load(folderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (folderId === null) { setMessage(t("driveExtra.selectFolderFirst", locale)); return; }
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(list)) {
        const up = await oaApi.upload(file);
        await oaDriveApi.addFile({
          folderId, fileName: up.fileName || file.name,
          tempRelPath: up.tempRelPath || up.filePath || "",
          fileSize: up.fileSize, mimeType: up.mimeType,
        });
      }
      setMessage(t("driveExtra.uploaded", locale));
      onChanged();
      void load(folderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const doSearch = async () => {
    const kw = keyword.trim();
    if (!kw) { setSearchRes(null); return; }
    setError("");
    try { setSearchRes(await oaDriveApi.search(kw)); } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rename = async (type: "file" | "folder", id: number | string, old: string) => {
    const name = window.prompt(t("driveExtra.fileName", locale), old);
    if (!name || !name.trim() || name === old) return;
    try {
      if (type === "file") await oaDriveApi.renameFile(id, name.trim());
      else await oaDriveApi.renameFolder(id, name.trim());
      setMessage(t("driveExtra.renamed", locale));
      onChanged();
      void load(folderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (type: "file" | "folder", id: number | string, name: string) => {
    const okToDel = window.confirm(type === "folder"
      ? t("drive.deleteFolderConfirm", locale, { name })
      : t("drive.deleteFileConfirm", locale, { name }));
    if (!okToDel) return;
    try {
      if (type === "file") await oaDriveApi.deleteFile(id);
      else await oaDriveApi.deleteFolder(id);
      setMessage(t("driveExtra.deleted", locale));
      onChanged();
      if (type === "folder" && String(id) === String(folderId)) setFolderId(null);
      else void load(folderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addGrant = async () => {
    if (folderId === null || !grantUser) { setMessage(t("driveExtra.addUserFirst", locale)); return; }
    try {
      await oaDriveApi.setAcl(folderId, {
        userId: grantUser,
        canRead: !!grantPerms.can_read, canEdit: !!grantPerms.can_edit,
        canUpload: !!grantPerms.can_upload, canDelete: !!grantPerms.can_delete,
        canCreate: !!grantPerms.can_create,
      });
      setMessage(t("driveExtra.aclSaved", locale));
      const a = await oaDriveApi.acl(folderId);
      setAcl(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rmGrant = async (userId: number | string) => {
    if (folderId === null) return;
    try {
      await oaDriveApi.removeAcl(folderId, userId);
      setMessage(t("driveExtra.aclRemoved", locale));
      setAcl(await oaDriveApi.acl(folderId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const btn = { padding: "6px 12px", cursor: "pointer" } as const;

  // 搜索结果视图
  if (searchRes) {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={t("driveExtra.searchPlaceholder", locale)}
            style={{ flex: "0 1 280px", padding: "6px 10px" }} onKeyDown={e => { if (e.key === "Enter") void doSearch(); }} />
          <button onClick={() => void doSearch()} style={btn}>{t("common.search", locale)}</button>
          <button onClick={() => { setKeyword(""); setSearchRes(null); }} style={btn}>{t("driveExtra.clearSearch", locale)}</button>
        </div>
        <h4 style={{ margin: "0 0 6px" }}>{t("driveExtra.searchResult", locale)}</h4>
        {searchRes.folders.length > 0 && (
          <div className="table-shell" style={{ marginBottom: 10 }}>
            <table>
              <thead><tr><th>{t("driveExtra.colName", locale)}</th><th style={{ width: 130 }}>{t("drive.owner", locale)}</th></tr></thead>
              <tbody>
                {searchRes.folders.map(f => (
                  <tr key={String(f.id)} style={{ cursor: "pointer" }} onClick={() => { setFolderId(f.id); }}>
                    <td>📁 {f.name}</td>
                    <td>{f.owner_name ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {searchRes.files.length > 0 && (
          <div className="table-shell">
            <table>
              <thead><tr><th>{t("driveExtra.colName", locale)}</th><th style={{ width: 90 }}>{t("driveExtra.propSize", locale)}</th><th style={{ width: 110 }}>{t("driveExtra.propUpdatedAt", locale)}</th></tr></thead>
              <tbody>
                {searchRes.files.map(f => (
                  <tr key={String(f.id)}>
                    <td>📄 <a href={oaFileUrl(f.file_path)} target="_blank" rel="noreferrer">{f.name}</a></td>
                    <td>{fmtSize(f.file_size)}</td>
                    <td>{fmtTime(f.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {searchRes.folders.length === 0 && searchRes.files.length === 0 && (
          <div className="empty-state">{t("common.empty", locale)}</div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* 工具行 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={t("driveExtra.searchPlaceholder", locale)}
          style={{ flex: "0 1 240px", padding: "6px 10px" }} onKeyDown={e => { if (e.key === "Enter") void doSearch(); }} />
        <button onClick={() => void doSearch()} style={btn}>{t("common.search", locale)}</button>
        <button onClick={() => void newFolder()} style={btn}>{t("drive.newFolder", locale)}</button>
        {folderId !== null && perm?.canUpload && (
          <label style={{ ...btn, border: "1px solid #cbd5e1", borderRadius: 4, display: "inline-block" }}>
            {uploading ? t("common.loading", locale) : t("drive.upload", locale)}
            <input type="file" multiple style={{ display: "none" }} onChange={e => { void uploadFiles(e.target.files); e.currentTarget.value = ""; }} />
          </label>
        )}
        {folderId !== null && perm?.canGrant && (
          <button onClick={() => void openAcl()} style={btn}>{t("drive.permMgr", locale)}</button>
        )}
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>

      {/* 面包屑 */}
      {folderId !== null && (
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <button onClick={() => setFolderId(null)} style={{ ...btn, border: 0, background: "transparent", textDecoration: "underline" }}>
            {t("driveExtra.rootName", locale)}
          </button>
          {crumbs.map(c => (
            <span key={String(c.id)}>
              {" / "}
              {String(c.id) === String(folderId)
                ? <b>{c.name}</b>
                : <button onClick={() => setFolderId(c.id)} style={{ ...btn, border: 0, background: "transparent", textDecoration: "underline" }}>{c.name}</button>}
            </span>
          ))}
        </div>
      )}

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      {/* 根目录 */}
      {folderId === null ? (
        !roots ? <div className="empty-state">{t("common.loading", locale)}</div>
          : roots.length === 0 ? (
            <div className="empty-state">
              {t("drive.emptyRoot", locale)}
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginTop: 4 }}>{t("drive.emptyRootHint", locale)}</div>
            </div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("driveExtra.colName", locale)}</th>
                    <th style={{ width: 130 }}>{t("drive.owner", locale)}</th>
                    <th style={{ width: 150 }}>{t("driveExtra.propUpdatedAt", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {roots.map(f => (
                    <tr key={String(f.id)} style={{ cursor: "pointer" }} onClick={() => setFolderId(f.id)}>
                      <td>📁 {f.name}</td>
                      <td>{f.owner_name ?? "-"}</td>
                      <td>{fmtTime(f.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      ) : !data ? <div className="empty-state">{t("common.loading", locale)}</div> : (
        <>
          {/* 子文件夹 */}
          {data.subfolders.length === 0 && data.files.length === 0 ? (
            <div className="empty-state">
              {t("drive.emptyFolder", locale)}
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginTop: 4 }}>{t("drive.emptyFolderHint", locale)}</div>
            </div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("driveExtra.colName", locale)}</th>
                    <th style={{ width: 90 }}>{t("driveExtra.propSize", locale)}</th>
                    <th style={{ width: 110 }}>{t("driveExtra.propUpdatedAt", locale)}</th>
                    <th style={{ width: 190 }}>{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subfolders.map(f => (
                    <tr key={`f${f.id}`}>
                      <td style={{ cursor: "pointer" }} onClick={() => setFolderId(f.id)}>📁 {f.name}</td>
                      <td>—</td>
                      <td>{fmtTime(f.updated_at)}</td>
                      <td>
                        {(perm?.isOwner || perm?.canDelete) && (
                          <>
                            <button onClick={() => void rename("folder", f.id, f.name)} style={{ ...btn, marginRight: 4 }}>✎</button>
                            <button onClick={() => void remove("folder", f.id, f.name)} style={btn}>✕</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.files.map(f => (
                    <tr key={`d${f.id}`}>
                      <td>📄 <a href={oaFileUrl(f.file_path)} target="_blank" rel="noreferrer">{f.name}</a></td>
                      <td>{fmtSize(f.file_size)}</td>
                      <td>{fmtTime(f.updated_at)}</td>
                      <td>
                        <button onClick={() => void rename("file", f.id, f.name)} style={{ ...btn, marginRight: 4 }}>✎</button>
                        {(perm?.isOwner || perm?.canDelete) && (
                          <button onClick={() => void remove("file", f.id, f.name)} style={btn}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginTop: 6 }}>
            {t("driveExtra.statusItems", locale, { n: data.subfolders.length + data.files.length })}
          </div>
        </>
      )}

      {/* 权限管理面板 */}
      {aclOpen && acl && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginTop: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("drive.permMgr", locale)}</h4>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("drive.noGrant", locale)}</p>
          {acl.list.length > 0 && (
            <div className="table-shell" style={{ marginBottom: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("drive.selectUser", locale)}</th>
                    {PERM_COLS.map(c => <th key={c.field} style={{ width: 70 }}>{t(c.key, locale)}</th>)}
                    <th style={{ width: 90 }}>{t("drive.remove", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {acl.list.map(g => (
                    <tr key={String(g.user_id)}>
                      <td>{g.real_name ?? g.username}{g.dept_name ? <span style={{ color: "var(--text-muted, #64748b)" }}> · {g.dept_name}</span> : null}</td>
                      {PERM_COLS.map(c => <td key={c.field}>{g[c.field] ? "✓" : "—"}</td>)}
                      <td>
                        {g.manageable && (
                          <button onClick={() => void rmGrant(g.user_id)} style={btn}>{t("drive.remove", locale)}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <b style={{ fontSize: 13 }}>{t("drive.addGrant", locale)}</b>
            <select value={grantUser} onChange={e => setGrantUser(e.target.value)} style={{ padding: "6px 8px", minWidth: 160 }}>
              <option value="">{t("drive.selectUser", locale)}</option>
              {users.map(u => <option key={String(u.id)} value={String(u.id)}>{u.real_name ?? u.username}</option>)}
            </select>
            {PERM_COLS.map(c => (
              <label key={c.field} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={!!grantPerms[c.field]} onChange={e => setGrantPerms(p => ({ ...p, [c.field]: e.target.checked }))} />
                {" "}{t(c.key, locale)}
              </label>
            ))}
            <button onClick={() => void addGrant()} style={btn}>{t("drive.addBtn", locale)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 回收站 ============

function TrashTab({ locale }: { locale: Locale }) {
  const [data, setData] = useState<OaDriveTrashResult | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const btn = { padding: "4px 10px", cursor: "pointer" } as const;

  const load = useCallback(async () => {
    setError("");
    try { setData(await oaDriveApi.trash()); } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const restore = async (type: "file" | "folder", id: number | string) => {
    try {
      await oaDriveApi.restore(type, id);
      setMessage(t("driveExtra.restored", locale));
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const purge = async (type: "file" | "folder", id: number | string, name: string) => {
    if (!window.confirm(t("driveExtra.purgeConfirm", locale, { name }))) return;
    try {
      await oaDriveApi.purge(type, id);
      setMessage(t("driveExtra.purged", locale));
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) return <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>;
  if (!data) return <div className="empty-state">{t("common.loading", locale)}</div>;

  const empty = data.files.length === 0 && data.folders.length === 0;

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 10px" }}>{t("driveExtra.trashRetainHint", locale)}</p>
      {message && <p style={{ fontSize: 13, color: "#15803d", margin: "0 0 8px" }}>{message}</p>}
      {empty ? <div className="empty-state">{t("driveExtra.trashEmpty", locale)}</div> : (
        <>
          {data.folders.length > 0 && (
            <div className="table-shell" style={{ marginBottom: 12 }}>
              <table>
                <thead><tr><th>{t("driveExtra.typeFolder", locale)}</th><th style={{ width: 130 }}>{t("driveExtra.operator", locale)}</th><th style={{ width: 150 }}>{t("driveExtra.time", locale)}</th><th style={{ width: 170 }}>{""}</th></tr></thead>
                <tbody>
                  {data.folders.map(f => (
                    <tr key={String(f.id)}>
                      <td>📁 {f.name}</td>
                      <td>{(f as unknown as { deleted_by_name?: string | null }).deleted_by_name ?? "-"}</td>
                      <td>{fmtTime((f as unknown as { deleted_at?: string | null }).deleted_at)}</td>
                      <td>
                        <button onClick={() => void restore("folder", f.id)} style={{ ...btn, marginRight: 4 }}>{t("driveExtra.restore", locale)}</button>
                        <button onClick={() => void purge("folder", f.id, f.name)} style={btn}>{t("driveExtra.purge", locale)}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.files.length > 0 && (
            <div className="table-shell">
              <table>
                <thead><tr><th>{t("driveExtra.typeFile", locale)}</th><th style={{ width: 90 }}>{t("driveExtra.propSize", locale)}</th><th style={{ width: 130 }}>{t("driveExtra.operator", locale)}</th><th style={{ width: 150 }}>{t("driveExtra.time", locale)}</th><th style={{ width: 170 }}>{""}</th></tr></thead>
                <tbody>
                  {data.files.map(f => (
                    <tr key={String(f.id)}>
                      <td>📄 {f.name}</td>
                      <td>{fmtSize(f.file_size)}</td>
                      <td>{(f as unknown as { deleted_by_name?: string | null }).deleted_by_name ?? "-"}</td>
                      <td>{fmtTime((f as unknown as { deleted_at?: string | null }).deleted_at)}</td>
                      <td>
                        <button onClick={() => void restore("file", f.id)} style={{ ...btn, marginRight: 4 }}>{t("driveExtra.restore", locale)}</button>
                        <button onClick={() => void purge("file", f.id, f.name)} style={btn}>{t("driveExtra.purge", locale)}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============ 审计日志 ============

function AuditTab({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<OaDriveAuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pageSize = 20;

  const load = useCallback(async (p: number) => {
    setError("");
    try {
      const r = await oaDriveApi.audit({ page: p, pageSize });
      setRows(r.list || []);
      setTotal(r.total || 0);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  const exportCsv = () => {
    if (!rows || rows.length === 0) return;
    const header = [t("driveExtra.time", locale), t("driveExtra.operator", locale), t("driveExtra.action", locale), t("driveExtra.target", locale), t("driveExtra.detailCol", locale)];
    const lines = [header.join(",")];
    for (const r of rows) {
      const cells = [
        fmtTime(r.created_at), r.user_name ?? "", actionText(r.action, locale),
        `${r.target_type ?? ""} ${r.target_name ?? ""}`.trim(),
        r.detail ? JSON.stringify(r.detail) : "",
      ];
      lines.push(cells.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "drive-audit.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage(t("driveExtra.exported", locale));
  };

  if (error) return <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>;
  if (!rows) return <div className="empty-state">{t("common.loading", locale)}</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={exportCsv} style={{ padding: "6px 12px", cursor: "pointer" }}>{t("docLedger.export", locale)}</button>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>
      {rows.length === 0 ? <div className="empty-state">{t("driveExtra.noAudit", locale)}</div> : (
        <>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>{t("driveExtra.time", locale)}</th>
                  <th style={{ width: 110 }}>{t("driveExtra.operator", locale)}</th>
                  <th style={{ width: 110 }}>{t("driveExtra.action", locale)}</th>
                  <th>{t("driveExtra.target", locale)}</th>
                  <th>{t("driveExtra.detailCol", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={String(r.id)}>
                    <td>{fmtTime(r.created_at)}</td>
                    <td>{r.user_name ?? "-"}</td>
                    <td>{actionText(r.action, locale)}</td>
                    <td>{r.target_name ?? "-"}</td>
                    <td style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{r.detail ? JSON.stringify(r.detail) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > pageSize && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <button disabled={page <= 1} onClick={() => void load(page - 1)} style={{ cursor: "pointer" }}>←</button>
              <span style={{ fontSize: 13 }}>{page} / {Math.max(1, Math.ceil(total / pageSize))} · {total}</span>
              <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => void load(page + 1)} style={{ cursor: "pointer" }}>→</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============ 出口 ============

export function DriveView({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"browse" | "trash" | "audit">("browse");
  const [, setTick] = useState(0);
  const tabs: Array<{ id: typeof tab; key: string }> = [
    { id: "browse", key: "driveExtra.tabBrowse" },
    { id: "trash", key: "driveExtra.tabTrash" },
    { id: "audit", key: "driveExtra.tabAudit" },
  ];
  return (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("drive.subtitle", locale)}</p>
      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {tabs.map(x => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            style={{
              padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13,
              border: tab === x.id ? "2px solid #0f766e" : "1px solid #cbd5e1",
              background: tab === x.id ? "#ecfdf5" : "white",
              fontWeight: tab === x.id ? 700 : 400,
            }}
          >
            {t(x.key, locale)}
          </button>
        ))}
      </div>
      {tab === "browse" && <BrowseTab key="browse" locale={locale} onChanged={() => setTick(x => x + 1)} />}
      {tab === "trash" && <TrashTab key="trash" locale={locale} />}
      {tab === "audit" && <AuditTab key="audit" locale={locale} />}
    </div>
  );
}
