import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { oaApi, type OaProfile } from "./oaApi";
import { t } from "./i18n";

/**
 * 组织导入 —— 移植原版 OrgImport：
 * ① 下载中越双语模板 / 导出组织架构（客户端 xlsx 生成）
 * ② 岗位字典管理（管理员：新增/编辑/启停/删除，引用数>0 禁删）
 * ③ 上传解析 → 预览（自动工号 ⚙ / 岗位不匹配 ✕ 标注）→ 分批导入 → 结果汇总
 * 端点：GET /api/org/import/template · POST /api/org/import {rows} ·
 *       GET /api/org/export · GET/POST/PUT/DELETE /api/org/positions[...]
 */

const IMPORT_BATCH = 150;

interface TplColumn { key: string; label: string; label_vi?: string | null }
interface PositionRow {
  id?: number | string; code?: string | null; name_zh?: string | null; name_vi?: string | null;
  name_en?: string | null; sort_order?: number | null; active?: boolean | null; refCount?: number | null;
}
interface ParsedRow extends Record<string, unknown> {
  _row: number; _autoNo?: boolean; _posOk?: boolean;
}
interface ImportResult {
  deptInserted: number; deptUpdated: number; userInserted: number; userUpdated: number;
  failed: number; matchedByFallback: number;
  errors: Array<{ row: number; field: string; msg: string }>;
}
const EMPTY_RESULT: ImportResult = {
  deptInserted: 0, deptUpdated: 0, userInserted: 0, userUpdated: 0,
  failed: 0, matchedByFallback: 0, errors: [],
};

const label = { display: "block", marginBottom: 5, fontSize: 13 };
const btn = { padding: "6px 14px", cursor: "pointer" } as const;

function locLabel(c: TplColumn, locale: Locale): string {
  return locale === "vi-VN" && c.label_vi ? c.label_vi : c.label;
}

export function OrgImportView({ locale }: { locale: Locale }) {
  const [profile, setProfile] = useState<OaProfile | null>(null);
  const [cols, setCols] = useState<TplColumn[]>([]);
  const [positions, setPositions] = useState<PositionRow[] | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // 岗位编辑对话框
  const [posDialog, setPosDialog] = useState<null | { editing: PositionRow | null }>(null);
  const [posForm, setPosForm] = useState({ name_zh: "", name_vi: "", name_en: "", sort_order: 0 });
  const [posBusy, setPosBusy] = useState(false);

  const isAdmin = !!profile?.isAdmin;

  const loadPositions = useCallback(async () => {
    try {
      const l = isAdmin
        ? await apiClient.get<PositionRow[]>("/api/org/positions/all")
        : await apiClient.get<PositionRow[]>("/api/org/positions");
      setPositions(l || []);
    } catch {
      setPositions([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    oaApi.profile().then(setProfile).catch(() => setProfile(null));
    apiClient.get<{ columns: TplColumn[] }>("/api/org/import/template")
      .then(r => setCols(r?.columns || []))
      .catch(() => setCols([]));
  }, []);

  useEffect(() => { void loadPositions(); }, [loadPositions]);

  const getXlsx = async () => (await import("xlsx"));

  // ---- 模板下载（表头 + 填写说明行，与原版一致） ----
  const downloadTemplate = async () => {
    setError("");
    if (!cols.length) { setMsg(t("orgImport.templateEmpty", locale)); return; }
    try {
      const XLSX = await getXlsx();
      const headers = cols.map(c => locLabel(c, locale));
      const ws = XLSX.utils.aoa_to_sheet([
        headers,
        ["类别", "内容", "说明"],
        ["必填", "姓名", "必填。同部门+同姓名+同岗位视为同一人，会更新而不是重复建人"],
        ["选填", "工号", "留空则自动生成（DT+序号）"],
        ["选填", "部门编码/名称", "编码不存在时按名称建新部门；上级部门编码不存在时自动创建"],
        ["选填", "岗位编码", "须存在于岗位字典；填岗位名称也可识别"],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "org");
      XLSX.writeFile(wb, "org-import-template.xlsx");
      setMsg(t("orgImport.templateDownloaded", locale));
    } catch (e) {
      setError(t("orgImport.templateFailed", locale, { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  // ---- 导出组织架构 ----
  const exportOrg = async () => {
    setError("");
    try {
      const data = await apiClient.get<{ columns: TplColumn[]; rows: Array<Record<string, unknown>> }>("/api/org/export");
      const ec = data?.columns || [];
      const er = data?.rows || [];
      if (!ec.length || !er.length) { setMsg(t("orgImport.noExportData", locale)); return; }
      const XLSX = await getXlsx();
      const ws = XLSX.utils.json_to_sheet(er.map(r => {
        const o: Record<string, unknown> = {};
        for (const c of ec) o[locLabel(c, locale)] = r[c.key] ?? "";
        return o;
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "org");
      XLSX.writeFile(wb, "org-export.xlsx");
      setMsg(t("orgImport.exported", locale, { n: er.length }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- 文件解析（双语表头 → key） ----
  const onFile = async (f: File | null) => {
    setError(""); setMsg(""); setResult(null);
    if (!f) return;
    try {
      const tplCols = cols.length ? cols
        : (await apiClient.get<{ columns: TplColumn[] }>("/api/org/import/template"))?.columns || [];
      const XLSX = await getXlsx();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!raw.length) { setMsg(t("orgImport.emptyFile", locale)); return; }
      const headerMap: Record<string, string> = {};
      for (const c of tplCols) { headerMap[c.label] = c.key; if (c.label_vi) headerMap[c.label_vi] = c.key; }
      // 岗位字典用于预览标注
      let posCodes = new Set<string>();
      try {
        const dict = await apiClient.get<Array<{ code: string }>>("/api/org/positions");
        posCodes = new Set((dict || []).map(d => String(d.code)));
      } catch { /* 字典不可用则跳过预览标注 */ }
      const parsed: ParsedRow[] = raw.map((r, i) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) o[headerMap[String(k).trim()] || String(k).trim()] = v;
        const empNo = String(o.employee_no ?? "").trim();
        const pos = String(o.position_code ?? "").trim();
        return { ...o, _row: i + 2, _autoNo: !empNo, _posOk: !pos || posCodes.has(pos) };
      });
      setRows(parsed);
      setMsg(t("orgImport.parsed", locale, { n: parsed.length }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- 分批导入（150/批，错误行号按全表偏移） ----
  const doImport = async () => {
    setError("");
    if (!rows.length) { setMsg(t("orgImport.needFile", locale)); return; }
    setImporting(true);
    setResult(null);
    setDoneCount(0);
    const agg: ImportResult = { ...EMPTY_RESULT, errors: [] };
    try {
      for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
        const batch = rows.slice(i, i + IMPORT_BATCH).map(r => {
          const { _row: _r, _autoNo: _a, _posOk: _p, ...rest } = r;
          void _r; void _a; void _p;
          return rest;
        });
        const res = await apiClient.post<Partial<ImportResult>>("/api/org/import", { rows: batch });
        for (const k of ["deptInserted", "deptUpdated", "userInserted", "userUpdated", "failed", "matchedByFallback"] as const) {
          agg[k] += Number(res?.[k]) || 0;
        }
        for (const er of res?.errors || []) agg.errors.push({ ...er, row: (Number(er.row) || 0) + i });
        setDoneCount(i + batch.length);
      }
      setResult(agg);
      setMsg(t("orgImport.importOk", locale));
    } catch (e) {
      if (doneCount > 0) setResult(agg); // 部分批次已成功，展示已累计结果
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => { setRows([]); setResult(null); setDoneCount(0); setMsg(""); setError(""); };

  // ---- 岗位字典 CRUD ----
  const openPosDialog = (p: PositionRow | null) => {
    setPosForm({
      name_zh: p?.name_zh ?? "", name_vi: p?.name_vi ?? "",
      name_en: p?.name_en ?? "", sort_order: Number(p?.sort_order ?? 0) || 0,
    });
    setPosDialog({ editing: p });
  };

  const savePos = async () => {
    setError("");
    if (!posForm.name_zh.trim()) { setMsg(t("orgImport.nameZhRequired", locale)); return; }
    if (!posForm.name_vi.trim()) { setMsg(t("orgImport.nameViRequired", locale)); return; }
    setPosBusy(true);
    try {
      const editing = posDialog?.editing;
      if (editing?.id != null) {
        await apiClient.put(`/api/org/positions/${editing.id}`, {
          name_zh: posForm.name_zh.trim(), name_vi: posForm.name_vi.trim(),
          name_en: posForm.name_en.trim() || null, sort_order: posForm.sort_order,
        });
      } else {
        await apiClient.post("/api/org/positions", {
          name_zh: posForm.name_zh.trim(), name_vi: posForm.name_vi.trim(),
          name_en: posForm.name_en.trim() || null, sort_order: posForm.sort_order,
        });
      }
      setPosDialog(null);
      setMsg(t("orgImport.saveOk", locale));
      void loadPositions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosBusy(false);
    }
  };

  const togglePos = async (p: PositionRow) => {
    const disabling = p.active !== false;
    if (!window.confirm(t(disabling ? "orgImport.disableConfirm" : "orgImport.enableConfirm", locale, { name: p.name_zh ?? "" }))) return;
    try {
      await apiClient.put(`/api/org/positions/${p.id}`, { active: !disabling });
      setMsg(t(disabling ? "orgImport.disabledOk" : "orgImport.enabledOk", locale));
      void loadPositions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deletePos = async (p: PositionRow) => {
    if (!window.confirm(t("orgImport.deleteConfirm", locale, { name: p.name_zh ?? "" }))) return;
    try {
      await apiClient.delete(`/api/org/positions/${p.id}`);
      setMsg(t("orgImport.deletedOk", locale));
      void loadPositions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const total = rows.length;
  const autoNo = rows.filter(r => r._autoNo).length;
  const badPos = rows.filter(r => !r._posOk).length;

  return (
    <div>
      {/* 第一步：下载模板 / 导出 */}
      <div className="surface-panel" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <h3 style={{ margin: "0 0 10px" }}>{t("orgImport.step1", locale)}</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 12px" }}>
          {t("orgImport.templateHint", locale)}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn} onClick={() => void downloadTemplate()}>{t("orgImport.downloadTemplate", locale)}</button>
          {isAdmin && <button style={btn} onClick={() => void exportOrg()}>{t("orgImport.exportOrg", locale)}</button>}
        </div>
      </div>

      {/* 岗位字典 */}
      <div className="surface-panel" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{t("orgImport.posDict", locale)}</h3>
          {isAdmin && (
            <button style={btn} onClick={() => openPosDialog(null)}>{t("orgImport.addPosition", locale)}</button>
          )}
        </div>
        {!positions ? <div className="empty-state">{t("common.loading", locale)}</div>
          : positions.length === 0 ? <div className="empty-state">{t("common.noDataTip", locale)}</div>
            : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("orgImport.nameZh", locale)}</th>
                      <th>{t("orgImport.nameVi", locale)}</th>
                      <th>English</th>
                      <th style={{ width: 130 }}>{t("orgImport.posCode", locale)}</th>
                      <th style={{ width: 70 }}>{t("orgImport.sortOrder", locale)}</th>
                      <th style={{ width: 90 }}>{t("orgImport.status", locale)}</th>
                      <th style={{ width: 80 }}>{t("orgImport.refCount", locale)}</th>
                      {isAdmin && <th style={{ width: 190 }}>{t("common.actions", locale)}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={String(p.id ?? p.code)} style={p.active === false ? { opacity: 0.55 } : undefined}>
                        <td>{p.name_zh ?? "—"}</td>
                        <td>{p.name_vi ?? "—"}</td>
                        <td>{p.name_en || "—"}</td>
                        <td>{p.code ?? "—"}</td>
                        <td>{Number(p.sort_order ?? 0)}</td>
                        <td>{p.active === false ? t("orgImport.disabled", locale) : t("orgImport.enabled", locale)}</td>
                        <td>{Number(p.refCount ?? 0)}</td>
                        {isAdmin && (
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button style={{ ...btn, padding: "3px 8px" }} onClick={() => openPosDialog(p)}>{t("common.edit", locale)}</button>
                              <button style={{ ...btn, padding: "3px 8px" }} onClick={() => void togglePos(p)}>
                                {p.active === false ? t("orgImport.enable", locale) : t("orgImport.disable", locale)}
                              </button>
                              <button
                                style={{ ...btn, padding: "3px 8px" }}
                                disabled={Number(p.refCount ?? 0) > 0}
                                title={t("orgImport.refCountTip", locale, { n: Number(p.refCount ?? 0) })}
                                onClick={() => void deletePos(p)}
                              >
                                {t("common.delete", locale)}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>

      {/* 第二步：上传导入 */}
      <div className="surface-panel" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <h3 style={{ margin: "0 0 12px" }}>{t("orgImport.step2", locale)}</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          {isAdmin ? (
            <label style={{ ...btn, background: "#0f766e", color: "#fff", border: 0, borderRadius: 6, display: "inline-block" }}>
              {t("orgImport.chooseFile", locale)}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={e => { void onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
          ) : <span style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("orgImport.noPerm", locale)}</span>}
          {total > 0 && (
            <button style={{ ...btn, background: "#b45309", color: "#fff", border: 0, borderRadius: 6 }}
              disabled={importing} onClick={() => void doImport()}>
              {t("orgImport.doImport", locale)}
            </button>
          )}
          {total > 0 && <button style={btn} disabled={importing} onClick={resetImport}>{t("common.reset", locale)}</button>}
          {importing && <span style={{ fontSize: 13 }}>{doneCount}/{total}</span>}
        </div>

        {total > 0 && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, marginBottom: 10 }}>
            <span>{t("orgImport.totalRows", locale)}：<b>{total}</b></span>
            <span>{t("orgImport.autoNoCount", locale, { n: autoNo })}</span>
            <span>{t("orgImport.badPosCount", locale, { n: badPos })}</span>
          </div>
        )}
      </div>

      {/* 预览 */}
      {total > 0 && (
        <div className="surface-panel" style={{ padding: "16px 18px", marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 10px" }}>{t("orgImport.previewTitle", locale)}</h3>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>{t("attendance.errRow", locale)}</th>
                  <th style={{ width: 140 }}>{t("orgImport.employeeNo", locale)}</th>
                  <th style={{ width: 110 }}>{t("attendance.name", locale)}</th>
                  <th style={{ width: 110 }}>{t("orgImport.deptCode", locale)}</th>
                  <th style={{ width: 150 }}>{t("orgImport.deptName", locale)}</th>
                  <th style={{ width: 140 }}>{t("orgImport.positionCode", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map(r => (
                  <tr key={r._row}>
                    <td>{r._row}</td>
                    <td>{r._autoNo ? <>⚙ {String(r.employee_no || "—")}</> : String(r.employee_no || "—")}</td>
                    <td>{String(r.real_name || "—")}</td>
                    <td>{String(r.dept_code || "—")}</td>
                    <td>{String(r.dept_name || "—")}</td>
                    <td>{r.position_code && !r._posOk ? <>✕ {String(r.position_code)}</> : String(r.position_code || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: "8px 0 0" }}>
            {t("orgImport.previewHint", locale)}
          </p>
        </div>
      )}

      {/* 导入结果 */}
      {result && (
        <div className="surface-panel" style={{ padding: "16px 18px" }}>
          <h3 style={{ margin: "0 0 10px" }}>{t("orgImport.resultTitle", locale)}</h3>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            <span>{t("orgImport.deptInserted", locale)}：<b>{result.deptInserted}</b></span>
            <span>{t("orgImport.deptUpdated", locale)}：<b>{result.deptUpdated}</b></span>
            <span>{t("orgImport.userInserted", locale)}：<b>{result.userInserted}</b></span>
            <span>{t("orgImport.userUpdated", locale)}：<b>{result.userUpdated}</b></span>
            <span>{t("orgImport.matchedByFallback", locale)}：<b>{result.matchedByFallback}</b></span>
            <span>{t("attendance.failed", locale)}：<b>{result.failed}</b></span>
          </div>
          {result.matchedByFallback > 0 && (
            <p style={{ fontSize: 13, color: "#b45309", margin: "8px 0 0" }}>
              {t("orgImport.matchedByFallbackHint", locale)}
            </p>
          )}
          {result.errors.length > 0 ? (
            <div className="table-shell" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>{t("attendance.errRow", locale)}</th>
                    <th style={{ width: 140 }}>{t("attendance.errField", locale)}</th>
                    <th>{t("attendance.errMsg", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.slice(0, 50).map((er, i) => (
                    <tr key={i}>
                      <td>{er.row}</td>
                      <td>{er.field}</td>
                      <td>{er.msg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: 13, margin: "8px 0 0" }}>{t("attendance.noError", locale)}</p>
          )}
        </div>
      )}

      {(msg || error) && (
        <p style={{ fontSize: 13, marginTop: 10, color: error ? "var(--danger, #b91c1c)" : "#15803d" }}>
          {error || msg}
        </p>
      )}

      {/* 岗位编辑对话框 */}
      {posDialog && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setPosDialog(null)}>
          <div className="surface-panel" style={{ padding: "18px 20px", width: 460, maxWidth: "92vw" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 14px" }}>
              {posDialog.editing ? t("orgImport.editPosition", locale) : t("orgImport.addPosition", locale)}
            </h3>
            <label style={label}>{t("orgImport.nameZh", locale)} *</label>
            <input value={posForm.name_zh} onChange={e => setPosForm(f => ({ ...f, name_zh: e.target.value }))}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
            <label style={label}>{t("orgImport.nameVi", locale)} *</label>
            <input value={posForm.name_vi} onChange={e => setPosForm(f => ({ ...f, name_vi: e.target.value }))}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
            <label style={label}>English</label>
            <input value={posForm.name_en} onChange={e => setPosForm(f => ({ ...f, name_en: e.target.value }))}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
            <label style={label}>{t("orgImport.sortOrder", locale)}</label>
            <input type="number" min={0} max={9999} value={posForm.sort_order}
              onChange={e => setPosForm(f => ({ ...f, sort_order: Number(e.target.value) || 0 }))}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...btn, background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}
                disabled={posBusy} onClick={() => void savePos()}>{t("common.save", locale)}</button>
              <button style={btn} onClick={() => setPosDialog(null)}>{t("common.cancel", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
