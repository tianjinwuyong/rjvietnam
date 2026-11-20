/**
 * 前后端共用的业务枚举常量（服务端副本）。
 *
 * ⚠️ 为什么不放 shared/：nest build（swc）只编译 server 目录下的文件，
 * shared/*.ts 不会进 dist，运行时 `require('../../../shared/xxx')` 会
 * MODULE_NOT_FOUND。故服务端与前端各存一份，改一处必须同步改另一处：
 *   - 服务端：server/common/constants/business-enums.ts
 *   - 前端：  client/src/constants/business-enums.ts
 * 类型仍统一放在 shared/api.interface.ts（纯类型，编译期擦除，无运行时依赖）。
 */

/**
 * IQC 不合格类型（不良类型）固定八项。
 * 用户口径（2026-10-18）：包装、外观、尺寸、功能、安规、可靠性、环保、无检验资料。
 * 判定为 fail 时必填且只能取这些值；判定为 pass 时必须清空。
 */
export const IQC_DEFECT_TYPES = [
  '包装',
  '外观',
  '尺寸',
  '功能',
  '安规',
  '可靠性',
  '环保',
  '无检验资料',
] as const;

/**
 * 历史数据里的旧英文值 → 八项中文口径。
 *
 * 2026-10-19 之前的看板按「检验记录逐项的不良描述」出图，`iqc_lot.defect_type`
 * 一度被写成模板分类的英文键（appearance / packaging …）。看板改按报告口径取数后，
 * 这些老值必须归一，否则会出现「外观」和「appearance」两个扇区。
 */
export const IQC_DEFECT_TYPE_LEGACY: Record<string, string> = {
  packaging: '包装',
  appearance: '外观',
  dimension: '尺寸',
  dimensional: '尺寸',
  function: '功能',
  functional: '功能',
  safety: '安规',
  reliability: '可靠性',
  environmental: '环保',
  environment: '环保',
  'no-inspection-data': '无检验资料',
  no_inspection_data: '无检验资料',
};

/** 归一化单个不良类型值；空值返回 null（调用方自行决定是否落「未分类」） */
export function normalizeIqcDefectType(value?: string | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return IQC_DEFECT_TYPE_LEGACY[v] ?? IQC_DEFECT_TYPE_LEGACY[v.toLowerCase()] ?? v;
}

/**
 * MRB 评审结论（评审员意见）。
 * 用户口径（2026-10-18）：只能是 特采 / 退货 / 返工 / 报废 四项，
 * 旧的 同意(accept) / 否决(reject) / 偏差(deviation) 已废弃。
 */
export const MRB_REVIEW_RESULTS = ['special_admit', 'return', 'rework', 'scrap'] as const;
