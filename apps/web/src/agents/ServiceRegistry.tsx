import { useState, useEffect } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { serviceRegistryApi, type ServiceRegistryEntry, type ServiceUpdateStatus } from "../api/service";

interface Props {
  locale: Locale;
  canManage: boolean;
}

const STATUS_COLORS: Record<ServiceUpdateStatus, string> = {
  active: "badge-ok",
  deprecated: "badge-warning",
  removed: "badge-danger",
};

export function ServiceRegistry({ locale, canManage }: Props) {
  const [entries, setEntries] = useState<ServiceRegistryEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", version: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  function load() {
    setEntries(serviceRegistryApi.list());
  }

  useEffect(() => { load(); }, []);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) { setError(t("service.registry.error.nameRequired", locale)); return; }
    if (!form.version.trim()) { setError(t("service.registry.error.versionRequired", locale)); return; }
    serviceRegistryApi.create(form);
    setForm({ name: "", version: "", description: "" });
    setShowForm(false);
    load();
  }

  function handleRemove(id: number) {
    if (!window.confirm(t("service.registry.confirmRemove", locale))) return;
    serviceRegistryApi.remove(id);
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("service.registry.title", locale)}</h2>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>{t("service.registry.subtitle", locale)}</p>
        </div>
        {canManage && (
          <button className="action-button" type="button" onClick={() => { setShowForm(true); setError(null); }}>
            {t("service.registry.register", locale)}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 16px" }}>{t("service.registry.formTitle", locale)}</h3>
          {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              {t("service.registry.name", locale)} *
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                style={{ padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              {t("service.registry.version", locale)} *
              <input value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                placeholder="v1.0.0"
                style={{ padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, gridColumn: "1 / -1" }}>
              {t("service.registry.description", locale)}
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                style={{ padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", resize: "vertical" }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="action-button" type="submit">{t("button.confirm", locale)}</button>
            <button className="action-button" type="button" onClick={() => setShowForm(false)} style={{ background: "var(--surface-2)", color: "var(--text)" }}>{t("button.cancel", locale)}</button>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 13 }}>
          {t("service.registry.empty", locale)}
        </div>
      ) : (
        <table className="data-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>{t("service.registry.name", locale)}</th>
              <th>{t("service.registry.version", locale)}</th>
              <th>{t("service.registry.status", locale)}</th>
              <th>{t("service.registry.registeredAt", locale)}</th>
              <th>{t("service.registry.description", locale)}</th>
              {canManage && <th style={{ width: 80 }}></th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ fontWeight: 500 }}>{e.name}</td>
                <td><code style={{ fontSize: 12, background: "var(--nav)", padding: "2px 6px", borderRadius: 3 }}>{e.version}</code></td>
                <td><span className={`badge ${STATUS_COLORS[e.updateStatus]}`}>{t(`service.registry.status.${e.updateStatus}` as any, locale)}</span></td>
                <td style={{ color: "var(--muted)" }}>{e.registeredAt}</td>
                <td style={{ color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</td>
                {canManage && (
                  <td>
                    <button className="icon-btn danger" type="button" onClick={() => handleRemove(e.id)}
                      title={t("service.registry.remove", locale)}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
