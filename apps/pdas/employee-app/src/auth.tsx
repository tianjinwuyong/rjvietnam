import React, { useState } from "react";
import { api, setToken, setUsername } from "./api";
import type { Locale } from "./i18n";
import { t } from "./i18n";


interface Props {
  locale: Locale;
  onLogin: () => void;
}

export default function LoginScreen({ locale, onLogin }: Props) {
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async (u: string, p: string) => {
    setLoading(true);
    setErr("");
    try {
      const res = await api.post<{ item: { token: string; user: { username: string } } }>("/auth/login", { username: u, password: p });
      if (res.item?.token) {
        setToken(res.item.token);
        setUsername(res.item.user?.username ?? u);
        onLogin();
      } else {
        setErr(t("login_failed", locale));
      }
    } catch (e: any) {
      setErr(e.message || t("login_failed", locale));
    }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (username && password) doLogin(username, password);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: "#f1f5f9", marginBottom: 8 }}>{t("app_title", locale)}</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 32 }}>{t("login_title", locale)}</div>



      <div style={{ width: "100%", maxWidth: 360, background: "#1e293b", borderRadius: 14, padding: 24 }}>
        <input value={username} onChange={e => setUser(e.target.value)} placeholder={t("username", locale)}
          style={{ width: "100%", padding: "14px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #334155", background: "#0f172a", color: "#f1f5f9", marginBottom: 12, outline: "none", boxSizing: "border-box" }} />
        <input type="password" value={password} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} placeholder={t("password", locale)}
          style={{ width: "100%", padding: "14px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #334155", background: "#0f172a", color: "#f1f5f9", marginBottom: 12, outline: "none", boxSizing: "border-box" }} />
        {err && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button onClick={handleSubmit} disabled={loading || !username || !password}
          style={{ width: "100%", padding: "14px", fontSize: 16, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer", background: loading ? "#475569" : "#3b82f6", color: "#fff", opacity: loading ? 0.6 : 1 }}>
          {loading ? t("loading", locale) : t("login_btn", locale)}
        </button>
      </div>
    </div>
  );
}
