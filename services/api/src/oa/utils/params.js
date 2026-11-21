// ============================================================
// 共享参数归一化工具
// ------------------------------------------------------------
// 目的：把「非法/越界/非数字」的请求参数（尤其是会被拼进 SQL 的分页值与
//       会作为 bigint 传入的路径 id）统一归一，从源头挡住
//       「无效的类型 bigint 输入语法: "NaN"」「超出类型 bigint 的范围」
//       「OFFSET 后的值不能是负数」这类把数据库原始错误回显到界面的问题。
//
// 说明：doc.js 历史上有一份本地 `n()` 辅助，本模块是其抽离与增强版，
//       全项目共用一份，避免各模块重复实现导致行为漂移。
// ============================================================

/** 仅接受「纯十进制整数字面量」：拒绝 1e20 / 1.5 / abc / Infinity / [object Object] / ' OR 1=1--' */
const INT_RE = /^[+-]?\d+$/;

/**
 * 归一化整数字符串，返回安全整数或回退值。
 *
 * 规则：
 *   - `undefined` / `null` / 空串 → 返回 `def`；
 *   - 非纯整数写法（含科学计数法 `1e20`、小数、任意文本）→ 返回 `def`；
 *   - 解析后非「安全整数」（如超大数）→ 返回 `def`；
 *   - 命中 `min` / `max` 边界外 → 返回 `def`。
 *
 * @param {*} v 原始值（通常来自 query/params）
 * @param {{ def?: number|null, min?: number|null, max?: number|null }} [opts]
 * @returns {number|null} 归一后的安全整数，非法时返回 `def`
 */
export function toInt(v, { def = null, min = null, max = null } = {}) {
  if (v === undefined || v === null || v === '') return def;
  // 数组（?page=1&page=2）取首个元素，避免 String([..]) 造成的歧义
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return def;
  const s = String(raw).trim();
  if (!INT_RE.test(s)) return def;
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return def;
  if (min !== null && n < min) return def;
  if (max !== null && n > max) return def;
  return n;
}

/**
 * 归一化「资源 id」：返回正的安全整数，任何非法输入返回 `null`。
 *
 * 覆盖并拒绝：''、'abc'、'-1'、'0'、'1e20'、'[object Object]'、"' OR 1=1--"、
 *           超大数（超出安全整数 / bigint 范围）、数组/对象等。
 * 调用方拿到 `null` 时应直接返回 400/404，**不要把 null 之外的值送进 SQL**。
 *
 * @param {*} v
 * @returns {number|null}
 */
export function toId(v) {
  const n = toInt(v, { def: null, min: 1 });
  if (n === null) return null;
  // 超出 JS 安全整数范围（如 1e20 → 100000000000000000000）无法精确表示，判为非 id
  if (n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

export default { toInt, toId, dateParam };

/**
 * 严格日期参数归一：`YYYY-MM-DD` / `YYYY/M/D`，且必须是真实日历日。
 * 非法抛 400（业务错误），绝不把非法串下发 SQL 触发 SQLSTATE 22008 → 500。
 *
 * @param {*} v
 * @param {string} [label] 文案前缀，如「起始」
 * @returns {string|null} 归一后的 YYYY-MM-DD；空值返回 null
 */
export function dateParam(v, label = '日期') {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) throw Object.assign(new Error(`${label}格式不正确（YYYY-MM-DD）`), { statusCode: 400 });
  const [, y, mo, da] = m;
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da)));
  if (d.getUTCFullYear() !== Number(y) || d.getUTCMonth() !== Number(mo) - 1 || d.getUTCDate() !== Number(da)) {
    throw Object.assign(new Error(`${label}无效（YYYY-MM-DD）`), { statusCode: 400 });
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}
