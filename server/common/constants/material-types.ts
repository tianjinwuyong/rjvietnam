/**
 * 物料类型（分类）唯一口径 —— 2026-10-18 用户口径「只保留我定义的几个类型」。
 *
 * 背景：原来看板下拉框是 `SELECT DISTINCT material_type FROM material` 直接取库里的值，
 * 于是任何脏值（other / electronic / 蜂窝板 …）都会变成一个可选项和饼图扇区。
 * 现在改为固定清单 + 写入归一，任何写法都会落到这 9 类里。
 *
 * 注意：client 侧有一份同名清单（client/src/constants/materialTypes.ts），
 * 改这里请同步改那边（server 编译只包含 server/**，无法直接 import 共享运行时模块）。
 */

/** 标准物料类型（顺序即下拉框展示顺序） */
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

/**
 * 别名 → 标准类型。key 一律存小写。
 * 只收「同义写法」，不做业务上的上级归类（例如不把「中箱」并入「包材」），
 * 避免把用户真实的细分类型信息抹掉。
 */
export const MATERIAL_TYPE_ALIASES: Record<string, MaterialType> = {
  // 其他
  其他: '其他',
  其它: '其他',
  other: '其他',
  others: '其他',
  misc: '其他',
  未分类: '其他',
  未知: '其他',
  // 塑胶件
  塑胶件: '塑胶件',
  塑胶: '塑胶件',
  plastic: '塑胶件',
  // 五金件
  五金件: '五金件',
  五金: '五金件',
  metal: '五金件',
  // 磁性器件
  磁性器件: '磁性器件',
  磁性: '磁性器件',
  磁材: '磁性器件',
  magnetic: '磁性器件',
  // 电子通用件
  电子通用件: '电子通用件',
  电子: '电子通用件',
  electronic: '电子通用件',
  // 辅料
  辅料: '辅料',
  耗材: '辅料',
  auxiliary: '辅料',
  // 包材
  包材: '包材',
  包装: '包材',
  包装材料: '包材',
  packaging: '包材',
  // PCB
  pcb: 'PCB',
  // 线材
  线材: '线材',
  线缆: '线材',
  wire: '线材',
};

/**
 * 归一化：同义写法折成标准类型；认不出来的**原样返回**（不硬塞进「其他」，
 * 否则用户新增的分类会被悄悄改掉）。看板展示时会再把非标准值合并进「其他」。
 */
export function normalizeMaterialType(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return MATERIAL_TYPE_ALIASES[s.toLowerCase()] ?? s;
}

export function isStandardMaterialType(t: string): boolean {
  return (MATERIAL_TYPES as readonly string[]).includes(t);
}

/** 某个标准类型对应的全部库内写法（用于 SQL IN 过滤） */
export function materialTypeAliasValues(t: string): string[] {
  const target = normalizeMaterialType(t);
  const list = Object.entries(MATERIAL_TYPE_ALIASES)
    .filter(([, v]) => v === target)
    .map(([k]) => k);
  // 「其他」还要包含空值：库里 type 为空的批次在看板上也算作「其他」
  if (target === '其他') list.push('', '未分类', '未知');
  return Array.from(new Set([target, ...list]));
}
