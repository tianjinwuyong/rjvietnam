/**
 * 物料类型标准清单（前端用）。
 * 与 server/common/constants/material-types.ts 保持一致 —— 改一处必须同步另一处。
 *
 * 2026-10-18 用户反馈：物料类型下拉框里出现 other / electronic / 蜂窝板 等没定义过的值。
 * 原来下拉框是硬编码 15 项（含 外箱/中箱/内箱/中箱蜂巢/中箱隔板/塑胶 等细分），
 * 与库里实际使用的 9 类对不上，现统一为下面 9 类。
 */
export const MATERIAL_TYPES = [
  '塑胶件',
  '五金件',
  '磁性器件',
  '电子通用件',
  '辅料',
  '包材',
  'PCB',
  '线材',
  '其他',
] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number];
