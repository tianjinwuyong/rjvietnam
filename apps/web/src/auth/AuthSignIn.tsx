import { useState } from "react";
import { Languages } from "lucide-react";
import { LoginIdentificationBot } from "./LoginIdentificationBot";
import { t, localeLabels, locales } from "../i18n";
import { authApi } from "../api";
import type { Locale } from "../../../../packages/shared-types/src/factory";

export type SignInResult = {
  token: string;
  username: string;
  displayName: string;
  roleKey: string;
  locale: Locale;
  permissions: string[];
};

const DEMO_ACCOUNTS = [
  { username: "MO_LI_BIN", displayName: "莫立斌", password: "Factory@123", roleLabel: "Vietnam Factory Manager · Full Access · 越南工厂负责人" },
  { username: "MENG_YING", displayName: "蒙营", password: "my", roleLabel: "Factory Manager · Administrator" },
  { username: "VN_OP_001", displayName: "SMT PDA 上料员", password: "Factory@123", roleLabel: "SMT PDA Material Loader" },
  { username: "VN_MATERIAL_RECEIVER", displayName: "SMT物料收料员", password: "Factory@123", roleLabel: "SMT Material Receiver · PDA / Scanner" },
  { username: "PMC_CN_01", displayName: "Chen PMC 01", password: "Factory@123", roleLabel: "PMC Planning" },
  { username: "VN_WH_001", displayName: "Warehouse 01", password: "Factory@123", roleLabel: "Warehouse" },
  { username: "QC_VN_01", displayName: "QC Vietnam 01", password: "Factory@123", roleLabel: "Quality" },
  { username: "MGT_CN_01", displayName: "Li Wei", password: "Factory@123", roleLabel: "Management" },
];

export function AuthSignIn({
  locale,
  onSignIn,
  onSetLocale,
}: {
  locale: Locale;
  onSignIn: (result: SignInResult) => void;
  onSetLocale?: (locale: Locale) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (user: { username: string; password: string }) => {
    try {
      const result = await authApi.login(user.username, user.password);
      onSignIn({
        token: result.token,
        username: result.user.username,
        displayName: result.user.displayName,
        roleKey: result.user.roleKey,
        locale: result.user.locale,
        permissions: result.user.permissions,
      });
    } catch (err) {
      setError(t("auth.accessDenied", locale));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    await handleSignIn({ username, password });
  };

  return (
    <div className="auth-shell">
      {onSetLocale && (
        <div className="auth-locale-bar">
          <label className="locale-switch">
            <Languages size={16} />
            <select value={locale} onChange={(e) => onSetLocale(e.target.value as Locale)}>
              {locales.map((item) => (
                <option value={item} key={item}>{localeLabels[item]}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="auth-grid">
        <div>
          <div className="surface-panel auth-panel">
            {/* Login Identification Robot */}
            <div style={{ marginBottom: 14 }}>
              <LoginIdentificationBot username={username} locale={locale} />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <form onSubmit={handleSubmit}>
              <div className="field">
                <span>{t("auth.username", locale)}</span>
                <div className="field-input">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("auth.username", locale)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="field">
                <span>{t("auth.password", locale)}</span>
                <div className="field-input">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.password", locale)}
                  />
                </div>
              </div>
              <button type="submit" className="action-button auth-submit">
                {t("auth.signIn", locale)}
              </button>
            </form>

            <small className="auth-hint">{t("auth.demoPassword", locale)}</small>
          </div>
        </div>

        <div>
          <div className="surface-panel auth-panel">
            <div className="section-header">
              <div>
                <h2>{t("auth.demoAccounts", locale)}</h2>
                <p>{t("auth.signIn", locale)}</p>
              </div>
            </div>

            {/* One-click login */}
            <button
              type="button"
              className="action-button"
              style={{ width: "100%", marginBottom: 12, padding: "14px", fontSize: 16, fontWeight: 700, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
              onClick={() => handleSignIn({ username: "MO_LI_BIN", password: "Factory@123" })}
            >
              {locale === 'zh-CN' ? '越南工厂负责人全权限快速登录 — 莫立斌' : locale === 'vi-VN' ? 'Đăng nhập nhanh toàn quyền Trưởng nhà máy Việt Nam — 莫立斌' : 'Vietnam Factory Manager Full-Access Quick Login — 莫立斌'}
            </button>

            <button
              type="button"
              className="action-button"
              style={{ width: "100%", marginBottom: 12, padding: "14px", fontSize: 16, fontWeight: 700, background: "#b91c1c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
              onClick={() => handleSignIn({ username: "MENG_YING", password: "my" })}
            >
              {locale === 'zh-CN' ? '工厂经理快速登录 — 蒙营' : locale === 'vi-VN' ? 'Đăng nhập nhanh Quản lý nhà máy — 蒙营' : 'Factory Manager Quick Login — 蒙营'}
            </button>

            <button
              type="button"
              className="action-button"
              style={{ width: "100%", marginBottom: 12, padding: "14px", fontSize: 16, fontWeight: 700, background: "var(--color-primary, #2563eb)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
              onClick={() => handleSignIn({ username: "VN_OP_001", password: "Factory@123" })}
            >
              {locale === 'zh-CN' ? '📦 SMT PDA 上料员快速登录' : locale === 'vi-VN' ? '📦 Đăng nhập nhanh nhân viên nạp liệu SMT PDA' : '📦 SMT PDA Material Loader Quick Login'}
            </button>

            <div className="auth-account-list">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  className="auth-account"
                  onClick={() => {
                    setUsername(account.username);
                    setPassword(account.password);
                    handleSignIn({ username: account.username, password: account.password });
                  }}
                >
                  <strong>{account.displayName}</strong>
                  <span>{account.username}</span>
                  <small>{account.roleLabel}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
