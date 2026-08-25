import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { einvoiceApi, type EinvoiceConfig } from "../api/einvoice";

const PROVIDERS = ["VNPT", "Viettel", "FPT", "MISA"];

export function EinvoiceConfigPanel({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [config, setConfig] = useState<EinvoiceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    providerName: "",
    apiEndpoint: "",
    apiKey: "",
    apiSecret: "",
    taxCode: "",
    companyName: "",
    companyAddress: "",
    bankAccount: "",
    bankName: "",
  });

  useEffect(() => {
    einvoiceApi.getConfig()
      .then(c => {
        setConfig(c);
        setForm({
          providerName: c.providerName ?? "",
          apiEndpoint: c.apiEndpoint ?? "",
          apiKey: c.apiKeyMasked ?? "",
          apiSecret: "",
          taxCode: c.taxCode ?? "",
          companyName: c.companyName ?? "",
          companyAddress: c.companyAddress ?? "",
          bankAccount: c.bankAccount ?? "",
          bankName: c.bankName ?? "",
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await einvoiceApi.updateConfig(form);
      alert(t("einvoice.configSaved", locale) ?? "配置已保存");
      window.location.reload();
    } catch (e: any) { alert(e?.message ?? "Save failed"); }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;

  const field = (label: string, key: keyof typeof form, type = "text", placeholder?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{label}</label>
      {canManage ? (
        <input
          type={type}
          value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          placeholder={placeholder ?? label}
          style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4 }}
        />
      ) : (
        <span style={{ padding: "6px 0" }}>{form[key] || "—"}</span>
      )}
    </div>
  );

  return (
    <div className="surface-panel">
      <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>{t("einvoice.config.title", locale) ?? "电子发票配置"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{t("einvoice.config.provider", locale) ?? "服务商"}</label>
          {canManage ? (
            <select
              value={form.providerName}
              onChange={e => setForm(f => ({ ...f, providerName: e.target.value }))}
              style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4 }}
            >
              <option value="">—</option>
              {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <span style={{ padding: "6px 0" }}>{form.providerName || "—"}</span>
          )}
        </div>
        {field(t("einvoice.config.endpoint", locale) ?? "API Endpoint", "apiEndpoint", "url")}
        {field(t("einvoice.config.apiKey", locale) ?? "API Key", "apiKey", "text", "Enter API key")}
        {field(t("einvoice.config.apiSecret", locale) ?? "API Secret", "apiSecret", "password", "Enter API secret (leave blank to keep current)")}
        {field(t("einvoice.config.taxCode", locale) ?? "税号", "taxCode")}
        {field(t("einvoice.config.companyName", locale) ?? "公司名称", "companyName")}
        {field(t("einvoice.config.companyAddress", locale) ?? "公司地址", "companyAddress")}
        {field(t("einvoice.config.bankAccount", locale) ?? "银行账号", "bankAccount")}
        {field(t("einvoice.config.bankName", locale) ?? "银行名称", "bankName")}
      </div>
      {canManage && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "6px 16px", background: "var(--primary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {saving ? "..." : (t("einvoice.btn.save", locale) ?? "保存配置")}
          </button>
        </div>
      )}
    </div>
  );
}
