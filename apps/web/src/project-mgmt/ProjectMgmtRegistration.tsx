import { useState, useEffect } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { Project, ProjectFormData, ProjectStatus, ProjectType } from "../api/projectMgmt";
import { projectMgmtApi } from "../api/projectMgmt";

const PROJECT_TYPES: ProjectType[] = ["engineering", "rd", "tech_improvement", "new_product", "cooperation", "cooperation_outsource"];
const PROJECT_STATUSES: ProjectStatus[] = ["planning", "in_progress", "on_hold", "completed", "cancelled"];
const CURRENCIES = ["CNY", "USD", "VND", "EUR"];

const emptyForm: ProjectFormData = {
  code: "", name_zh: "", name_en: "", name_vi: "", type: "engineering",
  status: "planning", department: "", manager: "", budget: "",
  currency: "CNY", startDate: "", endDate: "",
  description_zh: "", description_en: "", description_vi: "",
  objectives_zh: "", objectives_en: "", objectives_vi: "",
  deliverables_zh: "", deliverables_en: "", deliverables_vi: "",
};

let codeCounter = 100;
function genCode(type: ProjectType): string {
  const prefixes: Record<ProjectType, string> = {
    engineering: "PRJ-ENG",
    rd: "PRJ-RD",
    tech_improvement: "PRJ-TI",
    new_product: "PRJ-NP",
    cooperation: "PRJ-COOP",
    cooperation_outsource: "PRJ-OUT",
  };
  return `${prefixes[type]}-${String(++codeCounter).padStart(3, "0")}`;
}

interface Props {
  locale: Locale;
  editProject?: Project | null;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function ProjectMgmtRegistration({ locale, editProject, onSaved, onCancel }: Props) {
  const isEdit = !!editProject;
  const [form, setForm] = useState<ProjectFormData>(emptyForm);
  const [done, setDone] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editProject) {
      setForm({
        code: editProject.code,
        name_zh: editProject.name_zh,
        name_en: editProject.name_en,
        name_vi: editProject.name_vi,
        type: editProject.type,
        status: editProject.status,
        department: editProject.department,
        manager: editProject.manager,
        budget: String(editProject.budget),
        currency: editProject.currency,
        startDate: editProject.startDate.slice(0, 10),
        endDate: editProject.endDate.slice(0, 10),
        description_zh: editProject.description_zh,
        description_en: editProject.description_en,
        description_vi: editProject.description_vi,
        objectives_zh: editProject.objectives_zh,
        objectives_en: editProject.objectives_en,
        objectives_vi: editProject.objectives_vi,
        deliverables_zh: editProject.deliverables_zh,
        deliverables_en: editProject.deliverables_en,
        deliverables_vi: editProject.deliverables_vi,
      });
    } else {
      setForm(emptyForm);
    }
    setDone(null);
    setError(null);
  }, [editProject]);

  const set = (key: keyof ProjectFormData, val: string) =>
    setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name_zh.trim()) { setError(t("projectMgmt.form.error.nameRequired", locale)); return; }
    setSaving(true);
    try {
      const payload = { ...form, code: form.code || genCode(form.type) };
      const res = isEdit && editProject
        ? await projectMgmtApi.update(editProject.id, payload)
        : await projectMgmtApi.register(payload);
      setDone(res.item);
    } catch (err) { setError(String(err)); }
    finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="surface-panel">
        <div className="status-stack" style={{ padding: 24 }}>
          <div className="status-row">
            <span className="badge badge-ok">{t("status.pass", locale)}</span>
            <strong>{t("common.success", locale)}</strong>
          </div>
          <p style={{ color: "var(--muted)", marginTop: 8, fontFamily: "monospace" }}>{done.code} — {done.name_zh}</p>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
            <div className="status-row">
              <span>{t("projectMgmt.type.label", locale)}</span>
              <span>{t(`projectMgmt.type.${done.type}` as any, locale)}</span>
            </div>
            <div className="status-row">
              <span>{t("common.status", locale)}</span>
              <span className={`badge badge-${done.status === "completed" ? "ok" : done.status === "in_progress" ? "info" : "warning"}`}>
                {t(`projectMgmt.status.${done.status}` as any, locale)}
              </span>
            </div>
            <div className="status-row">
              <span>{t("projectMgmt.manager", locale)}</span>
              <span>{done.manager}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="badge badge-info" style={{ cursor: "pointer", border: "none", fontSize: 13, padding: "6px 14px" }}
              onClick={() => { setDone(null); setForm(emptyForm); onSaved?.(); }}>
              {isEdit ? t("common.back", locale) : t("projectMgmt.form.registerAnother", locale)}
            </button>
            <button className="badge badge-muted" style={{ cursor: "pointer", border: "none", fontSize: 13, padding: "6px 14px" }}
              onClick={() => onCancel?.()}>
              {t("common.cancel", locale)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{isEdit ? t("projectMgmt.form.editTitle", locale) : t("projectMgmt.form.title", locale)}</h2>
          <p>{t("projectMgmt.form.subtitle", locale)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        {/* Row 1: Type + Status + Code */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.type.label", locale)} <span style={{ color: "var(--danger)" }}>*</span></label>
            <select value={form.type} onChange={(e) => set("type", e.target.value)} style={{ padding: "6px 10px", fontSize: 13 }}>
              {PROJECT_TYPES.map((pt) => (<option key={pt} value={pt}>{t(`projectMgmt.type.${pt}` as any, locale)}</option>))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.status", locale)}</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)} style={{ padding: "6px 10px", fontSize: 13 }}>
              {PROJECT_STATUSES.map((s) => (<option key={s} value={s}>{t(`projectMgmt.status.${s}` as any, locale)}</option>))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.code", locale)}</label>
            <input type="text" value={form.code} readOnly placeholder={genCode(form.type)}
              style={{ padding: "6px 10px", fontSize: 13, fontFamily: "monospace", background: "var(--nav)", cursor: "not-allowed" }} />
          </div>
        </div>

        {/* Names */}
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
          <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>{t("projectMgmt.form.names", locale)} <span style={{ color: "var(--danger)" }}>*</span></legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {(["zh", "en", "vi"] as const).map((lang) => (
              <div key={lang} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--muted)" }}>
                  {lang === "zh" ? "中文" : lang === "en" ? "English" : "Tiếng Việt"}
                  {lang === "zh" && <span style={{ color: "var(--danger)" }}> *</span>}
                </label>
                <input type="text" value={form[`name_${lang}` as keyof typeof form] as string}
                  onChange={(e) => set(`name_${lang}` as keyof ProjectFormData, e.target.value)}
                  placeholder={lang === "zh" ? "SMT 产线改造" : lang === "en" ? "SMT Line Upgrade" : "Nâng cấp dây chuyền SMT"}
                  style={{ padding: "5px 8px", fontSize: 13 }} />
              </div>
            ))}
          </div>
        </fieldset>

        {/* Row 2: Dept + Manager + Budget */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.department", locale)}</label>
            <input type="text" value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="工程部"
              style={{ padding: "6px 10px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.manager", locale)}</label>
            <input type="text" value={form.manager} onChange={(e) => set("manager", e.target.value)} placeholder="张工"
              style={{ padding: "6px 10px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.budget", locale)}</label>
            <div style={{ display: "flex", gap: 4 }}>
              <select value={form.currency} onChange={(e) => set("currency", e.target.value)} style={{ padding: "6px 4px", fontSize: 12 }}>
                {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
              <input type="number" value={form.budget} onChange={(e) => set("budget", e.target.value)} placeholder="1000000"
                style={{ padding: "6px 8px", fontSize: 13, flex: 1 }} />
            </div>
          </div>
        </div>

        {/* Row 3: Dates */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.startDate", locale)}</label>
            <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)}
              style={{ padding: "6px 10px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("projectMgmt.endDate", locale)}</label>
            <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)}
              style={{ padding: "6px 10px", fontSize: 13 }} />
          </div>
        </div>

        {/* Descriptions */}
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
          <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>{t("projectMgmt.form.descriptions", locale)}</legend>
          {(["zh", "en", "vi"] as const).map((lang) => (
            <div key={lang} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: lang !== "vi" ? 8 : 0 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>{lang === "zh" ? "中文" : lang === "en" ? "English" : "Tiếng Việt"}</label>
              <textarea value={form[`description_${lang}` as keyof typeof form] as string}
                onChange={(e) => set(`description_${lang}` as keyof ProjectFormData, e.target.value)}
                style={{ padding: "5px 8px", fontSize: 12, minHeight: 36, resize: "vertical" }} />
            </div>
          ))}
        </fieldset>

        {/* Objectives */}
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
          <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>{t("projectMgmt.form.objectives", locale)}</legend>
          {(["zh", "en", "vi"] as const).map((lang) => (
            <div key={lang} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: lang !== "vi" ? 8 : 0 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>{lang === "zh" ? "中文" : lang === "en" ? "English" : "Tiếng Việt"}</label>
              <textarea value={form[`objectives_${lang}` as keyof typeof form] as string}
                onChange={(e) => set(`objectives_${lang}` as keyof ProjectFormData, e.target.value)}
                style={{ padding: "5px 8px", fontSize: 12, minHeight: 36, resize: "vertical" }} />
            </div>
          ))}
        </fieldset>

        {/* Deliverables */}
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
          <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>{t("projectMgmt.form.deliverables", locale)}</legend>
          {(["zh", "en", "vi"] as const).map((lang) => (
            <div key={lang} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: lang !== "vi" ? 8 : 0 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>{lang === "zh" ? "中文" : lang === "en" ? "English" : "Tiếng Việt"}</label>
              <textarea value={form[`deliverables_${lang}` as keyof typeof form] as string}
                onChange={(e) => set(`deliverables_${lang}` as keyof ProjectFormData, e.target.value)}
                style={{ padding: "5px 8px", fontSize: 12, minHeight: 36, resize: "vertical" }} />
            </div>
          ))}
        </fieldset>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="badge badge-info" disabled={saving}
            style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px" }}>
            {saving ? t("common.saving", locale) : isEdit ? t("common.save", locale) : t("projectMgmt.form.submit", locale)}
          </button>
          <button type="button" className="badge badge-muted"
            style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px" }}
            onClick={() => { setForm(emptyForm); onCancel?.(); }}>
            {t("common.cancel", locale)}
          </button>
        </div>
      </form>
    </div>
  );
}
