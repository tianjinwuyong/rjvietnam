// OA 原生模块共享词典 — 从原 OA 前端构建产物逆向提取的完整三语文案
// （zh 3430 / en 3428 / vi 3428 条，75 个分区），措辞与原系统逐字一致。
// 用法：t("menu.todo", locale) → "待我审批"；t("common.totalCount", locale, { n: 5 }) → "共 5 条"
import zhDict from "./zh.json";
import enDict from "./en.json";
import viDict from "./vi.json";
import type { Locale } from "../../../../../packages/shared-types/src/factory";

type Dict = Record<string, unknown>;

const DICTS: Record<"zh" | "en" | "vi", Dict> = {
  zh: zhDict as Dict,
  en: enDict as Dict,
  vi: viDict as Dict,
};

/** SMT Locale（zh-CN/vi-VN/en-US）→ 词典语言键 */
export function oaLang(locale: Locale): "zh" | "en" | "vi" {
  if (locale === "vi-VN") return "vi";
  if (locale === "en-US") return "en";
  return "zh";
}

function lookup(dict: Dict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Dict)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * 点路径取词：先查当前语言，缺失回退中文（与原系统 fallbackLocale:"zh" 一致），
 * 再缺失返回键本身。{n} 形式插值位按 params 替换。
 */
export function t(key: string, locale: Locale, params?: Record<string, string | number>): string {
  const lang = oaLang(locale);
  let text = lookup(DICTS[lang], key) ?? lookup(DICTS.zh, key) ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
