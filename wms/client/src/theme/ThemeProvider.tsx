import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME_ID, THEMES, getTheme, type ThemeDefinition, type ThemeMode } from './palettes';

const STORAGE_KEY = 'wms-theme';
/** 单独存一份深浅模式：index.html 里的首屏兜底脚本只认这两个值，用来避免白闪 */
const MODE_KEY = 'wms-theme-mode';

interface ThemeContextValue {
  themeId: string;
  theme: ThemeDefinition;
  mode: ThemeMode;
  isDark: boolean;
  themes: ThemeDefinition[];
  setTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  theme: THEMES[0],
  mode: 'light',
  isDark: false,
  themes: THEMES,
  setTheme: () => {},
});

function readStoredThemeId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch {
    /* localStorage 不可用时按默认主题处理 */
  }
  return DEFAULT_THEME_ID;
}

/**
 * 把一套调色板写到 <html> 上。
 * - 行内 CSS 变量：覆盖 tailwind-theme.css 里的 :root 基线；
 * - data-wms-theme / data-wms-mode：供 theme-compat.css 做深色兜底与调试识别；
 * - color-scheme：让浏览器原生控件（滚动条、日期选择器）也跟着深浅变化。
 */
export function applyThemeToDocument(theme: ThemeDefinition) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.setAttribute('data-wms-theme', theme.id);
  root.setAttribute('data-wms-mode', theme.mode);
  root.style.colorScheme = theme.mode;
  // 首屏兜底底色与最终底色对齐（index.html 内联脚本也会先铺一次）
  root.style.backgroundColor = theme.vars.background;

  // 移动端浏览器地址栏配色（支持时）跟随主题底色，观感更连贯
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.vars.background ?? '#f2f2f7');
}

/** 在 React 挂载前同步套用已保存的主题，避免首屏先闪一下默认蓝再变色 */
export function initTheme() {
  applyThemeToDocument(getTheme(readStoredThemeId()));
}

/** 供 canvas 类图表（ECharts）取色：canvas 不认 CSS 变量，必须给具体色值 */
export function themeInk(theme: ThemeDefinition) {
  return {
    text: theme.vars['foreground'],
    sub: theme.vars['muted-foreground'],
    grid: theme.vars['border'],
    card: theme.vars['card'],
    primary: theme.vars['primary'],
  };
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<string>(() => readStoredThemeId());
  const theme = useMemo(() => getTheme(themeId), [themeId]);

  // 首帧 & 每次切换都重写变量（initTheme 已提前写过一次，这里是幂等的）
  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(MODE_KEY, theme.mode);
    } catch {
      /* 忽略 */
    }
  }, [theme]);

  // 多标签页/多窗口同步：一个窗口换肤，其它窗口跟着换
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setThemeIdState(getTheme(e.newValue).id);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((id: string) => {
    const next = getTheme(id);
    setThemeIdState(next.id);
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
      localStorage.setItem(MODE_KEY, next.mode);
    } catch {
      /* 隐私模式下写不进去也不影响当前会话生效 */
    }
    applyThemeToDocument(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId: theme.id,
      theme,
      mode: theme.mode,
      isDark: theme.mode === 'dark',
      themes: THEMES,
      setTheme,
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme() {
  return useContext(ThemeContext);
}

/** 图表取色 hook：主题一变，依赖它的 option 重新计算 */

/** 读取 <html> 上当前的 CSS 变量（ThemeProvider 会把主题变量写成行内 style） */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return v || fallback;
}

/**
 * 2.6：图表取色器。
 *
 * ECharts 画在 canvas 上，**不认 CSS 变量**（`var(--chart-1)` 会被当成非法颜色），
 * 所以在 JS 里取实际色值。用 getter 而不是常量，是为了让"换主题后重新取色"
 * 自动发生：每次读属性都取当前 <html> 上的变量，不需要把主题再往下传一层。
 *
 * 原来各图表页写死 `const BLUE = '#007AFF'` 这类常量，换肤时图表纹丝不动。
 */
export const CHART = {
  get blue() { return cssVar('chart-1', '#0063cc'); },
  get green() { return cssVar('chart-2', '#1e7a36'); },
  get orange() { return cssVar('chart-3', '#9a5b00'); },
  get red() { return cssVar('chart-4', '#c81e1e'); },
  get purple() { return cssVar('chart-5', '#5b3fa8'); },
  get palette(): string[] {
    return [
      cssVar('chart-1', '#0063cc'),
      cssVar('chart-2', '#1e7a36'),
      cssVar('chart-3', '#9a5b00'),
      cssVar('chart-4', '#c81e1e'),
      cssVar('chart-5', '#5b3fa8'),
      cssVar('info', '#1f5fa8'),
      cssVar('primary', '#0063cc'),
      cssVar('muted-foreground', '#6d6d72'),
    ];
  },
};

export function useChartInk() {
  const { theme } = useTheme();
  return useMemo(() => themeInk(theme), [theme]);
}
