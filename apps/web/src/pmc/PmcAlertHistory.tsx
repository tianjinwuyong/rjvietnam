import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

interface AlertHistory {
  id: number;
  alert_type: string;
  work_order_code: string | null;
  line_code: string | null;
  priority: number | null;
  title: string;
  message: string;
  channel_name: string | null;
  channel_type: string | null;
  delivery_status: string;
  sent_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  overdue: "#ef4444",
  delay: "#f59e0b",
  material_risk: "#8b5cf6",
  ng: "#dc2626",
  stagnation: "#ea580c",
};

export function PmcAlertHistory({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<AlertHistory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [alertType, setAlertType] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);

  // Notification form state
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifWo, setNotifWo] = useState("");

  const PAGE_SIZE = 20;

  function loadHistory(type?: string) {
    setLoading(true);
    fetch(`/pmc/alert-history?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${type ? `&alertType=${type}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.data?.items ?? []);
        setTotal(d.data?.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  function loadChannels() {
    fetch("/pmc/alert-channels")
      .then((r) => r.json())
      .then((d) => setChannels(d.items ?? d.data ?? []))
      .catch(() => {});
  }

  useEffect(() => { loadHistory(alertType); }, [page, alertType]);
  useEffect(() => { loadChannels(); }, []);

  async function handleSendAlert() {
    if (!notifTitle || !notifMessage) { alert(t("pmc.alert.titleContentRequired", locale)); return; }
    setSending(true);
    try {
      const res = await fetch("/pmc/alerts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            alertType: "manual",
            workOrderCode: notifWo || undefined,
            title: notifTitle,
            message: notifMessage,
          },
        }),
      });
      const d = await res.json();
      setSendResult({ success: res.ok, data: d });
      if (res.ok) {
        loadHistory(alertType);
        setNotifTitle("");
        setNotifMessage("");
        setNotifWo("");
      }
    } catch (e: any) {
      setSendResult({ success: false, error: e.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.alertHistory", locale)}</h2>
            <p>{t("pmc.alertHistoryDesc", locale)}</p>
          </div>
        </div>
      </div>

      {/* Send notification form */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.sendManualAlert", locale)}</h3></div>
        {channels.filter((c) => c.is_active).length === 0 && (
          <div style={{ fontSize: 12, color: "var(--warning)", marginBottom: 8, padding: "4px 8px", background: "rgba(245,158,11,0.1)", borderRadius: 4 }}>
            ⚠️ {t("pmc.alert.noChannelsEnabled", locale)}
          </div>
        )}
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="field">
            <label>{t("pmc.alertTitle", locale)}</label>
            <input type="text" value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} placeholder={t("pmc.alert.titlePlaceholder", locale)} />
          </div>
          <div className="field">
            <label>{t("pmc.workOrder", locale)}</label>
            <input type="text" value={notifWo} onChange={(e) => setNotifWo(e.target.value)} placeholder={t("pmc.alert.woPlaceholder", locale)} />
          </div>
          <div className="field">
            <label>{t("pmc.channels", locale)}</label>
            <div style={{ fontSize: 12, color: "var(--muted)", paddingTop: 6 }}>
              {channels.length === 0 ? t("common.loading", locale) : `${channels.filter((c) => c.is_active).length} ${t("pmc.alert.channelsEnabled", locale)}`}
            </div>
          </div>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>{t("pmc.message", locale)}</label>
          <input type="text" value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} placeholder={t("pmc.alert.messagePlaceholder", locale)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="action-button" onClick={handleSendAlert} disabled={sending}>
            {sending ? t("common.loading", locale) : t("pmc.sendAlert", locale)}
          </button>
          {channels.map((ch) => (
            !ch.is_active && (
              <span key={ch.id} className="badge badge-muted" style={{ fontSize: 11, alignSelf: "center" }}>
                {ch.name} ({t("pmc.alert.disabled", locale)})
              </span>
            )
          ))}
        </div>
        {sendResult && (
          <div style={{ fontSize: 12, marginTop: 8, color: sendResult.success ? "var(--ok)" : "var(--danger)" }}>
            {sendResult.success
              ? `${t("pmc.alert.sendSuccess", locale)} ${sendResult.data?.data?.sent ?? 0}/${sendResult.data?.data?.total ?? 0} ${t("pmc.alert.channels", locale)}`
              : `${t("pmc.alert.sendFailed", locale)} ${sendResult.error ?? sendResult.data?.message}`}
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="surface-panel">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("common.filter", locale)}:</span>
          {["", "overdue", "delay", "material_risk", "ng", "stagnation"].map((f) => (
            <button
              key={f}
              className={`badge ${alertType === f ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => { setAlertType(f); setPage(0); }}
            >
              {f === "" ? t("pmc.all", locale) : f}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{t("pmc.alert.totalRecords", locale)}{total}{t("pmc.alert.records", locale)}</span>
        </div>
      </div>

      {/* History table */}
      <div className="surface-panel">
        {loading ? (
          <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>{t("common.loading", locale)}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>{t("common.noData", locale)}</div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>{t("pmc.alertType", locale)}</th>
                  <th>{t("common.title", locale)}</th>
                  <th>{t("pmc.workOrder", locale)}</th>
                  <th>{t("common.line", locale)}</th>
                  <th>{t("pmc.channel", locale)}</th>
                  <th>{t("pmc.status", locale)}</th>
                  <th>{t("pmc.sentAt", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id}>
                    <td>{page * PAGE_SIZE + i + 1}</td>
                    <td>
                      <span
                        className="badge"
                        style={{ background: TYPE_COLORS[item.alert_type] ?? "#6b7280", color: "#fff" }}
                      >
                        {item.alert_type}
                      </span>
                    </td>
                    <td><strong>{item.title}</strong></td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{item.work_order_code ?? "—"}</td>
                    <td>{item.line_code ?? "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{item.channel_name ?? "—"}</td>
                    <td>
                      <span className={`badge ${item.delivery_status === "sent" ? "badge-ok" : "badge-danger"}`}>
                        {item.delivery_status === "sent" ? t("pmc.alert.sent", locale) : t("pmc.alert.failed", locale)}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>
                      {new Date(item.sent_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
            <button className="badge badge-muted" style={{ cursor: "pointer" }} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>←</button>
            <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
            <button className="badge badge-muted" style={{ cursor: "pointer" }} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>→</button>
          </div>
        )}
      </div>
    </div>
  );
}
