// MES-ruijing 通用增删改查页面 —— 源 App.crudPage(cfg) 的 React 对应物
// 资源清单驱动：列/表单字段/过滤声明一次，列表·搜索·分页·新增·编辑·删除统一生成
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, MesrjApiError, type MesrjPaged, type MesrjRow } from "./api";
import { t } from "./i18n";

export interface FieldDef {
  key: string;
  /** i18n key（labels.ts 或源词典） */
  labelKey: string;
  type?: "text" | "number" | "select" | "bool";
  /** select/bool 的取值；bool 缺省 = 启用/停用 */
  options?: Array<{ v: string; t: string }>;
  required?: boolean;
  /** true = 仅列表展示，不进表单 */
  readonly?: boolean;
  width?: number;
}

const PAGE_SIZE = 50;

function cellText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  const s = String(v);
  return s.length >= 19 && /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 16).replace("T", " ") : s;
}

function boolText(v: unknown, locale: Locale): string {
  return v === 1 || v === "1" || v === true ? t("common.enabled.y", locale) : t("common.enabled.n", locale);
}

export function MesrjCrudPage({
  locale, basePath, res, fields, filters = [],
}: {
  locale: Locale;
  /** API 前缀，如 "md" / "sys" */
  basePath: string;
  /** 资源名，如 "customer" */
  res: string;
  fields: FieldDef[];
  /** 可精确过滤的列（后端 f_ 参数） */
  filters?: FieldDef[];
}) {
  const [data, setData] = useState<MesrjPaged<MesrjRow> | null>(null);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MesrjRow | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const query: Record<string, unknown> = { page, size: PAGE_SIZE };
      if (keyword.trim()) query.keyword = keyword.trim();
      for (const [k, v] of Object.entries(filterVals)) {
        if (v !== "") query[`f_${k}`] = v;
      }
      const r = await mesrjApi.get<MesrjPaged<MesrjRow>>(`/${basePath}/${res}`, query);
      setData(r);
    } catch (ex) {
      setError(ex instanceof MesrjApiError ? ex.message : String(ex));
      setData(null);
    }
  }, [basePath, res, page, keyword, filterVals]);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => {
    const init: Record<string, string> = {};
    for (const f of fields) if (!f.readonly) init[f.key] = "";
    setForm(init);
    setEditing("new");
  };

  const openEdit = (row: MesrjRow) => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      if (f.readonly) continue;
      init[f.key] = row[f.key] === null || row[f.key] === undefined ? "" : String(row[f.key]);
    }
    setForm(init);
    setEditing(row);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.readonly) continue;
        const v = form[f.key] ?? "";
        if (f.type === "number") body[f.key] = v === "" ? 0 : Number(v);
        else if (f.type === "bool" || f.type === "select") body[f.key] = v === "" ? (f.type === "bool" ? 1 : "") : (isNaN(Number(v)) ? v : Number(v));
        else body[f.key] = v;
      }
      if (editing === "new") {
        await mesrjApi.post(`/${basePath}/${res}`, body);
      } else {
        await mesrjApi.put(`/${basePath}/${res}/${editing.id}`, body);
      }
      setEditing(null);
      await load();
    } catch (ex) {
      setError(ex instanceof MesrjApiError ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: MesrjRow) => {
    if (!window.confirm(t("common.deleteConfirm", locale))) return;
    try {
      await mesrjApi.del(`/${basePath}/${res}/${row.id}`);
      await load();
    } catch (ex) {
      setError(ex instanceof MesrjApiError ? ex.message : String(ex));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const statusField = fields.find(f => f.key === "status");

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          value={keyword}
          onChange={e => { setKeyword(e.target.value); setPage(1); }}
          placeholder={t("common.keyword", locale)}
          style={{ minWidth: 180, padding: "6px 10px" }}
        />
        {filters.map(f => (
          <select
            key={f.key}
            value={filterVals[f.key] ?? ""}
            onChange={e => { setFilterVals(s => ({ ...s, [f.key]: e.target.value })); setPage(1); }}
            style={{ padding: "6px 8px" }}
          >
            <option value="">{t(f.labelKey, locale)}</option>
            {(f.options ?? []).map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
          </select>
        ))}
        <button onClick={() => { setPage(1); void load(); }}>{t("search", locale)}</button>
        <button onClick={openNew} style={{ marginLeft: "auto" }}>{t("common.new", locale)}</button>
      </div>

      {error && <div style={{ color: "#b91c1c", padding: "6px 0" }}>{error}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {fields.map(f => (
                <th key={f.key} style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", whiteSpace: "nowrap" }}>
                  {t(f.labelKey, locale)}
                </th>
              ))}
              <th style={{ padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)" }}>{t("common.actions", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row, i) => (
              <tr key={String(row.id ?? i)}>
                {fields.map(f => (
                  <td key={f.key} style={{ padding: "6px 10px", borderBottom: "1px solid var(--border, #eef2f7)", whiteSpace: "nowrap" }}>
                    {f.type === "bool" || (f.key === "status" && statusField?.type === "bool")
                      ? boolText(row[f.key], locale)
                      : cellText(row[f.key])}
                  </td>
                ))}
                <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border, #eef2f7)", whiteSpace: "nowrap" }}>
                  <button onClick={() => openEdit(row)} style={{ marginRight: 6 }}>{t("common.edit", locale)}</button>
                  <button onClick={() => void remove(row)}>{t("common.delete", locale)}</button>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={fields.length + 1} style={{ padding: 16, color: "#94a3b8" }}>{t("no_data", locale)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, fontSize: 13 }}>
        <span>{t("common.total", locale)} {data?.total ?? 0} {t("common.items", locale)}</span>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common.prev", locale)}</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common.next", locale)}</button>
      </div>

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "var(--surface, #fff)", borderRadius: 10, padding: 18, minWidth: 420, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
              {editing === "new" ? t("common.new", locale) : t("common.edit", locale)}
            </h3>
            {fields.filter(f => !f.readonly).map(f => (
              <label key={f.key} style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                <span>{t(f.labelKey, locale)}{f.required && <b style={{ color: "#b91c1c" }}> *</b>}</span>
                {f.type === "select" || f.type === "bool" ? (
                  <select
                    value={form[f.key] ?? ""}
                    onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "6px 8px", marginTop: 4 }}
                  >
                    {(f.options ?? []).map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={form[f.key] ?? ""}
                    onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "6px 8px", marginTop: 4, boxSizing: "border-box" }}
                  />
                )}
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setEditing(null)}>{t("cancel", locale)}</button>
              <button onClick={() => void save()} disabled={saving}>{t("save", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 启用/停用布尔字段的标准 options */
export const enabledOptions = (locale: Locale) => [
  { v: "1", t: t("common.enabled.y", locale) },
  { v: "0", t: t("common.enabled.n", locale) },
];

/** 是否布尔列的显示 */
export function yesNo(v: unknown, locale: Locale): string {
  return v === 1 || v === "1" || v === true ? t("common.yes", locale) : t("common.no", locale);
}
