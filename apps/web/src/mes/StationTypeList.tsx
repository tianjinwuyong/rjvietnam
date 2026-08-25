import { useEffect, useState } from "react";
import { mesApi, type StationType, type CreateStationType, type UpdateStationType } from "../api/mes";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Props = { locale: Locale };

type Mode = "view" | "create" | "edit";

interface StationTypeForm {
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  category: "smt" | "post_smt" | "packaging" | "oqc" | "auxiliary";
  has_hardware: boolean;
  has_software: boolean;
}

const emptyForm = (): StationTypeForm => ({
  code: "",
  name_zh: "",
  name_en: "",
  name_vi: "",
  category: "smt",
  has_hardware: false,
  has_software: false,
});

const CATEGORIES = ["smt", "post_smt", "packaging", "oqc", "auxiliary"] as const;

export function StationTypeList({ locale }: Props) {
  const [items, setItems] = useState<StationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const [form, setForm] = useState<StationTypeForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    mesApi.getStationTypes()
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  function openCreate() {
    setForm(emptyForm());
    setEditId(null);
    setMode("create");
    setError(null);
  }

  function openEdit(item: StationType) {
    setForm({
      code: item.code,
      name_zh: item.name_zh,
      name_en: item.name_en || "",
      name_vi: item.name_vi || "",
      category: item.category as StationTypeForm["category"],
      has_hardware: item.has_hardware,
      has_software: item.has_software,
    });
    setEditId(item.id);
    setMode("edit");
    setError(null);
  }

  function closeModal() {
    setMode("view");
    setEditId(null);
    setError(null);
  }

  async function handleSave() {
    if (!form.code.trim()) { setError(t("mes.stationType.error.codeRequired", locale)); return; }
    if (!form.name_zh.trim()) { setError(t("mes.stationType.error.nameZhRequired", locale)); return; }
    if (!form.category) { setError(t("mes.stationType.error.categoryRequired", locale)); return; }
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const payload: CreateStationType = {
          code: form.code.trim(),
          name_zh: form.name_zh.trim(),
          name_en: form.name_en.trim() || undefined,
          name_vi: form.name_vi.trim() || undefined,
          category: form.category,
          has_hardware: form.has_hardware,
          has_software: form.has_software,
        };
        await mesApi.createStationType(payload);
      } else {
        const payload: UpdateStationType = {
          name_zh: form.name_zh.trim(),
          name_en: form.name_en.trim() || undefined,
          name_vi: form.name_vi.trim() || undefined,
          category: form.category,
          has_hardware: form.has_hardware,
          has_software: form.has_software,
        };
        await mesApi.updateStationType(editId!, payload);
      }
      const res = await mesApi.getStationTypes();
      setItems(res.items);
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleteId === null) return;
    setSaving(true);
    try {
      await mesApi.deleteStationType(deleteId);
      const res = await mesApi.getStationTypes();
      setItems(res.items);
      setConfirmDelete(false);
      setDeleteId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function categoryLabel(cat: string) {
    const key = `mes.stationType.category.${cat}` as const;
    return t(key, locale);
  }

  function statusLabel(status: string) {
    return status === "active"
      ? t("mes.stationType.status.active", locale)
      : t("mes.stationType.status.inactive", locale);
  }

  const filtered = q.trim()
    ? items.filter((it) =>
        it.code.toLowerCase().includes(q.toLowerCase()) ||
        it.name_zh.toLowerCase().includes(q.toLowerCase()) ||
        (it.name_en || "").toLowerCase().includes(q.toLowerCase())
      )
    : items;

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
          {t("mes.stationType.list.title", locale)}
        </h2>
        <p style={{ margin: "4px 0 0", color: "#666", fontSize: "14px" }}>
          {t("mes.stationType.list.subtitle", locale)}
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
        <input
          type="text"
          placeholder={t("mes.stationType.table.code", locale)}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            padding: "6px 12px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "14px",
            width: "240px",
          }}
        />
        <button
          onClick={openCreate}
          style={{
            padding: "6px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          + {t("mes.stationType.form.create", locale)}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "48px", color: "#666" }}>
          {t("common.loading", locale)}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={thStyle}>{t("mes.stationType.table.code", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.nameZh", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.nameEn", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.nameVi", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.category", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.hardware", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.software", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.status", locale)}</th>
              <th style={thStyle}>{t("mes.stationType.table.actions", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "#666" }}>
                  {t("common.loadError", locale)}
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>{item.code}</td>
                  <td style={tdStyle}>{item.name_zh}</td>
                  <td style={tdStyle}>{item.name_en || "—"}</td>
                  <td style={tdStyle}>{item.name_vi || "—"}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle("#dbeafe", "#1d4ed8")}>{categoryLabel(item.category)}</span>
                  </td>
                  <td style={tdStyle}>{item.has_hardware ? "✓" : "—"}</td>
                  <td style={tdStyle}>{item.has_software ? "✓" : "—"}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(item.status === "active" ? "#d1fae5" : "#fee2e2", item.status === "active" ? "#065f46" : "#991b1b")}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => openEdit(item)} style={iconBtnStyle("#f3f4f6", "#374151")}>
                      ✏️
                    </button>
                    <button
                      onClick={() => { setDeleteId(item.id); setConfirmDelete(true); }}
                      style={{ ...iconBtnStyle("#fee2e2", "#991b1b"), marginLeft: "6px" }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {/* Create/Edit Modal */}
      {(mode === "create" || mode === "edit") && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
                {mode === "create" ? t("mes.stationType.form.create", locale) : t("mes.stationType.form.edit", locale)}
              </h3>
              <button onClick={closeModal} style={iconBtnStyle("#f3f4f6", "#374151")}>✕</button>
            </div>

            {error && (
              <div style={{ padding: "8px 12px", background: "#fee2e2", color: "#991b1b", borderRadius: "6px", marginBottom: "12px", fontSize: "13px" }}>
                {error}
              </div>
            )}

            <div style={{ display: "grid", gap: "12px" }}>
              <div>
                <label style={labelStyle}>{t("mes.stationType.form.code", locale)} *</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={mode === "edit"}
                  placeholder={t("mes.stationType.form.codePlaceholder", locale)}
                  style={{ ...inputStyle, opacity: mode === "edit" ? 0.6 : 1 }}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationType.form.nameZh", locale)} *</label>
                <input
                  type="text"
                  value={form.name_zh}
                  onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationType.form.nameEn", locale)}</label>
                <input
                  type="text"
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationType.form.nameVi", locale)}</label>
                <input
                  type="text"
                  value={form.name_vi}
                  onChange={(e) => setForm({ ...form, name_vi: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationType.form.category", locale)} *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as StationTypeForm["category"] })}
                  style={inputStyle}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{categoryLabel(c)}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: "24px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.has_hardware}
                    onChange={(e) => setForm({ ...form, has_hardware: e.target.checked })}
                  />
                  {t("mes.stationType.form.hardware", locale)}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.has_software}
                    onChange={(e) => setForm({ ...form, has_software: e.target.checked })}
                  />
                  {t("mes.stationType.form.software", locale)}
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px", justifyContent: "flex-end" }}>
              <button onClick={closeModal} style={secondaryBtnStyle}>
                {t("mes.stationType.form.cancel", locale)}
              </button>
              <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
                {saving ? t("common.loading", locale) : t("mes.stationType.form.save", locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {confirmDelete && (
        <div style={overlayStyle}>
          <div style={{ ...modalStyle, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "16px", fontWeight: 600 }}>
              {t("mes.stationType.delete.title", locale)}
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#374151" }}>
              {t("mes.stationType.delete.message", locale)}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => { setConfirmDelete(false); setDeleteId(null); }} style={secondaryBtnStyle}>
                {t("mes.stationType.delete.cancel", locale)}
              </button>
              <button onClick={handleDelete} disabled={saving} style={{ ...primaryBtnStyle, background: "#dc2626" }}>
                {saving ? t("common.loading", locale) : t("mes.stationType.delete.confirm", locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: "13px",
  color: "#6b7280",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: "14px",
  color: "#374151",
};

const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "12px",
  fontSize: "12px",
  fontWeight: 500,
  background: bg,
  color,
});

const iconBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  padding: "4px 8px",
  border: "none",
  borderRadius: "4px",
  background: bg,
  color,
  cursor: "pointer",
  fontSize: "13px",
});

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: "12px",
  padding: "24px",
  width: "480px",
  maxWidth: "90vw",
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 500,
  color: "#374151",
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontSize: "14px",
  boxSizing: "border-box",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#f3f4f6",
  color: "#374151",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
};
