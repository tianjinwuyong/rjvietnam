// ============================================================
// 后端语言解析与消息翻译（无状态、免查库）
// ------------------------------------------------------------
// ① resolveLang(req)：读 `X-OA-Lang`（T1 前端拦截器注入），白名单 zh|vi|en，其余回退 zh。
// ② tMsg(lang, zhText)：zh 直返（零查表，保证 zh 输出与改造前逐字节一致）；
//    其他语言用 **zh → key 反查索引**取译文；未命中返回原中文（绝不返回 key/空串）。
// ③ tNotify(lang, text)：通知文案专用，先整句反查，再按固定前缀替换（见 messages.js）。
// 索引在模块加载时构建，**同一 zh 重复出现直接抛错**（反查歧义是静默故障源）。
// ============================================================

import { MESSAGES, NOTIFY_PREFIXES, MESSAGE_PATTERNS } from './messages.js';

/** 支持的界面语言 */
export const SUPPORTED_LANGS = ['zh', 'vi', 'en'];

const SUPPORTED_SET = new Set(SUPPORTED_LANGS);

/** zh 文本 → 消息键（模块加载时构建一次） */
const ZH_TO_KEY = new Map();

for (const [key, entry] of Object.entries(MESSAGES)) {
  const zhText = String(entry?.zh ?? '').trim();
  if (!zhText) throw new Error(`[i18n] 词库条目 ${key} 的 zh 为空`);
  for (const lang of SUPPORTED_LANGS) {
    if (!String(entry?.[lang] ?? '').trim()) {
      throw new Error(`[i18n] 词库条目 ${key} 缺少 ${lang} 译文`);
    }
  }
  if (ZH_TO_KEY.has(zhText)) {
    throw new Error(`[i18n] 词库 zh 重复："${zhText}" 同时属于 ${ZH_TO_KEY.get(zhText)} 与 ${key}（反查会产生歧义）`);
  }
  ZH_TO_KEY.set(zhText, key);
}

/** 词库键数（供日志与 CI 输出） */
export const MESSAGE_COUNT = Object.keys(MESSAGES).length;

/** 模板正则条数 */
export const PATTERN_COUNT = MESSAGE_PATTERNS.length;

/**
 * 核心翻译：先精确 `zh → key` 反查，再逐条尝试模板正则。
 * @param {'zh'|'vi'|'en'} lang 目标语言（非 zh）
 * @param {string} text 中文原文
 * @returns {string} 译文；无法翻译则原样返回
 */
function translateCore(lang, text) {
  const key = ZH_TO_KEY.get(text.trim());
  if (key) return MESSAGES[key][lang] || text;

  for (const pattern of MESSAGE_PATTERNS) {
    const matched = pattern.re.exec(text);
    if (!matched) continue;
    const template = pattern[lang];
    if (!template) continue;
    const nested = pattern.nested || [];
    let out = template;
    let complete = true;
    for (let i = 1; i < matched.length; i += 1) {
      let value = matched[i];
      if (nested.includes(i)) {
        // 捕获组本身也是中文消息 → 递归翻译；翻不出来就整条放弃，避免中英混排
        const sub = translateCore(lang, value);
        if (sub === value) { complete = false; break; }
        value = sub;
      }
      out = out.split(`{${i}}`).join(value);
    }
    if (complete) return out;
  }
  return text;
}

/**
 * 从请求头解析界面语言。
 * @param {{headers?: Record<string, unknown>} | string | undefined} req Fastify 请求对象，或直接给语言串
 * @returns {'zh'|'vi'|'en'} 白名单内的语言；缺失/非法一律 zh
 */
export function resolveLang(req) {
  if (typeof req === 'string') {
    const raw = req.trim().toLowerCase();
    return SUPPORTED_SET.has(raw) ? raw : 'zh';
  }
  const header = req?.headers?.['x-oa-lang'] ?? req?.headers?.['X-OA-Lang'] ?? '';
  // 头值可能是数组（重复头）；只取第一个
  const raw = String(Array.isArray(header) ? header[0] ?? '' : header).trim().toLowerCase();
  // 允许 'zh-CN' / 'en-US' 这类带地区后缀的写法
  const base = raw.split(',')[0].split(';')[0].split('-')[0].trim();
  return SUPPORTED_SET.has(base) ? base : 'zh';
}

/**
 * 把中文业务消息翻译成目标语言。
 * @param {'zh'|'vi'|'en'} lang 目标语言
 * @param {string} zhText 调用点抛出的中文原文（可含插值）
 * @returns {string} 译文；未收录（含精确与模板都未命中）则原样返回中文
 */
export function tMsg(lang, zhText) {
  if (!zhText || typeof zhText !== 'string') return zhText;
  if (lang === 'zh' || !SUPPORTED_SET.has(lang)) return zhText;
  return translateCore(lang, zhText);
}

/**
 * 通知文案渲染：先整句反查，再按固定前缀替换（不通篇改写，避免动到业务数据）。
 * @param {'zh'|'vi'|'en'} lang 收件人语言
 * @param {string} text 落库前的标题或正文
 * @returns {string} 渲染后的文案；无法识别则原样返回
 */
export function tNotify(lang, text) {
  if (!text || typeof text !== 'string') return text;
  if (lang === 'zh' || !SUPPORTED_SET.has(lang)) return text;

  const whole = tMsg(lang, text);
  if (whole !== text) return whole;

  let out = text;
  for (const rule of NOTIFY_PREFIXES) {
    if (out.startsWith(rule.zh)) {
      out = rule[lang] + out.slice(rule.zh.length);
      break;
    }
  }
  return out;
}

/**
 * 判断某中文消息是否已收录（供测试与排查）。
 * @param {string} zhText 中文原文
 * @returns {boolean} 是否收录
 */
export function hasMessage(zhText) {
  return ZH_TO_KEY.has(String(zhText ?? '').trim());
}
