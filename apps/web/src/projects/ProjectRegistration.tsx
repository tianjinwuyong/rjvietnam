import { useState, useMemo, useEffect } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AppEntry, AppType, ProjectFormData } from "./index";
import { projectsApi } from "../api/projects";

const APP_TYPES: AppType[] = ["web", "service", "integration", "database", "ai-model", "worker"];
const emptyForm: ProjectFormData = {
  code: "", name_zh: "", name_en: "", name_vi: "", type: "service",
  version: "1.0.0", endpoint: "", description_zh: "", description_en: "", description_vi: "", owner: "",
};

interface Props {
  locale: Locale;
  editEntry?: AppEntry | null;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function ProjectRegistration({ locale, editEntry, onSaved, onCancel }: Props) {
  const isEdit = !!editEntry;
  const [form, setForm] = useState<ProjectFormData>(emptyForm);
  const [done, setDone] = useState<AppEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editEntry) {
      setForm({
        code: editEntry.code, name_zh: editEntry.name_zh, name_en: editEntry.name_en,
        name_vi: editEntry.name_vi, type: editEntry.type, version: editEntry.version,
        endpoint: editEntry.endpoint, description_zh: editEntry.description_zh,
        description_en: editEntry.description_en, description_vi: editEntry.description_vi,
        owner: editEntry.owner,
      });
    } else {
      setForm(emptyForm);
    }
    setDone(null);
    setError(null);
  }, [editEntry]);

  const codePrefix = useMemo(() => {
    const map: Record<AppType, string> = { web: "APP", service: "SVC", integration: "INT", database: "DB", "ai-model": "AI", worker: "WKR" };
    return map[form.type];
  }, [form.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name_zh.trim()) { setError(t("project.form.error.nameRequired", locale)); return; }
    if (!form.code.trim()) { setError(t("project.form.error.codeRequired", locale)); return; }
    setSaving(true);
    try {
      const payload = { ...form, code: form.code.trim() };
      const res = isEdit && editEntry
        ? await projectsApi.update(editEntry.id, payload)
        : await projectsApi.register(payload);
      setDone(res.item);
    } catch (err) { setError(String(err)); }
    finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div className="status-stack" style={{ padding: 24 }}>
            <div className="status-row">
              <span className="badge badge-ok">{t("status.pass", locale)}</span>
              <strong>{t("common.success", locale)}</strong>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 8, fontFamily: "monospace" }}>{done.code} — {done.name_zh}</p>
            <div className="status-stack" style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
              <div className="status-row">
                <span>{t("project.type", locale)}</span>
                <span>{t(`project.type.${done.type}` as any, locale)}</span>
              </div>
              <div className="status-row">
                <span>{t("project.version", locale)}</span>
                <span>{done.version}</span>
              </div>
              <div className="status-row">
                <span>{t("project.status", locale)}</span>
                <span className={`badge badge-${done.status === "running" ? "ok" : done.status === "error" ? "danger" : "warning"}`}>
                  {t(`project.status.${done.status}` as any, locale)}
                </span>
              </div>
            </div>
            <button className="badge badge-info" style={{ cursor: "pointer", border: "none", marginTop: 12, fontSize: 13, padding: "6px 14px", alignSelf: "flex-start" }}
              onClick={() => { setDone(null); setForm(emptyForm); onSaved?.(); }}>
              {isEdit ? t("common.back", locale) : t("buttons.create", locale)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{isEdit ? t("project.form.editTitle", locale) : t("project.form.title", locale)}</h2>
            <p>{t("project.form.subtitle", locale)}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
          {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("project.form.code", locale)} <span style={{ color: "var(--danger)" }}>*</span></label>
              <div style={{ display: "flex" }}>
                <span style={{ padding: "6px 10px", fontSize: 13, background: "var(--nav)", borderRadius: "4px 0 0 4px", color: "var(--muted)", border: "1px solid var(--border)", whiteSpace: "nowrap" }}>{codePrefix}-</span>
                <input type="text" value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} placeholder="WMS" disabled={isEdit}
                  style={{ padding: "6px 10px", fontSize: 14, borderRadius: "0 4px 4px 0", border: "1px solid var(--border)", flex: 1, fontFamily: "monospace" }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("project.type", locale)}</label>
              <select value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as AppType }))} style={{ padding: "6px 10px", fontSize: 14 }}>
                {APP_TYPES.map((at) => (<option key={at} value={at}>{t(`project.type.${at}` as any, locale)}</option>))}
              </select>
            </div>
          </div>

          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12 }}>
            <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>{t("project.form.names", locale)}</legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {(["zh", "en", "vi"] as const).map((lang) => (
                <div key={lang} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>{lang === "zh" ? "中文" : lang === "en" ? "English" : "Tiếng Việt"}{lang === "zh" ? <span style={{ color: "var(--danger)" }}> *</span> : null}</label>
                  <input type="text" value={form[`name_${lang}` as keyof typeof form] as string}
                    onChange={(e) => setForm((p) => ({ ...p, [`name_${lang}`]: e.target.value }))}
                    placeholder={lang === "zh" ? "仓库管理系统" : lang === "en" ? "Warehouse Management" : "Quản lý kho"}
                    style={{ padding: "6px 10px", fontSize: 14 }} />
                </div>
              ))}
            </div>
          </fieldset>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("project.version", locale)}</label>
              <input type="text" value={form.version} onChange={(e) => setForm((p) => ({ ...p, version: e.target.value }))} style={{ padding: "6px 10px", fontSize: 14 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("project.endpoint", locale)}</label>
              <input type="text" value={form.endpoint} onChange={(e) => setForm((p) => ({ ...p, endpoint: e.target.value }))} placeholder="http://localhost:3001/api" style={{ padding: "6px 10px", fontSize: 14 }} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("project.owner", locale)}</label>
            <input type="text" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} style={{ padding: "6px 10px", fontSize: 14 }} />
          </div>

          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12 }}>
            <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>{t("project.form.descriptions", locale)}</legend>
            {(["zh", "en", "vi"] as const).map((lang) => (
              <div key={lang} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: lang !== "vi" ? 8 : 0 }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>{lang === "zh" ? "中文" : lang === "en" ? "English" : "Tiếng Việt"}</label>
                <textarea value={form[`description_${lang}` as keyof typeof form] as string}
                  onChange={(e) => setForm((p) => ({ ...p, [`description_${lang}`]: e.target.value }))}
                  style={{ padding: "6px 10px", fontSize: 13, minHeight: 40, resize: "vertical" }} />
              </div>
            ))}
          </fieldset>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="badge badge-info" disabled={saving}
              style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px" }}>
              {saving ? t("common.saving", locale) : isEdit ? t("common.save", locale) : t("project.form.register", locale)}
            </button>
            <button type="button" className="badge badge-muted"
              style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px" }}
              onClick={() => { setForm(emptyForm); onCancel?.(); }}>
              {t("common.cancel", locale)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
