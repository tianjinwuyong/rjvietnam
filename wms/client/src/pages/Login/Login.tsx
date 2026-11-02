import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@client/src/i18n';
import { useAuth } from '@client/src/auth/AuthContext';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Globe, Eye, EyeOff } from 'lucide-react';
import CompanyLogo from '@client/src/components/CompanyLogo';
import ThemeSwitcher from '@client/src/theme/ThemeSwitcher';
import { login } from '@client/src/api/system';
import { toast } from 'sonner';
import type { LanguageCode } from '@shared/api.interface';

const LoginPage: React.FC = () => {
  const { t, lang, setLang } = useI18n();
  const { loginByAccount } = useAuth();
  const navigate = useNavigate();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!account || !password) {
      toast.error(t('common.required'));
      return;
    }
    setLoading(true);
    try {
      const res = await login({ account, password });
      if (res.code === 0 && res.data) {
        loginByAccount(res.data);
        navigate('/');
      } else {
        toast.error(res.message || t('login.wrongAccount'));
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('login.wrongAccount');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  const languages: { code: LanguageCode; label: string }[] = [
    { code: 'zh', label: '中文' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'en', label: 'English' },
  ];

  return (
    <div data-wms-login className="min-h-screen bg-gradient-to-br from-background via-primary-soft to-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* 装饰性背景圆 */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-success/5 blur-3xl" />

      <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
        {/* 登录前也能选配色，避免暗光环境被一屏亮色刺眼 */}
        <ThemeSwitcher variant="pill" />
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-2 px-4 py-2 bg-white/72 backdrop-blur-xl text-muted-foreground rounded-xl hover:text-primary hover:bg-white/90 transition-all duration-200 shadow-sm border border-white/50"
          >
            <Globe size={16} />
            <span className="text-sm font-medium">
              {lang === 'zh' ? '中文' : lang === 'vi' ? 'Tiếng Việt' : 'English'}
            </span>
          </button>
          {showLangMenu && (
            <div className="absolute right-0 top-full mt-2 w-36 bg-white/85 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl overflow-hidden z-50">
              {languages.map(l => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                  className={`w-full px-4 py-2.5 text-left text-sm hover:bg-primary-soft transition-colors ${
                    lang === l.code ? 'text-primary font-semibold bg-primary-soft' : 'text-foreground'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/85 backdrop-blur-2xl rounded-[24px] shadow-2xl w-full max-w-[420px] overflow-hidden border border-white/60 relative z-10">
        <div className="px-8 pt-8 pb-5 border-b border-border/50">
          <div className="flex items-center gap-4">
            <CompanyLogo size={64} className="flex-shrink-0 shadow-lg rounded-full" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground leading-tight">{t('login.title')}</h1>
              <p className="text-muted-foreground text-sm mt-1">{t('ui.仓库管理系统 · V10（测试版）')}</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6">
          <p className="text-center text-muted-foreground text-sm mb-5">{t('login.loginTip')}</p>
          <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/80 ml-1">{t('login.account')}</label>
            <Input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('login.account')}
              autoComplete="username"
              className="h-11"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/80 ml-1">{t('login.password')}</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('login.password')}
                autoComplete="current-password"
                className="pr-10 h-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/25 mt-2"
          >
            {loading ? t('common.loading') : t('login.loginBtn')}
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
