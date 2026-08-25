import { useEffect, useState } from "react";
import { mesApi, type Station, type StationType, type ProductionLine } from "../api/mes";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Props = { locale: Locale };

type Mode = "view" | "create" | "edit";

// Station uses camelCase (nameZh, lineCode, stationType as string name)
// CreateStation expects snake_case (line_id, station_type_id as numbers)
interface StationForm {
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  lineId: number | null;
  stationTypeId: number | null;
  equipment_code: string;
  status: "idle" | "running" | "down" | "maintenance";
}

const emptyForm = (): StationForm => ({
  code: "",
  name_zh: "",
  name_en: "",
  name_vi: "",
  lineId: null,
  stationTypeId: null,
  equipment_code: "",
  status: "idle",
});

const STATUSES = ["idle", "running", "down", "maintenance"] as const;

export function StationMaster({ locale }: Props) {
  const [items, setItems] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const [form, setForm] = useState<StationForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteCode, setDeleteCode] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [stationTypes, setStationTypes] = useState<StationType[]>([]);

  useEffect(() => {
    Promise.all([
      mesApi.getStations(),
      mesApi.getLines(),
      mesApi.getStationTypes(),
    ]).then(([stationsRes, linesRes, typesRes]) => {
      setItems(stationsRes.items);
      setLines(linesRes.items);
      setStationTypes(typesRes.items);
    }).catch(() => {
      setItems([]);
    }).finally(() => setLoading(false));
  }, []);

  function openCreate() {
    setForm(emptyForm());
    setEditCode(null);
    setMode("create");
    setError(null);
  }

  function openEdit(item: Station) {
    // stationType in Station is the type name string; find matching type id
    const stMatch = stationTypes.find((st) => st.code === item.stationType || st.name_zh === item.stationType);
    const lineMatch = lines.find((l) => l.lineCode === item.lineCode);
    setForm({
      code: item.code,
      name_zh: item.nameZh || "",
      name_en: item.nameEn || "",
      name_vi: item.nameVi || "",
      lineId: lineMatch ? lineMatch.id : null,
      stationTypeId: stMatch ? stMatch.id : null,
      equipment_code: item.lineNameZh || "",
      status: "idle",
    });
    setEditCode(item.code);
    setMode("edit");
    setError(null);
  }

  function closeModal() {
    setMode("view");
    setEditCode(null);
    setError(null);
  }

  async function handleSave() {
    if (!form.code.trim()) { setError(t("mes.stationMaster.error.codeRequired", locale)); return; }
    if (!form.name_zh.trim()) { setError(t("mes.stationMaster.error.nameZhRequired", locale)); return; }
    if (!form.lineId) { setError(t("mes.stationMaster.error.lineRequired", locale)); return; }
    if (!form.stationTypeId) { setError(t("mes.stationMaster.error.stationTypeRequired", locale)); return; }
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        await mesApi.createStation({
          code: form.code.trim(),
          name_zh: form.name_zh.trim(),
          name_en: form.name_en.trim() || undefined,
          name_vi: form.name_vi.trim() || undefined,
          line_id: form.lineId!,
          station_type_id: form.stationTypeId!,
          equipment_code: form.equipment_code.trim() || undefined,
          status: form.status,
        });
      } else {
        await mesApi.updateStation(editCode!, {
          name_zh: form.name_zh.trim(),
          name_en: form.name_en.trim() || undefined,
          name_vi: form.name_vi.trim() || undefined,
          equipment_code: form.equipment_code.trim() || undefined,
          status: form.status,
        });
      }
      const res = await mesApi.getStations();
      setItems(res.items);
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteCode) return;
    setSaving(true);
    try {
      await mesApi.deleteStation(deleteCode);
      const res = await mesApi.getStations();
      setItems(res.items);
      setConfirmDelete(false);
      setDeleteCode(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function lineName(lineId: number) {
    const line = lines.find((l) => l.id === lineId);
    return line ? line.nameZh || line.lineCode : String(lineId);
  }

  function stationTypeName(typeId: number) {
    const st = stationTypes.find((s) => s.id === typeId);
    return st ? st.name_zh || st.code : String(typeId);
  }

  function statusLabel(status: string) {
    const key = `mes.stationMaster.status.${status}` as const;
    return t(key, locale);
  }

  const filtered = q.trim()
    ? items.filter((it) =>
        it.code.toLowerCase().includes(q.toLowerCase()) ||
        (it.nameZh || "").toLowerCase().includes(q.toLowerCase()) ||
        (it.nameEn || "").toLowerCase().includes(q.toLowerCase())
      )
    : items;

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
          {t("mes.stationMaster.list.title", locale)}
        </h2>
        <p style={{ margin: "4px 0 0", color: "#666", fontSize: "14px" }}>
          {t("mes.stationMaster.list.subtitle", locale)}
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
        <input
          type="text"
          placeholder={t("mes.stationMaster.table.code", locale)}
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
          + {t("mes.stationMaster.form.create", locale)}
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
              <th style={thStyle}>{t("mes.stationMaster.table.code", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.nameZh", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.nameEn", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.nameVi", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.line", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.stationType", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.equipment", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.status", locale)}</th>
              <th style={thStyle}>{t("mes.stationMaster.table.actions", locale)}</th>
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
                <tr key={item.code} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>{item.code}</td>
                  <td style={tdStyle}>{item.nameZh || "—"}</td>
                  <td style={tdStyle}>{item.nameEn || "—"}</td>
                  <td style={tdStyle}>{item.nameVi || "—"}</td>
                  <td style={tdStyle}>{item.lineCode}</td>
                  <td style={tdStyle}>{item.stationType}</td>
                  <td style={tdStyle}>{item.lineNameZh || "—"}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle("#f3f4f6", "#374151")}>
                      {statusLabel("idle")}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => openEdit(item)} style={iconBtnStyle("#f3f4f6", "#374151")}>
                      ✏️
                    </button>
                    <button
                      onClick={() => { setDeleteCode(item.code); setConfirmDelete(true); }}
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
                {mode === "create" ? t("mes.stationMaster.form.create", locale) : t("mes.stationMaster.form.edit", locale)}
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
                <label style={labelStyle}>{t("mes.stationMaster.form.code", locale)} *</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={mode === "edit"}
                  placeholder={t("mes.stationMaster.form.codePlaceholder", locale)}
                  style={{ ...inputStyle, opacity: mode === "edit" ? 0.6 : 1 }}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.nameZh", locale)} *</label>
                <input
                  type="text"
                  value={form.name_zh}
                  onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.nameEn", locale)}</label>
                <input
                  type="text"
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.nameVi", locale)}</label>
                <input
                  type="text"
                  value={form.name_vi}
                  onChange={(e) => setForm({ ...form, name_vi: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.line", locale)} *</label>
                <select
                  value={form.lineId ?? ""}
                  onChange={(e) => setForm({ ...form, lineId: e.target.value ? Number(e.target.value) : null })}
                  disabled={mode === "edit"}
                  style={{ ...inputStyle, opacity: mode === "edit" ? 0.6 : 1 }}
                >
                  <option value="">—</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>{l.nameZh || l.lineCode}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.stationType", locale)} *</label>
                <select
                  value={form.stationTypeId ?? ""}
                  onChange={(e) => setForm({ ...form, stationTypeId: e.target.value ? Number(e.target.value) : null })}
                  disabled={mode === "edit"}
                  style={{ ...inputStyle, opacity: mode === "edit" ? 0.6 : 1 }}
                >
                  <option value="">—</option>
                  {stationTypes.filter((s) => s.status === "active").map((s) => (
                    <option key={s.id} value={s.id}>{s.name_zh || s.code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.equipment", locale)}</label>
                <input
                  type="text"
                  value={form.equipment_code}
                  onChange={(e) => setForm({ ...form, equipment_code: e.target.value })}
                  placeholder={t("mes.stationMaster.form.equipmentPlaceholder", locale)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("mes.stationMaster.form.status", locale)}</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as StationForm["status"] })}
                  style={inputStyle}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px", justifyContent: "flex-end" }}>
              <button onClick={closeModal} style={secondaryBtnStyle}>
                {t("mes.stationMaster.form.cancel", locale)}
              </button>
              <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
                {saving ? t("common.loading", locale) : t("mes.stationMaster.form.save", locale)}
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
              {t("mes.stationMaster.delete.title", locale)}
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#374151" }}>
              {t("mes.stationMaster.delete.message", locale)}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => { setConfirmDelete(false); setDeleteCode(null); }} style={secondaryBtnStyle}>
                {t("mes.stationMaster.delete.cancel", locale)}
              </button>
              <button onClick={handleDelete} disabled={saving} style={{ ...primaryBtnStyle, background: "#dc2626" }}>
                {saving ? t("common.loading", locale) : t("mes.stationMaster.delete.confirm", locale)}
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
