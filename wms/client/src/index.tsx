import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { createPortal } from 'react-dom';
import { ConfigProvider } from 'antd';

import RoutesComponent from './app.tsx';
import './index.css';
import './pda.css';
import './table.css';
import { Toaster } from '@client/src/components/ui/sonner';
import { primeRuntimeConfig } from './utils/secureContext';
import { initTheme } from './theme/ThemeProvider';

// 启动即预读运行时网络配置（HTTP/HTTPS 端口、局域网地址）。
// 移动端需要据此把用户从 HTTP 引导到正确的 HTTPS 地址才能使用摄像头。
primeRuntimeConfig();

// 在首次渲染前套用用户上次选择的配色，避免先闪一帧默认蓝
initTheme();

/**
 * 输入方式单一来源：写入 <html data-input="coarse|fine">。
 * 此后所有多端尺寸差异只读这个属性，CSS 不再四处写 @media (pointer: coarse)。
 *
 * - 用 pointer || any-pointer：工业平板插一个鼠标接收器时 pointer 会变成 fine，
 *   只判断 pointer 会导致"插拔一个接收器就换一套尺寸"。
 * - ?input=coarse / localStorage 兜底：某些触摸层被系统识别为 pen/hover，
 *   两个 media query 可能同时为 false，此时现场可手动切档，不必重打包。
 */
(() => {
  try {
    const coarse =
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(any-pointer: coarse)').matches;
    const forced =
      new URLSearchParams(window.location.search).get('input') ??
      window.localStorage.getItem('ui.input');
    document.documentElement.dataset.input =
      forced === 'coarse' || forced === 'fine' ? forced : coarse ? 'coarse' : 'fine';
  } catch {
    // 极端环境（禁用 localStorage / 无 matchMedia）下退回鼠标档，不阻断启动
    document.documentElement.dataset.input = 'fine';
  }
})();

const CLIENT_BASE_PATH = (import.meta as any).env?.CLIENT_BASE_PATH || '/';

// ErrorBoundary 在 I18nProvider 之外，无法用 useI18n()，这里按当前语言直接取文案
const ERROR_FALLBACK_TEXT = {
  zh: { title: '页面出错了', retry: '重试' },
  vi: { title: 'Đã xảy ra lỗi trang', retry: 'Thử lại' },
  en: { title: 'Page error', retry: 'Retry' },
};

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  const lang = (() => {
    try {
      const saved = localStorage.getItem('wms-lang');
      if (saved === 'vi' || saved === 'en' || saved === 'zh') return saved;
    } catch {
      /* 忽略 */
    }
    return 'zh';
  })() as keyof typeof ERROR_FALLBACK_TEXT;
  const text = ERROR_FALLBACK_TEXT[lang];
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h2>{text.title}</h2>
      <pre style={{ color: '#666', whiteSpace: 'pre-wrap' }}>{error.message}</pre>
      <button onClick={resetErrorBoundary} style={{ marginTop: 16, padding: '8px 24px' }}>{text.retry}</button>
    </div>
  );
}

const MainApp = () => {
  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        {/* antd 组件是 px 体系，必须与 Tailwind 的根字号同步：
            2.1 之前根字号被压到 13.2px（82.5%），这里就把 antd 硬拉到
            fontSize 11.55 / controlHeight 26 去"对齐"。现在根字号回到 16px，
            antd 也随之回默认档（14/12/16/20、控件 32），两个库重新同尺度。
            Table 的 cellPadding 9 + 14px 行高 ≈ 40px 行高（触屏 40px 目标）。 */}
        <ConfigProvider
          theme={{
            token: {
              fontSize: 14,
              fontSizeSM: 12,
              fontSizeLG: 16,
              fontSizeXL: 20,
              controlHeight: 32,
            },
            components: {
              Table: {
                cellPaddingBlock: 9,
                cellPaddingInline: 12,
              },
            },
          }}
        >
          <RoutesComponent />
        </ConfigProvider>
        {createPortal(<Toaster />, document.body)}
      </ErrorBoundary>
    </BrowserRouter>
  );
};

createRoot(document.getElementById('root')!).render(<MainApp />);
