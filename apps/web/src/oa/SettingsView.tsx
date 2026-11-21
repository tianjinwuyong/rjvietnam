import { useCallback, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";

/** 系统设置（个人设置）—— 修改密码 + 界面语言偏好（auth.js） */

export function SettingsView({ locale }: { locale: Locale }) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changePwd = async () => {
    setError("");
    setMessage("");
    if (!oldPwd || !newPwd) return;
    if (newPwd !== confirmPwd) { setError(t("firstLogin.mismatch", locale)); return; }
    setBusy(true);
    try {
      await apiClient.post("/api/auth/password", { oldPassword: oldPwd, newPassword: newPwd });
      setMessage(t("settings.pwdChanged", locale));
      setOldPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setLang = async (lang: "zh" | "vi" | "en") => {
    setError("");
    try {
      await apiClient.put("/api/auth/language", { language: lang });
      setMessage(t("settings.languageHint", locale));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const input = { width: "100%", boxSizing: "border-box" as const, marginBottom: 10 };

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="surface-panel" style={{ padding: "16px 18px", flex: "1 1 320px", maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 14px" }}>{t("settings.changePwd", locale)}</h3>
        <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("settings.oldPwd", locale)}</label>
        <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} style={input} />
        <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("settings.newPwd", locale)}</label>
        <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} style={input} />
        <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("settings.confirmPwd", locale)}</label>
        <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} style={input} />
        {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
        {message && <p style={{ color: "#15803d", fontSize: 13 }}>{message}</p>}
        <button disabled={busy} onClick={() => void changePwd()}
          style={{ padding: "8px 18px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
          {t("common.save", locale)}
        </button>
      </div>

      <div className="surface-panel" style={{ padding: "16px 18px", flex: "1 1 260px", maxWidth: 360 }}>
        <h3 style={{ margin: "0 0 8px" }}>{t("settings.language", locale)}</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 12px" }}>{t("settings.languageHint", locale)}</p>
        <div style={{ display: "flex", gap: 8 }}>
          {([["zh", "中文"], ["vi", "Tiếng Việt"], ["en", "English"]] as const).map(([code, label]) => (
            <button key={code} onClick={() => void setLang(code)}
              style={{
                padding: "7px 14px", cursor: "pointer", borderRadius: 6,
                border: locale === (code === "zh" ? "zh-CN" : code === "vi" ? "vi-VN" : "en-US") ? "2px solid #0f766e" : "1px solid #cbd5e1",
                background: locale === (code === "zh" ? "zh-CN" : code === "vi" ? "vi-VN" : "en-US") ? "#ecfdf5" : "white",
                fontWeight: locale === (code === "zh" ? "zh-CN" : code === "vi" ? "vi-VN" : "en-US") ? 700 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
