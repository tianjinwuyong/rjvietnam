import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Globe, ShieldAlert } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import { login } from '../../api/pda';
import { errMsg } from './utils';
import type { LanguageCode } from '@shared/api.interface';
import { setForceDesktop } from '../../utils/device';
import CompanyLogo from '../../components/CompanyLogo';
import { speakError } from '../../utils/speech';
import { initAudioUnlock } from '../../utils/audioUnlock';
import { redirectToHttps, getSecureContextState, fetchRuntimeConfig } from '../../utils/secureContext';

const LANGS: { code: LanguageCode; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
];

/** P1-a: PDA 登录页 */
const PdaLogin: React.FC = () => {
  const { t, lang, setLang } = useI18n();
  const { loginByAccount } = useAuth();
  const navigate = useNavigate();

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [insecureKind, setInsecureKind] = useState<'insecure-http' | 'insecure-cert' | ''>('');

  useEffect(() => {
    const state = getSecureContextState();
    setInsecure(state !== 'secure');
    setInsecureKind(state === 'secure' ? '' : state);
    // 预热运行时配置，确保"切换 HTTPS"按钮拿到正确的 HTTPS 端口
    void fetchRuntimeConfig();
    // 注册全局音频解锁：首次用户交互时自动解锁 AudioContext + 预热 speechSynthesis
    initAudioUnlock();
  }, []);

  const handleSwitchToHttps = () => {
    redirectToHttps();
  };

  // 切换到电脑版：写入强制桌面版标志后跳转到根路径（此时会走 PC 端）
  const handleSwitchToDesktop = () => {
    setForceDesktop(true);
    window.location.href = '/';
  };

  const handleLogin = async () => {    if (!account.trim() || !password) {
      const msg = t('pda.loginRequired');
      setErr(msg);
      speakError(msg);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const res = await login({ account: account.trim(), password });
      if (res.code === 0 && res.data) {
        loginByAccount(res.data);
        navigate('/pda/home', { replace: true });
      } else {
        const msg = res.message || t('pda.loginFailed');
        setErr(msg);
        speakError(msg);
      }
    } catch (e: any) {
      const msg = errMsg(e, t('pda.loginFailed'));
      setErr(msg);
      speakError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pda-shell">
      <header className="pda-header">
        <div className="pda-header-left" />
        <h1 className="pda-header-title">{t('pda.appName')}</h1>
        <div className="pda-header-right">
          <button
            type="button"
            className="pda-lang-btn"
            onClick={() => {
              const cur = LANGS.findIndex((l) => l.code === lang);
              setLang(LANGS[(cur + 1) % LANGS.length].code);
            }}
          >
            <Globe size={16} />
            <span>{lang === 'zh' ? '中' : lang === 'vi' ? 'VI' : 'EN'}</span>
          </button>
        </div>
      </header>

      {/* 非安全上下文警告条 */}
      {insecure && (
        <div className="pda-https-warning">
          <div className="pda-https-warning-left">
            <ShieldAlert size={18} className="flex-shrink-0" />
            <div className="pda-https-warning-text">
              <strong>
                {insecureKind === 'insecure-cert' ? t('ui.证书未被信任') : t('ui.当前为 HTTP 访问')}
              </strong>
              <span>
                {insecureKind === 'insecure-cert'
                  ? t('ui.摄像头被浏览器禁用，请先安装证书')
                  : t('ui.摄像头扫码需HTTPS，请切换')}
              </span>
            </div>
          </div>
          <button type="button" className="pda-https-switch-btn" onClick={handleSwitchToHttps}>
            {t('ui.切换 HTTPS')}
          </button>
        </div>
      )}

      <main className="pda-content pda-login-body">
        <div className="pda-login-brand">
          <CompanyLogo size={72} className="pda-login-logo-img" />
          <div className="pda-login-brand-text">
            <h1 className="pda-login-company">{t('login.title')}</h1>
            <p className="pda-login-sub">{t('pda.appName')}</p>
          </div>
        </div>
        <h2 className="pda-login-sub">{t('pda.loginTitle')}</h2>

        <div className="pda-field">
          <label className="pda-label">{t('pda.account')}</label>
          <div className="pda-input-wrap">
            <User size={18} className="pda-input-icon" />
            <input
              className="pda-input"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t('pda.accountPlaceholder')}
              autoComplete="username"
            />
          </div>
        </div>

        <div className="pda-field">
          <label className="pda-label">{t('pda.password')}</label>
          <div className="pda-input-wrap">
            <Lock size={18} className="pda-input-icon" />
            <input
              className="pda-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLogin();
              }}
              placeholder={t('pda.passwordPlaceholder')}
              autoComplete="current-password"
            />
          </div>
        </div>

        {err && <div className="pda-error-text">{err}</div>}

        <button
          type="button"
          className="pda-btn pda-btn-primary pda-btn-block"
          disabled={loading}
          onClick={handleLogin}
        >
          {loading ? t('pda.loggingIn') : t('pda.login')}
        </button>

        <div className="pda-desktop-switch">
          <button type="button" className="pda-desktop-switch-btn" onClick={handleSwitchToDesktop}>
            {t('ui.切换到电脑版')}
          </button>
        </div>
      </main>
    </div>
  );
};

export default PdaLogin;
