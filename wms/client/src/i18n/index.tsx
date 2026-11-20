import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { LanguageCode } from '@shared/api.interface';
import zh from './locales/zh';
import vi from './locales/vi';
import en from './locales/en';

type Translations = typeof zh;

/**
 * ui 段允许缺键。原因：`tui()` 的兜底设计就是「ui.<中文> 未命中时直接返回中文原文」
 * （见下方 missFallback），业务枚举词（包装类型/盘装料/普通…）在 vi/en 里允许暂缺，
 * 缺了会显示中文而非键名。其余段落没有这种兜底，仍要求三语严格对齐。
 */
type LocaleDict = Omit<Translations, 'ui'> & { ui: Partial<Translations['ui']> };

const translations: Record<LanguageCode, LocaleDict> = { zh, vi, en };

interface I18nContextType {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'zh',
  setLang: () => {},
  t: (key: string) => key,
});

/** 在字典中按点号路径取值；命中字符串才返回，否则 undefined */
function lookup(dict: any, key: string): string | undefined {
  let value: any = dict;
  for (const k of key.split('.')) {
    if (value && typeof value === 'object' && k in value) value = value[k];
    else return undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * 未命中时的兜底：ui.<中文> 直接回落到中文原文，
 * 避免界面上出现 "ui.xxx" 这样的原始键名（开发期新增键遗漏时尤其明显）。
 */
function missFallback(key: string): string {
  if (key.startsWith('ui.')) {
    const rest = key.slice(3);
    if (/[\u4e00-\u9fff]/.test(rest)) return rest;
  }
  return key;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('wms-lang');
    return (saved as LanguageCode) || 'zh';
  });

  const setLang = useCallback((newLang: LanguageCode) => {
    setLangState(newLang);
    localStorage.setItem('wms-lang', newLang);
  }, []);

  const t = useCallback((key: string): string => {
    const hit = lookup(translations[lang], key);
    return hit !== undefined ? hit : missFallback(key);
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

/** 动态选项/状态值翻译：文本含中文则按 ui.<文本> 查词，否则原样返回 */
export function tui(text: string): string {
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return text;
  return translate('ui.' + text);
}

/** 带占位符的即时翻译：tf('ui.xxx', { n: 3 }) 将 {n} 替换为 3；用于拼接型文案（含变量） */
export function tf(key: string, vars?: Record<string, string | number>): string {
  let s = translate(key);
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return s;
}

/** 供非组件模块（工具函数、模块级映射）使用的即时翻译；语言变化时随下一次渲染生效 */
export function translate(key: string): string {
  const lang = ((localStorage.getItem('wms-lang') as LanguageCode) || 'zh');
  const hit = lookup(translations[lang] || translations.zh, key);
  return hit !== undefined ? hit : missFallback(key);
}
