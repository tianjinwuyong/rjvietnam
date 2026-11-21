// 工单下发 WMS —— 概览卡片 + 推送配置表单
// 嫁接自 D:\rj\repos\MES-ruijing web 页「订单管理 → 工单下发 WMS」的 overview/config 段
import { useState } from "react";
import type { Locale } from "../../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { itfApi, type ItfOverview } from "../api";

const card: React.CSSProperties = {
  flex: "1 1 160px", minWidth: 160, padding: "14px 16px",
  border: "1px solid var(--border, #e2e8f0)", borderRadius: 10,
};

export function OverviewCards({ locale, data, onRefresh }: {
  locale: Locale; data: ItfOverview; onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const resetKey = async () => {
    if (!window.confirm(t("itf.reset_confirm", locale))) return;
    setBusy(true);
    try {
      await itfApi.resetKey();
      setMsg(t("itf.reset_done", locale));
      onRefresh();
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(false); }
  };

  const stat = (label: string, value: number | string, extra?: string) => (
    <div key={label} style={card}>
      <div style={{ fontSize: 13, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {extra ? <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{extra}</div> : null}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {stat(t("itf.open_mo", locale), data.openMo)}
        {stat(t("itf.pulled", locale), `${data.pullOk}/${data.pullCount}`, data.lastPull
          ? `${data.lastPull.at} · ${data.lastPull.action}` : undefined)}
        {stat(t("itf.pushed", locale), data.pushed)}
        {stat(t("itf.push_fail", locale), data.pushFail)}
      </div>

      <div style={{ ...card, marginTop: 12, flex: "1 1 100%" }}>
        <div style={{ fontSize: 13, color: "#64748b" }}>{t("itf.api_key", locale)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <code style={{ fontSize: 14, userSelect: "all" }}>{data.apiKey}</code>
          <button disabled={busy} onClick={resetKey} style={btn}>{t("itf.reset_key", locale)}</button>
          {msg ? <span style={{ fontSize: 12, color: "#64748b" }}>{msg}</span> : null}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
          {t("itf.key_hint", locale)} · <code>{data.baseHint}</code>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 8, border: "1px solid var(--border, #cbd5e1)",
  background: "transparent", cursor: "pointer", fontSize: 13,
};

export function PushConfigForm({ locale, data, onSaved }: {
  locale: Locale; data: ItfOverview; onSaved: () => void;
}) {
  const [url, setUrl] = useState(data.push.url || "");
  const [key, setKey] = useState(data.push.key || "");
  const [enabled, setEnabled] = useState(Boolean(data.push.enabled));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      await itfApi.savePushConfig({ url, key, enabled });
      setMsg(t("itf.saved", locale));
      onSaved();
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(false); }
  };

  const input: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border, #cbd5e1)",
    fontSize: 13, width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ ...card, flex: "1 1 100%", display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", alignItems: "end" }}>
      <label style={{ fontSize: 13 }}>
        {t("itf.push_url", locale)}
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/api/mes/v1/mo-upsert" style={{ ...input, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 13 }}>
        {t("itf.push_key", locale)}
        <input value={key} onChange={e => setKey(e.target.value)} style={{ ...input, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        {t("itf.push_enabled", locale)}
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button disabled={busy} onClick={save} style={btn}>{t("itf.save", locale)}</button>
        {msg ? <span style={{ fontSize: 12, color: "#64748b" }}>{msg}</span> : null}
      </div>
    </div>
  );
}
