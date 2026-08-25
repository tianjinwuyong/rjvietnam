import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { FoolProofRule } from "../api/mes";

const statusBadge: Record<string, string> = {
  active: "badge-ok",
  disabled: "badge-warning",
};

const ruleTypeBadge: Record<string, string> = {
  material: "badge-info",
  reel: "badge-warning",
  both: "badge-ok",
};

function RuleRow({ rule, locale, onEdit, onDelete }: { rule: FoolProofRule; locale: Locale; onEdit: (r: FoolProofRule) => void; onDelete: (id: number) => void }) {
  return (
    <tr>
      <td>{rule.stationCode}</td>
      <td>{rule.stationName ?? "—"}</td>
      <td>{rule.lineCode}</td>
      <td><span className="badge badge-info">{rule.feederSlot}</span></td>
      <td>{rule.materialCode}</td>
      <td>{rule.materialName ?? "—"}</td>
      <td>{rule.materialReelCode ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
      <td><span className={`badge ${ruleTypeBadge[rule.ruleType]}`}>{t(`mes.foolproof.ruleType.${rule.ruleType}` as any, locale)}</span></td>
      <td><span className={`badge ${statusBadge[rule.status]}`}>{t(`mes.foolproof.status.${rule.status}` as any, locale)}</span></td>
      <td>{rule.createdBy ?? "—"}</td>
      <td>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="action-button" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onEdit(rule)}>
            <Pencil size={12} />
          </button>
          <button type="button" className="action-button" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onDelete(rule.id)}>
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function FoolProofRules({ locale }: { locale: Locale }) {
  const [rules, setRules] = useState<FoolProofRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("active");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FoolProofRule | null>(null);
  const [form, setForm] = useState({ stationId: "", feederSlot: "", materialId: "", materialReelCode: "", ruleType: "material", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { load(); }, [statusFilter]);

  function load() {
    setLoading(true);
    mesApi.getFoolProofRules({ status: statusFilter === "all" ? undefined : statusFilter }).then(r => {
      setRules(r.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  function handleEdit(rule: FoolProofRule) {
    setEditing(rule);
    setForm({ stationId: "", feederSlot: rule.feederSlot, materialId: "", materialReelCode: rule.materialReelCode ?? "", ruleType: rule.ruleType, notes: rule.notes ?? "" });
    setShowForm(true);
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this rule?")) return;
    mesApi.deleteFoolProofRule(id).then(() => load());
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.feederSlot) { setError("Feeder slot required"); return; }
    setSubmitting(true);
    setError("");
    const payload = {
      stationId: Number(form.stationId) || 9, // default AOI-01 for demo
      feederSlot: form.feederSlot,
      materialId: form.materialId ? Number(form.materialId) : undefined,
      materialReelCode: form.materialReelCode || undefined,
      ruleType: form.ruleType,
      notes: form.notes || undefined,
    };
    const op = editing
      ? mesApi.updateFoolProofRule(editing.id, payload)
      : mesApi.createFoolProofRule(payload);
    op.then(() => { setShowForm(false); setEditing(null); setForm({ stationId: "", feederSlot: "", materialId: "", materialReelCode: "", ruleType: "material", notes: "" }); load(); setSubmitting(false); })
      .catch(() => { setError("Save failed"); setSubmitting(false); });
  }

  const activeCount = rules.filter(r => r.status === "active").length;
  const bothCount = rules.filter(r => r.ruleType === "both").length;

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("mes.foolproof.filter.active" as any, locale)}</span>
          <strong>{activeCount}</strong>
          <span className={`badge ${activeCount > 0 ? "badge-ok" : "badge-warning"}`}>{t("common.status" as any, locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("mes.foolproof.ruleType.both" as any, locale)}</span>
          <strong>{bothCount}</strong>
          <span className="badge badge-info"><ShieldCheck size={12} /></span>
        </article>
        <article className="stat-card">
          <span>{t("common.total" as any, locale)}</span>
          <strong>{rules.length}</strong>
          <span className="badge badge-info">{t("mes.foolproof.title" as any, locale)}</span>
        </article>
      </div>

      <div className="toolbar">
        {(["active", "disabled", "all"] as const).map(s => (
          <button key={s} type="button" className={`action-button ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
            {t(`mes.foolproof.filter.${s}` as any, locale)}
          </button>
        ))}
        <button type="button" className="action-button" style={{ marginLeft: "auto" }} onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ stationId: "", feederSlot: "", materialId: "", materialReelCode: "", ruleType: "material", notes: "" }); }}>
          {showForm ? t("common.cancel" as any, locale) : <><Plus size={14} /> {t("mes.foolproof.add" as any, locale)}</>}
        </button>
      </div>

      {showForm && (
        <section className="surface-panel">
          <div className="section-header">
            <h2>{editing ? t("mes.foolproof.edit" as any, locale) : t("mes.foolproof.add" as any, locale)}</h2>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.foolproof.station" as any, locale)} *</span>
              <select value={form.stationId} onChange={e => setForm(f => ({ ...f, stationId: e.target.value }))} required>
                <option value="9" key="station-9">AOI-01</option>
                <option value="13" key="station-13">ICT-01</option>
                <option value="14" key="station-14">FCT-01</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.foolproof.feederSlot" as any, locale)} *</span>
              <input value={form.feederSlot} onChange={e => setForm(f => ({ ...f, feederSlot: e.target.value }))} placeholder="F01" required />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.foolproof.materialCode" as any, locale)}</span>
              <input value={form.materialId} onChange={e => setForm(f => ({ ...f, materialId: e.target.value }))} placeholder="Material ID (number)" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.foolproof.materialReelCode" as any, locale)}</span>
              <input value={form.materialReelCode} onChange={e => setForm(f => ({ ...f, materialReelCode: e.target.value }))} placeholder="REEL-XXXXXXXX" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.foolproof.ruleType.label" as any, locale)}</span>
              <select value={form.ruleType} onChange={e => setForm(f => ({ ...f, ruleType: e.target.value }))}>
                <option value="material" key="rule-material">{t("mes.foolproof.ruleType.material" as any, locale)}</option>
                <option value="reel" key="rule-reel">{t("mes.foolproof.ruleType.reel" as any, locale)}</option>
                <option value="both" key="rule-both">{t("mes.foolproof.ruleType.both" as any, locale)}</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("common.notes" as any, locale)}</span>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" />
            </label>
            {error && <p style={{ gridColumn: "1/-1", color: "var(--danger)", fontSize: 13 }}>{error}</p>}
            <div style={{ gridColumn: "1/-1" }}>
              <button type="submit" className="action-button" disabled={submitting}>{submitting ? "..." : t("common.save" as any, locale)}</button>
            </div>
          </form>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header">
          <h2>{t("mes.foolproof.title" as any, locale)}</h2>
          <p>{t("mes.foolproof.subtitle" as any, locale)}</p>
        </div>
        {loading ? (
          <div className="placeholder-view">{t("common.loading" as any, locale)}</div>
        ) : rules.length === 0 ? (
          <div className="placeholder-view"><CheckCircle size={40} /><p>{t("common.noData" as any, locale)}</p></div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("mes.foolproof.station" as any, locale)}</th>
                  <th>{t("mes.foolproof.stationName" as any, locale)}</th>
                  <th>{t("mes.foolproof.line" as any, locale)}</th>
                  <th>{t("mes.foolproof.feederSlot" as any, locale)}</th>
                  <th>{t("mes.foolproof.materialCode" as any, locale)}</th>
                  <th>{t("mes.foolproof.materialName" as any, locale)}</th>
                  <th>{t("mes.foolproof.materialReelCode" as any, locale)}</th>
                  <th>{t("mes.foolproof.ruleType.label" as any, locale)}</th>
                  <th>{t("common.status" as any, locale)}</th>
                  <th>{t("common.createdBy" as any, locale)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => <RuleRow key={r.id} rule={r} locale={locale} onEdit={handleEdit} onDelete={handleDelete} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}