// MES-ruijing 前端词典查询 —— 扁平 key（源 web/i18n.js 用法：t('mo')）
// 词典两层：i18n-dict.ts（源系统逐字移植）+ labels.ts（本模块新增字段/页面标签，
// 源词典未覆盖的部分，同样 zh/en/vi 三语齐备）
import { DICT } from "./i18n-dict";
import { LABELS } from "./labels";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Lang = "zh" | "en" | "vi";

const DICTS: Record<Lang, Record<string, string>> = DICT as unknown as Record<Lang, Record<string, string>>;

/** SMT Locale（zh-CN/vi-VN/en-US）→ 源系统语言码 */
export function mesrjLang(locale: Locale): Lang {
  if (locale === "vi-VN") return "vi";
  if (locale === "en-US") return "en";
  return "zh";
}

/** 短路径取词：先当前语言，缺省回落中文（与源系统 fallbackLocale:"zh" 一致） */
export function t(key: string, locale: Locale): string {
  const lang = mesrjLang(locale);
  const label = LABELS[key];
  if (label) return label[lang] ?? label.zh;
  return DICTS[lang]?.[key] ?? DICTS.zh?.[key] ?? key;
}
