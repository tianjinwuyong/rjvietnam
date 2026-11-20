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

// Quick-login buttons. Passwords are NOT stored here -- a public build must not


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
          </div>
        </div>

      </div>
    </div>
  );
}
