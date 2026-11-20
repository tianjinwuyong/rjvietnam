/**
 * 统一日期时间格式化工具
 * 后端返回的时间统一为 ISO 8601 格式（如 2026-09-16T20:40:32.305Z），
 * 前端统一格式化为本地时间显示。
 */

/** 补零 */
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 解析任意时间输入为 Date 对象
 * 支持：ISO 字符串、时间戳数字、已格式化的字符串、Date 对象
 */
export function parseDate(input: string | number | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  // 字符串：尝试直接解析
  const d = new Date(input);
  if (!isNaN(d.getTime())) return d;
  // 兼容 "YYYY-MM-DD HH:mm:ss" 格式（Safari 对这种格式解析可能失败）
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(input)) {
    const normalized = input.replace(' ', 'T');
    const d2 = new Date(normalized);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

/**
 * 格式化为日期时间：YYYY-MM-DD HH:mm:ss
 * 空值返回 '-'
 */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 格式化为日期时间（到分钟）：YYYY-MM-DD HH:mm
 * 空值返回 '-'
 */
export function formatDateTimeMinute(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 格式化为日期：YYYY-MM-DD
 * 空值返回 '-'
 */
export function formatDate(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 格式化为时间：HH:mm:ss
 * 空值返回 '-'
 */
export function formatTime(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return '-';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Ant Design Table 列渲染器：日期时间
 * 用法：{ title: '创建时间', dataIndex: 'createdAt', render: renderDateTime }
 */
export const renderDateTime = (val: string | number | Date | null | undefined) => formatDateTime(val);

/**
 * Ant Design Table 列渲染器：仅日期
 * 用法：{ title: '生产日期', dataIndex: 'productionDate', render: renderDate }
 */
export const renderDate = (val: string | number | Date | null | undefined) => formatDate(val);

/**
 * Ant Design Table 列渲染器：日期时间（到分钟，如 2026-10-02 20:39）
 * 用法：{ title: '报检时间', dataIndex: 'submittedAt', render: renderDateTimeMinute }
 */
export const renderDateTimeMinute = (val: string | number | Date | null | undefined) => formatDateTimeMinute(val);

/**
 * Ant Design Table 列渲染器：日期时间，空值返回空字符串（用于筛选等场景）
 */
export const renderDateTimeEmpty = (val: string | number | Date | null | undefined) => {
  const d = parseDate(val);
  if (!d) return '';
  return formatDateTime(d);
};
