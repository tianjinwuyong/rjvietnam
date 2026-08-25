import { useState, useEffect } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { serviceApi, type TicketFormData } from "../api/service";

const emptyForm: TicketFormData = {
  customerCode: "", category: "complaint", priority: "normal",
  subject: "", description: "", sourceChannel: "manual", assignee: "",
};

const CATEGORIES = ["complaint", "quality_issue", "defect_report", "technical_support", "delivery", "other"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const SOURCE_CHANNELS = ["manual", "email", "phone", "wechat", "zalo", "web", "api"];

interface Props {
  locale: Locale;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function ServiceTicketRegistration({ locale, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<TicketFormData>(emptyForm);
  const [done, setDone] = useState<{ ticketNo: string; subject: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.customerCode.trim()) { setError(t("service.form.error.customerRequired", locale)); return; }
    if (!form.subject.trim()) { setError(t("service.form.error.subjectRequired", locale)); return; }
    setSaving(true);
    try {
      const res = await serviceApi.createTicket(form);
      setDone({ ticketNo: res.item.ticketNo ?? "", subject: res.item.subject ?? "" });
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
              <strong>{t("service.form.success", locale)}</strong>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 8, fontFamily: "monospace" }}>
              {done.ticketNo} — {done.subject}
            </p>
            <button
              className="badge badge-info"
              style={{ cursor: "pointer", border: "none", marginTop: 12, fontSize: 13, padding: "6px 14px" }}
              onClick={() => { setDone(null); setForm(emptyForm); onSaved?.(); }}>
              {t("buttons.createAnother", locale)}
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
            <h2>{t("service.ticket.form.title", locale)}</h2>
            <p>{t("service.ticket.form.subtitle", locale)}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
          {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>
                {t("table.party", locale)} <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                value={form.customerCode}
                onChange={(e) => setForm((p) => ({ ...p, customerCode: e.target.value }))}
                placeholder="CUST-SONY-002"
                style={{ padding: "6px 10px", fontSize: 14 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("service.source", locale)}</label>
              <select
                value={form.sourceChannel}
                onChange={(e) => setForm((p) => ({ ...p, sourceChannel: e.target.value }))}
                style={{ padding: "6px 10px", fontSize: 14 }}>
                {SOURCE_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>{t(`service.source.${ch}` as any, locale)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("service.category.label", locale)}</label>
              <select
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                style={{ padding: "6px 10px", fontSize: 14 }}>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{t(`service.category.${cat}` as any, locale)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("common.priority", locale)}</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                style={{ padding: "6px 10px", fontSize: 14 }}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{t(`service.priority.${p}` as any, locale)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("service.subject", locale)} <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
              placeholder={t("service.ticket.form.subjectPlaceholder", locale)}
              style={{ padding: "6px 10px", fontSize: 14 }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("service.description", locale)}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              style={{ padding: "6px 10px", fontSize: 14, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("service.assignee", locale)}</label>
            <input
              type="text"
              value={form.assignee}
              onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
              placeholder="VN_CS_001"
              style={{ padding: "6px 10px", fontSize: 14 }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="badge badge-info" disabled={saving}
              style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px" }}>
              {saving ? t("common.saving", locale) : t("service.ticket.form.submit", locale)}
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
