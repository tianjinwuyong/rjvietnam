/**
 * WmsLifecycleExempt — ⑥ 免检物料管理
 * 非IQC检验产品管理：免检物料设置 + 批次采购/有效期 + 销毁执行记录
 */

import { useState, useEffect, useCallback } from "react";
import { wmsApi } from "../api/wms";
import type { ExemptMaterial, ExemptLot, DestructionRecord } from "../api/wms";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: "#fff", borderRadius: 8, padding: "16px 20px", border: `3px solid ${color ?? "#e0e0e0"}`, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "#333", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Alert Badge ─────────────────────────────────────────────────────────────────

function AlertBadge({ level, locale }: { level: string | null; locale: Locale }) {
  if (!level) return <span style={{ color: "#999" }}>—</span>;
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    EXPIRED:   { label: t("wms.expired",       locale), color: "#fff", bg: "#c0392b" },
    RED_L3:    { label: t("wms.level3Red",     locale), color: "#fff", bg: "#e74c3c" },
    BLUE_L2:   { label: t("wms.level2Blue",    locale), color: "#fff", bg: "#2980b9" },
    YELLOW_L1: { label: t("wms.level1Yellow",  locale), color: "#000", bg: "#f39c12" },
    NORMAL:    { label: t("wms.normalInUse",   locale), color: "#fff", bg: "#27ae60" },
  };
  const c = cfg[level] ?? cfg.NORMAL;
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, color: c.color, background: c.bg }}>{c.label}</span>;
}

// ── Section: 免检物料主数据 ──────────────────────────────────────────────────────

function ExemptMaterialsSection({ refreshKey, locale }: { refreshKey: number; locale: Locale }) {
  const [materials, setMaterials] = useState<ExemptMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toggleLoading, setToggleLoading] = useState<number | null>(null);

  const fetchMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await wmsApi.getExemptMaterials();
      setMaterials(data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials, refreshKey]);

  const toggleIqcRequired = async (materialId: number, currentValue: boolean) => {
    setToggleLoading(materialId);
    setMsg(null);
    try {
      const result = await wmsApi.patchMaterialIqcRequired(materialId, !currentValue);
      if ((result as { success?: boolean }).success !== false) {
        setMsg({ ok: true, text: `已${!currentValue ? t("wms.setExempt", locale) : t("wms.cancelExempt", locale)}` });
        fetchMaterials();
      } else {
        setMsg({ ok: false, text: t("wms.updateFailed", locale) });
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setToggleLoading(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t("wms.exemptMaterials", locale)}</h3>
        <span style={{ fontSize: 12, color: "#888" }}>— {t("wms.exemptMaterialsDesc", locale)} QC</span>
      </div>
      {msg && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: msg.ok ? "#d4edda" : "#f8d7da", color: msg.ok ? "#155724" : "#721c24", fontSize: 13 }}>
          {msg.text}
        </div>
      )}
      {loading ? (
        <div style={{ color: "#888", padding: 20 }}>{t("common.loading", locale)}</div>
      ) : error ? (
        <div style={{ color: "#c0392b", padding: 20 }}>
          <div>{t("common.error", locale)}: {error}</div>
          <button onClick={() => fetchMaterials()} style={{ marginTop: 10, padding: "5px 16px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>{t("common.retry", locale)}</button>
        </div>
      ) : materials.length === 0 ? (
        <div style={{ color: "#aaa", padding: 20, textAlign: "center" }}>{t("wms.noExemptMaterials", locale)} QC 检验流程）</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8f9fa" }}>
                {["wms.seqNo", "common.materialCode", "wms.materialNameZh", "wms.materialNameEn", "wms.validityMonths", "wms.currentStatus"].map(h => t(h, locale)).map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, borderBottom: "2px solid #e0e0e0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 12px" }}>{i + 1}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#2c3e50" }}>{m.code}</td>
                  <td style={{ padding: "8px 12px" }}>{m.nameZh}</td>
                  <td style={{ padding: "8px 12px", color: "#666" }}>{m.nameEn ?? "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>{m.shelfLifeDays ?? "—"}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      display: "inline-block", padding: "2px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                      background: "#27ae60", color: "#fff",
                    }}>{t("wms.exempt", locale)}</span>
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

// ── Section: 免检批次台账 ───────────────────────────────────────────────────────

function ExemptLotsSection({ refreshKey, locale }: { refreshKey: number; locale: Locale }) {
  const [lots, setLots] = useState<ExemptLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await wmsApi.getExemptLots();
      setLots(data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLots(); }, [fetchLots, refreshKey]);

  const remainingDays = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const diff = Math.floor((new Date(expiryDate).getTime() - Date.now()) / 86400000);
    return diff;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t("wms.exemptLots", locale)}</h3>
        <span style={{ fontSize: 12, color: "#888" }}>{t("wms.exemptLotsDesc", locale)}</span>
      </div>
      {loading ? (
        <div style={{ color: "#888", padding: 20 }}>{t("common.loading", locale)}</div>
      ) : error ? (
        <div style={{ color: "#c0392b", padding: 20 }}>{t("common.error", locale)}: {error}</div>
      ) : lots.length === 0 ? (
        <div style={{ color: "#aaa", padding: 20, textAlign: "center" }}>{t("wms.noExemptLots", locale)}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8f9fa" }}>
                {["common.lotNo", "common.materialCode", "common.materialName", "wms.supplier", "common.location", "wms.poDate", "common.expiryDate", "wms.stock", "wms.remainingDays", "wms.alert"].map(h => t(h, locale)).map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, borderBottom: "2px solid #e0e0e0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lots.map(lot => {
                const days = remainingDays(lot.expiryDate);
                return (
                  <tr key={lot.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#2c3e50" }}>{lot.lotNo}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.materialCode}</td>
                    <td style={{ padding: "8px 12px" }}>{lot.materialNameZh}</td>
                    <td style={{ padding: "8px 12px", color: "#666" }}>{lot.supplierCode ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.locationCode ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.poDate ? String(lot.poDate).slice(0, 10) : "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{lot.expiryDate ? String(lot.expiryDate).slice(0, 10) : "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>{lot.receivedQty}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", color: days !== null && days <= 0 ? "#c0392b" : days !== null && days <= 30 ? "#e74c3c" : "#27ae60", fontWeight: 600 }}>
                      {days === null ? "—" : days <= 0 ? `${t("wms.overdueDays", locale).replace("{n}", String(Math.abs(days)))}` : `${days}${t("wms.days", locale)}`}
                    </td>
                    <td style={{ padding: "8px 12px" }}><AlertBadge level={lot.alertLevel} locale={locale} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Section: 销毁执行记录 ──────────────────────────────────────────────────────

function DestructionSection({ refreshKey, locale }: { refreshKey: number; locale: Locale }) {
  const [records, setRecords] = useState<DestructionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    destroyed_qty: "",
    destruction_at: "",
    destruction_supervisor_id: "",
    destruction_doc_url: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await wmsApi.getDestructionRecords();
      setRecords(data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords, refreshKey]);

  const handleEdit = (rec: DestructionRecord) => {
    setEditingId(rec.id);
    setForm({
      destroyed_qty: rec.destroyedQty ? String(rec.destroyedQty) : "",
      destruction_at: rec.destructionAt ? rec.destructionAt.slice(0, 16) : "",
      destruction_supervisor_id: rec.destructionSupervisorId ? String(rec.destructionSupervisorId) : "",
      destruction_doc_url: rec.destructionDocUrl ?? "",
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!editingId) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const result = await wmsApi.patchDestructionRecord(editingId, {
        destroyed_qty: form.destroyed_qty ? Number(form.destroyed_qty) : undefined,
        destruction_at: form.destruction_at || undefined,
        destruction_supervisor_id: form.destruction_supervisor_id ? Number(form.destruction_supervisor_id) : undefined,
        destruction_doc_url: form.destruction_doc_url || undefined,
      });
      if ((result as { success?: boolean }).success !== false) {
        setMsg({ ok: true, text: t("wms.destructionRecordSaved", locale) });
        setShowForm(false);
        setEditingId(null);
        fetchRecords();
      } else {
        setMsg({ ok: false, text: t("wms.saveFailed", locale) });
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t("wms.destructionRecords", locale)}</h3>
          <span style={{ fontSize: 12, color: "#888" }}>{t("wms.destructionRecordsDesc", locale)}</span>
        </div>
        <button
          onClick={() => { setShowForm(false); setEditingId(null); setForm({ destroyed_qty: "", destruction_at: "", destruction_supervisor_id: "", destruction_doc_url: "" }); }}
          style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2c3e50", color: "#fff", cursor: "pointer", fontSize: 13 }}
        >
          {t("wms.refresh", locale)}
        </button>
      </div>

      {msg && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: msg.ok ? "#d4edda" : "#f8d7da", color: msg.ok ? "#155724" : "#721c24", fontSize: 13 }}>
          {msg.text}
        </div>
      )}

      {showForm && (
        <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#2c3e50", marginBottom: 4 }}>编辑 {t("wms.destructionRecords", locale)}（ID: {editingId}）</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#666" }}>{t("wms.actualDestroyQty", locale)} *</span>
              <input value={form.destroyed_qty} onChange={e => setForm(f => ({ ...f, destroyed_qty: e.target.value }))} style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#666" }}>{t("wms.destroyTime", locale)} *</span>
              <input type="datetime-local" value={form.destruction_at} onChange={e => setForm(f => ({ ...f, destruction_at: e.target.value }))} style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#666" }}>{t("wms.supervisorId", locale)}</span>
              <input value={form.destruction_supervisor_id} onChange={e => setForm(f => ({ ...f, destruction_supervisor_id: e.target.value }))} placeholder={t("wms.employeeIdExample", locale)} style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#666" }}>{t("wms.destroyDocUrl", locale)}</span>
              <input value={form.destruction_doc_url} onChange={e => setForm(f => ({ ...f, destruction_doc_url: e.target.value }))} placeholder="/docs/destruction/2026-01-01.pdf" style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSubmit} disabled={submitting} style={{ padding: "7px 18px", borderRadius: 6, border: "none", background: "#27ae60", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {submitting ? t("wms.saving", locale) : t("common.save", locale)}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} style={{ padding: "7px 18px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: 13 }}>
              {t("common.cancel", locale)}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#888", padding: 20 }}>{t("common.loading", locale)}</div>
      ) : error ? (
        <div style={{ color: "#c0392b", padding: 20 }}>{t("common.error", locale)}: {error}</div>
      ) : records.length === 0 ? (
        <div style={{ color: "#aaa", padding: 20, textAlign: "center" }}>{t("wms.noDestructionRecords", locale)}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8f9fa" }}>
                {["wms.applicationNo", "common.lot", "common.material", "wms.applyQty", "wms.destroyQty", "wms.destroyTime", "wms.supervisor", "wms.destroyDoc", "wms.disposalMethod", "common.action"].map(h => t(h, locale)).map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, borderBottom: "2px solid #e0e0e0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(rec => (
                <tr key={rec.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#2c3e50" }}>{rec.requestNo}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{rec.lotNo}</td>
                  <td style={{ padding: "8px 12px" }}>{rec.materialNameZh}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{rec.scrapQty}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: rec.destroyedQty ? "#27ae60" : "#c0392b", fontWeight: 700 }}>
                    {rec.destroyedQty != null ? rec.destroyedQty : t("wms.notFilled", locale)}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                    {rec.destructionAt ? String(rec.destructionAt).slice(0, 16) : <span style={{ color: "#c0392b" }}>{t("wms.notFilled", locale)}</span>}
                  </td>
                  <td style={{ padding: "8px 12px" }}>{rec.destructionSupervisor ?? <span style={{ color: "#c0392b" }}>{t("wms.notFilled", locale)}</span>}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {rec.destructionDocUrl ? (
                      <a href={rec.destructionDocUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2980b9", fontSize: 12 }}>{t("wms.viewDoc", locale)}</a>
                    ) : <span style={{ color: "#c0392b" }}>{t("wms.notUploaded", locale)}</span>}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#666" }}>{rec.disposalMethod}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <button onClick={() => handleEdit(rec)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #2980b9", background: "none", color: "#2980b9", cursor: "pointer", fontSize: 12 }}>
                      {t("wms.fillIn", locale)}
                    </button>
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

// ── Main Component ─────────────────────────────────────────────────────────────

export function WmsLifecycleExempt({ permissions, locale }: { permissions: string[]; locale: Locale }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [section, setSection] = useState<"materials" | "lots" | "destruction">("materials");

  const sections = [
    { key: "materials" as const, label: t("wms.exemptMaterials", locale) },
    { key: "lots" as const, label: t("wms.exemptLots", locale) },
    { key: "destruction" as const, label: t("wms.destructionRecords", locale) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 32px" }}>
      {/* Section nav */}
      <div style={{ display: "flex", gap: 0, padding: "16px 24px 0", borderBottom: "2px solid #e0e0e0" }}>
        {sections.map(sec => (
          <button key={sec.key} onClick={() => setSection(sec.key)} style={{
            padding: "8px 18px", border: "none",
            borderBottom: section === sec.key ? "3px solid #27ae60" : "3px solid transparent",
            background: "none", cursor: "pointer", fontSize: 13, fontWeight: section === sec.key ? 700 : 400,
            color: section === sec.key ? "#27ae60" : "#888", marginBottom: -2,
          }}>
            {sec.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setRefreshKey(k => k + 1)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: 12, color: "#666", marginBottom: 2 }}>
          ↻ {t("wms.refresh", locale)}
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px 0" }}>
        {section === "materials" && <ExemptMaterialsSection refreshKey={refreshKey} locale={locale} />}
        {section === "lots"      && <ExemptLotsSection refreshKey={refreshKey} locale={locale} />}
        {section === "destruction" && <DestructionSection refreshKey={refreshKey} locale={locale} />}
      </div>
    </div>
  );
}
