import { useState, useEffect } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { Department, Employee } from "../api";

const DEPT_TYPES = [
  { code: "management", label_zh: "管理层", label_en: "Management", label_vi: "Quản lý" },
  { code: "production", label_zh: "生产部", label_en: "Production", label_vi: "Sản xuất" },
  { code: "quality", label_zh: "品质部", label_en: "Quality", label_vi: "Chất lượng" },
  { code: "engineering", label_zh: "工程部", label_en: "Engineering", label_vi: "Kỹ thuật" },
  { code: "warehouse", label_zh: "仓库部", label_en: "Warehouse", label_vi: "Kho" },
  { code: "planning", label_zh: "计划部", label_en: "Planning", label_vi: "Kế hoạch" },
  { code: "hr", label_zh: "人事部", label_en: "HR", label_vi: "Nhân sự" },
  { code: "finance", label_zh: "财务部", label_en: "Finance", label_vi: "Tài chính" },
  { code: "admin", label_zh: "行政部", label_en: "Admin", label_vi: "Hành chính" },
  { code: "general", label_zh: "综合部", label_en: "General", label_vi: "Tổng hợp" },
];

interface Props {
  locale: Locale;
  department?: Department | null;
  departments: Department[];
  employees: Employee[];
  onClose: () => void;
  onSaved: (dept: Department) => void;
  onDelete?: (dept: Department) => void;
}

export function DepartmentModal({ locale, department, departments, employees, onClose, onSaved, onDelete }: Props) {
  const isEdit = !!department;

  const [form, setForm] = useState({
    code: department?.code ?? "",
    name_zh: department?.name_zh ?? "",
    name_en: department?.name_en ?? "",
    name_vi: department?.name_vi ?? "",
    deptType: department?.deptType ?? "production",
    parentId: department?.parentId ?? null,
    managerId: department?.managerId ?? null,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code || !form.name_zh) {
      setError("Code and Chinese name are required");
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (isEdit && department) {
        const updated = await hrApi.updateDepartment(department.id, {
          name_zh: form.name_zh,
          name_en: form.name_en,
          name_vi: form.name_vi,
          deptType: form.deptType,
          parentId: form.parentId ?? undefined,
          managerId: form.managerId ?? undefined,
        });
        onSaved(updated.item);
      } else {
        const created = await hrApi.createDepartment({
          code: form.code,
          name_zh: form.name_zh,
          name_en: form.name_en,
          name_vi: form.name_vi,
          deptType: form.deptType,
          parentId: form.parentId ?? undefined,
          managerId: form.managerId ?? undefined,
        });
        onSaved(created.item);
      }
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 480 }}>
        <div className="modal-header">
          <h3>{isEdit ? t("buttons.edit", locale) : t("buttons.create", locale)} - {t("hr.subnav.departments", locale)}</h3>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-grid">
              <div className="form-field">
                <label>{t("hr.department.code", locale)} *</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  disabled={isEdit}
                  placeholder="e.g. SMT, ENG, QC"
                  maxLength={20}
                  required
                />
              </div>

              <div className="form-field">
                <label>{t("hr.department.type", locale)}</label>
                <select
                  value={form.deptType}
                  onChange={(e) => setForm({ ...form, deptType: e.target.value })}
                >
                  {DEPT_TYPES.map((t_) => (
                    <option key={t_.code} value={t_.code}>
                      {locale === "zh-CN" ? t_.label_zh : locale === "vi-VN" ? t_.label_vi : t_.label_en}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field" style={{ gridColumn: "1/-1" }}>
                <label>{t("common.name", locale)} (zh) *</label>
                <input
                  type="text"
                  value={form.name_zh}
                  onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                  placeholder={t("hr.department.nameZhPlaceholder", locale)}
                  required
                />
              </div>

              <div className="form-field">
                <label>Name (English)</label>
                <input
                  type="text"
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  placeholder="Department Name"
                />
              </div>

              <div className="form-field">
                <label>Tên (Tiếng Việt)</label>
                <input
                  type="text"
                  value={form.name_vi}
                  onChange={(e) => setForm({ ...form, name_vi: e.target.value })}
                  placeholder="Tên phòng ban"
                />
              </div>

              <div className="form-field">
                <label>{t("hr.department.parent", locale)}</label>
                <select
                  value={form.parentId ?? ""}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option key="other" value="">{t("hr.other", locale)}</option>
                  {departments
                    .filter((d) => d.id !== department?.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name_zh}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-field">
                <label>{t("hr.department.manager", locale)}</label>
                <select
                  value={form.managerId ?? ""}
                  onChange={(e) => setForm({ ...form, managerId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option key="other" value="">{t("hr.other", locale)}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name_zh} - {emp.positionTitleZh}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            {isEdit && onDelete && (
              <button
                type="button"
                className="btn-danger"
                onClick={() => { if (department) onDelete(department); }}
                style={{ marginRight: "auto" }}
              >
                {t("buttons.delete", locale)}
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t("common.cancel", locale)}
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "..." : t("buttons.save", locale)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
