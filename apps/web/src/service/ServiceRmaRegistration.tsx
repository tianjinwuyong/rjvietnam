import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { serviceApi } from "../api/service";
import type { RmaRequest } from "../../../../packages/shared-types/src/factory";

const REASON_CODES = ["DEFECT-COSMETIC", "DEFECT-FUNCTIONAL", "DEFECT-ELEC", "DEFECT-MECH", "WRONG-PART", "DAMAGED", "OTHER"];
const DISPOSITIONS = ["repair", "replace", "refund", "scrap"];

interface RmaFormData {
  customerCode: string;
  productCode: string;
  serialNo: string;
  qty: number;
  reasonCode: string;
  customerComplaint: string;
}

const emptyForm: RmaFormData = {
  customerCode: "", productCode: "", serialNo: "", qty: 1,
  reasonCode: "DEFECT-COSMETIC", customerComplaint: "",
};

interface Props {
  locale: Locale;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function ServiceRmaRegistration({ locale, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<RmaFormData>(emptyForm);
  const [done, setDone] = useState<{ rmaNumber: string; productCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.customerCode.trim()) { setError(t("service.form.error.customerRequired", locale)); return; }
    if (!form.productCode.trim()) { setError(t("service.form.error.productRequired", locale)); return; }
    if (!form.serialNo.trim()) { setError(t("service.form.error.serialRequired", locale)); return; }
    if (form.qty < 1) { setError(t("service.form.error.qtyRequired", locale)); return; }
    setSaving(true);
    try {
      const payload: Omit<RmaRequest, "id" | "rmaNumber" | "createdAt"> = {
        customerCode: form.customerCode,
        productCode: form.productCode,
        serialNo: form.serialNo,
        qty: form.qty,
        reasonCode: form.reasonCode,
        customerComplaint: form.customerComplaint,
        status: "submitted",
        inspectionResult: "pending",
      };
      const res = await serviceApi.createRma(payload);
      setDone({ rmaNumber: res.item.rmaNumber ?? "", productCode: res.item.productCode ?? "" });
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
              {done.rmaNumber} — {done.productCode}
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
            <h2>{t("service.rma.form.title", locale)}</h2>
            <p>{t("service.rma.form.subtitle", locale)}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
          {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
              <label style={{ fontSize: 13, color: "var(--muted)" }}>
                {t("common.product", locale)} <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                value={form.productCode}
                onChange={(e) => setForm((p) => ({ ...p, productCode: e.target.value }))}
                placeholder="PROD-DISPLAY-D1"
                style={{ padding: "6px 10px", fontSize: 14 }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>
                {t("service.serialNo", locale)} <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                value={form.serialNo}
                onChange={(e) => setForm((p) => ({ ...p, serialNo: e.target.value }))}
                placeholder="D1SN-260615-0042"
                style={{ padding: "6px 10px", fontSize: 14 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>
                {t("common.qty", locale)} <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="number"
                min={1}
                value={form.qty}
                onChange={(e) => setForm((p) => ({ ...p, qty: parseInt(e.target.value) || 1 }))}
                style={{ padding: "6px 10px", fontSize: 14 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("service.rma.reasonCode", locale)}</label>
            <select
              value={form.reasonCode}
              onChange={(e) => setForm((p) => ({ ...p, reasonCode: e.target.value }))}
              style={{ padding: "6px 10px", fontSize: 14 }}>
              {REASON_CODES.map((rc) => (
                <option key={rc} value={rc}>{rc}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("service.rma.complaint", locale)}</label>
            <textarea
              value={form.customerComplaint}
              onChange={(e) => setForm((p) => ({ ...p, customerComplaint: e.target.value }))}
              rows={3}
              placeholder={t("service.rma.form.complaintPlaceholder", locale)}
              style={{ padding: "6px 10px", fontSize: 14, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="badge badge-info" disabled={saving}
              style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px" }}>
              {saving ? t("common.saving", locale) : t("service.rma.form.submit", locale)}
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
