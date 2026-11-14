import React, { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Globe, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { useAuth } from '../../../auth/AuthContext';
import ChangePasswordDialog from '../../../components/ChangePasswordDialog';
import type { LanguageCode } from '@shared/api.interface';
import { setForceDesktop } from '../../../utils/device';
import { initAudioUnlock } from '../../../utils/audioUnlock';
import { redirectToHttps, getSecureContextState, fetchRuntimeConfig } from '../../../utils/secureContext';

interface PdaLayoutProps {
  title: string;
  showBack?: boolean;
  children: ReactNode;
}

const LANG_ORDER: LanguageCode[] = ['zh', 'vi', 'en'];
const LANG_LABEL: Record<LanguageCode, string> = { zh: '中', vi: 'VI', en: 'EN' };

/**
 * PDA 基础布局：固定顶部标题栏（返回 + 标题 + 语言切换），内容区滚动。
 */
const PdaLayout: React.FC<PdaLayoutProps> = ({ title, showBack = true, children }) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { lang, setLang } = useI18n();
  const { user, updateUser } = useAuth();
  /**
   * 首次登录或被管理员重置密码后强制改密。
   * 放在布局层而非首页，确保直接进入任意 PDA 页面也绕不过去。
   */
  const forceChangePwd = !!user?.isFirstLogin;
  const [insecure, setInsecure] = useState(false);
  const [insecureKind, setInsecureKind] = useState<'insecure-http' | 'insecure-cert' | ''>('');

  useEffect(() => {
    const state = getSecureContextState();
    setInsecure(state !== 'secure');
    setInsecureKind(state === 'secure' ? '' : state);
    // 预热运行时配置：拿到真实 HTTPS 端口，供上方"切换 HTTPS"按钮拼接地址
    void fetchRuntimeConfig();
    // 注册全局音频解锁：首次用户交互时自动解锁 AudioContext + 预热 speechSynthesis
    initAudioUnlock();
  }, []);

  // 切换路由时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [title]);

  const cycleLang = () => {
    const idx = LANG_ORDER.indexOf(lang);
    setLang(LANG_ORDER[(idx + 1) % LANG_ORDER.length]);
  };

  // 切换到电脑版：写入强制桌面版标志后跳转到根路径（此时会走 PC 端）
  const handleSwitchToDesktop = () => {
    setForceDesktop(true);
    window.location.href = '/';
  };

  // 跳转到 HTTPS：地址由 utils/secureContext 按主机名 + 实际 HTTPS 端口拼接，
  // 避免此前写死 replace(':3000', ':3443') 在端口变化时拼错
  const handleSwitchToHttps = () => {
    redirectToHttps();
  };

  return (
    <div className="pda-shell">
      <header className="pda-header">
        <div className="pda-header-left">
          {showBack && (
            <button
              type="button"
              className="pda-icon-btn"
              aria-label="back"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={24} />
            </button>
          )}
        </div>
        <h1 className="pda-header-title">{title}</h1>
        <div className="pda-header-right">
          <button type="button" className="pda-lang-btn" onClick={cycleLang}>
            <Globe size={16} />
            <span>{LANG_LABEL[lang]}</span>
          </button>
        </div>
      </header>

      {/* 非安全上下文警告条：摄像头扫码必须在 HTTPS 下才能用 */}
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

      <main className="pda-content">
        {children}
        <div className="pda-desktop-switch">
          <button type="button" className="pda-desktop-switch-btn" onClick={handleSwitchToDesktop}>
            {t('ui.切换到电脑版')}
          </button>
        </div>
      </main>

      {/* 强制改密：不提供关闭按钮，改完才放行；主动改密入口在 PDA 首页 */}
      <ChangePasswordDialog
        open={forceChangePwd}
        onOpenChange={() => { /* 强制模式下不接受关闭请求 */ }}
        forced={forceChangePwd}
        onSuccess={() => updateUser({ isFirstLogin: false })}
      />
    </div>
  );
};

export default PdaLayout;
