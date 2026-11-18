import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { oaApi, type OaFieldOption, type OaFlowDef, type OaFormField, type OaUserOption } from "./oaApi";
import { t } from "./i18n";

/**
 * 发起申请 —— 按 flow_definition.form_schema 渲染动态表单。
 * 字段类型与原 OA 一致：text / textarea / number / date / datetime / month /
 * select / switch / user_single / user_multi / table / file。
 * 文件先走 POST /api/upload 暂存，建单后用 POST /api/instances/:id/attachments 关联。
 */

export function fieldLabel(field: { label: string; label_vi?: string | null }, locale: Locale): string {
  return locale === "vi-VN" && field.label_vi ? field.label_vi : field.label;
}

export function fieldPlaceholder(field: { placeholder?: string | null; placeholder_vi?: string | null }, locale: Locale): string {
  if (locale === "vi-VN" && field.placeholder_vi) return field.placeholder_vi;
  return field.placeholder ?? "";
}

function optionLabel(opt: OaFieldOption, locale: Locale): string {
  return locale === "vi-VN" && opt.label_vi ? opt.label_vi : opt.label;
}

interface FileRef {
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

export function FlowForm({
  def, locale, onDone, onCancel,
}: {
  def: OaFlowDef;
  locale: Locale;
  onDone: (submitted: boolean) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, FileRef[]>>({});
  const [pendingUploads, setPendingUploads] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 选择页拿到的是列表项（不含 form_schema），这里按 id 拉取完整定义
  const [fullDef, setFullDef] = useState<OaFlowDef | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    oaApi.flow(def.id)
      .then(d => { if (!cancelled) setFullDef(d); })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [def.id]);

  const schema = fullDef?.form_schema ?? def.form_schema ?? [];
  const fields = useMemo(() => schema.filter(f => f.type !== "hidden"), [schema]);
  const users = useUsers();

  const setValue = useCallback((key: string, value: unknown) => {
    setValues(v => ({ ...v, [key]: value }));
  }, []);

  const missingFields = useMemo(() => {
    const missing: string[] = [];
    for (const f of fields) {
      if (!f.required) continue;
      if (f.type === "table") {
        const rows = (values[f.key] as Record<string, unknown>[] | undefined) || [];
        if (rows.length === 0) missing.push(fieldLabel(f, locale));
        continue;
      }
      if (f.type === "file") {
        if (!(files[f.key]?.length)) missing.push(fieldLabel(f, locale));
        continue;
      }
      const v = values[f.key];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        missing.push(fieldLabel(f, locale));
      }
    }
    return missing;
  }, [fields, values, files, locale]);

  const filledCount = useMemo(() => {
    let n = 0;
    for (const f of fields) {
      if (f.type === "table") {
        const rows = (values[f.key] as Record<string, unknown>[] | undefined) || [];
        if (rows.length > 0) n++;
      } else if (f.type === "file") {
        if (files[f.key]?.length) n++;
      } else {
        const v = values[f.key];
        if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)) n++;
      }
    }
    return n;
  }, [fields, values, files]);

  const uploadFile = async (fieldKey: string, file: File) => {
    setPendingUploads(n => n + 1);
    setError("");
    try {
      const r = await oaApi.upload(file);
      setFiles(prev => ({
        ...prev,
        [fieldKey]: [...(prev[fieldKey] || []), { fileName: r.fileName || file.name, filePath: r.tempRelPath || r.filePath || "", fileSize: r.fileSize, mimeType: r.mimeType }],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingUploads(n => n - 1);
    }
  };

  const submit = async (submitNow: boolean) => {
    setError("");
    if (!title.trim()) {
      setError(t("apply.titlePlaceholder", locale));
      return;
    }
    if (missingFields.length > 0) {
      setError(t("apply.pendingFields", locale, { fields: missingFields.join("、") }));
      return;
    }
    setBusy(true);
    try {
      const inst = await oaApi.createInstance({
        definitionId: def.id,
        title: title.trim(),
        formData: values,
        submitNow: false, // 先建单/存草稿，再关联附件，最后按需提交
      });
      const id = inst.id;
      // 关联所有已上传附件（暂存路径 → 单据附件）
      const allFiles = Object.values(files).flat();
      for (const f of allFiles) {
        try {
          await oaApi.addAttachment(id, { fileName: f.fileName, filePath: f.filePath, fileSize: f.fileSize, mimeType: f.mimeType });
        } catch { /* 单个附件失败不阻断提交 */ }
      }
      if (submitNow) await oaApi.submitDraft(id);
      onDone(submitNow);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => submit(false);
  const submitNow = () => submit(true);

  if (loadError) return <div className="empty-state">{t("empty.loadFailed", locale)}: {loadError}</div>;
  if (!fullDef) return <div className="empty-state">{t("common.loading", locale)}</div>;

  return (
    <div>
      <button onClick={onCancel} style={{ marginBottom: 10, cursor: "pointer" }}>← {t("apply.backToPick", locale)}</button>

      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 4 }}>
          {t("apply.currentFlow", locale)}：{locale === "vi-VN" && def.name_vi ? def.name_vi : def.name}
          {def.category ? ` · ${def.category}` : ""}
        </div>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>{t("apply.titleField", locale)}</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t("apply.titlePlaceholder", locale)}
          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px" }}
        />
      </div>

      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 10px" }}>{t("apply.fillContent", locale)}</h4>
        {fields.length === 0 && <div className="empty-state">{t("common.empty", locale)}</div>}
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>
              {fieldLabel(f, locale)}
              {f.required ? <span style={{ color: "#b91c1c" }}> *</span> : null}
            </label>
            <FieldInput
              field={f}
              locale={locale}
              value={values[f.key]}
              onChange={v => setValue(f.key, v)}
              users={users}
              files={files[f.key] || []}
              onUpload={file => void uploadFile(f.key, file)}
            />
            {f.type === "file" && (
              <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("apply.uploadHint", locale)}</div>
            )}
          </div>
        ))}
      </div>

      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>
          {missingFields.length === 0 && filledCount > 0
            ? t("apply.allFilled", locale)
            : null}
        </div>
        {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            disabled={busy || pendingUploads > 0}
            onClick={() => void saveDraft()}
            style={{ padding: "7px 16px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}
          >{t("apply.saveDraft", locale)}</button>
          <button
            disabled={busy || pendingUploads > 0}
            onClick={() => void submitNow()}
            style={{ padding: "7px 16px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}
          >{t("apply.submitApproval", locale)}</button>
          {pendingUploads > 0 || busy ? <span style={{ alignSelf: "center", fontSize: 13 }}>{t("common.loading", locale)}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** 懒加载一次的人员列表（选人字段用） */
function useUsers(): OaUserOption[] | null {
  const [users, setUsers] = useState<OaUserOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    oaApi.users()
      .then(list => { if (!cancelled) setUsers(list); })
      .catch(() => { if (!cancelled) setUsers([]); });
    return () => { cancelled = true; };
  }, []);
  return users;
}

function FieldInput({
  field: f, locale, value, onChange, users, files, onUpload,
}: {
  field: OaFormField;
  locale: Locale;
  value: unknown;
  onChange: (v: unknown) => void;
  users: OaUserOption[] | null;
  files: FileRef[];
  onUpload: (file: File) => void;
}) {
  const ph = fieldPlaceholder(f, locale);
  const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "7px 10px" };

  switch (f.type) {
    case "textarea":
    case "rich_text":
      return <textarea value={String(value ?? "")} onChange={e => onChange(e.target.value)} rows={3} placeholder={ph} style={{ ...inputStyle, resize: "vertical" }} />;
    case "number":
      return <input type="number" value={value === undefined || value === null ? "" : String(value)} onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} min={f.min} step={f.step} placeholder={ph} style={inputStyle} />;
    case "date":
      return <input type="date" value={String(value ?? "")} onChange={e => onChange(e.target.value)} style={inputStyle} />;
    case "datetime":
      return <input type="datetime-local" value={String(value ?? "")} onChange={e => onChange(e.target.value)} style={inputStyle} />;
    case "month":
      return <input type="month" value={String(value ?? "")} onChange={e => onChange(e.target.value)} style={inputStyle} />;
    case "switch":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        </label>
      );
    case "select":
      return (
        <select value={String(value ?? "")} onChange={e => onChange(e.target.value)} style={inputStyle}>
          <option value="">{t("common.choosePrefix", locale)}</option>
          {(f.options || []).map(o => (
            <option key={String(o.value)} value={String(o.value)}>{optionLabel(o, locale)}</option>
          ))}
        </select>
      );
    case "user_single":
      return (
        <select value={String(value ?? "")} onChange={e => onChange(e.target.value)} style={inputStyle}>
          <option value="">{t("apply.chooseUser", locale)}</option>
          {(users || []).map(u => (
            <option key={String(u.id)} value={String(u.id)}>{u.real_name}{u.dept_name ? ` · ${u.dept_name}` : ""}</option>
          ))}
        </select>
      );
    case "user_multi": {
      const arr = Array.isArray(value) ? value.map(String) : [];
      return (
        <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, padding: 8 }}>
          {(users || []).length === 0 ? <span style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("common.loading", locale)}</span> : null}
          {(users || []).map(u => (
            <label key={String(u.id)} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 12, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={arr.includes(String(u.id))}
                onChange={e => onChange(e.target.checked ? [...arr, String(u.id)] : arr.filter(x => x !== String(u.id)))}
              />
              {u.real_name}
            </label>
          ))}
        </div>
      );
    }
    case "file":
      return (
        <div>
          <input
            type="file"
            multiple
            onChange={e => { for (const file of Array.from(e.target.files || [])) onUpload(file); e.target.value = ""; }}
          />
          {files.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {files.map((f2, i) => <div key={i}>📎 {f2.fileName}</div>)}
            </div>
          )}
        </div>
      );
    case "table":
      return <TableInput field={f} locale={locale} rows={(Array.isArray(value) ? value : []) as Record<string, unknown>[]} onChange={onChange} users={users} />;
    default:
      return <input value={String(value ?? "")} onChange={e => onChange(e.target.value)} placeholder={ph} style={inputStyle} />;
  }
}

function TableInput({
  field, locale, rows, onChange, users,
}: {
  field: OaFormField;
  locale: Locale;
  rows: Record<string, unknown>[];
  onChange: (v: unknown) => void;
  users: OaUserOption[] | null;
}) {
  const cols = field.columns || [];
  const setCell = (rowIdx: number, key: string, v: unknown) => {
    const next = rows.map((r, i) => (i === rowIdx ? { ...r, [key]: v } : r));
    onChange(next);
  };
  const addRow = () => onChange([...rows, {}]);
  const removeRow = (rowIdx: number) => onChange(rows.filter((_, i) => i !== rowIdx));

  // 合计行：sum_key 指向本表某数值列（与原 OA 明细表一致）
  const sumCol = field.sum_key ? cols.find(c => c.key === field.sum_key) : null;
  const sum = sumCol ? rows.reduce((acc, r) => acc + (Number(r?.[sumCol.key]) || 0), 0) : null;

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                {fieldLabel(c, locale)}{c.required ? <span style={{ color: "#b91c1c" }}> *</span> : null}
              </th>
            ))}
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length + 1} style={{ padding: "8px", color: "var(--text-muted, #64748b)" }}>
              {t("common.empty", locale)}
            </td></tr>
          ) : null}
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>
                  {c.type === "select" ? (
                    <select value={String(row?.[c.key] ?? "")} onChange={e => setCell(i, c.key, e.target.value)} style={{ width: "100%" }}>
                      <option value="">{t("common.choosePrefix", locale)}</option>
                      {(c.options || []).map(o => <option key={String(o.value)} value={String(o.value)}>{optionLabel(o, locale)}</option>)}
                    </select>
                  ) : c.type === "number" ? (
                    <input type="number" value={row?.[c.key] === undefined || row?.[c.key] === null ? "" : String(row[c.key])} onChange={e => setCell(i, c.key, e.target.value === "" ? undefined : Number(e.target.value))} style={{ width: "100%" }} />
                  ) : c.type === "date" ? (
                    <input type="date" value={String(row?.[c.key] ?? "")} onChange={e => setCell(i, c.key, e.target.value)} style={{ width: "100%" }} />
                  ) : c.type === "user_single" ? (
                    <select value={String(row?.[c.key] ?? "")} onChange={e => setCell(i, c.key, e.target.value)} style={{ width: "100%" }}>
                      <option value="">{t("apply.chooseUser", locale)}</option>
                      {(users || []).map(u => <option key={String(u.id)} value={String(u.id)}>{u.real_name}</option>)}
                    </select>
                  ) : (
                    <input value={String(row?.[c.key] ?? "")} onChange={e => setCell(i, c.key, e.target.value)} style={{ width: "100%" }} />
                  )}
                </td>
              ))}
              <td style={{ borderBottom: "1px solid #f1f5f9" }}>
                <button onClick={() => removeRow(i)} style={{ cursor: "pointer", border: 0, background: "transparent", color: "#b91c1c" }}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
        <button onClick={addRow} style={{ cursor: "pointer", padding: "5px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}>
          {t("common.addRow", locale)}
        </button>
        {rows.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
            {t("apply.rowHint", locale, { n: rows.length })}
          </span>
        )}
        {sum !== null && (
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {t("apply.total", locale)}{sum}
          </span>
        )}
      </div>
    </div>
  );
}
